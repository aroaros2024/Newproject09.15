/**
 * 持ち物の管理とアイテム実体の生成。
 */
import { getItem } from '../data/registry.js';
import { ALWAYS_CURSED_BRACELETS } from '../data/items/others.js';
import { INVENTORY_LIMIT, PLUS_MAX, PLUS_MIN } from './rules.js';
import { kindOrderOf } from './naming.js';
let fallbackUid = 1_000_000;
/**
 * アイテムの実体を作る。
 * uid は World から配るのが正しいが、村の初期化など World が無い場面もあるので
 * nextUid を省略した場合は内部カウンタを使う。
 */
export function makeItem(defId, rng, o = {}, nextUid) {
    const def = getItem(defId);
    const item = {
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
        if (!o.runes)
            item.runes = [...def.innate];
    }
    // 杖の回数
    if (def.kind === 'staff' && o.charges === undefined) {
        item.charges = rng.range(def.charges[0], def.charges[1]);
    }
    // 呪い専用の腕輪
    if (ALWAYS_CURSED_BRACELETS.includes(defId))
        item.cursed = true;
    if (o.rolled)
        rollItemQuality(item, def, rng, o.depth ?? 1);
    // 名前が分かるものは最初から修正値も分かる扱いにする
    if (def.alwaysIdentified)
        item.plusKnown = true;
    return item;
}
/**
 * 床落ちアイテムの修正値・呪いを抽選する。
 * 深い階ほど修正値の幅が広がるが、呪いの確率も上がる。
 */
function rollItemQuality(item, def, rng, depth) {
    if (def.kind !== 'weapon' && def.kind !== 'shield' && def.kind !== 'bracelet')
        return;
    if (ALWAYS_CURSED_BRACELETS.includes(def.id)) {
        item.cursed = true;
        return;
    }
    const curseRate = Math.min(28, 8 + Math.floor(depth / 4));
    item.cursed = rng.percent(curseRate);
    if (def.kind === 'bracelet')
        return;
    const spread = 1 + Math.floor(depth / 8);
    if (item.cursed) {
        item.plus = -rng.range(0, spread);
    }
    else if (rng.percent(35)) {
        item.plus = rng.range(1, spread);
    }
    item.plus = Math.max(PLUS_MIN, Math.min(PLUS_MAX, item.plus));
}
/** ギタンの山を作る */
export function makeGitan(amount, rng, nextUid) {
    const item = makeItem('gitan', rng, { count: amount }, nextUid);
    item.plusKnown = true;
    return item;
}
// ---------------------------------------------------------------------------
// 持ち物の操作
// ---------------------------------------------------------------------------
export function findItem(p, uid) {
    for (const it of p.inventory) {
        if (it.uid === uid)
            return it;
        // 背中の壺など、中身を直接使えるものも探せるようにする
        for (const inner of it.contents)
            if (inner.uid === uid)
                return inner;
    }
    return null;
}
/** 持ち物の中でのインデックス（無ければ -1） */
export const indexOfItem = (p, uid) => p.inventory.findIndex((it) => it.uid === uid);
export const isEquipped = (p, uid) => p.weaponUid === uid || p.shieldUid === uid || p.braceletUid === uid;
export const equippedWeapon = (p) => p.weaponUid === null ? null : findItem(p, p.weaponUid);
export const equippedShield = (p) => p.shieldUid === null ? null : findItem(p, p.shieldUid);
export const equippedBracelet = (p) => p.braceletUid === null ? null : findItem(p, p.braceletUid);
/** 持ち物が満杯か */
export const isInventoryFull = (p) => p.inventory.length >= INVENTORY_LIMIT;
/**
 * 持ち物に加える。まとめられるものは既存の山へ足す。
 * 満杯で入らなければ false。
 */
export function addToInventory(p, item) {
    const def = getItem(item.defId);
    if (def.stackable) {
        const stack = p.inventory.find((it) => it.defId === item.defId && it.shopPrice === 0 && item.shopPrice === 0);
        if (stack) {
            stack.count += item.count;
            return true;
        }
    }
    if (isInventoryFull(p))
        return false;
    p.inventory.push(item);
    return true;
}
/** ショートカットの枠数（数字キー 1〜9） */
export const SHORTCUT_SLOTS = 9;
/** ショートカットの中身 */
export function shortcutSlots(p) {
    const out = [];
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
export function assignShortcut(p, slot, defId) {
    if (!p.shortcutIds)
        p.shortcutIds = new Array(SHORTCUT_SLOTS).fill(null);
    if (defId !== null) {
        for (let i = 0; i < SHORTCUT_SLOTS; i++)
            if (p.shortcutIds[i] === defId)
                p.shortcutIds[i] = null;
    }
    if (slot >= 0 && slot < SHORTCUT_SLOTS)
        p.shortcutIds[slot] = defId;
}
/** その種類が入っている枠。無ければ -1 */
export function shortcutOf(p, defId) {
    if (!p.shortcutIds)
        return -1;
    return p.shortcutIds.findIndex((x) => x === defId);
}
/** 持ち物から取り除く。装備していたら外す */
export function removeFromInventory(p, uid) {
    const i = indexOfItem(p, uid);
    if (i < 0) {
        // 壺の中身
        for (const pot of p.inventory) {
            const j = pot.contents.findIndex((it) => it.uid === uid);
            if (j >= 0)
                return pot.contents.splice(j, 1)[0];
        }
        return null;
    }
    if (p.weaponUid === uid)
        p.weaponUid = null;
    if (p.shieldUid === uid)
        p.shieldUid = null;
    if (p.braceletUid === uid)
        p.braceletUid = null;
    return p.inventory.splice(i, 1)[0];
}
/**
 * まとめられるアイテムを 1 個だけ取り出す。
 * 残りがあれば山に残し、最後の 1 個なら持ち物から取り除く。
 *
 * 分けた 1 個には必ず新しい uid を振る。山と同じ uid のまま床に置くと、
 * findItem() がどちらを指すか決まらなくなる。
 */
export function splitOne(p, uid, nextUid) {
    const item = findItem(p, uid);
    if (!item)
        return null;
    const def = getItem(item.defId);
    if (!def.stackable || item.count <= 1)
        return removeFromInventory(p, uid);
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
export function sortInventory(p) {
    p.inventory.sort((a, b) => {
        const ka = kindOrderOf(getItem(a.defId).kind);
        const kb = kindOrderOf(getItem(b.defId).kind);
        if (ka !== kb)
            return ka - kb;
        if (a.defId !== b.defId)
            return a.defId < b.defId ? -1 : 1;
        return b.plus - a.plus;
    });
}
/** 同じ種類のまとめられるアイテムを 1 つの山にする */
export function mergeStacks(p) {
    let merged = 0;
    for (let i = 0; i < p.inventory.length; i++) {
        const a = p.inventory[i];
        if (!getItem(a.defId).stackable || a.shopPrice > 0)
            continue;
        for (let j = p.inventory.length - 1; j > i; j--) {
            const b = p.inventory[j];
            if (b.defId !== a.defId || b.shopPrice > 0)
                continue;
            a.count += b.count;
            p.inventory.splice(j, 1);
            merged++;
        }
    }
    return merged;
}
/** 条件に合う持ち物を数える */
export const countItems = (p, pred) => p.inventory.filter(pred).length;
/** 壺の中身も含めた全アイテム（死亡時のロストや結果表示に使う） */
export function allCarriedItems(p) {
    const out = [];
    for (const it of p.inventory) {
        out.push(it);
        out.push(...it.contents);
    }
    return out;
}
/** 装備中でも壺の中でもない、盗める／落とせるアイテム */
export function losableItems(p) {
    return p.inventory.filter((it) => !isEquipped(p, it.uid));
}
//# sourceMappingURL=inventory.js.map