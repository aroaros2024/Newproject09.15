/**
 * ターンエンジン。
 *
 * 1 ターンの流れ:
 *   プレイヤーの行動 → 床の効果 → 仲間の行動 → 敵の行動
 *   → 状態異常 → 満腹度 → HP 自然回復 → 自然湧き → 風 → 視界の再計算
 *
 * 速度は「1 ターンを 2 ラウンドに分ける」方式で表現する。
 *   通常  : ラウンド 0 だけ行動
 *   倍速  : ラウンド 0 と 1 の両方で行動
 *   鈍足  : 偶数ターンのラウンド 0 だけ行動
 *
 * ロジックはアニメーションを待たない。演出は World.events に積むだけで、
 * 描画側が自分のペースで消化する。
 */

import { chebyshev, samePoint } from '../core/geom.js';
import type { Action, ActionResult, Actor, MonsterActor, SpeedType } from '../core/types.js';
import { naturalSpawn, triggerMonsterHouse } from '../dungeon/spawn.js';
import { onEnterTile, performPlayerAction } from './actions.js';
import { explodeOnDeath } from './monsterSkills.js';
import { AiContext, takeAllyTurn, takeMonsterTurn } from './monsterAI.js';
import { detectAdjacentTraps } from './actions.js';
import { tickHunger, tickRegen } from './hunger.js';
import { applyTrapEffect } from './trapEffects.js';
import { descend, refreshFov } from './run.js';
import { tickStatuses } from './status.js';
import { handlePlayerDeath } from './death.js';
import { WIND_GRACE_TURNS } from './rules.js';
import type { World } from './world.js';

/** そのアクターがこのラウンドで行動するか */
function actsThisRound(world: World, a: Actor, round: number): boolean {
  const speed: SpeedType = a.kind === 'player'
    ? (world.hasStatus(a, 'quick') ? 'double' : world.hasStatus(a, 'slow') ? 'slow' : 'normal')
    : effectiveSpeed(world, a);

  switch (speed) {
    case 'double':
      return round === 0 || round === 1;
    case 'doubleAttack':
      return round === 0;
    case 'slow':
      return round === 0 && world.run.totalTurn % 2 === 0;
    case 'normal':
    default:
      return round === 0;
  }
}

/** 状態異常込みのモンスターの速度 */
function effectiveSpeed(world: World, m: MonsterActor): SpeedType {
  const base = world.defOf(m).speed;
  const quick = world.hasStatus(m, 'quick');
  const slow = world.hasStatus(m, 'slow');
  if (quick && slow) return base;
  if (quick) return base === 'slow' ? 'normal' : 'double';
  if (slow) return base === 'double' ? 'normal' : 'slow';
  return base;
}

/** プレイヤーが何ラウンド行動できるか */
export function playerRounds(world: World): number {
  return world.hasStatus(world.player, 'quick') ? 2 : 1;
}

/**
 * プレイヤーの行動を 1 つ処理して、1 ターンを進める。
 *
 * 戻り値が tookTurn: false のときはターンが進んでいない
 * （メニューを閉じた、壁にぶつかった等）。
 */
export function stepTurn(world: World, action: Action): ActionResult {
  if (world.finished) return { tookTurn: false, reason: '冒険は終わっている' };

  const result = performPlayerAction(world, action);
  if (!result.tookTurn) {
    refreshFov(world);
    return result;
  }

  resolvePendingEffects(world);
  if (world.finished) return result;

  // プレイヤーが乗ったマスの効果
  if (onEnterTile(world, world.player)) {
    if (handlePlayerDeath(world, 'ちからつきた')) return result;
  }
  resolvePendingEffects(world);
  if (world.finished) return result;

  detectAdjacentTraps(world, world.player);
  checkMonsterHouse(world);

  // 倍速のときは 2 ラウンド目にもう一度入力を受け付ける必要があるが、
  // 本作では簡潔さのため「1 回の入力で 2 回行動する」扱いにはしない。
  runOthers(world);
  endOfTurn(world);
  return result;
}

/** 敵と仲間の行動 */
function runOthers(world: World): void {
  const ctx = new AiContext(world);
  for (let round = 0; round < 2; round++) {
    ctx.invalidate();
    for (const ally of [...world.run.allies]) {
      if (!ally.alive) continue;
      if (!actsThisRound(world, ally, round)) continue;
      takeAllyTurn(world, ally, ctx);
    }
    for (const m of [...world.run.monsters]) {
      if (!m.alive) continue;
      if (!actsThisRound(world, m, round)) continue;
      takeMonsterTurn(world, m, ctx);
      resolvePendingEffects(world);
      if (world.player.hp <= 0) {
        if (handlePlayerDeath(world, causeOfDeath(world, m))) return;
      }
      if (world.finished) return;
    }
    cleanupDead(world);
  }
}

function causeOfDeath(world: World, m: MonsterActor): string {
  return `${world.nameOf(m)}に やられた`;
}

/**
 * ボスを倒したときの処理。
 * その階にまだ次の形態が控えていれば、同じ場所に現れる。
 */
function handleBossDefeated(world: World, m: MonsterActor): void {
  if (!world.run.defeatedBosses.includes(m.defId)) {
    world.run.defeatedBosses.push(m.defId);
  }
  const here = world.bossesHere();
  const idx = here.findIndex((b) => b.monsterId === m.defId);
  const next = idx >= 0 ? here[idx + 1] : undefined;
  if (!next) {
    if (here.length > 0) {
      world.log('あたりの 気配が 静まった。階段が 開いている。', 'good');
      world.sfx('fanfare');
    }
    return;
  }
  const spot = world.findDropSpot(m.pos, 4) ?? m.pos;
  const boss = world.spawnAt?.(next.monsterId, spot);
  if (!boss) return;
  world.log('しかし 相手は まだ 倒れていなかった！', 'bad');
  world.emit({ t: 'bossAppear', actorId: boss.id });
  world.sfx('bossAppear');
}

/** 死んだ敵の後始末（爆発する敵はここで爆発し、ボスは次の形態へ移る） */
function cleanupDead(world: World): void {
  for (const m of [...world.run.monsters]) {
    if (m.alive) continue;
    if (world.defOf(m).skills.includes('explodeOnDeath')) explodeOnDeath(world, m);
    if (world.defOf(m).isBoss) handleBossDefeated(world, m);
    world.removeActor(m);
  }
  for (const a of [...world.run.allies]) {
    if (!a.alive) world.removeActor(a);
  }
}

/** 行動中に積まれた「あとで処理するもの」を解決する */
function resolvePendingEffects(world: World): void {
  let guard = 0;
  while (guard++ < 8) {
    if (world.pendingTrap) {
      const { actor, trapId } = world.pendingTrap;
      world.pendingTrap = null;
      applyTrapEffect(world, actor, trapId);
      continue;
    }
    if (world.pendingMonsterHouse) {
      const room = world.pendingMonsterHouse;
      world.pendingMonsterHouse = null;
      triggerMonsterHouse(world, room);
      continue;
    }
    if (world.pendingDescend) {
      world.pendingDescend = false;
      descend(world);
      continue;
    }
    break;
  }
  cleanupDead(world);
}

/** プレイヤーがモンスターハウスの部屋に入ったか */
function checkMonsterHouse(world: World): void {
  const tile = world.map.tiles[world.player.pos.y * world.map.width + world.player.pos.x];
  if (!tile || tile.roomId < 0) return;
  const room = world.map.rooms.find((r) => r.id === tile.roomId);
  if (!room || !room.monsterHouse || room.houseTriggered) return;
  triggerMonsterHouse(world, room);
}

/** ターンの終わりの処理 */
function endOfTurn(world: World): void {
  world.run.floorTurn++;
  world.run.totalTurn++;

  // 状態異常
  for (const a of [...world.livingActors()]) {
    if (tickStatuses(world, a)) {
      if (a.kind === 'player') {
        if (handlePlayerDeath(world, '状態異常に 力尽きた')) return;
      } else {
        a.alive = false;
      }
    }
  }
  cleanupDead(world);
  if (world.finished) return;

  // 満腹度
  if (tickHunger(world, world.player)) {
    if (handlePlayerDeath(world, 'ちからつきた')) return;
  }

  // HP 自然回復
  for (const a of world.livingActors()) tickRegen(world, a);

  // 自然湧き
  naturalSpawn(world);

  // 不定の風
  tickWind(world);

  refreshFov(world);
  updateShopAnger(world);
}

/** 不定の風。一定ターンを過ぎると次の階へ飛ばされる */
function tickWind(world: World): void {
  if (world.dungeon.windTurns <= 0) return;
  if (world.run.windLeft <= 0) return;
  world.run.windLeft--;
  if (world.run.windLeft === WIND_GRACE_TURNS) {
    world.log('不気味な 風が 吹き始めた……', 'warning');
    world.sfx('wind');
  }
  if (world.run.windLeft <= 0) {
    world.log('不定の風に 飛ばされた！', 'bad');
    world.sfx('wind');
    if (world.atBottom) {
      // 最下層で吹かれるとクリアにはならず、村へ戻される
      world.finished = { kind: 'escape', reason: '風に 飛ばされて 村へ 戻った' };
      return;
    }
    descend(world);
  }
}

/** 店の商品を持ったまま出ようとしていないか */
function updateShopAnger(world: World): void {
  const p = world.player;
  const room = world.map.rooms.find((r) => r.shop && !r.shop.angry);
  if (!room || !room.shop) return;
  const carrying = p.inventory.some((i) => i.shopPrice > 0);
  if (!carrying) return;
  const tile = world.map.tiles[p.pos.y * world.map.width + p.pos.x];
  if (tile?.shop) return; // まだ店の中
  // 店を出た
  room.shop.angry = true;
  const keeper = world.run.monsters.find((m) => m.id === room.shop!.ownerId);
  if (keeper) keeper.angry = true;
  const debt = p.inventory
    .filter((i) => i.shopPrice > 0)
    .reduce((sum, i) => sum + i.shopPrice, 0);
  world.log(`「どろぼう〜！ ${debt}ギタン 払え〜！」`, 'bad');
  world.sfx('steal');
  world.emit({ t: 'bgm', track: 'monsterHouse' });

  // 番犬を呼ぶ
  const factory = world.monsterFactory;
  if (factory) {
    for (let i = 0; i < 4; i++) {
      const spot = world.randomSpawnTile(4);
      if (spot) factory(spot);
    }
  }
}

/** 足踏みで一定ターン休む（HP 回復のための「休憩」） */
export function restTurns(world: World, maxTurns: number): number {
  let n = 0;
  for (; n < maxTurns; n++) {
    if (world.finished) break;
    const before = world.player.hp;
    stepTurn(world, { type: 'wait' });
    if (world.player.hp >= world.player.maxHp) break;
    if (world.player.hp < before) break; // 攻撃されたら止める
    if (world.player.foodX10 <= 0) break;
    // 見える敵が現れたら止める
    if (visibleEnemyNear(world)) break;
  }
  return n;
}

function visibleEnemyNear(world: World): boolean {
  for (const m of world.run.monsters) {
    if (!m.alive || m.asleep) continue;
    const t = world.map.tiles[m.pos.y * world.map.width + m.pos.x];
    if (t?.visible && chebyshev(m.pos, world.player.pos) <= 6) return true;
  }
  return false;
}

/** 階段の上にいるか */
export const onStairs = (world: World): boolean =>
  samePoint(world.player.pos, world.map.stairs);
