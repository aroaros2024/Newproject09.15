/**
 * プルン系・ボムプルン系・カエル系・こざかなの絵（src/ui/art/rigs/slime.ts・frog.ts・fish.ts）。
 * 共通の約束（artCheck）に加えて、系統の中の段階が絵で分かるかを確かめる。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDistinct, checkSpecies } from './artCheck.js';
import { PixBuf, bbox, countPainted } from '../src/ui/art/pixbuf.js';
import { type AnimId, getRig, getSpecies, renderFrame } from '../src/ui/art/rig.js';
import { EMISSIVE, ci, luminance } from '../src/ui/art/palette.js';

const SLIMES = ['slimeBlue', 'slimeGreen', 'slimeBlack', 'slimeKing'];
const BOMBS = ['bombSlime', 'bombGiant'];
const FROGS = ['frogTree', 'frogGiant'];
const FISH = ['fishSmall'];

/** 種の 1 コマを描いた画用紙 */
function frame(id: string, anim: AnimId = 'idle', dir8 = 4, f = 0): PixBuf {
  const def = getSpecies(id)!;
  const rig = getRig(def.rig)!;
  const b = new PixBuf(
    rig.tier === 'S' ? 24 : rig.tier === 'M' ? 32 : 64,
    rig.tier === 'S' ? 24 : rig.tier === 'M' ? 40 : 64,
  );
  renderFrame(b, rig, def.variant, anim, dir8, f);
  return b;
}

const emissiveCount = (b: PixBuf): number => {
  let n = 0;
  for (const c of b.px) if (EMISSIVE[c]) n++;
  return n;
};

/** 塗られた画素の明るさの平均 */
function meanLum(b: PixBuf): number {
  let s = 0;
  let n = 0;
  for (const c of b.px) {
    if (!c) continue;
    s += luminance(c);
    n++;
  }
  return s / n;
}

for (const id of [...SLIMES, ...BOMBS, ...FROGS]) {
  test(`${id} の絵は約束を守る`, () => checkSpecies(id));
}
for (const id of FISH) {
  test(`${id} の絵は約束を守る（下 4 ドットは水の中）`, () => checkSpecies(id));
}

test('系統ごとに種の見分けが付く', () => {
  checkDistinct(SLIMES);
  checkDistinct(BOMBS);
  checkDistinct(FROGS);
  checkDistinct(FISH);
});

test('プルンの王はプルンより大きく、冠の金を載せている', () => {
  const blue = bbox(frame('slimeBlue'));
  const king = bbox(frame('slimeKing'));
  assert.ok(king.w >= blue.w * 2, `王の幅 ${king.w} がプルンの幅 ${blue.w} の 2 倍に届かない`);
  assert.ok(king.h >= blue.h * 2, `王の高さ ${king.h} がプルンの高さ ${blue.h} の 2 倍に届かない`);
  const gold = frame('slimeKing').px.filter((c) => c >= ci('gold', 0) && c <= ci('gold', 5)).length;
  assert.ok(gold >= 60, `冠の金が少ない（${gold}）`);
});

test('プルンは段階が上がるほど大きく（同じ形のまま）、くろプルンは一番暗い', () => {
  const sizes = SLIMES.slice(0, 3).map((id) => countPainted(frame(id)));
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], `大きさの並び ${sizes.join(' < ')}`);
  const lum = SLIMES.slice(0, 3).map((id) => meanLum(frame(id)));
  assert.ok(lum[2] < lum[0] && lum[2] < lum[1], `くろプルンが暗くない（${lum.map((l) => l.toFixed(3)).join(', ')}）`);
});

test('プルンは光らない。ボムプルンは導火線の火花だけが光る', () => {
  for (const id of SLIMES) assert.equal(emissiveCount(frame(id)), 0, `${id} に光る色がある`);
  for (const id of BOMBS) {
    const b = frame(id);
    const n = emissiveCount(b);
    assert.ok(n > 0 && n <= 9, `${id} の光る画素 ${n}`);
    // 光るのは体より上（導火線の先）だけ
    const r = bbox(b);
    for (let y = r.y + 6; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) assert.ok(!EMISSIVE[b.get(x, y)], `${id} の体 (${x},${y}) が光っている`);
    }
    assert.ok(getSpecies(id)!.light, `${id} に光源が無い`);
  }
});

test('ボムプルンは攻撃で膨らみ、だいばくはつプルンはひびが火の色に光る', () => {
  for (const id of BOMBS) {
    const rest = countPainted(frame(id));
    const strike = getRig(getSpecies(id)!.rig)!.anims.attack!.strike!;
    const swell = countPainted(frame(id, 'attack', 4, strike));
    assert.ok(swell > rest * 1.15, `${id} が膨らまない（${rest} → ${swell}）`);
  }
  const idle = emissiveCount(frame('bombGiant'));
  const strike = emissiveCount(frame('bombGiant', 'attack', 4, 2));
  assert.ok(strike >= idle + 10, `ひびが光らない（${idle} → ${strike}）`);
});

test('デカガエルはアマガエルより大きく、舌を伸ばす（横・手前・奥）', () => {
  assert.ok(countPainted(frame('frogGiant')) > countPainted(frame('frogTree')) * 2);
  const tongue = (b: PixBuf): number => b.px.filter((c) => c >= ci('rose', 0) && c <= ci('rose', 5)).length;
  for (const dir8 of [2, 4, 0]) {
    const rest = tongue(frame('frogGiant', 'idle', dir8, 0));
    const out = tongue(frame('frogGiant', 'attack', dir8, 2));
    assert.ok(out >= rest + 8, `向き${dir8} で舌が出ない（${rest} → ${out}）`);
  }
});

test('こざかなは水に沈める設定で、目と背びれは水面より上にある', () => {
  const rig = getRig('fish')!;
  assert.equal(rig.submerge, 4);
  for (const dir8 of [4, 2, 0]) {
    const b = frame('fishSmall', 'idle', dir8, 0);
    const fin = b.px.findIndex((c) => c >= ci('crimson', 0) && c <= ci('crimson', 5));
    assert.ok(fin >= 0 && Math.floor(fin / b.w) < 21 - 4, `向き${dir8} のひれが水面より上に無い`);
  }
  for (const dir8 of [4, 2]) {
    const b = frame('fishSmall', 'idle', dir8, 0);
    const eye = b.px.indexOf(ci('ink', 0));
    assert.ok(eye >= 0 && Math.floor(eye / b.w) < 21 - 3, `向き${dir8} の目が水の中`);
  }
});
