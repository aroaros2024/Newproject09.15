/**
 * 演出。ロジックが積んだ GameEvent を受け取り、見た目の動きへ変換する。
 *
 * 方針: ロジックは決してアニメーションを待たない。
 * ここはあくまで「見た目を追従させる」役なので、入力が速ければ
 * 演出は途中で追い越されるだけで、ゲーム進行は詰まらない。
 */

import type { Point } from '../core/geom.js';
import type { GameEvent } from '../core/types.js';
import { ANIM, FX, TILE } from './theme.js';

/** アクターの見た目の状態（論理位置へ滑らかに追いつく） */
export interface ActorView {
  /** 表示位置（タイル座標の小数） */
  x: number;
  y: number;
  /** 被弾のつぶれ具合 0〜1 */
  squash: number;
  /** 白く光る度合い 0〜1 */
  flash: number;
  /** 攻撃の突き出し（方向ベクトル×量） */
  lungeX: number;
  lungeY: number;
  /** 消滅アニメーション 0〜1（1 で消える） */
  fade: number;
}

export type PopupKind = 'damage' | 'heal' | 'exp' | 'gitan' | 'miss' | 'critical';

interface Popup {
  text: string;
  kind: PopupKind;
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

interface Projectile {
  from: Point;
  to: Point;
  sprite: string;
  kind: 'item' | 'magic' | 'gitan';
  life: number;
  maxLife: number;
}

interface Beam {
  from: Point;
  to: Point;
  color: string;
  life: number;
  maxLife: number;
}

interface Burst {
  pos: Point;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface Banner {
  text: string;
  sub?: string;
  life: number;
  maxLife: number;
  color: string;
}

export class FxSystem {
  views = new Map<number, ActorView>();
  popups: Popup[] = [];
  projectiles: Projectile[] = [];
  beams: Beam[] = [];
  bursts: Burst[] = [];
  banner: Banner | null = null;

  /** 画面のゆれ */
  shake = 0;
  shakeX = 0;
  shakeY = 0;
  /** 画面全体のフラッシュ */
  flashColor = '';
  flashLife = 0;
  flashMax = 1;

  /** アニメーション速度の倍率（設定で変える。0 で瞬間） */
  speedScale = 1;

  /** 演出がひと段落するまでの待ち時間(ms)。階層移動などで使う */
  private holdMs = 0;

  /** 画面のゆれを無効にする設定 */
  reduceMotion = false;

  /** アクターの見た目を取得（無ければ作る） */
  view(id: number, at: Point): ActorView {
    let v = this.views.get(id);
    if (!v) {
      v = { x: at.x, y: at.y, squash: 0, flash: 0, lungeX: 0, lungeY: 0, fade: 0 };
      this.views.set(id, v);
    }
    return v;
  }

  /** いなくなったアクターの見た目を捨てる */
  prune(aliveIds: Set<number>): void {
    for (const id of [...this.views.keys()]) {
      if (!aliveIds.has(id)) this.views.delete(id);
    }
  }

  reset(): void {
    this.views.clear();
    this.popups = [];
    this.projectiles = [];
    this.beams = [];
    this.bursts = [];
    this.banner = null;
    this.shake = 0;
    this.flashLife = 0;
    this.holdMs = 0;
  }

  /** 演出待ちか（階層移動の暗転など、入力を止めたい場面だけ true） */
  isHolding(): boolean {
    return this.holdMs > 0;
  }

  hold(ms: number): void {
    this.holdMs = Math.max(this.holdMs, ms * this.speedScale);
  }

  /** ロジックのイベントを演出へ変換する */
  consume(events: readonly GameEvent[], posOf: (actorId: number) => Point | null): void {
    for (const e of events) {
      switch (e.t) {
        case 'move': {
          const v = this.views.get(e.actorId);
          if (v) {
            // 現在の見た目はそのまま。論理位置へは update() で追いつく
          } else {
            this.view(e.actorId, e.from);
          }
          break;
        }
        case 'bump': {
          const v = this.views.get(e.actorId);
          if (v) {
            const d = DIR_VEC8[e.dir];
            v.lungeX = d.x * 0.22;
            v.lungeY = d.y * 0.22;
          }
          break;
        }
        case 'attack': {
          const v = this.views.get(e.actorId);
          const from = posOf(e.actorId);
          const to = posOf(e.targetId);
          if (v && from && to) {
            const dx = Math.sign(to.x - from.x);
            const dy = Math.sign(to.y - from.y);
            v.lungeX = dx * 0.38;
            v.lungeY = dy * 0.38;
          }
          if (e.critical) {
            this.addFlash(FX.flashCritical, 140);
            this.addShake(FX.shakeLarge);
          }
          break;
        }
        case 'miss': {
          const p = posOf(e.targetId);
          if (p) this.addPopup('MISS', 'miss', p);
          break;
        }
        case 'damage': {
          const v = this.views.get(e.actorId);
          if (v) {
            v.squash = 1;
            v.flash = 1;
          }
          const p = posOf(e.actorId);
          if (p) this.addPopup(String(e.amount), 'damage', p);
          break;
        }
        case 'heal': {
          const p = posOf(e.actorId);
          if (p) this.addPopup(`+${e.amount}`, 'heal', p);
          break;
        }
        case 'defeat': {
          const v = this.views.get(e.actorId);
          if (v) v.fade = 0.001;
          break;
        }
        case 'levelUp': {
          const p = posOf(e.actorId);
          if (p) this.addPopup('LEVEL UP!', 'exp', p);
          this.addFlash('rgba(120,200,255,0.25)', 320);
          break;
        }
        case 'projectile':
          this.projectiles.push({
            from: e.from, to: e.to, sprite: e.sprite, kind: e.kind,
            life: 0, maxLife: this.dur(ANIM.projectile * Math.max(1, dist(e.from, e.to))),
          });
          break;
        case 'zap':
          this.beams.push({
            from: e.from, to: e.to, color: e.color,
            life: 0, maxLife: this.dur(ANIM.zap),
          });
          break;
        case 'explosion':
          this.bursts.push({
            pos: e.pos, radius: e.radius, color: '#ff9b3d',
            life: 0, maxLife: this.dur(ANIM.explosion),
          });
          this.addShake(FX.shakeLarge);
          this.addFlash('rgba(255,160,60,0.35)', 260);
          break;
        case 'warp': {
          const v = this.views.get(e.actorId);
          if (v) {
            v.x = e.to.x;
            v.y = e.to.y;
            v.flash = 1;
          }
          this.bursts.push({
            pos: e.to, radius: 1, color: '#a0c0ff',
            life: 0, maxLife: this.dur(240),
          });
          break;
        }
        case 'trap':
          this.addShake(FX.shakeSmall);
          break;
        case 'monsterHouse':
          this.showBanner('モンスターハウス！', houseLabel(e.kind), '#ff5a5a');
          this.addShake(FX.shakeLarge);
          this.hold(600);
          break;
        case 'bossAppear':
          this.showBanner('ボスが 立ちはだかる', undefined, '#ffd24a');
          this.hold(700);
          break;
        case 'floorChange':
          this.reset();
          this.hold(ANIM.floorFade);
          break;
        case 'gameOver':
          this.showBanner('ちからつきた……', e.reason, '#ff5a5a');
          this.hold(1200);
          break;
        case 'dungeonClear':
          this.showBanner('ダンジョン クリア！', undefined, '#ffd24a');
          this.hold(1200);
          break;
        case 'flash':
          this.addFlash(e.color, e.ms);
          break;
        case 'shake':
          this.addShake(e.power);
          break;
        case 'pause':
          this.hold(e.ms);
          break;
        default:
          break;
      }
    }
  }

  private dur(ms: number): number {
    return Math.max(1, ms * this.speedScale);
  }

  addPopup(text: string, kind: PopupKind, at: Point): void {
    this.popups.push({
      text, kind, x: at.x, y: at.y,
      life: 0, maxLife: this.dur(kind === 'exp' ? 900 : 620),
    });
    if (this.popups.length > 40) this.popups.shift();
  }

  addShake(power: number): void {
    if (this.reduceMotion) return;
    this.shake = Math.max(this.shake, power);
  }

  addFlash(color: string, ms: number): void {
    this.flashColor = color;
    this.flashLife = this.dur(ms);
    this.flashMax = this.flashLife;
  }

  showBanner(text: string, sub: string | undefined, color: string): void {
    this.banner = { text, sub, life: 0, maxLife: this.dur(ANIM.banner), color };
  }

  /**
   * 見た目を 1 フレームぶん進める。
   * @param positions 各アクターの論理位置
   */
  update(dt: number, positions: Map<number, Point>): void {
    if (this.holdMs > 0) this.holdMs = Math.max(0, this.holdMs - dt);

    const moveMs = Math.max(1, ANIM.move * this.speedScale);
    for (const [id, target] of positions) {
      const v = this.view(id, target);
      const k = Math.min(1, dt / moveMs);
      // 遠すぎるときは瞬間移動（ワープ・階層移動）
      if (Math.abs(v.x - target.x) > 3 || Math.abs(v.y - target.y) > 3) {
        v.x = target.x;
        v.y = target.y;
      } else {
        v.x += (target.x - v.x) * k;
        v.y += (target.y - v.y) * k;
        if (Math.abs(v.x - target.x) < 0.01) v.x = target.x;
        if (Math.abs(v.y - target.y) < 0.01) v.y = target.y;
      }
      const decay = Math.min(1, dt / Math.max(1, ANIM.damage * this.speedScale));
      v.squash = Math.max(0, v.squash - decay);
      v.flash = Math.max(0, v.flash - decay);
      v.lungeX *= Math.max(0, 1 - dt / Math.max(1, ANIM.attack * this.speedScale));
      v.lungeY *= Math.max(0, 1 - dt / Math.max(1, ANIM.attack * this.speedScale));
      if (v.fade > 0) v.fade = Math.min(1, v.fade + dt / Math.max(1, ANIM.defeat * this.speedScale));
    }

    for (const list of [this.popups, this.projectiles, this.beams, this.bursts]) {
      for (const item of list as Array<{ life: number; maxLife: number }>) item.life += dt;
    }
    this.popups = this.popups.filter((p) => p.life < p.maxLife);
    this.projectiles = this.projectiles.filter((p) => p.life < p.maxLife);
    this.beams = this.beams.filter((b) => b.life < b.maxLife);
    this.bursts = this.bursts.filter((b) => b.life < b.maxLife);

    if (this.banner) {
      this.banner.life += dt;
      if (this.banner.life >= this.banner.maxLife) this.banner = null;
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt / 26);
      const a = Math.random() * Math.PI * 2;
      this.shakeX = Math.cos(a) * this.shake;
      this.shakeY = Math.sin(a) * this.shake;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (this.flashLife > 0) this.flashLife = Math.max(0, this.flashLife - dt);
  }

  /** 表示用: ポップアップの一覧 */
  get activePopups(): readonly Popup[] {
    return this.popups;
  }

  get activeProjectiles(): readonly Projectile[] {
    return this.projectiles;
  }

  get activeBeams(): readonly Beam[] {
    return this.beams;
  }

  get activeBursts(): readonly Burst[] {
    return this.bursts;
  }

  get flashAlpha(): number {
    return this.flashLife > 0 ? this.flashLife / this.flashMax : 0;
  }
}

const DIR_VEC8 = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

const dist = (a: Point, b: Point): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function houseLabel(kind: string): string {
  const table: Record<string, string> = {
    normal: 'モンスターが あふれ出した',
    big: '大部屋いっぱいの モンスター',
    item: 'アイテムだらけだ',
    trap: 'ワナだらけだ',
    ghost: '亡霊たちの 巣',
    gitan: 'ギタンだらけだ',
  };
  return table[kind] ?? '';
}

/** タイル座標 → 画面のピクセル座標 */
export const tileToPx = (t: number): number => t * TILE;
