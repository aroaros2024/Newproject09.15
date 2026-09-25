/**
 * 風の村。冒険の支度をする画面。
 */
import { Cmd } from '../../core/input.js';
import { DIR_VEC } from '../../core/geom.js';
import { itemInfoMenu } from './dungeon.js';
import { loadReplay } from '../../core/save.js';
import { copyPlayLog } from '../clipboard.js';
import { ALL_ITEMS, allMonsters, getDungeon, getItem, tryGetRune } from '../../data/registry.js';
import { iconKeyForCatalog } from '../art/items.js';
import { buildTownDiorama } from '../art/scenes/town.js';
import { DioramaView } from '../world/diorama.js';
import { SMITH_PRICE, buyFromTown, dungeonList, meltCharm, inventoryLimitFor, storageLimit, depositGitan, sellToTown, shopStock, smithEmbed, smithReforge, smithTemper, smithUncurse, sortStorage, storageFull, townIdentify, wearCharm, withdrawGitan, withdrawItem, } from '../../game/town.js';
import { itemDetail, itemName, kindLabel } from '../../game/naming.js';
import { collectionRate } from '../../game/town.js';
import { RARITY_COLOR, RARITY_LABEL, RARITY_RATE, prizesOf, } from '../../data/gacha.js';
import { tryGetPartner } from '../../data/partners.js';
import { KNOWABLE_ITEMS } from '../../data/items/all.js';
import { CHARM_BOX_LIMIT } from '../../data/charms.js';
import { CHARM_SHARE, activeBoosts, activeCharm, canPull, charmRoom, drawable, ownedCharms, ownedPartners, owns, prizeTotal, pull, stockLeft, } from '../../game/gacha.js';
import { charmName, charmRuneList, meltValue } from '../../game/charm.js';
import { Rng } from '../../core/rng.js';
import { partnerExpToNext, partnerLevelCap, partnerName } from '../../game/partner.js';
import { GACHA_COST, GACHA_COST_10, GACHA_EMPTY_GITAN } from '../../game/rules.js';
import { GachaAnim } from '../gachaAnim.js';
import { claimAll, claimMission, claimableCount, isClaimed, visibleMissions, } from '../../game/missions.js';
import { SELL_RATE } from '../../game/rules.js';
import { drawPanel, drawText, drawOverlay } from '../draw.js';
import { ConfirmDialog, ListMenu, MenuStack, QuantityPicker, } from '../menu.js';
import { SCREEN_H, SCREEN_W, UI } from '../theme.js';
export class TownScreen {
    app;
    onEnterDungeon;
    onTitle;
    id = 'town';
    menus = new MenuStack();
    /** 背景のジオラマ（初めて描く時に作る） */
    view = null;
    dialog = null;
    qty = null;
    place = 'plaza';
    notice = '';
    noticeLife = 0;
    stock = [];
    /** 持ち込むアイテムとして選んだもの */
    bring = [];
    /**
     * 村での表示に使う識別状態。
     *
     * 以前はここで revealAll していたため、村では「識別の巻物」と出るのに
     * 持ち込むと「ピヨリン巻物」に戻る、という食い違いが起きていた。
     * 村もダンジョンも、同じ「知っているかどうか」で表示する。
     */
    identify() {
        return townIdentify(this.app.town);
    }
    /** 正体を知らない物の説明は伏せる（名前だけ伏せても割れてしまう） */
    /** 説明欄。攻撃力・防御力・付いている印も出す（組み立ては naming.ts） */
    descOf(item) {
        return itemDetail(item, this.identify());
    }
    /** 保持の印が付いている倉庫の道具か */
    isKeptItem(item) {
        return (this.app.town.kept ?? []).includes(item.uid);
    }
    /**
     * 倉庫の一覧に「整理」を付ける。ダンジョンの持ち物と同じ F キー。
     *
     * 買った物・売った物・持ち帰った物は末尾に足されるので、
     * 開いた時に並べるだけでは足りない。
     */
    sortKey(rebuild) {
        return (input) => {
            if (!input.justPressed(Cmd.Y))
                return false;
            sortStorage(this.app.town);
            this.app.persist();
            rebuild();
            return true;
        };
    }
    /** 道具の「説明」。ダンジョンと同じ画面を村でも出す */
    showItemInfo(item) {
        this.menus.push(itemInfoMenu(item, this.identify()));
    }
    time = 0;
    anim = null;
    constructor(app, onEnterDungeon, onTitle) {
        this.app = app;
        this.onEnterDungeon = onEnterDungeon;
        this.onTitle = onTitle;
    }
    enter() {
        this.app.audio.playBgm('town');
        this.stock = shopStock(this.app.town);
        // 保持していた道具は、最初から「持っていく」側に入れておく。
        // 外さずに出発すれば保持も続く（startRun が付け直す）
        this.bring = this.app.town.storage.filter((i) => this.isKeptItem(i));
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
                label: '銀行',
                desc: () => `ギタンを 預ける・引き出す。預けたぶんは 倒れても 残る（預り ${this.app.town.bankGitan} G）。`,
                onSelect: () => {
                    this.openBank();
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
                label: '冒険の 記録',
                desc: 'これまでの 冒険を 振り返る。',
                onSelect: () => {
                    this.place = 'records';
                    return false;
                },
            },
            {
                label: 'ミッション',
                right: () => {
                    const n = claimableCount(this.app.town);
                    return n > 0 ? `受け取れる ${n}` : `石 ${this.app.town.stones ?? 0}`;
                },
                color: () => (claimableCount(this.app.town) > 0 ? UI.good : undefined),
                desc: '達成した ミッションの 石を 受け取る。',
                onSelect: () => {
                    this.openMissions();
                    return false;
                },
            },
            {
                label: 'ガチャ',
                right: () => `${this.app.town.stones ?? 0} 石`,
                desc: `石を 払って 引く（1 回 ${GACHA_COST} 石／10 連 ${GACHA_COST_10} 石）。`,
                onSelect: () => {
                    this.openGacha();
                    return false;
                },
            },
            {
                label: '護石',
                right: () => {
                    const n = (this.app.town.charms ?? []).length;
                    return n > 0 ? `${n} / ${CHARM_BOX_LIMIT}` : 'まだ 無い';
                },
                color: () => (charmRoom(this.app.town) <= 0 ? UI.warn : undefined),
                desc: '着ける 護石を 決める。打ち直しと 溶かすも ここから。',
                onSelect: () => {
                    this.openCharms();
                    return false;
                },
            },
            {
                label: '相棒',
                right: () => {
                    const list = ownedPartners(this.app.town);
                    return list.length > 0 ? `${list.length} 体` : 'まだ いない';
                },
                desc: '連れて行く 相棒を 決める。名前も 変えられる。',
                onSelect: () => {
                    this.openPartners();
                    return false;
                },
            },
            {
                label: '図鑑',
                right: () => {
                    const r = collectionRate(this.app.town);
                    return `${r.monsters + r.items} 種`;
                },
                desc: 'これまでに 出会った モンスターと 道具を 見る。',
                onSelect: () => {
                    this.openCollection();
                    return false;
                },
            },
            {
                label: '名前を 変える',
                right: () => this.app.town.playerName,
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
            title: '広場',
            entries,
            // 13 行 × 40px で y=700 に収まる（前は 46px で y=808 まで画面の外へはみ出していた）
            rect: { x: 56, y: 108, w: 420, h: 72 + entries.length * 40 },
            rowH: 40,
            showDesc: false,
            closable: false,
        }));
    }
    /** 図鑑。出会ったモンスターと道具を並べる */
    // ------------------------------------------------------------ ガチャ
    openGacha() {
        const town = this.app.town;
        const entries = [
            {
                label: '1 回 引く',
                right: `${GACHA_COST} 石`,
                color: () => (canPull(this.app.town, 1) ? UI.cursorEdge : undefined),
                disabled: !canPull(town, 1),
                desc: '石が 足りないと 引けません。',
                onSelect: () => {
                    this.rollGacha(1);
                    return false;
                },
            },
            {
                label: '10 回 引く',
                right: `${GACHA_COST_10} 石`,
                color: () => (canPull(this.app.town, 10) ? UI.cursorEdge : undefined),
                disabled: !canPull(town, 10),
                desc: 'SR 以上が 出なければ、10 回目は SR 以上になります。',
                onSelect: () => {
                    this.rollGacha(10);
                    return false;
                },
            },
            {
                label: '出るもの',
                desc: '景品と 確率を 見る。',
                onSelect: () => {
                    this.openGachaOdds();
                    return false;
                },
            },
        ];
        this.menus.push(new ListMenu({
            title: () => `ガチャ　所持 ${this.app.town.stones ?? 0} 石`,
            entries,
            rect: { x: 360, y: 200, w: 520, h: 230 },
            showDesc: true,
        }));
    }
    rollGacha(n) {
        const results = pull(this.app.town, n);
        if (results.length === 0) {
            this.say('石が 足りない。');
            return;
        }
        this.app.persist();
        this.anim = new GachaAnim(results, () => {
            this.anim = null;
            // 引いた結果でメニューの「引ける／引けない」が変わる
            this.menus.pop();
            this.openGacha();
        });
    }
    /**
     * 出るものと確率。
     *
     * 知識は 114 種あるが、1 行ずつ並べると 10 ページになり、
     * どの行も 1% 未満の同じ数字で情報にならない。種類ごとに 1 行へ畳む。
     * 護石は毎回その場で作るので、そもそも 1 行ずつ並べられない。
     * 「どれを持っているか」は図鑑と護石の画面で見る。
     */
    openGachaOdds() {
        const town = this.app.town;
        const entries = [];
        const room = charmRoom(town);
        for (const rarity of ['ssr', 'sr', 'r', 'n']) {
            const list = prizesOf(rarity);
            if (list.length === 0)
                continue;
            const total = list.reduce((a, p) => a + p.weight, 0);
            const left = drawable(town, rarity).length;
            // N と R は護石と分け合う。表が尽きた段は全部が護石になる
            const hasCharm = (rarity === 'n' || rarity === 'r') && room > 0;
            const charmShare = !hasCharm ? 0 : left === 0 ? 1 : CHARM_SHARE;
            const prizeRate = RARITY_RATE[rarity] * (1 - charmShare);
            entries.push({
                label: `${RARITY_LABEL[rarity]}　${RARITY_RATE[rarity]}%`,
                color: RARITY_COLOR[rarity],
                disabled: true,
                desc: `残り ${left} / ${list.length}。出たものは 二度と 出ません。`,
            });
            if (hasCharm) {
                entries.push({
                    label: '　護石',
                    right: `${(RARITY_RATE[rarity] * charmShare).toFixed(1)}%`,
                    desc: '毎回 その場で 作るので、尽きることが ありません。'
                        + '印と 空きスロットの 組み合わせは 9 万通り 以上 あります。',
                });
            }
            // 知識はまとめる。それ以外は 1 行ずつ
            const knowledge = list.filter((p) => p.boost?.t === 'knownItem');
            const others = list.filter((p) => p.boost?.t !== 'knownItem');
            for (const p of others) {
                const has = owns(town, p.id);
                entries.push({
                    label: `　${p.name}`,
                    right: `${(prizeRate * p.weight / total).toFixed(2)}%`,
                    color: has ? undefined : UI.textDim,
                    desc: has ? 'もう 出ました。' : 'まだ 出ていません。',
                });
            }
            if (knowledge.length > 0) {
                const got = knowledge.filter((p) => owns(town, p.id)).length;
                entries.push({
                    label: '　道具の 知識',
                    right: `1 つ ${(prizeRate / total).toFixed(2)}%`,
                    color: UI.textDim,
                    desc: `${knowledge.length} 種のうち ${got} 種 出ました。`
                        + '引くと その道具の 名前が 冒険の 最初から 見えます。',
                });
            }
        }
        this.menus.push(new ListMenu({
            title: () => {
                const left = stockLeft(this.app.town);
                const room = charmRoom(this.app.town);
                if (left > 0)
                    return `出るもの　表の景品 残り ${left} / ${prizeTotal()}`;
                if (room > 0)
                    return '出るもの　表の景品は 出きった。あとは 護石';
                return `出るものが 無い（1 回 ${GACHA_EMPTY_GITAN} ギタン）`;
            },
            entries,
            rect: { x: 300, y: 60, w: 580, h: 520 },
            rows: 12,
            showDesc: true,
        }));
    }
    // ------------------------------------------------------------ 護石
    /** 護石 1 つの説明。印の名前と効き目を並べる */
    /**
     * 護石の説明。印の名前だけでは何が起きるのか分からないので、効き目も出す。
     * 護石の印は 3 種類までなので、説明欄の 3 行に収まる。
     */
    charmDesc(c) {
        const lines = charmRuneList(c).map(({ id, level }) => {
            const def = tryGetRune(id);
            if (!def)
                return id;
            const head = level > 1 ? `${def.name} Lv${level}` : def.name;
            return `${head}　${def.desc}`;
        });
        if (c.slots > 0)
            lines.push(`空きスロット ${c.slots}`);
        return lines.join('\n');
    }
    /**
     * 護石の画面。
     *
     * 一覧は「着けているもの → 強い順」に並ぶ（ownedCharms）。
     * 30 個を目で比べられないと、厳選がただの作業になる。
     */
    openCharms() {
        const town = this.app.town;
        const entries = [];
        entries.push({
            label: '着けない',
            color: () => (activeCharm(this.app.town) ? undefined : UI.good),
            desc: '護石 無しで 潜る。',
            onSelect: () => {
                wearCharm(town, null);
                this.app.persist();
                this.say('護石を 外した。');
                return false;
            },
        });
        for (const c of ownedCharms(town)) {
            entries.push({
                label: () => charmName(c),
                sprite: 'charm',
                right: () => (this.app.town.activeCharm === c.uid ? '着けている' : ''),
                color: () => (this.app.town.activeCharm === c.uid ? UI.good : undefined),
                desc: () => this.charmDesc(c),
                onSelect: () => {
                    this.charmMenu(c);
                    return false;
                },
            });
        }
        if (charmRoom(town) <= 0) {
            entries.push({
                label: '（箱が いっぱい）',
                disabled: true,
                desc: '溶かして 空けるまで、ガチャから 護石は 出ません。',
            });
        }
        this.menus.push(new ListMenu({
            title: () => {
                const n = (this.app.town.charms ?? []).length;
                return `護石　${n} / ${CHARM_BOX_LIMIT}　所持 ${this.app.town.gitan} ギタン`;
            },
            entries,
            rect: { x: 300, y: 100, w: 620, h: 480 },
            rows: 9,
            showDesc: true,
            emptyText: 'まだ 護石が 無い',
        }));
    }
    charmMenu(c) {
        const town = this.app.town;
        const worn = () => this.app.town.activeCharm === c.uid;
        this.menus.push(new ListMenu({
            title: () => charmName(c),
            entries: [
                {
                    label: '着ける',
                    disabled: worn(),
                    desc: '次の 冒険から 印が 効く。真・もっと不思議では 効かない。',
                    onSelect: () => {
                        wearCharm(town, c.uid);
                        this.app.persist();
                        this.say(`${charmName(c)}を 着けた。`);
                        this.menus.pop();
                        this.menus.pop();
                        this.openCharms();
                        return false;
                    },
                },
                {
                    label: '打ち直す',
                    right: `${SMITH_PRICE.reforge} ギタン`,
                    disabled: town.gitan < SMITH_PRICE.reforge,
                    desc: '印を 1 つ 残して、残りを 振り直す。空きスロットも 振り直す。',
                    onSelect: () => {
                        this.reforgeMenu(c);
                        return false;
                    },
                },
                {
                    label: '溶かす',
                    right: () => `${meltValue(c)} ギタン`,
                    disabled: worn(),
                    desc: worn() ? '着けている 護石は 溶かせません。' : 'ギタンに 変わる。元には 戻せません。',
                    onSelect: () => {
                        const gain = meltCharm(town, c.uid);
                        if (gain <= 0)
                            return false;
                        this.app.persist();
                        this.say(`護石を 溶かして ${gain} ギタンに した。`);
                        this.menus.pop();
                        this.menus.pop();
                        this.openCharms();
                        return false;
                    },
                },
            ],
            rect: { x: 400, y: 230, w: 480, h: 220 },
            showDesc: true,
        }));
    }
    /** どの印を残して打ち直すかを選ぶ */
    reforgeMenu(c) {
        const town = this.app.town;
        const entries = charmRuneList(c).map(({ id, level }) => {
            const def = tryGetRune(id);
            return {
                label: level > 1 ? `${def?.name ?? id} Lv${level}` : (def?.name ?? id),
                desc: def?.desc ?? '',
                onSelect: () => {
                    if (!smithReforge(town, new Rng(`reforge:${town.playerName}:${town.gitan}:${c.uid}`), c.uid, id))
                        return false;
                    this.app.persist();
                    this.say(`打ち直した。${charmName(c)}`);
                    this.menus.pop();
                    this.menus.pop();
                    this.menus.pop();
                    this.openCharms();
                    return false;
                },
            };
        });
        entries.push({
            label: '何も 残さない',
            desc: '全部 振り直す。',
            onSelect: () => {
                if (!smithReforge(town, new Rng(`reforge:${town.playerName}:${town.gitan}:${c.uid}`), c.uid, null))
                    return false;
                this.app.persist();
                this.say(`打ち直した。${charmName(c)}`);
                this.menus.pop();
                this.menus.pop();
                this.menus.pop();
                this.openCharms();
                return false;
            },
        });
        this.menus.push(new ListMenu({
            title: '残す 印を 選ぶ',
            entries,
            rect: { x: 380, y: 220, w: 520, h: 280 },
            showDesc: true,
        }));
    }
    // ------------------------------------------------------------ 相棒
    openPartners() {
        const town = this.app.town;
        const list = ownedPartners(town);
        const entries = [];
        entries.push({
            label: '連れて行かない',
            color: () => (this.app.town.activePartner ? undefined : UI.good),
            desc: '1 人で 潜る。',
            onSelect: () => {
                town.activePartner = null;
                this.app.persist();
                this.say('相棒を 連れて行かないことにした。');
                return false;
            },
        });
        for (const rec of list) {
            const def = tryGetPartner(rec.id);
            const cap = partnerLevelCap();
            entries.push({
                label: () => partnerName(rec),
                sprite: def.baseId,
                right: () => `Lv ${rec.level} / ${cap}`,
                color: () => (this.app.town.activePartner === rec.id ? UI.good : undefined),
                desc: () => [
                    def.desc,
                    rec.level >= cap ? '上限' : `次の レベルまで ${partnerExpToNext(rec.level) - rec.exp}`,
                ].join('　'),
                onSelect: () => {
                    this.partnerMenu(rec);
                    return false;
                },
            });
        }
        this.menus.push(new ListMenu({
            title: '相棒',
            entries,
            rect: { x: 340, y: 120, w: 560, h: 440 },
            rows: 9,
            showDesc: true,
            emptyText: 'まだ 相棒が いない',
        }));
    }
    partnerMenu(rec) {
        const town = this.app.town;
        this.menus.push(new ListMenu({
            title: partnerName(rec),
            entries: [
                {
                    label: '連れて行く',
                    disabled: town.activePartner === rec.id,
                    desc: '次の 冒険から 最初に 付いてくる。',
                    onSelect: () => {
                        town.activePartner = rec.id;
                        this.app.persist();
                        this.say(`${partnerName(rec)}を 連れて行く。`);
                        this.menus.pop();
                        this.menus.pop();
                        this.openPartners();
                        return false;
                    },
                },
                {
                    label: '名前を 変える',
                    right: partnerName(rec),
                    desc: '8 文字まで。',
                    onSelect: () => {
                        this.renamePartner(rec);
                        return false;
                    },
                },
            ],
            rect: { x: 420, y: 250, w: 420, h: 170 },
            showDesc: true,
        }));
    }
    // ------------------------------------------------------------ ミッション
    /**
     * ミッションの入口。
     *
     * 100 個を 1 枚の一覧に流すと、自分がいまどれに近いのかが分からなくなる。
     * 「受け取れる」「あと少し」「区分ごと」「受け取り済み」に分けて、
     * 数字だけ見れば次にどこを開けばよいか分かるようにする。
     */
    /**
     * ミッション。
     *
     * 1 枚の一覧に 100 個を並べる。並びは visibleMissions が
     * 「受け取れる → 近い → 遠い → 受け取りずみ」にしてあるので、
     * いま自分に届くものが自然と上に来る。
     *
     * 行の表示は関数で渡す。受け取った瞬間にその行が「済」に変わり、
     * メニューを開き直さなくても数字が合う。
     */
    openMissions() {
        const town = this.app.town;
        const views = visibleMissions(town);
        const ready = () => views.filter((v) => !isClaimed(this.app.town, v.def.id) && v.done);
        const rateOf = (v) => (v.goal > 1 ? `${Math.min(v.progress, v.goal)} / ${v.goal}` : '');
        const entries = [
            {
                label: 'まとめて 受け取る',
                color: () => (ready().length > 0 ? UI.good : undefined),
                right: () => {
                    const r = ready();
                    return r.length > 0
                        ? `${r.length} 件　${r.reduce((a, v) => a + v.def.stones, 0)} 石`
                        : 'なし';
                },
                disabled: ready().length === 0,
                desc: '達成した ぶんを すべて 受け取ります。順番は 関係ありません。',
                onSelect: () => {
                    const got = claimAll(town);
                    if (got.stones <= 0)
                        return false;
                    this.app.persist();
                    this.say(`${got.ids.length} 件　${got.stones} 石を 受け取った。`);
                    return false;
                },
            },
        ];
        for (const v of views) {
            const claimed = () => isClaimed(this.app.town, v.def.id);
            entries.push({
                label: () => (claimed() ? `済　${v.def.name}` : v.def.name),
                right: () => (claimed() || v.done ? `${v.def.stones} 石` : rateOf(v)),
                color: () => (claimed() ? UI.textDim : v.done ? UI.good : undefined),
                disabled: claimed() || !v.done,
                desc: () => (claimed()
                    ? `受け取りずみ（${v.def.stones} 石）。`
                    : v.done
                        ? `達成。${v.def.stones} 石を 受け取れます。`
                        : `未達成${rateOf(v) ? `（${rateOf(v)}）` : ''}。`),
                onSelect: () => {
                    const got = claimMission(town, v.def.id);
                    if (got <= 0)
                        return false;
                    this.app.persist();
                    this.say(`${got} 石を 受け取った。`);
                    return false;
                },
            });
        }
        this.menus.push(new ListMenu({
            title: () => `ミッション　所持 ${this.app.town.stones ?? 0} 石`,
            entries,
            rect: { x: 280, y: 60, w: 620, h: 540 },
            rows: 12,
            showDesc: true,
            emptyText: '何も 無い',
        }));
    }
    openCollection() {
        const town = this.app.town;
        const rate = collectionRate(town);
        const entries = [
            {
                label: `モンスター　${rate.monsters} / ${rate.monstersTotal}`,
                color: UI.cursorEdge,
                onSelect: () => {
                    const rows = allMonsters()
                        .filter((m) => m.family !== 'shop')
                        .map((m) => {
                        const seen = !!town.seenMonsters[m.id];
                        return {
                            label: seen ? m.name : '？？？',
                            right: seen ? `Lv${m.level}` : '',
                            disabled: !seen,
                            sprite: seen ? m.id : undefined,
                            desc: seen
                                ? `${m.desc}\nHP ${m.hp}　攻撃 ${m.atk}　防御 ${m.def}　経験値 ${m.exp}`
                                : 'まだ 出会っていない。',
                        };
                    });
                    this.menus.push(new ListMenu({
                        title: 'モンスター図鑑',
                        entries: rows,
                        rect: { x: 300, y: 76, w: 580, h: 500 },
                        rows: 13,
                        showDesc: true,
                    }));
                    return false;
                },
            },
            {
                label: `道具　${rate.items} / ${rate.itemsTotal}`,
                color: UI.cursorEdge,
                onSelect: () => {
                    // ガチャで知識を引いた物は、出会っていなくても名前が分かる。
                    // 加護の唯一の入口（activeBoosts）から取る。ここで
                    // 「k:<id> を持っているか」を自前で見ると、旧セーブの
                    // 「腕輪の 知識」を取りこぼす
                    const knownIds = activeBoosts(town, true).knownIds;
                    const rows = ALL_ITEMS
                        .filter((d) => d.kind !== 'gitan')
                        .map((d) => {
                        const known = knownIds.has(d.id);
                        const seen = !!town.seenItems[d.id] || known;
                        return {
                            label: seen ? d.name : '？？？',
                            right: seen ? kindLabel(d.kind) : '',
                            badges: known ? [{ text: '知', color: RARITY_COLOR.r }] : undefined,
                            disabled: !seen,
                            sprite: seen ? d.id : undefined,
                            desc: seen
                                ? `${d.desc}\n買値 ${d.price} ギタン${known ? '　（知識あり）' : ''}`
                                : 'まだ 手にしていない。',
                        };
                    });
                    this.menus.push(new ListMenu({
                        title: `道具図鑑　知識 ${KNOWABLE_ITEMS.filter((d) => knownIds.has(d.id)).length}`
                            + ` / ${KNOWABLE_ITEMS.length}`,
                        entries: rows,
                        rect: { x: 300, y: 76, w: 580, h: 500 },
                        rows: 13,
                        showDesc: true,
                    }));
                    return false;
                },
            },
        ];
        this.menus.push(new ListMenu({
            title: '図鑑',
            entries,
            rect: { x: 440, y: 250, w: 400, h: 170 },
            rowH: 46,
        }));
    }
    /** 名前の変更。候補から選ぶか、自分で打ち込む */
    renamePartner(rec) {
        const typed = window.prompt('相棒の 名前（8 文字まで）', partnerName(rec));
        if (!typed || typed.trim().length === 0)
            return;
        rec.nickname = typed.trim().slice(0, 8);
        this.app.persist();
        this.say(`${rec.nickname} と 呼ぶことにした。`);
    }
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
                    label: itemName(item, this.identify()),
                    right: picked ? '持っていく' : kindLabel(getItem(item.defId).kind),
                    color: picked ? UI.cursorEdge : undefined,
                    badges: this.isKeptItem(item) ? [{ text: '保', color: UI.good }] : undefined,
                    sprite: iconKeyForCatalog(item.defId),
                    desc: this.descOf(item),
                    onSelect: () => {
                        const limit = inventoryLimitFor(this.app.town, getDungeon(dungeonId));
                        if (picked)
                            this.bring = this.bring.filter((i) => i !== item);
                        else if (this.bring.length < limit)
                            this.bring.push(item);
                        else
                            this.say(`持ち込めるのは ${limit} 個までです。`);
                        this.app.audio.play('cursor');
                        rebuild();
                        return false;
                    },
                };
            });
            // 売られた物が混ざっていたら、ここで落としておく
            this.bring = this.bring.filter((i) => town.storage.includes(i));
            entries.unshift({
                label: `▶ この ${this.bring.length} 個を 持って 出発する`,
                color: UI.good,
                desc: 'いま選んでいる道具だけを持って ダンジョンへ 向かいます。',
                onSelect: () => {
                    // 実際に倉庫から取り出せた物だけを持っていく。
                    // 選んだあとに売ってしまった物を持ち込めてしまうと、
                    // 代金と品物の両方が手に入る（無限にギタンが増える）
                    const taken = this.bring
                        .map((i) => withdrawItem(town, i.uid))
                        .filter((i) => i !== null);
                    this.bring = [];
                    this.app.persist();
                    this.onEnterDungeon(dungeonId, taken);
                    return true;
                },
            });
            return entries;
        };
        sortStorage(town);
        const menu = new ListMenu({
            title: '何を 持っていく？（決定で 選ぶ／外す）　　［F］整理',
            entries: build(),
            rect: { x: 300, y: 90, w: 640, h: 500 },
            showDesc: true,
            emptyText: '倉庫は 空っぽ',
        });
        menu.onKey = this.sortKey(rebuild);
        this.menus.push(menu);
    }
    // ------------------------------------------------------------ 倉庫
    openStorage() {
        this.place = 'storage';
        const town = this.app.town;
        sortStorage(town);
        const rebuild = () => {
            const menu = this.menus.top;
            if (menu)
                menu.setEntries(build());
        };
        const build = () => town.storage.map((item) => ({
            label: itemName(item, this.identify()),
            right: kindLabel(getItem(item.defId).kind),
            badges: this.isKeptItem(item) ? [{ text: '保', color: UI.good }] : undefined,
            sprite: iconKeyForCatalog(item.defId),
            desc: this.descOf(item),
            data: item,
            onSelect: () => {
                this.showItemInfo(item);
                return false;
            },
        }));
        const menu = new ListMenu({
            title: () => `倉庫　${this.app.town.storage.length} / ${storageLimit(this.app.town)}`
                + '　　［F］整理',
            entries: build(),
            rect: { x: 300, y: 90, w: 640, h: 500 },
            showDesc: true,
            emptyText: '倉庫は 空っぽ',
        });
        menu.onKey = this.sortKey(rebuild);
        this.menus.push(menu);
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
                // 店は名前を見て買う場なので、ここだけは本名を出す
                label: itemName(item, EMPTY_IDENTIFY, { revealAll: true }),
                right: `${price} G`,
                disabled: this.app.town.gitan < price || storageFull(this.app.town),
                sprite: iconKeyForCatalog(item.defId),
                // 店は中身を見て買う場なので、数字も印も伏せない
                desc: itemDetail(item, EMPTY_IDENTIFY, { revealAll: true }),
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
                label: itemName(item, this.identify()),
                right: `${price} G`,
                desc: this.descOf(item),
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
        sortStorage(town);
        const menu = new ListMenu({
            title: '何を 売る？　　［F］整理',
            entries: build(),
            rect: { x: 340, y: 110, w: 600, h: 440 },
            showDesc: true,
            emptyText: '売る物が ありません',
        });
        menu.onKey = this.sortKey(rebuild);
        this.menus.push(menu);
    }
    // ------------------------------------------------------------ 鍛冶屋
    /**
     * 護石に印を入れる。護石を選ぶだけで、ギタンを払って 1 つ入る。
     *
     * 入る印はランダム。狙った印を通したい時は打ち直し（印を 1 つ残して
     * 振り直す）があるので、こちらは「空きスロットを埋める」ための口にする。
     */
    openEmbed() {
        const town = this.app.town;
        const rebuild = () => {
            const menu = this.menus.top;
            if (menu)
                menu.setEntries(build());
        };
        const build = () => ownedCharms(town)
            .filter((c) => c.slots > 0)
            .map((c) => ({
            label: () => charmName(c),
            sprite: 'charm',
            right: () => `空き ${c.slots}　${SMITH_PRICE.embed} ギタン`,
            disabled: town.gitan < SMITH_PRICE.embed,
            desc: () => this.charmDesc(c),
            onSelect: () => {
                if (town.gitan < SMITH_PRICE.embed) {
                    this.say('ギタンが 足りません。');
                    this.app.audio.play('error');
                    return false;
                }
                const rng = new Rng(`embed:${town.totalRuns}:${c.uid}:${town.gitan}`);
                const runeId = smithEmbed(town, rng, c.uid);
                if (!runeId) {
                    this.say('この 護石には もう 印が 入りません。');
                    this.app.audio.play('error');
                    return false;
                }
                const rune = tryGetRune(runeId);
                this.say(`${charmName(c)}　に ${rune?.name ?? runeId}が 入った。`);
                this.app.audio.play('synthesis');
                this.app.persist();
                rebuild();
                return false;
            },
        }));
        this.menus.push(new ListMenu({
            title: () => `印を 入れる 護石を 選ぶ（所持 ${town.gitan} ギタン）`,
            entries: build(),
            rect: { x: 320, y: 120, w: 600, h: 440 },
            rows: 9,
            showDesc: true,
            emptyText: '空きスロットの ある 護石が ありません',
        }));
    }
    openSmith() {
        this.place = 'smith';
        const town = this.app.town;
        const equipment = () => town.storage.filter((i) => {
            const k = getItem(i.defId).kind;
            return k === 'weapon' || k === 'shield';
        });
        const entries = [
            {
                label: '護石に 印を 入れる',
                right: `${SMITH_PRICE.embed} ギタン`,
                desc: 'ギタンを 払うと、護石の 空きスロットに 印が 1 つ 入る。'
                    + '入る 印は 選べない。素材は 要らない。',
                onSelect: () => {
                    this.openEmbed();
                    return false;
                },
            },
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
                            label: itemName(item, this.identify()),
                            right: `${cost} G`,
                            disabled: town.gitan < cost,
                            sprite: iconKeyForCatalog(item.defId),
                            desc: this.descOf(item),
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
                    sortStorage(town);
                    const menu = new ListMenu({
                        title: `鍛える（所持 ${town.gitan} ギタン）　　［F］整理`,
                        entries: build(),
                        rect: { x: 340, y: 110, w: 600, h: 440 },
                        showDesc: true,
                        emptyText: '鍛えられる 装備が ありません',
                    });
                    menu.onKey = this.sortKey(rebuild);
                    this.menus.push(menu);
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
                            label: itemName(item, this.identify()),
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
    // ------------------------------------------------------------ 銀行
    /**
     * 銀行。
     *
     * 手持ちのギタンは冒険に持ち込まれ、倒れれば失う。預けたぶんは残る。
     * 「いくら持っていくか」を選べるようにしないと、一度倒れただけで
     * 貯めた全額が消えて、道具屋そのものが意味を失う。
     */
    openBank() {
        this.place = 'bank';
        const town = this.app.town;
        const show = () => {
            this.menus.pop();
            const menu = new ListMenu({
                title: `銀行　手持ち ${town.gitan} G ／ 預り ${town.bankGitan} G`,
                entries: this.bankEntries(show),
                rect: { x: 360, y: 200, w: 560, h: 240 },
                showDesc: true,
            });
            this.menus.push(menu);
        };
        this.menus.push(new ListMenu({
            title: `銀行　手持ち ${town.gitan} G ／ 預り ${town.bankGitan} G`,
            entries: this.bankEntries(show),
            rect: { x: 360, y: 200, w: 560, h: 240 },
            showDesc: true,
        }));
    }
    bankEntries(rebuild) {
        const town = this.app.town;
        return [
            {
                label: '預ける',
                right: `${town.gitan} G`,
                disabled: town.gitan <= 0,
                desc: '預けたぶんは 倒れても 失わない。',
                onSelect: () => {
                    this.qty = new QuantityPicker('いくら 預けますか？', 1, town.gitan, town.gitan, (n) => {
                        const got = depositGitan(town, n);
                        this.say(`${got} ギタンを 預けた。`);
                        this.app.audio.play('gitan');
                        this.app.persist();
                        rebuild();
                    }, () => { });
                    return false;
                },
            },
            {
                label: '引き出す',
                right: `${town.bankGitan} G`,
                disabled: town.bankGitan <= 0,
                desc: '引き出したぶんは 冒険に持っていく。倒れると失う。',
                onSelect: () => {
                    this.qty = new QuantityPicker('いくら 引き出しますか？', 1, town.bankGitan, town.bankGitan, (n) => {
                        const got = withdrawGitan(town, n);
                        this.say(`${got} ギタンを 引き出した。`);
                        this.app.audio.play('gitan');
                        this.app.persist();
                        rebuild();
                    }, () => { });
                    return false;
                },
            },
        ];
    }
    // ------------------------------------------------------------ 更新と描画
    update(dt, now) {
        this.time = now;
        if (this.noticeLife > 0)
            this.noticeLife -= dt;
        const input = this.app.input;
        // ガチャの演出中は他の入力を通さない
        if (this.anim) {
            this.anim.update(dt);
            if (input.directionFires('menu')) {
                // DIR_VEC の y がそのまま上下（負が上）
                const d = input.direction();
                if (d !== null)
                    this.anim.move(Math.sign(DIR_VEC[d].y));
            }
            if (input.justPressed(Cmd.A) || input.justPressed(Cmd.B) || input.justPressed(Cmd.X)) {
                this.anim.advance();
            }
            return;
        }
        if (this.qty) {
            if (this.qty.handleInput(input))
                this.qty = null;
            return;
        }
        if (this.dialog) {
            if (this.dialog.handleInput(input))
                this.dialog = null;
            return;
        }
        if (this.place === 'records') {
            if (input.justPressed(Cmd.CopyLog)) {
                void this.copyLastLog();
                return;
            }
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
    tick(stepMs) {
        this.view?.tick(stepMs / 1000);
    }
    draw(g, now) {
        // 背景：夕暮れの広場（ゆっくり横へ流す）
        if (!this.view)
            this.view = new DioramaView(buildTownDiorama());
        this.view.camX = 12 + Math.sin(now / 16000) * 12;
        g.fillStyle = '#1a1420';
        g.fillRect(0, 0, SCREEN_W, SCREEN_H);
        this.view.draw(g, now);
        // メニューの並ぶ左側を少し暗くして、枠の外の文字（見出し・所持ギタン）を読みやすく
        const shade = g.createLinearGradient(0, 0, 560, 0);
        shade.addColorStop(0, 'rgba(10,12,28,0.55)');
        shade.addColorStop(1, 'rgba(10,12,28,0)');
        g.fillStyle = shade;
        g.fillRect(0, 0, 560, SCREEN_H);
        drawText(g, '風の村', 56, 62, {
            size: 40, bold: true, family: 'serif', spacing: 4, color: '#e8d6a0',
            outline: '#0b1020', outlineWidth: 6,
        });
        drawText(g, `所持ギタン ${this.app.town.gitan.toLocaleString('ja-JP')}　`
            + `倉庫 ${this.app.town.storage.length}/${storageLimit(this.app.town)}`, 58, 94, {
            size: 17, color: UI.textDim, outline: '#0b1020', outlineWidth: 4,
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
        if (this.qty) {
            drawOverlay(g, SCREEN_W, SCREEN_H, 0.45);
            this.qty.draw(g, SCREEN_W, SCREEN_H);
        }
        // ガチャの演出は全部の上に出す
        this.anim?.draw(g, now);
        void this.time;
    }
    /**
     * 直前の冒険のプレイログをコピーする。
     *
     * 村へ戻ってから「さっきのあれ、おかしかった」と気づくことがあるので、
     * ダンジョンを出たあとでも出せるようにしてある。
     * 記録は endRun で消さずに残してある（ページを閉じても localStorage から拾える）。
     */
    async copyLastLog() {
        const town = this.app.town;
        const last = town.history[town.history.length - 1];
        const msg = await copyPlayLog(this.app.recorder.current ?? loadReplay(), {
            dungeonName: last?.dungeonName ?? '―',
            ending: last ? (last.cleared ? 'クリア' : (last.cause ?? '―')) : null,
            player: null,
            depth: last?.depth ?? 0,
            turn: last?.turns ?? 0,
            at: last?.at ?? 0,
        });
        this.say(msg);
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
        drawText(g, 'B で 戻る　　P で 直前の 冒険の プレイログを コピー', r.x + r.w / 2, r.y + r.h - 24, {
            size: 15, align: 'center', color: UI.textDim,
        });
    }
}
/** 村では全部識別済みとして表示する */
const EMPTY_IDENTIFY = { alias: {}, known: {}, nicknames: {} };
//# sourceMappingURL=town.js.map