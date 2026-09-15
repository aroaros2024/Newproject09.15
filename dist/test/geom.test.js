import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIR_VEC, DIRS, ORTHO_DIRS, DIAGONAL_DIRS, isDiagonal, rotateDir, oppositeDir, dirDistance, vecToDir, dirTo, step, chebyshev, manhattan, isAdjacent, isOnRay, rayPoints, rectContains, rectCenter, rectOverlaps, rectPoints, clamp, samePoint, } from '../src/core/geom.js';
test('DIR_VEC は 8 方向すべて単位ベクトル', () => {
    assert.equal(DIR_VEC.length, 8);
    for (const v of DIR_VEC) {
        assert.ok(Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1);
        assert.ok(v.x !== 0 || v.y !== 0);
    }
    assert.equal(new Set(DIR_VEC.map((v) => `${v.x},${v.y}`)).size, 8);
});
test('0 は北、2 は東、4 は南、6 は西', () => {
    assert.deepEqual(DIR_VEC[0], { x: 0, y: -1 });
    assert.deepEqual(DIR_VEC[2], { x: 1, y: 0 });
    assert.deepEqual(DIR_VEC[4], { x: 0, y: 1 });
    assert.deepEqual(DIR_VEC[6], { x: -1, y: 0 });
});
test('ORTHO/DIAGONAL の分類が正しい', () => {
    assert.deepEqual([...ORTHO_DIRS], [0, 2, 4, 6]);
    assert.deepEqual([...DIAGONAL_DIRS], [1, 3, 5, 7]);
    for (const d of ORTHO_DIRS)
        assert.equal(isDiagonal(d), false);
    for (const d of DIAGONAL_DIRS)
        assert.equal(isDiagonal(d), true);
});
test('rotateDir は 8 で一周し、負数でも壊れない', () => {
    for (const d of DIRS) {
        assert.equal(rotateDir(d, 8), d);
        assert.equal(rotateDir(d, -8), d);
        assert.equal(rotateDir(rotateDir(d, 3), -3), d);
    }
    assert.equal(rotateDir(0, -1), 7);
});
test('oppositeDir は反対向きのベクトルになる', () => {
    for (const d of DIRS) {
        const o = oppositeDir(d);
        // -0 と 0 を区別しないよう正規化する
        assert.equal(DIR_VEC[d].x, -DIR_VEC[o].x || 0);
        assert.equal(DIR_VEC[d].y, -DIR_VEC[o].y || 0);
    }
});
test('dirDistance は 0〜4 に収まり対称', () => {
    for (const a of DIRS) {
        for (const b of DIRS) {
            const d = dirDistance(a, b);
            assert.ok(d >= 0 && d <= 4);
            assert.equal(d, dirDistance(b, a));
        }
    }
    assert.equal(dirDistance(0, 0), 0);
    assert.equal(dirDistance(0, 4), 4);
    assert.equal(dirDistance(7, 0), 1);
});
test('vecToDir は単位ベクトルを往復変換できる', () => {
    for (const d of DIRS) {
        assert.equal(vecToDir(DIR_VEC[d].x, DIR_VEC[d].y), d);
    }
    assert.equal(vecToDir(0, 0), null);
});
test('vecToDir は遠い座標でも近い方向へ丸める', () => {
    assert.equal(vecToDir(10, 0), 2);
    assert.equal(vecToDir(10, 1), 2, 'ほぼ真横は東へ丸める');
    assert.equal(vecToDir(5, 5), 3);
    assert.equal(vecToDir(1, 10), 4, 'ほぼ真下は南へ丸める');
    assert.equal(vecToDir(-7, -7), 7);
});
test('dirTo と step は往復する', () => {
    const from = { x: 5, y: 5 };
    for (const d of DIRS) {
        const to = step(from, d, 3);
        assert.equal(dirTo(from, to), d);
    }
    assert.equal(dirTo(from, from), null);
});
test('chebyshev / manhattan', () => {
    assert.equal(chebyshev({ x: 0, y: 0 }, { x: 3, y: 4 }), 4);
    assert.equal(manhattan({ x: 0, y: 0 }, { x: 3, y: 4 }), 7);
    assert.equal(chebyshev({ x: 2, y: 2 }, { x: 2, y: 2 }), 0);
});
test('isAdjacent は自分自身を含まない', () => {
    const c = { x: 4, y: 4 };
    assert.equal(isAdjacent(c, c), false);
    for (const d of DIRS)
        assert.equal(isAdjacent(c, step(c, d)), true);
    assert.equal(isAdjacent(c, { x: 6, y: 4 }), false);
});
test('isOnRay は 8 方向の直線のみ true', () => {
    const o = { x: 0, y: 0 };
    assert.equal(isOnRay(o, o), false);
    assert.equal(isOnRay(o, { x: 0, y: 5 }), true);
    assert.equal(isOnRay(o, { x: 5, y: 0 }), true);
    assert.equal(isOnRay(o, { x: -5, y: 5 }), true);
    assert.equal(isOnRay(o, { x: 2, y: 3 }), false);
});
test('rayPoints は始点を含まず終点を含む', () => {
    const pts = rayPoints({ x: 0, y: 0 }, { x: 3, y: 3 });
    assert.deepEqual(pts, [
        { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 },
    ]);
    assert.deepEqual(rayPoints({ x: 0, y: 0 }, { x: 1, y: 2 }), []);
});
test('矩形ユーティリティ', () => {
    const r = { x: 2, y: 3, w: 4, h: 5 };
    assert.equal(rectContains(r, { x: 2, y: 3 }), true);
    assert.equal(rectContains(r, { x: 5, y: 7 }), true);
    assert.equal(rectContains(r, { x: 6, y: 7 }), false);
    assert.equal(rectContains(r, { x: 1, y: 3 }), false);
    assert.deepEqual(rectCenter(r), { x: 4, y: 5 });
    assert.equal([...rectPoints(r)].length, 20);
});
test('rectOverlaps は margin を考慮する', () => {
    const a = { x: 0, y: 0, w: 3, h: 3 };
    const b = { x: 4, y: 0, w: 3, h: 3 };
    // a の右端は x=2、b の左端は x=4 → 間に 1 マス（x=3）の空きがある
    assert.equal(rectOverlaps(a, b), false);
    assert.equal(rectOverlaps(a, b, 1), false, '1 マス空いていれば margin=1 は満たす');
    assert.equal(rectOverlaps(a, b, 2), true, '2 マスは空いていないので近すぎる');
    assert.equal(rectOverlaps(a, { x: 2, y: 2, w: 3, h: 3 }), true);
});
test('clamp / samePoint', () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-5, 0, 3), 0);
    assert.equal(clamp(2, 0, 3), 2);
    assert.equal(samePoint({ x: 1, y: 2 }, { x: 1, y: 2 }), true);
    assert.equal(samePoint({ x: 1, y: 2 }, { x: 2, y: 1 }), false);
});
test('全 Dir 値が DIRS に含まれる', () => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7];
    assert.deepEqual([...DIRS], all);
});
//# sourceMappingURL=geom.test.js.map