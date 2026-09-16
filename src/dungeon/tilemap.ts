/**
 * FloorMap への読み書きヘルパ。
 * 生成・AI・描画のすべてがここ経由でタイルを触る。
 */

import { type Point, type Rect, chebyshev, idxOf, rectContains } from '../core/geom.js';
import type { FloorMap, MoveType, Room, Tile, TileKind } from '../core/types.js';

export function makeTile(kind: TileKind = 'wall'): Tile {
  return {
    kind,
    hard: false,
    roomId: -1,
    isDoor: false,
    explored: false,
    visible: false,
    trap: null,
    shop: false,
  };
}

/** 全面を壁で埋めた空のフロアを作る */
export function createMap(width: number, height: number): FloorMap {
  const tiles: Tile[] = new Array(width * height);
  for (let i = 0; i < tiles.length; i++) tiles[i] = makeTile('wall');
  // 外周は掘れない壁にする
  for (let x = 0; x < width; x++) {
    tiles[idxOf(x, 0, width)].hard = true;
    tiles[idxOf(x, height - 1, width)].hard = true;
  }
  for (let y = 0; y < height; y++) {
    tiles[idxOf(0, y, width)].hard = true;
    tiles[idxOf(width - 1, y, width)].hard = true;
  }
  return {
    width,
    height,
    tiles,
    rooms: [],
    stairs: { x: -1, y: -1 },
    seed: 0,
    bigRoom: false,
  };
}

export const inBounds = (map: FloorMap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.width && y < map.height;

/** 範囲外は undefined を返す。呼び出し側で必ず確認すること */
export function at(map: FloorMap, x: number, y: number): Tile | undefined {
  if (!inBounds(map, x, y)) return undefined;
  return map.tiles[idxOf(x, y, map.width)];
}

export const tileAt = (map: FloorMap, p: Point): Tile | undefined => at(map, p.x, p.y);

/** 範囲外なら「掘れない壁」を返す。境界チェックを省きたい所で使う */
const OUT_OF_BOUNDS: Tile = Object.freeze({
  kind: 'wall' as TileKind, hard: true, roomId: -1, isDoor: false,
  explored: false, visible: false, trap: null, shop: false,
});

export function tileOr(map: FloorMap, x: number, y: number): Tile {
  return at(map, x, y) ?? OUT_OF_BOUNDS;
}

export function setKind(map: FloorMap, x: number, y: number, kind: TileKind): void {
  const t = at(map, x, y);
  if (t && !t.hard) t.kind = kind;
}

/** 壁でないか（床・水・溶岩・階段・落とし穴） */
export const isOpen = (t: Tile | undefined): boolean => !!t && t.kind !== 'wall';

/** 通路か（部屋に属さない開けたマス） */
export const isCorridor = (t: Tile | undefined): boolean => isOpen(t) && t!.roomId < 0;

/** 視線を通すか。壁だけが遮る */
export const isTransparent = (t: Tile | undefined): boolean => isOpen(t);

/**
 * その移動タイプで入れるマスか。
 * 罠や敵の有無は見ない（それは game 側の責務）。
 */
export function canEnter(map: FloorMap, x: number, y: number, move: MoveType): boolean {
  const t = at(map, x, y);
  if (!t) return false;
  switch (t.kind) {
    case 'wall':
      return move === 'phase' && !t.hard;
    case 'water':
      return move === 'water' || move === 'fly';
    case 'lava':
      return move === 'lava' || move === 'fly';
    case 'floor':
    case 'stairs':
    case 'pit':
      return true;
  }
}

/**
 * 斜め移動できるか（角の壁のすり抜けを禁止する）。
 *
 * シレン系の規則: 斜めに進む時、進行方向の縦横 2 マスのうち
 * **どちらか一方でも壁なら通れない**。
 * 例: 右下へ進むとき、右のマスと下のマスの両方が壁でないことが条件。
 */
export function canMoveDiagonally(
  map: FloorMap, from: Point, dx: number, dy: number, move: MoveType,
): boolean {
  if (dx === 0 || dy === 0) return true;
  if (move === 'phase' || move === 'fly') return true;
  const side1 = at(map, from.x + dx, from.y);
  const side2 = at(map, from.x, from.y + dy);
  return isOpen(side1) && isOpen(side2);
}

export function roomOf(map: FloorMap, p: Point): Room | null {
  const t = tileAt(map, p);
  if (!t || t.roomId < 0) return null;
  return map.rooms.find((r) => r.id === t.roomId) ?? null;
}

export const roomById = (map: FloorMap, id: number): Room | null =>
  map.rooms.find((r) => r.id === id) ?? null;

/** 矩形を指定の地形で塗る（外周の掘れない壁は避ける） */
export function fillRect(map: FloorMap, r: Rect, kind: TileKind, roomId = -1): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const t = at(map, x, y);
      if (!t || t.hard) continue;
      t.kind = kind;
      t.roomId = roomId;
    }
  }
}

/** 部屋の内側（壁際を除く）の座標を列挙 */
export function roomInterior(room: Room, inset = 0): Point[] {
  const out: Point[] = [];
  const r = room.rect;
  for (let y = r.y + inset; y < r.y + r.h - inset; y++) {
    for (let x = r.x + inset; x < r.x + r.w - inset; x++) out.push({ x, y });
  }
  return out;
}

/** 部屋の全マス */
export const roomCells = (room: Room): Point[] => roomInterior(room, 0);

export const isInRoom = (room: Room, p: Point): boolean => rectContains(room.rect, p);

/** 8 近傍の座標（範囲内のみ） */
export function neighbors8(map: FloorMap, p: Point): Point[] {
  const out: Point[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = p.x + dx;
      const y = p.y + dy;
      if (inBounds(map, x, y)) out.push({ x, y });
    }
  }
  return out;
}

/** 4 近傍の座標（範囲内のみ） */
export function neighbors4(map: FloorMap, p: Point): Point[] {
  const out: Point[] = [];
  const d = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [dx, dy] of d) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (inBounds(map, x, y)) out.push({ x, y });
  }
  return out;
}

/**
 * 開けたマスがすべて繋がっているか調べる。
 * 生成アルゴリズムの検証に使う（不通のフロアを世に出さないため）。
 */
export function connectivityReport(map: FloorMap): {
  connected: boolean;
  openCount: number;
  reachable: number;
  unreachable: Point[];
} {
  const open: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isOpen(at(map, x, y))) open.push({ x, y });
    }
  }
  if (open.length === 0) {
    return { connected: true, openCount: 0, reachable: 0, unreachable: [] };
  }
  const seen = new Uint8Array(map.width * map.height);
  const start = open[0];
  const stack: Point[] = [start];
  seen[idxOf(start.x, start.y, map.width)] = 1;
  let count = 0;
  while (stack.length > 0) {
    const p = stack.pop() as Point;
    count++;
    // 斜めのすり抜けを許さない歩き方で連結性を測る
    for (const n of neighbors4(map, p)) {
      const i = idxOf(n.x, n.y, map.width);
      if (seen[i]) continue;
      if (!isOpen(at(map, n.x, n.y))) continue;
      seen[i] = 1;
      stack.push(n);
    }
  }
  const unreachable = open.filter((p) => !seen[idxOf(p.x, p.y, map.width)]);
  return {
    connected: unreachable.length === 0,
    openCount: open.length,
    reachable: count,
    unreachable,
  };
}

/**
 * 「実際に歩いて行けるか」で到達性を測る。
 *
 * connectivityReport() は壁でないマスを 4 近傍で繋いで見るだけなので、
 * 水路や溶岩を「通れる」と数えてしまう。地上を歩くプレイヤーにとっては
 * 水に囲まれた床は行き止まりなので、フロアの検証にはこちらを使う。
 */
export function reachabilityReport(
  map: FloorMap, move: MoveType = 'ground',
): { ok: boolean; unreachable: Point[] } {
  // 地上で立てるマスをすべて集める
  const targets: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (canEnter(map, x, y, move)) targets.push({ x, y });
    }
  }
  if (targets.length === 0) return { ok: true, unreachable: [] };

  const seen = new Uint8Array(map.width * map.height);
  const start = targets[0];
  const stack: Point[] = [start];
  seen[idxOf(start.x, start.y, map.width)] = 1;
  while (stack.length > 0) {
    const p = stack.pop() as Point;
    for (const n of neighbors8(map, p)) {
      const i = idxOf(n.x, n.y, map.width);
      if (seen[i]) continue;
      if (!canEnter(map, n.x, n.y, move)) continue;
      if (!canMoveDiagonally(map, p, n.x - p.x, n.y - p.y, move)) continue;
      seen[i] = 1;
      stack.push(n);
    }
  }
  const unreachable = targets.filter((p) => !seen[idxOf(p.x, p.y, map.width)]);
  return { ok: unreachable.length === 0, unreachable };
}

/** 2 点間の歩数（4 近傍 BFS）。到達不能なら -1 */
export function walkDistance(
  map: FloorMap, from: Point, to: Point, move: MoveType = 'ground',
): number {
  if (from.x === to.x && from.y === to.y) return 0;
  const w = map.width;
  const dist = new Int32Array(w * map.height).fill(-1);
  const queue: Point[] = [from];
  dist[idxOf(from.x, from.y, w)] = 0;
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    const d = dist[idxOf(p.x, p.y, w)];
    for (const n of neighbors8(map, p)) {
      const i = idxOf(n.x, n.y, w);
      if (dist[i] >= 0) continue;
      if (!canEnter(map, n.x, n.y, move)) continue;
      if (!canMoveDiagonally(map, p, n.x - p.x, n.y - p.y, move)) continue;
      dist[i] = d + 1;
      if (n.x === to.x && n.y === to.y) return d + 1;
      queue.push(n);
    }
  }
  return -1;
}

/**
 * from から各マスへの歩数を配列で返す（追跡 AI 用）。
 * 到達不能は -1。
 */
export function distanceField(
  map: FloorMap, from: Point, move: MoveType = 'ground',
): Int32Array {
  const w = map.width;
  const dist = new Int32Array(w * map.height).fill(-1);
  if (!inBounds(map, from.x, from.y)) return dist;
  const queue: Point[] = [from];
  dist[idxOf(from.x, from.y, w)] = 0;
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    const d = dist[idxOf(p.x, p.y, w)];
    for (const n of neighbors8(map, p)) {
      const i = idxOf(n.x, n.y, w);
      if (dist[i] >= 0) continue;
      if (!canEnter(map, n.x, n.y, move)) continue;
      if (!canMoveDiagonally(map, p, n.x - p.x, n.y - p.y, move)) continue;
      dist[i] = d + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** 開けたマスをすべて集める */
export function allOpenTiles(map: FloorMap, pred?: (t: Tile, p: Point) => boolean): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = at(map, x, y);
      if (!t || !isOpen(t)) continue;
      const p = { x, y };
      if (pred && !pred(t, p)) continue;
      out.push(p);
    }
  }
  return out;
}

/** 部屋の床（アイテム・敵を置ける場所）をすべて集める */
export function allRoomFloors(map: FloorMap): Point[] {
  return allOpenTiles(map, (t) => t.roomId >= 0 && t.kind === 'floor');
}

/** p から半径 r 以内の開けたマス */
export function openTilesNear(map: FloorMap, p: Point, r: number): Point[] {
  const out: Point[] = [];
  for (let y = p.y - r; y <= p.y + r; y++) {
    for (let x = p.x - r; x <= p.x + r; x++) {
      if (!inBounds(map, x, y)) continue;
      if (!isOpen(at(map, x, y))) continue;
      if (chebyshev(p, { x, y }) > r) continue;
      out.push({ x, y });
    }
  }
  return out;
}

/** すべてのタイルの可視フラグを下ろす */
export function clearVisibility(map: FloorMap): void {
  for (const t of map.tiles) t.visible = false;
}

/** デバッグ用に ASCII でフロアを出力する */
export function renderAscii(map: FloorMap, marks: Array<{ p: Point; ch: string }> = []): string {
  const grid: string[][] = [];
  for (let y = 0; y < map.height; y++) {
    const row: string[] = [];
    for (let x = 0; x < map.width; x++) {
      const t = at(map, x, y)!;
      let ch = '#';
      if (t.kind === 'floor') ch = t.roomId >= 0 ? '.' : ',';
      else if (t.kind === 'water') ch = '~';
      else if (t.kind === 'lava') ch = '^';
      else if (t.kind === 'stairs') ch = '>';
      else if (t.kind === 'pit') ch = 'o';
      if (t.shop) ch = '$';
      if (t.trap) ch = 't';
      row.push(ch);
    }
    grid.push(row);
  }
  for (const m of marks) {
    if (inBounds(map, m.p.x, m.p.y)) grid[m.p.y][m.p.x] = m.ch;
  }
  return grid.map((r) => r.join('')).join('\n');
}
