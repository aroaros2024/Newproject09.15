/**
 * 護石。村で 1 つだけ着ける、印を持った恒久の加護。
 *
 * ガチャの他の景品と違い、護石は表から選ぶのではなく**その場で作る**。
 * だから在庫が尽きず、引くたびに違うものが出る。
 *
 * 厳選が苦行にならないように、外れた護石にも出口を 3 つ用意してある。
 *   溶かす    ギタンに変わる。どの引きも無駄にならない
 *   打ち直す  印を 1 つ残して残りを振り直す。全部やり直しにしない
 *   箱の上限  満杯のあいだは護石が出ない（引いた護石を失う事故が起きない）
 */
import { CHARM_MAX_RUNES, CHARM_QUALITY, CHARM_RUNES, CHARM_RUNE_IDS, } from '../data/charms.js';
import { EXCLUSIVE_RUNE_PAIRS } from '../data/runes.js';
import { tryGetRune } from '../data/registry.js';
/** 護石を溶かしたときのギタン。印 1 レベルあたり ＋ 空きスロット 1 つあたり */
const MELT_PER_LEVEL = 120;
const MELT_PER_SLOT = 200;
const MELT_BASE = 100;
/** 打ち直しの値段。印を 1 つ残して残りを振り直す */
export const REFORGE_PRICE = 1200;
/** 護石に印を 1 つ入れる値段。素材の装備も 1 つ消える */
export const EMBED_PRICE = 800;
/** その印のレベル（付いていなければ 0）。装備と同じく出現回数がレベル */
export function charmRuneLevel(charm, runeId) {
    if (!charm)
        return 0;
    let n = 0;
    for (const r of charm.runes)
        if (r === runeId)
            n++;
    return n;
}
/** 付いている印の一覧（id とレベル）。表示順は付けた順 */
export function charmRuneList(charm) {
    const seen = [];
    for (const r of charm.runes)
        if (!seen.includes(r))
            seen.push(r);
    return seen.map((id) => ({ id, level: charmRuneLevel(charm, id) }));
}
/** 使っている印の種類数 */
export const charmUsedSlots = (charm) => new Set(charm.runes).size;
/**
 * 表示名。「護石 [会2 吸1] 空き2」
 *
 * 装備の印表示（game/naming.ts）と同じ記号を使う。別の書き方にすると
 * 「この印は武器のあれと同じ物なのか」が読み取れなくなる。
 */
export function charmName(charm) {
    const symbols = charmRuneList(charm).map(({ id, level }) => {
        const sym = tryGetRune(id)?.symbol ?? '？';
        return level > 1 ? `${sym}${level}` : sym;
    }).join('');
    const slots = charm.slots > 0 ? ` 空き${charm.slots}` : '';
    return symbols.length > 0 ? `護石 [${symbols}]${slots}` : `護石${slots}`;
}
/**
 * 強さの目安。村の一覧を強い順に並べるためだけに使う。
 *
 * 30 個を目で比べられないと厳選が作業になるので、並べ替えの基準は要る。
 * ただしこれは「どれが自分に効くか」ではないので、戦闘には一切使わない。
 */
export function charmScore(charm) {
    let score = charm.slots * 3;
    for (const { id, level } of charmRuneList(charm)) {
        // めずらしい印ほど重く見積もる（weight が小さいほどめずらしい）
        const w = CHARM_RUNES[id]?.weight ?? 3;
        score += level * (8 / Math.max(1, w));
    }
    return Math.round(score * 10) / 10;
}
/** 溶かしたときのギタン */
export function meltValue(charm) {
    return MELT_BASE + charm.runes.length * MELT_PER_LEVEL + charm.slots * MELT_PER_SLOT;
}
/** その印と同時に付けられない印 */
function exclusiveOf(id) {
    for (const [a, b] of EXCLUSIVE_RUNE_PAIRS) {
        if (id === a)
            return b;
        if (id === b)
            return a;
    }
    return null;
}
/** 在庫から重みで 1 つ選ぶ */
function pickRune(rng, pool) {
    const total = pool.reduce((a, id) => a + (CHARM_RUNES[id]?.weight ?? 0), 0);
    let x = rng.float() * total;
    for (const id of pool) {
        x -= CHARM_RUNES[id]?.weight ?? 0;
        if (x < 0)
            return id;
    }
    return pool[pool.length - 1];
}
/**
 * レベルを決める。
 *
 * 1 から始めて、1 段上げるたびに levelUp で判定する。
 * 上限まで伸びるのはまれになるので、「上限の印が出た」が当たりになる。
 */
function rollLevel(rng, max, levelUp) {
    let level = 1;
    while (level < max && rng.chance(levelUp))
        level++;
    return level;
}
/**
 * 護石を 1 つ作る。
 *
 * 排他の印（剛腕と疾風など）は同居させない。装備側は addRune が弾いているが、
 * こちらは runes を直接組み立てるので、ここで弾かないと素通りする。
 */
export function rollCharm(rng, rarity, uid) {
    const q = CHARM_QUALITY[rarity];
    const want = rng.range(q.runes[0], q.runes[1]);
    const runes = [];
    const taken = new Set();
    let pool = [...CHARM_RUNE_IDS];
    for (let i = 0; i < want && pool.length > 0; i++) {
        const id = pickRune(rng, pool);
        taken.add(id);
        const other = exclusiveOf(id);
        pool = pool.filter((r) => r !== id && r !== other);
        const max = CHARM_RUNES[id]?.maxLevel ?? 1;
        const level = rollLevel(rng, max, q.levelUp);
        for (let n = 0; n < level; n++)
            runes.push(id);
    }
    return { uid, runes, slots: rng.range(q.slots[0], q.slots[1]) };
}
/**
 * 護石に印を 1 つ入れる。空きスロットを 1 つ使う。
 *
 * 装備の addRune と違い、**レベルを上げるときも空きスロットを使う**。
 * 「空き 2 ＝ あと 2 回 印を入れられる」と 1 行で言えるようにするため。
 * 装備と同じ規則にすると、同じ印を延々と重ねられて上限が事実上消える。
 */
export function addCharmRune(charm, runeId) {
    const rule = CHARM_RUNES[runeId];
    if (!rule)
        return false;
    if (charm.slots <= 0)
        return false;
    const level = charmRuneLevel(charm, runeId);
    if (level >= rule.maxLevel)
        return false;
    if (level === 0 && charmUsedSlots(charm) >= CHARM_MAX_RUNES)
        return false;
    // 排他の相手が付いていれば、それを取り除いてから入れる（装備と同じ）
    const other = exclusiveOf(runeId);
    if (other && charmRuneLevel(charm, other) > 0) {
        charm.runes = charm.runes.filter((r) => r !== other);
    }
    charm.runes.push(runeId);
    charm.slots--;
    return true;
}
/** その印を護石に入れられるか（理由は問わない） */
export function canAddCharmRune(charm, runeId) {
    const rule = CHARM_RUNES[runeId];
    if (!rule || charm.slots <= 0)
        return false;
    const level = charmRuneLevel(charm, runeId);
    if (level >= rule.maxLevel)
        return false;
    return level > 0 || charmUsedSlots(charm) < CHARM_MAX_RUNES;
}
/**
 * 打ち直す。指定した印だけを残して、残りを振り直す。
 *
 * 全部やり直しにしないのは、「良い部分を保存できない」形の厳選が
 * いちばん嫌われるため。空きスロットも引き継がない（ここが賭けになる）。
 */
export function reforgeCharm(rng, charm, keep) {
    const fresh = rollCharm(rng, 'r', charm.uid);
    if (keep === null || charmRuneLevel(charm, keep) === 0)
        return fresh;
    const level = charmRuneLevel(charm, keep);
    const other = exclusiveOf(keep);
    const rest = fresh.runes.filter((r) => r !== keep && r !== other);
    const kept = [];
    for (let i = 0; i < level; i++)
        kept.push(keep);
    // 残した印を先頭に置く。種類数が上限を超えないように後ろを削る
    const out = [...kept];
    const seen = new Set([keep]);
    for (const r of rest) {
        if (!seen.has(r) && seen.size >= new Set(fresh.runes).size)
            continue;
        seen.add(r);
        out.push(r);
    }
    return { uid: charm.uid, runes: out, slots: fresh.slots };
}
//# sourceMappingURL=charm.js.map