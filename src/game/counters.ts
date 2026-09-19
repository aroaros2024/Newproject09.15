/**
 * ミッション用のカウンタ。
 *
 * 数え方をここ 1 箇所に集める。呼ぶ側が自分で `tally[k] = (tally[k] ?? 0) + 1`
 * と書き始めると、必ずどこかで数え方が食い違う。
 *
 * キーはセーブに載る。配布後に改名すると全員の進捗が 0 に戻るので、
 * 一度決めた文字列は変えないこと。
 */

import type { Action } from '../core/types.js';

/**
 * 数えられるものの型。
 *
 * string にしておくと 'pickUp' と打ち間違えても tsc が通り、
 * ミッションが永久に 0 のまま黙る。型で落ちるようにしておく。
 */
export type MissionKey =
  /** 敵の種類ごとの撃破数。`kill` も自動で足る */
  | `kill:${string}`
  /** 踏んだワナの種類ごと。`trap` も自動で足る */
  | `trap:${string}`
  /** 装備した道具の種類ごと。`equip` も自動で足る */
  | `equip:${string}`
  /**
   * 前と違う品目に持ち替えた種類ごと。`swapGear` も自動で足る。
   *
   * equip は着け直しでも増えるので、「拾った物と比べて替えた」を
   * 数えたいときはこちらを見る。
   */
  | `swapGear:${string}`
  /** 使った道具の種類ごと。`use` も自動で足る */
  | `use:${string}`
  /** 使ったコマンドの種類ごと。`act` も自動で足る */
  | `act:${Action['type']}`
  | 'kill' | 'trap' | 'equip' | 'swapGear' | 'use' | 'act'
  | 'walk' | 'pickup' | 'descend'
  | 'cure:curse' | 'synthesis' | 'makeAlly' | 'buy' | 'keep'
  | 'shortcut' | 'potPut' | 'shopBuy'
  /** モンスターハウスに踏み込んだ */
  | 'house'
  /** 店で 代金を 払わずに 出た */
  | 'steal'
  /** 倉庫の道具を 冒険へ 持ち込んだ */
  | 'bring'
  /** 道具を 売った（村でも ダンジョンの店でも） */
  | 'sell'
  /** 投げて 相手に 当てた */
  | 'throwHit'
  /** 壺から 道具を 取り出した */
  | 'potTake';

/**
 * 「最大値」で覚えるものの型。
 *
 * レベルのような到達値は足してはいけない。`tally('level', 30)` を
 * 冒険のたびに足すと、2 周目で「レベル 30 到達」が勝手に達成される。
 */
export type MaxKey =
  /** プレイヤーのレベル */
  | 'level'
  /** 最も強く鍛えた装備の修正値 */
  | 'plus'
  /** 1 つの装備に埋めた印の数 */
  | 'runes'
  /** 1 回の冒険での撃破数 */
  | 'killsInRun'
  /** 一度に持ったギタン */
  | 'gitan'
  /** 銀行の預り高 */
  | 'bankGitan'
  /** 1 回の冒険で降りた階数 */
  | 'depth';

/** 最大値キーの接頭辞。合流のときにここで足し算と最大値を分ける */
export const MAX_PREFIX = 'max:';

/** 1 つのキーの上限。壊れたセーブで無限大が入ると全ミッションが一斉に達成になる */
export const TALLY_CAP = 1_000_000_000;

/**
 * 数える。
 *
 * `kill:ratField` のように「:」を含むキーを足すと、接頭辞の `kill` も自動で足る。
 * 呼ぶ側が総数と内訳の 2 行を並べて書かなくてよくなるので、
 * 片方だけ書き忘れる形が無くなる。
 */
export function addTally(
  store: Record<string, number>, key: MissionKey, n = 1,
): void {
  if (!Number.isFinite(n) || n <= 0) return;
  // 最大値キーは足してはいけない。型で防いであるが、
  // セーブ由来の文字列がここに来る道が将来できたときの保険
  if (key.startsWith(MAX_PREFIX)) return;
  const amount = Math.floor(n);
  const add = (k: string): void => {
    store[k] = Math.min(TALLY_CAP, (store[k] ?? 0) + amount);
  };
  add(key);
  const i = key.indexOf(':');
  if (i > 0) add(key.slice(0, i));
}

/** 読む。壊れた値が入っていても 0 として扱う */
export function counted(
  tally: Record<string, number> | undefined, key: string,
): number {
  const v = tally?.[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * セーブから読んだ数えを直す。
 *
 * 配列・文字列・負の数・無限大が入っていても、ここで無害な形にする。
 * 直さないと「数えるたびに文字列が連結されて永久に達成しない」
 * 「無限大が入っていて全部達成済みになる」といった壊れ方をする。
 */
export function sanitizeTally(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || k.length === 0) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    out[k] = Math.min(TALLY_CAP, Math.floor(v));
  }
  return out;
}

/** 最大値で覚える。足さずに、これまでの最大とくらべて大きい方を残す */
export function maxTally(
  store: Record<string, number>, key: MaxKey, value: number,
): void {
  if (!Number.isFinite(value) || value <= 0) return;
  const k = MAX_PREFIX + key;
  const v = Math.min(TALLY_CAP, Math.floor(value));
  if (v > (store[k] ?? 0)) store[k] = v;
}

/**
 * 冒険ぶんの数えを村へ移す。
 *
 * `max:` だけは最大値、それ以外は加算。ここを 1 箇所にしておかないと、
 * 合流の分岐を書き忘れてレベル到達が勝手に達成される。
 *
 * 接頭辞の集計（`kill` と `kill:xxx`）は src 側に既に両方入っているので、
 * ここでは addTally を使わず素直に足すこと。二重に集計される。
 */
export function mergeTally(
  dst: Record<string, number>, src: Record<string, number>,
): void {
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    dst[k] = k.startsWith(MAX_PREFIX)
      ? Math.max(dst[k] ?? 0, Math.min(TALLY_CAP, Math.floor(v)))
      : Math.min(TALLY_CAP, (dst[k] ?? 0) + Math.floor(v));
  }
}
