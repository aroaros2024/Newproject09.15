/**
 * コアルールの数値と計算式。
 *
 * ここは「純粋な計算」だけを置く場所。状態を書き換える処理は
 * combat.ts / status.ts / hunger.ts 側にある。
 * すべての定数をここに集めているので、バランス調整はこのファイルで完結する。
 */

import type { Rng } from '../core/rng.js';

// ===========================================================================
// 初期値
// ===========================================================================

export const START_LEVEL = 1;
export const START_HP = 15;
export const START_STR = 8;
export const MAX_LEVEL = 99;
export const MAX_HP_CAP = 999;
export const MAX_STR_CAP = 99;
export const MAX_EXP = 999_999_999;

/** 満腹度は 1/10 単位の整数で持つ */
export const START_FOOD_X10 = 1000;
export const FOOD_CAP_X10 = 1500;

/** 持ち物の上限 */
export const INVENTORY_LIMIT = 20;

/** 装備の修正値の範囲 */
export const PLUS_MIN = -99;
export const PLUS_MAX = 99;

/** 店の売値は買値の何割か */
export const SELL_RATE = 0.5;
/** 店に売りつける時のレート（プレイヤーが売る） */
export const SHOP_BUYBACK_RATE = 0.4;

// ===========================================================================
// 経験値
// ===========================================================================

/**
 * EXP_TABLE[L] = レベル L に到達するのに必要な累積経験値。
 * TotalExp(L) = floor(0.9(L-1)^3 + 4.5(L-1)^2 + 4.6(L-1))
 */
export const EXP_TABLE: readonly number[] = (() => {
  const t = new Array<number>(MAX_LEVEL + 1).fill(0);
  for (let level = 2; level <= MAX_LEVEL; level++) {
    const n = level - 1;
    t[level] = Math.floor(0.9 * n * n * n + 4.5 * n * n + 4.6 * n);
  }
  return t;
})();

/** レベル L から L+1 に上がった時の最大 HP の上昇量 */
export const hpGainForLevel = (level: number): number => 4 + Math.floor(level / 10);

/** 累積経験値からレベルを求める（ドレイン後の整合取りに使う） */
export function levelForExp(exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && exp >= EXP_TABLE[level + 1]) level++;
  return level;
}

/** そのレベルでの最大 HP（初期値から積み上げた理論値） */
export function baseMaxHpAt(level: number): number {
  let hp = START_HP;
  for (let l = 1; l < level; l++) hp = Math.min(MAX_HP_CAP, hp + hpGainForLevel(l));
  return hp;
}

/** 次のレベルまでの必要経験値。最大レベルなら 0 */
export function expToNext(level: number, exp: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.max(0, EXP_TABLE[level + 1] - exp);
}

// ===========================================================================
// ダメージ
// ===========================================================================

/**
 * (15/16)^DEF の事前計算テーブル。
 * Math.pow を毎回呼ぶと丸め誤差が乗るので、積み上げた値を固定で持つ。
 */
const DEF_MUL: readonly number[] = (() => {
  const t = new Array<number>(256);
  let v = 1;
  for (let i = 0; i < 256; i++) {
    t[i] = v;
    v *= 15 / 16;
  }
  return t;
})();

/** 防御力に対する減衰倍率 */
export function defenseMultiplier(def: number): number {
  const d = Math.min(255, Math.max(0, def | 0));
  return DEF_MUL[d];
}

/**
 * 基本ダメージ式。
 *   Damage = floor( ATK * (15/16)^DEF * r )、r は 112/128 〜 143/128
 * 最低 1 ダメージは保証する。
 */
export function calcDamage(atk: number, def: number, rng: Rng): number {
  const base = atk * defenseMultiplier(def);
  const r = rng.range(112, 143) / 128;
  return Math.max(1, Math.floor(base * r));
}

/** 乱数を使わない期待値（表示・デバッグ用） */
export const expectedDamage = (atk: number, def: number): number =>
  Math.max(1, Math.floor(atk * defenseMultiplier(def)));

/** 基本命中率 */
export const BASE_HIT = 0.92;
/** 投擲の基本命中率 */
export const THROW_HIT = 0.85;
/** めつぶし状態の命中率補正 */
export const BLIND_ACC_PENALTY = -0.25;
/** 透明な相手への回避補正 */
export const INVISIBLE_EVADE_BONUS = 0.5;

export function hitRate(baseAcc: number, accBonus: number, evade: number): number {
  const v = baseAcc + accBonus - evade;
  return v < 0.05 ? 0.05 : v > 1 ? 1 : v;
}

/** プレイヤーの基本会心率 1/16 */
export const PLAYER_CRIT_RATE = 1 / 16;
/** モンスターの基本痛恨率 1/32 */
export const MONSTER_CRIT_RATE = 1 / 32;
/** 会心の印 1 つあたりの上昇量と上限 */
export const CRIT_RUNE_STEP = 1 / 16;
export const CRIT_RATE_CAP = 8 / 16;

/** メタル系が受けるダメージの固定減算 */
export const METAL_DAMAGE_REDUCTION = 20;

/** 気絶中に受けるダメージの倍率 */
export const FAINT_DAMAGE_MUL = 1.5;

// ===========================================================================
// HP 自然回復
// ===========================================================================

/**
 * 1 ターンあたりの回復量（1/1000 単位）。
 * 除数はレベルが上がるほど小さくなる（＝回復が速くなる）。
 */
export function regenPerTurnX1000(maxHp: number, level: number, mul = 1): number {
  const div = Math.max(50, 150 - level);
  return Math.floor(Math.floor((maxHp * 1000) / div) * mul);
}

/** 回復の腕輪の倍率 */
export const REGEN_BRACELET_MUL = 3;

// ===========================================================================
// 満腹度
// ===========================================================================

/** 1 ターンの基本減少量（1/10 単位）。100 → 0 まで 1000 ターン */
export const HUNGER_DRAIN_BASE = 1;
/** 合成後の減少量の上限 */
export const HUNGER_DRAIN_CAP = 6;
/** 満腹度 0 のときの毎ターン HP 減少 */
export const STARVE_DAMAGE = 1;

/** 警告メッセージを出す閾値（1/10 単位） */
export const HUNGER_WARN_X10 = 200;
export const HUNGER_CRITICAL_X10 = 100;

// ===========================================================================
// 状態異常の持続ターン
// ===========================================================================

/** 状態異常ごとの [最小, 最大] 持続ターン */
export const STATUS_DURATION: Record<string, [number, number]> = {
  confused: [10, 15],
  blind: [15, 20],
  asleep: [5, 10],
  deepAsleep: [10, 15],
  bound: [10, 20],
  paralyzed: [5, 10],
  fainted: [3, 8],
  poisoned: [20, 20],
  deadlyPoisoned: [30, 30],
  burning: [10, 10],
  wet: [20, 20],
  slow: [30, 30],
  quick: [30, 30],
  invisible: [20, 20],
  sealed: [30, 30],
  hungryFast: [50, 50],
  strUp: [100, 100],
  trapped: [99, 99],
  levitate: [30, 30],
  terrified: [8, 12],
};

/** 混乱時に方向が狂う確率 */
export const CONFUSE_MISDIRECT_RATE = 5 / 8;
/** トラばさみから自力脱出できる確率 */
export const TRAPPED_ESCAPE_RATE = 1 / 3;
/** 猛毒の毎ターンダメージ */
export const DEADLY_POISON_DAMAGE = 2;
/** 火傷の毎ターンダメージ */
export const BURN_DAMAGE = 3;
/** 透明な相手に隣接した敵が攻撃してくる確率 */
export const INVISIBLE_ATTACK_RATE = 0.5;

// ===========================================================================
// フロア進行
// ===========================================================================

/** 不定の風が吹き始めるまでの既定ターン数 */
export const WIND_DEFAULT_TURNS = 1000;
/** 風が吹き始めてから強制移動までの猶予 */
export const WIND_GRACE_TURNS = 30;

/** モンスターハウスの発生率を階層から求める(%) */
export function monsterHouseRate(base: number, depth: number, maxDepth: number): number {
  const progress = maxDepth > 1 ? (depth - 1) / (maxDepth - 1) : 0;
  return Math.min(35, base + progress * base);
}

/** ギタンを投げた時のダメージ */
export const gitanThrowDamage = (amount: number): number =>
  Math.max(1, Math.floor(amount / 10));

/** 床に落ちているギタンの額を階層から決める */
export function gitanAmount(depth: number, rng: Rng): number {
  const base = 10 + depth * 12;
  return Math.max(1, Math.floor(rng.range(base >> 1, base * 2) / 5) * 5);
}
