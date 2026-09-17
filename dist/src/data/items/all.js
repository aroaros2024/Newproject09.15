/**
 * 全アイテム定義の連結。
 * registry.ts と dungeons.ts の両方から参照されるので、
 * 循環参照を避けるためにここへ切り出している。
 */
import { WEAPONS, SHIELDS } from './equipment.js';
import { HERBS, SCROLLS, STAVES } from './consumables.js';
import { POTS, BRACELETS, FOODS, MISC_ITEMS, GITAN } from './others.js';
export const ALL_ITEMS = [
    ...WEAPONS, ...SHIELDS, ...HERBS, ...SCROLLS, ...STAVES,
    ...POTS, ...BRACELETS, ...FOODS, ...MISC_ITEMS, GITAN,
];
/** 未識別になるカテゴリ（仮の名前が付くもの） */
export const UNIDENTIFIED_KINDS = [
    'herb', 'scroll', 'staff', 'pot', 'bracelet',
];
/**
 * ガチャの「知識」の対象。114 種。
 *
 * 未識別で始まり、かつ自然に出てくる物だけ。出ない物の知識を配っても
 * 意味が無いし、確率表の行数が増えるだけになる。
 *
 * ここに置いてあるのは registry.ts を経由させないため。
 * data/gacha.ts がこれを読むので、registry.ts から取ると
 * DUNGEONS まで芋づるで引っぱってきて循環参照になる。
 */
export const KNOWABLE_ITEMS = ALL_ITEMS.filter((d) => UNIDENTIFIED_KINDS.includes(d.kind) && !d.alwaysIdentified && d.weight > 0);
export { WEAPONS, SHIELDS, HERBS, SCROLLS, STAVES, POTS, BRACELETS, FOODS, MISC_ITEMS, GITAN };
//# sourceMappingURL=all.js.map