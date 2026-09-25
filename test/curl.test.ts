/**
 * カールノイズの流れ場とノイズ。
 * 粒が溜まらず渦を巻き続けるのは「発散が 0」だから。ここが崩れると粒が 1 点に集まったり、
 * マスの境目で弾かれたりする。同じ時刻なら同じ場になること（撮り直しても同じ絵）も固定する。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { CURL_KEY_TICKS, CurlField, streamFunction } from '../src/ui/gfx-core/curl.js';
import { perlin3, valueNoise1 } from '../src/ui/gfx-core/noise.js';

const CELL = 16;

/** マス (i, j) の中で、境目から margin ドット以上離れた点 */
function interior(rng: Rng, cols: number, rows: number, margin: number): [number, number] {
  const i = rng.int(cols);
  const j = rng.int(rows);
  const x = i * CELL + margin + rng.float() * (CELL - 2 * margin);
  const y = j * CELL + margin + rng.float() * (CELL - 2 * margin);
  return [x, y];
}

test('パーリンノイズ：格子点で 0、値は -1〜1、同じ引数なら同じ値', () => {
  const rng = new Rng(7);
  for (let n = 0; n < 200; n++) {
    const x = rng.int(600) - 300;
    const y = rng.int(600) - 300;
    const z = rng.int(600) - 300;
    assert.equal(perlin3(x, y, z), 0);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let n = 0; n < 20000; n++) {
    const x = rng.float() * 200 - 100;
    const y = rng.float() * 200 - 100;
    const z = rng.float() * 50;
    const v = perlin3(x, y, z);
    assert.equal(v, perlin3(x, y, z));
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  assert.ok(lo >= -1.05 && hi <= 1.05, `範囲 ${lo}〜${hi}`);
  // 平らではない（ちゃんと起伏がある）
  assert.ok(hi - lo > 1, `起伏が小さすぎる ${lo}〜${hi}`);
});

test('パーリンノイズはなめらか（近い点の差が小さい）', () => {
  const rng = new Rng(8);
  for (let n = 0; n < 500; n++) {
    const x = rng.float() * 100;
    const y = rng.float() * 100;
    const z = rng.float() * 10;
    const d = Math.abs(perlin3(x + 1e-4, y, z) - perlin3(x, y, z));
    assert.ok(d < 1e-3, `段差 ${d}`);
  }
});

test('値ノイズ：0〜1、なめらか、種で別の揺らぎ', () => {
  let differ = 0;
  for (let n = 0; n < 1000; n++) {
    const t = n * 0.037;
    const v = valueNoise1(t, 3);
    assert.ok(v >= 0 && v < 1, `${v}`);
    assert.ok(Math.abs(valueNoise1(t + 1e-4, 3) - v) < 1e-3);
    if (Math.abs(valueNoise1(t, 4) - v) > 0.05) differ++;
  }
  assert.ok(differ > 500, `種を変えても同じ揺らぎ（${differ}）`);
});

test('流れ場の発散はマスの中でちょうど 0（500 点・格子の間の位相）', () => {
  const field = new CurlField({ cols: 48, rows: 32 });
  // 前後の格子を混ぜている途中の位相でも成り立つこと
  for (let k = 0; k < CURL_KEY_TICKS * 3 + 7; k++) field.tick();
  const rng = new Rng(0xc0ffee);
  const v = new Float64Array(2);
  const a = new Float64Array(2);
  const b = new Float64Array(2);
  const h = 5e-4;
  let partial = 0;
  for (let n = 0; n < 500; n++) {
    // 差分の両端も境目から 1e-3 より内側
    const [x, y] = interior(rng, 48, 32, 1.5e-3 + h);
    field.sample(x, y, v);
    field.sample(x + h, y, a);
    field.sample(x - h, y, b);
    const dvx = (a[0] - b[0]) / (2 * h);
    field.sample(x, y + h, a);
    field.sample(x, y - h, b);
    const dvy = (a[1] - b[1]) / (2 * h);
    const speed = Math.hypot(v[0], v[1]);
    const limit = (1e-6 * Math.max(speed, 1e-3)) / CELL;
    assert.ok(Math.abs(dvx + dvy) < limit,
      `(${x.toFixed(3)}, ${y.toFixed(3)}) で発散 ${dvx + dvy}（上限 ${limit}）`);
    partial += Math.abs(dvx);
  }
  // 偏微分そのものは 0 ではない（打ち消し合って 0 になっている）
  assert.ok(partial / 500 > 0.01, `偏微分が小さすぎる ${partial / 500}`);
});

test('マスの境目で法線の成分が連続する（縦の境目で vx、横の境目で vy）', () => {
  const field = new CurlField({ cols: 48, rows: 32, t0: 3.3 });
  const rng = new Rng(99);
  const l = new Float64Array(2);
  const r = new Float64Array(2);
  const e = 1e-4;
  let tangentJump = 0;
  for (let n = 0; n < 200; n++) {
    // 縦の境目 x = i × 16
    const i = 1 + rng.int(47);
    const y = rng.int(32) * CELL + 0.01 + rng.float() * (CELL - 0.02);
    field.sample(i * CELL - e, y, l);
    field.sample(i * CELL + e, y, r);
    assert.ok(Math.abs(l[0] - r[0]) < 1e-3, `縦の境目 x=${i * CELL} y=${y}: ${l[0]} / ${r[0]}`);
    tangentJump = Math.max(tangentJump, Math.abs(l[1] - r[1]));
    // 横の境目 y = j × 16
    const j = 1 + rng.int(31);
    const x = rng.int(48) * CELL + 0.01 + rng.float() * (CELL - 0.02);
    field.sample(x, j * CELL - e, l);
    field.sample(x, j * CELL + e, r);
    assert.ok(Math.abs(l[1] - r[1]) < 1e-3, `横の境目 x=${x} y=${j * CELL}: ${l[1]} / ${r[1]}`);
  }
  // 接線の成分は切り替わってよい（切り替わっている＝本当に境目をまたいで比べている）
  assert.ok(tangentJump > 1e-2, `接線の成分の差 ${tangentJump}`);
});

test('同じ時刻なら同じ場（刻みで進めても、その時刻へ飛んでも）', () => {
  const ticks = CURL_KEY_TICKS * 40 + 7;
  const a = new CurlField({ cols: 28, rows: 16 });
  for (let k = 0; k < ticks; k++) a.tick();
  const b = new CurlField({ cols: 28, rows: 16, t0: ticks / 60 });
  const c = new CurlField({ cols: 28, rows: 16 });
  c.reset(ticks / 60);
  const d = new CurlField({ cols: 28, rows: 16, t0: 2 });
  assert.equal(a.time, b.time);
  const rng = new Rng(5);
  const va = new Float64Array(2);
  const vb = new Float64Array(2);
  const vc = new Float64Array(2);
  const vd = new Float64Array(2);
  let differ = 0;
  for (let n = 0; n < 300; n++) {
    const x = rng.float() * 448;
    const y = rng.float() * 256;
    a.sample(x, y, va);
    b.sample(x, y, vb);
    c.sample(x, y, vc);
    d.sample(x, y, vd);
    assert.deepEqual([va[0], va[1]], [vb[0], vb[1]]);
    assert.deepEqual([va[0], va[1]], [vc[0], vc[1]]);
    if (Math.abs(va[0] - vd[0]) + Math.abs(va[1] - vd[1]) > 0.5) differ++;
  }
  // 時刻が違えば場も違う（止まっていない）
  assert.ok(differ > 150, `時刻を変えても場が変わらない（${differ}）`);
});

test('格子は世界に固定：流れ関数を格子点で読んだ値と一致する', () => {
  const f = new CurlField({ cols: 8, rows: 8, originX: 32, originY: -16, t0: 1 });
  for (let j = 0; j <= 8; j++) {
    for (let i = 0; i <= 8; i++) {
      const x = 32 + i * CELL;
      const y = -16 + j * CELL;
      const want = Math.fround(streamFunction(x, y, 1));
      assert.ok(Math.abs(f.psiAt(x, y) - want) < 1e-6, `(${i}, ${j})`);
    }
  }
});

test('平均の速さは 12 ドット/秒前後。gain で比例して変わる', () => {
  for (const t of [0, 4, 11]) {
    const f = new CurlField({ cols: 48, rows: 32, t0: t });
    const out = new Float64Array(2);
    let sum = 0;
    let n = 0;
    for (let y = 4.3; y < 512; y += 11) {
      for (let x = 3.7; x < 768; x += 11) {
        f.sample(x, y, out);
        sum += Math.hypot(out[0], out[1]);
        n++;
      }
    }
    const mean = sum / n;
    assert.ok(mean > 9 && mean < 15, `t=${t} 平均 ${mean}`);
    f.gain = 2;
    f.sample(100.5, 100.5, out);
    const fast = Math.hypot(out[0], out[1]);
    f.gain = 1;
    f.sample(100.5, 100.5, out);
    assert.ok(Math.abs(fast - 2 * Math.hypot(out[0], out[1])) < 1e-9);
  }
});

test('格子の外や NaN でも有限の値を返す（縁の値を使う）', () => {
  const f = new CurlField({ cols: 4, rows: 4 });
  const out = new Float32Array(2);
  for (const [x, y] of [[-100, 5], [5, -100], [1000, 30], [30, 1000], [NaN, 10], [10, NaN]]) {
    f.sample(x, y, out);
    assert.ok(Number.isFinite(out[0]) && Number.isFinite(out[1]), `${x}, ${y}`);
  }
});
