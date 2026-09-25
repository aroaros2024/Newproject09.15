/**
 * 演出の受け口（VfxSink の実装）と、その描き方。ダンジョンの場面が 1 つ持つ。
 *
 * VisualWorld（anim/）が「当たった瞬間」に呼ぶので、ここは待たずにすぐ出す：
 *   - 粒（burst）      … 演出の表（gfx-core/vfxPresets.ts）から粒の置き場へ吹き出す。光と揺れも表のとおり
 *   - 飛び道具          … 道具の絵を 90° ずつ回しながら弧を描いて飛ばす。矢は 8 方向の絵、魔法は光の玉
 *   - ビーム            … ドットの芯線を画用紙に、HD の光を画面に。光の頭が ms かけて走る
 *   - 一瞬の光          … 光源の一覧に足す（場面の collectLights が読む）
 *   - 揺れ・閃き・止め   … 状態だけ持ち、場面と描画エンジンが読む
 *   - 数字・告知の帯・階の札 … ui2/widgets.ts で HD の層に描く
 *
 * 置き場はどれも最初に確保した数だけ（飛び道具 16・ビーム 8・光 16）。あふれたら古い物を捨てる。
 * 揺れの向きは時刻のハッシュで決める（ゲームの乱数を使わない）。
 */

import type {
  BannerKind, BurstOpts, PopupKind, ProjectileKind, TilePoint, TransitionKind, VfxElement, VfxPresetId, VfxSink,
} from '../anim/types.js';
import { hashFloat } from '../art/hash.js';
import { PAL_CSS, type RampName } from '../art/palette.js';
import type { ParticlePool } from '../gfx-core/particles.js';
import { ELEMENT_RAMP, VFX, fireVfx } from '../gfx-core/vfxPresets.js';
import type { Ctx2D } from '../gfx/canvas.js';
import { arrowCanvas, itemCanvas, orbCanvas } from '../gfx/fxAtlas.js';
import { ART_SCALE, CROP_X, CROP_Y } from '../gfx/view.js';
import { PopupLayer, drawBanner, drawFloorCard, drawLetterbox, drawBossTitle } from '../ui2/widgets.js';

const PROJ_CAP = 16;
const BEAM_CAP = 8;
const LIGHT_CAP = 16;

/** 属性 → 魔法の玉の色 */
const ELEMENT_ORB: Record<VfxElement, RampName> = {
  physical: 'bone', fire: 'ember', ice: 'sky', thunder: 'gold', water: 'water', magic: 'violet', poison: 'leaf',
  light: 'gold',
};

/** '#rrggbb' → 属性（ビームの色から粒の階調を選ぶ） */
export function elementOfHex(hex: string): VfxElement {
  const n = parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return 'magic';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (r > 200 && g < 150 && b < 120) return 'fire';
  if (r > 200 && g > 190 && b < 140) return 'thunder';
  if (b > 200 && r < 150) return g > 180 ? 'ice' : 'water';
  if (g > 180 && r < 170 && b < 160) return 'poison';
  if (r > 150 && b > 180) return 'magic';
  if (r > 200 && g > 200 && b > 200) return 'light';
  return 'magic';
}

export class VfxLayer implements VfxSink {
  readonly popups = new PopupLayer();

  // --- 飛び道具（SoA）
  private readonly pFx = new Float32Array(PROJ_CAP);
  private readonly pFy = new Float32Array(PROJ_CAP);
  private readonly pTx = new Float32Array(PROJ_CAP);
  private readonly pTy = new Float32Array(PROJ_CAP);
  private readonly pT = new Float32Array(PROJ_CAP);
  private readonly pMs = new Float32Array(PROJ_CAP);
  private readonly pKey: string[] = new Array(PROJ_CAP).fill('');
  private readonly pKind: ProjectileKind[] = new Array(PROJ_CAP).fill('item');
  private pN = 0;

  // --- ビーム
  private readonly bFx = new Float32Array(BEAM_CAP);
  private readonly bFy = new Float32Array(BEAM_CAP);
  private readonly bTx = new Float32Array(BEAM_CAP);
  private readonly bTy = new Float32Array(BEAM_CAP);
  private readonly bT = new Float32Array(BEAM_CAP);
  private readonly bMs = new Float32Array(BEAM_CAP);
  private readonly bColor: string[] = new Array(BEAM_CAP).fill('#ffffff');
  private readonly bEl: VfxElement[] = new Array(BEAM_CAP).fill('magic');
  private bN = 0;

  // --- 一瞬の光（世界のドット）
  readonly lX = new Float32Array(LIGHT_CAP);
  readonly lY = new Float32Array(LIGHT_CAP);
  readonly lR = new Float32Array(LIGHT_CAP);
  readonly lI = new Float32Array(LIGHT_CAP);
  readonly lT = new Float32Array(LIGHT_CAP);
  readonly lMs = new Float32Array(LIGHT_CAP);
  readonly lColor: string[] = new Array(LIGHT_CAP).fill('#ffffff');
  lN = 0;

  // --- 画面の状態
  private shakePx = 0;
  private shakeMs = 0;
  private shakeLeft = 0;
  shakeX = 0;
  shakeY = 0;
  flashColor = '#ffffff';
  flashAlpha = 0;
  private flashMs = 0;
  private flashLeft = 0;
  private flashPeak = 0;
  hitstopLeft = 0;
  /** 暗転（0〜1） */
  fade = 0;
  private fadeDir = 0;
  // --- 告知の帯
  private bannerText = '';
  private bannerSub: string | null = null;
  private bannerKind: BannerKind = 'info';
  private bannerT = -1;
  /** 階の札（暗転が明ける時に出す） */
  private floorName = '';
  private floorLabel = '';
  private floorT = -1;
  private clock = 0;
  /** 動きを減らす設定（揺れ・強い閃き・止めを切る） */
  reduceMotion = false;

  constructor(
    private readonly pool: ParticlePool,
    private readonly onSfx: (id: string) => void,
    /** 撃破の時に、倒れた者の絵を粒にする（場面が絵を知っている）。tag は種の id */
    private readonly onDeath: (tileX: number, tileY: number, tag: string) => void = () => {},
  ) {}

  /** 階が変わった時・画面に入った時 */
  reset(): void {
    this.pN = 0;
    this.bN = 0;
    this.lN = 0;
    this.popups.clear();
    this.shakeLeft = 0;
    this.flashLeft = 0;
    this.flashAlpha = 0;
    this.hitstopLeft = 0;
    this.bannerT = -1;
  }

  /** 階の札に出す名前（floorIn の時に出す） */
  setFloorCard(dungeonName: string, depthLabel: string): void {
    this.floorName = dungeonName;
    this.floorLabel = depthLabel;
  }

  // =========================================================== VfxSink

  burst(preset: VfxPresetId, tileX: number, tileY: number, opts: Readonly<BurstOpts>): void {
    fireVfx(this.pool, preset, tileX * 16, tileY * 16, opts);
    const r = VFX[preset];
    if (r.light) this.light(tileX, tileY, opts.color || r.light.color, r.light.radius, r.light.intensity, r.light.ms);
    if (r.shake) this.shake(r.shake[0] * Math.min(2, opts.power || 1), r.shake[1]);
    if (preset === 'death' && opts.tag) this.onDeath(tileX, tileY, opts.tag);
  }

  beam(from: TilePoint, to: TilePoint, color: string, element: VfxElement, ms: number): void {
    const i = this.bN < BEAM_CAP ? this.bN++ : this.oldestBeam();
    this.bFx[i] = from.x;
    this.bFy[i] = from.y;
    this.bTx[i] = to.x;
    this.bTy[i] = to.y;
    this.bT[i] = 0;
    this.bMs[i] = Math.max(60, ms);
    this.bColor[i] = color || '#c080ff';
    this.bEl[i] = element;
  }

  projectile(from: TilePoint, to: TilePoint, spriteKey: string | null, kind: ProjectileKind, ms: number): void {
    const i = this.pN < PROJ_CAP ? this.pN++ : 0;
    this.pFx[i] = from.x;
    this.pFy[i] = from.y;
    this.pTx[i] = to.x;
    this.pTy[i] = to.y;
    this.pT[i] = 0;
    this.pMs[i] = Math.max(40, ms);
    this.pKey[i] = spriteKey ?? (kind === 'gitan' ? 'gitan' : '');
    this.pKind[i] = kind;
  }

  light(tileX: number, tileY: number, color: string, radius: number, intensity: number, durationMs: number): void {
    let i = this.lN < LIGHT_CAP ? this.lN++ : -1;
    if (i < 0) {
      // 一番弱っている光を差し替える
      let best = 0;
      for (let k = 1; k < LIGHT_CAP; k++) if (this.lT[k] / this.lMs[k] > this.lT[best] / this.lMs[best]) best = k;
      i = best;
    }
    this.lX[i] = tileX * 16 + 8;
    this.lY[i] = tileY * 16 + 8;
    this.lR[i] = radius * 16;
    this.lI[i] = intensity;
    this.lT[i] = 0;
    this.lMs[i] = Math.max(1, durationMs);
    this.lColor[i] = color;
  }

  shake(px: number, ms: number): void {
    if (this.reduceMotion) return;
    if (px >= this.shakePx * (this.shakeLeft / Math.max(1, this.shakeMs))) {
      this.shakePx = px;
      this.shakeMs = ms;
      this.shakeLeft = ms;
    }
  }

  flash(color: string, alpha: number, ms: number): void {
    this.flashColor = color;
    this.flashPeak = this.reduceMotion ? Math.min(alpha, 0.2) : alpha;
    this.flashMs = Math.max(1, ms);
    this.flashLeft = this.flashMs;
  }

  hitstop(ms: number): void {
    if (this.reduceMotion) return;
    this.hitstopLeft = Math.max(this.hitstopLeft, ms);
  }

  popup(text: string, kind: PopupKind, tileX: number, tileY: number): void {
    this.popups.spawn(text, kind, tileX, tileY);
  }

  banner(text: string, sub?: string, kind: BannerKind = 'info'): void {
    this.bannerText = text;
    this.bannerSub = sub ?? null;
    this.bannerKind = kind;
    this.bannerT = 0;
  }

  transition(kind: TransitionKind): void {
    if (kind === 'floorOut') {
      this.fadeDir = 1;
    } else {
      this.fade = 1;
      this.fadeDir = -1;
      this.floorT = 0;
    }
  }

  sfx(id: string): void {
    this.onSfx(id);
  }

  // =========================================================== 進める

  tick(stepMs: number): void {
    this.clock += stepMs;
    if (this.hitstopLeft > 0) this.hitstopLeft = Math.max(0, this.hitstopLeft - stepMs);
    // 飛び道具とビーム
    for (let i = 0; i < this.pN;) {
      this.pT[i] += stepMs;
      if (this.pT[i] >= this.pMs[i]) this.removeProjectile(i);
      else i++;
    }
    for (let i = 0; i < this.bN;) {
      this.bT[i] += stepMs;
      // 走り切ってから少し残して消える
      if (this.bT[i] >= this.bMs[i] + 160) this.removeBeam(i);
      else i++;
    }
    for (let i = 0; i < this.lN;) {
      this.lT[i] += stepMs;
      if (this.lT[i] >= this.lMs[i]) this.removeLight(i);
      else i++;
    }
    // 揺れ（減衰しながら向きを変える）
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - stepMs);
      const k = this.shakeLeft / Math.max(1, this.shakeMs);
      const a = hashFloat(Math.floor(this.clock / 33), 7, 5) * Math.PI * 2;
      this.shakeX = Math.round(Math.cos(a) * this.shakePx * k);
      this.shakeY = Math.round(Math.sin(a) * this.shakePx * k);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (this.flashLeft > 0) {
      this.flashLeft = Math.max(0, this.flashLeft - stepMs);
      this.flashAlpha = this.flashPeak * (this.flashLeft / this.flashMs);
    } else {
      this.flashAlpha = 0;
    }
    if (this.fadeDir > 0) this.fade = Math.min(1, this.fade + stepMs / 220);
    else if (this.fadeDir < 0) {
      this.fade = Math.max(0, this.fade - stepMs / 380);
      if (this.fade === 0) this.fadeDir = 0;
    }
    if (this.bannerT >= 0) {
      this.bannerT += stepMs;
      if (this.bannerT > 2600) this.bannerT = -1;
    }
    if (this.floorT >= 0) {
      this.floorT += stepMs;
      if (this.floorT > 1500) this.floorT = -1;
    }
    this.popups.update(stepMs);
  }

  /** 一瞬の光の今の強さ（0〜1）。光の一覧に足す時に掛ける */
  lightStrength(i: number): number {
    const t = this.lT[i] / this.lMs[i];
    return this.lI[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
  }

  private oldestBeam(): number {
    let best = 0;
    for (let k = 1; k < BEAM_CAP; k++) if (this.bT[k] > this.bT[best]) best = k;
    return best;
  }

  private removeProjectile(i: number): void {
    const last = --this.pN;
    if (i === last) return;
    this.pFx[i] = this.pFx[last]; this.pFy[i] = this.pFy[last];
    this.pTx[i] = this.pTx[last]; this.pTy[i] = this.pTy[last];
    this.pT[i] = this.pT[last]; this.pMs[i] = this.pMs[last];
    this.pKey[i] = this.pKey[last]; this.pKind[i] = this.pKind[last];
  }

  private removeBeam(i: number): void {
    const last = --this.bN;
    if (i === last) return;
    this.bFx[i] = this.bFx[last]; this.bFy[i] = this.bFy[last];
    this.bTx[i] = this.bTx[last]; this.bTy[i] = this.bTy[last];
    this.bT[i] = this.bT[last]; this.bMs[i] = this.bMs[last];
    this.bColor[i] = this.bColor[last]; this.bEl[i] = this.bEl[last];
  }

  private removeLight(i: number): void {
    const last = --this.lN;
    if (i === last) return;
    this.lX[i] = this.lX[last]; this.lY[i] = this.lY[last];
    this.lR[i] = this.lR[last]; this.lI[i] = this.lI[last];
    this.lT[i] = this.lT[last]; this.lMs[i] = this.lMs[last];
    this.lColor[i] = this.lColor[last];
  }

  // =========================================================== 描く

  /**
   * ドットの層（キャラの紙の上、世界のドット座標）：飛び道具とビームの芯線。
   * 描画エンジンは紙をカメラの分ずらしてから渡すので、世界の座標のまま描けばよい
   */
  paintPixel(b: Ctx2D): void {
    for (let i = 0; i < this.pN; i++) {
      const t = Math.min(1, this.pT[i] / this.pMs[i]);
      const x0 = this.pFx[i] * 16 + 8;
      const y0 = this.pFy[i] * 16 + 8;
      const x1 = this.pTx[i] * 16 + 8;
      const y1 = this.pTy[i] * 16 + 8;
      const kind = this.pKind[i];
      const key = this.pKey[i];
      const arc = kind === 'magic' ? 0 : key.includes('Arrow') || key === 'arrow' ? 2 : 7;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * arc);
      if (kind === 'magic') {
        const c = orbCanvas(Math.floor(this.pT[i] / 70), 'violet');
        b.drawImage(c, x - 6, y - 6);
        continue;
      }
      if (arc === 2) {
        const dir = dir8Of(x1 - x0, y1 - y0);
        b.drawImage(arrowCanvas(dir), x - 8, y - 8);
        continue;
      }
      const c = key ? itemCanvas(key) : null;
      if (!c) continue;
      // 90° ずつ回す（ドットの形を崩さない回し方）
      const q = Math.floor(this.pT[i] / 60) & 3;
      b.save();
      b.translate(x, y);
      b.rotate((q * Math.PI) / 2);
      b.drawImage(c, -8, -8);
      b.restore();
    }
    for (let i = 0; i < this.bN; i++) {
      const head = Math.min(1, this.bT[i] / this.bMs[i]);
      const x0 = this.bFx[i] * 16 + 8;
      const y0 = this.bFy[i] * 16 + 6;
      const x1 = x0 + (this.bTx[i] * 16 + 8 - x0) * head;
      const y1 = y0 + (this.bTy[i] * 16 + 6 - y0) * head;
      const ramp = ELEMENT_RAMP[this.bEl[i]];
      const fadeOut = this.bT[i] > this.bMs[i] ? 1 - (this.bT[i] - this.bMs[i]) / 160 : 1;
      b.globalAlpha = fadeOut;
      pixelLine(b, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), PAL_CSS[ramp[1] ?? ramp[0]]);
      b.globalAlpha = 1;
    }
  }

  /** HD の層（画面の論理座標）：ビームの光・光の頭・数字・告知の帯・階の札・暗転 */
  paintHD(g: Ctx2D, camX: number, camY: number, tilePx = 16 * ART_SCALE): void {
    const ox = -camX * ART_SCALE - CROP_X;
    const oy = -camY * ART_SCALE - CROP_Y;
    if (this.bN > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (let i = 0; i < this.bN; i++) {
        const head = Math.min(1, this.bT[i] / this.bMs[i]);
        const fadeOut = this.bT[i] > this.bMs[i] ? 1 - (this.bT[i] - this.bMs[i]) / 160 : 1;
        const x0 = ox + (this.bFx[i] * 16 + 8) * ART_SCALE;
        const y0 = oy + (this.bFy[i] * 16 + 6) * ART_SCALE;
        const x1 = x0 + ((this.bTx[i] - this.bFx[i]) * 16 * ART_SCALE) * head;
        const y1 = y0 + ((this.bTy[i] - this.bFy[i]) * 16 * ART_SCALE) * head;
        g.strokeStyle = this.bColor[i];
        g.globalAlpha = 0.25 * fadeOut;
        g.lineWidth = 18;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.globalAlpha = 0.5 * fadeOut;
        g.lineWidth = 7;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        // 走る光の頭
        if (head < 1) {
          const grad = g.createRadialGradient(x1, y1, 0, x1, y1, 26);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(0.3, this.bColor[i]);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad;
          g.globalAlpha = 0.9;
          g.fillRect(x1 - 26, y1 - 26, 52, 52);
        }
      }
      g.restore();
    }
    this.popups.draw(g as CanvasRenderingContext2D, ox, oy, tilePx);
  }

  /** 画面の一番上（UI の下）：告知の帯・階の札・暗転。論理座標 */
  paintOverlay(g: Ctx2D): void {
    const gg = g as CanvasRenderingContext2D;
    if (this.bannerT >= 0) {
      if (this.bannerKind === 'boss') {
        const k = Math.min(1, this.bannerT / 300) * (this.bannerT > 2200 ? Math.max(0, 1 - (this.bannerT - 2200) / 400) : 1);
        drawLetterbox(gg, k);
        drawBossTitle(gg, this.bannerText, this.bannerSub, this.bannerT, 2600);
      } else if (this.bannerKind !== 'floor') {
        const color = this.bannerKind === 'house' ? '#ffb0a0' : this.bannerKind === 'gameOver' ? '#e07a6a' : '#e8d6a0';
        drawBanner(gg, this.bannerText, this.bannerSub, this.bannerT, 2000, 250, color);
      }
    }
    if (this.fade > 0) {
      g.save();
      g.globalAlpha = this.fade;
      g.fillStyle = '#05060b';
      g.fillRect(0, 0, 1280, 720);
      g.restore();
    }
    if (this.floorT >= 0 && this.floorLabel) {
      const t = this.floorT;
      const a = t < 200 ? t / 200 : t > 1100 ? Math.max(0, 1 - (t - 1100) / 400) : 1;
      drawFloorCard(gg, this.floorName, this.floorLabel, a);
    }
  }
}

/** 向き（dx, dy）→ 8 方向（0 = 北から時計回り） */
function dir8Of(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return ((Math.round(a / (Math.PI / 4)) + 2) % 8 + 8) % 8;
}

/** 1 ドット幅の線（二重点を作らない Bresenham） */
function pixelLine(b: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  b.fillStyle = color;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (let n = 0; n < 2000; n++) {
    b.fillRect(x, y, 1, 1);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export { ELEMENT_ORB };
