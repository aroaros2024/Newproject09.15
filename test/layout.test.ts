/**
 * 常時表示の配置。画面（1280×720）に収まり、互いに重ならず、真ん中（世界を見せる所）を空けておく。
 * メニューの枠は、固定で書いた大きさが画面より大きくても fitRect で画面に収まる。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT, MENU_LAYOUT, SCREEN_H, SCREEN_W } from '../src/ui/theme.js';
import { fitRect } from '../src/ui/draw.js';

interface R { x: number; y: number; w: number; h: number }
const overlaps = (a: R, b: R): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('常時表示の枠は画面に収まり、互いに重ならない', () => {
  const entries = Object.entries(LAYOUT) as Array<[string, R]>;
  for (const [name, r] of entries) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= SCREEN_W && r.y + r.h <= SCREEN_H, `${name} が画面の外`);
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      assert.ok(!overlaps(entries[i][1], entries[j][1]), `${entries[i][0]} と ${entries[j][0]} が重なる`);
    }
  }
});

test('真ん中（400〜880 × 130〜580）は世界を見せるために空けておく', () => {
  const center = { x: 400, y: 130, w: 480, h: 450 };
  for (const [name, r] of Object.entries(LAYOUT) as Array<[string, R]>) {
    assert.ok(!overlaps(r, center), `${name} が真ん中に掛かっている`);
  }
});

test('メニューの枠は画面に収まる', () => {
  const items = MENU_LAYOUT.items;
  const detail = MENU_LAYOUT.detail;
  for (const r of [items, detail] as R[]) {
    assert.ok(r.x + r.w <= SCREEN_W && r.y + r.h <= SCREEN_H);
  }
  // 大きすぎる枠・はみ出す枠も fitRect で収まる
  for (const r of [
    { x: 56, y: 108, w: 420, h: 72 + 13 * 40 + 200 },
    { x: 1200, y: 600, w: 400, h: 300 },
    { x: -40, y: -40, w: 2000, h: 1000 },
  ]) {
    const f = fitRect(r);
    assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= SCREEN_W && f.y + f.h <= SCREEN_H, JSON.stringify(f));
  }
});
