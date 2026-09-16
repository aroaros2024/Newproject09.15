/**
 * モンスターの行動決定。
 *
 * AiKind（有限個）ごとに方針を分け、特技は monsterSkills.ts に任せる。
 * 経路探索は「プレイヤーからの距離場」を 1 ターンに 1 回だけ作り、
 * 各モンスターはその勾配を下るだけにして計算量を抑える。
 */

import type { Dir, Point } from '../core/geom.js';
import {
  DIR_VEC, chebyshev, dirTo, isOnRay, oppositeDir, samePoint, step,
} from '../core/geom.js';
import type { Actor, MonsterActor } from '../core/types.js';
import { canSee } from '../dungeon/fov.js';
import { at, canMoveDiagonally, canEnter, distanceField, roomOf } from '../dungeon/tilemap.js';
import { resolveAttack } from './combat.js';
import { applyConfusion } from './actions.js';
import { useSkill } from './monsterSkills.js';
import { canAttack, canMove, isIncapacitated } from './status.js';
import type { World } from './world.js';

/** 1 ターンぶんの共有データ（距離場のキャッシュ） */
export class AiContext {
  private field: Int32Array | null = null;
  private fieldFor: string = '';

  constructor(private world: World) {}

  /** プレイヤーへ向かう距離場。1 ターンに 1 回だけ作る */
  playerField(moveType: 'ground' | 'water' | 'lava' | 'fly' | 'phase'): Int32Array {
    const key = `${this.world.player.pos.x},${this.world.player.pos.y},${moveType}`;
    if (this.field && this.fieldFor === key) return this.field;
    this.field = distanceField(this.world.map, this.world.player.pos, moveType);
    this.fieldFor = key;
    return this.field;
  }

  invalidate(): void {
    this.field = null;
    this.fieldFor = '';
  }
}

/** そのモンスターがその方向に進めるか */
function canStep(world: World, m: MonsterActor, dir: Dir): boolean {
  const v = DIR_VEC[dir];
  const to = { x: m.pos.x + v.x, y: m.pos.y + v.y };
  const move = world.defOf(m).moveType;
  if (!canEnter(world.map, to.x, to.y, move)) return false;
  if (!canMoveDiagonally(world.map, m.pos, v.x, v.y, move)) return false;
  const other = world.actorAt(to);
  if (other && other !== m) return false;
  // 店の床には敵を入れない（商品を踏み荒らさないため）
  if (m.kind === 'monster' && at(world.map, to.x, to.y)?.shop) return false;
  // 聖域の巻物が敷かれたマスには乗れない
  if (m.kind !== 'ally' && world.sanctuaries.some((p) => samePoint(p, to))) return false;
  return true;
}

function stepTo(world: World, m: MonsterActor, dir: Dir): boolean {
  if (!canStep(world, m, dir)) return false;
  const from = { ...m.pos };
  m.pos = step(m.pos, dir);
  m.dir = dir;
  world.emit({ t: 'move', actorId: m.id, from, to: { ...m.pos } });
  return true;
}

/** 距離場の勾配を下って 1 歩進む。動けたら true */
function stepDownField(world: World, m: MonsterActor, field: Int32Array): boolean {
  const w = world.map.width;
  const here = field[m.pos.y * w + m.pos.x];
  let best: Dir | null = null;
  let bestValue = here < 0 ? Number.MAX_SAFE_INTEGER : here;
  const dirs = world.rng.shuffled([0, 1, 2, 3, 4, 5, 6, 7] as Dir[]);
  for (const d of dirs) {
    if (!canStep(world, m, d)) continue;
    const p = step(m.pos, d);
    const v = field[p.y * w + p.x];
    if (v < 0) continue;
    if (v < bestValue) {
      bestValue = v;
      best = d;
    }
  }
  return best !== null && stepTo(world, m, best);
}

/** 目標から遠ざかる方向へ 1 歩 */
function stepAwayFrom(world: World, m: MonsterActor, target: Point): boolean {
  const away = dirTo(target, m.pos);
  const candidates: Dir[] = away === null
    ? (world.rng.shuffled([0, 1, 2, 3, 4, 5, 6, 7] as Dir[]))
    : [away, ((away + 1) % 8) as Dir, ((away + 7) % 8) as Dir,
      ((away + 2) % 8) as Dir, ((away + 6) % 8) as Dir];
  for (const d of candidates) {
    if (canStep(world, m, d)) {
      const to = step(m.pos, d);
      if (chebyshev(to, target) >= chebyshev(m.pos, target)) return stepTo(world, m, d);
    }
  }
  // どこにも逃げられない
  for (const d of world.rng.shuffled([0, 1, 2, 3, 4, 5, 6, 7] as Dir[])) {
    if (canStep(world, m, d)) return stepTo(world, m, d);
  }
  return false;
}

/** うろつく。同じ方向を優先して往復を減らす */
function wanderStep(world: World, m: MonsterActor): boolean {
  if (world.rng.percent(65) && canStep(world, m, m.dir)) return stepTo(world, m, m.dir);
  const dirs = world.rng.shuffled([0, 1, 2, 3, 4, 5, 6, 7] as Dir[])
    .filter((d) => d !== oppositeDir(m.dir));
  for (const d of dirs) if (canStep(world, m, d)) return stepTo(world, m, d);
  return canStep(world, m, oppositeDir(m.dir))
    ? stepTo(world, m, oppositeDir(m.dir))
    : false;
}

/** 階段へ向かう（盗んだ敵の逃走） */
function stepTowardStairs(world: World, m: MonsterActor): boolean {
  if (samePoint(m.pos, world.map.stairs)) {
    world.log(`${world.nameOf(m)}は 階段を 降りて 消えた。`, 'bad');
    m.alive = false;
    world.removeActor(m);
    return true;
  }
  const field = distanceField(world.map, world.map.stairs, world.defOf(m).moveType);
  return stepDownField(world, m, field);
}

/** そのモンスターにとっての攻撃対象（プレイヤーまたは仲間） */
function findTarget(world: World, m: MonsterActor): Actor | null {
  // 身代わりの杖を当てられた敵がいれば、他の敵はそちらへ向かう
  if (m.kind === 'monster' && world.decoyId !== null && world.decoyId !== m.id) {
    const decoy = world.actorById(world.decoyId);
    if (decoy && decoy.alive) return decoy;
    world.decoyId = null;
  }
  const candidates = m.kind === 'ally'
    ? world.run.monsters.filter((x) => x.alive)
    : [world.player, ...world.run.allies].filter((x) => x.alive);
  if (candidates.length === 0) return null;
  let best: Actor | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = chebyshev(m.pos, c.pos);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** 目標を見つけているか */
function perceives(world: World, m: MonsterActor, target: Actor): boolean {
  if (world.hasStatus(target, 'invisible')) return false;
  const def = world.defOf(m);
  if (chebyshev(m.pos, target.pos) <= 1) return true;
  if (def.keenSense && chebyshev(m.pos, target.pos) <= 8) return true;
  return canSee(world.map, m.pos, target.pos, !!def.keenSense);
}

/**
 * モンスター 1 体の行動。
 * 戻り値は「ターンを消費したか」（常に true に近いが、店主など動かない場合がある）。
 */
export function takeMonsterTurn(world: World, m: MonsterActor, ctx: AiContext): void {
  if (!m.alive) return;

  // 眠り・まひなどで動けない
  if (isIncapacitated(m)) return;

  const def = world.defOf(m);

  // 眠っている敵は、近くに来られると起きる
  if (m.asleep) {
    const dist = chebyshev(m.pos, world.player.pos);
    const wakeChance = dist <= 1 ? 100 : dist <= 3 ? 35 : 8;
    if (world.rng.percent(wakeChance)) {
      m.asleep = false;
    } else {
      return;
    }
  }

  const target = findTarget(world, m);
  if (!target) {
    wanderStep(world, m);
    return;
  }

  const sees = perceives(world, m, target);
  if (sees) m.lastSeen = { ...target.pos };

  // 特技（射程条件はハンドラ側が見る）
  if (sees && useSkill(world, m, target)) return;

  // 盗んだ敵は階段へ逃げる
  if (def.ai === 'thief' && (m.heldItems.length > 0 || m.heldGitan > 0)) {
    if (!stepTowardStairs(world, m)) wanderStep(world, m);
    return;
  }

  switch (def.ai) {
    case 'guard':
      // 店主は怒っている時だけ動く
      if (m.angry) chaseAndAttack(world, m, target, ctx);
      return;

    case 'mimic':
      // 化けている間は動かない。隣に来られたら襲いかかる
      if (chebyshev(m.pos, target.pos) <= 1) {
        if (m.disguise) {
          world.log(`${world.nameOf(m)}だった！`, 'bad');
          m.disguise = null;
        }
        attackIfPossible(world, m, target);
      }
      return;

    case 'ambush':
      // その場を動かない
      if (chebyshev(m.pos, target.pos) <= 1) attackIfPossible(world, m, target);
      return;

    case 'wander':
      if (chebyshev(m.pos, target.pos) <= 1 && world.rng.percent(80)) {
        attackIfPossible(world, m, target);
        return;
      }
      // 上位種は半分の確率で追いかける
      if (def.tier >= 1 && sees && world.rng.percent(50)) {
        chaseAndAttack(world, m, target, ctx);
        return;
      }
      wanderStep(world, m);
      return;

    case 'flee':
      if (sees) stepAwayFrom(world, m, target.pos);
      else wanderStep(world, m);
      return;

    case 'coward':
      if (m.hp < m.maxHp * 0.35 && sees) {
        stepAwayFrom(world, m, target.pos);
        return;
      }
      chaseAndAttack(world, m, target, ctx);
      return;

    case 'ranged': {
      const dist = chebyshev(m.pos, target.pos);
      // 射線の通る距離を保つ
      if (sees && dist >= 2 && dist <= 8 && isOnRay(m.pos, target.pos)) {
        // 撃てなかった（特技が不発）なら間合いを取り直す
        wanderStep(world, m);
        return;
      }
      if (sees && dist <= 1) {
        // 近すぎるので離れる
        if (stepAwayFrom(world, m, target.pos)) return;
        attackIfPossible(world, m, target);
        return;
      }
      chaseAndAttack(world, m, target, ctx);
      return;
    }

    case 'boss':
      bossTurn(world, m, target, ctx);
      return;

    case 'thief':
    case 'chase':
    default:
      if (world.hasStatus(m, 'terrified')) {
        stepAwayFrom(world, m, target.pos);
        return;
      }
      if (sees || m.lastSeen) chaseAndAttack(world, m, target, ctx);
      else wanderStep(world, m);
  }
}

function attackIfPossible(world: World, m: MonsterActor, target: Actor): boolean {
  if (!canAttack(m)) return false;
  const d = dirTo(m.pos, target.pos);
  if (d === null || chebyshev(m.pos, target.pos) > 1) return false;
  const dir = applyConfusion(world, m, d);
  m.dir = dir;
  const actual = world.actorAt(step(m.pos, dir));
  if (actual && world.isHostile(m, actual)) {
    resolveAttack(world, m, actual);
  } else {
    world.log(`${world.nameOf(m)}の こうげき！ 空振りだ。`);
  }
  return true;
}

function chaseAndAttack(world: World, m: MonsterActor, target: Actor, ctx: AiContext): void {
  if (chebyshev(m.pos, target.pos) <= 1) {
    if (attackIfPossible(world, m, target)) return;
  }
  if (!canMove(m)) return;

  // 混乱していたら適当に歩く
  if (world.hasStatus(m, 'confused')) {
    const d = world.rng.int(8) as Dir;
    if (!stepTo(world, m, d)) wanderStep(world, m);
    return;
  }

  const def = world.defOf(m);
  if (target.kind === 'player') {
    const field = ctx.playerField(def.moveType);
    if (stepDownField(world, m, field)) return;
  }
  // 仲間狙いや距離場で進めない場合は素朴に寄る
  const goal = m.lastSeen ?? target.pos;
  const d = dirTo(m.pos, goal);
  if (d !== null && stepTo(world, m, d)) return;
  if (samePoint(m.pos, goal)) m.lastSeen = null;
  wanderStep(world, m);
}

/** ボスの行動。HP が減るほど攻勢に出る */
function bossTurn(world: World, m: MonsterActor, target: Actor, ctx: AiContext): void {
  const ratio = m.hp / m.maxHp;
  const phase = ratio > 0.6 ? 0 : ratio > 0.3 ? 1 : 2;
  if (phase !== m.bossPhase) {
    m.bossPhase = phase;
    if (phase === 1) world.log(`${world.nameOf(m)}は 本気を 出してきた！`, 'bad');
    if (phase === 2) world.log(`${world.nameOf(m)}の 力が 膨れ上がる！`, 'bad');
  }
  // 追い詰められると特技の頻度が上がる
  if (phase >= 1 && world.rng.percent(30 + phase * 20)) {
    if (useSkill(world, m, target)) return;
  }
  chaseAndAttack(world, m, target, ctx);
}

/** 仲間の作戦に応じた行動 */
export function takeAllyTurn(world: World, a: MonsterActor, ctx: AiContext): void {
  if (!a.alive || isIncapacitated(a)) return;
  const player = world.player;

  if (a.tactic === 'stay') return;
  if (a.tactic === 'avoid') {
    // 戦わずについてくる
    if (chebyshev(a.pos, player.pos) > 2) {
      const field = distanceField(world.map, player.pos, world.defOf(a).moveType);
      stepDownField(world, a, field);
    }
    return;
  }

  const enemy = findTarget(world, a);
  if (enemy && chebyshev(a.pos, enemy.pos) <= 1) {
    attackIfPossible(world, a, enemy);
    return;
  }
  if (enemy && a.tactic === 'free') {
    chaseAndAttack(world, a, enemy, ctx);
    return;
  }
  // いっしょにいく: 近くの敵を狙いつつ、プレイヤーから離れすぎない
  if (enemy && chebyshev(a.pos, enemy.pos) <= 6 && chebyshev(a.pos, player.pos) <= 5) {
    chaseAndAttack(world, a, enemy, ctx);
    return;
  }
  if (chebyshev(a.pos, player.pos) > 1) {
    const field = distanceField(world.map, player.pos, world.defOf(a).moveType);
    if (stepDownField(world, a, field)) return;
  }
  // プレイヤーのそばで待機
  if (roomOf(world.map, a.pos)) wanderStep(world, a);
}
