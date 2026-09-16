/**
 * ドット絵の集約点。
 *
 * monstersA / monstersB / items / world に分かれて書かれた定義を
 * 1 つの Record にまとめ、id 引き（フォールバック付き）を提供する。
 *
 * 後から足したファイルの定義が先のものを上書きするので、
 * id の重複は避けること（test/sprites.test.ts で検出している）。
 */
import { MONSTER_SPRITES_A } from './monstersA.js';
import { MONSTER_SPRITES_B } from './monstersB.js';
import { ITEM_SPRITES } from './items.js';
import { WORLD_SPRITES } from './world.js';
/** 全ドット絵。id → PixelSprite */
export const SPRITES = {
    ...MONSTER_SPRITES_A,
    ...MONSTER_SPRITES_B,
    ...ITEM_SPRITES,
    ...WORLD_SPRITES,
};
/**
 * id でドット絵を引く。
 * 見つからなければ fallback を引き、それも無ければ null。
 */
export function spriteFor(id, fallback) {
    const hit = SPRITES[id];
    if (hit)
        return hit;
    if (fallback)
        return SPRITES[fallback] ?? null;
    return null;
}
export { MONSTER_SPRITES_A, MONSTER_SPRITES_B, ITEM_SPRITES, WORLD_SPRITES };
//# sourceMappingURL=index.js.map