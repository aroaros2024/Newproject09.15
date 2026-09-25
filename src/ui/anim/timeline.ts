/**
 * 1 手の中の順番（拍）。
 *
 * ロジックは 1 手ぶんのできごとを一度に積む。旧 fx.ts はそれを全部同じフレームで
 * 始めていたので、殴る・殴り返す・倒れるが重なって読めなかった。ここで「拍」に分ける。
 *
 *   - 移動は全員 t = 0（VisualWorld がその場で滑らせる。ここでは扱わない）
 *   - 攻撃・体当たり・飛び道具・ビーム・爆発・ワナ・ワープが来るたびに次の拍
 *     （同じ者の攻撃の出し直し、同じ所からのビームの続き、続けてのワープは同じ拍）
 *   - ダメージ・空振り・回復・撃破・状態異常・レベルアップ・道具・効果音は今の拍に付き、
 *     拍の「当たり」の時刻に出る。攻撃なら当たりのコマ、飛び道具なら着弾、ビームなら終端
 *   - 撃破は当たりの 80ms 後。撃破より後に積まれた「その結果」（レベルアップ・落とし物・効果音・揺れ）も
 *     撃破に揃える。同じ爆発で巻き込まれた別の者のダメージは当たりのまま（撃破を待たない）
 *   - 拍の間：攻撃 170・体当たり 90・ビーム 160・爆発 260・ワナ 150・ワープ 200ms、飛び道具は飛ぶ時間。
 *     撃破があった拍の次は、撃破の後から始める（倒れる前に次の者が動かない）
 *   - 時間はすべてアニメ速度の倍率を掛ける。1 手ぶんは最長 800ms（× 倍率）に比例で縮める
 *   - 敵の攻撃は、当たりの音（hit・hitCritical）が attack より先に積まれる（combat.ts の resolveAttack）。
 *     次に新しい攻撃の拍が始まるなら、その音は次の拍の当たりへ回す
 *
 * 次の手のできごとが来たら、残りは一度に出し切る（flush）。連打しても数字も亡骸も取りこぼさない。
 * 位置は台帳（actors.ts）の「最後に分かっている位置」から取る。ゲームの側はもう消しているかもしれないので。
 *
 * 決めた時刻と中身は Cue に書き、時刻が来たら CueHandler（VisualWorld）に渡す。
 * Cue は使い回し。1 手ぶんの計画でも毎刻みでも、足りなくなった時だけ作る。
 */

import type { GameEvent } from '../../core/types.js';

// ---------------------------------------------------------------------------
// 合図の種類
// ---------------------------------------------------------------------------

/** 合図の種類（const enum は isolatedModules で使えないので数の表） */
export const CUE = {
  /** 攻撃の始まり（振りかぶり）。actor → target、flag = 会心 */
  ATTACK: 1,
  /** 体当たり（壁にぶつかる）。amount = 向き */
  BUMP: 2,
  /** ビームの始まり。actor = 撃った者（-1 もある）、(x,y) → (x2,y2)、str = 色、ms = 走る時間 */
  BEAM: 3,
  /** 飛び道具の始まり。actor = 投げた者、(x,y) → (x2,y2)、str = 絵、str2 = 種類、ms = 飛ぶ時間 */
  THROW: 4,
  /** 爆発。(x,y) = 中心、amount = 半径 */
  EXPLODE: 5,
  /** ワナが動いた。(x,y)、str = ワナの id */
  TRAP: 6,
  /** ワープで消える。actor、(x,y) = 元の位置 */
  WARP_OUT: 7,
  /** ワープで現れる。actor、(x,y) = 着いた位置 */
  WARP_IN: 8,
  /**
   * ダメージ。actor = 受けた者、target = 出どころ、amount = 数字に出す量、
   * effective = HP から実際に減った量（倒し過ぎの分を除く）、str = 種類、flag = 会心、(x2,y2) = 出どころの位置
   */
  DAMAGE: 9,
  /** 空振り。actor = かわした者、target = 攻撃した者 */
  MISS: 10,
  /** 回復。actor、amount */
  HEAL: 11,
  /** 撃破。actor */
  DEFEAT: 12,
  /** レベルアップ。actor */
  LEVEL_UP: 13,
  /** 状態異常。actor、str = 状態、flag = 掛かった（false は解けた） */
  STATUS: 14,
  /** 道具を拾った。amount = uid */
  ITEM_GET: 15,
  /** 道具が落ちた。(x,y)、amount = uid */
  ITEM_DROP: 16,
  /** 効果音。str = 名前 */
  SFX: 17,
  /** 画面のフラッシュ。str = 色、ms */
  FLASH: 18,
  /** 画面の揺れ。amount = 強さ、ms */
  SHAKE: 19,
  /** モンスターハウス。str = 種類 */
  HOUSE: 20,
  /** ボス登場。actor */
  BOSS: 21,
  /** 倒れた。str = 理由 */
  GAME_OVER: 22,
  /** 踏破 */
  CLEAR: 23,
  /** 階移動の明け。amount = 階、str = ダンジョン名（VisualWorld が積む） */
  FLOOR_IN: 24,
} as const;

export type CueKind = typeof CUE[keyof typeof CUE];

/** 合図 1 つ。使い回すので、受け取った側は持っておかないこと */
export class Cue {
  kind: CueKind = CUE.SFX;
  /** 出す時刻（この組が始まってからのミリ秒） */
  time = 0;
  /** 積んだ順（同じ時刻なら先に積んだ方から出す） */
  seq = 0;
  /** 拍の番号（0 は移動の拍） */
  beat = 0;
  actor = -1;
  target = -1;
  x = NaN;
  y = NaN;
  x2 = NaN;
  y2 = NaN;
  amount = 0;
  /** ダメージのうち HP から実際に減った量（HUD の表示用） */
  effective = 0;
  ms = 0;
  flag = false;
  str = '';
  str2 = '';

  clear(): void {
    this.kind = CUE.SFX;
    this.time = 0;
    this.seq = 0;
    this.beat = 0;
    this.actor = -1;
    this.target = -1;
    this.x = NaN;
    this.y = NaN;
    this.x2 = NaN;
    this.y2 = NaN;
    this.amount = 0;
    this.effective = 0;
    this.ms = 0;
    this.flag = false;
    this.str = '';
    this.str2 = '';
  }
}

/** 計画に要る、台帳への問い合わせ */
export interface BeatContext {
  /** 攻撃の当たりまでの時間（等速のミリ秒）。リグの当たりのコマから */
  strikeMs(actorId: number): number;
  /** そのマスに（最後に分かっている位置で）居る者の id。居なければ -1 */
  actorAtTile(x: number, y: number): number;
  /** 最後に分かっている位置を out へ書く。台帳に居なければ false */
  locate(actorId: number, out: { x: number; y: number }): boolean;
  /** この手の前の HP（最後の同期で見た値）。分からなければ -1 */
  hpOf(actorId: number): number;
}

/** 時刻が来た合図を受け取る */
export interface CueHandler {
  fireCue(c: Readonly<Cue>): void;
}

// ---------------------------------------------------------------------------
// 時間（等速のミリ秒）
// ---------------------------------------------------------------------------

export const BEAT_TIMES = {
  /** 拍の間 */
  attackGap: 170,
  bumpGap: 90,
  zapGap: 160,
  explosionGap: 260,
  trapGap: 150,
  warpGap: 200,
  /** 当たりまで（攻撃はリグの当たりのコマから。これは台帳に居ない時の既定） */
  attackImpact: 133,
  bumpImpact: 60,
  explosionImpact: 50,
  trapImpact: 60,
  /** ワープで縮み切るまで（actors.ts の warpOut と同じ） */
  warpImpact: 110,
  /** ビームが走り切るまで：基本 ＋ 1 マスごと、上限あり */
  zapTravelBase: 60,
  zapTravelPerTile: 12,
  zapTravelMax: 140,
  /** 飛び道具の 1 マスあたり・最短・最長 */
  projectilePerTile: 36,
  projectileMin: 90,
  projectileMax: 420,
  /** 撃破は当たりのこれだけ後 */
  defeatDelay: 80,
  /** 1 手ぶんの上限 */
  batchCap: 800,
} as const;

/** 拍の始まりで鳴らす効果音（放つ音）。それ以外は当たりで鳴らす */
const LAUNCH_SFX: ReadonlySet<string> = new Set([
  'throw', 'zap', 'explosion', 'wind', 'warp', 'bump', 'trap', 'splash',
]);

/** 拍の種類 */
const BEAT = {
  BASE: 0, ATTACK: 1, BUMP: 2, BEAM: 3, THROW: 4, EXPLODE: 5, TRAP: 6, WARP: 7,
} as const;
type BeatKind = typeof BEAT[keyof typeof BEAT];

/** 今の拍（計画の間だけ使う。使い回し） */
class BeatState {
  kind: BeatKind = BEAT.BASE;
  /** 出どころの id（攻撃した者・撃った者） */
  src = -1;
  /** 出どころのマスの鍵（ビームの続きを見分ける） */
  srcTile = -1;
  /** 出どころの位置（ビーム・飛び道具の元・爆発の中心） */
  fromX = NaN;
  fromY = NaN;
  start = 0;
  impact = 0;
  gap = 0;
  /** 当たりの結果（ダメージ・空振り・撃破）が付いたか */
  outcome = false;
  defeated = false;
  crit = false;
  index = 0;
  startCue: Cue | null = null;

  reset(): void {
    this.kind = BEAT.BASE;
    this.src = -1;
    this.srcTile = -1;
    this.fromX = NaN;
    this.fromY = NaN;
    this.start = 0;
    this.impact = 0;
    this.gap = 0;
    this.outcome = false;
    this.defeated = false;
    this.crit = false;
    this.index = 0;
    this.startCue = null;
  }
}

const tileKey = (x: number, y: number): number => (y & 0xffff) * 65536 + (x & 0xffff);
const chebyshev = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export class Timeline {
  /** アニメ速度の倍率 */
  speedScale = 1;
  /** 今の組が始まってからの時刻（ミリ秒） */
  now = 0;
  /** 最後に計画した組の長さ（圧縮後、ミリ秒） */
  batchMs = 0;
  /** 最後に計画した組の拍の数（移動の拍を除く） */
  beats = 0;
  /** 最後に計画した組を縮めた倍率（1 = 縮めていない） */
  compression = 1;
  /**
   * 固定刻みの長さ（ミリ秒）。tick() はこれだけ進める。
   * 刻みの長さを毎回引数で渡すと、V8 が小数の箱（HeapNumber）を作ることがあるので持っておく
   */
  tickMs = 1000 / 60;

  /** 待っている合図（[head, count) が有効）。溜まった Cue はここで使い回す */
  private readonly q: Cue[] = [];
  private head = 0;
  private count = 0;
  private seq = 0;
  private readonly b = new BeatState();
  private readonly pt = { x: 0, y: 0 };
  /** 次の攻撃の拍の当たりへ回す効果音（使い回し） */
  private readonly deferred: string[] = [];
  private deferredCount = 0;

  /** まだ出していない合図があるか */
  get busy(): boolean {
    return this.head < this.count;
  }

  /** まだ出していない合図の数 */
  get pending(): number {
    return this.count - this.head;
  }

  /** i 番目（0 ≦ i < pending）のまだ出していない合図。出す順 */
  pendingAt(i: number): Readonly<Cue> {
    return this.q[this.head + i];
  }

  /** 積んだ Cue の総数（使い回しが効いているかの検査用） */
  get capacity(): number {
    return this.q.length;
  }

  /** 出さずに全部捨てる（画面に入り直したとき） */
  clear(): void {
    this.head = 0;
    this.count = 0;
    this.now = 0;
  }

  /** 残りを時刻に関係なく今すぐ全部出し、時計を 0 に戻す */
  flush(h: CueHandler): void {
    while (this.head < this.count) h.fireCue(this.q[this.head++]);
    this.head = 0;
    this.count = 0;
    this.now = 0;
  }

  /** ms 進めて、時刻の来た合図を出す */
  advance(ms: number, h: CueHandler): void {
    this.now += ms;
    this.fireDue(h);
  }

  /** 固定刻み（tickMs）ぶん進めて、時刻の来た合図を出す。毎刻みはこちら */
  tick(h: CueHandler): void {
    this.now += this.tickMs;
    this.fireDue(h);
  }

  private fireDue(h: CueHandler): void {
    while (this.head < this.count && this.q[this.head].time <= this.now) h.fireCue(this.q[this.head++]);
    if (this.head >= this.count) {
      this.head = 0;
      this.count = 0;
    }
  }

  /**
   * まだ出していない合図のうち、actorId の HP から実際に減る量の合計（倒し過ぎの分は除く）。
   * HUD は「hp + pendingDamage − pendingHeal」を出せば、当たった瞬間に HP が減って見える。
   */
  pendingDamage(actorId: number): number {
    let sum = 0;
    for (let i = this.head; i < this.count; i++) {
      const c = this.q[i];
      if (c.kind === CUE.DAMAGE && c.actor === actorId) sum += c.effective;
    }
    return sum;
  }

  /** まだ出していない回復の合計 */
  pendingHeal(actorId: number): number {
    let sum = 0;
    for (let i = this.head; i < this.count; i++) {
      const c = this.q[i];
      if (c.kind === CUE.HEAL && c.actor === actorId) sum += c.amount;
    }
    return sum;
  }

  /** この id に撃破の合図が待っているか */
  pendingDefeat(actorId: number): boolean {
    for (let i = this.head; i < this.count; i++) {
      const c = this.q[i];
      if (c.kind === CUE.DEFEAT && c.actor === actorId) return true;
    }
    return false;
  }

  /** 合図を 1 つ積む（時刻は今の組の始まりから）。中身は呼ぶ側が書く */
  push(kind: CueKind, time: number): Cue {
    let c: Cue;
    if (this.count < this.q.length) {
      c = this.q[this.count];
    } else {
      c = new Cue();
      this.q.push(c);
    }
    this.count++;
    c.clear();
    c.kind = kind;
    c.time = time;
    c.seq = this.seq++;
    c.beat = this.b.index;
    return c;
  }

  // ------------------------------------------------------------ 計画

  /**
   * events[from, to) を拍に分けて合図を積む。前の組の合図は呼ぶ側が先に flush しておくこと。
   * 階の移動（floorChange）を挟む時は、その手前と後ろで別々に呼ぶ（VisualWorld が分ける）。
   * 最後に finish() で縮めて並べる。
   */
  plan(events: readonly GameEvent[], from: number, to: number, ctx: BeatContext): void {
    const s = this.speedScale;
    const T = BEAT_TIMES;
    const b = this.b;
    b.reset();
    this.deferredCount = 0;
    for (let i = from; i < to; i++) {
      const e = events[i];
      switch (e.t) {
        case 'attack': {
          if (b.kind === BEAT.ATTACK && b.src === e.actorId && !b.outcome && b.startCue) {
            // 同じ攻撃の出し直し。combat.ts は当たりの判定の前と後で 2 回 attack を積む
            if (e.critical) {
              b.crit = true;
              b.startCue.flag = true;
            }
            if (e.targetId >= 0) b.startCue.target = e.targetId;
            break;
          }
          this.openBeat(BEAT.ATTACK, e.actorId, -1, ctx.strikeMs(e.actorId) * s, T.attackGap * s);
          const c = this.push(CUE.ATTACK, b.start);
          c.actor = e.actorId;
          c.target = e.targetId;
          c.flag = e.critical;
          b.crit = e.critical;
          b.startCue = c;
          this.locate(ctx, e.actorId, c, false);
          this.takeDeferred();
          break;
        }
        case 'bump': {
          this.openBeat(BEAT.BUMP, e.actorId, -1, T.bumpImpact * s, T.bumpGap * s);
          const c = this.push(CUE.BUMP, b.start);
          c.actor = e.actorId;
          c.amount = e.dir;
          break;
        }
        case 'miss': {
          // 敵の空振りは attack を積まずに miss だけが来る。その時は攻撃の拍を起こす
          if (!(b.kind === BEAT.ATTACK && b.src === e.actorId && !b.outcome)) {
            this.openBeat(BEAT.ATTACK, e.actorId, -1, ctx.strikeMs(e.actorId) * s, T.attackGap * s);
            const a = this.push(CUE.ATTACK, b.start);
            a.actor = e.actorId;
            a.target = e.targetId;
            b.startCue = a;
            this.locate(ctx, e.actorId, a, false);
          }
          const c = this.push(CUE.MISS, this.impactTime());
          c.actor = e.targetId;
          c.target = e.actorId;
          this.locate(ctx, e.targetId, c, false);
          this.locate(ctx, e.actorId, c, true);
          b.outcome = true;
          break;
        }
        case 'damage': {
          const left = this.hpLeft(ctx, e.actorId);
          const c = this.push(CUE.DAMAGE, this.impactTime());
          c.actor = e.actorId;
          c.amount = e.amount;
          c.effective = Math.min(e.amount, left);
          c.str = e.kind ?? 'physical';
          c.flag = b.crit && b.kind === BEAT.ATTACK;
          this.locate(ctx, e.actorId, c, false);
          if (b.kind === BEAT.ATTACK || b.kind === BEAT.BUMP) {
            c.target = b.src;
            this.locate(ctx, b.src, c, true);
          } else if (b.kind !== BEAT.BASE && b.kind !== BEAT.WARP) {
            c.target = b.src;
            c.x2 = b.fromX;
            c.y2 = b.fromY;
          }
          b.outcome = true;
          break;
        }
        case 'heal': {
          const c = this.push(CUE.HEAL, this.impactTime());
          c.actor = e.actorId;
          c.amount = e.amount;
          this.locate(ctx, e.actorId, c, false);
          break;
        }
        case 'defeat': {
          const c = this.push(CUE.DEFEAT, this.impactTime() + T.defeatDelay * s);
          c.actor = e.actorId;
          this.locate(ctx, e.actorId, c, false);
          b.outcome = true;
          b.defeated = true;
          break;
        }
        case 'levelUp': {
          const c = this.push(CUE.LEVEL_UP, this.outcomeTime());
          c.actor = e.actorId;
          this.locate(ctx, e.actorId, c, false);
          break;
        }
        case 'status': {
          const c = this.push(CUE.STATUS, this.impactTime());
          c.actor = e.actorId;
          c.str = e.status;
          c.flag = e.applied;
          this.locate(ctx, e.actorId, c, false);
          break;
        }
        case 'projectile': {
          const d = chebyshev(e.from.x, e.from.y, e.to.x, e.to.y);
          const flight = Math.min(T.projectileMax, Math.max(T.projectileMin, d * T.projectilePerTile)) * s;
          const src = ctx.actorAtTile(e.from.x, e.from.y);
          this.openBeat(BEAT.THROW, src, tileKey(e.from.x, e.from.y), flight, flight);
          b.fromX = e.from.x;
          b.fromY = e.from.y;
          const c = this.push(CUE.THROW, b.start);
          c.actor = src;
          c.x = e.from.x;
          c.y = e.from.y;
          c.x2 = e.to.x;
          c.y2 = e.to.y;
          c.str = e.sprite;
          c.str2 = e.kind;
          c.ms = flight;
          break;
        }
        case 'zap': {
          const key = tileKey(e.from.x, e.from.y);
          if (b.kind === BEAT.BEAM && b.srcTile === key && b.startCue) {
            // 同じ所からの続き（息は 1 マスずつ、反射は折れるたびに積まれる）。終端だけ延ばす
            b.startCue.x2 = e.to.x;
            b.startCue.y2 = e.to.y;
            break;
          }
          const d = chebyshev(e.from.x, e.from.y, e.to.x, e.to.y);
          const travel = Math.min(T.zapTravelMax, T.zapTravelBase + d * T.zapTravelPerTile) * s;
          const src = ctx.actorAtTile(e.from.x, e.from.y);
          this.openBeat(BEAT.BEAM, src, key, travel, T.zapGap * s);
          b.fromX = e.from.x;
          b.fromY = e.from.y;
          const c = this.push(CUE.BEAM, b.start);
          c.actor = src;
          c.x = e.from.x;
          c.y = e.from.y;
          c.x2 = e.to.x;
          c.y2 = e.to.y;
          c.str = e.color;
          c.ms = travel;
          b.startCue = c;
          break;
        }
        case 'explosion': {
          this.openBeat(BEAT.EXPLODE, -1, tileKey(e.pos.x, e.pos.y), T.explosionImpact * s, T.explosionGap * s);
          b.fromX = e.pos.x;
          b.fromY = e.pos.y;
          const c = this.push(CUE.EXPLODE, b.start);
          c.x = e.pos.x;
          c.y = e.pos.y;
          c.amount = e.radius;
          break;
        }
        case 'trap': {
          this.openBeat(BEAT.TRAP, -1, tileKey(e.pos.x, e.pos.y), T.trapImpact * s, T.trapGap * s);
          b.fromX = e.pos.x;
          b.fromY = e.pos.y;
          const c = this.push(CUE.TRAP, b.start);
          c.x = e.pos.x;
          c.y = e.pos.y;
          c.str = e.trapId;
          break;
        }
        case 'warp': {
          // 続けてのワープ（ボスの取り巻きが一斉に消える）は同じ拍で揃えて消す
          if (!(b.kind === BEAT.WARP && !b.outcome)) {
            this.openBeat(BEAT.WARP, e.actorId, -1, T.warpImpact * s, T.warpGap * s);
          }
          const out = this.push(CUE.WARP_OUT, b.start);
          out.actor = e.actorId;
          out.x = e.from.x;
          out.y = e.from.y;
          const inn = this.push(CUE.WARP_IN, b.start + b.impact);
          inn.actor = e.actorId;
          inn.x = e.to.x;
          inn.y = e.to.y;
          break;
        }
        case 'itemGet': {
          const c = this.push(CUE.ITEM_GET, this.outcomeTime());
          c.amount = e.uid;
          break;
        }
        case 'itemDrop': {
          const c = this.push(CUE.ITEM_DROP, this.outcomeTime());
          c.x = e.pos.x;
          c.y = e.pos.y;
          c.amount = e.uid;
          break;
        }
        case 'sfx': {
          const launch = LAUNCH_SFX.has(e.name);
          if (!launch && this.nextOpensAttack(events, i + 1, to)) {
            // 敵の当たりの音。次の攻撃の拍の当たりで鳴らす
            if (this.deferredCount < this.deferred.length) this.deferred[this.deferredCount] = e.name;
            else this.deferred.push(e.name);
            this.deferredCount++;
            break;
          }
          const c = this.push(CUE.SFX, launch ? b.start : this.outcomeTime());
          c.str = e.name;
          break;
        }
        case 'flash': {
          const c = this.push(CUE.FLASH, this.outcomeTime());
          c.str = e.color;
          c.ms = e.ms;
          break;
        }
        case 'shake': {
          const c = this.push(CUE.SHAKE, this.outcomeTime());
          c.amount = e.power;
          c.ms = e.ms;
          break;
        }
        case 'monsterHouse': {
          const c = this.push(CUE.HOUSE, this.outcomeTime());
          c.str = e.kind;
          break;
        }
        case 'bossAppear': {
          const c = this.push(CUE.BOSS, this.outcomeTime());
          c.actor = e.actorId;
          this.locate(ctx, e.actorId, c, false);
          break;
        }
        case 'gameOver': {
          const c = this.push(CUE.GAME_OVER, this.impactTime() + T.defeatDelay * s);
          c.str = e.reason;
          break;
        }
        case 'dungeonClear':
          this.push(CUE.CLEAR, this.outcomeTime());
          break;
        case 'message':
        case 'move':
        case 'bgm':
        case 'pause':
        case 'floorChange':
          // その場で扱う（ログ・音楽・移動の補間・入力の足止め・階の切り替え）。VisualWorld を参照
          break;
        default: {
          const never: never = e;
          void never;
        }
      }
    }
    // 回した音の行き先が無かったら、今の拍の結果に付ける（落とさない）
    this.takeDeferred();
    this.beats = b.index;
  }

  /**
   * 積み終えた組を仕上げる：長すぎれば比例で縮め、時刻の順に並べる。
   * 縮めるときは飛び道具・ビームの長さ（ms）も同じ倍率で縮め、着く時刻と当たりを揃える。
   */
  finish(): void {
    let end = 0;
    for (let i = this.head; i < this.count; i++) if (this.q[i].time > end) end = this.q[i].time;
    const cap = BEAT_TIMES.batchCap * this.speedScale;
    const k = end > cap && end > 0 ? cap / end : 1;
    if (k < 1) {
      for (let i = this.head; i < this.count; i++) {
        const c = this.q[i];
        c.time *= k;
        if (c.kind === CUE.THROW || c.kind === CUE.BEAM) c.ms *= k;
      }
    }
    this.compression = k;
    this.batchMs = end * k;
    // 挿入ソート（ほぼ並んでいる。時刻 → 積んだ順）
    const q = this.q;
    for (let i = this.head + 1; i < this.count; i++) {
      const v = q[i];
      let j = i - 1;
      while (j >= this.head && (q[j].time > v.time || (q[j].time === v.time && q[j].seq > v.seq))) {
        q[j + 1] = q[j];
        j--;
      }
      q[j + 1] = v;
    }
  }

  // ------------------------------------------------------------ 内側

  private openBeat(kind: BeatKind, src: number, srcTile: number, impact: number, gap: number): void {
    const b = this.b;
    const d = BEAT_TIMES.defeatDelay * this.speedScale;
    // 移動の拍の次は t = 0 から。撃破があった拍の次は、撃破の後から
    const next = Math.max(b.start + b.gap, b.defeated ? b.start + b.impact + d : 0);
    b.kind = kind;
    b.src = src;
    b.srcTile = srcTile;
    b.fromX = NaN;
    b.fromY = NaN;
    b.start = next;
    b.impact = impact;
    b.gap = Math.max(gap, impact);
    b.outcome = false;
    b.defeated = false;
    b.crit = false;
    b.index++;
    b.startCue = null;
  }

  /** events[j] から先、ログを飛ばして最初のできごとが「新しい攻撃の拍を起こす attack」か */
  private nextOpensAttack(events: readonly GameEvent[], j: number, to: number): boolean {
    const b = this.b;
    for (; j < to; j++) {
      const n = events[j];
      if (n.t === 'message') continue;
      if (n.t !== 'attack') return false;
      return !(b.kind === BEAT.ATTACK && b.src === n.actorId && !b.outcome && b.startCue !== null);
    }
    return false;
  }

  /** 回しておいた当たりの音を、今の拍の当たりに積む */
  private takeDeferred(): void {
    for (let k = 0; k < this.deferredCount; k++) {
      const c = this.push(CUE.SFX, this.outcomeTime());
      c.str = this.deferred[k];
    }
    this.deferredCount = 0;
  }

  /** 今の拍の当たりの時刻（ダメージ・空振り・回復・状態異常） */
  private impactTime(): number {
    return this.b.start + this.b.impact;
  }

  /**
   * 当たりの「その後」を出す時刻（レベルアップ・落とし物・効果音・揺れ・告知）。
   * 撃破の後に積まれたものは撃破に揃える（倒れる前に経験値が入って見えないように）
   */
  private outcomeTime(): number {
    return this.impactTime() + (this.b.defeated ? BEAT_TIMES.defeatDelay * this.speedScale : 0);
  }

  /**
   * この組でここまでに積んだダメージと回復を差し引いた、id の残り HP。
   * 倒し過ぎのダメージ（HP 10 に 50）をそのまま足し戻すと、HUD が一瞬 50 を出してしまう
   */
  private hpLeft(ctx: BeatContext, id: number): number {
    let hp = ctx.hpOf(id);
    if (hp < 0) return Number.POSITIVE_INFINITY;
    for (let i = this.head; i < this.count; i++) {
      const c = this.q[i];
      if (c.actor !== id) continue;
      if (c.kind === CUE.DAMAGE) hp -= c.effective;
      else if (c.kind === CUE.HEAL) hp += c.amount;
    }
    return hp > 0 ? hp : 0;
  }

  /** 台帳の位置を合図へ写す（second なら x2, y2） */
  private locate(ctx: BeatContext, id: number, c: Cue, second: boolean): void {
    if (id < 0 || !ctx.locate(id, this.pt)) return;
    if (second) {
      c.x2 = this.pt.x;
      c.y2 = this.pt.y;
    } else {
      c.x = this.pt.x;
      c.y = this.pt.y;
    }
  }
}
