/**
 * コマの焼き置き場（gfx/sheets.ts）の約束。
 *
 * 頁（キャンバス）は偽物に差し替えて、鍵の詰め方・仕上げ・同じ絵を二度焼かないこと・
 * 記憶の上限と追い出しの順番を node で確かめる。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAP_BYTES, FX_COUNT, FX_DISSOLVE_25, FX_DISSOLVE_50, FX_DISSOLVE_75, FX_DISSOLVE_90,
  FX_EMISSIVE, FX_FLASH, FX_NORMAL, FX_OCCLUDER, SheetCache, type SheetBackend, type SheetPage,
  animIndex, applyFx, cssToRGBA, legacyToRGBA, packKey, unpackKey,
} from '../src/ui/gfx/sheets.js';
import { type Rig, mat, registerRig, registerSpecies } from '../src/ui/art/rig.js';
import { rect } from '../src/ui/art/pixbuf.js';
import { WHITE } from '../src/ui/art/palette.js';
import { idleBreath, walkCycle } from '../src/ui/art/anim.js';
import { loadAllSprites } from '../src/ui/spriteData.js';

/** 偽の頁：作った数・写した数・捨てた数だけ数える */
class FakeBackend implements SheetBackend {
  made = 0;
  uploads = 0;
  released = 0;
  newPage(w: number, h: number): SheetPage {
    this.made++;
    return { src: { width: w, height: h } as unknown as CanvasImageSource };
  }
  upload(): void {
    this.uploads++;
  }
  release(): void {
    this.released++;
  }
}

// 検証用のリグ：S の段・1 方向・待機 4 コマと歩き 4 コマ。flags で光る点を足す
const blob: Rig = {
  id: 'sheetTestBlob', tier: 'S', dirs: 1,
  anims: { idle: idleBreath(4, 4, 1), walk: walkCycle(4, 10) },
  build(b, p, _dir, v): void {
    const bob = Math.round(p.bob);
    rect(b, 6, 10 + bob, 12, 10, mat(v, 'body', 3));
    rect(b, 13, 12 + bob, 2, 2, mat(v, 'eye', 0));
    if ((v.flags ?? 0) & 1) b.set(8, 12 + bob, WHITE);
  },
};
registerRig(blob);
registerSpecies({
  sheetTestBlob: { rig: 'sheetTestBlob', variant: { ramps: { body: 'leaf', eye: 'ink' } } },
  sheetTestGlow: { rig: 'sheetTestBlob', variant: { ramps: { body: 'leaf', eye: 'ink' }, flags: 1 } },
});
loadAllSprites();

test('鍵は詰めて戻すと同じ値になり、違う組は違う鍵になる', () => {
  const seen = new Set<number>();
  for (const species of [0, 1, 77, 5000]) {
    for (let anim = 0; anim < 7; anim++) {
      for (let dir = 0; dir < 8; dir++) {
        for (const frame of [0, 3, 15]) {
          for (let fx = 0; fx < FX_COUNT; fx++) {
            const k = packKey(species, anim, dir, frame, fx);
            assert.ok(Number.isSafeInteger(k));
            assert.ok(!seen.has(k), `重複 ${species} ${anim} ${dir} ${frame} ${fx}`);
            seen.add(k);
            assert.deepEqual(unpackKey(k), { species, anim, dir8: dir, frame, fx });
          }
        }
      }
    }
  }
});

test('仕上げ：白い閃き・崩れ 4 段・光る所だけ・光る所以外は黒', () => {
  const w = 16;
  const h = 16;
  const stride = 20;
  const fill = (): Uint32Array => {
    const px = new Uint32Array(stride * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * stride + x] = 0xff336699;
    return px;
  };
  const emis = new Uint8Array(stride * h);
  emis[3 * stride + 4] = 1;
  emis[9 * stride + 9] = 1;

  let px = fill();
  assert.equal(applyFx(px, stride, w, h, FX_NORMAL, emis), 256);
  assert.equal(px[0], 0xff336699);

  px = fill();
  assert.equal(applyFx(px, stride, w, h, FX_FLASH, emis), 256);
  assert.equal(px[5 * stride + 5], 0xffffffff);

  const cut = [[FX_DISSOLVE_25, 64], [FX_DISSOLVE_50, 128], [FX_DISSOLVE_75, 192], [FX_DISSOLVE_90, 224]];
  for (const [fx, removed] of cut) {
    px = fill();
    assert.equal(applyFx(px, stride, w, h, fx, emis), 256 - removed, `崩れ ${fx}`);
  }
  // 段が進むほど、前の段で抜けた画素は抜けたまま（崩れ方がつながる）
  const a = fill();
  const b = fill();
  applyFx(a, stride, w, h, FX_DISSOLVE_25, null);
  applyFx(b, stride, w, h, FX_DISSOLVE_50, null);
  for (let i = 0; i < a.length; i++) if (a[i] === 0) assert.equal(b[i], 0);

  px = fill();
  assert.equal(applyFx(px, stride, w, h, FX_EMISSIVE, emis), 2);
  assert.equal(px[3 * stride + 4], 0xff336699);
  assert.equal(px[0], 0);
  px = fill();
  assert.equal(applyFx(px, stride, w, h, FX_EMISSIVE, null), 0);

  px = fill();
  assert.equal(applyFx(px, stride, w, h, FX_OCCLUDER, emis), 256);
  assert.equal(px[0], 0xff000000);
  assert.equal(px[9 * stride + 9], 0xff336699);
  // 画用紙の外（stride の余り）には触らない
  assert.equal(px[16], 0);
});

test('CSS の色を画素の値に（ドット絵に半透明は無いので、薄い色は透明）', () => {
  assert.equal(cssToRGBA('#ff0000'), 0xff0000ff);
  assert.equal(cssToRGBA('#0a0'), 0xff00aa00);
  assert.equal(cssToRGBA('#11223344'), 0);
  assert.equal(cssToRGBA('#112233cc'), 0xff332211);
  assert.equal(cssToRGBA('rgb(1, 2, 3)'), 0xff030201);
  assert.equal(cssToRGBA('rgba(1, 2, 3, 0.2)'), 0);
  assert.equal(cssToRGBA('nonsense'), 0);
});

test('旧来の絵：1 ドット = 1 画素（ボスは 2 倍）で 1 コマ。足元はマスの (8, 13) に当たる', () => {
  const backend = new FakeBackend();
  const sc = new SheetCache({ backend });
  const slime = sc.index('slimeBlue');
  assert.ok(slime >= 0);
  const f = sc.frame(slime, animIndex('walk'), 3, 5);
  assert.ok(f);
  assert.equal(f.w, 16);
  assert.equal(f.h, 16);
  assert.equal(f.ax, 8);
  assert.equal(f.ay, 13);
  assert.equal(sc.rigOf(slime), null);
  assert.equal(sc.frameCount(slime, animIndex('walk')), 1);

  const boss = sc.index('bossForest', true);
  const fb = sc.frame(boss, 0, 4, 0);
  assert.ok(fb);
  assert.equal(fb.w, 32);
  assert.equal(fb.ax, 16);
  assert.equal(fb.ay, 26);

  // 旧来の絵は動きも向きもコマも 1 つに畳む（何度引いても焼くのは 1 回）
  const before = backend.uploads;
  for (let a = 0; a < 7; a++) for (let d = 0; d < 8; d++) sc.frame(slime, a, d, a + d);
  assert.equal(backend.uploads, before);
  // 光る所の無い旧来の絵は、光る所だけの仕上げで null
  assert.equal(sc.frame(slime, 0, 4, 0, FX_EMISSIVE), null);
  // 無い id は -1、無い番号は null
  assert.equal(sc.index('noSuchSpriteAnywhere'), -1);
  assert.equal(sc.frame(9999, 0, 0, 0), null);

  const legacy = legacyToRGBA({ palette: { a: '#102030' }, rows: ['a.', '.a'] }, 2);
  assert.equal(legacy.w, 4);
  assert.equal(legacy.h, 4);
  assert.equal(legacy.px[0], legacy.px[5]);
  assert.equal(legacy.px[2], 0);
});

test('返す入れ物は使い回し。同じコマは 2 度焼かない。向きと動きは同じ絵になる物を畳む', () => {
  const backend = new FakeBackend();
  const sc = new SheetCache({ backend });
  const s = sc.index('sheetTestBlob');
  assert.ok(s >= 0);
  assert.equal(sc.frameCount(s, animIndex('idle')), 4);
  assert.equal(sc.frameCount(s, animIndex('walk')), 4);
  // 持っていない動き（攻撃）は待機のコマ数
  assert.equal(sc.frameCount(s, animIndex('attack')), 4);

  const a = sc.frame(s, animIndex('idle'), 4, 0);
  const b = sc.frame(s, animIndex('idle'), 4, 1);
  assert.ok(a && b);
  assert.equal(a, b, '入れ物を使い回していない');
  assert.equal(a.w, 24);
  assert.equal(a.ay, 21);

  const n = backend.uploads;
  // 1 方向のリグ：東側の向き（0〜4）は同じ絵、西側（5〜7）は反転の 1 枚
  for (let d = 0; d <= 4; d++) sc.frame(s, animIndex('idle'), d, 0);
  assert.equal(backend.uploads, n);
  for (let d = 5; d <= 7; d++) sc.frame(s, animIndex('idle'), d, 0);
  assert.equal(backend.uploads, n + 1);
  // 持っていない動きは待機と同じ絵（焼き直さない）
  sc.frame(s, animIndex('attack'), 4, 0);
  sc.frame(s, animIndex('hurt'), 4, 1);
  assert.equal(backend.uploads, n + 1);
  // コマの番号はコマ数で折り返す
  sc.frame(s, animIndex('idle'), 4, 4 + 1);
  sc.frame(s, animIndex('idle'), 4, -3);
  assert.equal(backend.uploads, n + 1);
  // 仕上げが違えば別のコマ
  sc.frame(s, animIndex('idle'), 4, 0, FX_FLASH);
  assert.equal(backend.uploads, n + 2);

  // 光る所
  assert.equal(sc.frame(s, 0, 4, 0, FX_EMISSIVE), null);
  const g = sc.index('sheetTestGlow');
  assert.ok(sc.frame(g, 0, 4, 0, FX_EMISSIVE));
  assert.ok(sc.frame(s, 0, 4, 0, FX_OCCLUDER), '光らない絵でも黒い形は描く');
});

test('先焼き：持っている動き × 描く向き × コマを全部焼く', () => {
  const backend = new FakeBackend();
  const sc = new SheetCache({ backend });
  sc.prebake(['sheetTestBlob', 'slimeBlue', 'noSuchSpriteAnywhere']);
  // リグ：(待機 4 + 歩き 4) × 向き 2（手前・反転）= 16、旧来の絵 1
  assert.equal(backend.uploads, 17);
  const st = sc.stats();
  assert.equal(st.frames, 17);
  assert.equal(st.resident, 2);
  sc.prebake(['sheetTestBlob'], [FX_NORMAL, FX_FLASH]);
  assert.equal(backend.uploads, 17 + 16);
});

test('記憶の上限：超えたら長く使っていない種から頁を捨てる。keep 以外を捨てられる', () => {
  // 旧来の 16×16 の頁 1 枚 = 8 列 × 4 行 × (16+2)² × 4 バイト
  const page = 8 * 18 * 4 * 18 * 4;
  const backend = new FakeBackend();
  const sc = new SheetCache({ backend, capBytes: page * 2.5 });
  assert.equal(new SheetCache({ backend: new FakeBackend() }).capBytes, DEFAULT_CAP_BYTES);
  const ids = ['slimeBlue', 'slimeGreen', 'ratField', 'batCave'];
  const idx = ids.map((id) => sc.index(id));
  sc.frame(idx[0], 0, 4, 0);
  sc.frame(idx[1], 0, 4, 0);
  assert.equal(sc.bytes, page * 2);
  // 0 番をもう一度使う → 1 番がいちばん古い
  sc.frame(idx[0], 0, 4, 0);
  sc.frame(idx[2], 0, 4, 0);
  assert.ok(sc.bytes <= page * 2.5);
  assert.equal(backend.released, 1);
  const before = backend.uploads;
  sc.frame(idx[0], 0, 4, 0);
  assert.equal(backend.uploads, before, '最近使った種が捨てられた');
  sc.frame(idx[1], 0, 4, 0);
  assert.equal(backend.uploads, before + 1, '捨てた種は焼き直す');
  assert.ok(sc.bytes <= page * 2.5);

  sc.frame(idx[3], 0, 4, 0);
  sc.evictExcept(['batCave']);
  const st = sc.stats();
  assert.equal(st.resident, 1);
  assert.equal(sc.bytes, page);
  sc.clear();
  assert.equal(sc.bytes, 0);
  assert.equal(sc.stats().pages, 0);
});
