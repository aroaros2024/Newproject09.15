/**
 * 状態異常の付与・解除・毎ターン処理。
 */

import type { Actor, StatusEffect, StatusId } from '../core/types.js';
import { INCAPACITATING } from '../core/types.js';
import { STATUS_DURATION, DEADLY_POISON_DAMAGE, BURN_DAMAGE, TRAPPED_ESCAPE_RATE } from './rules.js';
import type { World } from './world.js';
import { equipRuneLevel } from './runes.js';
import { equippedBracelet, equippedShield } from './inventory.js';
import { getItem } from '../data/registry.js';
import { at } from '../dungeon/tilemap.js';

/** 状態異常の日本語名 */
export const STATUS_NAME: Record<StatusId, string> = {
  confused: '混乱', blind: 'めつぶし', asleep: '睡眠', deepAsleep: 'バクスイ',
  bound: 'かなしばり', paralyzed: 'まひ', fainted: '気絶', poisoned: '毒',
  deadlyPoisoned: '猛毒', burning: '火傷', wet: '濡れ', slow: '鈍足', quick: '倍速',
  invisible: '透明', sealed: '封印', hungryFast: '消化不良', strUp: 'ちから増加',
  trapped: 'トラばさみ', levitate: '浮遊', terrified: 'おびえ', invincible: '無敵',
};

/** 付与されると相殺される組み合わせ */
const CANCELS: Partial<Record<StatusId, StatusId[]>> = {
  quick: ['slow'],
  slow: ['quick'],
  burning: ['wet'],
  wet: ['burning'],
};

/** 腕輪や印で防げる状態異常 */
function isWarded(world: World, a: Actor, id: StatusId): boolean {
  if (a.kind !== 'player') return false;
  const p = world.player;
  if (!world.hasStatus(a, 'sealed')) {
    const bracelet = equippedBracelet(p);
    if (bracelet && !bracelet.cursed) {
      const def = getItem(bracelet.defId);
      const effect = def.kind === 'bracelet' ? def.effect : '';
      if (effect === 'wardConfuse' && id === 'confused') return true;
      if (effect === 'wardSleep' && (id === 'asleep' || id === 'deepAsleep')) return true;
      if (effect === 'wardPoison' && (id === 'poisoned' || id === 'deadlyPoisoned')) return true;
    }
  }
  const shield = equippedShield(p);
  if (equipRuneLevel(shield, 'guardStr') > 0 && (id === 'poisoned' || id === 'deadlyPoisoned')) {
    return true;
  }
  return false;
}

/** 状態異常の持続ターンを決める */
export function rollDuration(world: World, id: StatusId): number {
  const range = STATUS_DURATION[id];
  if (!range) return 10;
  return world.rng.range(range[0], range[1]);
}

/**
 * 状態異常を付ける。
 * 同じ状態が既にあれば「持続の長い方」を採用する（上書きで短くならない）。
 */
export function applyStatus(
  world: World, a: Actor, id: StatusId, turns?: number, power = 0,
): boolean {
  if (!a.alive) return false;
  if (isWarded(world, a, id)) {
    if (a.kind === 'player') world.log(`しかし ${STATUS_NAME[id]}は 防がれた！`, 'good');
    return false;
  }

  // 聖なる印で持続を短くする
  let t = turns ?? rollDuration(world, id);
  if (a.kind === 'player' && isAilment(id)) {
    const holy = equipRuneLevel(equippedShield(world.player), 'holy');
    if (holy > 0) t = Math.max(1, Math.floor(t * (1 - holy * 0.25)));
  }

  for (const other of CANCELS[id] ?? []) removeStatus(world, a, other, true);

  const existing = a.statuses.find((s) => s.id === id);
  if (existing) {
    existing.turns = Math.max(existing.turns, t);
    existing.power = Math.max(existing.power, power);
  } else {
    a.statuses.push({ id, turns: t, power });
  }

  // 眠っている相手に別の状態を掛けても起きない
  world.emit({ t: 'status', actorId: a.id, status: id, applied: true });
  return true;
}

/** 悪い状態異常か（良い効果には聖なる印を掛けない） */
export function isAilment(id: StatusId): boolean {
  return !(id === 'quick' || id === 'invisible' || id === 'levitate'
    || id === 'strUp' || id === 'invincible');
}

export function removeStatus(world: World, a: Actor, id: StatusId, silent = false): boolean {
  const i = a.statuses.findIndex((s) => s.id === id);
  if (i < 0) return false;
  a.statuses.splice(i, 1);
  if (!silent) world.emit({ t: 'status', actorId: a.id, status: id, applied: false });
  return true;
}

/** 悪い状態異常をすべて解除する */
export function cureAilments(world: World, a: Actor): number {
  let n = 0;
  for (const s of [...a.statuses]) {
    if (isAilment(s.id)) {
      removeStatus(world, a, s.id, true);
      n++;
    }
  }
  return n;
}

/** 完全に行動できない状態か */
export function isIncapacitated(a: Actor): boolean {
  return a.statuses.some((s) => INCAPACITATING.includes(s.id) && s.turns !== 0);
}

/** 移動できるか（かなしばり・トラばさみ） */
export function canMove(a: Actor): boolean {
  if (isIncapacitated(a)) return false;
  return !a.statuses.some((s) => (s.id === 'bound' || s.id === 'trapped') && s.turns !== 0);
}

/** 通常攻撃できるか（かなしばりは攻撃も不可、トラばさみは攻撃できる） */
export function canAttack(a: Actor): boolean {
  if (isIncapacitated(a)) return false;
  return !a.statuses.some((s) => s.id === 'bound' && s.turns !== 0);
}

/** ダメージを受けた時に解除される状態 */
export function wakeOnDamage(world: World, a: Actor): void {
  // 睡眠は起きるが、バクスイ・まひ・気絶は解けない
  removeStatus(world, a, 'asleep');
  if (a.kind !== 'player') a.asleep = false;
}

/**
 * 毎ターンの状態異常処理。
 * 継続ダメージ → 残りターンの減算 → 解除 の順で行う。
 * 戻り値は「このアクターが死んだか」。
 */
export function tickStatuses(world: World, a: Actor): boolean {
  if (!a.alive) return false;

  // 継続ダメージ。HP 1 で止まるものは死因にしない
  if (world.hasStatus(a, 'deadlyPoisoned')) {
    const dmg = Math.min(DEADLY_POISON_DAMAGE, Math.max(0, a.hp - 1));
    if (dmg > 0) {
      a.hp -= dmg;
      world.emit({ t: 'damage', actorId: a.id, amount: dmg, kind: 'magic' });
    }
  }
  if (world.hasStatus(a, 'burning')) {
    // 水の上にいれば火は消える
    const tile = at(world.map, a.pos.x, a.pos.y);
    if (tile && tile.kind === 'water') {
      removeStatus(world, a, 'burning');
      if (a.kind === 'player') world.log('水に入って 火が消えた。', 'good');
    } else {
      a.hp -= BURN_DAMAGE;
      world.emit({ t: 'damage', actorId: a.id, amount: BURN_DAMAGE, kind: 'fire' });
      if (a.hp <= 0) return true;
    }
  }

  // トラばさみからの自力脱出
  if (world.hasStatus(a, 'trapped') && world.rng.chance(TRAPPED_ESCAPE_RATE)) {
    removeStatus(world, a, 'trapped', true);
    if (a.kind === 'player') world.log('トラばさみから 抜け出した！', 'good');
  }

  // 残りターンを減らす
  for (const s of [...a.statuses]) {
    if (s.turns < 0) continue; // 永続
    s.turns--;
    if (s.turns <= 0) {
      removeStatus(world, a, s.id, true);
      if (a.kind === 'player') {
        world.log(`${STATUS_NAME[s.id]}が 治った。`, isAilment(s.id) ? 'good' : 'normal');
      }
    }
  }
  return a.hp <= 0;
}

/** 表示用: 掛かっている状態異常の一覧 */
export function activeStatuses(a: Actor): StatusEffect[] {
  return a.statuses.filter((s) => s.turns !== 0);
}
