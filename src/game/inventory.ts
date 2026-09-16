/**
 * 持ち物の管理とアイテム実体の生成。
 */

import type { Rng } from '../core/rng.js';
import type {
  ItemDef, ItemInstance, PlayerActor,
} from '../core/types.js';
import { getItem } from '../data/registry.js';
import { ALWAYS_CURSED_BRACELETS } from '../data/items/others.js';
import { INVENTORY_LIMIT, PLUS_MAX, PLUS_MIN } from './rules.js';
import { kindOrderOf } from './naming.js';

export interface MakeItemOptions {
  count?: number;
  plus?: number;
  runes?: string[];
  charges?: number;
  cursed?: boolean;
  plusKnown?: boolean;
  /** 床落ちとして生成する（修正値と呪いを抽選する） */
  rolled?: boolean;
  /** 抽選に使う階層（深いほど良い物が出る） */
  depth?: number;
}

let fallbackUid = 1_000_000;

/**
 * アイテムの実体を作る。
 * uid は World から配るのが正しいが、村の初期化など World が無い場面もあるので
 * nextUid を省略した場合は内部カウンタを使う。
 */
export function makeItem(
  defId: string, rng: Rng, o: MakeItemOptions = {}, nextUid?: () => number,
): ItemInstance {
  const def = getItem(defId);
  const item: ItemInstance = {
    uid: nextUid ? nextUid() : fallbackUid++,
    defId,
    count: o.count ?? 1,
    plus: o.plus ?? 0,
    runes: o.runes ? [...o.runes] : [],
    charges: o.charges ?? 0,
    contents: [],
    cursed: o.cursed ?? false,
    plusKnown: o.plusKnown ?? false,
    shopPrice: 0,
    sealed: false,
  };

  // 初期印
  if (def.kind === 'weapon' || def.kind === 'shield') {
    if (!o.runes) item.runes = [...def.innate];
  }
  // 杖の回数
  if (def.kind === 'staff' && o.charges === undefined) {
    item.charges = rng.range(def.charges[0], def.charges[1]);
  }
  // 呪い専用の腕輪
  if (ALWAYS_CURSED_BRACELETS.includes(defId)) item.cursed = true;

  if (o.rolled) rollItemQuality(item, def, rng, o.depth ?? 1);

  // 名前が分かるものは最初から修正値も分かる扱いにする
  if (def.alwaysIdentified) item.plusKnown = true;

  return item;
}

/**
 * 床落ちアイテムの修正値・呪いを抽選する。
 * 深い階ほど修正値の幅が広がるが、呪いの確率も上がる。
 */
function rollItemQuality(item: ItemInstance, def: ItemDef, rng: Rng, depth: number): void {
  if (def.kind !== 'weapon' && def.kind !== 'shield' && def.kind !== 'bracelet') return;
  if (ALWAYS_CURSED_BRACELETS.includes(def.id)) {
    item.cursed = true;
    return;
  }
  const curseRate = Math.min(28, 8 + Math.floor(depth / 4));
  item.cursed = rng.percent(curseRate);
  if (def.kind === 'bracelet') return;

  const spread = 1 + Math.floor(depth / 8);
  if (item.cursed) {
    item.plus = -rng.range(0, spread);
  } else if (rng.percent(35)) {
    item.plus = rng.range(1, spread);
  }
  item.plus = Math.max(PLUS_MIN, Math.min(PLUS_MAX, item.plus));
}

/** ギタンの山を作る */
export function makeGitan(amount: number, rng: Rng, nextUid?: () => number): ItemInstance {
  const item = makeItem('gitan', rng, { count: amount }, nextUid);
  item.plusKnown = true;
  return item;
}

// ---------------------------------------------------------------------------
// 持ち物の操作
// ---------------------------------------------------------------------------

export function findItem(p: PlayerActor, uid: number): ItemInstance | null {
  for (const it of p.inventory) {
    if (it.uid === uid) return it;
    // 背中の壺など、中身を直接使えるものも探せるようにする
    for (const inner of it.contents) if (inner.uid === uid) return inner;
  }
  return null;
}

/** 持ち物の中でのインデックス（無ければ -1） */
export const indexOfItem = (p: PlayerActor, uid: number): number =>
  p.inventory.findIndex((it) => it.uid === uid);

export const isEquipped = (p: PlayerActor, uid: number): boolean =>
  p.weaponUid === uid || p.shieldUid === uid || p.braceletUid === uid;

export const equippedWeapon = (p: PlayerActor): ItemInstance | null =>
  p.weaponUid === null ? null : findItem(p, p.weaponUid);

export const equippedShield = (p: PlayerActor): ItemInstance | null =>
  p.shieldUid === null ? null : findItem(p, p.shieldUid);

export const equippedBracelet = (p: PlayerActor): ItemInstance | null =>
  p.braceletUid === null ? null : findItem(p, p.braceletUid);

/** 持ち物が満杯か */
export const isInventoryFull = (p: PlayerActor): boolean =>
  p.inventory.length >= INVENTORY_LIMIT;

/**
 * 持ち物に加える。まとめられるものは既存の山へ足す。
 * 満杯で入らなければ false。
 */
export function addToInventory(p: PlayerActor, item: ItemInstance): boolean {
  const def = getItem(item.defId);
  if (def.stackable) {
    const stack = p.inventory.find(
      (it) => it.defId === item.defId && it.shopPrice === 0 && item.shopPrice === 0,
    );
    if (stack) {
      stack.count += item.count;
      return true;
    }
  }
  if (isInventoryFull(p)) return false;
  p.inventory.push(item);
  return true;
}

/** ショートカットの枠数（数字キー 1〜9） */
export const SHORTCUT_SLOTS = 9;

/** ショートカット 1 枠ぶんの見え方 */
export interface ShortcutSlot {
  /** 覚えている道具の種類。空き枠なら null */
  defId: string | null;
  /** いま持っている実体。切らしていれば null */
  item: ItemInstance | null;
  /** 手持ちの個数（切らしていれば 0） */
  count: number;
}

/** ショートカットの中身 */
export function shortcutSlots(p: PlayerActor): ShortcutSlot[] {
  const out: ShortcutSlot[] = [];
  for (let i = 0; i < SHORTCUT_SLOTS; i++) {
    const defId = p.shortcutIds?.[i] ?? null;
    const item = defId === null
      ? null
      : (p.inventory.find((it) => it.defId === defId) ?? null);
    out.push({ defId, item, count: item ? (item.count || 1) : 0 });
  }
  return out;
}

/** ショートカットへ割り当てる。同じ種類が別の枠にあれば、そちらは空ける */
export function assignShortcut(p: PlayerActor, slot: number, defId: string | null): void {
  if (!p.shortcutIds) p.shortcutIds = new Array(SHORTCUT_SLOTS).fill(null);
  if (defId !== null) {
    for (let i = 0; i < SHORTCUT_SLOTS; i++) if (p.shortcutIds[i] === defId) p.shortcutIds[i] = null;
  }
  if (slot >= 0 && slot < SHORTCUT_SLOTS) p.shortcutIds[slot] = defId;
}

/**
 * 保持枠。倒れても失わない道具を選ぶ。
 *
 * 持てる数は増えない（持ち物 20 の中から選ぶ）。
 * 増えるのは「失わない」という保証だけなので、
 * 「今いちばん惜しい物は何か」を選ぶ遊びになる。
 */
export function keptItems(p: PlayerActor): ItemInstance[] {
  if (!p.keptUids) return [];
  return p.keptUids
    .map((uid) => p.inventory.find((it) => it.uid === uid))
    .filter((it): it is ItemInstance => it !== undefined);
}

export const isKept = (p: PlayerActor, uid: number): boolean =>
  !!p.keptUids && p.keptUids.includes(uid);

/** 保持枠に入れる。空きが無ければ false */
export function addKept(p: PlayerActor, uid: number, slots: number): boolean {
  if (!p.keptUids) p.keptUids = [];
  // 持っていない物は守れない
  if (!p.inventory.some((it) => it.uid === uid)) return false;
  if (p.keptUids.includes(uid)) return true;
  // 持ち物から消えた物は枠を占めたままにしない
  p.keptUids = p.keptUids.filter((u) => p.inventory.some((it) => it.uid === u));
  if (p.keptUids.length >= slots) return false;
  p.keptUids.push(uid);
  return true;
}

export function removeKept(p: PlayerActor, uid: number): void {
  if (!p.keptUids) return;
  p.keptUids = p.keptUids.filter((u) => u !== uid);
}

/** その種類が入っている枠。無ければ -1 */
export function shortcutOf(p: PlayerActor, defId: string): number {
  if (!p.shortcutIds) return -1;
  return p.shortcutIds.findIndex((x) => x === defId);
}

/** 持ち物から取り除く。装備していたら外す */
export function removeFromInventory(p: PlayerActor, uid: number): ItemInstance | null {
  const i = indexOfItem(p, uid);
  if (i < 0) {
    // 壺の中身
    for (const pot of p.inventory) {
      const j = pot.contents.findIndex((it) => it.uid === uid);
      if (j >= 0) return pot.contents.splice(j, 1)[0];
    }
    return null;
  }
  if (p.weaponUid === uid) p.weaponUid = null;
  if (p.shieldUid === uid) p.shieldUid = null;
  if (p.braceletUid === uid) p.braceletUid = null;
  removeKept(p, uid);
  return p.inventory.splice(i, 1)[0];
}

/**
 * まとめられるアイテムを 1 個だけ取り出す。
 * 残りがあれば山に残し、最後の 1 個なら持ち物から取り除く。
 *
 * 分けた 1 個には必ず新しい uid を振る。山と同じ uid のまま床に置くと、
 * findItem() がどちらを指すか決まらなくなる。
 */
export function splitOne(
  p: PlayerActor, uid: number, nextUid: () => number,
): ItemInstance | null {
  const item = findItem(p, uid);
  if (!item) return null;
  const def = getItem(item.defId);
  if (!def.stackable || item.count <= 1) return removeFromInventory(p, uid);
  item.count--;
  return {
    ...item,
    uid: nextUid(),
    count: 1,
    runes: [...item.runes],
    contents: [],
  };
}

/** カテゴリ順に並べ替える（シレンの「まとめる」に相当） */
export function sortInventory(p: PlayerActor): void {
  p.inventory.sort((a, b) => {
    const ka = kindOrderOf(getItem(a.defId).kind);
    const kb = kindOrderOf(getItem(b.defId).kind);
    if (ka !== kb) return ka - kb;
    if (a.defId !== b.defId) return a.defId < b.defId ? -1 : 1;
    return b.plus - a.plus;
  });
}

/** 同じ種類のまとめられるアイテムを 1 つの山にする */
export function mergeStacks(p: PlayerActor): number {
  let merged = 0;
  for (let i = 0; i < p.inventory.length; i++) {
    const a = p.inventory[i];
    if (!getItem(a.defId).stackable || a.shopPrice > 0) continue;
    for (let j = p.inventory.length - 1; j > i; j--) {
      const b = p.inventory[j];
      if (b.defId !== a.defId || b.shopPrice > 0) continue;
      a.count += b.count;
      p.inventory.splice(j, 1);
      merged++;
    }
  }
  return merged;
}

/** 条件に合う持ち物を数える */
export const countItems = (p: PlayerActor, pred: (it: ItemInstance) => boolean): number =>
  p.inventory.filter(pred).length;

/** 壺の中身も含めた全アイテム（死亡時のロストや結果表示に使う） */
export function allCarriedItems(p: PlayerActor): ItemInstance[] {
  const out: ItemInstance[] = [];
  for (const it of p.inventory) {
    out.push(it);
    out.push(...it.contents);
  }
  return out;
}

/** 装備中でも壺の中でもない、盗める／落とせるアイテム */
export function losableItems(p: PlayerActor): ItemInstance[] {
  return p.inventory.filter((it) => !isEquipped(p, it.uid));
}
