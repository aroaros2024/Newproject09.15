/**
 * 全アイテム定義の連結。
 * registry.ts と dungeons.ts の両方から参照されるので、
 * 循環参照を避けるためにここへ切り出している。
 */

import type { ItemDef } from '../../core/types.js';
import { WEAPONS, SHIELDS } from './equipment.js';
import { HERBS, SCROLLS, STAVES } from './consumables.js';
import { POTS, BRACELETS, FOODS, MISC_ITEMS, GITAN } from './others.js';

export const ALL_ITEMS: readonly ItemDef[] = [
  ...WEAPONS, ...SHIELDS, ...HERBS, ...SCROLLS, ...STAVES,
  ...POTS, ...BRACELETS, ...FOODS, ...MISC_ITEMS, GITAN,
];

export { WEAPONS, SHIELDS, HERBS, SCROLLS, STAVES, POTS, BRACELETS, FOODS, MISC_ITEMS, GITAN };
