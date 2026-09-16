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
import { getItem } from '../data/registry.js';
import { equippedBracelet } from './inventory.js';
import { MAX_HP_CAP } from './rules.js';
/** 実装済みの腕輪の効果 id。data 側はこの中からしか使ってはいけない */
export const BRACELET_EFFECT_IDS = [
    'strBonus', 'defBonus', 'regen', 'noHunger', 'trapMaster', 'farThrow',
    'seeMonsters', 'seeTraps', 'autoIdentify', 'wardConfuse', 'wardSleep',
    'wardPoison', 'wardCurse', 'wardSteal', 'critUp', 'sureHit', 'waterWalk',
    'levitate', 'wardBlast', 'maxHpUp', 'revive',
    // 呪い専用
    'painCurse', 'starveCurse', 'crookedCurse', 'rustCurse',
];
const VALID = new Set(BRACELET_EFFECT_IDS);
export const isBraceletEffect = (id) => VALID.has(id);
/**
 * 今efficace な腕輪の効果 id。
 * 封印されていれば無効。呪い専用の効果は呪われていても効く。
 */
export function activeBraceletEffect(world, p) {
    const b = equippedBracelet(p);
    if (!b)
        return null;
    const def = getItem(b.defId);
    if (def.kind !== 'bracelet')
        return null;
    if (!isBraceletEffect(def.effect))
        return null;
    const cursedOnly = def.effect.endsWith('Curse');
    if (world.hasStatus(p, 'sealed') && !cursedOnly)
        return null;
    return def.effect;
}
export const hasBracelet = (world, p, id) => activeBraceletEffect(world, p) === id;
/** 呪われた腕輪か（良い効果が反転する） */
export function braceletIsCursed(p) {
    const b = equippedBracelet(p);
    return !!b && b.cursed;
}
/** 竜脈の腕輪が上乗せする最大 HP */
export const MAX_HP_BRACELET_BONUS = 30;
/**
 * 竜脈の腕輪の最大 HP ボーナスを、今の状態に合わせて引き直す。
 *
 * 「装備した時に足して、外した時に引く」という書き方だと、
 * 置く・投げる・売る・壺に入れる・封印される・封印が解ける、の
 * どれか 1 つでも呼び忘れた瞬間に最大 HP がずれる（増え続ける／減り続ける）。
 * そこで「今いくら上乗せしているか」を braceletHpBonus に持ち、
 * この関数は何度呼んでも同じ結果になるようにしてある。
 * 装備の付け外しの直後と、毎ターンの終わりに呼べばよい。
 */
export function syncBraceletBonus(world, p) {
    // 腕輪を抜きにした素の最大 HP
    const base = p.maxHp - p.braceletHpBonus;
    const want = activeBraceletEffect(world, p) === 'maxHpUp' ? MAX_HP_BRACELET_BONUS : 0;
    const applied = Math.max(0, Math.min(want, MAX_HP_CAP - base));
    if (applied === p.braceletHpBonus)
        return;
    const diff = applied - p.braceletHpBonus;
    p.braceletHpBonus = applied;
    p.maxHp = base + applied;
    if (diff > 0)
        p.hp = Math.min(p.maxHp, p.hp + diff);
    else
        p.hp = Math.min(p.hp, p.maxHp);
}
//# sourceMappingURL=bracelets.js.map