/**
 * ガチャの景品表。
 *
 * 出るものは 4 種類。
 *
 *   SSR 相棒   冒険の最初から連れて行けるモンスター。倒れても次の冒険で戻る
 *   SR  加護   村に永久に残る効果（保持枠・袋・目利きなど）
 *   R   知識   高価な道具と、必ず呪われている腕輪の正体
 *   N   知識   その他の道具の正体
 *
 * 【同じものは二度と出ない】
 * 一度出た景品は在庫から消える。全 128 個が出尽くしたら、
 * 引くたびにギタンが出る（GACHA_EMPTY_GITAN）。
 * 「持っている物がまた出る」が無いので、引くと必ず何かが増える。
 *
 * 加護は「真・もっと不思議のダンジョン」では効かない（DungeonDef.allowBoosts）。
 * ただし倉庫や道具屋のような村の設備は、ダンジョンと関係ないので効き続ける。
 *
 * id はセーブに載る。配布後に変えないこと。
 */
import { KNOWABLE_ITEMS } from './items/all.js';
import { ALWAYS_CURSED_BRACELETS } from './items/others.js';
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
/**
 * この値段以上の道具の知識は R。安い物は N。
 *
 * 値段はこの作品の価値の物差しで、出現する階も値段から決めている
 * （dungeons.ts の itemTable）。別の軸を持ち込むと、価値の基準が 2 つになる。
 *
 * 1600 なのは「R が N より本当にめずらしい」ようにするため。
 * 2500 で切ると R 36 種 / N 78 種になり、1 枚あたり R 0.69% / N 0.83% で
 * ほとんど差が無くなる。R を青く塗って演出も長くしているのに
 * 実際はめずらしくない、という嘘になる。1600 なら 0.47% / 1.07% で 2.3 倍。
 */
export const KNOWLEDGE_R_PRICE = 1600;
const SSR = [
    { id: 'p:koro', name: 'コロ', rarity: 'ssr', weight: 1, partnerId: 'koro' },
    { id: 'p:yoi', name: 'ヨイ', rarity: 'ssr', weight: 1, partnerId: 'yoi' },
    { id: 'p:goro', name: 'ゴロ', rarity: 'ssr', weight: 1, partnerId: 'goro' },
    { id: 'p:mina', name: 'ミナ', rarity: 'ssr', weight: 1, partnerId: 'mina' },
    { id: 'p:utsuro', name: 'ウツロ', rarity: 'ssr', weight: 1, partnerId: 'utsuro' },
    { id: 'p:tetsu', name: 'テツ', rarity: 'ssr', weight: 1, partnerId: 'tetsu' },
];
/**
 * 加護 8 個。1 枚きりなので、効き目は 1 枚に畳んである。
 *
 * 「開始 HP」「開始 ちから」は入れない。この作品は
 * 「レベルは毎回 1 から。永続的に伸びるのは倉庫の装備だけ」（town.ts の carryOverOf）
 * で通してあり、そこだけ恒久的に強くすると約束が崩れる。
 */
const SR = [
    { id: 'b:keep', name: '保持枠', rarity: 'sr', weight: 3, boost: { t: 'keepSlot', amount: 2 } },
    { id: 'b:gitan', name: '軍資金', rarity: 'sr', weight: 3, boost: { t: 'gitan', amount: 900 } },
    { id: 'b:food', name: '大食い', rarity: 'sr', weight: 3, boost: { t: 'food', amount: 30 } },
    { id: 'b:bag', name: '大きな 袋', rarity: 'sr', weight: 3, boost: { t: 'bag', amount: 6 } },
    { id: 'b:shelf', name: '倉庫の 棚', rarity: 'sr', weight: 2, boost: { t: 'storage', amount: 60 } },
    { id: 'b:trade', name: '行商の つて', rarity: 'sr', weight: 2, boost: { t: 'shopSlot', amount: 6 } },
    // --- 引けなくなった景品。持っている人のために残してある
    { id: 'b:herb', name: '草の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'herb' }, retired: true },
    { id: 'b:scroll', name: '巻物の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'scroll' }, retired: true },
    { id: 'b:staff', name: '杖の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'staff' }, retired: true },
    { id: 'b:pot', name: '壺の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'pot' }, retired: true },
    { id: 'b:bracelet', name: '腕輪の 知識', rarity: 'sr', weight: 2, boost: { t: 'known', kind: 'bracelet' }, retired: true },
];
/**
 * 知識 114 個。1 種 1 景品。
 *
 * 手で 114 行並べると、道具を足したときに必ず片方だけ直し忘れる。
 * レジストリから作れば、道具が増えれば景品も自動で増える。
 *
 * 必ず呪われている腕輪（痛恨・ハラペコ・まがり・錆び）は値段 100 だが R に置く。
 * 100% 呪われて出て、着けたら外せないので、知っている価値がいちばん大きい。
 * 値段だけで N に落とすと、いちばん効く知識がいちばん安く出ることになる。
 */
const KNOWLEDGE = KNOWABLE_ITEMS.map((d) => ({
    id: `k:${d.id}`,
    name: `${d.name}の 知識`,
    rarity: (d.price >= KNOWLEDGE_R_PRICE || ALWAYS_CURSED_BRACELETS.includes(d.id)
        ? 'r' : 'n'),
    weight: 1,
    boost: { t: 'knownItem', itemId: d.id },
}));
export const PRIZES = [...SSR, ...SR, ...KNOWLEDGE];
/**
 * 抽選に出る景品。引けなくなったものは含まない。
 *
 * 引くたびに呼ぶので、レア度ごとに 1 度だけ作って覚えておく。
 */
const byRarity = new Map();
export function prizesOf(r) {
    let list = byRarity.get(r);
    if (!list) {
        list = PRIZES.filter((p) => p.rarity === r && !p.retired);
        byRarity.set(r, list);
    }
    return list;
}
const prizeMap = new Map(PRIZES.map((p) => [p.id, p]));
/** 引けなくなったものも引ける。セーブの検証がここを通る */
export const tryGetPrize = (id) => prizeMap.get(id);
//# sourceMappingURL=gacha.js.map