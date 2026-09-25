/**
 * 光の計算（gfx-core/lightModel.ts）の約束。
 *
 * 描画エンジンの光の紙と、キャラの足元の明るさ（CPU）は同じ表と同じ減衰を使う。
 * ここが崩れると、見えない所が明るくなったり（情報が漏れる）、見えている所が暗すぎたり（読めない）する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPLORED_GATE, EXPLORED_LEVEL, FLICKER_AMP, LIGHT_CAP, LightField, LightList, MIN_VISIBLE_LEVEL, TILE_EXPLORED, TILE_UNEXPLORED, TILE_VISIBLE_DARK, TILE_VISIBLE_LIT, bakeLightSprite, falloff, fillTileImages, flicker, flickerSeed, levelsFromLook, parseHex, quantIndex, quantize16, } from '../src/ui/gfx-core/lightModel.js';
import { hashFloat } from '../src/ui/art/hash.js';
const LOOK = { ambient: '#d4d8ee', memoryColor: '#5a6898', litLevel: 0.88, darkLevel: 0.45 };
const rgb01 = (hex) => {
    const n = parseHex(hex);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
/** 16 段に丸めた時の誤差の上限 */
const Q = 1 / 30 + 1e-6;
/** 全部のマスが同じ状態の場 */
function uniformField(w, h, state) {
    const f = new LightField();
    f.resize(w, h);
    f.states.fill(state);
    levelsFromLook(LOOK, f.levels);
    return f;
}
test('マスの状態の表：未探索 0/0・探索済み 記憶×0.30/0.35・暗い所 環境×0.45/1・明るい部屋 環境×lit/1', () => {
    const lv = levelsFromLook(LOOK);
    const amb = rgb01(LOOK.ambient);
    const mem = rgb01(LOOK.memoryColor);
    for (let c = 0; c < 3; c++) {
        assert.equal(lv.base[TILE_UNEXPLORED * 3 + c], 0);
        assert.ok(near(lv.base[TILE_EXPLORED * 3 + c], mem[c] * EXPLORED_LEVEL));
        assert.ok(near(lv.base[TILE_VISIBLE_DARK * 3 + c], amb[c] * 0.45));
        assert.ok(near(lv.base[TILE_VISIBLE_LIT * 3 + c], amb[c] * 0.88));
    }
    assert.equal(lv.gate[TILE_UNEXPLORED], 0);
    assert.ok(near(lv.gate[TILE_EXPLORED], 0.35));
    assert.equal(lv.gate[TILE_VISIBLE_DARK], 1);
    assert.equal(lv.gate[TILE_VISIBLE_LIT], 1);
    assert.equal(EXPLORED_LEVEL, 0.30);
    assert.equal(EXPLORED_GATE, 0.35);
});
test('見えている所は、テーマが小さな値を渡しても 0.45 より暗くならない', () => {
    const lv = levelsFromLook({ ...LOOK, darkLevel: 0.2, litLevel: 0.3 });
    const amb = rgb01(LOOK.ambient);
    for (let c = 0; c < 3; c++) {
        assert.ok(near(lv.base[TILE_VISIBLE_DARK * 3 + c], amb[c] * MIN_VISIBLE_LEVEL));
        assert.ok(lv.base[TILE_VISIBLE_LIT * 3 + c] >= lv.base[TILE_VISIBLE_DARK * 3 + c]);
    }
});
test('未探索のマスは、強い光のすぐそばでも真っ黒（地の色も光を通す量も 0）', () => {
    const f = uniformField(8, 6, TILE_UNEXPLORED);
    f.lights.add(64, 48, 200, 1, 1, 1, 1);
    f.lights.add(60, 40, 80, 1, 0.5, 0.2, 1, flickerSeed(3, 2));
    f.lights.prepare(1.25);
    const out = new Float32Array(3);
    for (let y = 0; y < 96; y += 5) {
        for (let x = 0; x < 128; x += 7) {
            f.sampleLight(x, y, out);
            assert.deepEqual([...out], [0, 0, 0], `(${x}, ${y})`);
        }
    }
    // 地図の外も未探索と同じ
    f.sampleLight(-10, -10, out);
    assert.deepEqual([...out], [0, 0, 0]);
    // 1 マス 1 画素の紙：地の色 0・光を通す量 0・未探索の黒は不透明
    const states = new Uint8Array([TILE_UNEXPLORED, TILE_EXPLORED, TILE_VISIBLE_DARK, TILE_VISIBLE_LIT]);
    const base = new Uint32Array(4);
    const mask = new Uint32Array(4);
    const unexp = new Uint32Array(4);
    fillTileImages(states, 4, f.levels, base, mask, unexp);
    assert.equal(base[0], 0xff000000);
    assert.equal(mask[0], 0xff000000);
    assert.equal(unexp[0], 0xff000000);
    for (let i = 1; i < 4; i++)
        assert.equal(unexp[i], 0, `状態 ${i} は黒く塗らない`);
    assert.equal(mask[3], 0xffffffff);
    assert.equal((mask[1] & 255), Math.round(0.35 * 255));
});
test('探索済みのマスは 0.30（記憶の色）+ 0.35 × 光 より明るくならない', () => {
    const f = uniformField(10, 8, TILE_EXPLORED);
    const L = f.lights;
    for (let i = 0; i < 12; i++) {
        L.add(hashFloat(i, 1) * 160, hashFloat(i, 2) * 128, 20 + hashFloat(i, 3) * 80, hashFloat(i, 4), hashFloat(i, 5), hashFloat(i, 6), 0.3 + hashFloat(i, 7) * 0.7, i % 2 ? flickerSeed(i, 0) : 0);
    }
    L.prepare(3.7);
    const mem = rgb01(LOOK.memoryColor);
    const out = new Float32Array(3);
    for (let k = 0; k < 400; k++) {
        const x = hashFloat(k, 11) * 160;
        const y = hashFloat(k, 12) * 128;
        f.sampleLight(x, y, out);
        const sum = [0, 0, 0];
        for (let i = 0; i < L.count; i++) {
            const fo = falloff(Math.hypot(x - L.x[i], y - L.y[i]), L.radius[i]) * L.strength[i];
            sum[0] += L.r[i] * fo;
            sum[1] += L.g[i] * fo;
            sum[2] += L.b[i] * fo;
        }
        for (let c = 0; c < 3; c++) {
            const bound = Math.min(1, mem[c] * 0.30 + 0.35 * sum[c]);
            assert.ok(out[c] <= bound + Q, `(${x.toFixed(1)}, ${y.toFixed(1)}) ${c}: ${out[c]} > ${bound}`);
            // 光を 1 つも受けていなくても、記憶の色は残る（真っ黒にはしない）
            assert.ok(out[c] >= Math.min(1, mem[c] * 0.30) - Q);
        }
    }
});
test('明るさは光から離れるほど弱まり（単調）、いつも 0〜1 に収まる', () => {
    for (const state of [TILE_EXPLORED, TILE_VISIBLE_DARK, TILE_VISIBLE_LIT]) {
        const f = uniformField(40, 4, state);
        f.lights.add(8, 32, 400, 1, 0.8, 0.5, 1);
        f.lights.prepare(0);
        const out = new Float32Array(3);
        let prev = [Infinity, Infinity, Infinity];
        for (let x = 8; x < 640; x += 3) {
            f.sampleLight(x, 32, out);
            for (let c = 0; c < 3; c++) {
                assert.ok(out[c] >= 0 && out[c] <= 1, `範囲の外 ${out[c]}`);
                assert.ok(out[c] <= prev[c] + 1e-9, `状態 ${state} x=${x} で明るくなった`);
            }
            prev = [out[0], out[1], out[2]];
        }
        // 半径の外では地の明るさだけ
        f.sampleLight(630, 32, out);
        for (let c = 0; c < 3; c++)
            assert.ok(near(out[c], quantize16(f.levels.base[state * 3 + c]) / 15));
    }
});
test('減衰：中心で 1・半径で 0・その間は単調に下がる', () => {
    assert.equal(falloff(0, 10), 1);
    assert.equal(falloff(10, 10), 0);
    assert.equal(falloff(12, 10), 0);
    assert.equal(falloff(3, 0), 0);
    let prev = 1;
    for (let d = 0; d <= 10; d += 0.25) {
        const v = falloff(d, 10);
        assert.ok(v <= prev + 1e-12 && v >= 0);
        prev = v;
    }
    // (1 - (d/r)²)²
    assert.ok(near(falloff(5, 10), 0.5625));
});
test('光の絵は減衰と同じ形（中心が最も濃く、四隅は透明、色はそのまま）', () => {
    const size = 64;
    const px = new Uint8ClampedArray(size * size * 4);
    bakeLightSprite(px, size, 1, 0.5, 0.25);
    const alpha = (x, y) => px[(y * size + x) * 4 + 3];
    assert.equal(alpha(0, 0), 0);
    assert.equal(alpha(size - 1, size - 1), 0);
    assert.ok(alpha(32, 32) >= 250);
    for (let x = 33; x < size; x++)
        assert.ok(alpha(x, 32) <= alpha(x - 1, 32));
    assert.equal(px[(32 * size + 32) * 4], 255);
    assert.equal(px[(32 * size + 32) * 4 + 1], 128);
    assert.equal(px[(32 * size + 32) * 4 + 2], 64);
});
test('光の一覧は 16 個まで。あふれたら弱い光と入れ替わり、強い光（ランタン）は残る', () => {
    const L = new LightList();
    assert.equal(L.cap, LIGHT_CAP);
    assert.equal(LIGHT_CAP, 16);
    const lantern = L.add(0, 0, 72, 1, 0.9, 0.7, 0.9);
    assert.equal(lantern, 0);
    for (let i = 0; i < 40; i++)
        L.add(i * 10, 0, 8 + (i % 5), 1, 1, 1, 0.2 + (i % 3) * 0.1);
    assert.equal(L.count, LIGHT_CAP);
    assert.equal(L.radius[0], 72, 'ランタンが追い出された');
    // 一番弱い光より弱い光は入らない
    const before = Array.from(L.radius);
    assert.equal(L.add(999, 999, 1, 1, 1, 1, 0.01), -1);
    assert.deepEqual(Array.from(L.radius), before);
    // 半径や強さが 0 の光は入らない
    L.clear();
    assert.equal(L.add(0, 0, 0, 1, 1, 1, 1), -1);
    assert.equal(L.add(0, 0, 10, 1, 1, 1, 0), -1);
    assert.equal(L.count, 0);
    // 強さは 1 で切り詰める
    L.add(0, 0, 10, 1, 1, 1, 3);
    assert.equal(L.intensity[0], 1);
});
test('揺らぎは ±10% の中・同じ時刻なら同じ値・種 0 は揺らがない・なめらかに変わる', () => {
    assert.equal(flicker(0, 1.234), 1);
    const seed = flickerSeed(4, 0);
    assert.ok(seed !== 0 && seed < 1 << 24);
    let min = Infinity;
    let max = -Infinity;
    let prev = flicker(seed, 0);
    for (let t = 0; t < 3; t += 1 / 240) {
        const v = flicker(seed, t);
        assert.ok(v >= 1 - FLICKER_AMP - 1e-9 && v <= 1 + FLICKER_AMP + 1e-9, `${v}`);
        assert.equal(v, flicker(seed, t));
        // 1/240 秒で 12Hz の値ノイズが動ける量は限られる（跳ばない）
        assert.ok(Math.abs(v - prev) < 0.02, `跳んだ ${prev} → ${v}`);
        prev = v;
        if (v < min)
            min = v;
        if (v > max)
            max = v;
    }
    assert.ok(max - min > 0.05, '3 秒の間ほとんど揺れていない');
    // 並んだ松明が揃って揺れない
    assert.notEqual(flicker(flickerSeed(3, 0), 1.5), flicker(flickerSeed(8, 0), 1.5));
});
test('明るさは 16 段に丸める（キャラの色の文字列を 4096 通りで済ませるため）', () => {
    assert.equal(quantize16(-1), 0);
    assert.equal(quantize16(2), 15);
    assert.equal(quantize16(0.5), 8);
    assert.equal(quantIndex(1, 1, 1), 0xfff);
    assert.equal(quantIndex(0, 0, 0), 0);
    const f = uniformField(4, 4, TILE_VISIBLE_DARK);
    f.lights.add(20, 20, 50, 0.9, 0.6, 0.3, 0.8);
    f.lights.prepare(0);
    const out = new Float32Array(3);
    f.sampleLight(25, 22, out);
    for (let c = 0; c < 3; c++)
        assert.ok(near(out[c] * 15, Math.round(out[c] * 15), 1e-5));
});
test('リムライト：自分のランタンは拾わず、離れた光の向きを返す', () => {
    const f = uniformField(10, 10, TILE_VISIBLE_DARK);
    // 足元から 10 ドット上のランタン（持ち主）
    f.lights.add(80, 70, 72, 1, 0.9, 0.7, 0.9);
    f.lights.prepare(0);
    const out = new Float32Array(6);
    f.sampleRim(80, 80, out);
    assert.equal(out[0], 0);
    // 右にある松明
    f.lights.add(120, 80, 64, 1, 0.6, 0.3, 0.9);
    f.lights.prepare(0);
    f.sampleRim(80, 80, out);
    assert.ok(out[0] > 0);
    assert.ok(near(out[1], 1) && near(out[2], 0));
    // 未探索では縁の光も出さない
    const dark = uniformField(10, 10, TILE_UNEXPLORED);
    dark.lights.add(120, 80, 64, 1, 1, 1, 1);
    dark.lights.prepare(0);
    dark.sampleRim(80, 80, out);
    assert.equal(out[0], 0);
});
test('場の大きさを変えると状態は未探索に戻り、配列の長さは地図とちょうど同じ', () => {
    const f = new LightField();
    f.resize(30, 20);
    assert.equal(f.states.length, 600);
    f.states.fill(TILE_VISIBLE_LIT);
    f.resize(30, 20);
    assert.equal(f.states[123], TILE_UNEXPLORED);
    f.resize(64, 24);
    assert.equal(f.states.length, 1536);
    assert.equal(f.stateAt(64 * 16, 0), TILE_UNEXPLORED);
});
//# sourceMappingURL=light.test.js.map