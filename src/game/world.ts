/**
 * 冒険中の世界。
 *
 * RunState（セーブに載る素のデータ）に、実行中だけ必要なもの
 * （生きた Rng、演出イベントのキュー、ダンジョン定義）を足したもの。
 * ゲームロジックはすべてこの World を受け取って動く。
 */

import { Rng } from '../core/rng.js';
import { type MaxKey, type MissionKey, addTally, maxTally } from './counters.js';
import type { Dir, Point } from '../core/geom.js';
import { chebyshev, samePoint } from '../core/geom.js';
import type {
  Actor, Charm, DungeonDef, FloorItem, FloorMap, GameEvent, ItemInstance, LogStyle,
  MonsterActor, MonsterDef, PlayerActor, Room, RunState, StatusId,
} from '../core/types.js';
import { getMonster } from '../data/registry.js';
import { at, canEnter, isOpen } from '../dungeon/tilemap.js';

export class World {
  readonly run: RunState;
  readonly dungeon: DungeonDef;
  rng: Rng;
  /** 描画側が消化する演出イベント */
  events: GameEvent[] = [];
  /** 冒険が終わったか（死亡・クリア・脱出） */
  finished: null | { kind: 'death' | 'clear' | 'escape'; reason: string } = null;
  /**
   * アイテムの実体を作る関数。
   * spawn 側から注入する（combat から spawn を直接 import すると循環するため）。
   */
  itemFactory: ((defId: string) => ItemInstance | null) | null = null;
  /** 発動待ちのモンスターハウス。ターンエンジンが拾って処理する */
  pendingMonsterHouse: Room | null = null;
  /** 階段を降りる予約。行動の解決後にターンエンジンが処理する */
  pendingDescend = false;
  /** 発動待ちのワナ。効果の適用はターンエンジンが行う */
  pendingTrap: { actor: Actor; trapId: string } | null = null;
  /**
   * その階に合ったモンスターを指定位置に湧かせる関数。
   * spawn 側から注入する（循環参照を避けるため）。
   */
  monsterFactory: ((pos: Point) => MonsterActor | null) | null = null;
  /** 指定のモンスターを指定位置に出す（ボスの形態変化などで使う） */
  spawnAt: ((defId: string, pos: Point) => MonsterActor | null) | null = null;
  /**
   * モンスターが倒れた瞬間に呼ばれる。フロアから取り除く直前。
   * 爆発とボスの撃破記録をここで済ませる。
   */
  onMonsterDefeated: ((m: MonsterActor) => void) | null = null;
  /** 聖域の巻物が敷かれているマス。敵はここに入れない */
  sanctuaries: Point[] = [];
  /** 身代わりの杖で狙われるようになった敵の id */
  decoyId: number | null = null;
  /**
   * 倉庫の壺に入れられ、帰還時に倉庫へ送られるアイテム。
   * 中断セーブを跨いでも消えないよう、実体は RunState に置いてある。
   */
  /** 落とし穴で先に落ちた仲間。次の階で合流する */
  get pendingRejoin(): MonsterActor[] {
    this.run.pendingRejoin ??= [];
    return this.run.pendingRejoin;
  }

  set pendingRejoin(list: MonsterActor[]) {
    this.run.pendingRejoin = list;
  }

  get pendingWarehouse(): ItemInstance[] {
    // 古い中断セーブから復元した場合に備えて、無ければここで作る
    this.run.pendingWarehouse ??= [];
    return this.run.pendingWarehouse;
  }

  set pendingWarehouse(list: ItemInstance[]) {
    this.run.pendingWarehouse = list;
  }

  constructor(run: RunState, dungeon: DungeonDef) {
    this.run = run;
    this.dungeon = dungeon;
    this.rng = Rng.fromState(run.rng);
  }

  // ------------------------------------------------------------ 参照

  get map(): FloorMap {
    return this.run.map;
  }

  get player(): PlayerActor {
    return this.run.player;
  }

  get depth(): number {
    return this.run.depth;
  }

  /** 最深部にいるか */
  get atBottom(): boolean {
    return this.run.depth >= this.dungeon.depth;
  }

  /** この階に出るボスの一覧（形態変化は配列の順） */
  bossesHere(): { depth: number; monsterId: string }[] {
    return this.dungeon.bosses.filter((b) => b.depth === this.run.depth);
  }

  /**
   * この階のボスをすべて倒したか。
   * ボスの居る階では、倒すまで階段を降りられない。
   */
  bossesCleared(): boolean {
    const here = this.bossesHere();
    if (here.length === 0) return true;
    return here.every((b) => this.run.defeatedBosses.includes(b.monsterId));
  }

  /** プレイヤー・仲間・敵をまとめて返す（行動順とは無関係） */
  allActors(): Actor[] {
    return [this.run.player, ...this.run.allies, ...this.run.monsters];
  }

  /** 生きているアクターだけ */
  livingActors(): Actor[] {
    return this.allActors().filter((a) => a.alive);
  }

  actorAt(p: Point): Actor | null {
    for (const a of this.allActors()) {
      if (a.alive && samePoint(a.pos, p)) return a;
    }
    return null;
  }

  monsterAt(p: Point): MonsterActor | null {
    const a = this.actorAt(p);
    return a && a.kind !== 'player' ? a : null;
  }

  actorById(id: number): Actor | null {
    return this.allActors().find((a) => a.id === id) ?? null;
  }

  /** その場所にある床落ちアイテム（1 マスに 1 つ） */
  floorItemAt(p: Point): FloorItem | null {
    return this.run.floorItems.find((f) => samePoint(f.pos, p)) ?? null;
  }

  removeFloorItem(f: FloorItem): void {
    const i = this.run.floorItems.indexOf(f);
    if (i >= 0) this.run.floorItems.splice(i, 1);
  }

  /** モンスターの静的定義 */
  defOf(m: MonsterActor): MonsterDef {
    return getMonster(m.defId);
  }

  defOfId(id: string): MonsterDef {
    return getMonster(id);
  }

  /** 表示名（ボスは固有名を優先） */
  nameOf(a: Actor): string {
    if (a.kind === 'player') return a.name;
    return a.nameOverride ?? this.defOf(a).name;
  }

  /** 敵対しているか。プレイヤーと仲間は味方同士 */
  isHostile(a: Actor, b: Actor): boolean {
    const sideA = a.kind === 'player' || a.kind === 'ally';
    const sideB = b.kind === 'player' || b.kind === 'ally';
    if (a.kind === 'shopkeeper' || b.kind === 'shopkeeper') {
      // 店主は怒っている時だけプレイヤーに敵対する
      const keeper = a.kind === 'shopkeeper' ? a : (b as MonsterActor);
      const other = a.kind === 'shopkeeper' ? b : a;
      if (other.kind === 'player' || other.kind === 'ally') return keeper.angry;
      return false;
    }
    return sideA !== sideB;
  }

  // ------------------------------------------------------------ 更新

  nextUid(): number {
    return this.run.nextUid++;
  }

  nextActorId(): number {
    return this.run.nextActorId++;
  }

  addMonster(m: MonsterActor): MonsterActor {
    // 生まれたターンには動かない。
    // 「プレイヤーが状況を見て一手打つ前に殴られる」を構造的に禁じる。
    // モンスターがフロアに入る道はここ 1 本しかないので、
    // 湧き口を足す人が印を付け忘れても事故にならない。
    // フロア生成で最初から居る顔ぶれだけ、enterFloor が印を外す。
    m.actedThisTurn = 1;
    if (m.kind === 'ally') this.run.allies.push(m);
    else this.run.monsters.push(m);
    return m;
  }

  removeActor(a: Actor): void {
    if (a.kind === 'player') return;
    const list = a.kind === 'ally' ? this.run.allies : this.run.monsters;
    const i = list.indexOf(a);
    if (i >= 0) list.splice(i, 1);
  }

  dropItem(item: ItemInstance, pos: Point): FloorItem | null {
    const spot = this.findDropSpot(pos);
    if (!spot) return null;
    const f: FloorItem = { item, pos: spot };
    this.run.floorItems.push(f);
    this.emit({ t: 'itemDrop', uid: item.uid, pos: spot });
    return f;
  }

  /**
   * アイテムを置ける場所を探す。
   * 指定位置が埋まっていたら、同心円状に近い空きマスを探す。
   */
  findDropSpot(from: Point, maxRadius = 6): Point | null {
    if (this.canPlaceItem(from)) return from;
    for (let r = 1; r <= maxRadius; r++) {
      const candidates: Point[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = { x: from.x + dx, y: from.y + dy };
          if (this.canPlaceItem(p)) candidates.push(p);
        }
      }
      if (candidates.length > 0) return this.rng.pick(candidates);
    }
    return null;
  }

  /** アイテムを置けるマスか（床で、階段でなく、他のアイテムが無い） */
  canPlaceItem(p: Point): boolean {
    const t = at(this.map, p.x, p.y);
    if (!t || t.kind !== 'floor') return false;
    if (this.floorItemAt(p)) return false;
    return true;
  }

  /** アクターが立てるマスか（他のアクターがいないこと込み） */
  canStand(p: Point, a: Actor): boolean {
    const move = a.kind === 'player' ? this.playerMoveType() : this.defOf(a).moveType;
    if (!canEnter(this.map, p.x, p.y, move)) return false;
    const other = this.actorAt(p);
    return !other || other === a;
  }

  /** プレイヤーの移動タイプ（浮遊・水グモの腕輪で変わる） */
  playerMoveType(): 'ground' | 'fly' | 'water' {
    if (this.hasStatus(this.player, 'levitate')) return 'fly';
    const effect = this.braceletEffectOf(this.player);
    if (effect === 'levitate') return 'fly';
    if (effect === 'waterWalk') return 'water';
    return 'ground';
  }

  /**
   * この冒険で効いている護石。startRun が加護から受け取って置く。
   *
   * 加護の効かないダンジョン（真・もっと不思議）では null のままになるので、
   * 護石の印を読む weaponRune / shieldRune も自動的に 0 を返す。
   */
  charm: Charm | null = null;

  /**
   * 今効いている腕輪の効果 id。
   * bracelets.ts に実体があるが、World からも引けるよう関数を注入する。
   */
  braceletEffectLookup: ((p: PlayerActor) => string | null) | null = null;

  braceletEffectOf(p: PlayerActor): string | null {
    return this.braceletEffectLookup ? this.braceletEffectLookup(p) : null;
  }

  // ------------------------------------------------------------ 状態異常

  hasStatus(a: Actor, id: StatusId): boolean {
    return a.statuses.some((s) => s.id === id && s.turns !== 0);
  }

  getStatus(a: Actor, id: StatusId): { id: StatusId; turns: number; power: number } | undefined {
    return a.statuses.find((s) => s.id === id && s.turns !== 0);
  }

  // ------------------------------------------------------------ 乱数の補助

  /** 条件に合う開けたマスをランダムに 1 つ */
  randomOpenTile(pred?: (p: Point) => boolean): Point | null {
    const candidates: Point[] = [];
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (!isOpen(at(this.map, x, y))) continue;
        const p = { x, y };
        if (pred && !pred(p)) continue;
        candidates.push(p);
      }
    }
    return candidates.length > 0 ? this.rng.pick(candidates) : null;
  }

  /** プレイヤーから離れた、誰もいない床（湧き位置に使う） */
  randomSpawnTile(minDistFromPlayer = 6): Point | null {
    return this.randomOpenTile((p) => {
      const t = at(this.map, p.x, p.y);
      if (!t || t.kind !== 'floor') return false;
      if (this.actorAt(p)) return false;
      if (t.shop) return false;
      if (samePoint(p, this.map.stairs)) return false;
      return chebyshev(p, this.player.pos) >= minDistFromPlayer;
    });
  }

  // ------------------------------------------------------------ 演出

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  log(text: string, style: LogStyle = 'normal'): void {
    this.events.push({ t: 'message', text, style });
  }

  sfx(name: string): void {
    this.events.push({ t: 'sfx', name });
  }

  /**
   * ミッションのために数える。
   *
   * 数える口はここ 1 本だけにする。呼び出し側のあちこちで
   * town の値を直接いじると、必ずどこかで数え漏れるし、
   * 中断セーブを跨いだときに二重計上になる。
   * ここで溜めたぶんは finishRun が村へ一度だけ移す。
   */
  tally(key: MissionKey, n = 1): void {
    this.run.tally ??= {};
    addTally(this.run.tally, key, n);
  }

  /** 到達値を覚える。足さずに最大値だけ残す（レベルなど） */
  tallyMax(key: MaxKey, value: number): void {
    this.run.tally ??= {};
    maxTally(this.run.tally, key, value);
  }

  /** 積まれたイベントを取り出して空にする */
  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------ セーブ

  /** 保存の直前に、実行中の状態を RunState へ書き戻す */
  syncForSave(): RunState {
    this.run.rng = this.rng.serialize();
    return this.run;
  }
}

/** プレイヤーの向きを変えるだけの補助 */
export function faceTo(a: Actor, dir: Dir): void {
  a.dir = dir;
}
