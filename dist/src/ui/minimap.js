/**
 * ミニマップと全体マップ。
 */
import { at } from '../dungeon/tilemap.js';
import { drawPanel, drawText } from './draw.js';
import { LAYOUT, MINIMAP_COLOR, SCREEN_H, SCREEN_W, UI } from './theme.js';
/** 1 マスを何ピクセルで描くか決める */
function cellSize(map, w, h) {
    return Math.max(1, Math.floor(Math.min(w / map.width, h / map.height)));
}
function paint(g, d, originX, originY, cell, showAll) {
    const { map } = d;
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            const t = at(map, x, y);
            if (!t)
                continue;
            if (!showAll && !t.explored)
                continue;
            let color = null;
            switch (t.kind) {
                case 'wall':
                    color = t.explored || showAll ? MINIMAP_COLOR.wall : null;
                    break;
                case 'water':
                    color = MINIMAP_COLOR.water;
                    break;
                case 'lava':
                    color = MINIMAP_COLOR.lava;
                    break;
                case 'stairs':
                    color = MINIMAP_COLOR.stairs;
                    break;
                case 'pit':
                    color = '#000000';
                    break;
                default: color = t.roomId >= 0 ? MINIMAP_COLOR.floor : MINIMAP_COLOR.corridor;
            }
            if (t.shop)
                color = MINIMAP_COLOR.shop;
            if (!color)
                continue;
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
        if (!t || (!showAll && !t.explored && !d.seeItems))
            continue;
        g.fillStyle = f.item.shopPrice > 0 ? MINIMAP_COLOR.shop : MINIMAP_COLOR.item;
        g.fillRect(originX + f.pos.x * cell, originY + f.pos.y * cell, cell, cell);
    }
    // 敵と仲間
    for (const m of d.monsters) {
        if (!m.alive)
            continue;
        const t = at(map, m.pos.x, m.pos.y);
        if (!t || (!t.visible && !showAll && !d.seeMonsters))
            continue;
        g.fillStyle = MINIMAP_COLOR.monster;
        g.fillRect(originX + m.pos.x * cell, originY + m.pos.y * cell, cell, cell);
    }
    for (const a of d.allies) {
        if (!a.alive)
            continue;
        g.fillStyle = MINIMAP_COLOR.ally;
        g.fillRect(originX + a.pos.x * cell, originY + a.pos.y * cell, cell, cell);
    }
    // プレイヤー（点滅させて見失わないようにする）
    g.fillStyle = MINIMAP_COLOR.player;
    const px = originX + d.player.pos.x * cell;
    const py = originY + d.player.pos.y * cell;
    g.fillRect(px - 1, py - 1, cell + 2, cell + 2);
}
/** 右上の小さなミニマップ */
export function drawMinimap(g, d, mode, frame) {
    if (mode === 'off')
        return;
    const base = LAYOUT.minimap;
    const r = mode === 'large'
        ? { x: base.x - 120, y: base.y, w: base.w + 120, h: base.h + 80 }
        : base;
    drawPanel(g, r, { frame, alpha: 0.85 });
    const inner = { x: r.x + 8, y: r.y + 8, w: r.w - 16, h: r.h - 16 };
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
export function drawFullMap(g, d) {
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
    const legend = [
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
export function nextMinimapMode(mode) {
    return mode === 'normal' ? 'large' : mode === 'large' ? 'off' : 'normal';
}
//# sourceMappingURL=minimap.js.map