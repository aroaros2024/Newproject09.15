/**
 * ガチャ。石を払って景品を引く。
 *
 * 乱数は Rng（xorshift）を使う。Math.random は使わない。
 * 引いた結果は「景品 id の枚数」としてだけ持ち、効き目はそこから計算する。
 * 効き目を別に持つと、枚数と効き目のどちらかが必ずズレる。
 */

import { Rng } from '../core/rng.js';
import type { Charm, PartnerRecord, TownState } from '../core/types.js';
import {
  type BoostKind, type GachaPrize, RARITY_RATE, type Rarity, prizesOf, tryGetPrize,
} from '../data/gacha.js';
import { tryGetPartner } from '../data/partners.js';
import { CHARM_BOX_LIMIT } from '../data/charms.js';
import { charmScore, rollCharm } from './charm.js';
import { itemsOfKind } from '../data/registry.js';
import {
  BASE_KEEP_SLOTS, GACHA_COST, GACHA_COST_10, GACHA_EMPTY_GITAN,
  INVENTORY_LIMIT, MAX_KEEP_SLOTS,
} from './rules.js';

/** 10 連の何回目を SR 以上にするか（1 始まり） */
const GUARANTEE_AT = 10;

const RARITIES: readonly Rarity[] = ['ssr', 'sr', 'r', 'n'];

/** 護石が出る段。SSR と SR は相棒と加護のままにしてある */
const CHARM_RARITIES: readonly Rarity[] = ['n', 'r'];

/**
 * その段のうち、護石が占める割合。
 *
 * 残り半分は表の景品（道具の知識）。表が尽きた段は全部が護石になる。
 * 「N と R は半分が護石」と 1 文で言い切れる形にしてある。
 */
export const CHARM_SHARE = 0.5;

/**
 * 1 回ぶんの結果。
 *
 * 表の景品・護石・ギタンのどれか 1 つ。
 * 表の景品は二度と出ないので「重複」という結果は存在しない。
 * 護石は毎回その場で作るので、こちらも同じものは出ない。
 */
export interface PullResult {
  /** 出た景品。護石かギタンなら null */
  prize: GachaPrize | null;
  /** 出た護石。表の景品かギタンなら null */
  charm: Charm | null;
  /** 演出に使うレア度。ギタンなら null */
  rarity: Rarity | null;
  /** 出るものが尽きていたときに出たギタン */
  gitan: number;
}

export const ownedCount = (town: TownState, prizeId: string): number =>
  Math.max(0, Math.floor(town.gachaOwned?.[prizeId] ?? 0));

export const owns = (town: TownState, prizeId: string): boolean =>
  ownedCount(town, prizeId) > 0;

/**
 * まだ出ていない景品。ここがガチャの在庫。
 *
 * 一度出た物を除くので、引くほど在庫が減り、最後は空になる。
 */
export const drawable = (town: TownState, rarity: Rarity): GachaPrize[] =>
  prizesOf(rarity).filter((p) => !owns(town, p.id));

/** 残っている表の景品の数。護石は数に入らない（尽きないので） */
export const stockLeft = (town: TownState): number =>
  RARITIES.reduce((a, r) => a + drawable(town, r).length, 0);

/** 表の景品の総数（引けるもののみ）。護石は数に入らない */
export const prizeTotal = (): number =>
  RARITIES.reduce((a, r) => a + prizesOf(r).length, 0);

/** 護石の箱に空きがあるか。満杯のあいだ護石は出ない */
export const charmRoom = (town: TownState): number =>
  Math.max(0, CHARM_BOX_LIMIT - (town.charms?.length ?? 0));

/** その段に護石が出るか */
const charmTier = (r: Rarity): boolean => CHARM_RARITIES.includes(r);

/** 次の護石の番号。護石どうしでしか比べないので、村の中で一意ならよい */
function nextCharmUid(town: TownState): number {
  let max = 0;
  for (const c of town.charms ?? []) max = Math.max(max, c.uid);
  return max + 1;
}

/**
 * レア度を 1 つ選ぶ。
 *
 * **在庫のある段だけ**を対象にして、その中で確率を比例配分する。
 * 空になった段のぶんは、残っている段へ自動的に配り直される。
 * 空の段を選ぶと引く物が無くなって落ちるので、ここは在庫を見ないといけない。
 */
function rollRarity(town: TownState, rng: Rng, forceSrUp: boolean): Rarity | null {
  const wanted: Rarity[] = forceSrUp ? ['ssr', 'sr'] : [...RARITIES];
  const pool = wanted.filter((r) => drawable(town, r).length > 0
    || (charmTier(r) && charmRoom(town) > 0));
  if (pool.length === 0) return null;
  const total = pool.reduce((a, r) => a + RARITY_RATE[r], 0);
  let x = rng.float() * total;
  for (const r of pool) {
    x -= RARITY_RATE[r];
    if (x < 0) return r;
  }
  return pool[pool.length - 1];
}

/** その段の在庫から重みで 1 つ選ぶ */
function rollPrize(town: TownState, rng: Rng, rarity: Rarity): GachaPrize {
  const list = drawable(town, rarity);
  const total = list.reduce((a, p) => a + p.weight, 0);
  let x = rng.float() * total;
  for (const p of list) {
    x -= p.weight;
    if (x < 0) return p;
  }
  return list[list.length - 1];
}

/** 石が足りているか。出るものが尽きていても、ギタンが出るので引ける */
export const canPull = (town: TownState, n: 1 | 10): boolean =>
  (town.stones ?? 0) >= (n === 10 ? GACHA_COST_10 : GACHA_COST);

export const pullCost = (n: 1 | 10): number => (n === 10 ? GACHA_COST_10 : GACHA_COST);

/**
 * その段で護石を出すか。
 *
 * 表の景品が残っていれば半々。尽きた段は全部が護石になる。
 * 護石の箱が満杯なら出さない（引いた護石を失う事故を作らないため）。
 */
function wantsCharm(town: TownState, rng: Rng, rarity: Rarity): boolean {
  if (!charmTier(rarity) || charmRoom(town) <= 0) return false;
  if (drawable(town, rarity).length === 0) return true;
  return rng.chance(CHARM_SHARE);
}

/**
 * 引く。石は呼ぶ前ではなくここで引き落とす。
 *
 * 出るものが尽きていたら、1 回につき GACHA_EMPTY_GITAN ギタンを払う。
 * 護石は在庫が尽きないので、ここに来るのは
 * 「護石の箱が満杯で、かつ表の景品も集めきった」ときだけ。
 */
export function pull(town: TownState, n: 1 | 10): PullResult[] {
  const cost = pullCost(n);
  if ((town.stones ?? 0) < cost) return [];
  town.stones = (town.stones ?? 0) - cost;

  // 引くたびに違う結果になり、かつ同じ村・同じ回数なら再現する
  const rng = new Rng(`gacha:${town.playerName}:${town.gachaPulls ?? 0}:${town.stones}`);
  const out: PullResult[] = [];
  for (let i = 0; i < n; i++) {
    // 10 連の最後は SR 以上。SR も SSR も在庫が無ければ普通に引く。
    // 護石は N と R にしか出ないので、この確定枠は相棒と加護のまま残る
    const forced = n === 10 && i === GUARANTEE_AT - 1
      && !out.some((r) => r.rarity === 'ssr' || r.rarity === 'sr');
    const rarity = rollRarity(town, rng, forced) ?? rollRarity(town, rng, false);
    if (rarity === null) {
      town.gitan += GACHA_EMPTY_GITAN;
      out.push({ prize: null, charm: null, rarity: null, gitan: GACHA_EMPTY_GITAN });
      continue;
    }
    out.push(wantsCharm(town, rng, rarity)
      ? grantCharm(town, rng, rarity as 'n' | 'r')
      : grant(town, rollPrize(town, rng, rarity)));
  }
  town.gachaPulls = (town.gachaPulls ?? 0) + n;
  return out;
}

/** 景品 1 つを村に反映する */
function grant(town: TownState, prize: GachaPrize): PullResult {
  town.gachaOwned ??= {};
  town.gachaOwned[prize.id] = 1;

  if (prize.partnerId) {
    town.partners ??= {};
    town.partners[prize.partnerId] ??= { id: prize.partnerId, level: 1, exp: 0 };
    // 初めての相棒は、そのまま連れて行けるようにしておく
    if (!town.activePartner) town.activePartner = prize.partnerId;
  }
  return { prize, charm: null, rarity: prize.rarity, gitan: 0 };
}

/**
 * 護石を 1 つ作って箱に入れる。
 *
 * gachaOwned には入れない。護石は在庫が尽きないので、
 * id を記録していくとセーブが際限なく膨らむ。
 */
function grantCharm(town: TownState, rng: Rng, rarity: 'n' | 'r'): PullResult {
  town.charms ??= [];
  const charm = rollCharm(rng, rarity, nextCharmUid(town));
  town.charms.push(charm);
  // 初めての護石は、そのまま着けておく
  if (town.activeCharm === undefined || town.activeCharm === null) {
    town.activeCharm = charm.uid;
  }
  return { prize: null, charm, rarity, gitan: 0 };
}

// ---------------------------------------------------------------------------
// 加護
// ---------------------------------------------------------------------------

/**
 * そのダンジョンで効いている加護。
 *
 * ここが加護の唯一の入口。冒険の準備をする側が
 * 「このダンジョンでは効くんだっけ」を自分で判断し始めると、
 * 必ずどこかで判断が食い違う。
 */
export interface Boosts {
  /** 保持枠の数 */
  keepSlots: number;
  /** 最初から識別済みになる道具の defId */
  knownIds: ReadonlySet<string>;
  /** 出発時に増えるギタン（持ち込み可のダンジョンのみ） */
  gitan: number;
  /** 最大満腹度の上乗せ */
  food: number;
  /** 持ち物の上限 */
  bagLimit: number;
  /** 連れて行く相棒。連れて行かないなら null */
  partner: PartnerRecord | null;
  /** 着けている護石。着けていないなら null */
  charm: Charm | null;
}

const NO_BOOSTS: Boosts = {
  keepSlots: 0, knownIds: new Set(), gitan: 0, food: 0,
  bagLimit: INVENTORY_LIMIT, partner: null, charm: null,
};

/** 村に残る効き目。ダンジョンの中の話ではないので、加護なしでも効く */
export interface TownBoosts {
  /** 倉庫の上乗せ */
  storage: number;
  /** 村の道具屋に並ぶ数の上乗せ */
  shopSlots: number;
}

/** 加護がまったく効かないダンジョンか */
export const boostsAllowed = (allowBoosts: boolean | undefined): boolean =>
  allowBoosts !== false;

/**
 * 持っている加護を 1 つずつ見る。
 *
 * 同じ景品は二度と出ないので、枚数は必ず 0 か 1。
 * 効き目は景品 1 枚に畳んであるので、掛け算は要らない。
 */
function eachBoost(town: TownState, fn: (b: BoostKind) => void): void {
  for (const prizeId of Object.keys(town.gachaOwned ?? {})) {
    if (!owns(town, prizeId)) continue;
    const prize = tryGetPrize(prizeId);
    if (prize?.boost) fn(prize.boost);
  }
}

/**
 * ダンジョンの中で効く加護。
 *
 * ここが加護の唯一の入口。冒険の準備をする側が
 * 「このダンジョンでは効くんだっけ」を自分で判断し始めると、
 * 必ずどこかで判断が食い違う。
 */
export function activeBoosts(town: TownState, allowBoosts: boolean | undefined): Boosts {
  if (!boostsAllowed(allowBoosts)) return { ...NO_BOOSTS, knownIds: new Set() };

  let keepSlots = BASE_KEEP_SLOTS;
  const knownIds = new Set<string>();
  let gitan = 0;
  let food = 0;
  let bagLimit = INVENTORY_LIMIT;

  eachBoost(town, (b) => {
    switch (b.t) {
      case 'keepSlot': keepSlots += b.amount; break;
      case 'knownItem': knownIds.add(b.itemId); break;
      // 引けなくなった「種類まるごと」の加護。持っている人のために効かせ続ける
      case 'known': for (const d of itemsOfKind(b.kind)) knownIds.add(d.id); break;
      case 'gitan': gitan += b.amount; break;
      case 'food': food += b.amount; break;
      case 'bag': bagLimit += b.amount; break;
      // 村の設備。ダンジョンには関係しない
      case 'storage': case 'shopSlot': break;
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
    charm: activeCharm(town),
  };
}

/**
 * 村に残る効き目。
 *
 * ダンジョンを引数に取らないので、加護なしダンジョンで消える事故が起きない。
 * 倉庫や道具屋は村の設備であって、ダンジョンの中の加護ではない。
 */
export function townBoosts(town: TownState): TownBoosts {
  let storage = 0;
  let shopSlots = 0;
  eachBoost(town, (b) => {
    if (b.t === 'storage') storage += b.amount;
    else if (b.t === 'shopSlot') shopSlots += b.amount;
  });
  return { storage, shopSlots };
}

/**
 * 着けている護石。無ければ null。
 *
 * 加護の入口（activeBoosts）の外からも村の画面が引くので、別に出してある。
 * ここは村の話なので、ダンジョンの allowBoosts は見ない。
 */
export function activeCharm(town: TownState): Charm | null {
  const uid = town.activeCharm;
  if (uid === undefined || uid === null) return null;
  return (town.charms ?? []).find((c) => c.uid === uid) ?? null;
}

/**
 * 持っている護石の一覧。着けているものが先頭、あとは強い順。
 *
 * 30 個を目で比べられないと厳選がただの作業になるので、並べ替えは要る。
 */
export function ownedCharms(town: TownState): Charm[] {
  const worn = town.activeCharm;
  return [...(town.charms ?? [])].sort((a, b) => {
    if (a.uid === worn) return -1;
    if (b.uid === worn) return 1;
    return charmScore(b) - charmScore(a);
  });
}

/** 持っている相棒の一覧（村の画面用） */
export function ownedPartners(town: TownState): PartnerRecord[] {
  return Object.values(town.partners ?? {})
    .filter((r) => !!tryGetPartner(r.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
