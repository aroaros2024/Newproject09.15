/**
 * ガチャ。石を払って景品を引く。
 *
 * 乱数は Rng（xorshift）を使う。Math.random は使わない。
 * 引いた結果は「景品 id の枚数」としてだけ持ち、効き目はそこから計算する。
 * 効き目を別に持つと、枚数と効き目のどちらかが必ずズレる。
 */
import { Rng } from '../core/rng.js';
import { DUP_STONES, RARITY_RATE, prizesOf, tryGetPrize, } from '../data/gacha.js';
import { tryGetPartner } from '../data/partners.js';
import { GACHA_COST, GACHA_COST_10, MAX_KEEP_SLOTS, BASE_KEEP_SLOTS } from './rules.js';
/** 10 連の何回目を SR 以上にするか（1 始まり） */
const GUARANTEE_AT = 10;
export const ownedCount = (town, prizeId) => Math.max(0, Math.floor(town.gachaOwned?.[prizeId] ?? 0));
/** レア度を 1 つ選ぶ。合計が 100 でなくても比で選べるようにしてある */
function rollRarity(rng, forceSrUp) {
    const pool = forceSrUp ? ['ssr', 'sr'] : ['ssr', 'sr', 'r', 'n'];
    const total = pool.reduce((a, r) => a + RARITY_RATE[r], 0);
    let x = rng.float() * total;
    for (const r of pool) {
        x -= RARITY_RATE[r];
        if (x < 0)
            return r;
    }
    return pool[pool.length - 1];
}
/** そのレア度の中から重みで 1 つ選ぶ */
function rollPrize(rng, rarity) {
    const list = prizesOf(rarity);
    const total = list.reduce((a, p) => a + p.weight, 0);
    let x = rng.float() * total;
    for (const p of list) {
        x -= p.weight;
        if (x < 0)
            return p;
    }
    return list[list.length - 1];
}
/**
 * 引ける回数。
 *
 * 石が足りない・倉庫がいっぱいでも引けること自体は止めない。
 * 倉庫からあふれた道具は消える（その旨を結果で返す）。
 */
export const canPull = (town, n) => (town.stones ?? 0) >= (n === 10 ? GACHA_COST_10 : GACHA_COST);
export const pullCost = (n) => (n === 10 ? GACHA_COST_10 : GACHA_COST);
/**
 * 引く。石は呼ぶ前ではなくここで引き落とす。
 *
 * deliver は景品の道具を倉庫へ入れる処理。倉庫がいっぱいなら false を返す。
 * 倉庫の都合をここに持ち込むと、ガチャの検査に倉庫の準備が要るようになる。
 */
export function pull(town, n, deliver) {
    const cost = pullCost(n);
    if ((town.stones ?? 0) < cost)
        return [];
    town.stones = (town.stones ?? 0) - cost;
    // 引くたびに違う結果になり、かつ同じ村・同じ回数なら再現する
    const rng = new Rng(`gacha:${town.playerName}:${town.gachaPulls ?? 0}:${town.stones}`);
    const out = [];
    for (let i = 0; i < n; i++) {
        // 10 連の最後は SR 以上
        const forced = n === 10 && i === GUARANTEE_AT - 1
            && !out.some((r) => r.prize.rarity === 'ssr' || r.prize.rarity === 'sr');
        out.push(grant(town, rollPrize(rng, rollRarity(rng, forced)), deliver));
    }
    town.gachaPulls = (town.gachaPulls ?? 0) + n;
    return out;
}
/** 景品 1 つを村に反映する */
function grant(town, prize, deliver) {
    const had = ownedCount(town, prize.id);
    town.gachaOwned ??= {};
    town.gachaOwned[prize.id] = had + 1;
    const res = { prize, dup: had > 0, refund: 0, bond: false, lost: 0 };
    if (prize.partnerId) {
        town.partners ??= {};
        const rec = town.partners[prize.partnerId];
        if (rec) {
            // 同じ相棒を引き直したら、強さではなく「一緒に潜れる上限」が伸びる
            rec.dupes++;
            res.bond = true;
        }
        else {
            town.partners[prize.partnerId] = { id: prize.partnerId, level: 1, exp: 0, dupes: 0 };
            // 初めての相棒は、そのまま連れて行けるようにしておく
            town.activePartner ??= prize.partnerId;
            if (town.activePartner === undefined)
                town.activePartner = prize.partnerId;
        }
        if (!town.activePartner)
            town.activePartner = prize.partnerId;
        return res;
    }
    if (prize.boost) {
        // 上限を超えたぶんは効き目にならないので石に戻す
        if (prize.cap !== undefined && had >= prize.cap) {
            res.refund = DUP_STONES[prize.rarity];
            town.stones = (town.stones ?? 0) + res.refund;
        }
        return res;
    }
    if (prize.itemId) {
        const count = prize.count ?? 1;
        if (!deliver(prize.itemId, count))
            res.lost = count;
    }
    return res;
}
const NO_BOOSTS = {
    keepSlots: 0, known: [], gitan: 0, food: 0, partner: null,
};
/** 加護がまったく効かないダンジョンか */
export const boostsAllowed = (allowBoosts) => allowBoosts !== false;
export function activeBoosts(town, allowBoosts) {
    if (!boostsAllowed(allowBoosts))
        return { ...NO_BOOSTS };
    let keepSlots = BASE_KEEP_SLOTS;
    const known = [];
    let gitan = 0;
    let food = 0;
    for (const [prizeId, rawCount] of Object.entries(town.gachaOwned ?? {})) {
        const prize = tryGetPrize(prizeId);
        if (!prize?.boost)
            continue;
        // 上限を超えたぶんは石に戻してあるので、効き目としては数えない
        const owned = Math.max(0, Math.floor(rawCount));
        const n = prize.cap !== undefined ? Math.min(owned, prize.cap) : owned;
        if (n <= 0)
            continue;
        const b = prize.boost;
        switch (b.t) {
            case 'keepSlot':
                keepSlots += n;
                break;
            case 'known':
                known.push(b.kind);
                break;
            case 'gitan':
                gitan += b.amount * n;
                break;
            case 'food':
                food += b.amount * n;
                break;
        }
    }
    const partnerId = town.activePartner;
    const rec = partnerId ? town.partners?.[partnerId] : undefined;
    return {
        keepSlots: Math.min(MAX_KEEP_SLOTS, keepSlots),
        known,
        gitan,
        food,
        partner: rec && tryGetPartner(rec.id) ? rec : null,
    };
}
/** 持っている相棒の一覧（村の画面用） */
export function ownedPartners(town) {
    return Object.values(town.partners ?? {})
        .filter((r) => !!tryGetPartner(r.id))
        .sort((a, b) => a.id.localeCompare(b.id));
}
//# sourceMappingURL=gacha.js.map