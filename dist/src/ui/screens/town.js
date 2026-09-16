/**
 * 風の村。冒険の支度をする画面。
 */
import { Cmd } from '../../core/input.js';
import { getItem } from '../../data/registry.js';
import { BENTOU_PRICE, SMITH_PRICE, buyFromTown, depositItem, dungeonList, sellToTown, shopStock, smithTemper, smithUncurse, sortStorage, storageFull, withdrawItem, } from '../../game/town.js';
import { itemName, kindLabel } from '../../game/naming.js';
import { SELL_RATE } from '../../game/rules.js';
import { drawPanel, drawText, drawOverlay } from '../draw.js';
import { ConfirmDialog, ListMenu, MenuStack } from '../menu.js';
import { SCREEN_H, SCREEN_W, UI } from '../theme.js';
export class TownScreen {
    app;
    onEnterDungeon;
    onTitle;
    id = 'town';
    menus = new MenuStack();
    dialog = null;
    place = 'plaza';
    notice = '';
    noticeLife = 0;
    stock = [];
    /** 持ち込むアイテムとして選んだもの */
    bring = [];
    time = 0;
    constructor(app, onEnterDungeon, onTitle) {
        this.app = app;
        this.onEnterDungeon = onEnterDungeon;
        this.onTitle = onTitle;
    }
    enter() {
        this.app.audio.playBgm('town');
        this.stock = shopStock(this.app.town);
        this.bring = [];
        this.openPlaza();
    }
    say(text) {
        this.notice = text;
        this.noticeLife = 2600;
    }
    // ------------------------------------------------------------ 広場
    openPlaza() {
        this.place = 'plaza';
        this.menus.closeAll();
        const entries = [
            {
                label: 'ダンジョンへ 行く',
                color: UI.cursorEdge,
                desc: '支度ができたら、いざ出発。',
                onSelect: () => {
                    this.openGate();
                    return false;
                },
            },
            {
                label: '倉庫',
                desc: '道具を 預ける・引き出す。倒れても 倉庫の物は 失われない。',
                onSelect: () => {
                    this.openStorage();
                    return false;
                },
            },
            {
                label: '道具屋',
                desc: '道具を 買う・売る。',
                onSelect: () => {
                    this.openShop();
                    return false;
                },
            },
            {
                label: '鍛冶屋',
                desc: '装備を 鍛える・呪いを 解く。',
                onSelect: () => {
                    this.openSmith();
                    return false;
                },
            },
            {
                label: '食事処',
                desc: `弁当を 食べて 最大満腹度を 上げる（${BENTOU_PRICE}ギタン）。`,
                onSelect: () => {
                    this.openDiner();
                    return false;
                },
            },
            {
                label: '冒険の 記録',
                desc: 'これまでの 冒険を 振り返る。',
                onSelect: () => {
                    this.place = 'records';
                    return false;
                },
            },
            {
                label: '名前を 変える',
                right: this.app.town.playerName,
                desc: '風来人の 名前を 変えます。',
                onSelect: () => {
                    this.changeName();
                    return false;
                },
            },
            {
                label: 'タイトルへ 戻る',
                color: UI.textDim,
                onSelect: () => {
                    this.app.persist();
                    this.onTitle();
                    return true;
                },
            },
        ];
        this.menus.push(new ListMenu({
            title: '風の村',
            entries,
            rect: { x: 90, y: 150, w: 400, h: 60 + entries.length * 46 },
            rowH: 46,
            showDesc: false,
            closable: false,
        }));
    }
    /** 名前の変更。候補から選ぶか、自分で打ち込む */
    changeName() {
        const presets = ['ナギ', 'シズカ', 'カゲロウ', 'ツムギ', 'ハヤテ', 'ミコト', 'リク', 'アオイ'];
        const entries = presets.map((name) => ({
            label: name,
            onSelect: () => {
                this.app.town.playerName = name;
                this.app.persist();
                this.say(`これからは ${name} と 名乗ります。`);
                return true;
            },
        }));
        entries.push({
            label: '自分で 入力する',
            color: UI.cursorEdge,
            onSelect: () => {
                const typed = window.prompt('名前を 入力してください（12 文字まで）', this.app.town.playerName);
                if (typed && typed.trim().length > 0) {
                    this.app.town.playerName = typed.trim().slice(0, 12);
                    this.app.persist();
                    this.say(`これからは ${this.app.town.playerName} と 名乗ります。`);
                }
                return true;
            },
        });
        this.menus.push(new ListMenu({
            title: '名前を 変える',
            entries,
            rect: { x: 460, y: 160, w: 360, h: 60 + entries.length * 40 },
            rowH: 40,
        }));
    }
    // ------------------------------------------------------------ ダンジョン選択
    openGate() {
        this.place = 'gate';
        const list = dungeonList(this.app.town);
        const entries = list.map(({ def, unlocked, cleared, best }) => ({
            label: unlocked ? def.name : '？？？',
            right: unlocked
                ? (cleared ? 'クリア済' : best > 0 ? `最高 ${best}F` : `全 ${def.depth}F`)
                : '未開放',
            disabled: !unlocked,
            color: cleared ? UI.good : undefined,
            desc: unlocked
                ? `${def.subtitle}\n${def.desc}`
                : '前のダンジョンを クリアすると 開放される。',
            onSelect: () => {
                if (!unlocked)
                    return false;
                this.confirmEnter(def.id, def.allowBring);
                return false;
            },
        }));
        this.menus.push(new ListMenu({
            title: 'どのダンジョンへ？',
            entries,
            rect: { x: 340, y: 120, w: 620, h: 420 },
            rowH: 48,
            showDesc: true,
        }));
    }
    confirmEnter(dungeonId, allowBring) {
        if (!allowBring) {
            this.dialog = new ConfirmDialog({
                message: 'このダンジョンには 何も 持ち込めません。\n'
                    + 'レベルも 1 に 戻ります。それでも 潜りますか？',
                defaultYes: false,
                onYes: () => {
                    this.app.persist();
                    this.onEnterDungeon(dungeonId, []);
                },
            });
            return;
        }
        this.openBringMenu(dungeonId);
    }
    /** 倉庫から持ち込む物を選ぶ */
    openBringMenu(dungeonId) {
        const town = this.app.town;
        const rebuild = () => {
            const menu = this.menus.top;
            if (menu)
                menu.setEntries(build());
        };
        const build = () => {
            const entries = town.storage.map((item) => {
                const picked = this.bring.includes(item);
                return {
                    label: itemName(item, EMPTY_IDENTIFY, { revealAll: true }),
                    right: picked ? '持っていく' : kindLabel(getItem(item.defId).kind),
                    color: picked ? UI.cursorEdge : undefined,
                    desc: getItem(item.defId).desc,
                    onSelect: () => {
                        if (picked)
                            this.bring = this.bring.filter((i) => i !== item);
                        else if (this.bring.length < 20)
                            this.bring.push(item);
                        else
                            this.say('持ち込めるのは 20 個までです。');
                        this.app.audio.play('cursor');
                        rebuild();
                        return false;
                    },
                };
            });
            entries.unshift({
                label: `▶ この ${this.bring.length} 個を 持って 出発する`,
                color: UI.good,
                desc: 'いま選んでいる道具だけを持って ダンジョンへ 向かいます。',
                onSelect: () => {
                    const taken = this.bring.slice();
                    for (const item of taken)
                        withdrawItem(town, item.uid);
                    this.app.persist();
                    this.onEnterDungeon(dungeonId, taken);
                    return true;
                },
            });
            return entries;
        };
        this.menus.push(new ListMenu({
            title: '何を 持っていく？（決定で 選ぶ／外す）',
            entries: build(),
            rect: { x: 300, y: 90, w: 640, h: 500 },
            showDesc: true,
            emptyText: '倉庫は 空っぽ',
        }));
    }
    // ------------------------------------------------------------ 倉庫
    openStorage() {
        this.place = 'storage';
        const town = this.app.town;
        sortStorage(town);
        const entries = town.storage.map((item) => ({
            label: itemName(item, EMPTY_IDENTIFY, { revealAll: true }),
            right: kindLabel(getItem(item.defId).kind),
            desc: getItem(item.defId).desc,
            data: item,
        }));
        this.menus.push(new ListMenu({
            title: `倉庫　${town.storage.length} / 80`,
            entries,
            rect: { x: 300, y: 90, w: 640, h: 500 },
            showDesc: true,
            emptyText: '倉庫は 空っぽ',
        }));
    }
    // ------------------------------------------------------------ 道具屋
    openShop() {
        this.place = 'shop';
        const rebuild = () => {
            const menu = this.menus.top;
            if (menu)
                menu.setEntries(buildBuy());
        };
        const buildBuy = () => this.stock.map((item) => {
            const price = item.shopPrice;
            return {
                label: itemName(item, EMPTY_IDENTIFY, { revealAll: true }),
                right: `${price} G`,
                disabled: this.app.town.gitan < price || storageFull(this.app.town),
                desc: getItem(item.defId).desc,
                onSelect: () => {
                    if (buyFromTown(this.app.town, item)) {
                        this.stock = this.stock.filter((i) => i !== item);
                        this.say(`${itemName(item, EMPTY_IDENTIFY, { revealAll: true })}を 買った。`);
                        this.app.audio.play('buy');
                        this.app.persist();
                        rebuild();
                    }
                    else {
                        this.say('ギタンが 足りないか、倉庫が いっぱいです。');
                        this.app.audio.play('error');
                    }
                    return false;
                },
            };
        });
        const entries = [
            {
                label: '買う',
                onSelect: () => {
                    this.menus.push(new ListMenu({
                        title: `買う（所持 ${this.app.town.gitan} ギタン）`,
                        entries: buildBuy(),
                        rect: { x: 340, y: 110, w: 600, h: 440 },
                        showDesc: true,
                        emptyText: '売り切れです',
                    }));
                    return false;
                },
            },
            {
                label: '売る',
                onSelect: () => {
                    this.openSellMenu();
                    return false;
                },
            },
        ];
        this.menus.push(new ListMenu({
            title: '道具屋',
            entries,
            rect: { x: 480, y: 250, w: 320, h: 160 },
            rowH: 46,
        }));
    }
    openSellMenu() {
        const town = this.app.town;
        const rebuild = () => {
            const menu = this.menus.top;
            if (menu)
                menu.setEntries(build());
        };
        const build = () => town.storage.map((item) => {
            const price = Math.max(1, Math.floor(getItem(item.defId).price * SELL_RATE * (item.count || 1)));
            return {
                label: itemName(item, EMPTY_IDENTIFY, { revealAll: true }),
                right: `${price} G`,
                desc: getItem(item.defId).desc,
                onSelect: () => {
                    const got = sellToTown(town, item.uid);
                    this.say(`${got} ギタンに なった。`);
                    this.app.audio.play('gitan');
                    this.app.persist();
                    rebuild();
                    return false;
                },
            };
        });
        this.menus.push(new ListMenu({
            title: '何を 売る？',
            entries: build(),
            rect: { x: 340, y: 110, w: 600, h: 440 },
            showDesc: true,
            emptyText: '売る物が ありません',
        }));
    }
    // ------------------------------------------------------------ 鍛冶屋
    openSmith() {
        this.place = 'smith';
        const town = this.app.town;
        const equipment = () => town.storage.filter((i) => {
            const k = getItem(i.defId).kind;
            return k === 'weapon' || k === 'shield';
        });
        const entries = [
            {
                label: '鍛える（修正値 +1）',
                desc: '装備の修正値を 1 上げる。上がるほど 高くつく。',
                onSelect: () => {
                    const rebuild = () => {
                        const menu = this.menus.top;
                        if (menu)
                            menu.setEntries(build());
                    };
                    const build = () => equipment().map((item) => {
                        const cost = SMITH_PRICE.temper(item.plus);
                        return {
                            label: itemName(item, EMPTY_IDENTIFY, { revealAll: true }),
                            right: `${cost} G`,
                            disabled: town.gitan < cost,
                            desc: getItem(item.defId).desc,
                            onSelect: () => {
                                if (smithTemper(town, item.uid)) {
                                    this.say('打ち直した。強くなった！');
                                    this.app.audio.play('synthesis');
                                    this.app.persist();
                                    rebuild();
                                }
                                else {
                                    this.say('ギタンが 足りません。');
                                    this.app.audio.play('error');
                                }
                                return false;
                            },
                        };
                    });
                    this.menus.push(new ListMenu({
                        title: `鍛える（所持 ${town.gitan} ギタン）`,
                        entries: build(),
                        rect: { x: 340, y: 110, w: 600, h: 440 },
                        showDesc: true,
                        emptyText: '鍛えられる 装備が ありません',
                    }));
                    return false;
                },
            },
            {
                label: `呪いを 解く（${SMITH_PRICE.uncurse} ギタン）`,
                desc: '呪われた装備の 呪いを 解く。',
                onSelect: () => {
                    const cursed = town.storage.filter((i) => i.cursed);
                    this.menus.push(new ListMenu({
                        title: '呪いを 解く',
                        entries: cursed.map((item) => ({
                            label: itemName(item, EMPTY_IDENTIFY, { revealAll: true }),
                            right: `${SMITH_PRICE.uncurse} G`,
                            disabled: town.gitan < SMITH_PRICE.uncurse,
                            onSelect: () => {
                                if (smithUncurse(town, item.uid)) {
                                    this.say('呪いが 解けた。');
                                    this.app.audio.play('identify');
                                    this.app.persist();
                                }
                                return true;
                            },
                        })),
                        rect: { x: 360, y: 160, w: 560, h: 380 },
                        emptyText: '呪われた 物は ありません',
                    }));
                    return false;
                },
            },
        ];
        this.menus.push(new ListMenu({
            title: '鍛冶屋',
            entries,
            rect: { x: 420, y: 230, w: 440, h: 180 },
            rowH: 46,
            showDesc: false,
        }));
    }
    // ------------------------------------------------------------ 食事処
    openDiner() {
        this.place = 'diner';
        const town = this.app.town;
        this.menus.push(new ListMenu({
            title: '食事処',
            entries: [
                {
                    label: `風の村の弁当（${BENTOU_PRICE} ギタン）`,
                    disabled: town.gitan < BENTOU_PRICE || storageFull(town),
                    desc: '次の冒険に 持っていける 弁当。食べると 最大満腹度が 2 増える。',
                    onSelect: () => {
                        if (town.gitan < BENTOU_PRICE) {
                            this.say('ギタンが 足りません。');
                            return false;
                        }
                        town.gitan -= BENTOU_PRICE;
                        const item = makeBentou(() => town.nextUid++);
                        depositItem(town, item);
                        this.say('弁当を 倉庫へ 入れました。');
                        this.app.audio.play('buy');
                        this.app.persist();
                        return true;
                    },
                },
            ],
            rect: { x: 400, y: 260, w: 480, h: 150 },
            rowH: 46,
            showDesc: true,
        }));
    }
    // ------------------------------------------------------------ 更新と描画
    update(dt, now) {
        this.time = now;
        if (this.noticeLife > 0)
            this.noticeLife -= dt;
        const input = this.app.input;
        if (this.dialog) {
            if (this.dialog.handleInput(input))
                this.dialog = null;
            return;
        }
        if (this.place === 'records') {
            if (input.justPressed(Cmd.B) || input.justPressed(Cmd.X) || input.justPressed(Cmd.A)) {
                this.place = 'plaza';
            }
            return;
        }
        const wasDepth = this.menus.depth;
        this.menus.handleInput(input);
        // 広場のメニューまで戻ったら、他の建物から出たことにする
        if (this.menus.depth === 1 && wasDepth > 1)
            this.place = 'plaza';
        if (this.menus.depth === 0)
            this.openPlaza();
    }
    draw(g, now) {
        // 背景: 夜の村
        const grad = g.createLinearGradient(0, 0, 0, SCREEN_H);
        grad.addColorStop(0, '#0d1018');
        grad.addColorStop(0.55, '#141a24');
        grad.addColorStop(1, '#1b1410');
        g.fillStyle = grad;
        g.fillRect(0, 0, SCREEN_W, SCREEN_H);
        // 遠くの塔
        g.save();
        g.fillStyle = '#0a0c12';
        g.fillRect(SCREEN_W - 260, 120, 70, SCREEN_H - 300);
        g.beginPath();
        g.moveTo(SCREEN_W - 270, 120);
        g.lineTo(SCREEN_W - 225, 40);
        g.lineTo(SCREEN_W - 180, 120);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(205,187,122,0.35)';
        for (let i = 0; i < 5; i++) {
            g.fillRect(SCREEN_W - 248, 170 + i * 80, 12, 16);
        }
        g.restore();
        // 家々の灯り
        g.save();
        for (let i = 0; i < 6; i++) {
            const x = 60 + i * 180;
            const y = SCREEN_H - 200 - (i % 2) * 40;
            g.fillStyle = '#161219';
            g.fillRect(x, y, 130, 150);
            g.fillStyle = '#231a20';
            g.beginPath();
            g.moveTo(x - 12, y);
            g.lineTo(x + 65, y - 46);
            g.lineTo(x + 142, y);
            g.closePath();
            g.fill();
            const flicker = 0.55 + 0.12 * Math.sin(now / 420 + i * 1.7);
            g.fillStyle = `rgba(255,200,110,${flicker.toFixed(2)})`;
            g.fillRect(x + 42, y + 40, 44, 40);
        }
        g.restore();
        drawText(g, '風の村', 90, 96, {
            size: 40, bold: true, color: '#e8dcae', outline: '#12100a', outlineWidth: 6,
        });
        drawText(g, `所持ギタン ${this.app.town.gitan.toLocaleString('ja-JP')}　`
            + `倉庫 ${this.app.town.storage.length}/80`, 92, 128, {
            size: 16, color: UI.textDim,
        });
        if (this.place === 'records') {
            this.drawRecords(g);
        }
        else {
            this.menus.draw(g, now);
        }
        if (this.noticeLife > 0) {
            const r = { x: SCREEN_W / 2 - 240, y: SCREEN_H - 110, w: 480, h: 52 };
            drawPanel(g, r, { alpha: Math.min(1, this.noticeLife / 400) });
            drawText(g, this.notice, r.x + r.w / 2, r.y + 33, {
                size: 17, align: 'center',
            });
        }
        if (this.dialog) {
            drawOverlay(g, SCREEN_W, SCREEN_H, 0.45);
            this.dialog.draw(g, SCREEN_W, SCREEN_H, now);
        }
        void this.time;
    }
    drawRecords(g) {
        const town = this.app.town;
        const r = { x: 200, y: 140, w: SCREEN_W - 400, h: SCREEN_H - 280 };
        drawPanel(g, r);
        drawText(g, '冒険の 記録', r.x + r.w / 2, r.y + 38, {
            size: 24, bold: true, align: 'center', color: UI.cursorEdge,
        });
        drawText(g, `潜った回数 ${town.totalRuns}　クリア ${town.cleared.length} / 6`, r.x + r.w / 2, r.y + 68, { size: 16, align: 'center', color: UI.textDim });
        const rows = town.history.slice(-10).reverse();
        rows.forEach((rec, i) => {
            const y = r.y + 110 + i * 30;
            drawText(g, rec.dungeonName, r.x + 40, y, { size: 16 });
            drawText(g, `${rec.depth}F`, r.x + 250, y, { size: 16, align: 'right' });
            drawText(g, `Lv${rec.level}`, r.x + 320, y, { size: 16, align: 'right' });
            drawText(g, rec.cleared ? 'クリア' : (rec.cause ?? '―'), r.x + 360, y, {
                size: 15, color: rec.cleared ? UI.good : UI.textDim,
            });
            drawText(g, `${rec.turns} ターン`, r.x + r.w - 40, y, {
                size: 14, align: 'right', color: UI.textDim,
            });
        });
        if (rows.length === 0) {
            drawText(g, 'まだ 記録が ありません。', r.x + r.w / 2, r.y + 160, {
                size: 17, align: 'center', color: UI.textDim,
            });
        }
        drawText(g, 'B で 戻る', r.x + r.w / 2, r.y + r.h - 24, {
            size: 15, align: 'center', color: UI.textDim,
        });
    }
}
/** 村では全部識別済みとして表示する */
const EMPTY_IDENTIFY = { alias: {}, known: {}, nicknames: {} };
function makeBentou(nextUid) {
    return {
        uid: nextUid(),
        defId: 'bentou',
        count: 1,
        plus: 0,
        runes: [],
        charges: 0,
        contents: [],
        cursed: false,
        plusKnown: true,
        shopPrice: 0,
        sealed: false,
    };
}
//# sourceMappingURL=town.js.map