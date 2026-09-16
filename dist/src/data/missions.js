/**
 * ミッション。
 *
 * 役割は 2 つある。
 *
 * 1. 石の入口。冒険の報酬だけだと、最初のダンジョンを出るまで
 *    ガチャが 1 回も引けない。序盤のミッションはそこを埋める。
 * 2. 操作の案内。ショートカット・保持枠・壺・合成は、説明を読まないと
 *    存在に気づかない。「やったら石が出る」形で一通り触らせる。
 *
 * 条件は村の状態（TownState）だけを見て判定する。冒険中の状態は見ない。
 * 数えは finishRun で村へ合流するので、判定は村に戻ったときに更新される。
 *
 * id はセーブ（TownState.claimed）に載る。配布後に改名すると
 * 受け取り済みの記録が外れて、石をもう一度配ることになる。変えないこと。
 */
/**
 * 序盤 8 個。
 *
 * 1〜6 は始まりの洞窟の 1〜3F で全部踏める。最初の 1 周の途中で
 * 220 石（＝単発 2 回）、クリア時点で 430 石（4 回）になる。
 */
const TUTORIAL = [
    { id: 'walk50', name: '50 歩 歩く', cond: { t: 'tally', key: 'walk', n: 50 }, stones: 30, group: 'tutorial' },
    { id: 'firstKill', name: '敵を 1 体 倒す', cond: { t: 'tally', key: 'kill', n: 1 }, stones: 30, group: 'tutorial', after: 'walk50' },
    { id: 'firstPickup', name: '道具を 1 個 拾う', cond: { t: 'tally', key: 'pickup', n: 1 }, stones: 30, group: 'tutorial', after: 'firstKill' },
    { id: 'firstEquip', name: '武器か 盾を 装備する', cond: { t: 'tally', key: 'equip', n: 1 }, stones: 40, group: 'tutorial', after: 'firstPickup' },
    { id: 'firstUse', name: '道具を 1 回 使う', cond: { t: 'tally', key: 'use', n: 1 }, stones: 40, group: 'tutorial', after: 'firstEquip' },
    { id: 'firstShortcut', name: '道具を ショートカットに 入れる', cond: { t: 'tally', key: 'shortcut', n: 1 }, stones: 50, group: 'tutorial', after: 'firstUse' },
    // 1F への入場は数えないので、5F のダンジョンを踏破しても descend は 4
    { id: 'descend3', name: '階段を 3 回 降りる', cond: { t: 'tally', key: 'descend', n: 3 }, stones: 60, group: 'tutorial', after: 'firstShortcut' },
    { id: 'clearD1', name: '始まりの洞窟を クリアする', cond: { t: 'cleared', dungeon: 'd1' }, stones: 150, group: 'tutorial', after: 'descend3' },
];
/**
 * 中盤 18 個。
 *
 * 石の量より「操作を一通り触らせる」ことを狙っている。
 * 10 体倒す系は、そのダンジョンを 2 周すれば届く数に合わせてある。
 */
const MID = [
    { id: 'killRat', name: 'のらネズミを 10 体 倒す', cond: { t: 'tally', key: 'kill:ratField', n: 10 }, stones: 60, group: 'mid' },
    { id: 'townBuy', name: '村の 道具屋で 3 個 買う', cond: { t: 'tally', key: 'buy', n: 3 }, stones: 60, group: 'mid' },
    { id: 'bankSave', name: '銀行に 3 回 預ける', cond: { t: 'tally', key: 'bank', n: 3 }, stones: 60, group: 'mid' },
    { id: 'storeItems', name: '倉庫に 道具を 20 個 貯める', cond: { t: 'storage', n: 20 }, stones: 80, group: 'mid' },
    { id: 'clearD2', name: 'せせらぎの森を クリアする', cond: { t: 'cleared', dungeon: 'd2' }, stones: 200, group: 'mid' },
    { id: 'killMud', name: 'どろネズミを 10 体 倒す', cond: { t: 'tally', key: 'kill:ratMud', n: 10 }, stones: 100, group: 'mid' },
    { id: 'potPut', name: '壺に 道具を 5 回 入れる', cond: { t: 'tally', key: 'potPut', n: 5 }, stones: 100, group: 'mid' },
    { id: 'keepSlot', name: '保持枠に 道具を 5 回 入れる', cond: { t: 'tally', key: 'keep', n: 5 }, stones: 80, group: 'mid' },
    // ワナ師の盾を着けていると進まない。d1 はワナが 0 個の階があるので中盤に置く
    { id: 'stepTrap', name: 'ワナを 10 回 踏む', cond: { t: 'tally', key: 'trap', n: 10 }, stones: 100, group: 'mid' },
    { id: 'clearD3', name: '灼熱の火山を クリアする', cond: { t: 'cleared', dungeon: 'd3' }, stones: 300, group: 'mid' },
    { id: 'killRust', name: 'サビ虫を 10 体 倒す', cond: { t: 'tally', key: 'kill:rustBug', n: 10 }, stones: 120, group: 'mid' },
    { id: 'shopBuy', name: 'ダンジョンの 店で 3 個 買う', cond: { t: 'tally', key: 'shopBuy', n: 3 }, stones: 120, group: 'mid' },
    { id: 'uncurse3', name: '呪いを 3 回 解く', cond: { t: 'tally', key: 'cure:curse', n: 3 }, stones: 120, group: 'mid' },
    { id: 'synthesis', name: '装備を 1 回 合成する', cond: { t: 'tally', key: 'synthesis', n: 1 }, stones: 150, group: 'mid' },
    { id: 'clearD4', name: '常闇の地下水路を クリアする', cond: { t: 'cleared', dungeon: 'd4' }, stones: 400, group: 'mid' },
    { id: 'killGhost', name: 'おばけを 10 体 倒す', cond: { t: 'tally', key: 'kill:ghostPale', n: 10 }, stones: 140, group: 'mid' },
    { id: 'makeAlly', name: '分身の巻物で 仲間を 作る', cond: { t: 'tally', key: 'makeAlly', n: 1 }, stones: 200, group: 'mid' },
    { id: 'clearDl', name: '天輪の塔を クリアする', cond: { t: 'cleared', dungeon: 'dl' }, stones: 700, group: 'mid' },
];
/**
 * 終盤 9 個。
 *
 * exPure（真・もっと不思議）のクリアで全ダンジョン制覇になる。
 * requires が一本に繋がっているので、別に「全制覇」を置くと
 * 同じ一手で 2 個達成して石が二重に出る。clearPure 1 個にまとめてある。
 */
const LATE = [
    { id: 'level30', name: 'レベル 30 に 到達する', cond: { t: 'max', key: 'level', n: 30 }, stones: 400, group: 'late' },
    { id: 'clearExBring', name: '不思議のダンジョンを クリアする', cond: { t: 'cleared', dungeon: 'exBring' }, stones: 900, group: 'late' },
    { id: 'moreEx30', name: 'もっと不思議の 30F に 到達する', cond: { t: 'depth', dungeon: 'ex', n: 30 }, stones: 600, group: 'late' },
    { id: 'level50', name: 'レベル 50 に 到達する', cond: { t: 'max', key: 'level', n: 50 }, stones: 900, group: 'late' },
    { id: 'moreEx50', name: 'もっと不思議の 50F に 到達する', cond: { t: 'depth', dungeon: 'ex', n: 50 }, stones: 1200, group: 'late' },
    { id: 'dex70', name: '図鑑を 7 割 埋める', cond: { t: 'dex', monsters: 56, items: 136 }, stones: 1000, group: 'late' },
    { id: 'clearEx', name: 'もっと不思議を クリアする', cond: { t: 'cleared', dungeon: 'ex' }, stones: 2500, group: 'late' },
    { id: 'purePlunge', name: '真・もっと不思議の 50F に 到達する', cond: { t: 'depth', dungeon: 'exPure', n: 50 }, stones: 1500, group: 'late' },
    { id: 'clearPure', name: '真・もっと不思議を クリアする', cond: { t: 'cleared', dungeon: 'exPure' }, stones: 3500, group: 'late' },
];
export const MISSIONS = [...TUTORIAL, ...MID, ...LATE];
const missionMap = new Map(MISSIONS.map((m) => [m.id, m]));
export const tryGetMission = (id) => missionMap.get(id);
//# sourceMappingURL=missions.js.map