/**
 * 検証用の場面（粒子とカールノイズの流れ場）。URL に ?scene=fx:… を付けると開く。
 *
 *   ?scene=fx:particles     塵・光の粒・蛍・火の粉が流れに乗って漂う中で、
 *                           魔法・火・回復の粒が 1.5 秒ごとに弾け、仮の絵が 3 秒ごとに粒になって崩れる
 *     &field=1              格子点ごとの流れの向きを線で重ねる（渦の形を見る）
 *     &trail=1              ドットの粒の軌跡を残す（止め絵で流れの形を見る）
 *     &bloom=0              光る粒のにじみを切る
 *     &stress=1             技の粒を上限まで出し続ける（重さを測る）
 *     &bursts=0             技の粒と崩れる絵を止める（&trail=1 と合わせて流れだけを見る）
 *   ?scene=fx:curl          流れ場そのもの。48×32 マスの全体を t=0 秒と t=5 秒で並べる
 *                           （背景の明暗が ψ、線が流線、矢印が格子点の速度）
 *
 * ゲームの画面は使わず、ページに #sheet のキャンバスを 1 枚作って描く（tools/shots.mjs が撮る）。
 * 乱数は場面ごとに種を固定した表示用の Rng。撮り直しても同じ粒が出る。
 */

import { Rng } from '../../core/rng.js';
import {
  PAL_CSS, RAMP_EMBER, RAMP_HEAL, RAMP_MAGIC, RAMP_DUST, ci,
} from '../art/palette.js';
import { PixBuf, ellipse, rect, runs } from '../art/pixbuf.js';
import { finalize } from '../art/shade.js';
import type { AmbientRegion, AmbientSpec } from '../art/terrain/types.js';
import { CURL_GRID_DIORAMA, CURL_GRID_DUNGEON, CurlField } from '../gfx-core/curl.js';
import {
  type BurstSpec, KIND_HD, KIND_PIXEL, ParticlePool, type SpawnPointFn,
} from '../gfx-core/particles.js';
import { ctx2d, makeCanvas, pixBufToCanvas } from '../gfx/canvas.js';
import {
  type ParticleXform, drawEmissive, drawHDParticles, drawPixelParticles, makeHDAtlas,
} from '../gfx/particlesDraw.js';
import { ART_H, ART_SCALE, ART_W } from '../gfx/view.js';

const TICK_S = 1 / 60;
/** 1 回の描画で追いつく刻みの上限（タブが裏にいた後に何百刻みも回さない） */
const MAX_CATCH_UP = 5;

function makeSheet(w: number, h: number, bg: string): CanvasRenderingContext2D {
  const stage = document.getElementById('stage');
  if (stage) stage.style.display = 'none';
  const game = document.getElementById('game');
  if (game) game.style.display = 'none';
  document.body.style.display = 'block';
  document.body.style.overflow = 'auto';
  const canvas = document.createElement('canvas');
  canvas.id = 'sheet';
  canvas.width = w;
  canvas.height = h;
  canvas.style.imageRendering = 'pixelated';
  canvas.style.display = 'block';
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D コンテキストを取得できませんでした');
  g.imageSmoothingEnabled = false;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  return g;
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number,
  color = '#f1ebdd', size = 14): void {
  g.font = `${size}px monospace`;
  g.textBaseline = 'top';
  g.fillStyle = 'rgba(8,8,14,0.7)';
  g.fillRect(x - 4, y - 3, g.measureText(text).width + 8, size + 6);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// fx:particles
// ---------------------------------------------------------------------------

/** 壁に見立てた矩形（ドット）。流れは壁を知らないので、粒は上を素通りする */
const WALLS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 428, 20],
  [0, 20, 24, 220],
  [404, 20, 24, 220],
  [120, 88, 64, 28],
  [272, 150, 48, 40],
];

/** 松明（火の粉の出どころ） */
const TORCHES: readonly (readonly [number, number])[] = [[60, 14], [230, 14], [372, 14], [152, 84]];

/** 光の筋（光の粒の出どころ）：左上から右下へ斜めの帯 */
const SHAFT = { x0: 190, y0: 20, dx: 70, w: 44, h: 200 } as const;

const DUST: AmbientSpec = {
  name: '塵', region: 'view', cap: 80, rate: 18, life: [4, 8], ramp: RAMP_DUST, glow: null,
  size: 1, flow: 1, gravity: 0,
};
const MOTES: AmbientSpec = {
  name: '光の粒', region: 'shaft', cap: 26, rate: 6, life: [3, 6], ramp: null, glow: '#e8d6a0',
  size: 2.5, flow: 1.4, gravity: -3, emissive: true,
};
const FIREFLIES: AmbientSpec = {
  name: '蛍', region: 'view', cap: 10, rate: 2, life: [5, 9], ramp: null, glow: '#c5e07a',
  size: 2, flow: 0.8, gravity: 0, blink: true, emissive: true,
};
const TORCH_EMBERS: AmbientSpec = {
  name: '火の粉', region: 'torch', cap: 24, rate: 12, life: [1, 2.2], ramp: RAMP_EMBER, glow: null,
  size: 1, flow: 1.3, gravity: -16, emissive: true,
};

const TAU = Math.PI * 2;

const MAGIC_PX: BurstSpec = {
  count: 40, speed: [35, 90], spread: TAU, life: [0.8, 1.6], size: 1, ramp: RAMP_MAGIC,
  kind: KIND_PIXEL, gain: 1.8, drag: 2.5, gravity: 0, flowRamp: 2, radius: 3, emissive: true,
};
const MAGIC_HD: BurstSpec = {
  count: 10, speed: [12, 40], spread: TAU, life: [0.5, 1.0], size: 4, ramp: RAMP_MAGIC,
  kind: KIND_HD, gain: 1.5, drag: 3, gravity: 0, flowRamp: 2, emissive: true,
};
const EMBER_PX: BurstSpec = {
  count: 44, speed: [50, 130], spread: 1.5, life: [0.8, 1.7], size: 1, ramp: RAMP_EMBER,
  kind: KIND_PIXEL, gain: 1.4, drag: 1.6, gravity: 70, flowRamp: 1.2, emissive: true,
};
const EMBER_HD: BurstSpec = {
  count: 6, speed: [10, 30], spread: TAU, life: [0.25, 0.55], size: 6, ramp: RAMP_EMBER,
  kind: KIND_HD, gain: 1, drag: 3, gravity: 0, flowRamp: 0, emissive: true,
};
const HEAL_PX: BurstSpec = {
  count: 32, speed: [8, 26], spread: TAU, life: [1.0, 1.9], size: 1, ramp: RAMP_HEAL,
  kind: KIND_PIXEL, gain: 1, drag: 2, gravity: -28, flowRamp: 1, radius: 9, emissive: true,
};
const HEAL_HD: BurstSpec = {
  count: 10, speed: [5, 15], spread: TAU, life: [0.8, 1.4], size: 3, ramp: RAMP_HEAL,
  kind: KIND_HD, gain: 1, drag: 2, gravity: -20, flowRamp: 1, radius: 8, emissive: true,
};
/** 重さを測るための、上限まで出し続ける粒 */
const STRESS_PX: BurstSpec = {
  count: 60, speed: [20, 70], spread: TAU, life: [2, 4], size: 1, ramp: RAMP_MAGIC,
  kind: KIND_PIXEL, gain: 1.5, drag: 2, gravity: 0, flowRamp: 1, radius: 4,
};

/** 弾ける場所（種類ごとに 3 か所を順に回る） */
const SPOTS: readonly (readonly (readonly [number, number])[])[] = [
  [[90, 150], [330, 90], [220, 200]],
  [[340, 210], [70, 70], [200, 130]],
  [[250, 70], [120, 200], [370, 150]],
];

/** 崩れる仮の絵（M の段の大きさ 32×40 の、フードをかぶった魔導士の形） */
function makeTestSprite(): PixBuf {
  const b = new PixBuf(32, 40);
  const robe = ci('violet', 2);
  ellipse(b, 16, 30, 9, 8, robe);
  rect(b, 8, 26, 17, 11, robe);
  ellipse(b, 16, 16, 7, 7, ci('violet', 3));
  ellipse(b, 16, 17, 4, 4, ci('ink', 1));
  rect(b, 12, 24, 9, 12, ci('violet', 3));
  rect(b, 15, 24, 2, 12, ci('gold', 3));
  runs(b, 13, 16, ['e..e'], { e: ci('ember', 5) });
  // 杖
  rect(b, 25, 12, 1, 25, ci('earth', 3));
  ellipse(b, 25, 10, 2, 2, ci('sky', 5));
  finalize(b);
  return b;
}

function particlesScene(params: URLSearchParams): void {
  const W = ART_W * ART_SCALE;
  const H = ART_H * ART_SCALE;
  const g = makeSheet(W, H, '#0a0910');
  const showField = params.get('field') === '1';
  const trail = params.get('trail') === '1';
  const bloom = params.get('bloom') !== '0';
  const stress = params.get('stress') === '1';
  const bursts = params.get('bursts') !== '0';

  const rng = new Rng('fx:particles');
  // 画面 428×240 ドットを覆うジオラマ用の格子（28×16 マス）
  const field = new CurlField(CURL_GRID_DIORAMA);
  const pool = new ParticlePool(2048, rng);
  const atlas = makeHDAtlas();

  const spawn: SpawnPointFn = (region: AmbientRegion, out: Float32Array, r: Rng): boolean => {
    if (region === 'torch') {
      const t = TORCHES[r.int(TORCHES.length)];
      out[0] = t[0] + (r.float() - 0.5) * 4;
      out[1] = t[1] - 2 - r.float() * 3;
      return true;
    }
    if (region === 'shaft') {
      const v = r.float();
      out[0] = SHAFT.x0 + SHAFT.dx * v + r.float() * SHAFT.w;
      out[1] = SHAFT.y0 + SHAFT.h * v;
      return true;
    }
    out[0] = 24 + r.float() * (ART_W - 48);
    out[1] = 20 + r.float() * (ART_H - 20);
    return true;
  };
  pool.addAmbient(DUST, spawn);
  pool.addAmbient(MOTES, spawn);
  pool.addAmbient(FIREFLIES, spawn);
  pool.addAmbient(TORCH_EMBERS, spawn);
  pool.prewarm(field, 6);

  // 画用紙（ドット）と、その上の粒の層
  const art = makeCanvas(ART_W, ART_H);
  const ag = ctx2d(art);
  const bg = makeCanvas(ART_W, ART_H);
  paintBackground(ctx2d(bg));
  const trailCanvas = makeCanvas(ART_W, ART_H);
  const tg = ctx2d(trailCanvas);
  // ブルームの層（画面の 1/4）
  const glow = makeCanvas(W / 4, H / 4);
  const gg = ctx2d(glow);
  const glowXf: ParticleXform = { scale: ART_SCALE / 4, offX: 0, offY: 0 };
  const screenXf: ParticleXform = { scale: ART_SCALE, offX: 0, offY: 0 };

  const sprite = makeTestSprite();
  const spriteCanvas = pixBufToCanvas(sprite);
  const spriteX = 300;
  const spriteY = 40;
  let spriteAlive = true;

  const stepMs = new Float64Array(60);
  let stepMsAt = 0;
  let tickNo = 0;
  let acc = 0;
  let lastT = -1;
  const flowOut = new Float64Array(2);

  const tick = (): void => {
    const t0 = performance.now();
    // 1.5 秒（90 刻み）ごとに、種類ごとに 0.5 秒ずらして弾ける
    const phase = bursts ? tickNo % 90 : -1;
    const round = Math.floor(tickNo / 90);
    if (phase === 0) {
      const [x, y] = SPOTS[0][round % 3];
      pool.burst(MAGIC_PX, x, y);
      pool.burst(MAGIC_HD, x, y);
    } else if (phase === 30) {
      const [x, y] = SPOTS[1][round % 3];
      pool.burst(EMBER_PX, x, y, 0, -1);
      pool.burst(EMBER_HD, x, y);
    } else if (phase === 60) {
      const [x, y] = SPOTS[2][round % 3];
      pool.burst(HEAL_PX, x, y);
      pool.burst(HEAL_HD, x, y);
    }
    // 3 秒ごと：1.5 秒見せて崩す
    const sp = bursts ? tickNo % 180 : -1;
    if (sp === 90) {
      pool.fromSprite(sprite, spriteX, spriteY, 1);
      spriteAlive = false;
    } else if (sp === 0) {
      spriteAlive = true;
    }
    if (stress) pool.burst(STRESS_PX, 60 + rng.float() * 300, 40 + rng.float() * 180);
    field.tick();
    pool.step(TICK_S, field);
    stepMs[stepMsAt] = performance.now() - t0;
    stepMsAt = (stepMsAt + 1) % stepMs.length;
    tickNo++;
  };

  const draw = (): void => {
    // 画用紙：背景 → 仮の絵 → ドットの粒
    ag.globalCompositeOperation = 'source-over';
    ag.drawImage(bg, 0, 0);
    if (spriteAlive) ag.drawImage(spriteCanvas, spriteX, spriteY);
    if (trail) {
      // 前のフレームの粒を少しずつ消して、軌跡として残す。
      // 薄くしすぎると 8bit の丸めで消え残りが灰色の染みになるので 3.5% ずつ
      tg.globalCompositeOperation = 'destination-out';
      tg.fillStyle = 'rgba(0,0,0,0.035)';
      tg.fillRect(0, 0, ART_W, ART_H);
      tg.globalCompositeOperation = 'source-over';
      drawPixelParticles(tg, pool, 0, 0);
      ag.drawImage(trailCanvas, 0, 0);
    } else {
      drawPixelParticles(ag, pool, 0, 0);
    }
    // 画面へ 3 倍（最近傍）
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(art, 0, 0, W, H);
    // HD の粒（画面の実画素）
    drawHDParticles(g, pool, screenXf, atlas);
    if (bloom) {
      gg.clearRect(0, 0, glow.width, glow.height);
      drawEmissive(gg, pool, glowXf, atlas);
      // 1/4 の紙をなめらかに拡大して足す（ぼかしの代わり）
      g.imageSmoothingEnabled = true;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.55;
      g.drawImage(glow, 0, 0, W, H);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.imageSmoothingEnabled = false;
    }
    if (showField) drawFieldOverlay(g, field, flowOut);
    let sum = 0;
    for (let i = 0; i < stepMs.length; i++) sum += stepMs[i];
    const n = Math.min(tickNo, stepMs.length);
    label(g, `粒 ${pool.count} / ${pool.capacity}（環境 ${pool.ambientCount}）  `
      + `1 刻み ${(n ? sum / n : 0).toFixed(3)} ms（直近 ${n} 刻みの平均）  t=${field.time.toFixed(1)}s`,
    12, H - 28);
  };

  const frame = (now: number): void => {
    if (lastT < 0) lastT = now;
    acc += (now - lastT) / 1000;
    lastT = now;
    let steps = 0;
    while (acc >= TICK_S && steps < MAX_CATCH_UP) {
      tick();
      acc -= TICK_S;
      steps++;
    }
    if (steps === MAX_CATCH_UP) acc = 0;
    draw();
    requestAnimationFrame(frame);
  };
  draw();
  requestAnimationFrame(frame);
}

/** 床・壁・松明を画用紙に描く（1 回だけ） */
function paintBackground(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void {
  g.fillStyle = PAL_CSS[ci('ink', 1)];
  g.fillRect(0, 0, ART_W, ART_H);
  // 床の格子（1 マス 16 ドット）をうっすら
  g.fillStyle = PAL_CSS[ci('ink', 0)];
  for (let x = 0; x < ART_W; x += 16) g.fillRect(x, 0, 1, ART_H);
  for (let y = 0; y < ART_H; y += 16) g.fillRect(0, y, ART_W, 1);
  for (const [x, y, w, h] of WALLS) {
    // 上の縁 4 ドット ＋ 正面
    g.fillStyle = PAL_CSS[ci('stone', 3)];
    g.fillRect(x, y, w, Math.min(4, h));
    g.fillStyle = PAL_CSS[ci('stone', 2)];
    g.fillRect(x, y + 4, w, Math.max(0, h - 4));
    g.fillStyle = PAL_CSS[ci('stone', 0)];
    g.fillRect(x, y + h - 1, w, 1);
  }
  for (const [x, y] of TORCHES) {
    g.fillStyle = PAL_CSS[ci('earth', 2)];
    g.fillRect(x - 1, y, 2, 5);
    g.fillStyle = PAL_CSS[ci('ember', 4)];
    g.fillRect(x - 1, y - 3, 2, 3);
    g.fillStyle = PAL_CSS[ci('ember', 5)];
    g.fillRect(x - 1, y - 2, 1, 1);
  }
}

/** 格子点ごとに流れの向きを短い線で描く（画面の実画素） */
function drawFieldOverlay(g: CanvasRenderingContext2D, field: CurlField, out: Float64Array): void {
  g.save();
  g.lineWidth = 1.5;
  for (let j = 0; j < field.ny; j++) {
    for (let i = 0; i < field.nx; i++) {
      const ax = field.originX + i * field.cellSize;
      const ay = field.originY + j * field.cellSize;
      field.sample(ax, ay, out);
      const sx = ax * ART_SCALE;
      const sy = ay * ART_SCALE;
      // 12 ドット/秒で 1 マスの半分（24px）ほどの長さ
      const ex = sx + out[0] * 2;
      const ey = sy + out[1] * 2;
      g.strokeStyle = 'rgba(155,214,242,0.75)';
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(ex, ey);
      g.stroke();
      g.fillStyle = 'rgba(255,241,168,0.9)';
      g.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// fx:curl
// ---------------------------------------------------------------------------

function curlScene(): void {
  const worldW = (CURL_GRID_DUNGEON.cols ?? 48) * 16;
  const worldH = (CURL_GRID_DUNGEON.rows ?? 32) * 16;
  // 1280×720 に 2 枚を並べる（撮影は画面の外を写さない）
  const W = 1280;
  const gap = 20;
  const k = (W - gap * 3) / (worldW * 2);
  const top = 44;
  const H = Math.ceil(top + worldH * k + 64);
  const g = makeSheet(W, H, '#0a0910');
  const times = [0, 5];
  times.forEach((t, n) => {
    const field = new CurlField({ ...CURL_GRID_DUNGEON, t0: t });
    const ox = gap + n * (worldW * k + gap);
    drawCurlPanel(g, field, ox, top, k);
    label(g, `t = ${t} 秒  ${field.cols}×${field.rows} マス（格子 ${field.nx}×${field.ny} 点・${field.cellSize} ドット間隔）`,
      ox, 14);
    label(g, `平均の速さ ${meanSpeed(field, worldW, worldH).toFixed(1)} ドット/秒`,
      ox, top + worldH * k + 12, '#e8d6a0', 13);
  });
  label(g, '背景 = ψ（藍 < 0 < 橙）  細い線 = 流線（ψ の等高線に沿う）  矢印 = 2 マスごとの速度（1.2 秒ぶんの長さ）',
    gap, top + worldH * k + 40, '#a9a391', 13);
}

function meanSpeed(field: CurlField, w: number, h: number): number {
  const out = new Float64Array(2);
  let s = 0;
  let n = 0;
  for (let y = 3.5; y < h; y += 8) {
    for (let x = 3.5; x < w; x += 8) {
      field.sample(x, y, out);
      s += Math.hypot(out[0], out[1]);
      n++;
    }
  }
  return s / n;
}

/** 流れ場 1 枚を (ox, oy) に k 倍で描く */
function drawCurlPanel(g: CanvasRenderingContext2D, field: CurlField,
  ox: number, oy: number, k: number): void {
  const worldW = field.cols * field.cellSize;
  const worldH = field.rows * field.cellSize;
  const pw = Math.floor(worldW * k);
  const ph = Math.floor(worldH * k);
  // 背景：ψ を色で（負は藍、正は橙。0 付近は暗い）
  const img = g.createImageData(pw, ph);
  const d = img.data;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const p = field.psiAt((x + 0.5) / k, (y + 0.5) / k);
      const a = Math.min(1, Math.abs(p) / 1.1);
      const o = (y * pw + x) * 4;
      if (p >= 0) {
        d[o] = 14 + 120 * a;
        d[o + 1] = 12 + 55 * a;
        d[o + 2] = 20 + 12 * a;
      } else {
        d[o] = 14 + 20 * a;
        d[o + 1] = 12 + 40 * a;
        d[o + 2] = 20 + 110 * a;
      }
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, ox, oy);
  g.save();
  g.beginPath();
  g.rect(ox, oy, pw, ph);
  g.clip();
  g.translate(ox, oy);
  g.scale(k, k);
  // マスの格子（4 マスごとに少し濃く）
  const c = field.cellSize;
  for (let i = 0; i <= field.cols; i++) {
    g.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
    g.fillRect(i * c, 0, 1 / k, worldH);
  }
  for (let j = 0; j <= field.rows; j++) {
    g.fillStyle = j % 4 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
    g.fillRect(0, j * c, worldW, 1 / k);
  }
  // 流線：格子状に置いた種から前後へ 2 次のルンゲ＝クッタで辿る
  const v = new Float64Array(2);
  const v2 = new Float64Array(2);
  g.lineWidth = 1 / k;
  g.strokeStyle = 'rgba(232,214,160,0.5)';
  const seedStep = 24;
  const dt = 0.12;
  for (let sy = seedStep / 2; sy < worldH; sy += seedStep) {
    for (let sx = seedStep / 2; sx < worldW; sx += seedStep) {
      for (let dir = -1; dir <= 1; dir += 2) {
        let x = sx;
        let y = sy;
        g.beginPath();
        g.moveTo(x, y);
        for (let s = 0; s < 40; s++) {
          field.sample(x, y, v);
          field.sample(x + v[0] * dt * 0.5 * dir, y + v[1] * dt * 0.5 * dir, v2);
          x += v2[0] * dt * dir;
          y += v2[1] * dt * dir;
          if (x < 0 || y < 0 || x > worldW || y > worldH) break;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  }
  // 矢印：2 マスごと、マスの中心の速度。格子点の上は接線の成分が切り替わる所なので避ける
  g.strokeStyle = 'rgba(155,214,242,0.95)';
  g.fillStyle = 'rgba(155,214,242,0.95)';
  g.lineWidth = 1.5 / k;
  for (let j = 0; j < field.rows; j += 2) {
    for (let i = 0; i < field.cols; i += 2) {
      const x = (i + 0.5) * c;
      const y = (j + 0.5) * c;
      field.sample(x, y, v);
      const ex = x + v[0] * 1.2;
      const ey = y + v[1] * 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(ex, ey);
      g.stroke();
      const len = Math.hypot(v[0], v[1]);
      if (len > 1e-3) {
        const ux = v[0] / len;
        const uy = v[1] / len;
        const hl = 5 / k;
        const hw = 3 / k;
        g.beginPath();
        g.moveTo(ex, ey);
        g.lineTo(ex - ux * hl - uy * hw, ey - uy * hl + ux * hw);
        g.lineTo(ex - ux * hl + uy * hw, ey - uy * hl - ux * hw);
        g.closePath();
        g.fill();
      }
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------

/** ?scene=fx:… を開く */
export function open(spec: string, params: URLSearchParams, _canvas: HTMLCanvasElement): void {
  const parts = spec.split(':');
  switch (parts[1]) {
    case 'particles':
      particlesScene(params);
      return;
    case 'curl':
      curlScene();
      return;
    default: {
      const g = makeSheet(600, 60, '#0a0910');
      label(g, `知らない場面: ${spec}`, 10, 20, '#ff8080');
    }
  }
}
