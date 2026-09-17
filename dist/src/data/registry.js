/**
 * 全データテーブルの索引。
 *
 * データは配列として書き、ここで id → 定義の Map を作る。
 * ゲームロジックは必ずこのモジュール経由で定義を引く。
 */
import { ALL_ITEMS, UNIDENTIFIED_KINDS, WEAPONS, SHIELDS } from './items/all.js';
import { RUNES } from './runes.js';
import { TRAPS } from './traps.js';
import { MONSTERS } from './monsters.js';
import { DUNGEONS } from './dungeons.js';
import { ALIAS_POOLS } from './names.js';
export { ALL_ITEMS, UNIDENTIFIED_KINDS };
const itemMap = new Map(ALL_ITEMS.map((d) => [d.id, d]));
const runeMap = new Map(RUNES.map((d) => [d.id, d]));
const trapMap = new Map(TRAPS.map((d) => [d.id, d]));
const monsterMap = new Map(MONSTERS.map((d) => [d.id, d]));
const dungeonMap = new Map(DUNGEONS.map((d) => [d.id, d]));
/** id からアイテム定義を引く。未知の id は例外にせず、分かる形で落とす */
export function getItem(id) {
    const d = itemMap.get(id);
    if (!d)
        throw new Error(`未知のアイテム id: ${id}`);
    return d;
}
export const tryGetItem = (id) => itemMap.get(id);
export function getRune(id) {
    const d = runeMap.get(id);
    if (!d)
        throw new Error(`未知の印 id: ${id}`);
    return d;
}
export const tryGetRune = (id) => runeMap.get(id);
export function getTrap(id) {
    const d = trapMap.get(id);
    if (!d)
        throw new Error(`未知のワナ id: ${id}`);
    return d;
}
export function getMonster(id) {
    const d = monsterMap.get(id);
    if (!d)
        throw new Error(`未知のモンスター id: ${id}`);
    return d;
}
export const tryGetMonster = (id) => monsterMap.get(id);
export function getDungeon(id) {
    const d = dungeonMap.get(id);
    if (!d)
        throw new Error(`未知のダンジョン id: ${id}`);
    return d;
}
export const allDungeons = () => DUNGEONS;
export const allMonsters = () => MONSTERS;
export const allTraps = () => TRAPS;
export const allRunes = () => RUNES;
/** カテゴリごとのアイテム一覧 */
export function itemsOfKind(kind) {
    return ALL_ITEMS.filter((d) => d.kind === kind);
}
/**
 * データの整合性検査。起動時に 1 度だけ呼ぶ。
 * ここで落とすことで、壊れたデータのまま遊び始めるのを防ぐ。
 */
export function validateData() {
    const errors = [];
    // id の重複
    const seen = new Set();
    for (const d of ALL_ITEMS) {
        if (seen.has(d.id))
            errors.push(`アイテム id が重複: ${d.id}`);
        seen.add(d.id);
    }
    for (const list of [RUNES, TRAPS, MONSTERS, DUNGEONS]) {
        const s = new Set();
        for (const d of list) {
            if (s.has(d.id))
                errors.push(`id が重複: ${d.id}`);
            s.add(d.id);
        }
    }
    // 装備の初期印がスロット数を超えていないか、印の対象が合っているか
    for (const d of [...WEAPONS, ...SHIELDS]) {
        const slots = 'atk' in d ? d.slots : d.slots;
        if (d.innate.length > slots) {
            errors.push(`${d.id}: 初期印 ${d.innate.length} 個がスロット ${slots} を超えている`);
        }
        for (const r of d.innate) {
            const rune = runeMap.get(r);
            if (!rune) {
                errors.push(`${d.id}: 未知の印 ${r}`);
                continue;
            }
            const want = d.kind === 'weapon' ? 'weapon' : 'shield';
            if (rune.target !== 'both' && rune.target !== want) {
                errors.push(`${d.id}: ${rune.name} は ${want} に付けられない`);
            }
        }
    }
    // stackable でない印の maxLevel は 1
    for (const r of RUNES) {
        if (!r.stackable && r.maxLevel !== 1) {
            errors.push(`印 ${r.id}: stackable でないのに maxLevel が ${r.maxLevel}`);
        }
    }
    // 仮名プールが足りているか
    for (const kind of UNIDENTIFIED_KINDS) {
        const pool = ALIAS_POOLS[kind] ?? [];
        const count = ALL_ITEMS.filter((d) => d.kind === kind).length;
        if (pool.length < count) {
            errors.push(`${kind} の仮名プールが不足: ${pool.length} < ${count}`);
        }
        if (new Set(pool).size !== pool.length) {
            errors.push(`${kind} の仮名プールに重複がある`);
        }
    }
    // モンスターの進化先・ドロップの参照先が存在するか
    for (const m of MONSTERS) {
        if (m.evolveTo && !monsterMap.has(m.evolveTo)) {
            errors.push(`モンスター ${m.id}: 進化先 ${m.evolveTo} が存在しない`);
        }
        if (m.drop && !itemMap.has(m.drop.itemId)) {
            errors.push(`モンスター ${m.id}: ドロップ ${m.drop.itemId} が存在しない`);
        }
    }
    // ダンジョンの出現テーブルの参照先が存在するか
    for (const d of DUNGEONS) {
        for (const e of d.monsters) {
            if (!monsterMap.has(e.id))
                errors.push(`${d.id}: 未知のモンスター ${e.id}`);
        }
        for (const e of d.items) {
            if (!itemMap.has(e.id))
                errors.push(`${d.id}: 未知のアイテム ${e.id}`);
        }
        for (const e of d.traps) {
            if (!trapMap.has(e.id))
                errors.push(`${d.id}: 未知のワナ ${e.id}`);
        }
        for (const b of d.bosses) {
            if (!monsterMap.has(b.monsterId))
                errors.push(`${d.id}: 未知のボス ${b.monsterId}`);
            if (b.depth > d.depth)
                errors.push(`${d.id}: ボスの階 ${b.depth} が最深部を超えている`);
        }
        if (d.requires && !dungeonMap.has(d.requires)) {
            errors.push(`${d.id}: 前提ダンジョン ${d.requires} が存在しない`);
        }
        if (d.reward.itemId && !itemMap.has(d.reward.itemId)) {
            errors.push(`${d.id}: 報酬 ${d.reward.itemId} が存在しない`);
        }
    }
    return errors;
}
//# sourceMappingURL=registry.js.map