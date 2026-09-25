/**
 * 座標のハッシュ。絵の中の「ばらつき」（床の模様・飾りの置き場所・コマの位相）はこれで決める。
 *
 * ゲームの乱数（world.rng）は絶対に使わない。使うと絵を描いただけでゲームの結果が変わる。
 * 同じ座標と種からは必ず同じ値が出るので、描き直しても同じ絵になる。
 */

/** 32bit の整数ハッシュ（符号なし） */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 0 以上 1 未満 */
export const hashFloat = (x: number, y: number, seed = 0): number => hash2(x, y, seed) / 4294967296;

/** 0 以上 n 未満の整数 */
export const hashInt = (x: number, y: number, seed: number, n: number): number =>
  n <= 0 ? 0 : hash2(x, y, seed) % n;

/** 文字列を種にする（テーマ名・飾りの名前から別の並びを作る） */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}
