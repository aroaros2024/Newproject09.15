/**
 * 光の紙を作り、画用紙に掛ける。
 *
 *   1 マス 1 画素の紙 3 枚（マスの状態が変わった時だけ作り直す）
 *     tileBase … 地の色（状態ごとの明るさ。lightModel.ts の表）
 *     tileMask … 光を通す量の灰色
 *     unexp    … 未探索マスだけ不透明な黒（地形の紙を真っ黒に塗る）
 *   光の紙（毎フレーム。画用紙の 1/2 か 1/4 の大きさ）
 *     LA … 不透明な黒に、焼いておいた放射状の光の絵を加算 → tileMask を乗算（見えない所は光を通さない）
 *     L  … tileBase を滑らかに拡大（マスの境がぼける）＋ LA を加算
 *     La … L を画用紙の大きさ（428×240）へ滑らかに拡大したもの。地形と床の物にはこれを乗算する
 *
 * 光は画用紙の 1 ドットごとに掛ける（画面の画素ごとではない）。
 * 画面の大きさで乗算すると、補間しながらの全画面の合成が 1 回 4ms ほど掛かる（ソフトウェア描画）。
 * 画用紙なら 1/9 の画素で済み、光の勾配はもともと滑らかなので、3×3 の段は目に見えない。
 * マスの紙は滑らかに拡大するので、隣のマスとの間で明るさがなめらかにつながる（ぼかしの代わり）。
 * ctx.filter は使わない（Safari で効かない）。
 */

import { type Canvas2D, type Ctx2D, makeCanvas } from './canvas.js';
import type { ActorLighter, WorldScene } from './types.js';
import type { ThemeLook } from '../art/terrain/types.js';
import {
  LightField, bakeLightSprite, fillTileImages, levelsFromLook, quantIndex,
} from '../gfx-core/lightModel.js';
import { ART_H, ART_W, TILE_ART } from './view.js';

// ---------------------------------------------------------------------------
// 紙
// ---------------------------------------------------------------------------

/** キャンバスと 2D コンテキストの組。作るのは大きさや画質が変わった時だけ */
export class Surface {
  readonly c: Canvas2D;
  readonly g: Ctx2D;
  readonly w: number;
  readonly h: number;

  /**
   * opaque = 透明を持たない紙（光・地形・ブルーム）。合成が少し速く、乗算の結果も素直になる。
   * smooth = 拡大縮小のときに補間する（光・ぼかし）。ドットの紙は補間しない
   */
  constructor(w: number, h: number, opaque = false, smooth = false) {
    this.w = Math.max(1, Math.floor(w));
    this.h = Math.max(1, Math.floor(h));
    this.c = makeCanvas(this.w, this.h);
    const g = (opaque
      ? this.c.getContext('2d', { alpha: false })
      : this.c.getContext('2d')) as Ctx2D | null;
    if (!g) throw new Error('2D コンテキストを取得できませんでした');
    this.g = g;
    g.imageSmoothingEnabled = smooth;
    if (smooth) g.imageSmoothingQuality = 'low';
  }

  /** 記憶を早く返す（大きさを 1×1 にする。キャンバスは GC されるまで画素を持ち続けるため） */
  release(): void {
    this.c.width = 1;
    this.c.height = 1;
  }
}

/** 光の絵の大きさ（ドット）。拡大して使うので小さくてよい */
export const LIGHT_SPRITE = 64;
/** 焼いておく光の色の数の上限（色は 16 段に丸めてから探す） */
const SPRITE_CACHE = 24;
/** キャラを色付けする作業用の紙の大きさ（ボスの 112 ドットが入る） */
export const ACTOR_SCRATCH = 128;

// ---------------------------------------------------------------------------
// 光の紙
// ---------------------------------------------------------------------------

export class LightRenderer {
  /** CPU 側の光の場（キャラの足元の明るさ・リムライト） */
  readonly field = new LightField();
  readonly lighter: SceneActorLighter;

  /** 光の紙の 1 画素が何ドットか（2 か 4） */
  private div = 0;
  L: Surface = new Surface(1, 1, true, true);
  LA: Surface = new Surface(1, 1, true, true);
  /** L を画用紙の大きさにしたもの（地形・床の物に乗算する） */
  readonly La = new Surface(ART_W, ART_H, true, true);

  tileBase: Surface | null = null;
  tileMask: Surface | null = null;
  unexp: Surface | null = null;
  private imgBase: ImageData | null = null;
  private imgMask: ImageData | null = null;
  private imgUnexp: ImageData | null = null;
  /** 上の ImageData を 32bit で見る窓（作り直す時だけ作る） */
  private u32Base = new Uint32Array(0);
  private u32Mask = new Uint32Array(0);
  private u32Unexp = new Uint32Array(0);

  private mapW = 0;
  private mapH = 0;
  private version = Number.NaN;
  private tilesDirty = true;
  private look: ThemeLook | null = null;

  /** 光の色（12 ビットに丸めた番号）→ 焼いた光の絵。Map の順番が古い順 */
  private sprites = new Map<number, Surface>();
  private spriteImg: ImageData | null = null;

  constructor() {
    this.lighter = new SceneActorLighter(this.field);
  }

  /** 光の紙の細かさを決める（画質が変わった時） */
  setDiv(div: 2 | 4): void {
    if (div === this.div) return;
    this.div = div;
    this.L.release();
    this.LA.release();
    this.L = new Surface(ART_W / div, ART_H / div, true, true);
    this.LA = new Surface(ART_W / div, ART_H / div, true, true);
  }

  /** テーマの空気を読み直す（参照が変わった時だけ） */
  setLook(look: ThemeLook): void {
    if (look === this.look) return;
    this.look = look;
    levelsFromLook(look, this.field.levels);
    this.tilesDirty = true;
  }

  /**
   * マスの状態を場面から写し、1 マス 1 画素の紙を作り直す。
   * 変わらないフレームでは何もしない（tileVersion を見る）。作り直したら true
   */
  syncTiles(scene: WorldScene): boolean {
    const w = Math.max(1, scene.mapW | 0);
    const h = Math.max(1, scene.mapH | 0);
    if (w !== this.mapW || h !== this.mapH || !this.tileBase) {
      this.mapW = w;
      this.mapH = h;
      this.field.resize(w, h);
      this.tileBase?.release();
      this.tileMask?.release();
      this.unexp?.release();
      // マスの紙は滑らかに拡大して使う（光の境をぼかす）。未探索の黒だけは補間しない
      this.tileBase = new Surface(w, h, true, true);
      this.tileMask = new Surface(w, h, true, true);
      this.unexp = new Surface(w, h, false, false);
      this.imgBase = new ImageData(w, h);
      this.imgMask = new ImageData(w, h);
      this.imgUnexp = new ImageData(w, h);
      this.u32Base = new Uint32Array(this.imgBase.data.buffer);
      this.u32Mask = new Uint32Array(this.imgMask.data.buffer);
      this.u32Unexp = new Uint32Array(this.imgUnexp.data.buffer);
      this.tilesDirty = true;
    }
    if (!this.tilesDirty && scene.tileVersion === this.version) return false;
    this.version = scene.tileVersion;
    this.tilesDirty = false;
    scene.writeTileStates(this.field.states);
    fillTileImages(this.field.states, w * h, this.field.levels,
      this.u32Base, this.u32Mask, this.u32Unexp);
    (this.tileBase as Surface).g.putImageData(this.imgBase as ImageData, 0, 0);
    (this.tileMask as Surface).g.putImageData(this.imgMask as ImageData, 0, 0);
    (this.unexp as Surface).g.putImageData(this.imgUnexp as ImageData, 0, 0);
    return true;
  }

  /**
   * 地形の紙（世界のドット座標のまま描ける状態）の上で、未探索マスを真っ黒に塗る。
   * 補間しないので、マスの境で黒がきっちり切れる
   */
  maskUnexplored(a: Ctx2D): void {
    const u = this.unexp;
    if (!u) return;
    const smooth = a.imageSmoothingEnabled;
    a.imageSmoothingEnabled = false;
    a.globalCompositeOperation = 'source-over';
    a.drawImage(u.c, 0, 0, this.mapW, this.mapH, 0, 0, this.mapW * TILE_ART, this.mapH * TILE_ART);
    a.imageSmoothingEnabled = smooth;
  }

  /**
   * 不透明な紙（世界のドット座標のまま描ける状態）に、光を通す量を乗算する。
   * 光る物の層に掛けると、未探索では光らず、探索済みでは 0.35 倍になる
   */
  multiplyGate(g: Ctx2D): void {
    const m = this.tileMask;
    if (!m) return;
    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'multiply';
    g.drawImage(m.c, 0, 0, this.mapW, this.mapH, 0, 0, this.mapW * TILE_ART, this.mapH * TILE_ART);
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = smooth;
  }

  /** 光の紙 LA と L を作る。光の一覧は prepare() 済みであること */
  build(camX: number, camY: number): void {
    const div = this.div;
    const L = this.L.g;
    const LA = this.LA.g;
    const k = 1 / div;
    const mw = this.mapW * TILE_ART;
    const mh = this.mapH * TILE_ART;

    // LA：不透明な黒 → 光を加算 → 光を通す量を乗算
    LA.setTransform(1, 0, 0, 1, 0, 0);
    LA.globalCompositeOperation = 'source-over';
    LA.globalAlpha = 1;
    LA.fillStyle = '#000';
    LA.fillRect(0, 0, this.LA.w, this.LA.h);
    LA.setTransform(k, 0, 0, k, -camX * k, -camY * k);
    LA.globalCompositeOperation = 'lighter';
    const list = this.field.lights;
    const x1 = camX + ART_W;
    const y1 = camY + ART_H;
    for (let i = 0; i < list.count; i++) {
      const r = list.radius[i];
      const x = list.x[i];
      const y = list.y[i];
      const s = list.strength[i];
      if (s <= 0.004 || x + r < camX || y + r < camY || x - r > x1 || y - r > y1) continue;
      const spr = this.sprite(list.r[i], list.g[i], list.b[i]);
      LA.globalAlpha = s;
      LA.drawImage(spr.c, x - r, y - r, r * 2, r * 2);
    }
    LA.globalAlpha = 1;
    if (this.tileMask) {
      LA.globalCompositeOperation = 'multiply';
      LA.drawImage(this.tileMask.c, 0, 0, this.mapW, this.mapH, 0, 0, mw, mh);
    }
    LA.globalCompositeOperation = 'source-over';
    blackOutside(LA, camX, camY, mw, mh);

    // L：黒 → 地の色（マスの紙を滑らかに拡大）→ LA を加算
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = 'source-over';
    L.globalAlpha = 1;
    L.fillStyle = '#000';
    L.fillRect(0, 0, this.L.w, this.L.h);
    if (this.tileBase) {
      L.setTransform(k, 0, 0, k, -camX * k, -camY * k);
      L.drawImage(this.tileBase.c, 0, 0, this.mapW, this.mapH, 0, 0, mw, mh);
      L.setTransform(1, 0, 0, 1, 0, 0);
    }
    L.globalCompositeOperation = 'lighter';
    L.drawImage(this.LA.c, 0, 0);
    L.globalCompositeOperation = 'source-over';

    // La：画用紙の大きさへ滑らかに拡大（不透明なので上書きで済む）
    this.La.g.drawImage(this.L.c, 0, 0, this.L.w, this.L.h, 0, 0, ART_W, ART_H);
  }

  /**
   * 地形の紙に光を掛ける：La を乗算 → 光だまり（LA）を少しだけ加算。
   * 乗算だけだと光の中心でも元の色より明るくならないので、加算で「照らされて光る」感じを足す
   */
  lightTerrain(a: Ctx2D, overbright: number): void {
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalAlpha = 1;
    a.globalCompositeOperation = 'multiply';
    a.drawImage(this.La.c, 0, 0);
    if (overbright > 0) {
      const smooth = a.imageSmoothingEnabled;
      a.imageSmoothingEnabled = true;
      a.globalCompositeOperation = 'lighter';
      a.globalAlpha = overbright;
      a.drawImage(this.LA.c, 0, 0, this.LA.w, this.LA.h, 0, 0, ART_W, ART_H);
      a.globalAlpha = 1;
      a.imageSmoothingEnabled = smooth;
    }
    a.globalCompositeOperation = 'source-over';
  }

  /**
   * 床の物の紙 src に光を掛けて dst に写す（dst は src と同じ大きさの透明な紙）。
   * 乗算の四角は透明な所まで塗るので、最後に src の形で切り抜く
   */
  lightGround(src: Canvas2D, dst: Surface): void {
    const d = dst.g;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'copy';
    d.drawImage(src, 0, 0);
    d.globalCompositeOperation = 'multiply';
    d.drawImage(this.La.c, 0, 0);
    d.globalCompositeOperation = 'destination-in';
    d.drawImage(src, 0, 0);
    d.globalCompositeOperation = 'source-over';
  }

  /** 光の色の絵。初めての色の時だけ焼く（色は 16 段に丸めるので種類は限られる） */
  private sprite(r: number, g: number, b: number): Surface {
    const key = quantIndex(r, g, b);
    const hit = this.sprites.get(key);
    if (hit) return hit;
    if (this.sprites.size >= SPRITE_CACHE) {
      const oldest = this.sprites.keys().next().value as number;
      this.sprites.get(oldest)?.release();
      this.sprites.delete(oldest);
    }
    const s = new Surface(LIGHT_SPRITE, LIGHT_SPRITE, false, true);
    if (!this.spriteImg) this.spriteImg = new ImageData(LIGHT_SPRITE, LIGHT_SPRITE);
    bakeLightSprite(this.spriteImg.data, LIGHT_SPRITE,
      ((key >> 8) & 15) / 15, ((key >> 4) & 15) / 15, (key & 15) / 15);
    s.g.putImageData(this.spriteImg, 0, 0);
    this.sprites.set(key, s);
    return s;
  }

  /** 検証用：中の紙を並べる */
  debugBuffers(out: { name: string; c: CanvasImageSource }[]): void {
    if (this.tileBase) out.push({ name: 'tileBase', c: this.tileBase.c });
    if (this.tileMask) out.push({ name: 'tileMask', c: this.tileMask.c });
    if (this.unexp) out.push({ name: 'unexplored', c: this.unexp.c });
    out.push({ name: `LA ${this.LA.w}x${this.LA.h}`, c: this.LA.c });
    out.push({ name: `L ${this.L.w}x${this.L.h}`, c: this.L.c });
    out.push({ name: 'La 428x240', c: this.La.c });
  }
}

/** 地図の外（カメラが地図の端を越えて映す所）を黒で塗る。世界のドット座標の状態で呼ぶ */
function blackOutside(g: Ctx2D, camX: number, camY: number, mw: number, mh: number): void {
  const x1 = camX + ART_W;
  const y1 = camY + ART_H;
  if (camX >= 0 && camY >= 0 && x1 <= mw && y1 <= mh) return;
  g.fillStyle = '#000';
  if (camX < 0) g.fillRect(camX, camY, -camX, ART_H);
  if (x1 > mw) g.fillRect(mw, camY, x1 - mw, ART_H);
  if (camY < 0) g.fillRect(camX, camY, ART_W, -camY);
  if (y1 > mh) g.fillRect(camX, mh, ART_W, y1 - mh);
}

// ---------------------------------------------------------------------------
// キャラの色付け
// ---------------------------------------------------------------------------

/** 16 段に丸めた色の番号 → 'rgb(…)'。初めて使う時に 1 度だけ作る */
const CSS_CACHE: (string | undefined)[] = [];

export function lightCss(qi: number): string {
  let s = CSS_CACHE[qi];
  if (s === undefined) {
    s = `rgb(${((qi >> 8) & 15) * 17},${((qi >> 4) & 15) * 17},${(qi & 15) * 17})`;
    CSS_CACHE[qi] = s;
  }
  return s;
}

/**
 * B（キャラの紙）に 1 体ずつ描く道具。
 *   作業用の紙にコマを写す → 足元の明るさの色で乗算（'multiply' の四角）→ コマの形で切り抜く（'destination-in'）
 *   → B へ写す。画質「高」ではさらに、いちばん強く当たる光の側の縁を 1 ドット明るくする（リムライト）
 */
export class SceneActorLighter implements ActorLighter {
  /** 画質「高」のときだけ true（compositor が決める） */
  rim = false;
  private b: Ctx2D | null = null;
  private readonly scratch = new Surface(ACTOR_SCRATCH, ACTOR_SCRATCH);
  private readonly rimBuf = new Surface(ACTOR_SCRATCH, ACTOR_SCRATCH);
  private readonly tmp = new Float32Array(3);
  private readonly rimTmp = new Float32Array(6);

  constructor(private readonly field: LightField) {}

  /** このフレームで描く紙を渡す（compositor が paintActors の前に呼ぶ） */
  bind(b: Ctx2D, rim: boolean): void {
    this.b = b;
    this.rim = rim;
  }

  sample(wx: number, wy: number, out: Float32Array | number[]): void {
    this.field.sampleLight(wx, wy, out);
  }

  drawFrame(f: Readonly<{ src: CanvasImageSource; sx: number; sy: number; w: number; h: number;
    ax: number; ay: number }>, footX: number, footY: number, alpha = 1, lit = true): void {
    this.drawImage(f.src, f.sx, f.sy, f.w, f.h, footX - f.ax, footY - f.ay, footX, footY, alpha, lit);
  }

  drawImage(src: CanvasImageSource, sx: number, sy: number, w: number, h: number,
    dx: number, dy: number, footX: number, footY: number, alpha = 1, lit = true): void {
    const b = this.b;
    if (!b || w <= 0 || h <= 0 || alpha <= 0) return;
    if (!lit || w > ACTOR_SCRATCH || h > ACTOR_SCRATCH) {
      b.globalAlpha = alpha;
      b.drawImage(src, sx, sy, w, h, dx, dy, w, h);
      b.globalAlpha = 1;
      return;
    }
    const t = this.tmp;
    this.field.sampleLight(footX, footY, t);
    const qi = quantIndex(t[0], t[1], t[2]);
    const s = this.scratch.g;
    // 'copy' は紙全体を置き換えるので、前のキャラの残りを消す手間が要らない
    s.globalCompositeOperation = 'copy';
    s.drawImage(src, sx, sy, w, h, 0, 0, w, h);
    if (qi !== 0xfff) {
      s.globalCompositeOperation = 'multiply';
      s.fillStyle = lightCss(qi);
      s.fillRect(0, 0, w, h);
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(src, sx, sy, w, h, 0, 0, w, h);
    }
    s.globalCompositeOperation = 'source-over';
    b.globalAlpha = alpha;
    b.drawImage(this.scratch.c, 0, 0, w, h, dx, dy, w, h);
    if (this.rim) this.drawRim(b, src, sx, sy, w, h, dx, dy, footX, footY, alpha);
    b.globalAlpha = 1;
  }

  /** 光の来る側の縁だけを光の色で加算する */
  private drawRim(b: Ctx2D, src: CanvasImageSource, sx: number, sy: number, w: number, h: number,
    dx: number, dy: number, footX: number, footY: number, alpha: number): void {
    const t = this.rimTmp;
    this.field.sampleRim(footX, footY, t);
    const k = t[0];
    if (k < 0.06) return;
    // 光への向きを 1 ドットの向きに丸める。縁 = 光の側の隣が空いている画素
    const ox = -Math.round(t[1]);
    const oy = -Math.round(t[2]);
    if (ox === 0 && oy === 0) return;
    const r = this.rimBuf.g;
    r.globalCompositeOperation = 'copy';
    r.fillStyle = lightCss(quantIndex(t[3], t[4], t[5]));
    r.fillRect(0, 0, w, h);
    r.globalCompositeOperation = 'destination-in';
    r.drawImage(src, sx, sy, w, h, 0, 0, w, h);
    r.globalCompositeOperation = 'destination-out';
    r.drawImage(src, sx, sy, w, h, ox, oy, w, h);
    r.globalCompositeOperation = 'source-over';
    b.globalCompositeOperation = 'lighter';
    b.globalAlpha = alpha * (k > 0.8 ? 0.8 : k);
    b.drawImage(this.rimBuf.c, 0, 0, w, h, dx, dy, w, h);
    b.globalCompositeOperation = 'source-over';
  }
}
