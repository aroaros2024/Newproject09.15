/**
 * ミニマップと全体マップ。
 */

import type { Point } from '../core/geom.js';
import type { FloorItem, FloorMap, MonsterActor, PlayerActor } from '../core/types.js';
import { at } from '../dungeon/tilemap.js';
import { type Ctx, drawPanel, drawText } from './draw.js';
import { LAYOUT, MINIMAP_COLOR, SCREEN_H, SCREEN_W, UI } from './theme.js';

export type MinimapMode = 'normal' | 'large' | 'off';

export interface MinimapData {
  map: FloorMap;
  player: PlayerActor;
  monsters: readonly MonsterActor[];
  allies: readonly MonsterActor[];
  items: readonly FloorItem[];
  /** 透視の腕輪などで敵が全部見えるか */
  seeMonsters?: boolean;
  /** よくみえの腕輪などでワナとアイテムが全部見えるか */
  seeItems?: boolean;
}

/** 1 マスを何ピクセルで描くか決める */
function cellSize(map: FloorMap, w: number, h: number): number {
  return Math.max(1, Math.floor(Math.min(w / map.width, h / map.height)));
}

function paint(
  g: Ctx, d: MinimapData, originX: number, originY: number, cell: number, showAll: boolean,
): void {
  const { map } = d;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = at(map, x, y);
      if (!t) continue;
      if (!showAll && !t.explored) continue;
      let color: string | null = null;
      switch (t.kind) {
        case 'wall': color = t.explored || showAll ? MINIMAP_COLOR.wall : null; break;
        case 'water': color = MINIMAP_COLOR.water; break;
        case 'lava': color = MINIMAP_COLOR.lava; break;
        case 'stairs': color = MINIMAP_COLOR.stairs; break;
        case 'pit': color = '#000000'; break;
        default: color = t.roomId >= 0 ? MINIMAP_COLOR.floor : MINIMAP_COLOR.corridor;
      }
      if (t.shop) color = MINIMAP_COLOR.shop;
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(originX + x * cell, originY + y * cell, cell, cell);
      if (t.trap && (t.trap.revealed || showAll) && !t.trap.used) {
        g.fillStyle = MINIMAP_COLOR.trap;
        g.fillRect(originX + x * cell, originY + y * cell, cell, cell);
      }
    }
  }

  // アイテム
  for (const f of d.items) {
    const t = at(map, f.pos.x, f.pos.y);
    if (!t || (!showAll && !t.explored && !d.seeItems)) continue;
    g.fillStyle = f.item.shopPrice > 0 ? MINIMAP_COLOR.shop : MINIMAP_COLOR.item;
    g.fillRect(originX + f.pos.x * cell, originY + f.pos.y * cell, cell, cell);
  }

  // 敵と仲間
  for (const m of d.monsters) {
    if (!m.alive) continue;
    const t = at(map, m.pos.x, m.pos.y);
    if (!t || (!t.visible && !showAll && !d.seeMonsters)) continue;
    g.fillStyle = MINIMAP_COLOR.monster;
    g.fillRect(originX + m.pos.x * cell, originY + m.pos.y * cell, cell, cell);
  }
  for (const a of d.allies) {
    if (!a.alive) continue;
    g.fillStyle = MINIMAP_COLOR.ally;
    g.fillRect(originX + a.pos.x * cell, originY + a.pos.y * cell, cell, cell);
  }

  // プレイヤー：点滅する金の菱形（見失わないように、マスより一回り大きく）
  const px = originX + d.player.pos.x * cell + cell / 2;
  const py = originY + d.player.pos.y * cell + cell / 2;
  const on = Math.floor(performance.now() / 400) % 2 === 0;
  const rr = Math.max(2, cell) + 1;
  g.fillStyle = '#0b1020';
  g.beginPath();
  g.moveTo(px, py - rr - 1);
  g.lineTo(px + rr + 1, py);
  g.lineTo(px, py + rr + 1);
  g.lineTo(px - rr - 1, py);
  g.closePath();
  g.fill();
  g.fillStyle = on ? MINIMAP_COLOR.player : UI.cursorEdge;
  g.beginPath();
  g.moveTo(px, py - rr);
  g.lineTo(px + rr, py);
  g.lineTo(px, py + rr);
  g.lineTo(px - rr, py);
  g.closePath();
  g.fill();
}

/** 右上の小さなミニマップ */
export function drawMinimap(g: Ctx, d: MinimapData, mode: MinimapMode, frame: string): void {
  if (mode === 'off') return;
  const base = LAYOUT.minimap;
  const r = mode === 'large'
    ? { x: base.x - 120, y: base.y, w: base.w + 120, h: base.h + 80 }
    : base;
  void frame;
  drawPanel(g, r, { alpha: 0.9, ornaments: false });
  const inner = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 12 };
  const cell = cellSize(d.map, inner.w, inner.h);
  const ox = inner.x + Math.floor((inner.w - d.map.width * cell) / 2);
  const oy = inner.y + Math.floor((inner.h - d.map.height * cell) / 2);
  g.save();
  g.beginPath();
  g.rect(inner.x, inner.y, inner.w, inner.h);
  g.clip();
  paint(g, d, ox, oy, cell, false);
  g.restore();
}

/** Tab を押している間に出る全体マップ */
export function drawFullMap(g: Ctx, d: MinimapData): void {
  g.save();
  g.fillStyle = 'rgba(6,6,12,0.92)';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const margin = 70;
  const w = SCREEN_W - margin * 2;
  const h = SCREEN_H - margin * 2 - 40;
  const cell = cellSize(d.map, w, h);
  const ox = margin + Math.floor((w - d.map.width * cell) / 2);
  const oy = margin + 20 + Math.floor((h - d.map.height * cell) / 2);
  paint(g, d, ox, oy, cell, false);

  drawText(g, '全体図', SCREEN_W / 2, 46, {
    size: 24, bold: true, align: 'center', color: UI.cursorEdge,
  });

  // 凡例
  const legend: Array<[string, string]> = [
    ['自分', MINIMAP_COLOR.player],
    ['敵', MINIMAP_COLOR.monster],
    ['仲間', MINIMAP_COLOR.ally],
    ['アイテム', MINIMAP_COLOR.item],
    ['階段', MINIMAP_COLOR.stairs],
    ['ワナ', MINIMAP_COLOR.trap],
    ['店', MINIMAP_COLOR.shop],
  ];
  let lx = margin;
  for (const [label, color] of legend) {
    g.fillStyle = color;
    g.fillRect(lx, SCREEN_H - 44, 12, 12);
    drawText(g, label, lx + 18, SCREEN_H - 33, { size: 14, color: UI.textDim });
    lx += 20 + label.length * 15;
  }
  g.restore();
}

/** ミニマップの表示モードを 1 つ進める */
export function nextMinimapMode(mode: MinimapMode): MinimapMode {
  return mode === 'normal' ? 'large' : mode === 'large' ? 'off' : 'normal';
}

export type { Point };
