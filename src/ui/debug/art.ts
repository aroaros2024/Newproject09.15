/**
 * 検証用の場面（ドット絵の見本帳）。URL に ?scene=art:… を付けると開く。
 *
 *   ?scene=art:palette                 パレットの全色
 *   ?scene=art:species:<種の id>        その種の全部の動き × 向き × コマ
 *   ?scene=art:rig:<リグの id>          そのリグを使う全部の種
 *   ?scene=art:lineup                  全部の種の待機（手前向き）を段ごとに並べる
 *   ?scene=art:lineup&tier=L           段を絞る
 *
 * 付けられるもの：&scale=4（拡大率）&gray=1（明るさだけで見る）
 *
 * ゲームの画面は使わず、ページに大きなキャンバス（#sheet）を 1 枚作って描く。
 * tools/shots.mjs はこのキャンバスを撮る。
 */

import '../art/index.js';
import { PAL_HEX, PAL_SIZE, RAMPS, STEPS, WHITE, ci, luminance } from '../art/palette.js';
import { PixBuf } from '../art/pixbuf.js';
import {
  ANIM_IDS, type AnimId, type Rig, type SpeciesDef, TIER_BOX, type Tier, allSpeciesIds,
  animOf, getRig, getSpecies, renderFrame,
} from '../art/rig.js';
import { PAL_RGBA } from '../art/palette.js';

const BG_GREY = '#5a5f6e';
const BG_DARK = '#14121c';
const BG_WARM = '#6b5a44';

/** 描く向き（8 方向の番号）。反転した西向きも 1 つ見せる */
function dirsToShow(rig: Rig): number[] {
  if (rig.dirs === 5) return [4, 3, 2, 1, 0, 6];
  if (rig.dirs === 3) return [4, 2, 0, 6];
  return [4, 6];
}

const DIR_LABEL = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W(反転)', 'NW'];

interface Sheet {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

function makeSheet(w: number, h: number, bg = BG_GREY): Sheet {
  const game = document.getElementById('game');
  if (game) game.style.display = 'none';
  const stage = document.getElementById('stage');
  if (stage) stage.style.display = 'block';
  document.body.style.overflow = 'auto';
  const canvas = document.createElement('canvas');
  canvas.id = 'sheet';
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  canvas.style.imageRendering = 'pixelated';
  canvas.style.display = 'block';
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D コンテキストを取得できませんでした');
  g.imageSmoothingEnabled = false;
  g.fillStyle = bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, g };
}

/** 画用紙を拡大して描く。gray なら明るさだけにする */
function blit(g: CanvasRenderingContext2D, b: PixBuf, x: number, y: number, k: number,
  gray = false): void {
  const img = new ImageData(b.w, b.h);
  const u32 = new Uint32Array(img.data.buffer);
  for (let i = 0; i < b.px.length; i++) {
    const c = b.px[i];
    if (c === 0) continue;
    if (gray) {
      const v = Math.round(Math.sqrt(luminance(c)) * 255);
      u32[i] = ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
    } else {
      u32[i] = PAL_RGBA[c];
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = b.w;
  tmp.height = b.h;
  const tg = tmp.getContext('2d');
  if (!tg) return;
  tg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, Math.round(x), Math.round(y), b.w * k, b.h * k);
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number,
  color = '#f1ebdd', size = 14): void {
  g.font = `${size}px monospace`;
  g.fillStyle = color;
  g.textBaseline = 'top';
  g.fillText(text, x, y);
}

// ---------------------------------------------------------------------------

function palette(): void {
  const cell = 40;
  const { g } = makeSheet(120 + STEPS * cell, 40 + (RAMPS.length + 1) * cell, BG_DARK);
  RAMPS.forEach((name, r) => {
    label(g, name, 8, 30 + r * cell + 12);
    for (let s = 0; s < STEPS; s++) {
      g.fillStyle = PAL_HEX[ci(r, s)];
      g.fillRect(100 + s * cell, 30 + r * cell, cell - 4, cell - 4);
    }
  });
  label(g, 'white', 8, 30 + RAMPS.length * cell + 12);
  g.fillStyle = PAL_HEX[WHITE];
  g.fillRect(100, 30 + RAMPS.length * cell, cell - 4, cell - 4);
  label(g, `${PAL_SIZE - 1} colors`, 8, 6);
}

/** 1 つの種の見本帳 */
function speciesSheet(id: string, k: number, gray: boolean, sheet?: Sheet, top = 0): number {
  const def = getSpecies(id);
  const rig = def ? getRig(def.rig) : undefined;
  if (!def || !rig) {
    if (!sheet) {
      const s = makeSheet(600, 60, BG_DARK);
      label(s.g, `種 ${id} が見つからない`, 10, 20, '#ff8080');
    }
    return 0;
  }
  const box = TIER_BOX[rig.tier];
  const dirs = dirsToShow(rig);
  const anims = ANIM_IDS.filter((a) => rig.anims[a]);
  const maxFrames = Math.max(...anims.map((a) => rig.anims[a]?.frames ?? 1));
  const cellW = box.w * k + 6;
  const cellH = box.h * k + 6;
  const rowsH = anims.length * dirs.length * cellH;
  const width = 140 + maxFrames * cellW + 3 * (box.w * 3 + 12) + 40;
  const height = 40 + rowsH + 20;
  const s = sheet ?? makeSheet(width, height);
  const g = s.g;
  label(g, `${id}  rig=${rig.id}  tier=${rig.tier}  dirs=${rig.dirs}`, 10, top + 10);
  const buf = new PixBuf(box.w, box.h);
  let y = top + 36;
  for (const a of anims) {
    const anim = animOf(rig, a as AnimId);
    if (!anim) continue;
    for (const d of dirs) {
      label(g, `${a}${anim.strike !== undefined ? `*${anim.strike}` : ''} ${DIR_LABEL[d]}`,
        8, y + cellH / 2 - 8, '#e8d6a0', 12);
      for (let f = 0; f < anim.frames; f++) {
        renderFrame(buf, rig, def.variant, a as AnimId, d, f);
        const x = 140 + f * cellW;
        g.fillStyle = '#4a4f5c';
        g.fillRect(x, y, box.w * k, box.h * k);
        // 足元の目印
        g.fillStyle = '#ff5a5a';
        g.fillRect(x + box.ax * k, y + box.ay * k, k, 1);
        blit(g, buf, x, y, k, gray);
      }
      y += cellH;
    }
  }
  // 実寸（3 倍）で 3 つの背景に置く
  renderFrame(buf, rig, def.variant, 'idle', 4, 0);
  const bx = 140 + maxFrames * cellW + 20;
  [BG_DARK, BG_GREY, BG_WARM].forEach((bg, i) => {
    const x = bx + i * (box.w * 3 + 12);
    g.fillStyle = bg;
    g.fillRect(x, top + 36, box.w * 3, box.h * 3);
    blit(g, buf, x, top + 36, 3, gray);
  });
  return height;
}

function rigSheet(rigId: string, k: number, gray: boolean): void {
  const ids = allSpeciesIds().filter((id) => getSpecies(id)?.rig === rigId);
  if (ids.length === 0) {
    const s = makeSheet(600, 60, BG_DARK);
    label(s.g, `リグ ${rigId} を使う種が無い`, 10, 20, '#ff8080');
    return;
  }
  // 大きさを先に測る
  const rig = getRig(rigId);
  if (!rig) return;
  const box = TIER_BOX[rig.tier];
  const anims = ANIM_IDS.filter((a) => rig.anims[a]);
  const dirs = dirsToShow(rig);
  const maxFrames = Math.max(...anims.map((a) => rig.anims[a]?.frames ?? 1));
  const per = 40 + anims.length * dirs.length * (box.h * k + 6) + 20;
  const width = 140 + maxFrames * (box.w * k + 6) + 3 * (box.w * 3 + 12) + 40;
  const s = makeSheet(width, per * ids.length);
  ids.forEach((id, i) => speciesSheet(id, k, gray, s, i * per));
}

/** 全部の種の待機を段ごとに並べる（監督役が絵柄の揃いを見る） */
function lineup(tierFilter: Tier | null, gray: boolean): void {
  const ids = allSpeciesIds().filter((id) => {
    const def = getSpecies(id);
    const rig = def ? getRig(def.rig) : undefined;
    return rig && (!tierFilter || rig.tier === tierFilter);
  });
  const tiers: Tier[] = ['hero', 'S', 'M', 'L', 'boss'];
  const k = 3;
  const width = 1600;
  // 先に高さを数える
  let height = 20;
  const plan: { tier: Tier; ids: string[] }[] = [];
  for (const t of tiers) {
    const list = ids.filter((id) => getRig(getSpecies(id)!.rig)!.tier === t);
    if (list.length === 0) continue;
    const box = TIER_BOX[t];
    const perRow = Math.max(1, Math.floor((width - 20) / (box.w * k + 10)));
    height += 30 + Math.ceil(list.length / perRow) * (box.h * k + 24);
    plan.push({ tier: t, ids: list });
  }
  const { g } = makeSheet(width, height, BG_DARK);
  let y = 10;
  for (const { tier, ids: list } of plan) {
    const box = TIER_BOX[tier];
    label(g, `tier ${tier}  (${list.length})`, 10, y);
    y += 26;
    const perRow = Math.max(1, Math.floor((width - 20) / (box.w * k + 10)));
    const buf = new PixBuf(box.w, box.h);
    list.forEach((id, i) => {
      const def = getSpecies(id) as SpeciesDef;
      const rig = getRig(def.rig) as Rig;
      const x = 10 + (i % perRow) * (box.w * k + 10);
      const yy = y + Math.floor(i / perRow) * (box.h * k + 24);
      g.fillStyle = '#26232f';
      g.fillRect(x, yy, box.w * k, box.h * k);
      renderFrame(buf, rig, def.variant, 'idle', 4, 0);
      blit(g, buf, x, yy, k, gray);
      label(g, id, x, yy + box.h * k + 4, '#a9a391', 11);
    });
    y += Math.ceil(list.length / perRow) * (box.h * k + 24);
  }
}

/** ?scene=art:… を開く */
export function open(spec: string, params: URLSearchParams): void {
  const parts = spec.split(':');
  const k = Math.max(1, Math.min(8, Number(params.get('scale') ?? 4)));
  const gray = params.get('gray') === '1';
  switch (parts[1]) {
    case 'palette':
      palette();
      return;
    case 'species':
      speciesSheet(parts[2] ?? '', k, gray);
      return;
    case 'rig':
      rigSheet(parts[2] ?? '', k, gray);
      return;
    case 'lineup':
      lineup((params.get('tier') as Tier | null) ?? null, gray);
      return;
    default: {
      const { g } = makeSheet(600, 60, BG_DARK);
      label(g, `知らない場面: ${spec}`, 10, 20, '#ff8080');
    }
  }
}
