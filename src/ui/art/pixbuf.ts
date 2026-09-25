/**
 * ドット絵の画用紙と、描くための道具。
 *
 * 画素はパレットの番号（palette.ts）で持つ。0 は透明。
 * 座標はすべて整数。小数を渡されたら切り捨てる（位置が滑らかに動いても、
 * 描く瞬間に必ずドットの格子へ落ちる）。
 *
 * DOM に触れないので、node のテストからそのまま描いて中身を検査できる。
 * 画面へ出すのは gfx/sheets.ts が ImageData に写してから。
 */

import { TRANSPARENT } from './palette.js';

export class PixBuf {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w | 0;
    this.h = h | 0;
    this.px = new Uint8Array(this.w * this.h);
  }

  clear(): void {
    this.px.fill(TRANSPARENT);
  }

  /** 画用紙の外は 0（透明）を返す */
  get(x: number, y: number): number {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TRANSPARENT;
    return this.px[y * this.w + x];
  }

  /** 画用紙の外は黙って無視する（はみ出した部分を切るため） */
  set(x: number, y: number, c: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  /** 透明でない画素にだけ描く（すでにある形の上に模様を載せるとき） */
  paint(x: number, y: number, c: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.px[i] !== TRANSPARENT) this.px[i] = c;
  }

  copyFrom(src: PixBuf): void {
    if (src.w !== this.w || src.h !== this.h) throw new Error('PixBuf の大きさが違う');
    this.px.set(src.px);
  }
}

/** 塗りつぶした矩形 */
export function rect(b: PixBuf, x: number, y: number, w: number, h: number, c: number): void {
  x |= 0;
  y |= 0;
  w |= 0;
  h |= 0;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) b.set(xx, yy, c);
}

/** 横一列 */
export function hline(b: PixBuf, x: number, y: number, len: number, c: number): void {
  for (let i = 0; i < (len | 0); i++) b.set((x | 0) + i, y, c);
}

/** 縦一列 */
export function vline(b: PixBuf, x: number, y: number, len: number, c: number): void {
  for (let i = 0; i < (len | 0); i++) b.set(x, (y | 0) + i, c);
}

/**
 * 直線（Bresenham）。8 近傍で 1 画素ずつ進むので、L 字の二重点ができない。
 * ドット絵の線がきれいに見える傾きは 1:1・1:2・2:1・1:3 あたり。
 */
export function line(
  b: PixBuf, x0: number, y0: number, x1: number, y1: number, c: number,
): void {
  x0 |= 0;
  y0 |= 0;
  x1 |= 0;
  y1 |= 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    b.set(x0, y0, c);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * 楕円。中心 (cx, cy)・半径 (rx, ry) は整数。
 * 塗りつぶしは行ごとの幅で描くので、左右対称で角の欠けも無い。
 */
export function ellipse(
  b: PixBuf, cx: number, cy: number, rx: number, ry: number, c: number, fill = true,
): void {
  cx |= 0;
  cy |= 0;
  rx = Math.max(0, rx | 0);
  ry = Math.max(0, ry | 0);
  if (rx === 0 && ry === 0) {
    b.set(cx, cy, c);
    return;
  }
  // 行ごとの半幅。0.5 を足すと、小さな円が四角く潰れない
  const halfW = (dy: number): number => {
    if (ry === 0) return rx;
    const t = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5));
    return t <= 0 ? -1 : Math.floor((rx + 0.5) * Math.sqrt(t));
  };
  if (fill) {
    for (let dy = -ry; dy <= ry; dy++) {
      const hw = halfW(dy);
      if (hw < 0) continue;
      hline(b, cx - hw, cy + dy, hw * 2 + 1, c);
    }
    return;
  }
  // 輪郭だけ：隣の行との幅の差を埋めて、切れ目のない 1 画素の線にする
  let prev = -1;
  for (let dy = -ry; dy <= ry; dy++) {
    const hw = halfW(dy);
    if (hw < 0) continue;
    const next = dy < ry ? halfW(dy + 1) : -1;
    const inner = Math.max(0, Math.min(hw, Math.max(prev, next) + 1));
    const from = dy === -ry || dy === ry ? 0 : inner;
    for (let x = from; x <= hw; x++) {
      b.set(cx - x, cy + dy, c);
      b.set(cx + x, cy + dy, c);
    }
    prev = hw;
  }
}

/** 円（楕円の半径が同じもの） */
export function disc(b: PixBuf, cx: number, cy: number, r: number, c: number): void {
  ellipse(b, cx, cy, r, r, c, true);
}

/**
 * 手描きの細部を文字で置く。'.' と ' ' は透明（何も描かない）。
 * 目・口・紋章・髭の房など、式で作るより描いた方が早いところに使う。
 */
export function runs(
  b: PixBuf, x: number, y: number, rows: readonly string[],
  map: Readonly<Record<string, number>>, flipX = false,
): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      const c = map[ch];
      if (c === undefined) continue;
      const xx = flipX ? x + (row.length - 1 - i) : x + i;
      b.set(xx, y + r, c);
    }
  }
}

/** 4×4 のベイヤー行列（0〜15） */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * ディザ。level は 0（描かない）〜 16（全部描く）。
 * 絶対座標で模様を取るので、隣り合う領域どうしで網目がずれない。
 * 使うのは大きな面（大型の敵・ボス・地形）だけ。小さな絵では汚れに見える。
 */
export function dither(
  b: PixBuf, x: number, y: number, w: number, h: number, c: number, level: number,
  onlyPainted = false,
): void {
  for (let yy = y | 0; yy < (y | 0) + (h | 0); yy++) {
    for (let xx = x | 0; xx < (x | 0) + (w | 0); xx++) {
      if (BAYER4[(yy & 3) * 4 + (xx & 3)] >= level) continue;
      if (onlyPainted) b.paint(xx, yy, c);
      else b.set(xx, yy, c);
    }
  }
}

/** 左右反転（その場で） */
export function mirrorX(b: PixBuf): void {
  const { w, h, px } = b;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w >> 1; x++) {
      const a = row + x;
      const z = row + (w - 1 - x);
      const t = px[a];
      px[a] = px[z];
      px[z] = t;
    }
  }
}

/** 別の画用紙を重ねる（透明は写さない） */
export function stamp(dst: PixBuf, src: PixBuf, x: number, y: number, flipX = false): void {
  for (let sy = 0; sy < src.h; sy++) {
    for (let sx = 0; sx < src.w; sx++) {
      const c = src.px[sy * src.w + sx];
      if (c === TRANSPARENT) continue;
      dst.set((x | 0) + (flipX ? src.w - 1 - sx : sx), (y | 0) + sy, c);
    }
  }
}

/** ある色を別の色に置き換える */
export function recolor(b: PixBuf, from: number, to: number): void {
  const { px } = b;
  for (let i = 0; i < px.length; i++) if (px[i] === from) px[i] = to;
}

/** 描かれている範囲。何も無ければ幅 0 */
export function bbox(b: PixBuf): { x: number; y: number; w: number; h: number } {
  let x0 = b.w;
  let y0 = b.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (b.px[y * b.w + x] === TRANSPARENT) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 描かれている画素の数 */
export function countPainted(b: PixBuf): number {
  let n = 0;
  for (let i = 0; i < b.px.length; i++) if (b.px[i] !== TRANSPARENT) n++;
  return n;
}

/** 使っている色の種類（透明を除く） */
export function distinctColors(b: PixBuf): number {
  const seen = new Uint8Array(256);
  let n = 0;
  for (let i = 0; i < b.px.length; i++) {
    const c = b.px[i];
    if (c === TRANSPARENT || seen[c]) continue;
    seen[c] = 1;
    n++;
  }
  return n;
}
