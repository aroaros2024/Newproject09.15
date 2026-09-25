/**
 * 演出の受け口：飛び道具・ビーム・光は時間で片付き、揺れは「動きを減らす」で止まり、
 * 暗転は floorOut で暗くなって floorIn で明ける。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { ParticlePool } from '../src/ui/gfx-core/particles.js';
import { VfxLayer, elementOfHex } from '../src/ui/world/vfxLayer.js';

const make = (): { v: VfxLayer; sounds: string[]; deaths: string[] } => {
  const sounds: string[] = [];
  const deaths: string[] = [];
  const v = new VfxLayer(new ParticlePool(512, new Rng(1)), (id) => sounds.push(id), (_x, _y, tag) => deaths.push(tag));
  return { v, sounds, deaths };
};

test('飛び道具とビームと一瞬の光は時間で片付く', () => {
  const { v } = make();
  v.projectile({ x: 1, y: 1 }, { x: 5, y: 1 }, 'ironArrow', 'item', 200);
  v.beam({ x: 1, y: 1 }, { x: 1, y: 6 }, '#ff8040', 'fire', 160);
  v.light(2, 2, '#ffffff', 2, 1, 300);
  assert.equal(v.lN, 1);
  for (let t = 0; t < 400; t += 16) v.tick(16);
  assert.equal(v.lN, 0);
  // 20 個投げても置き場は増えない（あふれたら古い物を差し替える）
  for (let i = 0; i < 20; i++) v.projectile({ x: 0, y: 0 }, { x: 3, y: 0 }, null, 'magic', 100);
  for (let i = 0; i < 20; i++) v.light(0, 0, '#fff', 1, 1, 100);
  assert.equal(v.lN, 16);
});

test('粒の吹き出しは表の光と揺れを出し、撃破は絵を崩す合図を送る', () => {
  const { v, deaths } = make();
  v.burst('explosion', 3, 3, { dir8: -1, power: 1, color: '', tag: '' });
  assert.ok(v.lN >= 1);
  v.tick(16);
  assert.ok(v.shakeX !== 0 || v.shakeY !== 0);
  v.burst('death', 1, 1, { dir8: -1, power: 1, color: '', tag: 'ratField' });
  assert.deepEqual(deaths, ['ratField']);
});

test('動きを減らす設定では揺れと止めが出ない', () => {
  const { v } = make();
  v.reduceMotion = true;
  v.shake(8, 300);
  v.hitstop(60);
  v.tick(16);
  assert.equal(v.shakeX, 0);
  assert.equal(v.shakeY, 0);
  assert.equal(v.hitstopLeft, 0);
});

test('暗転：floorOut で暗くなり、floorIn で明ける。効果音はそのまま渡す', () => {
  const { v, sounds } = make();
  v.transition('floorOut');
  for (let t = 0; t < 300; t += 16) v.tick(16);
  assert.equal(v.fade, 1);
  v.transition('floorIn');
  for (let t = 0; t < 500; t += 16) v.tick(16);
  assert.equal(v.fade, 0);
  v.sfx('hit');
  assert.deepEqual(sounds, ['hit']);
});

test('ビームの色から属性を選ぶ', () => {
  assert.equal(elementOfHex('#ff5020'), 'fire');
  assert.equal(elementOfHex('#40a0ff'), 'water');
  assert.equal(elementOfHex('#c060ff'), 'magic');
});
