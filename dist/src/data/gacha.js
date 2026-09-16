/**
 * ガチャの景品表。
 *
 * 出るものは 4 種類。
 *
 *   SSR 相棒       冒険の最初から連れて行けるモンスター。倒れても次の冒険で戻る
 *   SR  加護       村に永久に残る効果（保持枠・初期識別など）
 *   R   良い道具   倉庫に届く。強い装備や貴重な巻物
 *   N   消耗品     倉庫に届く。草・おにぎり・矢など
 *
 * 加護は「真・もっと不思議のダンジョン」では効かない（DungeonDef.allowBoosts）。
 * 効く側と効かない側の 2 本を用意してあるのは、貯めた物で有利に進む遊びと、
 * 拾った物だけで何とかする遊びの、どちらも残すため。
 *
 * id はセーブに載る。配布後に変えないこと。
 */
/** レア度ごとの確率（％）。合計 100 */
export const RARITY_RATE = {
    ssr: 2,
    sr: 8,
    r: 25,
    n: 65,
};
/** レア度ごとの表示 */
export const RARITY_LABEL = {
    ssr: 'SSR', sr: 'SR', r: 'R', n: 'N',
};
export const RARITY_COLOR = {
    ssr: '#ffd24a', sr: '#c07cff', r: '#6aa8ff', n: '#d8d8e0',
};
/** 重複したときに戻ってくる石 */
export const DUP_STONES = {
    ssr: 0, // 相棒の重複は石ではなく「絆」になる
    sr: 50,
    r: 0,
    n: 0,
};
const SSR = [
    { id: 'p:koro', name: 'コロ', rarity: 'ssr', weight: 1, partnerId: 'koro' },
    { id: 'p:yoi', name: 'ヨイ', rarity: 'ssr', weight: 1, partnerId: 'yoi' },
    { id: 'p:goro', name: 'ゴロ', rarity: 'ssr', weight: 1, partnerId: 'goro' },
    { id: 'p:mina', name: 'ミナ', rarity: 'ssr', weight: 1, partnerId: 'mina' },
    { id: 'p:utsuro', name: 'ウツロ', rarity: 'ssr', weight: 1, partnerId: 'utsuro' },
    { id: 'p:tetsu', name: 'テツ', rarity: 'ssr', weight: 1, partnerId: 'tetsu' },
];
const SR = [
    { id: 'b:keep', name: '保持枠 +1', rarity: 'sr', weight: 3, boost: { t: 'keepSlot' }, cap: 2 },
    { id: 'b:herb', name: '草の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'herb' }, cap: 1 },
    { id: 'b:scroll', name: '巻物の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'scroll' }, cap: 1 },
    { id: 'b:staff', name: '杖の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'staff' }, cap: 1 },
    { id: 'b:pot', name: '壺の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'pot' }, cap: 1 },
    { id: 'b:bracelet', name: '腕輪の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'bracelet' }, cap: 1 },
    { id: 'b:gitan', name: '軍資金', rarity: 'sr', weight: 3, boost: { t: 'gitan', amount: 300 }, cap: 3 },
    { id: 'b:food', name: '大食い', rarity: 'sr', weight: 3, boost: { t: 'food', amount: 10 }, cap: 3 },
];
const R = [
    { id: 'i:steelSword', name: '鋼の剣', rarity: 'r', weight: 3, itemId: 'steelSword' },
    { id: 'i:steelShield', name: '鋼の盾', rarity: 'r', weight: 3, itemId: 'steelShield' },
    { id: 'i:synthesisPot', name: '合成の壺', rarity: 'r', weight: 2, itemId: 'synthesisPot' },
    { id: 'i:blessWeapon', name: '武器強化の巻物', rarity: 'r', weight: 3, itemId: 'blessWeapon' },
    { id: 'i:blessShield', name: '盾強化の巻物', rarity: 'r', weight: 3, itemId: 'blessShield' },
    { id: 'i:greatIdentify', name: '大識別の巻物', rarity: 'r', weight: 3, itemId: 'greatIdentify' },
    { id: 'i:cloneScroll', name: '分身の巻物', rarity: 'r', weight: 2, itemId: 'cloneScroll' },
    { id: 'i:storagePot', name: '保存の壺', rarity: 'r', weight: 3, itemId: 'storagePot' },
    { id: 'i:sleepStaff', name: '眠りの杖', rarity: 'r', weight: 3, itemId: 'sleepStaff' },
];
const N = [
    { id: 'i:healHerb', name: '薬草', rarity: 'n', weight: 6, itemId: 'healHerb', count: 2 },
    { id: 'i:riceBall', name: 'おにぎり', rarity: 'n', weight: 6, itemId: 'riceBall', count: 2 },
    { id: 'i:woodArrow', name: '木の矢', rarity: 'n', weight: 5, itemId: 'woodArrow', count: 15 },
    { id: 'i:identifyScroll', name: '識別の巻物', rarity: 'n', weight: 4, itemId: 'identifyScroll' },
    { id: 'i:uncurseScroll', name: '解呪の巻物', rarity: 'n', weight: 3, itemId: 'uncurseScroll' },
    { id: 'i:mapScroll', name: '地図の巻物', rarity: 'n', weight: 3, itemId: 'mapScroll' },
    { id: 'i:bronzeSword', name: '青銅の剣', rarity: 'n', weight: 3, itemId: 'bronzeSword' },
    { id: 'i:bronzeShield', name: '青銅の盾', rarity: 'n', weight: 3, itemId: 'bronzeShield' },
];
export const PRIZES = [...SSR, ...SR, ...R, ...N];
export const prizesOf = (r) => PRIZES.filter((p) => p.rarity === r);
const prizeMap = new Map(PRIZES.map((p) => [p.id, p]));
export const tryGetPrize = (id) => prizeMap.get(id);
//# sourceMappingURL=gacha.js.map