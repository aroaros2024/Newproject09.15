/**
 * コマの焼き置き場（SheetCache）。
 *
 * リグ（art/rig.ts）の絵は姿勢から毎回組み立てるので、描くたびに組み立てると重い。
 * 初めて要ったコマを 1 度だけ画用紙（PixBuf）に描き、パレットの色で画素にして
 * 種ごとの頁（キャンバス）へ並べて置く。以後は頁の一部を drawImage するだけ。
 *
 *   鍵    … 種の番号・動き・8 方向・コマ・仕上げ（通常 / 白い閃き / 崩れ 4 段 / 光る所だけ / 光る所以外は黒）
 *           を 1 つの数に詰める
 *   頁    … 種ごとに 8×4 コマの頁。足りなくなったら頁を足す
 *   上限  … 全部で 32MB。超えたら、いちばん長く使っていない種の頁をまとめて捨てる
 *   先焼き … 階に入る暗転の間に、その階に出る種を prebake しておく（歩き始めてから焼くと引っかかる）
 *
 * まだリグの無い敵・道具は、旧来の 16×16 の絵（sprites.ts の getSprite）を
 * 1 ドット = 1 画素（ボスは 2 倍）で 1 コマだけ焼いて同じ形で返す。全部の種にリグが揃うまでの仮の絵。
 *
 * frame() は使い回しの入れ物（FrameRef）を返すので、毎フレーム呼んでも物を作らない。
 * 頁を作る部分は差し替えられる（SheetBackend）。node のテストは偽の頁で数え方を確かめる。
 */

import {
  ANIM_IDS, type AnimDef, type AnimId, type Rig, type Variant, TIER_BOX, animOf, facing, getRig,
  getSpecies, renderFrame,
} from '../art/rig.js';
import { PixBuf } from '../art/pixbuf.js';
import { EMISSIVE, PAL_RGBA } from '../art/palette.js';
import { type PixelSprite, getSprite } from '../sprites.js';
import { type Canvas2D, type Ctx2D, makeCanvas } from './canvas.js';
import type { FrameRef } from './types.js';

export type { FrameRef } from './types.js';

// ---------------------------------------------------------------------------
// 仕上げの種類
// ---------------------------------------------------------------------------

/** そのまま */
export const FX_NORMAL = 0;
/** 白い閃き（被弾）。形はそのままで全部白 */
export const FX_FLASH = 1;
/** 崩れる途中（ベイヤーの網目で 25 / 50 / 75 / 90% を抜く） */
export const FX_DISSOLVE_25 = 2;
export const FX_DISSOLVE_50 = 3;
export const FX_DISSOLVE_75 = 4;
export const FX_DISSOLVE_90 = 5;
/** 光る色の画素だけ（ブルームの層に描く）。光る所が無ければ frame() は null */
export const FX_EMISSIVE = 6;
/**
 * 光る色はそのまま、ほかの画素は黒（ブルームの層に、キャラを前後の順に描くため）。
 * 手前のキャラの体が、奥の光る物を隠す。これが無いと、奥の光がキャラの体を透けてにじむ
 */
export const FX_OCCLUDER = 7;
export const FX_COUNT = 8;

/** 1 つの動きのコマ数の上限（鍵に 4 ビットで詰めるため） */
export const MAX_FRAMES = 16;
/** 全部の容量の既定（32MB） */
export const DEFAULT_CAP_BYTES = 32 * 1024 * 1024;
/** 作業用の画素の置き場の一辺（ボスの 112 ドットが入る） */
const WORK = 128;
/** 頁の並べ方（8 列 × 4 行）。隣のコマが滑らかな縮小でにじまないよう 1 ドットの隙間を空ける */
const COLS = 8;
const ROWS = 4;
const CELLS = COLS * ROWS;
const GUTTER = 1;

/**
 * 鍵を詰める。(((種 × 8 + 動き) × 8 + 向き) × 16 + コマ) × 8 + 仕上げ。
 * 種の番号が 2^30 を超えても Number の整数の範囲（2^53）に収まる。
 */
export function packKey(species: number, anim: number, dir8: number, frame: number, fx: number): number {
  return (((species * 8 + (anim & 7)) * 8 + (dir8 & 7)) * MAX_FRAMES + (frame & 15)) * 8 + (fx & 7);
}

/** 鍵を戻す（テストと検証用） */
export function unpackKey(key: number): { species: number; anim: number; dir8: number; frame: number; fx: number } {
  const fx = key % 8;
  let k = (key - fx) / 8;
  const frame = k % MAX_FRAMES;
  k = (k - frame) / MAX_FRAMES;
  const dir8 = k % 8;
  k = (k - dir8) / 8;
  const anim = k % 8;
  const species = (k - anim) / 8;
  return { species, anim, dir8, frame, fx };
}

/** 動きの名前 → 番号（ANIM_IDS の順） */
export const animIndex = (id: AnimId): number => ANIM_IDS.indexOf(id);

// ---------------------------------------------------------------------------
// 画素の仕上げ（DOM 無し）
// ---------------------------------------------------------------------------

/** 4×4 のベイヤー行列（0〜15）。pixbuf.ts の dither と同じ並び */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** 崩れの段ごとに抜く閾値（ベイヤーの値がこれ未満の画素を抜く）。16 分の 4 / 8 / 12 / 14 */
const DISSOLVE_CUT = [4, 8, 12, 14];
const OPAQUE_WHITE = 0xffffffff;
const OPAQUE_BLACK = 0xff000000;

/**
 * 画素（ImageData 用の 32bit、行の幅 stride）の左上 w×h に仕上げを掛ける。
 * emissive は画素ごとの「光る色か」（1/0）。無ければ光る所は無いとみなす。
 * 描かれている画素の数を返す。
 */
export function applyFx(rgba: Uint32Array, stride: number, w: number, h: number, fx: number,
  emissive: Uint8Array | null): number {
  let painted = 0;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let c = rgba[i];
      if (c === 0) continue;
      if (fx === FX_FLASH) {
        c = OPAQUE_WHITE;
      } else if (fx >= FX_DISSOLVE_25 && fx <= FX_DISSOLVE_90) {
        if (BAYER4[(y & 3) * 4 + (x & 3)] < DISSOLVE_CUT[fx - FX_DISSOLVE_25]) c = 0;
      } else if (fx === FX_EMISSIVE) {
        if (!emissive || emissive[i] !== 1) c = 0;
      } else if (fx === FX_OCCLUDER) {
        if (!emissive || emissive[i] !== 1) c = OPAQUE_BLACK;
      }
      rgba[i] = c;
      if (c !== 0) painted++;
    }
  }
  return painted;
}

/** CSS の色（'#rgb' '#rrggbb' '#rrggbbaa' 'rgb()' 'rgba()'）→ ImageData 用の 32bit（ABGR）。読めなければ 0 */
export function cssToRGBA(css: string): number {
  const s = css.trim();
  let r = 0, g = 0, b = 0, a = 255;
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
      if (h.length === 4) a = parseInt(h[3] + h[3], 16);
    } else if (h.length === 6 || h.length === 8) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
      if (h.length === 8) a = parseInt(h.slice(6, 8), 16);
    } else {
      return 0;
    }
  } else {
    const m = s.match(/^rgba?\(([^)]*)\)$/i);
    if (!m) return 0;
    const parts = m[1].split(',').map((p) => parseFloat(p));
    r = parts[0];
    g = parts[1];
    b = parts[2];
    if (parts.length > 3) a = Math.round(parts[3] * 255);
  }
  if ([r, g, b, a].some((v) => Number.isNaN(v))) return 0;
  // ドット絵は半透明を使わない（ART_GUIDE）。半分より薄い色は透明、それ以外は不透明にする
  if (a < 128) return 0;
  return ((255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

/**
 * 旧来の文字の格子の絵を画素にする（scale 倍）。out は w × h ちょうどの長さで返す。
 */
export function legacyToRGBA(sprite: PixelSprite, scale: number): { w: number; h: number; px: Uint32Array } {
  const rows = sprite.rows;
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const s = Math.max(1, scale | 0);
  const w = Math.max(1, cols * s);
  const h = Math.max(1, rows.length * s);
  const px = new Uint32Array(w * h);
  const colors = new Map<string, number>();
  for (const [ch, css] of Object.entries(sprite.palette)) colors.set(ch, cssToRGBA(css));
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const c = colors.get(row[x]);
      if (!c) continue;
      for (let yy = 0; yy < s; yy++) {
        for (let xx = 0; xx < s; xx++) px[(y * s + yy) * w + x * s + xx] = c;
      }
    }
  }
  return { w, h, px };
}

// ---------------------------------------------------------------------------
// 頁（差し替えられる）
// ---------------------------------------------------------------------------

export interface SheetPage {
  /** drawImage の元 */
  readonly src: CanvasImageSource;
}

export interface SheetBackend {
  /** w × h の空の頁を作る */
  newPage(w: number, h: number): SheetPage;
  /** 画素（行の幅 stride）の左上 w×h を、頁の (x, y) へ写す */
  upload(page: SheetPage, rgba: Uint32Array, stride: number, w: number, h: number, x: number,
    y: number): void;
  /** 頁を捨てる（記憶をすぐ返す） */
  release(page: SheetPage): void;
}

interface CanvasPage extends SheetPage {
  readonly src: Canvas2D;
  readonly g: Ctx2D;
}

/** ふつうの頁：キャンバス。画素は使い回しの ImageData から putImageData で写す */
export class CanvasSheetBackend implements SheetBackend {
  private img: ImageData | null = null;
  private u32 = new Uint32Array(0);

  newPage(w: number, h: number): SheetPage {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d') as Ctx2D | null;
    if (!g) throw new Error('2D コンテキストを取得できませんでした');
    g.imageSmoothingEnabled = false;
    const page: CanvasPage = { src: c, g };
    return page;
  }

  upload(page: SheetPage, rgba: Uint32Array, stride: number, w: number, h: number, x: number,
    y: number): void {
    if (!this.img) {
      this.img = new ImageData(WORK, WORK);
      this.u32 = new Uint32Array(this.img.data.buffer);
    }
    const u = this.u32;
    for (let yy = 0; yy < h; yy++) {
      const src = yy * stride;
      const dst = yy * WORK;
      for (let xx = 0; xx < w; xx++) u[dst + xx] = rgba[src + xx];
    }
    (page as CanvasPage).g.putImageData(this.img, x, y, 0, 0, w, h);
  }

  release(page: SheetPage): void {
    const c = (page as CanvasPage).src;
    c.width = 1;
    c.height = 1;
  }
}

// ---------------------------------------------------------------------------
// 置き場
// ---------------------------------------------------------------------------

interface Slot {
  page: SheetPage;
  sx: number;
  sy: number;
  /** 描く物が無い（光る所だけの仕上げで、光る所が無かった） */
  empty: boolean;
}

interface SpeciesRec {
  id: string;
  index: number;
  rig: Rig | null;
  variant: Variant | null;
  /** 旧来の絵の画素（w × h）。リグがあれば null */
  legacy: Uint32Array | null;
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** 動きの番号 → 実際に描く動きの番号（持っていない動きは待機へ） */
  animMap: Uint8Array;
  /** 実際に描く動きのコマ数 */
  animFrames: Uint8Array;
  /** 8 方向 → 同じ絵になる向きの代表（同じ絵を何度も焼かない） */
  dirMap: Uint8Array;
  slots: Map<number, Slot>;
  pages: SheetPage[];
  /** 最後の頁で使ったコマの数 */
  used: number;
  bytes: number;
  lastUse: number;
}

export interface SheetStats {
  species: number;
  /** 頁を持っている種の数 */
  resident: number;
  frames: number;
  pages: number;
  bytes: number;
}

export class SheetCache {
  readonly capBytes: number;
  /** 今持っている頁の合計（4 バイト × 画素） */
  bytes = 0;
  private readonly backend: SheetBackend;
  private readonly recs: SpeciesRec[] = [];
  private readonly byId = new Map<string, number>();
  private readonly ref: FrameRef = {
    src: null as unknown as CanvasImageSource, sx: 0, sy: 0, w: 0, h: 0, ax: 0, ay: 0,
  };
  private clock = 0;
  private readonly work = new Uint32Array(WORK * WORK);
  private readonly emis = new Uint8Array(WORK * WORK);
  /** 段の大きさごとの画用紙（リグの絵を描く場所） */
  private readonly bufs = new Map<number, PixBuf>();

  constructor(opts: { capBytes?: number; backend?: SheetBackend } = {}) {
    this.capBytes = opts.capBytes ?? DEFAULT_CAP_BYTES;
    this.backend = opts.backend ?? new CanvasSheetBackend();
  }

  /**
   * 種の番号。初めての id には番号を振る（毎フレーム引くより、出てきた時に 1 度引いて持っておく）。
   * リグのある種はリグで、無ければ旧来の絵で描く。どちらも無ければ -1。
   * legacyBoss は旧来の絵を 2 倍で焼くか（最初に引いた時の指定が残る）
   */
  index(id: string, legacyBoss = false): number {
    const hit = this.byId.get(id);
    if (hit !== undefined) return hit;
    const def = getSpecies(id);
    const rig = def ? getRig(def.rig) : undefined;
    let rec: SpeciesRec;
    const base = {
      id, index: this.recs.length, slots: new Map<number, Slot>(), pages: [] as SheetPage[],
      used: 0, bytes: 0, lastUse: 0,
      animMap: new Uint8Array(ANIM_IDS.length), animFrames: new Uint8Array(ANIM_IDS.length),
      dirMap: new Uint8Array(8),
    };
    if (def && rig) {
      const box = TIER_BOX[rig.tier];
      rec = { ...base, rig, variant: def.variant, legacy: null, w: box.w, h: box.h, ax: box.ax, ay: box.ay };
      for (let a = 0; a < ANIM_IDS.length; a++) {
        const own = rig.anims[ANIM_IDS[a]];
        const use = own ? a : 0;
        rec.animMap[a] = use;
        const d: AnimDef | null = animOf(rig, ANIM_IDS[use]);
        rec.animFrames[a] = Math.max(1, Math.min(MAX_FRAMES, d ? d.frames : 1));
      }
      for (let d = 0; d < 8; d++) {
        const f = facing(d, rig.dirs);
        let first = d;
        for (let e = 0; e < d; e++) {
          const g = facing(e, rig.dirs);
          if (g.draw === f.draw && g.mirror === f.mirror) {
            first = e;
            break;
          }
        }
        rec.dirMap[d] = first;
      }
    } else {
      const sprite = getSprite(id);
      if (!sprite) return -1;
      const scale = legacyBoss ? 2 : 1;
      const { w, h, px } = legacyToRGBA(sprite, scale);
      // 旧来の 16×16 はマスをちょうど覆う絵。マスの足元 (8, 13) が絵の同じ位置に来るようにする
      rec = {
        ...base, rig: null, variant: null, legacy: px, w, h,
        ax: Math.round((w * 8) / 16), ay: Math.round((h * 13) / 16),
      };
      rec.animFrames.fill(1);
      rec.dirMap.fill(4);
    }
    if (rec.w > WORK || rec.h > WORK) return -1;
    this.recs.push(rec);
    this.byId.set(id, rec.index);
    return rec.index;
  }

  /** 種の id（番号から） */
  idOf(species: number): string | null {
    return this.recs[species]?.id ?? null;
  }

  /** リグ（旧来の絵なら null）。浮く高さ・沈む深さを読むため */
  rigOf(species: number): Rig | null {
    return this.recs[species]?.rig ?? null;
  }

  /** 動きのコマ数（無い動きは待機のコマ数、旧来の絵は 1） */
  frameCount(species: number, anim: number): number {
    const rec = this.recs[species];
    if (!rec || anim < 0 || anim >= ANIM_IDS.length) return 1;
    return rec.animFrames[anim];
  }

  /** 動きの定義（速さ・当たりのコマ）。旧来の絵は null */
  animDef(species: number, anim: number): AnimDef | null {
    const rec = this.recs[species];
    if (!rec || !rec.rig || anim < 0 || anim >= ANIM_IDS.length) return null;
    return animOf(rec.rig, ANIM_IDS[rec.animMap[anim]]);
  }

  /**
   * 1 コマを返す（無ければここで焼く）。返す入れ物は使い回しなので、すぐ描いて手放すこと。
   * anim は ANIM_IDS の番号、dir8 は 0 = 北から時計回り、frame はコマ数で折り返す。
   * 種が無い・光る所だけの仕上げで光る所が無い時は null
   */
  frame(species: number, anim: number, dir8: number, frame: number, fx = FX_NORMAL): FrameRef | null {
    const rec = this.recs[species];
    if (!rec) return null;
    const a = anim >= 0 && anim < ANIM_IDS.length ? rec.animMap[anim] : 0;
    const n = rec.animFrames[a];
    const fr = n <= 1 ? 0 : (((frame | 0) % n) + n) % n;
    const d = rec.dirMap[dir8 & 7];
    const f = fx >= 0 && fx < FX_COUNT ? fx : FX_NORMAL;
    const key = packKey(species, a, d, fr, f);
    let slot = rec.slots.get(key);
    rec.lastUse = ++this.clock;
    if (!slot) slot = this.bake(rec, key, a, d, fr, f);
    if (slot.empty) return null;
    const ref = this.ref;
    ref.src = slot.page.src;
    ref.sx = slot.sx;
    ref.sy = slot.sy;
    ref.w = rec.w;
    ref.h = rec.h;
    ref.ax = rec.ax;
    ref.ay = rec.ay;
    return ref;
  }

  /**
   * 先に焼いておく（階に入る暗転の間）。持っている動き × 描く向き × コマ × 仕上げの全部。
   * 旧来の絵は 1 コマ
   */
  prebake(ids: readonly string[], fxList: readonly number[] = [FX_NORMAL]): void {
    for (const id of ids) {
      const s = this.index(id);
      if (s < 0) continue;
      const rec = this.recs[s];
      for (let a = 0; a < ANIM_IDS.length; a++) {
        if (rec.animMap[a] !== a) continue;
        for (let d = 0; d < 8; d++) {
          if (rec.dirMap[d] !== d) continue;
          for (let fr = 0; fr < rec.animFrames[a]; fr++) {
            for (const fx of fxList) this.frame(s, a, d, fr, fx);
          }
        }
      }
    }
  }

  /** keep に無い種の頁を全部捨てる（階が変わった時） */
  evictExcept(keep: readonly string[]): void {
    const set = new Set(keep);
    for (const rec of this.recs) if (!set.has(rec.id)) this.evict(rec);
  }

  /** 全部捨てる */
  clear(): void {
    for (const rec of this.recs) this.evict(rec);
  }

  stats(): SheetStats {
    let resident = 0;
    let frames = 0;
    let pages = 0;
    for (const rec of this.recs) {
      if (rec.pages.length > 0) resident++;
      frames += rec.slots.size;
      pages += rec.pages.length;
    }
    return { species: this.recs.length, resident, frames, pages, bytes: this.bytes };
  }

  // -------------------------------------------------------------------------

  private bufFor(w: number, h: number): PixBuf {
    const k = w * 1024 + h;
    let b = this.bufs.get(k);
    if (!b) {
      b = new PixBuf(w, h);
      this.bufs.set(k, b);
    }
    return b;
  }

  private bake(rec: SpeciesRec, key: number, a: number, d: number, fr: number, fx: number): Slot {
    const w = rec.w;
    const h = rec.h;
    const px = this.work;
    const em = this.emis;
    if (rec.rig && rec.variant) {
      const buf = this.bufFor(w, h);
      renderFrame(buf, rec.rig, rec.variant, ANIM_IDS[a], d, fr);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = buf.px[y * w + x];
          px[y * WORK + x] = PAL_RGBA[c];
          em[y * WORK + x] = EMISSIVE[c];
        }
      }
    } else if (rec.legacy) {
      const src = rec.legacy;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          px[y * WORK + x] = src[y * w + x];
          em[y * WORK + x] = 0;
        }
      }
    }
    const painted = applyFx(px, WORK, w, h, fx, em);
    if (painted === 0 && fx === FX_EMISSIVE) {
      const empty: Slot = { page: EMPTY_PAGE, sx: 0, sy: 0, empty: true };
      rec.slots.set(key, empty);
      return empty;
    }
    if (rec.pages.length === 0 || rec.used >= CELLS) this.addPage(rec);
    const cell = rec.used++;
    const page = rec.pages[rec.pages.length - 1];
    const sx = (cell % COLS) * (w + GUTTER * 2) + GUTTER;
    const sy = Math.floor(cell / COLS) * (h + GUTTER * 2) + GUTTER;
    this.backend.upload(page, px, WORK, w, h, sx, sy);
    const slot: Slot = { page, sx, sy, empty: false };
    rec.slots.set(key, slot);
    this.enforceCap(rec);
    return slot;
  }

  private addPage(rec: SpeciesRec): void {
    const pw = COLS * (rec.w + GUTTER * 2);
    const ph = ROWS * (rec.h + GUTTER * 2);
    rec.pages.push(this.backend.newPage(pw, ph));
    rec.used = 0;
    const bytes = pw * ph * 4;
    rec.bytes += bytes;
    this.bytes += bytes;
  }

  /** 上限を超えたら、いちばん長く使っていない種から頁を捨てる（今焼いている種は残す） */
  private enforceCap(current: SpeciesRec): void {
    while (this.bytes > this.capBytes) {
      let victim: SpeciesRec | null = null;
      for (const rec of this.recs) {
        if (rec === current || rec.bytes === 0) continue;
        if (!victim || rec.lastUse < victim.lastUse) victim = rec;
      }
      if (!victim) return;
      this.evict(victim);
    }
  }

  private evict(rec: SpeciesRec): void {
    for (const p of rec.pages) this.backend.release(p);
    rec.pages.length = 0;
    rec.slots.clear();
    this.bytes -= rec.bytes;
    rec.bytes = 0;
    rec.used = 0;
  }
}

/** 空のコマの印（描かないので中身は要らない） */
const EMPTY_PAGE: SheetPage = { src: null as unknown as CanvasImageSource };
