/**
 * 演出のドット絵（状態異常の飾り・矢・魔法の玉・火花・爆発）。
 * 決まった絵になること、枠に収まること、動く物はコマごとに絵が変わることを守る。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARROW_SIZE, BLAST_FRAMES, BLAST_SIZE, ORB_SIZE, ORN_SIZE, SPARK_FRAMES, SPARK_SIZE, allOrnamentIds, buildArrow, buildExplosion, buildHitSpark, buildOrb, buildOrnament, ornamentOf, } from '../src/ui/art/fxSprites.js';
import { PixBuf, bbox, countPainted, mirrorX } from '../src/ui/art/pixbuf.js';
test('目に見える状態異常には飾りがあり、動く', () => {
    const need = [
        'asleep', 'deepAsleep', 'confused', 'paralyzed', 'poisoned', 'deadlyPoisoned', 'burning',
        'wet', 'slow', 'quick', 'sealed', 'blind', 'bound', 'terrified', 'strUp', 'invincible', 'fainted',
    ];
    for (const id of need)
        assert.ok(ornamentOf(id), `${id} の飾りが無い`);
    const b = new PixBuf(ORN_SIZE, ORN_SIZE);
    for (const id of allOrnamentIds()) {
        const spec = ornamentOf(id);
        assert.ok(spec.frames >= 2 && spec.fps > 0, id);
        const sigs = new Set();
        for (let f = 0; f < spec.frames; f++) {
            assert.ok(buildOrnament(id, f, b), id);
            assert.ok(countPainted(b) >= 6, `${id} ${f} コマ目の塗りが少ない`);
            sigs.add(b.px.join(','));
        }
        assert.ok(sigs.size >= 2, `${id} がコマで変わらない`);
    }
    // 透明・空腹・ワナ・浮遊は飾りでは出さない（体の見え方や地形で表す）
    assert.equal(buildOrnament('invisible', 0, b), false);
});
test('矢は 8 方向で違う絵、東と西は左右反転', () => {
    const sigs = new Set();
    const e = new PixBuf(ARROW_SIZE, ARROW_SIZE);
    const w = new PixBuf(ARROW_SIZE, ARROW_SIZE);
    for (let d = 0; d < 8; d++) {
        buildArrow(d, 'steel', e);
        assert.ok(countPainted(e) >= 14, `${d} 向きの矢の塗りが少ない`);
        sigs.add(e.px.join(','));
    }
    assert.equal(sigs.size, 8);
    // 形（塗った所）だけ、外接の四角に揃えて比べる。輪郭の明るさは光の向きで左右が違ってよい
    const shape = (b) => {
        const r = bbox(b);
        const rows = [];
        for (let y = r.y; y < r.y + r.h; y++) {
            let row = '';
            for (let x = r.x; x < r.x + r.w; x++)
                row += b.get(x, y) ? '#' : '.';
            rows.push(row);
        }
        return rows.join('/');
    };
    buildArrow(2, 'steel', e);
    buildArrow(6, 'steel', w);
    mirrorX(w);
    assert.equal(shape(w), shape(e));
});
test('魔法の玉・火花・爆発はコマで変わり、枠に収まる', () => {
    const orb = new PixBuf(ORB_SIZE, ORB_SIZE);
    const orbs = new Set();
    for (let f = 0; f < 4; f++) {
        buildOrb(f, 'violet', orb);
        orbs.add(orb.px.join(','));
    }
    assert.ok(orbs.size >= 3);
    const spark = new PixBuf(SPARK_SIZE, SPARK_SIZE);
    for (let f = 0; f < SPARK_FRAMES; f++) {
        buildHitSpark(f, spark);
        assert.ok(countPainted(spark) >= 6, `火花 ${f}`);
    }
    // 爆発は膨らんでから煙になる：3 コマ目までは広がり続ける
    const blast = new PixBuf(BLAST_SIZE, BLAST_SIZE);
    let prevW = 0;
    for (let f = 0; f < BLAST_FRAMES; f++) {
        buildExplosion(f, blast);
        const box = bbox(blast);
        assert.ok(box.w > 0, `爆発 ${f} が空`);
        if (f <= 3) {
            assert.ok(box.w >= prevW, `爆発 ${f} が縮んだ`);
            prevW = box.w;
        }
        const again = new PixBuf(BLAST_SIZE, BLAST_SIZE);
        buildExplosion(f, again);
        assert.deepEqual(again.px, blast.px, `爆発 ${f} が決まった絵にならない`);
    }
});
//# sourceMappingURL=fx-art.test.js.map