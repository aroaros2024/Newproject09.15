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
export { WEAPONS, SHIELDS, HERBS, SCROLLS, STAVES, POTS, BRACELETS, FOODS, MISC_ITEMS, GITAN };
//# sourceMappingURL=all.js.map