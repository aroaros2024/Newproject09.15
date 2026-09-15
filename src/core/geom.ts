/**
 * 座標・方向まわりの基礎ユーティリティ。
 *
 * 不思議のダンジョンは 8 方向グリッド。方向は 0=北 から時計回りに 8 分割した
 * 整数（Dir）で表す。この番号付けはセーブデータにも載るので変更しないこと。
 *
 *        7  0  1
 *         ＼│／
 *        6 ─＋─ 2
 *         ／│＼
 *        5  4  3
 */

export interface Point {
  x: number;
  y: number;
}

/** 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DIRS: readonly Dir[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** 上下左右の 4 方向のみ */
export const ORTHO_DIRS: readonly Dir[] = [0, 2, 4, 6];

/** 斜めの 4 方向のみ */
export const DIAGONAL_DIRS: readonly Dir[] = [1, 3, 5, 7];

/** Dir → 単位ベクトル。画面座標系なので y は下が正 */
export const DIR_VEC: readonly Point[] = [
  { x: 0, y: -1 }, // 0 N
  { x: 1, y: -1 }, // 1 NE
  { x: 1, y: 0 }, // 2 E
  { x: 1, y: 1 }, // 3 SE
  { x: 0, y: 1 }, // 4 S
  { x: -1, y: 1 }, // 5 SW
  { x: -1, y: 0 }, // 6 W
  { x: -1, y: -1 }, // 7 NW
];

/** 日本語の方向名（メッセージ用） */
export const DIR_NAME: readonly string[] = [
  '北', '北東', '東', '南東', '南', '南西', '西', '北西',
];

export const isDiagonal = (d: Dir): boolean => (d & 1) === 1;

/** 方向を n ステップ回す（正で時計回り） */
export const rotateDir = (d: Dir, steps: number): Dir =>
  (((d + steps) % 8) + 8) % 8 as Dir;

export const oppositeDir = (d: Dir): Dir => rotateDir(d, 4);

/** 2 方向のなす角（0〜4、単位は 45 度） */
export function dirDistance(a: Dir, b: Dir): number {
  const d = Math.abs(a - b) % 8;
  return d > 4 ? 8 - d : d;
}

/** ベクトルから最も近い Dir を求める。ゼロベクトルは null */
export function vecToDir(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === 0) return null;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // 45 度から大きくずれている場合は軸方向へ寄せる
  let ux = sx;
  let uy = sy;
  if (ax > ay * 2) uy = 0;
  else if (ay > ax * 2) ux = 0;
  for (let i = 0; i < 8; i++) {
    const v = DIR_VEC[i];
    if (v.x === ux && v.y === uy) return i as Dir;
  }
  return null;
}

/** from から to への方向（同じ座標なら null） */
export const dirTo = (from: Point, to: Point): Dir | null =>
  vecToDir(to.x - from.x, to.y - from.y);

/** p を dir に n マス進めた座標 */
export function step(p: Point, dir: Dir, n = 1): Point {
  const v = DIR_VEC[dir];
  return { x: p.x + v.x * n, y: p.y + v.y * n };
}

/** チェビシェフ距離（8 方向移動での歩数） */
export const chebyshev = (a: Point, b: Point): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** マンハッタン距離 */
export const manhattan = (a: Point, b: Point): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** ユークリッド距離の 2 乗（平方根を避けたい比較用） */
export const distSq = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** 隣接しているか（自分自身は false） */
export const isAdjacent = (a: Point, b: Point): boolean =>
  !samePoint(a, b) && chebyshev(a, b) === 1;

/** a から b が 8 方向のいずれかの直線上にあるか */
export function isOnRay(a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return false;
  return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
}

/** a を含まず b までの 8 方向直線上の座標列（直線上にないときは空） */
export function rayPoints(a: Point, b: Point): Point[] {
  if (!isOnRay(a, b)) return [];
  const d = dirTo(a, b);
  if (d === null) return [];
  const n = chebyshev(a, b);
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) out.push(step(a, d, i));
  return out;
}

/** 矩形。x,y は左上、w,h はサイズ */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectRight = (r: Rect): number => r.x + r.w - 1;
export const rectBottom = (r: Rect): number => r.y + r.h - 1;

export const rectContains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.y >= r.y && p.x <= rectRight(r) && p.y <= rectBottom(r);

export const rectCenter = (r: Rect): Point => ({
  x: r.x + (r.w >> 1),
  y: r.y + (r.h >> 1),
});

/**
 * 2 つの矩形が重なるか。
 *
 * `margin` は「この矩形の間に最低これだけ空きマスが欲しい」という値。
 * 空きが margin マス以上あれば false（＝十分離れている）を返す。
 *   例: a.right=2, b.left=4（間に 1 マスの空き）のとき
 *       margin=1 → false（1 マス空いているので OK）
 *       margin=2 → true （2 マスは空いていないので近すぎる）
 */
export function rectOverlaps(a: Rect, b: Rect, margin = 0): boolean {
  return !(
    rectRight(a) + margin < b.x ||
    rectRight(b) + margin < a.x ||
    rectBottom(a) + margin < b.y ||
    rectBottom(b) + margin < a.y
  );
}

/** 矩形内の全座標を列挙 */
export function* rectPoints(r: Rect): Generator<Point> {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) yield { x, y };
  }
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** 座標をマップ幅 w のインデックスへ */
export const idxOf = (x: number, y: number, w: number): number => y * w + x;
