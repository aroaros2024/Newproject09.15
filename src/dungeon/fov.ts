/**
 * 視界（FOV）。不思議のダンジョン方式。
 *
 * 光線を飛ばす一般的なローグライクの視界とは違い、この系列は
 *   - 明るい部屋にいる → 部屋全体とその壁、出入口が見える
 *   - 暗い部屋・通路にいる → 自分の周囲 8 マスだけ見える
 *   - 出入口の上に立っている → その部屋が見える
 * という「部屋単位」の規則になっている。
 *
 * visible は毎ターン作り直し、explored は一度立ったら消えない（地図に残る）。
 */

import type { FloorMap, Point, Room } from '../core/types.js';
import { at, clearVisibility, inBounds, isOpen, neighbors8, roomOf } from './tilemap.js';

export interface FovOptions {
  /** めつぶし状態。自分のマスしか見えない */
  blind?: boolean;
  /** 千里眼など。フロア全体が見える */
  clairvoyant?: boolean;
  /** 暗い部屋でも明るく見える（あかりの巻物など） */
  lightAll?: boolean;
}

/** 視界の計算結果。AI やミニマップが参照する */
export interface FovResult {
  /** 今いる部屋。通路なら null */
  room: Room | null;
  /** 見えているマスの座標 */
  visible: Point[];
}

/**
 * プレイヤーの視界を再計算して map の visible / explored を更新する。
 */
export function computeFov(map: FloorMap, from: Point, opts: FovOptions = {}): FovResult {
  clearVisibility(map);

  if (opts.clairvoyant) {
    for (const t of map.tiles) {
      t.visible = true;
      t.explored = true;
    }
    return { room: roomOf(map, from), visible: collectVisible(map) };
  }

  // 自分の足元は常に見える
  reveal(map, from.x, from.y);

  if (opts.blind) {
    return { room: null, visible: collectVisible(map) };
  }

  const room = currentRoom(map, from);
  if (room && (!room.dark || opts.lightAll)) {
    revealRoom(map, room);
    return { room, visible: collectVisible(map) };
  }

  // 暗い部屋・通路: 周囲 8 マスのみ
  for (const n of neighbors8(map, from)) reveal(map, n.x, n.y);
  return { room, visible: collectVisible(map) };
}

/**
 * 今いる部屋を返す。出入口の上に立っている場合は、その出入口が属する部屋を返す。
 */
export function currentRoom(map: FloorMap, p: Point): Room | null {
  const direct = roomOf(map, p);
  if (direct) return direct;
  const t = at(map, p.x, p.y);
  if (!t || !t.isDoor) return null;
  // 出入口の隣にある部屋を探す
  for (const n of neighbors8(map, p)) {
    const r = roomOf(map, n);
    if (r && r.doors.some((d) => d.x === p.x && d.y === p.y)) return r;
  }
  for (const n of neighbors8(map, p)) {
    const r = roomOf(map, n);
    if (r) return r;
  }
  return null;
}

/** 部屋の床・壁・出入口と、出入口の 1 マス外を見えるようにする */
function revealRoom(map: FloorMap, room: Room): void {
  const r = room.rect;
  // 部屋の内側 + 外周の壁 1 マス
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) reveal(map, x, y);
  }
  // 出入口とその 1 マス外（通路の入口が見える）
  for (const d of room.doors) {
    reveal(map, d.x, d.y);
    for (const n of neighbors8(map, d)) reveal(map, n.x, n.y);
  }
}

function reveal(map: FloorMap, x: number, y: number): void {
  if (!inBounds(map, x, y)) return;
  const t = at(map, x, y);
  if (!t) return;
  t.visible = true;
  t.explored = true;
}

function collectVisible(map: FloorMap): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y * map.width + x].visible) out.push({ x, y });
    }
  }
  return out;
}

/**
 * 「a から b が見えるか」。モンスターの索敵とプレイヤーの表示判定に使う。
 *
 * 同じ明るい部屋にいれば見える。そうでなければ隣接している時だけ見える。
 * 部屋の明るさを無視したい場合（気配で察知する敵）は ignoreDark を渡す。
 */
export function canSee(
  map: FloorMap, a: Point, b: Point, ignoreDark = false,
): boolean {
  if (a.x === b.x && a.y === b.y) return true;
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (dx <= 1 && dy <= 1) return true;

  const ra = currentRoom(map, a);
  if (!ra) return false;
  const rb = currentRoom(map, b);
  if (!rb || ra.id !== rb.id) return false;
  if (ra.dark && !ignoreDark) return false;
  return true;
}

/**
 * a から b へ射線が通っているか（杖・矢の判定）。
 * 8 方向の直線上にあり、途中に壁が無ければ通る。
 */
export function hasLineOfFire(map: FloorMap, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return false;
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return false;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i < n; i++) {
    const x = a.x + sx * i;
    const y = a.y + sy * i;
    if (!isOpen(at(map, x, y))) return false;
  }
  return true;
}

/** フロア全体を踏破済みにする（あかりの巻物、地図の巻物） */
export function revealWholeFloor(map: FloorMap, includeTraps = false): void {
  for (const t of map.tiles) {
    t.explored = true;
    if (includeTraps && t.trap) t.trap.revealed = true;
  }
}
