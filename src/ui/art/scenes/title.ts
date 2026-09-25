/**
 * タイトルの背景（夜の風の村と、遠くの天輪の塔）。DOM 無し。
 *
 * 428×240 の画用紙（ダンジョンと同じ 3 倍の世界）に、奥から順に 5 枚の層で描く。
 * 層ごとに「ずらす量（視差）」と「ぼかす段（被写界深度）」を持つので、
 * 描く側はゆっくり横へ流しながら、奥と手前をぼかして中央（村）をくっきり見せる。
 *
 *   0 空：月・星（空の色はなめらかなグラデーションで、描く側が塗る）
 *   1 遠景：山並みと天輪の塔（塔の窓と頂の輪が光る）
 *   2 中景：丘と木立、遠くの家の灯り
 *   3 村：家々・風車・灯籠・小道（主役。ぼかさない）
 *   4 手前：草むらと柵の影（ぼかす）
 *
 * 風車の羽根は別に 4 コマ（buildWindmillBlades）。光る所（窓・灯籠・塔の輪・月）は lights に並べる。
 * 形の揺らぎは座標のハッシュだけで決める（毎回同じ絵）。
 */

import { WHITE, ci } from '../palette.js';
import { PixBuf, disc, ellipse, hline, line, rect, vline } from '../pixbuf.js';
import { hash2, hashFloat } from '../hash.js';

export const DIORAMA_W = 460;
export const DIORAMA_H = 240;

export interface DioramaLayer {
  buf: PixBuf;
  /** カメラが 1 動いた時に何ドット動くか（奥ほど小さい） */
  parallax: number;
  /** ぼかしの段（0 = くっきり、1 = 弱く、2 = 強く） */
  blur: 0 | 1 | 2;
}

export interface DioramaLight {
  /** 画用紙のドット座標（層 3 の座標。視差は layer で合わせる） */
  x: number;
  y: number;
  radius: number;
  color: string;
  intensity: number;
  /** どの層に付いているか（視差を合わせるため） */
  layer: number;
  /** 揺らぐか（灯籠・窓） */
  flicker: boolean;
}

export interface DioramaStar {
  x: number;
  y: number;
  /** 0 = 小、1 = 明るい（十字） */
  big: boolean;
  phase: number;
}

export interface Diorama {
  /** 空のグラデーション（上から 0〜1 の位置と色）。ドットではなくなめらかに塗る */
  sky: Array<[number, string]>;
  layers: DioramaLayer[];
  lights: DioramaLight[];
  stars: DioramaStar[];
  /** 風車の羽根の軸（層 3 の座標） */
  windmill: { x: number; y: number };
}

/** なめらかな 1 次元のノイズ（0〜1）。格子の値をハッシュで決め、間をなめらかにつなぐ */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashFloat(i, 0, seed);
  const b = hashFloat(i + 1, 0, seed);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------

function sky(b: PixBuf, stars: DioramaStar[]): void {
  // 空の色そのものは描く側がなめらかなグラデーションで塗る（Diorama.sky）。
  // ドットのディザで塗ると横縞が目立つので、ここでは月と星だけを描く
  // 月（左上。光は左上から来るので、月も左上に置く）
  const mx = 74;
  const my = 44;
  disc(b, mx, my, 13, ci('bone', 5));
  disc(b, mx + 3, my + 2, 11, ci('bone', 4));
  disc(b, mx + 1, my, 10, ci('bone', 5));
  for (const [x, y, r] of [[mx + 4, my - 3, 2], [mx - 3, my + 4, 1], [mx + 6, my + 5, 2]] as const) {
    disc(b, x, y, r, ci('bone', 4));
  }
  b.set(mx - 5, my - 6, WHITE);
  // 星
  for (let y = 2; y < 150; y++) {
    for (let x = 2; x < DIORAMA_W - 2; x++) {
      const h = hash2(x, y, 7101);
      if (h % 523 !== 0) continue;
      if (Math.hypot(x - mx, y - my) < 22) continue;
      const big = (h >>> 12) % 7 === 0;
      stars.push({ x, y, big, phase: ((h >>> 4) % 1000) / 1000 });
      b.set(x, y, big ? WHITE : ci('indigo', y < 60 ? 5 : 4));
    }
  }
}

/** 遠景：山並みと天輪の塔 */
function far(b: PixBuf, lights: DioramaLight[]): void {
  const base = ci('ink', 1);
  const rim = ci('ink', 2);
  for (let x = 0; x < DIORAMA_W; x++) {
    const h = Math.round(150 + 26 * noise1(x / 70, 11) - 18 * noise1(x / 23, 12) + 4 * noise1(x / 7, 13));
    vline(b, x, h, DIORAMA_H - h, base);
    // 左を向いた斜面の縁だけ月明かりで明るく
    const hl = Math.round(150 + 26 * noise1((x - 1) / 70, 11) - 18 * noise1((x - 1) / 23, 12) + 4 * noise1((x - 1) / 7, 13));
    if (hl >= h) b.set(x, h, rim);
  }
  // 塔（右寄り。山の肩に立つ）
  const tx = 318;
  const top = 34;
  const foot = 162;
  for (let y = top; y < foot; y++) {
    const t = (y - top) / (foot - top);
    const half = Math.round(3 + t * 6);
    hline(b, tx - half, y, half * 2 + 1, ci('steel', 1));
    b.set(tx - half, y, ci('steel', 2));
    b.set(tx - half + 1, y, ci('steel', 2));
    b.set(tx + half, y, ci('ink', 1));
    // 階の区切り
    if ((y - top) % 14 === 0) hline(b, tx - half - 1, y, half * 2 + 3, ci('steel', 2));
  }
  // 窓（階ごとに 1 つ。灯っている窓はハッシュで決める）
  for (let y = top + 7; y < foot - 6; y += 14) {
    const lit = hash2(tx, y, 51) % 3 !== 0;
    const c = lit ? ci('gold', 5) : ci('ink', 0);
    b.set(tx, y, c);
    b.set(tx, y + 1, lit ? ci('ember', 4) : ci('ink', 0));
    if (lit) lights.push({ x: tx, y, radius: 10, color: '#ffcf7a', intensity: 0.5, layer: 1, flicker: true });
  }
  // 尖塔と天輪（頂を巡る金の輪。光る）
  vline(b, tx, top - 14, 14, ci('steel', 2));
  b.set(tx, top - 15, ci('gold', 5));
  ellipse(b, tx, top - 8, 13, 4, ci('gold', 4), false);
  ellipse(b, tx, top - 8, 12, 3, ci('gold', 5), false);
  // 輪の奥側（塔の後ろ）は暗く
  for (let x = tx - 1; x <= tx + 1; x++) b.set(x, top - 11, ci('steel', 2));
  lights.push({ x: tx, y: top - 8, radius: 38, color: '#ffe3a0', intensity: 0.8, layer: 1, flicker: false });
}

/** 中景：丘と木立、遠くの家の灯り */
function mid(b: PixBuf, lights: DioramaLight[]): void {
  const hill = (x: number): number => Math.round(186 + 10 * noise1(x / 55, 21) - 6 * noise1(x / 19, 22));
  for (let x = 0; x < DIORAMA_W; x++) vline(b, x, hill(x), DIORAMA_H - hill(x), ci('moss', 0));
  // 木立（丸い冠を重ねる）
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hashFloat(i, 0, 31) * DIORAMA_W);
    if (x > 300 && x < 336) continue; // 塔の足元は空けて見せる
    const r = 5 + (hash2(i, 1, 31) % 6);
    const y = hill(x) - r + 3;
    disc(b, x, y, r, ci('moss', 0));
    // 月の側（左上）の縁を少し明るく
    for (let a = 0; a < 12; a++) {
      const ang = Math.PI + (a / 12) * (Math.PI / 2);
      b.set(Math.round(x + Math.cos(ang) * r), Math.round(y + Math.sin(ang) * r), ci('moss', 1));
    }
  }
  // 遠くの家の灯り
  for (const x of [58, 148, 232, 402]) {
    const y = hill(x) + 2;
    rect(b, x - 4, y - 3, 8, 5, ci('ink', 1));
    b.set(x - 2, y - 1, ci('gold', 5));
    b.set(x + 1, y - 1, ci('ember', 4));
    lights.push({ x, y: y - 1, radius: 9, color: '#ffc46a', intensity: 0.45, layer: 2, flicker: true });
  }
}

/** 家 1 軒（切妻の茅葺き屋根・土壁・灯る窓） */
function house(b: PixBuf, x: number, ground: number, w: number, lights: DioramaLight[], seed: number): void {
  const wallH = 16;
  const roofH = Math.round(w * 0.45);
  // 壁
  rect(b, x, ground - wallH, w, wallH, ci('earth', 1));
  vline(b, x, ground - wallH, wallH, ci('earth', 2));
  hline(b, x, ground - 1, w, ci('earth', 0));
  // 柱
  for (let px = x + 5; px < x + w - 2; px += 9) vline(b, px, ground - wallH, wallH, ci('earth', 0));
  // 窓（灯る）
  const wx = x + Math.floor(w / 2) - 3;
  const wy = ground - wallH + 5;
  rect(b, wx, wy, 6, 5, ci('ember', 4));
  rect(b, wx + 1, wy + 1, 4, 3, ci('gold', 5));
  vline(b, wx + 3, wy, 5, ci('earth', 0));
  lights.push({ x: wx + 3, y: wy + 2, radius: 22, color: '#ffbf5e', intensity: 0.7, layer: 3, flicker: true });
  // 戸
  if (w > 34) rect(b, x + w - 11, ground - 11, 6, 10, ci('earth', 0));
  // 屋根（左が月明かりで明るく、右は暗い。軒が壁より張り出す）
  const peak = x + Math.floor(w / 2);
  for (let r = 0; r < roofH; r++) {
    const y = ground - wallH - roofH + r;
    const half = Math.round(((r + 1) / roofH) * (w / 2 + 4));
    for (let xx = peak - half; xx <= peak + half; xx++) {
      const left = xx < peak;
      const n = hash2(xx, y, seed) % 5;
      const c = left ? ci('gold', n === 0 ? 2 : 1) : ci('earth', n === 0 ? 2 : 1);
      b.set(xx, y, c);
    }
    b.set(peak - half, y, ci('gold', 2));
  }
  // 茅の筋
  for (let r = 2; r < roofH; r += 3) hline(b, peak - Math.round(((r + 1) / roofH) * (w / 2 + 4)) + 1, ground - wallH - roofH + r, 3, ci('gold', 2));
  // 棟
  hline(b, peak - 3, ground - wallH - roofH - 1, 7, ci('earth', 0));
}

/** 灯籠 */
function lantern(b: PixBuf, x: number, ground: number, lights: DioramaLight[]): void {
  vline(b, x, ground - 12, 12, ci('stone', 1));
  rect(b, x - 2, ground - 17, 5, 5, ci('ember', 4));
  rect(b, x - 1, ground - 16, 3, 3, ci('gold', 5));
  hline(b, x - 3, ground - 18, 7, ci('stone', 2));
  b.set(x, ground - 19, ci('stone', 2));
  hline(b, x - 2, ground - 1, 5, ci('stone', 1));
  lights.push({ x, y: ground - 15, radius: 30, color: '#ffb659', intensity: 0.85, layer: 3, flicker: true });
}

/** 村：家々・風車・灯籠・小道。主役なのでぼかさない */
function village(b: PixBuf, lights: DioramaLight[]): { x: number; y: number } {
  const ground = (x: number): number => Math.round(206 + 4 * noise1(x / 40, 41));
  // 地面
  for (let x = 0; x < DIORAMA_W; x++) {
    const g = ground(x);
    vline(b, x, g, DIORAMA_H - g, ci('moss', 1));
    b.set(x, g, ci('moss', 2));
  }
  // 小道（手前から村の真ん中へ）
  for (let y = 214; y < DIORAMA_H; y++) {
    const t = (y - 214) / (DIORAMA_H - 214);
    const cx = Math.round(236 - t * 30);
    const half = Math.round(4 + t * 18);
    hline(b, cx - half, y, half * 2, ci('earth', 1));
    if (hash2(cx, y, 43) % 3 === 0) b.set(cx - half + 2, y, ci('earth', 2));
  }
  house(b, 36, ground(56), 42, lights, 1);
  house(b, 128, ground(146), 34, lights, 2);
  house(b, 268, ground(290), 46, lights, 3);
  // 風車（石積みの胴、とんがり屋根。羽根は別のコマで重ねる）
  const wx = 392;
  const wg = ground(wx);
  for (let y = wg - 44; y < wg; y++) {
    const t = (y - (wg - 44)) / 44;
    const half = Math.round(6 + t * 4);
    hline(b, wx - half, y, half * 2 + 1, ci('stone', 2));
    b.set(wx - half, y, ci('stone', 3));
    b.set(wx + half, y, ci('stone', 1));
    if (y % 5 === 0) hline(b, wx - half + 1, y, half * 2 - 1, ci('stone', 1));
  }
  for (let r = 0; r < 10; r++) hline(b, wx - r, wg - 54 + r, r * 2 + 1, r < 5 ? ci('crimson', 2) : ci('crimson', 1));
  rect(b, wx - 2, wg - 30, 4, 5, ci('gold', 5));
  lights.push({ x: wx, y: wg - 28, radius: 18, color: '#ffc46a', intensity: 0.55, layer: 3, flicker: true });
  rect(b, wx - 2, wg - 10, 5, 10, ci('earth', 0));
  // 灯籠（小道の両脇）
  lantern(b, 214, ground(214), lights);
  lantern(b, 262, ground(262) + 2, lights);
  return { x: wx, y: wg - 47 };
}

/** 手前：草むらと柵の影（ぼかす層） */
function near(b: PixBuf): void {
  const top = (x: number): number => Math.round(226 + 8 * noise1(x / 30, 61));
  for (let x = 0; x < DIORAMA_W; x++) {
    const t = top(x);
    // 道の上は空ける
    if (x > 190 && x < 260) continue;
    vline(b, x, t, DIORAMA_H - t, ci('ink', 0));
    // 草の穂
    if (hash2(x, 0, 62) % 3 === 0) {
      const h = 3 + (hash2(x, 1, 62) % 6);
      vline(b, x, t - h, h, ci('moss', 0));
    }
  }
  // 柵
  for (let x = 12; x < 180; x += 22) {
    vline(b, x, 214, 26, ci('ink', 0));
    vline(b, x + 1, 214, 26, ci('ink', 1));
  }
  hline(b, 10, 220, 172, ci('ink', 1));
  hline(b, 10, 228, 172, ci('ink', 0));
}

/** タイトルの背景を組み立てる（呼ぶたびに同じ絵） */
export function buildTitleDiorama(): Diorama {
  const lights: DioramaLight[] = [];
  const stars: DioramaStar[] = [];
  const L = (): PixBuf => new PixBuf(DIORAMA_W, DIORAMA_H);
  const l0 = L();
  sky(l0, stars);
  const l1 = L();
  far(l1, lights);
  const l2 = L();
  mid(l2, lights);
  const l3 = L();
  const windmill = village(l3, lights);
  const l4 = L();
  near(l4);
  // 月の光
  lights.push({ x: 74, y: 44, radius: 70, color: '#cfd8ff', intensity: 0.35, layer: 0, flicker: false });
  return {
    sky: [[0, '#0d0b26'], [0.35, '#1a1850'], [0.62, '#15306a'], [0.8, '#2f4a6e']],
    layers: [
      { buf: l0, parallax: 0.1, blur: 0 },
      { buf: l1, parallax: 0.25, blur: 1 },
      { buf: l2, parallax: 0.5, blur: 1 },
      { buf: l3, parallax: 1, blur: 0 },
      { buf: l4, parallax: 1.6, blur: 2 },
    ],
    lights,
    stars,
    windmill,
  };
}

export const WINDMILL_SIZE = 49;
export const WINDMILL_FRAMES = 4;

/**
 * 風車の羽根（49×49、軸が中心）。4 枚の羽根が 4 コマで 90° 回る（羽根が 90° ごとに同じ形なので、
 * 22.5° 刻みの 4 コマで途切れず回り続ける）。
 */
export function buildWindmillBlades(frame: number, out: PixBuf): void {
  out.clear();
  const c = 24;
  const base = (frame & 3) * (Math.PI / 8);
  for (let k = 0; k < 4; k++) {
    const a = base + (k * Math.PI) / 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const ex = Math.round(c + dx * 22);
    const ey = Math.round(c + dy * 22);
    line(out, c, c, ex, ey, ci('earth', 1));
    // 帆（羽根の片側に張った布）
    for (let s = 6; s <= 21; s++) {
      for (let w = 1; w <= 4; w++) {
        const x = Math.round(c + dx * s - dy * w);
        const y = Math.round(c + dy * s + dx * w);
        out.set(x, y, w === 4 || s === 21 ? ci('bone', 2) : ci('bone', 3));
      }
    }
  }
  disc(out, c, c, 2, ci('earth', 0));
  out.set(c - 1, c - 1, ci('earth', 2));
}
