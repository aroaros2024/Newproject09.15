/**
 * 村の背景（夕暮れの広場）。DOM 無し。
 *
 * 村のメニューは画面の左に並ぶので、見どころ（井戸・道具屋・蔵・風車・天輪の塔）は右半分に置く。
 * タイトル（夜）と並べて同じ村だと分かるよう、家と風車と塔は共通の部品で描き、
 * 夕暮れの明るさ（DUSK：壁と屋根を 1 段明るく）にする。
 *
 *   0 空：夕焼けの雲（ドット）。空の色はなめらかなグラデーション
 *   1 遠景：山並みと天輪の塔（タイトルより近く大きい）
 *   2 中景：木立と遠くの屋根
 *   3 広場：石畳・家・蔵・井戸・道具屋・風車・灯籠（ぼかさない）
 *   4 手前：花と草（ぼかす）
 */

import { RAMP_GOLD, RAMP_HEAL, WHITE, ci } from '../palette.js';
import { PixBuf, disc, ellipse, hline, rect, vline } from '../pixbuf.js';
import { hash2 } from '../hash.js';
import type { AmbientSpec } from '../terrain/types.js';
import {
  DIORAMA_H, DIORAMA_W, DUSK, type Diorama, type DioramaLight, house, lantern, noise1, ridge,
  tower, trees, windmillBody,
} from './common.js';

/** 夕風に舞う綿毛（金のドット） */
const FLUFF: AmbientSpec = {
  name: '綿毛', region: 'view', cap: 24, rate: 4, life: [6, 10], ramp: RAMP_GOLD, glow: null,
  size: 1, flow: 1.8, gravity: -1,
};
/** 木の葉 */
const LEAVES: AmbientSpec = {
  name: '葉', region: 'view', cap: 16, rate: 3, life: [5, 9], ramp: RAMP_HEAL, glow: null,
  size: 1, flow: 1.5, gravity: 5,
};

/** 夕焼けの雲。低い日に下から照らされるので、下の縁が金、上へ行くほど薔薇色から紫へ */
function clouds(b: PixBuf): void {
  const bank = (cx: number, cy: number, w: number, seed: number): void => {
    const x0 = Math.round(cx - w / 2);
    // 下の段は横長の塊、上の段は小さな膨らみ
    for (let i = 0; i * 7 < w; i++) {
      const x = x0 + i * 7 + (hash2(i, 0, seed) % 4);
      const r = 3 + (hash2(i, 1, seed) % 3);
      ellipse(b, x, cy - (hash2(i, 2, seed) % 2), r + 3, r, 1);
      if (hash2(i, 3, seed) % 3 !== 0) ellipse(b, x + 3, cy - r - 1, r, r - 1, 1);
    }
    // 列ごとに、下からの距離で塗り分ける（1 は仮の印）
    for (let x = x0 - 12; x < x0 + w + 12; x++) {
      let top = -1;
      let bottom = -1;
      for (let y = cy - 14; y <= cy + 8; y++) {
        if (b.get(x, y) !== 1) continue;
        if (top < 0) top = y;
        bottom = y;
      }
      if (top < 0) continue;
      const h = Math.max(1, bottom - top);
      for (let y = top; y <= bottom; y++) {
        if (b.get(x, y) !== 1) continue;
        const t = (y - top) / h;
        const c = y === bottom ? ci('gold', 5) : t > 0.75 ? ci('gold', 4) : t > 0.5 ? ci('rose', 4)
          : t > 0.2 ? ci('rose', 3) : ci('violet', 3);
        b.set(x, y, c);
      }
    }
  };
  bank(120, 44, 90, 1);
  bank(262, 66, 120, 2);
  bank(410, 36, 60, 3);
  bank(36, 92, 56, 4);
}

/** 遠景：山並みと、近くて大きい天輪の塔 */
function far(b: PixBuf, lights: DioramaLight[]): void {
  ridge(b, (x) => Math.round(142 + 30 * noise1(x / 80, 111) - 16 * noise1(x / 25, 112)),
    ci('violet', 1), ci('rose', 2));
  tower(b, 356, 26, 176, lights, 1, DUSK, 1.3);
}

function mid(b: PixBuf, lights: DioramaLight[]): void {
  const hill = (x: number): number => Math.round(180 + 8 * noise1(x / 50, 121) - 5 * noise1(x / 17, 122));
  for (let x = 0; x < DIORAMA_W; x++) vline(b, x, hill(x), DIORAMA_H - hill(x), ci('moss', 1));
  trees(b, 36, 131, hill, ci('moss', 1), ci('leaf', 2), (x) => x > 338 && x < 374);
  // 遠くの屋根
  for (const x of [40, 110, 300]) {
    const y = hill(x) + 1;
    for (let r = 0; r < 5; r++) hline(b, x - 4 - r, y - 5 + r, 9 + r * 2, ci('earth', 2));
    b.set(x, y - 1, ci('gold', 5));
    lights.push({ x, y: y - 1, radius: 7, color: '#ffc46a', intensity: 0.3, layer: 2, flicker: true });
  }
}

/** 蔵（白壁・黒瓦・家紋） */
function storehouse(b: PixBuf, x: number, ground: number, w: number): void {
  const wallH = 22;
  rect(b, x, ground - wallH, w, wallH, ci('bone', 4));
  vline(b, x, ground - wallH, wallH, ci('bone', 5));
  vline(b, x + w - 1, ground - wallH, wallH, ci('bone', 3));
  // 腰のなまこ壁
  rect(b, x, ground - 7, w, 7, ci('ink', 2));
  for (let i = 0; i < w; i += 4) {
    b.set(x + i, ground - 6, ci('bone', 4));
    b.set(x + i + 2, ground - 3, ci('bone', 4));
  }
  // 家紋（菱）
  const cx = x + Math.floor(w / 2);
  for (const [dx, dy] of [[0, -3], [-1, -2], [1, -2], [-2, -1], [2, -1], [-3, 0], [3, 0], [-2, 1], [2, 1], [-1, 2], [1, 2], [0, 3]]) {
    b.set(cx + dx, ground - 15 + dy, ci('ink', 1));
  }
  b.set(cx, ground - 15, ci('ink', 1));
  // 黒瓦の屋根
  for (let r = 0; r < 9; r++) {
    const y = ground - wallH - 9 + r;
    const half = Math.round(w / 2 - 6 + r * 1.2);
    hline(b, cx - half, y, half * 2, r < 3 ? ci('ink', 2) : ci('ink', 1));
    if (r % 2 === 0) for (let xx = cx - half; xx < cx + half; xx += 3) b.set(xx, y, ci('ink', 3));
  }
  hline(b, cx - Math.round(w / 2 - 6) - 1, ground - wallH - 10, Math.round(w - 10), ci('ink', 3));
}

/** 井戸（石の縁と小さな屋根、釣瓶） */
function well(b: PixBuf, x: number, ground: number): void {
  ellipse(b, x, ground - 4, 8, 3, ci('stone', 3));
  rect(b, x - 8, ground - 4, 17, 4, ci('stone', 2));
  ellipse(b, x, ground - 5, 6, 2, ci('ink', 1));
  for (let i = -8; i <= 8; i += 3) b.set(x + i, ground - 2, ci('stone', 1));
  vline(b, x - 7, ground - 20, 16, ci('earth', 2));
  vline(b, x + 7, ground - 20, 16, ci('earth', 1));
  for (let r = 0; r < 4; r++) hline(b, x - 9 - r, ground - 24 + r, 19 + r * 2, ci('earth', r < 2 ? 3 : 2));
  vline(b, x, ground - 20, 10, ci('bone', 3));
  rect(b, x - 1, ground - 11, 3, 3, ci('earth', 3));
}

/** 道具屋（藍の暖簾・看板・店先の品） */
function shopFront(b: PixBuf, x: number, ground: number, w: number, lights: DioramaLight[]): void {
  house(b, x, ground, w, lights, 17, DUSK);
  // 暖簾（藍に白い印）
  const nx = x + 4;
  for (let i = 0; i < 4; i++) {
    rect(b, nx + i * 5, ground - 16, 4, 8, ci('indigo', 2));
    vline(b, nx + i * 5, ground - 16, 8, ci('indigo', 3));
  }
  b.set(nx + 7, ground - 12, ci('bone', 5));
  b.set(nx + 8, ground - 12, ci('bone', 5));
  b.set(nx + 12, ground - 12, ci('bone', 5));
  // 看板
  rect(b, x + w - 14, ground - 30, 12, 6, ci('earth', 3));
  hline(b, x + w - 13, ground - 28, 10, ci('ink', 1));
  // 店先の樽と壺
  disc(b, x + w + 4, ground - 4, 3, ci('earth', 3));
  hline(b, x + w + 1, ground - 5, 7, ci('earth', 1));
  ellipse(b, x + w + 11, ground - 4, 3, 4, ci('crimson', 2));
  b.set(x + w + 10, ground - 6, ci('crimson', 4));
}

/** 広場（石畳・建物） */
function plaza(b: PixBuf, lights: DioramaLight[]): { x: number; y: number } {
  const ground = (x: number): number => Math.round(198 + 3 * noise1(x / 45, 141));
  for (let x = 0; x < DIORAMA_W; x++) {
    const g = ground(x);
    vline(b, x, g, DIORAMA_H - g, ci('moss', 2));
    b.set(x, g, ci('moss', 3));
  }
  // 石畳（奥ほど目が細かい）
  for (let y = 206; y < DIORAMA_H; y++) {
    const t = (y - 206) / (DIORAMA_H - 206);
    const cx = 262;
    const half = Math.round(60 + t * 150);
    const row = Math.floor((y - 206) / (3 + t * 5));
    for (let x = cx - half; x < cx + half; x++) {
      const cell = Math.floor((x + row * 5) / (6 + t * 8));
      const edge = (y - 206) % Math.round(3 + t * 5) === 0 || (x + row * 5) % Math.round(6 + t * 8) === 0;
      const tone = hash2(cell, row, 151) % 3;
      b.set(x, y, edge ? ci('stone', 2) : ci('stone', 3 + (tone === 0 ? 1 : 0)));
    }
  }
  house(b, 158, ground(178), 40, lights, 11, DUSK);
  storehouse(b, 206, ground(224), 34);
  well(b, 262, 214);
  shopFront(b, 290, ground(318), 52, lights);
  const hub = windmillBody(b, 420, ground(420), lights, DUSK);
  lantern(b, 246, 214, lights, 0.5);
  lantern(b, 284, 214, lights, 0.5);
  // 花の鉢
  for (const [x, c] of [[200, 'rose'], [352, 'gold']] as const) {
    rect(b, x - 2, ground(x) - 4, 5, 4, ci('earth', 2));
    disc(b, x, ground(x) - 6, 2, ci(c, 4));
    b.set(x - 1, ground(x) - 7, ci(c, 5));
  }
  return hub;
}

function near(b: PixBuf): void {
  const top = (x: number): number => Math.round(228 + 7 * noise1(x / 26, 161));
  for (let x = 0; x < DIORAMA_W; x++) {
    if (x > 200 && x < 330) continue; // 広場の手前は空ける
    const t = top(x);
    vline(b, x, t, DIORAMA_H - t, ci('moss', 0));
    if (hash2(x, 0, 162) % 3 === 0) {
      const h = 3 + (hash2(x, 1, 162) % 7);
      vline(b, x, t - h, h, ci('moss', 1));
      if (hash2(x, 2, 162) % 5 === 0) b.set(x, t - h - 1, hash2(x, 3, 162) % 2 ? ci('rose', 4) : WHITE);
    }
  }
}

/** 村の背景を組み立てる（呼ぶたびに同じ絵） */
export function buildTownDiorama(): Diorama {
  const lights: DioramaLight[] = [];
  const L = (): PixBuf => new PixBuf(DIORAMA_W, DIORAMA_H);
  const l0 = L();
  clouds(l0);
  const l1 = L();
  far(l1, lights);
  const l2 = L();
  mid(l2, lights);
  const l3 = L();
  const windmill = plaza(l3, lights);
  const l4 = L();
  near(l4);
  // 沈む日の名残り（左の低い所。メニューの奥から差す）
  lights.push({ x: 90, y: 150, radius: 110, color: '#ffb070', intensity: 0.45, layer: 0, flicker: false });
  return {
    sky: [[0, '#2b2f66'], [0.3, '#5d4684'], [0.55, '#c9727a'], [0.72, '#f0a868'], [0.85, '#f6cf8a']],
    layers: [
      { buf: l0, parallax: 0.12, blur: 0 },
      { buf: l1, parallax: 0.3, blur: 1 },
      { buf: l2, parallax: 0.55, blur: 1 },
      { buf: l3, parallax: 1, blur: 0 },
      { buf: l4, parallax: 1.5, blur: 2 },
    ],
    lights,
    stars: [],
    windmill,
    ambient: [FLUFF, LEAVES],
    vignette: 0.45,
  };
}
