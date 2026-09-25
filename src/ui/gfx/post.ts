/**
 * 画面全体に掛ける仕上げ：光の筋・霧・色調・周辺減光・暗転とフラッシュ。
 *
 * 形のある物（筋・霧・減光）は、テーマが変わった時に小さな紙へ 1 度だけ焼いておき、
 * 毎フレームは拡大して貼るだけにする（グラデーションも文字列も毎フレーム作らない）。
 *
 * 画面いっぱいに補間しながら描くと 1 回 3〜4ms 掛かる（ソフトウェア描画の計測）。そこで
 *   - 霧 2 枚は画面の半分の大きさの紙に重ねてから、最近傍の 2 倍で 1 回だけ貼る
 *   - 周辺減光は半分の大きさに焼いておき、最近傍の 2 倍で貼る
 *   - 光の筋はブルームの加算の紙（bloom.ts の H）に描く（画面へ足すのはブルームと一緒の 1 回）
 *   - 彩度を落とすのは地形の画用紙に対して（'saturation' は画面いっぱいだと 4ms。画用紙なら 1/9）
 * どれも滑らかな形なので、2×2 の段は見えない。
 */

import { Surface } from './lighting.js';
import type { Ctx2D } from './canvas.js';
import type { FrameInfo } from './types.js';
import type { ThemeLook } from '../art/terrain/types.js';
import { GRADE_FULL, GRADE_TINT, type QualityPreset } from './quality.js';
import { hash2 } from '../art/hash.js';
import { parseHex } from '../gfx-core/lightModel.js';
import { SCREEN_H, SCREEN_W } from '../theme.js';
import { ART_SCALE } from './view.js';

/** 光の筋の絵（幅 × 長さ） */
const SHAFT_W = 32;
const SHAFT_H = 256;
/** 光の筋の傾き（ラジアン）。舞台照明は左上から当てるので、筋は左上から右下へ */
const SHAFT_ANGLE = 0.42;
/** 霧の絵。横につなげて貼るので、横方向は継ぎ目なしに焼く */
const FOG_W = 256;
const FOG_H = 96;
/** 霧が掛かる高さ（画面の上から、画面の高さに対する割合） */
const FOG_DEPTH = [0.55, 0.38];
/** 霧の 1 枚の横幅（論理 px）・流れる速さ（px/秒）・カメラに付いてくる割合（視差） */
const FOG_SPAN = [1600, 1150];
const FOG_SPEED = [7, 13];
const FOG_PARALLAX = [0.3, 0.55];
const FOG_ALPHA = [1, 0.7];
/** 周辺減光の紙（1/4 で焼き、1/2 へ滑らかに広げておく） */
const VIG_W = SCREEN_W / 4;
const VIG_H = SCREEN_H / 4;
/** 半分の大きさの紙 */
const HALF_W = SCREEN_W / 2;
const HALF_H = SCREEN_H / 2;
/** 霧の紙の高さ（いちばん深い霧まで） */
const FOG_BUF_H = Math.ceil(HALF_H * Math.max(FOG_DEPTH[0], FOG_DEPTH[1]));

export class PostFx {
  private shaft = new Surface(SHAFT_W, SHAFT_H, false, true);
  private fog = new Surface(FOG_W, FOG_H, false, true);
  private vignette = new Surface(VIG_W, VIG_H, false, true);
  private vignetteHalf = new Surface(HALF_W, HALF_H, false, true);
  /** 霧 2 枚を重ねる紙（画面の半分の大きさ、上の部分だけ） */
  private fogBuf = new Surface(HALF_W, FOG_BUF_H, false, true);
  private look: ThemeLook | null = null;
  private fadeCss = '#000';

  /** テーマの空気が変わった時に、筋・霧・減光の紙を焼き直す */
  setLook(look: ThemeLook): void {
    if (look === this.look) return;
    this.look = look;
    bakeShaft(this.shaft, parseHex(look.shafts.color));
    bakeFog(this.fog, parseHex(look.fog.color), look.theme.length);
    bakeVignette(this.vignette, look.vignette);
    const vh = this.vignetteHalf.g;
    vh.globalCompositeOperation = 'copy';
    vh.drawImage(this.vignette.c, 0, 0, HALF_W, HALF_H);
    vh.globalCompositeOperation = 'source-over';
  }

  /**
   * 光の筋（加算）。ゆっくり横へ漂い、少しだけ明るさが呼吸する。
   * (sx, sy) は論理座標から描く紙への倍率（ブルームの加算の紙なら 0.5）
   */
  drawShafts(g: Ctx2D, f: Readonly<FrameInfo>, sx: number, sy: number): void {
    const look = this.look;
    if (!look) return;
    const n = Math.min(3, look.shafts.count | 0);
    if (n <= 0 || look.shafts.alpha <= 0) return;
    const t = f.time;
    const span = SCREEN_W + 400;
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const phase = i * 2.39996;
      // 画面の中の置き場所 ＋ 漂い ＋ わずかな視差（空中にあるように見せる）
      let x = SCREEN_W * (0.2 + 0.6 * (i + 0.5) / n) + Math.sin(t * 0.07 + phase) * 70
        - f.camX * ART_SCALE * 0.12;
      x = (((x + 200) % span) + span) % span - 200;
      const w = 120 + 50 * Math.sin(phase * 3.1);
      g.setTransform(sx, 0, 0, sy, 0, 0);
      g.translate(x, -90);
      g.rotate(-SHAFT_ANGLE);
      g.globalAlpha = look.shafts.alpha * (0.75 + 0.25 * Math.sin(t * 0.4 + phase));
      g.drawImage(this.shaft.c, -w / 2, 0, w, SCREEN_H * 1.45);
    }
    g.setTransform(sx, 0, 0, sy, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** 奥（画面の上）の霧 2 枚を、半分の大きさの紙に重ねておく（画面へ出すのは drawFog） */
  prepareFog(f: Readonly<FrameInfo>): void {
    const look = this.look;
    const b = this.fogBuf.g;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, this.fogBuf.w, this.fogBuf.h);
    if (!look || look.fog.alpha <= 0) return;
    b.imageSmoothingEnabled = true;
    for (let j = 0; j < 2; j++) {
      const span = FOG_SPAN[j] / 2;
      const h = HALF_H * FOG_DEPTH[j];
      const off = (f.camX * ART_SCALE * FOG_PARALLAX[j] + f.time * FOG_SPEED[j]) / 2;
      let x = -(((off % span) + span) % span);
      b.globalAlpha = look.fog.alpha * FOG_ALPHA[j];
      while (x < HALF_W) {
        b.drawImage(this.fog.c, x, 0, span, h);
        x += span;
      }
    }
    b.globalAlpha = 1;
  }

  /** 重ねた霧を画面へ（最近傍の 2 倍）。g は論理座標の向き */
  drawFog(g: Ctx2D): void {
    if (!this.look || this.look.fog.alpha <= 0) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.fogBuf.c, 0, 0, SCREEN_W, this.fogBuf.h * 2);
  }

  /**
   * 彩度を少し落とす（'saturation' で灰色を重ねる）。地形の画用紙（照らした後）に掛ける。
   * キャラと道具は落とさない（地形より少し鮮やかに見えて、見分けやすい）
   */
  desaturateArt(a: Ctx2D, w: number, h: number): void {
    const look = this.look;
    if (!look || look.grade.desaturate <= 0) return;
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = 'saturation';
    a.globalAlpha = Math.min(1, look.grade.desaturate);
    a.fillStyle = '#808080';
    a.fillRect(0, 0, w, h);
    a.globalAlpha = 1;
    a.globalCompositeOperation = 'source-over';
  }

  /**
   * 色味を重ねる（'soft-light'）。画面全体に掛ければブルームや粒子も同じ色味に揃う。
   * 不透明な画用紙に掛けてもよい（w × h はその紙の大きさ。向きは今のまま）
   */
  drawGrade(g: Ctx2D, q: QualityPreset, w: number, h: number): void {
    const look = this.look;
    if (!look || q.grade < GRADE_TINT || look.grade.tintAlpha <= 0) return;
    g.globalCompositeOperation = 'soft-light';
    g.globalAlpha = Math.min(1, look.grade.tintAlpha);
    g.fillStyle = look.grade.tint;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** 彩度を落とす段か（compositor が地形の画用紙に掛けるかを決める） */
  static desaturates(q: QualityPreset): boolean {
    return q.grade >= GRADE_FULL;
  }

  /** 周辺減光（半分の大きさの紙を最近傍の 2 倍で） */
  drawVignette(g: Ctx2D): void {
    if (!this.look || this.look.vignette <= 0) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.vignetteHalf.c, 0, 0, SCREEN_W, SCREEN_H);
  }

  /** 暗転とフラッシュ */
  drawOverlay(g: Ctx2D, fade: number, flashAlpha: number, flashColor: string | undefined): void {
    if (flashAlpha > 0 && flashColor) {
      g.globalAlpha = Math.min(1, flashAlpha);
      g.fillStyle = flashColor;
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }
    if (fade > 0) {
      g.globalAlpha = Math.min(1, fade);
      g.fillStyle = this.fadeCss;
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }
    g.globalAlpha = 1;
  }

  debugBuffers(out: { name: string; c: CanvasImageSource }[]): void {
    out.push({ name: 'shaft tex', c: this.shaft.c });
    out.push({ name: 'fog tex', c: this.fog.c });
    out.push({ name: 'vignette 320x180', c: this.vignette.c });
    out.push({ name: 'fog layers 640 (top)', c: this.fogBuf.c });
  }
}

// ---------------------------------------------------------------------------
// 焼く（テーマが変わった時だけ）
// ---------------------------------------------------------------------------

const smoothstep = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

function put(s: Surface, fill: (x: number, y: number) => number, rgb: number): void {
  const img = new ImageData(s.w, s.h);
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = (y * s.w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(Math.max(0, Math.min(1, fill(x, y))) * 255);
    }
  }
  s.g.putImageData(img, 0, 0);
}

/** 光の筋：横は両端がやわらかく、縦は上で立ち上がって下へ消える */
function bakeShaft(s: Surface, rgb: number): void {
  put(s, (x, y) => {
    const u = (x + 0.5) / s.w;
    const v = (y + 0.5) / s.h;
    const across = Math.pow(Math.sin(Math.PI * u), 2);
    const along = smoothstep(0, 0.18, v) * Math.pow(1 - v, 1.3);
    return across * along;
  }, rgb);
}

/** 格子の値のノイズ（横は period で折り返す＝継ぎ目なしにつながる） */
function tiledNoise(x: number, y: number, cell: number, period: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const n = period / cell;
  const h = (cx: number, cy: number): number => hash2(((cx % n) + n) % n, cy, seed) / 4294967296;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * ux;
  const b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * ux;
  return a + (b - a) * uy;
}

/** 霧：2 つの細かさのノイズを重ね、上ほど濃く、下へ消える */
function bakeFog(s: Surface, rgb: number, seed: number): void {
  put(s, (x, y) => {
    const n = 0.6 * tiledNoise(x, y, 64, FOG_W, 101 + seed) + 0.4 * tiledNoise(x, y, 16, FOG_W, 202 + seed);
    const v = (y + 0.5) / s.h;
    return smoothstep(0.25, 0.85, n) * Math.pow(1 - v, 1.6);
  }, rgb);
}

/** 周辺減光：楕円の距離で、真ん中は透明、四隅で strength。暗部は紺に寄せる */
function bakeVignette(s: Surface, strength: number): void {
  put(s, (x, y) => {
    const dx = (x + 0.5 - s.w / 2) / (s.w / 2);
    const dy = (y + 0.5 - s.h / 2) / (s.h / 2);
    const d = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
    return strength * smoothstep(0.42, 1.0, d);
  }, 0x05060e);
}
