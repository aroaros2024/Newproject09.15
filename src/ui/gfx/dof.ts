/**
 * 被写界深度（ミニチュア写真のように画面の上と下をぼかす）。
 *
 * ぼかすのは **地形の紙（A、光を掛けた後）だけ**。床の物・キャラはぼかさない（遊びの情報を隠さない）。
 * A を 214×120 → 107×60 と縮め、拡大して元の大きさに戻すとぼける（ctx.filter は使わない）。
 * ぼけた絵を「上の帯 14%・下の帯 10%」だけ残す濃淡の紙で切り抜き（'destination-in'）、A の上に重ねる。
 * 帯の外（真ん中）は透明なので、A がそのまま見える。
 * 強さは Live A Live 寄りに弱め（上端でいちばん強く、下端はその 8 割）。
 *
 * 画面へは帯の所だけを描く（真ん中は透明なので描いても変わらない。補間の合成の画素を 1/4 に減らす）。
 * 整数でない倍率の画面では、画用紙の上で重ねてから 1 回で拡大する（applyArt）。
 */

import { Surface } from './lighting.js';
import type { Canvas2D, Ctx2D } from './canvas.js';
import { ART_H, ART_SCALE, ART_W, CROP_X, CROP_Y } from './view.js';

/** 上の帯（画面の高さに対する割合） */
export const DOF_TOP = 0.14;
/** 下の帯 */
export const DOF_BOTTOM = 0.10;
/** 上端・下端のぼけの強さ（1 で、ぼけた絵だけになる） */
const TOP_STRENGTH = 0.9;
const BOTTOM_STRENGTH = 0.72;
/** 1/4 まで縮めた絵と 1/2 の絵の混ぜ方。1/4 だけだと強すぎる */
const COARSE_MIX = 0.5;

export class DepthOfField {
  private readonly d1 = new Surface(ART_W / 2, ART_H / 2, true, true);
  private readonly d2 = new Surface(ART_W / 4, ART_H / 4, true, true);
  private readonly out = new Surface(ART_W / 2, ART_H / 2, false, true);
  private readonly band = new Surface(2, ART_H, false, true);

  constructor() {
    // 帯の濃淡は最初に 1 度だけ焼く（行ごとの透明度）
    const img = new ImageData(this.band.w, this.band.h);
    const top = DOF_TOP * ART_H;
    const bottom = DOF_BOTTOM * ART_H;
    for (let y = 0; y < ART_H; y++) {
      const yc = y + 0.5;
      let a = 0;
      if (yc < top) a = TOP_STRENGTH * Math.pow(1 - yc / top, 1.6);
      else if (yc > ART_H - bottom) a = BOTTOM_STRENGTH * Math.pow((yc - (ART_H - bottom)) / bottom, 1.6);
      for (let x = 0; x < this.band.w; x++) {
        const i = (y * this.band.w + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    this.band.g.putImageData(img, 0, 0);
  }

  /** 地形の紙からぼけた帯を作る */
  render(a: Canvas2D): void {
    this.d1.g.drawImage(a, 0, 0, ART_W, ART_H, 0, 0, this.d1.w, this.d1.h);
    this.d2.g.drawImage(this.d1.c, 0, 0, this.d1.w, this.d1.h, 0, 0, this.d2.w, this.d2.h);
    const o = this.out.g;
    o.globalCompositeOperation = 'copy';
    o.globalAlpha = 1;
    o.drawImage(this.d2.c, 0, 0, this.d2.w, this.d2.h, 0, 0, this.out.w, this.out.h);
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 1 - COARSE_MIX;
    o.drawImage(this.d1.c, 0, 0);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(this.band.c, 0, 0, this.band.w, this.band.h, 0, 0, this.out.w, this.out.h);
    o.globalCompositeOperation = 'source-over';
  }

  /** 画面の地形の上に重ねる（上と下の帯だけ）。g は論理座標の向き */
  apply(g: Ctx2D): void {
    g.imageSmoothingEnabled = true;
    const o = this.out;
    const k = (ART_H * ART_SCALE) / o.h;
    const topRows = Math.ceil(o.h * DOF_TOP) + 1;
    const bottomRows = Math.ceil(o.h * DOF_BOTTOM) + 1;
    g.drawImage(o.c, 0, 0, o.w, topRows, -CROP_X, -CROP_Y, ART_W * ART_SCALE, topRows * k);
    g.drawImage(o.c, 0, o.h - bottomRows, o.w, bottomRows,
      -CROP_X, -CROP_Y + (o.h - bottomRows) * k, ART_W * ART_SCALE, bottomRows * k);
  }

  /** 画用紙（向きは素のまま）の上に重ねる（整数でない倍率の画面で、拡大を 1 回にまとめるため） */
  applyArt(a: Ctx2D): void {
    a.setTransform(1, 0, 0, 1, 0, 0);
    const smooth = a.imageSmoothingEnabled;
    a.imageSmoothingEnabled = true;
    a.drawImage(this.out.c, 0, 0, this.out.w, this.out.h, 0, 0, ART_W, ART_H);
    a.imageSmoothingEnabled = smooth;
  }

  debugBuffers(out: { name: string; c: CanvasImageSource }[]): void {
    out.push({ name: 'dof1 214x120', c: this.d1.c });
    out.push({ name: 'dof2 107x60', c: this.d2.c });
    out.push({ name: 'dof out (masked)', c: this.out.c });
    out.push({ name: 'dof band', c: this.band.c });
  }
}
