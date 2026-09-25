/**
 * 一時だけ出す部品（数字の置き場・出入りの明るさ）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PopupLayer, envelope } from '../src/ui/ui2/widgets.js';

test('数字は寿命で消え、上限を超えたら古いものから捨てる', () => {
  const p = new PopupLayer();
  p.spawn('12', 'damage', 1, 1);
  p.spawn('MISS', 'miss', 2, 1);
  assert.equal(p.count, 2);
  p.update(850); // MISS（800ms）だけ消える
  assert.equal(p.count, 1);
  p.update(100);
  assert.equal(p.count, 0);
  for (let i = 0; i < 100; i++) p.spawn(String(i), 'damage', i, 0);
  assert.equal(p.count, 48);
  p.clear();
  assert.equal(p.count, 0);
});

test('出入りの明るさ：0 から上がり、留まり、0 へ下がる', () => {
  assert.equal(envelope(0, 1000), 0);
  assert.equal(envelope(100, 1000), 0.5);
  assert.equal(envelope(500, 1000), 1);
  assert.ok(envelope(900, 1000) < 1);
  assert.equal(envelope(1000, 1000), 0);
  assert.equal(envelope(-5, 1000), 0);
});
