/**
 * ダンジョン画面。入力・メニュー・描画をまとめる、本作の中心となる画面。
 */
import { chebyshev, samePoint, step } from '../../core/geom.js';
import { Cmd } from '../../core/input.js';
import { clearRun, saveRun } from '../../core/save.js';
import { getItem, getTrap } from '../../data/registry.js';
import { at } from '../../dungeon/tilemap.js';
import { SHORTCUT_SLOTS, addKept, assignShortcut, equippedBracelet, isEquipped, isInventoryFull, isKept, keptItems, mergeStacks, removeKept, shortcutOf, shortcutSlots, sortInventory, } from '../../game/inventory.js';
import { isContainer, needsDirection, needsItemTarget, payDebt, shopDebt, throwGitan, } from '../../game/itemActions.js';
import { keepSlotsFor } from '../../game/town.js';
import { itemName, kindLabel, useVerb } from '../../game/naming.js';
import { SELL_RATE } from '../../game/rules.js';
import { onStairs, restTurns, stepTurn, whyCannotRest } from '../../game/turn.js';
import { drawText, drawOverlay } from '../draw.js';
import { Camera, DungeonRenderer } from '../renderer.js';
import { FxSystem } from '../fx.js';
import { Hud } from '../hud.js';
import { ConfirmDialog, DirectionPicker, ListMenu, MenuStack, QuantityPicker, } from '../menu.js';
import { drawFullMap, drawMinimap, nextMinimapMode } from '../minimap.js';
import { MENU_LAYOUT, SCREEN_H, SCREEN_W, TILE, UI } from '../theme.js';
import { animScale, messageCps } from './app.js';
import { drawHelp } from './help.js';
/** 保持バッグに入れるコマンドの名前 */
const SHORTCUT_LABEL = 'ショートカットに 入れる';
/**
 * ショートカットから「投げる」で使う物か。
 * 矢や石は向きを聞かずに今の向きへ飛ばす。1 手で撃てることが値打ちなので、
 * ここで方向を聞くとショートカットの意味が無くなる。
 */
function isThrowable(def) {
    return def.kind === 'misc' && def.throwEffect !== undefined;
}
export class DungeonScreen {
    app;
    world;
    onFinish;
    onSuspend;
    id = 'dungeon';
    renderer = new DungeonRenderer();
    camera = new Camera();
    fx = new FxSystem();
    hud = new Hud();
    menus = new MenuStack();
    dialog = null;
    dirPicker = null;
    qtyPicker = null;
    overlay = 'none';
    logScroll = 0;
    minimapMode = 'normal';
    /** ダッシュ中の方向 */
    dashDir = null;
    dashCooldown = 0;
    lastDepth = 0;
    time = 0;
    constructor(app, world, onFinish, onSuspend) {
        this.app = app;
        this.world = world;
        this.onFinish = onFinish;
        this.onSuspend = onSuspend;
    }
    enter() {
        this.applySettings();
        this.camera.setTarget(this.world.player.pos, this.world.map, SCREEN_W, SCREEN_H);
        this.camera.snap();
        this.lastDepth = this.world.run.depth;
        this.renderer.invalidateTerrain();
        this.pumpEvents();
        this.app.audio.playBgm(this.world.dungeon.bgm);
    }
    applySettings() {
        const s = this.app.settings;
        this.fx.speedScale = animScale(s.animSpeed);
        this.fx.reduceMotion = s.reduceMotion;
        this.app.log.cps = messageCps(s.messageSpeed);
        this.app.input.numpadOnlyDiagonal = !s.diagonalFree;
    }
    // ------------------------------------------------------------ 更新
    update(dt, now) {
        this.time = now;
        const world = this.world;
        // フロアが変わったら地形のキャッシュを捨ててカメラを飛ばす
        if (world.run.depth !== this.lastDepth) {
            this.lastDepth = world.run.depth;
            this.renderer.invalidateTerrain();
            this.camera.setTarget(world.player.pos, world.map, SCREEN_W, SCREEN_H);
            this.camera.snap();
            // ここで fx.reset() を呼ぶと、floorChange を処理した時に張られた
            // モンスターハウス／ボスのバナーと入力ロックまで消えてしまう。
            // 演出のリセットは fx 側が floorChange を受け取った時に済んでいる
            this.app.input.latchDirection();
        }
        this.app.log.update(dt);
        this.fx.update(dt, this.actorPositions());
        this.camera.setTarget(world.player.pos, world.map, SCREEN_W, SCREEN_H);
        this.camera.update(dt);
        this.hud.update(world.player, dt);
        if (this.dashCooldown > 0)
            this.dashCooldown -= dt;
        if (world.finished) {
            if (!this.fx.isHolding()) {
                const f = world.finished;
                clearRun();
                this.onFinish(f.kind, f.reason);
            }
            return;
        }
        this.handleInput(dt);
    }
    actorPositions() {
        const m = new Map();
        for (const a of this.world.allActors()) {
            if (a.alive)
                m.set(a.id, a.pos);
        }
        return m;
    }
    /** ロジックが積んだイベントを演出とログへ流す */
    pumpEvents() {
        const events = this.world.drainEvents();
        if (events.length === 0)
            return;
        for (const e of events) {
            if (e.t === 'message') {
                this.app.log.add(e.text, e.style ?? 'normal', this.time);
            }
            else if (e.t === 'sfx') {
                this.app.audio.play(e.name);
            }
            else if (e.t === 'bgm') {
                this.app.audio.playBgm(e.track);
            }
        }
        this.fx.consume(events, (id) => this.world.actorById(id)?.pos ?? null);
        // 被弾したらダッシュと連続移動を止める
        if (events.some((e) => e.t === 'damage' && e.actorId === this.world.player.id)) {
            this.dashDir = null;
            this.app.input.latchDirection();
        }
        if (events.some((e) => e.t === 'monsterHouse' || e.t === 'bossAppear')) {
            this.dashDir = null;
            this.app.input.latchDirection();
        }
        this.fx.prune(new Set(this.world.allActors().map((a) => a.id)));
    }
    /** 1 行動を実行してイベントを流す */
    act(action) {
        stepTurn(this.world, action);
        this.pumpEvents();
    }
    handleInput(dt) {
        const input = this.app.input;
        // 演出待ちの間は入力を取らない（階層移動の暗転など）
        if (this.fx.isHolding())
            return;
        // メニューから出した全体図。閉じるまでは他の操作を受け付けない
        // （真っ暗な地図の裏で歩けてしまうのを防ぐ）
        if (this.showFullMapOnce) {
            if (input.justPressed(Cmd.B) || input.justPressed(Cmd.X)
                || input.justPressed(Cmd.A) || input.justPressed(Cmd.Map)) {
                this.showFullMapOnce = false;
                this.app.audio.play('cancel');
            }
            return;
        }
        // 全画面の重ね表示
        if (this.overlay !== 'none') {
            if (this.overlay === 'log') {
                if (input.directionFires('menu')) {
                    const d = input.direction();
                    if (d === 0)
                        this.logScroll--;
                    if (d === 4)
                        this.logScroll++;
                }
                if (input.commandFires(Cmd.PageUp, 'page'))
                    this.logScroll -= 10;
                if (input.commandFires(Cmd.PageDown, 'page'))
                    this.logScroll += 10;
            }
            if (input.justPressed(Cmd.B) || input.justPressed(Cmd.X)
                || input.justPressed(Cmd.Log) || input.justPressed(Cmd.Help)) {
                this.overlay = 'none';
            }
            return;
        }
        // 対象選択の類
        if (this.dirPicker) {
            if (this.dirPicker.handleInput(input))
                this.dirPicker = null;
            return;
        }
        if (this.qtyPicker) {
            if (this.qtyPicker.handleInput(input))
                this.qtyPicker = null;
            return;
        }
        if (this.dialog) {
            if (this.dialog.handleInput(input))
                this.dialog = null;
            return;
        }
        if (this.menus.isOpen) {
            this.menus.handleInput(input);
            return;
        }
        // メッセージ送り中は A で早送り。
        // 早送りに使った A をそのまま残すと、同じフレームで攻撃にもなって
        // 1 ターン消費してしまうので、ここで押下を食べておく
        if (this.app.log.isTyping()) {
            this.app.log.fastForward = input.isDown(Cmd.A);
            if (input.justPressed(Cmd.A)) {
                this.app.log.skipTyping();
                input.consume(Cmd.A);
            }
        }
        else {
            this.app.log.fastForward = false;
        }
        // --- フィールド操作 ---
        if (input.justPressed(Cmd.Minimap)) {
            this.minimapMode = nextMinimapMode(this.minimapMode);
            this.app.audio.play('cursor');
        }
        if (input.justPressed(Cmd.Log)) {
            this.overlay = 'log';
            this.logScroll = 9999;
            return;
        }
        if (input.justPressed(Cmd.Help)) {
            this.overlay = 'help';
            return;
        }
        if (input.justPressed(Cmd.X)) {
            this.openMainMenu();
            return;
        }
        if (input.justPressed(Cmd.Y)) {
            this.openFeetMenu();
            return;
        }
        if (input.justPressed(Cmd.MenuItem)) {
            this.openItemMenu();
            return;
        }
        if (input.justPressed(Cmd.MenuSpecial)) {
            this.openSpecialMenu();
            return;
        }
        if (input.justPressed(Cmd.MenuTactics)) {
            this.openTacticsMenu();
            return;
        }
        if (input.justPressed(Cmd.Stairs)) {
            this.tryStairs();
            return;
        }
        const shortcut = input.takeShortcut();
        if (shortcut !== null) {
            this.useShortcut(shortcut);
            return;
        }
        // 向き変更（R を押している間）
        if (input.isDown(Cmd.R)) {
            const d = input.direction();
            if (d !== null && input.directionFires('menu')) {
                this.world.player.dir = d;
                this.app.audio.play('cursor');
            }
            if (input.justPressed(Cmd.A))
                this.act({ type: 'attack', dir: this.world.player.dir });
            return;
        }
        // ダッシュ
        if (input.isDown(Cmd.Dash)) {
            const d = input.direction();
            if (this.dashDir === null && d !== null)
                this.dashDir = d;
            if (this.dashDir !== null && this.dashCooldown <= 0) {
                this.doDashStep();
                this.dashCooldown = Math.max(16, 45 * this.fx.speedScale);
            }
            return;
        }
        this.dashDir = null;
        // 通常の移動・攻撃
        if (input.directionFires('move')) {
            const d = input.direction();
            if (d !== null)
                this.act({ type: 'move', dir: d });
            return;
        }
        if (input.justPressed(Cmd.A)) {
            if (onStairs(this.world))
                this.tryStairs();
            else
                this.act({ type: 'attack', dir: this.world.player.dir });
            return;
        }
        if (input.commandFires(Cmd.Wait, 'wait')) {
            this.act({ type: 'wait' });
        }
        void dt;
    }
    /**
     * 休む。
     *
     * 上限は 200 ターン。どのレベルでも HP が半分回復するのに約 70 ターンかかるので、
     * 60 だと敵がいなくても必ず選び直しになっていた。
     * 1 ターンも休めなかった時は必ず理由を出す。「0ターン 休んだ。」とだけ
     * 出していたせいで、プレイヤーが何度も選び直して殴られ続けていた。
     */
    doRest() {
        const world = this.world;
        const why = whyCannotRest(world);
        const n = restTurns(world, 200);
        this.pumpEvents();
        if (n === 0)
            world.log(why ?? '休めなかった。', 'warning');
        else
            world.log(`${n}ターン 休んだ。`, 'system');
        this.pumpEvents();
    }
    doDashStep() {
        const world = this.world;
        const dir = this.dashDir;
        if (dir === null)
            return;
        const p = world.player;
        const beforeTile = at(world.map, p.pos.x, p.pos.y);
        const prevRoom = beforeTile ? beforeTile.roomId : -1;
        // 進む先に敵がいたら止まる（ダッシュで殴らない）
        const ahead = world.actorAt(step(p.pos, dir));
        if (ahead && world.isHostile(p, ahead)) {
            this.dashDir = null;
            return;
        }
        const before = { ...p.pos };
        this.act({ type: 'move', dir });
        if (samePoint(before, p.pos)) {
            this.dashDir = null;
            return;
        }
        // 止まるべき状況か
        const t = at(world.map, p.pos.x, p.pos.y);
        if (!t
            || world.floorItemAt(p.pos)
            || samePoint(p.pos, world.map.stairs)
            || (t.trap && t.trap.revealed)
            || t.roomId !== prevRoom
            || t.isDoor
            || this.visibleEnemyNear()) {
            this.dashDir = null;
        }
    }
    visibleEnemyNear() {
        const world = this.world;
        for (const m of world.run.monsters) {
            if (!m.alive || m.asleep)
                continue;
            const t = at(world.map, m.pos.x, m.pos.y);
            if (t?.visible && chebyshev(m.pos, world.player.pos) <= 5)
                return true;
        }
        return false;
    }
    // ------------------------------------------------------------ メニュー
    openMainMenu() {
        this.app.audio.play('confirm');
        const entries = [
            { label: '道具', desc: '持ち物を見る・使う', onSelect: () => { this.openItemMenu(); } },
            { label: '足元', desc: '足元を調べる', onSelect: () => { this.openFeetMenu(); } },
            { label: '特殊', desc: '休む・名前をつける', onSelect: () => { this.openSpecialMenu(); } },
            {
                label: '作戦',
                disabled: this.world.run.allies.length === 0,
                desc: '仲間への指示',
                onSelect: () => { this.openTacticsMenu(); },
            },
            {
                label: '全体図',
                desc: 'フロア全体の地図を見る',
                onSelect: () => {
                    this.overlay = 'none';
                    this.menus.closeAll();
                    this.showFullMapOnce = true;
                },
            },
            {
                label: '中断',
                desc: 'ここまでを保存してタイトルへ戻る',
                onSelect: () => {
                    this.dialog = new ConfirmDialog({
                        message: 'ここまでを 保存して 中断しますか？',
                        onYes: () => {
                            saveRun(this.world.syncForSave());
                            this.app.persist();
                            this.onSuspend();
                        },
                    });
                    return true;
                },
            },
            { label: '設定', desc: '表示や音の設定', onSelect: () => { this.openSettingsMenu(); } },
        ];
        this.menus.push(new ListMenu({
            title: 'メニュー',
            entries,
            rect: {
                x: MENU_LAYOUT.main.x, y: MENU_LAYOUT.main.y,
                w: MENU_LAYOUT.main.w, h: 60 + entries.length * MENU_LAYOUT.main.itemH,
            },
            rowH: MENU_LAYOUT.main.itemH,
        }));
    }
    showFullMapOnce = false;
    inventoryEntries(onPick) {
        const world = this.world;
        const p = world.player;
        return p.inventory.map((item) => {
            const def = getItem(item.defId);
            const badges = [];
            if (isEquipped(p, item.uid))
                badges.push({ text: 'E', color: UI.equip });
            const slot = shortcutOf(p, item.defId);
            if (slot >= 0)
                badges.push({ text: `${slot + 1}`, color: UI.cursorEdge });
            if (isKept(p, item.uid))
                badges.push({ text: '保', color: UI.good });
            if (item.cursed && item.plusKnown)
                badges.push({ text: '呪', color: UI.curse });
            if (item.shopPrice > 0)
                badges.push({ text: '売', color: UI.gitan });
            return {
                label: itemName(item, world.run.identify),
                right: item.shopPrice > 0 ? `${item.shopPrice}G` : kindLabel(def.kind),
                badges,
                sprite: spriteOfItem(item),
                desc: world.run.identify.known[item.defId] || !isUnknownKind(def.kind)
                    ? def.desc
                    : 'まだ 何か 分からない。使ってみるか、識別するしかない。',
                data: item,
                onSelect: () => {
                    onPick(item);
                    return false;
                },
            };
        });
    }
    openItemMenu() {
        const menu = new ListMenu({
            title: `持ち物　${this.world.player.inventory.length} / 20`
                + `　　保持 ${keptItems(this.world.player).length} / ${this.keepSlots()}`
                + `　　［F］整理`,
            entries: [],
            rect: {
                x: MENU_LAYOUT.items.x, y: MENU_LAYOUT.items.y,
                w: MENU_LAYOUT.items.w, h: MENU_LAYOUT.items.h,
            },
            rowH: MENU_LAYOUT.items.rowH,
            rows: MENU_LAYOUT.items.rows,
            showDesc: true,
            emptyText: '何も 持っていない',
        });
        const refresh = () => {
            menu.setEntries(this.inventoryEntries((item) => this.openItemContext(item)));
        };
        refresh();
        // 同じ道具が散らばっていたら「まとめる」を出す
        menu.onKey = (input) => {
            if (!input.justPressed(Cmd.Y))
                return false;
            const merged = mergeStacks(this.world.player);
            sortInventory(this.world.player);
            this.world.log(merged > 0 ? `${merged}個の 山を まとめた。` : '持ち物を 整理した。', 'system');
            this.pumpEvents();
            this.app.audio.play('confirm');
            refresh();
            return true;
        };
        this.menus.push(menu);
    }
    /** 持ち物を選んだあとの「使う／投げる／置く…」 */
    openItemContext(item) {
        const world = this.world;
        const p = world.player;
        const def = getItem(item.defId);
        const equipped = isEquipped(p, item.uid);
        const onShopTile = at(world.map, p.pos.x, p.pos.y)?.shop === true;
        const entries = [];
        const close = () => {
            this.menus.closeAll();
            return true;
        };
        if (def.kind === 'weapon' || def.kind === 'shield' || def.kind === 'bracelet') {
            entries.push({
                label: equipped ? 'はずす' : '装備する',
                onSelect: () => {
                    this.act({ type: equipped ? 'unequip' : 'equip', uid: item.uid });
                    return close();
                },
            });
        }
        else if (def.kind !== 'gitan' && def.kind !== 'misc') {
            entries.push({
                label: useVerb(def),
                onSelect: () => {
                    // false を返して、閉じるのは startUseItem に任せる。
                    // true を返すと、対象を選ぶ物（識別・封印・回数回復の巻物など）で
                    // 積んだばかりの「何に使いますか？」を、その場で閉じてしまう。
                    // ＝「読む」を押しても何も起きない、という状態になる
                    this.startUseItem(item);
                    return false;
                },
            });
        }
        if (isContainer(def)) {
            entries.push({
                label: '入れる',
                onSelect: () => {
                    this.pickTargetItem(item, '何を 入れますか？', (target) => {
                        this.act({ type: 'use', uid: item.uid, targetUid: target.uid });
                        this.menus.closeAll();
                    });
                    return false;
                },
            });
            if (item.contents.length > 0) {
                entries.push({
                    label: '出す',
                    onSelect: () => {
                        this.openPotContents(item);
                        return false;
                    },
                });
            }
        }
        entries.push({
            label: '投げる',
            onSelect: () => {
                this.dirPicker = new DirectionPicker(`${itemName(item, world.run.identify)}を どの向きへ？`, p.dir, (dir) => {
                    this.act({ type: 'throw', uid: item.uid, dir: dir });
                    this.menus.closeAll();
                }, () => { });
                return false;
            },
        });
        // 保持バッグ（数字キー 1〜3）
        const inSlot = shortcutOf(p, item.defId);
        if (inSlot >= 0) {
            entries.push({
                label: `ショートカット ${inSlot + 1} から 外す`,
                onSelect: () => {
                    assignShortcut(p, inSlot, null);
                    world.log(`ショートカット ${inSlot + 1} を 空けた。`, 'system');
                    this.pumpEvents();
                    return close();
                },
            });
        }
        else {
            entries.push({
                label: SHORTCUT_LABEL,
                desc: '数字キー 1〜3 で すぐ 使えるようになります。並べ替えても ずれません。',
                onSelect: () => {
                    this.menus.push(new ListMenu({
                        title: 'どの 番号に 割り当てますか？',
                        entries: shortcutSlots(p).map((cur, i) => ({
                            label: `${i + 1}：${cur.item
                                ? itemName(cur.item, world.run.identify)
                                : cur.defId ? `${getItem(cur.defId).name}（切らしている）` : '（空き）'}`,
                            onSelect: () => {
                                assignShortcut(p, i, item.defId);
                                world.log(`${itemName(item, world.run.identify)}を ショートカット ${i + 1} に 入れた。`, 'system');
                                this.pumpEvents();
                                return close();
                            },
                        })),
                        rect: { x: 420, y: 260, w: 420, h: 60 + SHORTCUT_SLOTS * 40 },
                    }));
                    return false;
                },
            });
        }
        // 保持枠（倒れても失わない）
        const kept = isKept(p, item.uid);
        const slots = this.keepSlots();
        entries.push({
            label: kept ? '保持を やめる' : '保持する',
            color: kept || slots === 0 ? undefined : UI.good,
            right: slots === 0 ? 'なし' : `${keptItems(p).length}/${slots}`,
            disabled: slots === 0 && !kept,
            desc: slots === 0
                ? 'ここでは 村の加護が 通じない。何ひとつ 守れない。'
                : kept
                    ? 'この道具は 倒れても 持ち帰れます。'
                    : '倒れても 失わなくなります（持てる数は 増えません）。',
            onSelect: () => {
                if (kept) {
                    removeKept(p, item.uid);
                    world.log(`${itemName(item, world.run.identify)}の 保持を やめた。`, 'system');
                }
                else if (addKept(p, item.uid, this.keepSlots())) {
                    world.log(`${itemName(item, world.run.identify)}を 保持した。`, 'good');
                }
                else {
                    world.log(`保持枠が いっぱいだ（${this.keepSlots()} 個まで）。`, 'warning');
                }
                this.pumpEvents();
                return close();
            },
        });
        entries.push({
            label: '置く',
            disabled: !!world.floorItemAt(p.pos),
            onSelect: () => {
                this.act({ type: 'place', uid: item.uid });
                return close();
            },
        });
        if (onShopTile && item.shopPrice === 0) {
            entries.push({
                label: '売る',
                onSelect: () => {
                    this.act({ type: 'sell', uid: item.uid });
                    return close();
                },
            });
        }
        entries.push({
            label: '説明',
            onSelect: () => {
                this.showItemInfo(item);
                return false;
            },
        });
        this.menus.push(new ListMenu({
            title: itemName(item, world.run.identify),
            entries,
            rect: {
                x: MENU_LAYOUT.items.x + MENU_LAYOUT.items.w - 20,
                y: MENU_LAYOUT.items.y + 60,
                w: MENU_LAYOUT.context.w,
                h: 56 + entries.length * MENU_LAYOUT.context.itemH,
            },
            rowH: MENU_LAYOUT.context.itemH,
        }));
    }
    /** 使うときに対象や方向が要るなら、先に選ばせる */
    startUseItem(item) {
        const def = getItem(item.defId);
        if (needsItemTarget(def)) {
            this.pickTargetItem(item, '何に 使いますか？', (target) => {
                this.act({ type: 'use', uid: item.uid, targetUid: target.uid });
                this.menus.closeAll();
            });
            return;
        }
        if (needsDirection(def)) {
            this.dirPicker = new DirectionPicker(`${itemName(item, this.world.run.identify)}を どの向きへ？`, this.world.player.dir, (dir) => {
                this.act({ type: 'use', uid: item.uid, dir: dir });
                this.menus.closeAll();
            }, () => { });
            return;
        }
        this.act({ type: 'use', uid: item.uid });
        this.menus.closeAll();
    }
    /** 対象アイテムを一覧から選ばせる */
    pickTargetItem(source, title, onPick) {
        const entries = this.inventoryEntries(onPick)
            .filter((e) => e.data.uid !== source.uid);
        this.menus.push(new ListMenu({
            title,
            entries,
            rect: {
                x: MENU_LAYOUT.items.x, y: MENU_LAYOUT.items.y,
                w: MENU_LAYOUT.items.w, h: MENU_LAYOUT.items.h,
            },
            rowH: MENU_LAYOUT.items.rowH,
            rows: MENU_LAYOUT.items.rows,
            showDesc: true,
            emptyText: '対象に できる物が 無い',
        }));
    }
    openPotContents(pot) {
        const world = this.world;
        const entries = pot.contents.map((inner, index) => ({
            label: itemName(inner, world.run.identify),
            right: kindLabel(getItem(inner.defId).kind),
            desc: getItem(inner.defId).desc,
            onSelect: () => {
                this.act({ type: 'takeOut', potUid: pot.uid, index });
                this.menus.closeAll();
                return true;
            },
        }));
        this.menus.push(new ListMenu({
            title: `${itemName(pot, world.run.identify)}の 中身`,
            entries,
            rect: { x: 360, y: 180, w: 420, h: 300 },
            showDesc: true,
            emptyText: '空っぽだ',
        }));
    }
    showItemInfo(item) {
        const world = this.world;
        const def = getItem(item.defId);
        const known = world.run.identify.known[item.defId] || !isUnknownKind(def.kind);
        const lines = [];
        lines.push(known ? def.desc : 'まだ 何か 分からない。');
        if (def.kind === 'weapon')
            lines.push(`攻撃力 ${def.atk}　印 ${def.slots}個`);
        if (def.kind === 'shield')
            lines.push(`防御力 ${def.def}　印 ${def.slots}個`);
        if (def.kind === 'staff' && known)
            lines.push(`残り ${item.charges}回`);
        if (def.kind === 'pot')
            lines.push(`容量 ${def.capacity}`);
        if (item.runes.length > 0)
            lines.push(`印: ${item.runes.join('・')}`);
        lines.push(`売値 およそ ${Math.floor(def.price * SELL_RATE)}ギタン`);
        this.menus.push(new ListMenu({
            title: itemName(item, world.run.identify),
            entries: lines.map((text) => ({ label: text, disabled: true })),
            rect: { x: 340, y: 220, w: 600, h: 80 + lines.length * 32 },
            rowH: 32,
        }));
    }
    /**
     * 足元の物と入れ替える。
     *
     * 持ち物がいっぱいだと、目の前の物をどうやっても拾えない。
     * 「置いてから拾う」は 2 ターンかかるうえ、置いた物の上には拾えないので、
     * 1 手で交換できる道を用意する。
     */
    openSwapMenu(target) {
        const world = this.world;
        const p = world.player;
        this.menus.push(new ListMenu({
            title: `何と 入れ替えますか？（足元: ${itemName(target, world.run.identify)}）`,
            entries: this.inventoryEntries((item) => {
                if (isEquipped(p, item.uid) && item.cursed) {
                    world.log('呪われていて 手から 離れない！', 'bad');
                    this.pumpEvents();
                    return;
                }
                this.act({ type: 'swap', uid: item.uid });
                this.menus.closeAll();
            }),
            rect: {
                x: MENU_LAYOUT.items.x, y: MENU_LAYOUT.items.y,
                w: MENU_LAYOUT.items.w, h: MENU_LAYOUT.items.h,
            },
            rowH: MENU_LAYOUT.items.rowH,
            rows: MENU_LAYOUT.items.rows,
            showDesc: true,
        }));
    }
    /** 保持枠の数。数える場所は town.ts の 1 箇所だけにしてある */
    keepSlots() {
        return keepSlotsFor(this.app.town, this.world.dungeon);
    }
    openFeetMenu() {
        const world = this.world;
        const p = world.player;
        const floorItem = world.floorItemAt(p.pos);
        const tile = at(world.map, p.pos.x, p.pos.y);
        const entries = [];
        if (floorItem) {
            const name = itemName(floorItem.item, world.run.identify);
            if (floorItem.item.shopPrice > 0) {
                entries.push({
                    label: `${name}を 買う（${floorItem.item.shopPrice}ギタン）`,
                    disabled: p.gitan < floorItem.item.shopPrice,
                    onSelect: () => {
                        this.act({ type: 'buy' });
                        return true;
                    },
                });
            }
            else {
                entries.push({
                    label: `${name}を 拾う`,
                    disabled: isInventoryFull(p),
                    desc: isInventoryFull(p) ? '持ち物が いっぱいです。' : undefined,
                    onSelect: () => {
                        this.act({ type: 'pickup' });
                        return true;
                    },
                });
                // 持ち物がいっぱいの時は、置く物を選んで交換できる
                if (isInventoryFull(p)) {
                    entries.push({
                        label: `${name}と 入れ替える`,
                        color: UI.cursorEdge,
                        desc: '手持ちから 1 つ 置いて、足元の物と 交換します。',
                        onSelect: () => {
                            this.openSwapMenu(floorItem.item);
                            return false;
                        },
                    });
                }
            }
        }
        if (onStairs(world)) {
            entries.push({
                label: '階段を 降りる',
                color: UI.cursorEdge,
                onSelect: () => {
                    this.tryStairs();
                    return true;
                },
            });
        }
        if (tile?.trap && tile.trap.revealed && !tile.trap.used) {
            const trap = getTrap(tile.trap.defId);
            entries.push({
                label: `${trap.name}`,
                right: 'ワナ',
                disabled: true,
                desc: trap.desc,
            });
        }
        const debt = shopDebt(world);
        if (debt > 0) {
            entries.push({
                label: `${debt}ギタン 支払う`,
                color: UI.gitan,
                disabled: p.gitan < debt,
                onSelect: () => {
                    payDebt(world);
                    this.pumpEvents();
                    return true;
                },
            });
        }
        entries.push({
            label: '足踏みして 休む',
            onSelect: () => {
                this.doRest();
                return true;
            },
        });
        this.menus.push(new ListMenu({
            title: '足元',
            entries,
            rect: { x: 420, y: 240, w: 440, h: 80 + entries.length * 40 },
            rowH: 40,
            emptyText: '足元には 何も無い',
        }));
    }
    openSpecialMenu() {
        const world = this.world;
        const entries = [
            {
                label: '休む（HP が回復するまで足踏み）',
                onSelect: () => {
                    this.doRest();
                    return true;
                },
            },
            {
                label: 'ギタンを 投げる',
                right: `${world.player.gitan} G`,
                disabled: world.player.gitan <= 0,
                desc: '所持金を 投げつける。額が大きいほど よく効く。当たると 消える。',
                onSelect: () => {
                    const max = world.player.gitan;
                    this.qtyPicker = new QuantityPicker('何ギタン 投げますか？', 1, max, Math.min(max, 100), (n) => {
                        this.dirPicker = new DirectionPicker(`${n}ギタンを どの向きへ？`, world.player.dir, (dir) => {
                            throwGitan(world, n, dir);
                            this.pumpEvents();
                            this.menus.closeAll();
                        }, () => { });
                    }, () => { });
                    return true;
                },
            },
            {
                label: 'アイテムに 名前をつける',
                onSelect: () => {
                    this.openNamingMenu();
                    return false;
                },
            },
            {
                label: 'これまでの できごと',
                onSelect: () => {
                    this.menus.closeAll();
                    this.overlay = 'log';
                    this.logScroll = 9999;
                    return true;
                },
            },
            {
                label: '操作の ヘルプ',
                onSelect: () => {
                    this.menus.closeAll();
                    this.overlay = 'help';
                    return true;
                },
            },
        ];
        this.menus.push(new ListMenu({
            title: '特殊',
            entries,
            rect: { x: 380, y: 220, w: 520, h: 80 + entries.length * 42 },
            rowH: 42,
        }));
    }
    /** 未識別アイテムに自分でメモを付ける */
    openNamingMenu() {
        const world = this.world;
        const candidates = world.player.inventory.filter((i) => isUnknownKind(getItem(i.defId).kind) && !world.run.identify.known[i.defId]);
        const presets = ['？', '当たり', 'ハズレ', '危険', '保留', '眠り', '混乱', '毒'];
        const entries = candidates.map((item) => ({
            label: itemName(item, world.run.identify),
            right: world.run.identify.nicknames[item.defId] ?? '',
            onSelect: () => {
                const cur = world.run.identify.nicknames[item.defId];
                const idx = cur ? (presets.indexOf(cur) + 1) % (presets.length + 1) : 0;
                if (idx >= presets.length)
                    delete world.run.identify.nicknames[item.defId];
                else
                    world.run.identify.nicknames[item.defId] = presets[idx];
                this.app.audio.play('cursor');
                return false;
            },
        }));
        this.menus.push(new ListMenu({
            title: '名前をつける（決定で切り替え）',
            entries,
            rect: { x: 360, y: 180, w: 560, h: 420 },
            emptyText: '未識別の アイテムが 無い',
        }));
    }
    openTacticsMenu() {
        const tactics = [
            { label: 'いっしょに いこう', value: 'follow' },
            { label: '自由に してろ', value: 'free' },
            { label: 'ここを 動くな', value: 'stay' },
            { label: '戦わないで', value: 'avoid' },
        ];
        this.menus.push(new ListMenu({
            title: '作戦',
            entries: tactics.map((t) => ({
                label: t.label,
                onSelect: () => {
                    this.act({ type: 'setTactic', tactic: t.value });
                    return true;
                },
            })),
            rect: { x: 440, y: 260, w: 400, h: 80 + tactics.length * 42 },
            rowH: 42,
            emptyText: '仲間が いない',
        }));
    }
    openSettingsMenu() {
        const s = this.app.settings;
        const speedLabel = ['速い', 'ふつう', 'ゆっくり'];
        const animLabel = ['瞬間', '速い', 'ふつう'];
        const rebuild = () => {
            const menu = this.menus.top;
            if (menu)
                menu.setEntries(build());
        };
        const build = () => [
            {
                label: 'メッセージ速度',
                right: speedLabel[s.messageSpeed],
                onSelect: () => {
                    s.messageSpeed = (s.messageSpeed + 1) % 3;
                    this.applySettings();
                    rebuild();
                    return false;
                },
            },
            {
                label: 'アニメーション',
                right: animLabel[s.animSpeed],
                onSelect: () => {
                    s.animSpeed = (s.animSpeed + 1) % 3;
                    this.applySettings();
                    rebuild();
                    return false;
                },
            },
            {
                label: '斜め移動',
                right: s.diagonalFree ? '2キー同時' : 'テンキーのみ',
                onSelect: () => {
                    s.diagonalFree = !s.diagonalFree;
                    this.applySettings();
                    rebuild();
                    return false;
                },
            },
            {
                label: '階段で 確認する',
                right: s.confirmStairs ? 'する' : 'しない',
                onSelect: () => {
                    s.confirmStairs = !s.confirmStairs;
                    rebuild();
                    return false;
                },
            },
            {
                label: '画面のゆれ',
                right: s.reduceMotion ? 'なし' : 'あり',
                onSelect: () => {
                    s.reduceMotion = !s.reduceMotion;
                    this.applySettings();
                    rebuild();
                    return false;
                },
            },
            {
                label: '音量（全体）',
                right: `${Math.round(s.masterVolume * 100)}%`,
                onSelect: () => {
                    s.masterVolume = s.masterVolume >= 1 ? 0 : Math.min(1, s.masterVolume + 0.1);
                    this.app.applySettings();
                    rebuild();
                    return false;
                },
            },
            {
                label: '効果音',
                right: `${Math.round(s.sfxVolume * 100)}%`,
                onSelect: () => {
                    s.sfxVolume = s.sfxVolume >= 1 ? 0 : Math.min(1, s.sfxVolume + 0.1);
                    this.app.applySettings();
                    this.app.audio.play('cursor');
                    rebuild();
                    return false;
                },
            },
            {
                label: 'BGM',
                right: `${Math.round(s.bgmVolume * 100)}%`,
                onSelect: () => {
                    s.bgmVolume = s.bgmVolume >= 1 ? 0 : Math.min(1, s.bgmVolume + 0.1);
                    this.app.applySettings();
                    rebuild();
                    return false;
                },
            },
        ];
        this.menus.push(new ListMenu({
            title: '設定',
            entries: build(),
            rect: { x: 400, y: 150, w: 480, h: 440 },
            rowH: 44,
            onClose: () => this.app.persist(),
        }));
    }
    tryStairs() {
        const world = this.world;
        if (!onStairs(world)) {
            world.log('ここには 階段が ない。');
            this.pumpEvents();
            return;
        }
        const bottom = world.atBottom;
        const go = () => {
            this.menus.closeAll();
            this.act({ type: 'stairs' });
        };
        if (!this.app.settings.confirmStairs && !bottom) {
            go();
            return;
        }
        this.dialog = new ConfirmDialog({
            message: bottom
                ? 'この階段を 降りると ダンジョンを 踏破します。よろしいですか？'
                : '階段を 降りますか？',
            defaultYes: true,
            onYes: go,
        });
    }
    /**
     * 数字キー 1〜9 のショートカット。
     *
     * 以前は「持ち物の N 番目」を直接指していたが、どこに何があるかは
     * 覚えていられないし、並べ替えると全部ずれる。
     * 割り当てた物を画面に出し、道具の種類で指すようにした。
     */
    useShortcut(index) {
        const p = this.world.player;
        if (index < 1 || index > SHORTCUT_SLOTS)
            return;
        const slot = shortcutSlots(p)[index - 1];
        if (!slot.defId) {
            this.world.log(`${index} には 何も 割り当てていない。道具から「${SHORTCUT_LABEL}」で 登録できる。`);
            this.pumpEvents();
            return;
        }
        const item = slot.item;
        if (!item) {
            this.world.log(`${getItem(slot.defId).name}を 切らしている。`, 'warning');
            this.pumpEvents();
            return;
        }
        const def = getItem(item.defId);
        if (def.kind === 'weapon' || def.kind === 'shield' || def.kind === 'bracelet') {
            this.act({ type: isEquipped(p, item.uid) ? 'unequip' : 'equip', uid: item.uid });
            return;
        }
        // 投げる物（矢・石など）は、向きを聞かずに今の向きへ投げる。
        // ショートカットの値打ちは「1 手で撃てる」ことなので、ここで止めない
        if (isThrowable(def)) {
            this.act({ type: 'throw', uid: item.uid, dir: p.dir });
            return;
        }
        this.startUseItem(item);
    }
    // ------------------------------------------------------------ 描画
    draw(g, now) {
        const world = this.world;
        const theme = world.dungeon.theme;
        g.fillStyle = theme.gloom;
        g.fillRect(0, 0, SCREEN_W, SCREEN_H);
        g.save();
        g.translate(Math.round(this.fx.shakeX), Math.round(this.fx.shakeY));
        const ctx = {
            map: world.map, theme, camera: this.camera, fx: this.fx, time: now,
        };
        this.renderer.drawTerrain(g, ctx);
        this.renderer.drawGround(g, ctx, world.run.floorItems.map((f) => ({
            pos: f.pos,
            sprite: spriteOfItem(f.item),
            shopPrice: f.item.shopPrice,
        })));
        // アクターは y 座標順に描いて前後関係を出す
        const actors = world.allActors()
            .filter((a) => a.alive || (this.fx.views.get(a.id)?.fade ?? 0) > 0)
            .sort((a, b) => a.pos.y - b.pos.y);
        for (const a of actors) {
            const tile = at(world.map, a.pos.x, a.pos.y);
            if (a.kind !== 'player' && !tile?.visible)
                continue;
            const view = this.fx.view(a.id, a.pos);
            if (a.kind === 'player') {
                this.renderer.drawActor(g, ctx, view, `player${a.dir}`, {
                    invisible: world.hasStatus(a, 'invisible'),
                });
            }
            else {
                const def = world.defOf(a);
                // 化けているミミックはアイテムに見せる
                const spriteId = a.disguise ? spriteOfItem(a.disguise) : a.defId;
                this.renderer.drawActor(g, ctx, view, spriteId, {
                    asleep: a.asleep,
                    invisible: world.hasStatus(a, 'invisible'),
                    boss: def.isBoss,
                    tint: a.kind === 'ally' ? '#6ee06e' : undefined,
                });
            }
        }
        this.renderer.drawEffects(g, ctx);
        g.restore();
        this.renderer.drawScreenFx(g, this.fx);
        // HUD
        const frame = theme.accent;
        this.app.log.draw(g, now);
        const bracelet = equippedBracelet(world.player);
        const braceletEffect = bracelet ? world.braceletEffectOf(world.player) : null;
        drawMinimap(g, {
            map: world.map,
            player: world.player,
            monsters: world.run.monsters,
            allies: world.run.allies,
            items: world.run.floorItems,
            seeMonsters: braceletEffect === 'seeMonsters',
            seeItems: braceletEffect === 'seeTraps',
        }, this.minimapMode, frame);
        this.hud.draw(g, world.player, {
            dungeonName: world.dungeon.name,
            depth: world.run.depth,
            turn: world.run.totalTurn,
            windy: world.dungeon.windTurns > 0 && world.run.windLeft <= 30 && world.run.windLeft > 0,
            bottom: world.atBottom,
            shortcuts: shortcutSlots(world.player).map((s) => ({
                defId: s.defId,
                label: s.item
                    ? itemName(s.item, world.run.identify, { withDetail: false, withCount: false })
                    : s.defId ? shortUnknownName(s.defId, world) : '',
                sprite: s.item ? spriteOfItem(s.item) : (s.defId ? getItem(s.defId).sprite : null),
                count: s.count,
            })),
        }, frame);
        // 斜め固定・向き変更のバッジ
        const px = world.player.pos.x * TILE - this.camera.x + TILE / 2;
        const py = world.player.pos.y * TILE - this.camera.y + TILE / 2;
        if (this.app.input.isDown(Cmd.L)) {
            drawBadgeAt(g, '斜め', px, py + TILE);
        }
        if (this.app.input.isDown(Cmd.R)) {
            drawBadgeAt(g, '向き', px, py + TILE);
        }
        if (this.dashDir !== null) {
            drawBadgeAt(g, 'ダッシュ', px, py - TILE);
        }
        this.menus.draw(g, now, frame);
        if (this.dirPicker)
            this.dirPicker.draw(g, SCREEN_W, SCREEN_H, px, py);
        if (this.qtyPicker)
            this.qtyPicker.draw(g, SCREEN_W, SCREEN_H);
        if (this.dialog) {
            drawOverlay(g, SCREEN_W, SCREEN_H, 0.4);
            this.dialog.draw(g, SCREEN_W, SCREEN_H, now);
        }
        // 全体図（Tab を押している間、またはメニューから）
        if (this.app.input.isDown(Cmd.Map) || this.showFullMapOnce) {
            drawFullMap(g, {
                map: world.map,
                player: world.player,
                monsters: world.run.monsters,
                allies: world.run.allies,
                items: world.run.floorItems,
            });
        }
        if (this.overlay === 'log') {
            const max = this.app.log.drawHistory(g, SCREEN_W, SCREEN_H, this.logScroll);
            this.logScroll = Math.max(0, Math.min(max, this.logScroll));
        }
        else if (this.overlay === 'help') {
            drawHelp(g, SCREEN_W, SCREEN_H);
        }
    }
}
function drawBadgeAt(g, text, x, y) {
    drawText(g, text, x, y, {
        size: 14, align: 'center', bold: true,
        color: UI.cursorEdge, outline: '#000', outlineWidth: 4,
    });
}
/** 未識別になるカテゴリか */
const isUnknownKind = (kind) => kind === 'herb' || kind === 'scroll' || kind === 'staff'
    || kind === 'pot' || kind === 'bracelet';
/** アイテムのスプライト id（個別の絵が無ければカテゴリ共通に落ちる） */
/** 切らしている枠に出す名前。未識別なら仮名のまま */
function shortUnknownName(defId, world) {
    const def = getItem(defId);
    if (!isUnknownKind(def.kind))
        return def.name;
    if (world.run.identify.known[defId])
        return def.name;
    return world.run.identify.alias[defId] ?? def.name;
}
function spriteOfItem(item) {
    const def = getItem(item.defId);
    // 未識別のカテゴリは見た目で中身が分からないようにする
    return isUnknownKind(def.kind) ? def.sprite : item.defId;
}
//# sourceMappingURL=dungeon.js.map