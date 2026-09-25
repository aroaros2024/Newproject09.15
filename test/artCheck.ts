/**
 * 種（敵・主人公）の絵を一通り描いて、約束を守っているか確かめる共通の道具。
 * 系統ごとのテスト（test/art-<系統>.test.ts）から checkSpecies(id) を呼ぶ。
 *
 * 見ること
 * - リグと種が登録されていて、材質の名前が正しい階調を指している
 * - 全部の向き × 動き × コマを描いて：塗りの下限・外周 1 ドットの余白・色数の上限
 * - 待機（手前向き）の見える大きさが段の枠の範囲
 * - 足元：待機の一番下の塗りが足元の行（ay）の近く（浮く種・沈む種は除く）
 * - 待機と歩きはコマで絵が変わる（止まって見えない）。攻撃には当たりのコマがある
 * - 同じコマを 2 回描くと同じ絵（ハッシュだけで決まる）
 * - 西向きは東向きの形の左右反転（光の縁取りの明るさは違ってよい）
 */

import assert from 'node:assert/strict';
import '../src/ui/art/index.js';
import { PAL_SIZE } from '../src/ui/art/palette.js';
import { PixBuf, bbox, countPainted, distinctColors, mirrorX } from '../src/ui/art/pixbuf.js';
import {
  ANIM_IDS, type AnimId, TIER_BOX, animOf, getRig, getSpecies, isRamp, renderFrame,
} from '../src/ui/art/rig.js';

/** 形だけ（塗ったかどうか）を外接の四角に揃えて文字列にする */
function shapeOf(b: PixBuf): string {
  const r = bbox(b);
  const rows: string[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    let s = '';
    for (let x = r.x; x < r.x + r.w; x++) s += b.get(x, y) ? '#' : '.';
    rows.push(s);
  }
  return rows.join('/');
}

export interface CheckOptions {
  /** 足元の確かめを省く（浮く・沈む・壁に張り付く種） */
  skipFoot?: boolean;
}

export function checkSpecies(id: string, o: CheckOptions = {}): void {
  const def = getSpecies(id);
  assert.ok(def, `種 ${id} が登録されていない`);
  const rig = getRig(def.rig);
  assert.ok(rig, `${id} のリグ ${def.rig} が無い`);
  for (const [name, ramp] of Object.entries(def.variant.ramps)) {
    assert.ok(isRamp(ramp), `${id} の材質 ${name} の階調 ${ramp} が無い`);
  }
  const box = TIER_BOX[rig.tier];
  const b = new PixBuf(box.w, box.h);
  const again = new PixBuf(box.w, box.h);
  assert.ok(rig.anims.idle, `${id} に待機が無い`);
  assert.ok(rig.anims.attack, `${id} に攻撃が無い`);
  for (const anim of ANIM_IDS) {
    const a = animOf(rig, anim as AnimId);
    if (!a || !rig.anims[anim as AnimId]) continue;
    if (anim === 'attack' || anim === 'cast') {
      assert.ok(a.strike !== undefined && a.strike >= 0 && a.strike < a.frames, `${id} の ${anim} に当たりのコマが無い`);
    }
    for (let dir8 = 0; dir8 < 8; dir8++) {
      const shapes = new Set<string>();
      for (let f = 0; f < a.frames; f++) {
        renderFrame(b, rig, def.variant, anim as AnimId, dir8, f);
        const where = `${id} ${anim} 向き${dir8} ${f} コマ目`;
        const n = countPainted(b);
        assert.ok(n >= box.minPainted * (anim === 'sleep' ? 0.6 : 0.8), `${where}：塗りが少ない（${n}）`);
        assert.ok(distinctColors(b) <= box.maxColors, `${where}：色が多い（${distinctColors(b)}）`);
        for (let i = 0; i < b.px.length; i++) assert.ok(b.px[i] < PAL_SIZE, `${where}：パレットの外の色`);
        for (let x = 0; x < box.w; x++) {
          assert.equal(b.get(x, 0), 0, `${where}：上の縁に掛かっている`);
          assert.equal(b.get(x, box.h - 1), 0, `${where}：下の縁に掛かっている`);
        }
        for (let y = 0; y < box.h; y++) {
          assert.equal(b.get(0, y), 0, `${where}：左の縁に掛かっている`);
          assert.equal(b.get(box.w - 1, y), 0, `${where}：右の縁に掛かっている`);
        }
        renderFrame(again, rig, def.variant, anim as AnimId, dir8, f);
        assert.deepEqual(again.px, b.px, `${where}：同じコマが同じ絵にならない`);
        shapes.add(b.px.join(','));
      }
      if ((anim === 'idle' || anim === 'walk') && a.frames > 1) {
        assert.ok(shapes.size >= 2, `${id} ${anim} 向き${dir8}：コマで絵が変わらない`);
      }
    }
  }
  // 待機・手前向きの見える大きさと足元
  renderFrame(b, rig, def.variant, 'idle', 4, 0);
  const r = bbox(b);
  assert.ok(r.w >= box.minW && r.w <= box.maxW + 2, `${id} の幅 ${r.w} が段 ${rig.tier} の範囲 ${box.minW}–${box.maxW} の外`);
  assert.ok(r.h >= box.minH && r.h <= box.maxH + 2, `${id} の高さ ${r.h} が段 ${rig.tier} の範囲 ${box.minH}–${box.maxH} の外`);
  if (!o.skipFoot && !rig.hover && !rig.submerge) {
    const bottom = r.y + r.h - 1;
    assert.ok(Math.abs(bottom - box.ay) <= 2, `${id} の足元 ${bottom} が ay=${box.ay} から離れている`);
  }
  // 西向き＝東向きの形の反転
  if (rig.dirs > 1) {
    const e = new PixBuf(box.w, box.h);
    const w = new PixBuf(box.w, box.h);
    renderFrame(e, rig, def.variant, 'idle', 2, 0);
    renderFrame(w, rig, def.variant, 'idle', 6, 0);
    mirrorX(w);
    assert.equal(shapeOf(w), shapeOf(e), `${id} の西向きが東向きの反転になっていない`);
  }
}

/** 同じ系統の種どうしが見分けられる（待機・手前向きの絵が全部違う） */
export function checkDistinct(ids: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const id of ids) {
    const def = getSpecies(id)!;
    const rig = getRig(def.rig)!;
    const box = TIER_BOX[rig.tier];
    const b = new PixBuf(box.w, box.h);
    renderFrame(b, rig, def.variant, 'idle', 4, 0);
    const sig = b.px.join(',');
    assert.ok(!seen.has(sig), `${id} と ${seen.get(sig)} が同じ絵`);
    seen.set(sig, id);
  }
}
