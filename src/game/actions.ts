/**
 * 行動の解決。「1 つの行動がターンを消費したか」を返すのがこのモジュールの責務。
 *
 * ターンの進行そのもの（誰がいつ動くか）は turn.ts が持つ。
 */

import type { Dir, Point } from '../core/geom.js';
import { DIR_VEC, chebyshev, samePoint, step } from '../core/geom.js';
import type { Action, ActionResult, Actor, PlayerActor } from '../core/types.js';
import { getItem, getTrap } from '../data/registry.js';
import { at, canMoveDiagonally, canEnter, isOpen } from '../dungeon/tilemap.js';
import { attackInDirection, dealDamage } from './combat.js';
import {
  addToInventory, equippedBracelet, equippedShield, equippedWeapon,
  findItem, isEquipped, isInventoryFull, removeFromInventory,
} from './inventory.js';
import { itemName, shortItemName } from './naming.js';
import { CONFUSE_MISDIRECT_RATE } from './rules.js';
import { canAttack, canMove, isIncapacitated, STATUS_NAME } from './status.js';
import type { World } from './world.js';

const OK: ActionResult = { tookTurn: true };
const NOPE = (reason: string): ActionResult => ({ tookTurn: false, reason });

/** 混乱していると方向が狂う */
export function applyConfusion(world: World, a: Actor, dir: Dir): Dir {
  if (!world.hasStatus(a, 'confused')) return dir;
  if (!world.rng.chance(CONFUSE_MISDIRECT_RATE)) return dir;
  return world.rng.int(8) as Dir;
}

/**
 * そのアクターがその方向へ動けるか。
 * 壁・斜めのすり抜け・他のアクターをすべて見る。
 */
export function canStepTo(world: World, a: Actor, dir: Dir): boolean {
  const v = DIR_VEC[dir];
  const to = { x: a.pos.x + v.x, y: a.pos.y + v.y };
  const move = a.kind === 'player' ? world.playerMoveType() : world.defOf(a).moveType;
  if (!canEnter(world.map, to.x, to.y, move)) return false;
  if (!canMoveDiagonally(world.map, a.pos, v.x, v.y, move)) return false;
  const other = world.actorAt(to);
  if (other && other !== a) return false;
  return true;
}

/** 移動。踏んだマスの効果（ワナ・アイテム・店）はここでは処理しない */
export function moveActor(world: World, a: Actor, dir: Dir): boolean {
  if (!canStepTo(world, a, dir)) return false;
  const from = { ...a.pos };
  const to = step(a.pos, dir);
  a.pos = to;
  a.dir = dir;
  world.emit({ t: 'move', actorId: a.id, from, to });
  return true;
}

/** プレイヤーの 1 行動を解決する */
export function performPlayerAction(world: World, action: Action): ActionResult {
  const p = world.player;

  if (isIncapacitated(p)) {
    const s = p.statuses.find((x) => x.turns !== 0 && ['asleep', 'deepAsleep', 'paralyzed', 'fainted'].includes(x.id));
    world.log(`${p.name}は ${s ? STATUS_NAME[s.id] : '動けない'}で 動けない！`, 'bad');
    return OK;
  }

  switch (action.type) {
    case 'move': return playerMove(world, action.dir);
    case 'attack': return playerAttack(world, action.dir);
    case 'turn':
      p.dir = action.dir;
      return NOPE('向きを変えた');
    case 'wait':
      world.log(`${p.name}は その場で 休んだ。`);
      return OK;
    case 'pickup': return playerPickup(world);
    case 'place': return playerPlace(world, action.uid);
    case 'stairs': return playerStairs(world);
    default:
      return NOPE('未対応の行動');
  }
}

function playerMove(world: World, rawDir: Dir): ActionResult {
  const p = world.player;
  if (!canMove(p)) {
    if (world.hasStatus(p, 'trapped')) {
      world.log('トラばさみに 挟まれて 動けない！', 'bad');
    } else {
      world.log('体が しびれて 動けない！', 'bad');
    }
    return OK;
  }
  const dir = applyConfusion(world, p, rawDir);
  p.dir = dir;

  // 移動先に敵がいれば、移動ではなく攻撃になる
  const target = world.actorAt(step(p.pos, dir));
  if (target && world.isHostile(p, target)) return playerAttack(world, dir);

  // 仲間とは位置を入れ替える
  if (target && target.kind === 'ally') {
    const tmp = { ...p.pos };
    p.pos = { ...target.pos };
    target.pos = tmp;
    world.emit({ t: 'move', actorId: p.id, from: target.pos, to: p.pos });
    p.steps++;
    return OK;
  }

  if (!moveActor(world, p, dir)) {
    world.emit({ t: 'bump', actorId: p.id, dir });
    world.sfx('bump');
    return NOPE('そちらへは 進めない');
  }
  p.steps++;
  world.sfx(at(world.map, p.pos.x, p.pos.y)?.kind === 'water' ? 'stepWater' : 'step');
  return OK;
}

function playerAttack(world: World, rawDir: Dir): ActionResult {
  const p = world.player;
  if (!canAttack(p)) {
    world.log('体が しびれて 攻撃できない！', 'bad');
    return OK;
  }
  const dir = applyConfusion(world, p, rawDir);
  attackInDirection(world, p, dir);

  // 連撃の印
  const weapon = equippedWeapon(p);
  if (weapon && !weapon.sealed) {
    const combo = weapon.runes.filter((r) => r === 'combo').length;
    if (combo > 0 && world.rng.percent(combo * 25)) {
      world.log('続けざまに 斬りつけた！', 'good');
      attackInDirection(world, p, dir);
    }
  }
  return OK;
}

function playerPickup(world: World): ActionResult {
  const p = world.player;
  const f = world.floorItemAt(p.pos);
  if (!f) return NOPE('足元には 何も無い');

  const def = getItem(f.item.defId);
  if (def.kind === 'gitan') {
    p.gitan += f.item.count;
    world.run.stats.gitanEarned += f.item.count;
    world.log(`${f.item.count}ギタンを 拾った。`, 'item');
    world.sfx('gitan');
    world.removeFloorItem(f);
    return OK;
  }

  // 店の商品は買うまで持ち出せないが、手に取ることはできる
  if (isInventoryFull(p)) {
    world.log('持ち物が いっぱいだ。', 'warning');
    return NOPE('持ち物がいっぱい');
  }
  if (!addToInventory(p, f.item)) return NOPE('持ち物がいっぱい');
  world.removeFloorItem(f);
  world.run.stats.itemsFound++;
  world.log(`${itemName(f.item, world.run.identify)}を 拾った。`, 'item');
  world.emit({ t: 'itemGet', uid: f.item.uid });
  world.sfx('pickup');
  return OK;
}

function playerPlace(world: World, uid: number): ActionResult {
  const p = world.player;
  const item = findItem(p, uid);
  if (!item) return NOPE('その道具は 持っていない');
  if (isEquipped(p, uid) && item.cursed) {
    world.log('呪われていて 手から 離れない！', 'bad');
    return OK;
  }
  if (world.floorItemAt(p.pos)) return NOPE('足元に 物が 置いてある');
  if (at(world.map, p.pos.x, p.pos.y)?.kind !== 'floor') return NOPE('ここには 置けない');

  removeFromInventory(p, uid);
  world.dropItem(item, p.pos);
  world.log(`${itemName(item, world.run.identify)}を 置いた。`, 'item');
  world.sfx('drop');
  return OK;
}

function playerStairs(world: World): ActionResult {
  const p = world.player;
  if (!samePoint(p.pos, world.map.stairs)) return NOPE('ここに 階段は 無い');
  world.sfx('stairs');
  world.pendingDescend = true;
  return OK;
}

// ---------------------------------------------------------------------------
// 踏んだマスの効果
// ---------------------------------------------------------------------------

/**
 * アクターがマスに乗った時の処理（ワナ・水・溶岩）。
 * 戻り値は「そのアクターが死んだか」。
 */
export function onEnterTile(world: World, a: Actor): boolean {
  const tile = at(world.map, a.pos.x, a.pos.y);
  if (!tile) return false;

  // 浮遊していれば床の影響を受けない
  const floating = world.hasStatus(a, 'levitate')
    || (a.kind !== 'player' && (world.defOf(a).moveType === 'fly'));

  if (tile.kind === 'lava' && !floating) {
    const dmg = Math.max(5, Math.floor(a.maxHp * 0.1));
    world.log(`${world.nameOf(a)}は 溶岩に 焼かれた！`, 'bad');
    if (dealDamage(world, null, a, dmg, 'fire')) return true;
  }

  if (tile.trap && !tile.trap.used && !floating) {
    return triggerTrap(world, a, tile.trap.defId);
  }

  // 足元のアイテムを知らせる
  if (a.kind === 'player') {
    const f = world.floorItemAt(a.pos);
    if (f) {
      const name = itemName(f.item, world.run.identify);
      world.log(
        f.item.shopPrice > 0
          ? `${name}［${f.item.shopPrice}ギタン］が 置いてある。`
          : `${name}が 落ちている。`,
        'item',
      );
    }
    if (samePoint(a.pos, world.map.stairs)) {
      world.log('階段がある。', 'system');
    }
  }
  return false;
}

/** ワナを発動させる。実処理は trapEffects.ts が持つ */
export function triggerTrap(world: World, a: Actor, trapId: string): boolean {
  const def = getTrap(trapId);
  const tile = at(world.map, a.pos.x, a.pos.y);
  if (!tile || !tile.trap) return false;

  // ワナ師の印・腕輪はワナを踏んでも作動しない
  if (a.kind === 'player') {
    const shield = equippedShield(world.player);
    const bracelet = equippedBracelet(world.player);
    const braceletDef = bracelet ? getItem(bracelet.defId) : null;
    const wardBracelet = braceletDef?.kind === 'bracelet'
      && braceletDef.effect === 'trapMaster' && !bracelet!.cursed;
    const wardRune = shield && !shield.sealed && shield.runes.includes('antiTrap');
    if (wardBracelet || wardRune) {
      tile.trap.revealed = true;
      world.log(`${def.name}を 踏んだが 作動しなかった。`, 'good');
      return false;
    }
  } else if (!def.affectsMonsters) {
    return false;
  }

  // 発見済みのワナは確率で回避できる
  if (tile.trap.revealed && !world.rng.percent(def.rate)) {
    if (a.kind === 'player') world.log(`${def.name}を うまく かわした。`, 'good');
    return false;
  }

  tile.trap.revealed = true;
  if (def.oneShot) tile.trap.used = true;
  world.log(`${def.name}だ！`, 'bad');
  world.emit({ t: 'trap', pos: { ...a.pos }, trapId });
  world.sfx('trap');
  world.pendingTrap = { actor: a, trapId };
  return false;
}

/** 隣接したワナを見つける */
export function detectAdjacentTraps(world: World, p: PlayerActor): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tile = at(world.map, p.pos.x + dx, p.pos.y + dy);
      if (tile?.trap && !tile.trap.revealed && world.rng.chance(0.5)) {
        tile.trap.revealed = true;
      }
    }
  }
}

/** ダッシュを止めるべき状況か */
export function shouldStopDash(world: World, p: PlayerActor, prevRoomId: number): boolean {
  const tile = at(world.map, p.pos.x, p.pos.y);
  if (!tile) return true;
  if (world.floorItemAt(p.pos)) return true;
  if (samePoint(p.pos, world.map.stairs)) return true;
  if (tile.trap?.revealed) return true;
  if (tile.roomId !== prevRoomId) return true;
  if (tile.isDoor) return true;
  // 見えている敵がいたら止まる
  for (const m of world.run.monsters) {
    if (!m.alive) continue;
    const mt = at(world.map, m.pos.x, m.pos.y);
    if (mt?.visible && chebyshev(m.pos, p.pos) <= 4) return true;
  }
  // 通路で分岐に来たら止まる
  if (tile.roomId < 0) {
    let open = 0;
    for (const v of DIR_VEC) {
      if (isOpen(at(world.map, p.pos.x + v.x, p.pos.y + v.y))) open++;
    }
    if (open > 2) return true;
  }
  return false;
}

/** 名前を短く出したい時のための再エクスポート */
export { shortItemName };

/** 投げたアイテムが飛ぶ経路を返す（壁か敵に当たるまで） */
export function throwPath(
  world: World, from: Point, dir: Dir, range: number,
): { path: Point[]; hit: Actor | null } {
  const path: Point[] = [];
  let hit: Actor | null = null;
  let cur = { ...from };
  for (let i = 0; i < range; i++) {
    const next = step(cur, dir);
    if (!isOpen(at(world.map, next.x, next.y))) break;
    path.push(next);
    cur = next;
    const a = world.actorAt(next);
    if (a && a.alive) {
      hit = a;
      break;
    }
  }
  return { path, hit };
}
