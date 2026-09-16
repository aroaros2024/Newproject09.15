/**
 * 腕輪の効果。
 *
 * 腕輪は「使う」ものではなく「着けている間ずっと効く」ものなので、
 * itemEffects.ts のハンドラ表には載らない。代わりに、ここで効果 id を
 * 一覧として定義し、各所からこの述語を通して参照する。
 *
 * こうしておかないと、効果 id の綴りを間違えても何も起きないまま
 * 気づけない（腕輪が黙って無効になる）。
 */

import type { PlayerActor } from '../core/types.js';
import { getItem } from '../data/registry.js';
import { equippedBracelet } from './inventory.js';
import type { World } from './world.js';

/** 実装済みの腕輪の効果 id。data 側はこの中からしか使ってはいけない */
export const BRACELET_EFFECT_IDS = [
  'strBonus', 'defBonus', 'regen', 'noHunger', 'trapMaster', 'farThrow',
  'seeMonsters', 'seeTraps', 'autoIdentify', 'wardConfuse', 'wardSleep',
  'wardPoison', 'wardCurse', 'wardSteal', 'critUp', 'sureHit', 'waterWalk',
  'levitate', 'wardBlast', 'maxHpUp', 'revive',
  // 呪い専用
  'painCurse', 'starveCurse', 'crookedCurse', 'rustCurse',
] as const;

export type BraceletEffectId = (typeof BRACELET_EFFECT_IDS)[number];

const VALID = new Set<string>(BRACELET_EFFECT_IDS);

export const isBraceletEffect = (id: string): id is BraceletEffectId => VALID.has(id);

/**
 * 今efficace な腕輪の効果 id。
 * 封印されていれば無効。呪い専用の効果は呪われていても効く。
 */
export function activeBraceletEffect(world: World, p: PlayerActor): BraceletEffectId | null {
  const b = equippedBracelet(p);
  if (!b) return null;
  const def = getItem(b.defId);
  if (def.kind !== 'bracelet') return null;
  if (!isBraceletEffect(def.effect)) return null;
  const cursedOnly = def.effect.endsWith('Curse');
  if (world.hasStatus(p, 'sealed') && !cursedOnly) return null;
  return def.effect;
}

export const hasBracelet = (world: World, p: PlayerActor, id: BraceletEffectId): boolean =>
  activeBraceletEffect(world, p) === id;

/** 呪われた腕輪か（良い効果が反転する） */
export function braceletIsCursed(p: PlayerActor): boolean {
  const b = equippedBracelet(p);
  return !!b && b.cursed;
}

/** 竜脈の腕輪のように、着け外しで最大 HP が変わるものを反映する */
export function applyEquipBonus(world: World, p: PlayerActor, equipping: boolean): void {
  const effect = activeBraceletEffect(world, p);
  if (effect !== 'maxHpUp') return;
  const amount = 30;
  if (equipping) {
    p.maxHp = Math.min(999, p.maxHp + amount);
    p.hp = Math.min(p.maxHp, p.hp + amount);
  } else {
    p.maxHp = Math.max(1, p.maxHp - amount);
    p.hp = Math.min(p.hp, p.maxHp);
  }
}
