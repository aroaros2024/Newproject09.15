/**
 * ドット絵の道具箱（パレット・画用紙・仕上げ・向き）。
 * ここが崩れると全部の絵が崩れるので、約束を固定しておく。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAL_HEX, PAL_RGBA, PAL_SIZE, RAMPS, STEPS, WHITE, ci, isEmissive, luminance,
  outlineOf, rampOf, shiftStep, stepOf,
} from '../src/ui/art/palette.js';
import {
  PixBuf, bbox, countPainted, distinctColors, ellipse, line, mirrorX, rect, runs,
} from '../src/ui/art/pixbuf.js';
import { finalize } from '../src/ui/art/shade.js';
import { TIER_BOX, facing } from '../src/ui/art/rig.js';

test('パレットは #rrggbb だけで、真っ黒を使わない', () => {
  assert.equal(PAL_SIZE, 1 + RAMPS.length * STEPS + 1);
  for (let i = 1; i < PAL_SIZE; i++) {
    assert.match(PAL_HEX[i], /^#[0-9a-f]{6}$/, `${i}: ${PAL_HEX[i]}`);
    assert.notEqual(PAL_HEX[i], '#000000', `${i} が真っ黒`);
  }
  assert.ok(PAL_SIZE <= 100, `${PAL_SIZE} 色は多すぎる`);
});

test('どの階調も暗い段から明るい段へ単調に明るくなる', () => {
  for (let r = 0; r < RAMPS.length; r++) {
    for (let s = 1; s < STEPS; s++) {
      assert.ok(luminance(ci(r, s)) > luminance(ci(r, s - 1)),
        `${RAMPS[r]} の ${s - 1} → ${s} が暗くなっている`);
    }
  }
});

test('段のずらしは階調の中に収まり、白と透明は変わらない', () => {
  const c = ci('leaf', 3);
  assert.equal(rampOf(shiftStep(c, 1)), rampOf(c));
  assert.equal(stepOf(shiftStep(c, 10)), STEPS - 1);
  assert.equal(stepOf(shiftStep(c, -10)), 0);
  assert.equal(shiftStep(WHITE, -1), WHITE);
  assert.equal(shiftStep(0, 1), 0);
  assert.equal(rampOf(outlineOf(c)), rampOf(c));
  assert.equal(stepOf(outlineOf(c)), 0);
  assert.equal(stepOf(outlineOf(c, true)), 1);
});

test('ImageData 用の値は 0 番だけが透明', () => {
  assert.equal(PAL_RGBA[0], 0);
  for (let i = 1; i < PAL_SIZE; i++) assert.equal(PAL_RGBA[i] >>> 24, 255);
});

test('光る色：火・魔法の明るい段・白。土や石は光らない', () => {
  assert.ok(isEmissive(ci('ember', 5)));
  assert.ok(isEmissive(WHITE));
  assert.ok(!isEmissive(ci('stone', 5)));
  assert.ok(!isEmissive(ci('ember', 1)));
});

test('直線は二重点を作らない（どの画素も隣は 2 つまで）', () => {
  const b = new PixBuf(32, 32);
  line(b, 2, 3, 27, 14, 5);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (!b.get(x, y)) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && b.get(x + dx, y + dy)) n++;
      }
      assert.ok(n <= 2, `(${x},${y}) の隣が ${n}`);
    }
  }
});

test('楕円は左右対称', () => {
  const b = new PixBuf(21, 15);
  ellipse(b, 10, 7, 8, 5, 3);
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 21; x++) assert.equal(b.get(x, y), b.get(20 - x, y), `(${x},${y})`);
  }
  const o = new PixBuf(21, 15);
  ellipse(o, 10, 7, 8, 5, 3, false);
  assert.ok(countPainted(o) < countPainted(b), '輪郭だけの方が画素が少ないはず');
});

test('左右反転を 2 回すると元に戻る', () => {
  const b = new PixBuf(9, 5);
  runs(b, 0, 0, ['ab..c', '.a.b.'], { a: 3, b: 4, c: 5 });
  const before = Uint8Array.from(b.px);
  mirrorX(b);
  assert.notDeepEqual(Uint8Array.from(b.px), before);
  mirrorX(b);
  assert.deepEqual(Uint8Array.from(b.px), before);
});

test('仕上げ：輪郭は形の外側に付き、真っ黒ではなく同じ階調の暗い段', () => {
  const b = new PixBuf(12, 12);
  const body = ci('leaf', 3);
  rect(b, 3, 3, 6, 6, body);
  finalize(b);
  // 形の外側 1 画素に輪郭
  assert.equal(rampOf(b.get(2, 5)), rampOf(body), '左の輪郭');
  assert.equal(rampOf(b.get(9, 5)), rampOf(body), '右の輪郭');
  // 光の側（上・左）の輪郭は 1 段明るい
  assert.equal(stepOf(b.get(5, 2)), 1, '上の輪郭は 1 段目');
  assert.equal(stepOf(b.get(5, 9)), 0, '下の輪郭は 0 段目');
  // 左上の縁は明るく、右下の縁は暗い
  assert.ok(stepOf(b.get(3, 5)) > stepOf(body), '左の縁が明るくなっていない');
  assert.ok(stepOf(b.get(8, 5)) < stepOf(body), '右の縁が暗くなっていない');
  // 角は丸く（斜めには付けない）
  assert.equal(b.get(2, 2), 0);
  const box = bbox(b);
  assert.deepEqual(box, { x: 2, y: 2, w: 8, h: 8 });
});

test('仕上げ：光る色は縁取らない', () => {
  const b = new PixBuf(8, 8);
  rect(b, 3, 3, 2, 2, ci('ember', 5));
  finalize(b);
  assert.equal(countPainted(b), 4, '光る色の周りに輪郭が付いた');
});

test('仕上げは何度描いても同じ結果', () => {
  const draw = (): Uint8Array => {
    const b = new PixBuf(16, 16);
    ellipse(b, 8, 9, 5, 4, ci('water', 3));
    rect(b, 6, 7, 2, 1, ci('bone', 5));
    finalize(b);
    return Uint8Array.from(b.px);
  };
  assert.deepEqual(draw(), draw());
});

test('8 方向 → 描く向き：主人公は 5 方向＋反転、敵は 3 方向＋反転', () => {
  assert.deepEqual(facing(4, 5), { draw: 'S', mirror: false });
  assert.deepEqual(facing(0, 5), { draw: 'N', mirror: false });
  assert.deepEqual(facing(3, 5), { draw: 'SE', mirror: false });
  assert.deepEqual(facing(5, 5), { draw: 'SE', mirror: true });
  assert.deepEqual(facing(6, 5), { draw: 'E', mirror: true });
  assert.deepEqual(facing(7, 5), { draw: 'NE', mirror: true });
  assert.deepEqual(facing(1, 3), { draw: 'E', mirror: false });
  assert.deepEqual(facing(7, 3), { draw: 'E', mirror: true });
  assert.deepEqual(facing(4, 1), { draw: 'S', mirror: false });
  assert.deepEqual(facing(6, 1), { draw: 'S', mirror: true });
});

test('大きさの段の足元は横の中央（反転しても足元がずれない）', () => {
  for (const [tier, box] of Object.entries(TIER_BOX)) {
    assert.equal(box.ax * 2, box.w, `${tier} の足元が中央でない`);
    assert.ok(box.ay < box.h - 1, `${tier} の足元が枠の外`);
  }
});

test('色数を数えられる', () => {
  const b = new PixBuf(4, 1);
  runs(b, 0, 0, ['abca'], { a: 3, b: 4, c: 5 });
  assert.equal(distinctColors(b), 3);
});
