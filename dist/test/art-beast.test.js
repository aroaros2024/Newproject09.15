/**
 * 獣の系統（ネズミ・コウモリ・店の番犬）の絵の検査。
 * 共通の約束（test/artCheck.ts）に加えて、段階の差が絵に出ていることを確かめる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDistinct, checkSpecies } from './artCheck.js';
import { PixBuf, bbox, countPainted } from '../src/ui/art/pixbuf.js';
import { TIER_BOX, getRig, getSpecies, renderFrame } from '../src/ui/art/rig.js';
import { rampIndex, rampOf } from '../src/ui/art/palette.js';
const RATS = ['ratField', 'ratMud', 'ratGiant', 'ratKing'];
const BATS = ['batCave', 'batBlood', 'batMad', 'batAbyss'];
/** 1 コマ描く（既定は待機・手前向きの 0 コマ目） */
function frame(id, dir8 = 4, anim = 'idle', f = 0) {
    const def = getSpecies(id);
    const rig = getRig(def.rig);
    const box = TIER_BOX[rig.tier];
    const b = new PixBuf(box.w, box.h);
    renderFrame(b, rig, def.variant, anim, dir8, f);
    return b;
}
const idle = (id, dir8 = 4) => frame(id, dir8);
for (const id of RATS)
    test(`ネズミ ${id} の絵が約束を守る`, () => checkSpecies(id));
test('ネズミの段階は見分けられ、大きいネズミほど大きい', () => {
    checkDistinct(RATS);
    const area = (id) => countPainted(idle(id, 2));
    assert.ok(area('ratGiant') > area('ratField') * 2, 'オオネズミがのらネズミより十分に大きくない');
    assert.ok(area('ratKing') >= area('ratGiant'), 'ネズミの長がオオネズミより小さい');
    // 長は冠と杖の尾で背が高い
    assert.ok(bbox(idle('ratKing', 2)).h > bbox(idle('ratGiant', 2)).h, 'ネズミの長の背が高くない');
    // 泥のネズミは同じ形で色だけ違う（同じ系統に見える）
    const shape = (b) => [...b.px].map((c) => (c ? 1 : 0)).join('');
    assert.equal(shape(idle('ratMud', 2)), shape(idle('ratField', 2)), 'のらネズミとどろネズミの形が違う');
});
test('ネズミの噛みつきは当たりのコマで前へ伸びる', () => {
    for (const id of RATS) {
        const def = getSpecies(id);
        const strike = getRig(def.rig).anims.attack.strike;
        const right = (b) => { const r = bbox(b); return r.x + r.w; };
        assert.ok(right(frame(id, 2, 'attack', strike)) > right(frame(id, 2, 'attack', 0)), `${id} の当たりが前へ出ない`);
    }
});
for (const id of BATS)
    test(`コウモリ ${id} の絵が約束を守る`, () => checkSpecies(id));
test('コウモリは浮いていて、羽ばたきで翼の形が変わる', () => {
    checkDistinct(BATS);
    for (const id of BATS) {
        const def = getSpecies(id);
        const rig = getRig(def.rig);
        assert.ok((rig.hover ?? 0) >= 4, `${id} が浮いていない`);
        // 浮いているので足元の行（ay）の近くには何も描かない
        const b = idle(id);
        const r = bbox(b);
        assert.ok(r.y + r.h - 1 <= TIER_BOX[rig.tier].ay - 4, `${id} の下の端が地面に近すぎる`);
    }
    // 羽ばたき：翼を上げたコマと下げたコマで形が変わる
    for (const id of BATS) {
        assert.notEqual(bbox(frame(id, 4, 'walk', 0)).y, bbox(frame(id, 4, 'walk', 2)).y, `${id} の翼が上下しない`);
    }
    // やみのコウモリは大きく、光る
    assert.ok(countPainted(idle('batAbyss')) > countPainted(idle('batCave')) * 1.5, 'やみのコウモリが大きくない');
    assert.ok(getSpecies('batAbyss').light, 'やみのコウモリが光らない');
});
test('店の番犬は約束を守り、赤い前掛けで店の犬と分かる', () => {
    checkSpecies('shopGuard');
    const def = getSpecies('shopGuard');
    assert.equal(def.variant.ramps.scarf, 'crimson', '前掛けが赤くない');
    // 手前向きの待機に前掛けの赤がはっきり出ている（10 ドット以上）
    const b = idle('shopGuard');
    let red = 0;
    for (const c of b.px)
        if (c > 0 && rampOf(c) === rampIndex('crimson'))
            red++;
    assert.ok(red >= 10, `前掛けの赤が少ない（${red}）`);
});
//# sourceMappingURL=art-beast.test.js.map