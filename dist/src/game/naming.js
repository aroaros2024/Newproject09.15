/**
 * アイテムの表示名を組み立てる。
 *
 * 不思議のダンジョンでは「名前そのものが情報」なので、
 * 未識別／修正値不明／呪い／印／残り回数の見せ方をここに集約する。
 */
import { getItem, tryGetRune, UNIDENTIFIED_KINDS } from '../data/registry.js';
import { runeList } from './runes.js';
import { KIND_SUFFIX } from '../data/names.js';
/** 中身を抱えたままにする壺。これ以外は「あと何回使えるか」で数える */
const POT_HOLDS_CONTENTS = new Set(['storage', 'backpack', 'unbreakable', 'synthesis']);
/** そのカテゴリは未識別の対象か */
export const isUnidentifiableKind = (def) => UNIDENTIFIED_KINDS.includes(def.kind) && !def.alwaysIdentified;
/** 種類が判明しているか */
export function isKnown(item, id) {
    const def = getItem(item.defId);
    if (def.alwaysIdentified)
        return true;
    if (!isUnidentifiableKind(def))
        return true; // 武器・盾・食料は種類自体は分かる
    return !!id.known[item.defId];
}
/** 修正値まで含めて完全に分かっているか */
export function isFullyIdentified(item, id) {
    const def = getItem(item.defId);
    if (def.kind === 'weapon' || def.kind === 'shield' || def.kind === 'bracelet') {
        return isKnown(item, id) && item.plusKnown;
    }
    return isKnown(item, id);
}
/** 未識別のときに出す仮の名前（「みどりの草」など） */
export function aliasName(defId, id) {
    const def = getItem(defId);
    const alias = id.alias[defId];
    const suffix = KIND_SUFFIX[def.kind] ?? '';
    if (!alias)
        return `${suffix || def.name}？`;
    return `${alias}${suffix}`;
}
/**
 * アイテムの表示名。
 *
 *   未識別の草            → 「みどりの草」
 *   識別済みの草          → 「薬草」
 *   修正値不明の武器      → 「鉄の剣」
 *   修正値判明の武器      → 「鉄の剣+3」
 *   印つき                → 「鉄の剣+3[会連]」
 *   呪われていると分かる  → 「鉄の剣+3[会連]呪」
 *   杖                    → 「眠りの杖[4]」
 *   壺                    → 「保存の壺[2/4]」
 *   まとめられるもの      → 「石 5個」
 */
export function itemName(item, id, opts = {}) {
    const def = getItem(item.defId);
    const known = opts.revealAll || isKnown(item, id);
    const nickname = id.nicknames[item.defId];
    let base;
    if (def.kind === 'gitan') {
        return `${item.count}ギタン`;
    }
    if (known) {
        base = def.name;
    }
    else if (nickname) {
        base = `${aliasName(item.defId, id)}（${nickname}）`;
    }
    else {
        base = aliasName(item.defId, id);
    }
    // 修正値
    if (def.kind === 'weapon' || def.kind === 'shield' || def.kind === 'bracelet') {
        if (opts.revealAll || item.plusKnown) {
            if (item.plus !== 0)
                base += item.plus > 0 ? `+${item.plus}` : `${item.plus}`;
        }
        else if (def.kind !== 'bracelet') {
            base += '+?';
        }
    }
    // 印。重ねた印は「会2」のようにレベルを添える
    if ((def.kind === 'weapon' || def.kind === 'shield') && item.runes.length > 0) {
        const symbols = runeList(item).map(({ id: rid, level }) => {
            const rune = tryGetRune(rid);
            const sym = rune ? rune.symbol : '？';
            return level > 1 ? `${sym}${level}` : sym;
        }).join('');
        base += item.sealed ? `[${symbols}封]` : `[${symbols}]`;
    }
    // 杖の残り回数・壺の中身
    if (opts.withDetail !== false) {
        if (def.kind === 'staff' && (opts.revealAll || known)) {
            base += `[${item.charges}]`;
        }
        if (def.kind === 'pot') {
            const cap = def.capacity;
            // 中身を持たない壺（識別・強化など）は「あと何回使えるか」を出す
            base += POT_HOLDS_CONTENTS.has(def.effect)
                ? `[${item.contents.length}/${cap}]`
                : `[${item.charges > 0 ? item.charges : cap}]`;
        }
    }
    // 呪い（識別済みの時だけ見える）
    if (opts.withCurse !== false && item.cursed && (opts.revealAll || item.plusKnown || known)) {
        base += '呪';
    }
    // 個数
    if (opts.withCount !== false && def.stackable && item.count > 1) {
        base += ` ${item.count}個`;
    }
    return base;
}
/** 「〜を」「〜が」のように助詞を付ける前の短い名前 */
export const shortItemName = (item, id) => itemName(item, id, { withCount: false, withDetail: false, withCurse: false });
/** 装備できるカテゴリか */
export const isEquipment = (def) => def.kind === 'weapon' || def.kind === 'shield' || def.kind === 'bracelet';
/** 使う系のコマンド名（食べる／読む／飲む／振る） */
export function useVerb(def) {
    switch (def.kind) {
        case 'herb': return '飲む';
        case 'scroll': return '読む';
        case 'staff': return '振る';
        case 'food': return '食べる';
        case 'pot': return '使う';
        default: return '使う';
    }
}
/** カテゴリの日本語名 */
export function kindLabel(kind) {
    const table = {
        weapon: '武器', shield: '盾', herb: '草', scroll: '巻物', staff: '杖',
        pot: '壺', bracelet: '腕輪', food: '食料', gitan: 'ギタン', misc: 'その他',
    };
    return table[kind] ?? kind;
}
/** 持ち物一覧での並び順（カテゴリごとにまとめる） */
export const KIND_ORDER = [
    'weapon', 'shield', 'bracelet', 'herb', 'scroll', 'staff', 'pot', 'food', 'misc', 'gitan',
];
export const kindOrderOf = (kind) => {
    const i = KIND_ORDER.indexOf(kind);
    return i < 0 ? KIND_ORDER.length : i;
};
//# sourceMappingURL=naming.js.map