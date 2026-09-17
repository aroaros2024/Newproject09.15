/**
 * 印（ルーン）の参照ヘルパ。
 *
 * ItemInstance.runes は同じ印 id を重複して持てる。
 *   - 使用スロット数 = 異なる印 id の数
 *   - 印のレベル     = その id の出現回数
 * これで「重ねられる印は 1 スロットのまま強くなる」という規則を
 * 追加のフィールド無しで表現している。
 */

import type { ItemInstance, PlayerActor, RuneId } from '../core/types.js';
import { getItem, tryGetRune } from '../data/registry.js';
import { EXCLUSIVE_RUNE_PAIRS } from '../data/runes.js';
import { charmRuneLevel } from './charm.js';
import { equippedShield, equippedWeapon } from './inventory.js';
import type { World } from './world.js';

/** 印のレベル（付いていなければ 0） */
export function runeLevel(item: ItemInstance, runeId: string): number {
  let n = 0;
  for (const r of item.runes) if (r === runeId) n++;
  return n;
}

export const hasRune = (item: ItemInstance, runeId: string): boolean =>
  runeLevel(item, runeId) > 0;

/** 印が使っているスロット数 */
export const usedSlots = (item: ItemInstance): number => new Set(item.runes).size;

/** 印の一覧（id とレベル）。表示順は付けた順 */
export function runeList(item: ItemInstance): Array<{ id: string; level: number }> {
  const seen: string[] = [];
  for (const r of item.runes) if (!seen.includes(r)) seen.push(r);
  return seen.map((id) => ({ id, level: runeLevel(item, id) }));
}

/** その装備に埋められる印の総数（匠の印で増える） */
export function slotCapacity(item: ItemInstance): number {
  const def = getItem(item.defId);
  const base = def.kind === 'weapon' || def.kind === 'shield' ? def.slots : 0;
  return base + runeLevel(item, 'smith');
}

/** 空きスロット数 */
export const freeSlots = (item: ItemInstance): number =>
  Math.max(0, slotCapacity(item) - usedSlots(item));

/**
 * 印を 1 つ加える。
 * - 封印中でも保持はできる（効果だけが止まる）
 * - 排他の相手が付いていれば、それを取り除いてから加える
 * - 重ねられる印は maxLevel まで、そうでなければ 1 つまで
 * - 空きスロットが無ければ失敗（既に付いている印の強化は空き不要）
 */
export function addRune(item: ItemInstance, runeId: string): boolean {
  const def = tryGetRune(runeId);
  if (!def) return false;
  const target = getItem(item.defId);
  if (target.kind !== 'weapon' && target.kind !== 'shield') return false;
  const want = target.kind;
  if (def.target !== 'both' && def.target !== want) return false;

  for (const [a, b] of EXCLUSIVE_RUNE_PAIRS) {
    const other = runeId === a ? b : runeId === b ? a : null;
    if (other && hasRune(item, other)) removeRune(item, other);
  }

  const level = runeLevel(item, runeId);
  if (level === 0) {
    if (freeSlots(item) <= 0) return false;
    item.runes.push(runeId);
    return true;
  }
  if (!def.stackable || level >= def.maxLevel) return false;
  item.runes.push(runeId);
  return true;
}

/** 印をすべて取り除く（レベルごと消す） */
export function removeRune(item: ItemInstance, runeId: string): void {
  item.runes = item.runes.filter((r) => r !== runeId);
}

/** 印の効果が生きているか（封印されていれば死んでいる） */
export const runesActive = (item: ItemInstance | null): boolean => !!item && !item.sealed;

/** 装備の印レベルを引く。装備していない・封印されている場合は 0 */
export function equipRuneLevel(item: ItemInstance | null, runeId: string): number {
  if (!item || item.sealed) return 0;
  return runeLevel(item, runeId);
}

/**
 * 護石ぶんの印。
 *
 * 護石は道具ではないので、封印の巻物では止まらない。
 * 加護なしのダンジョンでは world.charm が null になっているので、ここも 0 になる。
 */
function charmPart(world: World, runeId: RuneId, want: 'weapon' | 'shield'): number {
  const charm = world.charm;
  if (!charm) return 0;
  const def = tryGetRune(runeId);
  if (!def) return 0;
  if (def.target !== 'both' && def.target !== want) return 0;
  return charmRuneLevel(charm, runeId);
}

/**
 * 武器の印のレベル。**印を読むときはここを通す。**
 *
 * 装備の印と護石の印を足した値を返す。読み手がどちらか一方だけを見ると、
 * 護石が効いたり効かなかったりする場所ができる。
 */
export function weaponRune(world: World, p: PlayerActor, runeId: RuneId): number {
  return equipRuneLevel(equippedWeapon(p), runeId) + charmPart(world, runeId, 'weapon');
}

/** 盾の印のレベル。**印を読むときはここを通す。** */
export function shieldRune(world: World, p: PlayerActor, runeId: RuneId): number {
  return equipRuneLevel(equippedShield(p), runeId) + charmPart(world, runeId, 'shield');
}
