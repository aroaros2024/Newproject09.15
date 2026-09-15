import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hashSeed } from '../src/core/rng.js';

test('同じシードからは同じ系列が出る', () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  for (let i = 0; i < 500; i++) assert.equal(a.next(), b.next());
});

test('違うシードでは系列が分岐する', () => {
  const a = new Rng(1);
  const b = new Rng(2);
  let same = 0;
  for (let i = 0; i < 200; i++) if (a.next() === b.next()) same++;
  assert.ok(same < 5, `衝突が多すぎる: ${same}`);
});

test('float() は [0,1) に収まる', () => {
  const r = new Rng('float');
  for (let i = 0; i < 20000; i++) {
    const f = r.float();
    assert.ok(f >= 0 && f < 1, `範囲外: ${f}`);
  }
});

test('int(n) は [0,n) に収まり、全値が出る', () => {
  const r = new Rng('int');
  const seen = new Set<number>();
  for (let i = 0; i < 20000; i++) {
    const v = r.int(6);
    assert.ok(v >= 0 && v < 6);
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});

test('int(0) と int(-1) は 0', () => {
  const r = new Rng('edge');
  assert.equal(r.int(0), 0);
  assert.equal(r.int(-1), 0);
});

test('range(min,max) は両端を含む', () => {
  const r = new Rng('range');
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 20000; i++) {
    const v = r.range(3, 7);
    assert.ok(v >= 3 && v <= 7);
    if (v === 3) lo++;
    if (v === 7) hi++;
  }
  assert.ok(lo > 0 && hi > 0);
});

test('range は min>max でも動く', () => {
  const r = new Rng('rev');
  for (let i = 0; i < 100; i++) {
    const v = r.range(9, 2);
    assert.ok(v >= 2 && v <= 9);
  }
});

test('percent(0) は常に false / percent(100) は常に true', () => {
  const r = new Rng('pct');
  for (let i = 0; i < 200; i++) {
    assert.equal(r.percent(0), false);
    assert.equal(r.percent(100), true);
  }
});

test('percent(25) はおおむね 25% になる', () => {
  const r = new Rng('pct25');
  let hit = 0;
  const n = 100000;
  for (let i = 0; i < n; i++) if (r.percent(25)) hit++;
  const rate = (hit / n) * 100;
  assert.ok(Math.abs(rate - 25) < 1, `偏りすぎ: ${rate}%`);
});

test('weightedIndex は重みに比例する', () => {
  const r = new Rng('w');
  const weights = [1, 3, 0, 6];
  const counts = [0, 0, 0, 0];
  const n = 100000;
  for (let i = 0; i < n; i++) counts[r.weightedIndex(weights)]++;
  assert.equal(counts[2], 0, '重み 0 が選ばれてはいけない');
  assert.ok(Math.abs(counts[0] / n - 0.1) < 0.01);
  assert.ok(Math.abs(counts[1] / n - 0.3) < 0.01);
  assert.ok(Math.abs(counts[3] / n - 0.6) < 0.01);
});

test('weightedIndex は合計 0 でも落ちない', () => {
  const r = new Rng('w0');
  assert.equal(r.weightedIndex([0, 0, 0]), 0);
  assert.equal(r.weightedIndex([]), 0);
});

test('shuffle は要素を落とさない', () => {
  const r = new Rng('sh');
  const src = Array.from({ length: 50 }, (_, i) => i);
  const out = r.shuffled(src);
  assert.equal(out.length, src.length);
  assert.deepEqual([...out].sort((a, b) => a - b), src);
});

test('shuffled は元配列を壊さない', () => {
  const r = new Rng('sh2');
  const src = [1, 2, 3, 4, 5];
  r.shuffled(src);
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
});

test('sample は重複せず n 個返す', () => {
  const r = new Rng('sample');
  const src = Array.from({ length: 30 }, (_, i) => i);
  const got = r.sample(src, 7);
  assert.equal(got.length, 7);
  assert.equal(new Set(got).size, 7);
  assert.equal(r.sample(src, 99).length, 30);
});

test('serialize/restore で状態が完全に復元される', () => {
  const r = new Rng('save');
  for (let i = 0; i < 37; i++) r.next();
  const snapshot = r.serialize();
  const expected = Array.from({ length: 50 }, () => r.next());
  const r2 = Rng.fromState(snapshot);
  const actual = Array.from({ length: 50 }, () => r2.next());
  assert.deepEqual(actual, expected);
});

test('clone は独立した同一状態を作る', () => {
  const r = new Rng('clone');
  r.next();
  const c = r.clone();
  assert.equal(c.next(), r.next());
  c.next();
  // clone を進めても元は影響を受けない
  const r2 = r.clone();
  assert.equal(r2.next(), r.next());
});

test('derive は tag ごとに再現性のある子を作る', () => {
  const mk = () => new Rng('parent');
  const a1 = mk().derive('floor:1').next();
  const a2 = mk().derive('floor:1').next();
  const b = mk().derive('floor:2').next();
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
});

test('hashSeed は決定的で 0 を返さない', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  assert.ok(hashSeed('') !== 0);
  assert.ok(hashSeed(0) > 0);
});

test('シード 0 でも壊れない', () => {
  const r = new Rng(0);
  const vals = new Set<number>();
  for (let i = 0; i < 100; i++) vals.add(r.next());
  assert.ok(vals.size > 90, '0 シードで系列が縮退している');
});

test('32bit 出力が長期間 0 に落ち込まない', () => {
  const r = new Rng('long');
  let zeros = 0;
  for (let i = 0; i < 200000; i++) if (r.next() === 0) zeros++;
  assert.ok(zeros <= 2, `0 が多すぎる: ${zeros}`);
});

test('pick は配列の要素を返す', () => {
  const r = new Rng('pick');
  const arr = ['a', 'b', 'c'];
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) seen.add(r.pick(arr));
  assert.equal(seen.size, 3);
});
