/**
 * ドット絵の読み込み口。
 *
 * src/ui/sprites/ 以下に分かれて置かれた定義を、ここで 1 つにまとめて
 * 登録簿（sprites.ts の registry）へ入れる。
 * 描画側は getSprite() だけを見るので、この構成が変わっても影響しない。
 */
import { registerSprites, spriteCount, validateAllSprites } from './sprites.js';
import { MONSTER_SPRITES_A } from './sprites/monstersA.js';
import { MONSTER_SPRITES_B } from './sprites/monstersB.js';
import { ITEM_SPRITES } from './sprites/items.js';
import { WORLD_SPRITES } from './sprites/world.js';
let loaded = false;
/** 起動時に 1 度だけ呼ぶ */
export function loadAllSprites() {
    if (!loaded) {
        registerSprites(MONSTER_SPRITES_A);
        registerSprites(MONSTER_SPRITES_B);
        registerSprites(ITEM_SPRITES);
        registerSprites(WORLD_SPRITES);
        loaded = true;
    }
    return { count: spriteCount(), errors: validateAllSprites() };
}
//# sourceMappingURL=spriteData.js.map