/**
 * ガチャ。石を払って景品を引く。
 *
 * 乱数は Rng（xorshift）を使う。Math.random は使わない。
 * 引いた結果は「景品 id の枚数」としてだけ持ち、効き目はそこから計算する。
 * 効き目を別に持つと、枚数と効き目のどちらかが必ずズレる。
 */
import { Rng } from '../core/rng.js';
import { RARITY_RATE, prizesOf, tryGetPrize, } from '../data/gacha.js';
import { tryGetPartner } from '../data/partners.js';
import { itemsOfKind } from '../data/registry.js';
import { BASE_KEEP_SLOTS, GACHA_COST, GACHA_COST_10, GACHA_EMPTY_GITAN, INVENTORY_LIMIT, MAX_KEEP_SLOTS, } from './rules.js';
/** 10 連の何回目を SR 以上にするか（1 始まり） */
const GUARANTEE_AT = 10;
const RARITIES = ['ssr', 'sr', 'r', 'n'];
export const ownedCount = (town, prizeId) => Math.max(0, Math.floor(town.gachaOwned?.[prizeId] ?? 0));
export const owns = (town, prizeId) => ownedCount(town, prizeId) > 0;
/**
 * まだ出ていない景品。ここがガチャの在庫。
 *
 * 一度出た物を除くので、引くほど在庫が減り、最後は空になる。
 */
export const drawable = (town, rarity) => prizesOf(rarity).filter((p) => !owns(town, p.id));
/** 残っている景品の数 */
export const stockLeft = (town) => RARITIES.reduce((a, r) => a + drawable(town, r).length, 0);
/** 景品の総数（引けるもののみ） */
export const prizeTotal = () => RARITIES.reduce((a, r) => a + prizesOf(r).length, 0);
/**
 * レア度を 1 つ選ぶ。
 *
 * **在庫のある段だけ**を対象にして、その中で確率を比例配分する。
 * 空になった段のぶんは、残っている段へ自動的に配り直される。
 * 空の段を選ぶと引く物が無くなって落ちるので、ここは在庫を見ないといけない。
 */
function rollRarity(town, rng, forceSrUp) {
    const wanted = forceSrUp ? ['ssr', 'sr'] : [...RARITIES];
    const pool = wanted.filter((r) => drawable(town, r).length > 0);
    if (pool.length === 0)
        return null;
    const total = pool.reduce((a, r) => a + RARITY_RATE[r], 0);
    let x = rng.float() * total;
    for (const r of pool) {
        x -= RARITY_RATE[r];
        if (x < 0)
            return r;
    }
    return pool[pool.length - 1];
}
/** その段の在庫から重みで 1 つ選ぶ */
function rollPrize(town, rng, rarity) {
    const list = drawable(town, rarity);
    const total = list.reduce((a, p) => a + p.weight, 0);
    let x = rng.float() * total;
    for (const p of list) {
        x -= p.weight;
        if (x < 0)
            return p;
    }
    return list[list.length - 1];
}
/** 石が足りているか。出るものが尽きていても、ギタンが出るので引ける */
export const canPull = (town, n) => (town.stones ?? 0) >= (n === 10 ? GACHA_COST_10 : GACHA_COST);
export const pullCost = (n) => (n === 10 ? GACHA_COST_10 : GACHA_COST);
/**
 * 引く。石は呼ぶ前ではなくここで引き落とす。
 *
 * 出るものが尽きていたら、1 回につき GACHA_EMPTY_GITAN ギタンを払う。
 * 10 連の途中で尽きたときも 1 回ずつ判定するので、
 * 「景品 3 個 ＋ ギタン 7 回」のような結果になる。
 */
export function pull(town, n) {
    const cost = pullCost(n);
    if ((town.stones ?? 0) < cost)
        return [];
    town.stones = (town.stones ?? 0) - cost;
    // 引くたびに違う結果になり、かつ同じ村・同じ回数なら再現する
    const rng = new Rng(`gacha:${town.playerName}:${town.gachaPulls ?? 0}:${town.stones}`);
    const out = [];
    for (let i = 0; i < n; i++) {
        // 10 連の最後は SR 以上。SR も SSR も在庫が無ければ普通に引く
        const forced = n === 10 && i === GUARANTEE_AT - 1
            && !out.some((r) => r.prize?.rarity === 'ssr' || r.prize?.rarity === 'sr');
        const rarity = rollRarity(town, rng, forced) ?? rollRarity(town, rng, false);
        if (rarity === null) {
            town.gitan += GACHA_EMPTY_GITAN;
            out.push({ prize: null, gitan: GACHA_EMPTY_GITAN });
            continue;
        }
        out.push(grant(town, rollPrize(town, rng, rarity)));
    }
    town.gachaPulls = (town.gachaPulls ?? 0) + n;
    return out;
}
/** 景品 1 つを村に反映する */
function grant(town, prize) {
    town.gachaOwned ??= {};
    town.gachaOwned[prize.id] = 1;
    if (prize.partnerId) {
        town.partners ??= {};
        town.partners[prize.partnerId] ??= { id: prize.partnerId, level: 1, exp: 0 };
        // 初めての相棒は、そのまま連れて行けるようにしておく
        if (!town.activePartner)
            town.activePartner = prize.partnerId;
    }
    return { prize, gitan: 0 };
}
const NO_BOOSTS = {
    keepSlots: 0, knownIds: new Set(), gitan: 0, food: 0,
    bagLimit: INVENTORY_LIMIT, partner: null,
};
/** 加護がまったく効かないダンジョンか */
export const boostsAllowed = (allowBoosts) => allowBoosts !== false;
/**
 * 持っている加護を 1 つずつ見る。
 *
 * 同じ景品は二度と出ないので、枚数は必ず 0 か 1。
 * 効き目は景品 1 枚に畳んであるので、掛け算は要らない。
 */
function eachBoost(town, fn) {
    for (const prizeId of Object.keys(town.gachaOwned ?? {})) {
        if (!owns(town, prizeId))
            continue;
        const prize = tryGetPrize(prizeId);
        if (prize?.boost)
            fn(prize.boost);
    }
}
/**
 * ダンジョンの中で効く加護。
 *
 * ここが加護の唯一の入口。冒険の準備をする側が
 * 「このダンジョンでは効くんだっけ」を自分で判断し始めると、
 * 必ずどこかで判断が食い違う。
 */
export function activeBoosts(town, allowBoosts) {
    if (!boostsAllowed(allowBoosts))
        return { ...NO_BOOSTS, knownIds: new Set() };
    let keepSlots = BASE_KEEP_SLOTS;
    const knownIds = new Set();
    let gitan = 0;
    let food = 0;
    let bagLimit = INVENTORY_LIMIT;
    eachBoost(town, (b) => {
        switch (b.t) {
            case 'keepSlot':
                keepSlots += b.amount;
                break;
            case 'knownItem':
                knownIds.add(b.itemId);
                break;
            // 引けなくなった「種類まるごと」の加護。持っている人のために効かせ続ける
            case 'known':
                for (const d of itemsOfKind(b.kind))
                    knownIds.add(d.id);
                break;
            case 'gitan':
                gitan += b.amount;
                break;
            case 'food':
                food += b.amount;
                break;
            case 'bag':
                bagLimit += b.amount;
                break;
            // 村の設備。ダンジョンには関係しない
            case 'storage':
            case 'shopSlot': break;
        }
    });
    const partnerId = town.activePartner;
    const rec = partnerId ? town.partners?.[partnerId] : undefined;
    return {
        keepSlots: Math.min(MAX_KEEP_SLOTS, keepSlots),
        knownIds,
        gitan,
        food,
        bagLimit,
        partner: rec && tryGetPartner(rec.id) ? rec : null,
    };
}
/**
 * 村に残る効き目。
 *
 * ダンジョンを引数に取らないので、加護なしダンジョンで消える事故が起きない。
 * 倉庫や道具屋は村の設備であって、ダンジョンの中の加護ではない。
 */
export function townBoosts(town) {
    let storage = 0;
    let shopSlots = 0;
    eachBoost(town, (b) => {
        if (b.t === 'storage')
            storage += b.amount;
        else if (b.t === 'shopSlot')
            shopSlots += b.amount;
    });
    return { storage, shopSlots };
}
/** 持っている相棒の一覧（村の画面用） */
export function ownedPartners(town) {
    return Object.values(town.partners ?? {})
        .filter((r) => !!tryGetPartner(r.id))
        .sort((a, b) => a.id.localeCompare(b.id));
}
//# sourceMappingURL=gacha.js.map