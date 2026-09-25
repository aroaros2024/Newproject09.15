/**
 * ブルーム（光る物のにじみ）。
 *
 * 光る物だけを別の紙（320×180 = 論理座標の 1/4）に描き、1/8（160×90）と 1/16（80×45）へ
 * 縮める。縮めて拡大するだけで広いぼかしになる（ctx.filter の blur は Safari で効かないので使わない）。
 * 光る物の紙には、描いたあとで「光を通す量」を掛ける（lighting.ts の multiplyGate）。
 * 未探索の溶岩はにじまず、探索済みでは弱くにじむ。
 *
 * 画面へ足すのは 1 回だけ：1/4 の加算の紙（Q、320×180）に 2 段のにじみを滑らかに拡大して重ね、
 * 光の筋（post.ts）もここへ描き、半分の紙（H、640×360）へ滑らかに広げてから、最近傍の 2 倍で画面へ加算する。
 * 補間しながら画面いっぱいに加算すると 1 回 4ms 近く掛かるが、この順なら合わせて 2ms ほどで済む
 * （headless Chromium のソフトウェア描画で計測）。にじみはもともと滑らかなので、2×2 の段は見えない。
 */

import { Surface } from './lighting.js';
import type { Ctx2D } from './canvas.js';
import { ART_SCALE, CROP_X, CROP_Y } from './view.js';
import { SCREEN_H, SCREEN_W } from '../theme.js';

/** 光る物の紙（論理座標の 1/4） */
export const EMISSIVE_W = SCREEN_W / 4;
export const EMISSIVE_H = SCREEN_H / 4;

export class Bloom {
  readonly E = new Surface(EMISSIVE_W, EMISSIVE_H, true, true);
  private readonly b1 = new Surface(EMISSIVE_W / 2, EMISSIVE_H / 2, true, true);
  private readonly b2 = new Surface(EMISSIVE_W / 4, EMISSIVE_H / 4, true, true);
  /** 1/4 の加算の紙（ブルームの段と光の筋を重ねる） */
  private readonly Q = new Surface(EMISSIVE_W, EMISSIVE_H, true, true);
  /** 画面の半分の大きさの加算の紙（Q を滑らかに広げたもの。画面へは最近傍の 2 倍で貼る） */
  readonly H = new Surface(SCREEN_W / 2, SCREEN_H / 2, true, true);

  /**
   * 光る物の紙を黒く塗り、世界のドット座標のまま描ける向きにして返す。
   * 論理 x = (wx - camX) × 3 - 2 を 1/4 にした所へ描かれる
   */
  begin(camX: number, camY: number): Ctx2D {
    const g = this.E.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.E.w, this.E.h);
    const k = ART_SCALE / 4;
    g.setTransform(k, 0, 0, k, (-camX * ART_SCALE - CROP_X) / 4, (-camY * ART_SCALE - CROP_Y) / 4);
    return g;
  }

  /** 縮める（段の数だけ） */
  process(levels: number): void {
    this.E.g.setTransform(1, 0, 0, 1, 0, 0);
    if (levels <= 0) return;
    this.b1.g.drawImage(this.E.c, 0, 0, this.b1.w, this.b1.h);
    if (levels >= 2) this.b2.g.drawImage(this.b1.c, 0, 0, this.b2.w, this.b2.h);
  }

  /**
   * 1/4 の加算の紙 Q を作る（黒 ＋ にじみの段）。返す紙は論理座標の 1/4 の向きなので、
   * 続けて光の筋を論理座標のまま描ける（post.ts の drawShafts に 0.25 を渡す）。描き終えたら finish()
   */
  compose(strength: number, levels: number): Ctx2D {
    const q = this.Q.g;
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.globalAlpha = 1;
    q.globalCompositeOperation = 'source-over';
    q.fillStyle = '#000';
    q.fillRect(0, 0, this.Q.w, this.Q.h);
    if (levels > 0 && strength > 0) {
      q.imageSmoothingEnabled = true;
      q.globalCompositeOperation = 'lighter';
      // 細かいにじみ（1/8）と広いにじみ（1/16）。2 段の時は細かい方を控えめにする
      q.globalAlpha = strength * (levels >= 2 ? 0.7 : 1);
      q.drawImage(this.b1.c, 0, 0, this.Q.w, this.Q.h);
      if (levels >= 2) {
        q.globalAlpha = strength * 0.9;
        q.drawImage(this.b2.c, 0, 0, this.Q.w, this.Q.h);
      }
      q.globalAlpha = 1;
      q.globalCompositeOperation = 'source-over';
    }
    q.setTransform(0.25, 0, 0, 0.25, 0, 0);
    return q;
  }

  /** Q を半分の紙 H へ滑らかに広げる */
  finish(): void {
    this.Q.g.setTransform(1, 0, 0, 1, 0, 0);
    this.H.g.drawImage(this.Q.c, 0, 0, this.H.w, this.H.h);
  }

  /** 加算の紙を画面へ足す（最近傍の 2 倍）。g は論理座標（1280×720）の向き */
  apply(g: Ctx2D): void {
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'lighter';
    g.drawImage(this.H.c, 0, 0, SCREEN_W, SCREEN_H);
    g.globalCompositeOperation = 'source-over';
  }

  debugBuffers(out: { name: string; c: CanvasImageSource }[]): void {
    out.push({ name: 'emissive 320x180', c: this.E.c });
    out.push({ name: 'bloom1 160x90', c: this.b1.c });
    out.push({ name: 'bloom2 80x45', c: this.b2.c });
    out.push({ name: 'add (bloom+shafts) 320x180', c: this.Q.c });
    out.push({ name: 'add half 640x360', c: this.H.c });
  }
}
