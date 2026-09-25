/**
 * Canvas への描画ヘルパ。
 * ウィンドウ枠・テキスト・バー・カーソルなど、UI 全体で使い回す部品。
 *
 * 見た目は ui2/（新しい UI の決まり）に従う：深い紺の地に金の二重線と四隅のドットの飾り、
 * 見出しは明朝。関数の名前と引数は昔のまま（画面ごとの呼び出しを書き換えずに済むように）。
 */
import { SCREEN_H, SCREEN_W, UI, font } from './theme.js';
import { frameParts } from './ui2/frame.js';
import { PANEL, SELECT } from './ui2/tokens.js';
/** 角丸矩形のパスを引く（ctx.roundRect は使わない＝古い環境への配慮） */
export function roundRect(g, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.arcTo(x + w, y, x + w, y + rr, rr);
    g.lineTo(x + w, y + h - rr);
    g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    g.lineTo(x + rr, y + h);
    g.arcTo(x, y + h, x, y + h - rr, rr);
    g.lineTo(x, y + rr);
    g.arcTo(x, y, x + rr, y, rr);
    g.closePath();
}
/** 枠線 1 本ぶん（上下左右の 4 本の fillRect。strokeRect より線がにじまない） */
function frameLine(g, x, y, w, h, t) {
    g.fillRect(x, y, w, t);
    g.fillRect(x, y + h - t, w, t);
    g.fillRect(x, y + t, t, h - t * 2);
    g.fillRect(x + w - t, y + t, t, h - t * 2);
}
/**
 * ウィンドウ枠。外から 暗い金 1px・金 2px・隙間 2px・薄い金 1px の二重線と、四隅のドットの飾り。
 * 地は上が少し明るい紺のグラデーション（焼いた帯を引き伸ばすだけで、毎回作らない）。
 */
export function drawPanel(g, r, o = {}) {
    const p = frameParts();
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    const w = Math.round(r.w);
    const h = Math.round(r.h);
    const danger = o.frame === UI.danger;
    const alpha = o.alpha ?? 1;
    g.save();
    if (o.shadow !== false) {
        g.globalAlpha = alpha;
        g.fillStyle = PANEL.shadow;
        g.fillRect(x + 3, y + 5, w, h);
    }
    // 地
    g.globalAlpha = alpha * PANEL.bgAlpha;
    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = true;
    g.drawImage(p.bg, x, y, w, h);
    g.imageSmoothingEnabled = smooth;
    // 枠
    g.globalAlpha = alpha;
    g.fillStyle = PANEL.goldEdge;
    frameLine(g, x, y, w, h, 1);
    g.fillStyle = danger ? PANEL.danger : PANEL.gold;
    frameLine(g, x + 1, y + 1, w - 2, h - 2, 2);
    g.globalAlpha = alpha * 0.6;
    g.fillStyle = danger ? PANEL.dangerLight : PANEL.goldDark;
    frameLine(g, x + 5, y + 5, w - 10, h - 10, 1);
    // 四隅の飾り（12×12 ドットを 2 倍。菱形の中心が枠の角に重なる）
    if (o.ornaments !== false && w >= 64 && h >= 48) {
        g.globalAlpha = alpha;
        g.imageSmoothingEnabled = false;
        const s = 24;
        g.drawImage(p.corners[0], x - 8, y - 8, s, s);
        g.drawImage(p.corners[1], x + w - 16, y - 8, s, s);
        g.drawImage(p.corners[2], x - 8, y + h - 16, s, s);
        g.drawImage(p.corners[3], x + w - 16, y + h - 16, s, s);
        g.imageSmoothingEnabled = smooth;
    }
    g.restore();
}
export function drawText(g, text, x, y, o = {}) {
    g.save();
    g.font = font(o.size ?? 18, o.bold ? 'bold' : 'normal', o.family ?? 'sans');
    g.textAlign = o.align ?? 'left';
    g.textBaseline = o.baseline ?? 'alphabetic';
    if (o.spacing)
        g.letterSpacing = `${o.spacing}px`;
    if (o.alpha !== undefined)
        g.globalAlpha = o.alpha;
    if (o.outline) {
        g.lineJoin = 'round';
        g.miterLimit = 2;
        g.lineWidth = o.outlineWidth ?? 3;
        g.strokeStyle = o.outline;
        g.strokeText(text, x, y, o.maxWidth);
    }
    g.fillStyle = o.color ?? UI.text;
    g.fillText(text, x, y, o.maxWidth);
    g.restore();
}
/** 省略した結果の覚え（毎フレーム同じ文字列を測り直さない） */
const ellipsizeCache = new Map();
/** 指定幅に収まるよう「…」で省略する */
export function ellipsize(g, text, maxWidth, size = 18) {
    const key = `${size}|${Math.round(maxWidth)}|${text}`;
    const hit = ellipsizeCache.get(key);
    if (hit !== undefined)
        return hit;
    g.save();
    g.font = font(size);
    let out = text;
    if (g.measureText(text).width > maxWidth) {
        let lo = 0;
        let hi = text.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (g.measureText(`${text.slice(0, mid)}…`).width <= maxWidth)
                lo = mid;
            else
                hi = mid - 1;
        }
        out = `${text.slice(0, lo)}…`;
    }
    g.restore();
    if (ellipsizeCache.size > 2000)
        ellipsizeCache.clear();
    ellipsizeCache.set(key, out);
    return out;
}
/** 指定幅で折り返した行の配列を返す（日本語なので文字単位で折る） */
export function wrapText(g, text, maxWidth, size = 18) {
    g.save();
    g.font = font(size);
    const lines = [];
    let line = '';
    for (const ch of text) {
        if (ch === '\n') {
            lines.push(line);
            line = '';
            continue;
        }
        const next = line + ch;
        if (g.measureText(next).width > maxWidth && line.length > 0) {
            lines.push(line);
            line = ch;
        }
        else {
            line = next;
        }
    }
    if (line.length > 0)
        lines.push(line);
    g.restore();
    return lines;
}
/** '#rrggbb' を白か黒へ寄せた色（明るい線・暗い線）。作った文字列は覚えておく */
const tintCache = new Map();
function tint(hex, k) {
    const key = `${hex}|${k}`;
    const hit = tintCache.get(key);
    if (hit)
        return hit;
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    let out = hex;
    if (m) {
        const c = [1, 2, 3].map((i) => parseInt(m[i], 16));
        const t = k >= 0 ? c.map((v) => Math.round(v + (255 - v) * k)) : c.map((v) => Math.round(v * (1 + k)));
        out = `rgb(${t[0]},${t[1]},${t[2]})`;
    }
    tintCache.set(key, out);
    return out;
}
/** HP バーなど。紺の溝に暗い金の縁、中身は上に明るい線・下に暗い線 */
export function drawBar(g, r, o) {
    const ratio = Math.max(0, Math.min(1, o.ratio));
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    const w = Math.round(r.w);
    const h = Math.round(r.h);
    g.save();
    g.fillStyle = o.bg ?? PANEL.bgBottom;
    g.fillRect(x, y, w, h);
    const fw = Math.round((w - 2) * ratio);
    if (fw > 0) {
        g.fillStyle = o.color;
        g.fillRect(x + 1, y + 1, fw, h - 2);
        if (h >= 6) {
            g.fillStyle = tint(o.color, 0.35);
            g.fillRect(x + 1, y + 1, fw, 1);
            g.fillStyle = tint(o.color, -0.35);
            g.fillRect(x + 1, y + h - 2, fw, 1);
        }
    }
    if (o.segments && o.segments > 1) {
        g.fillStyle = 'rgba(11,16,32,0.55)';
        for (let i = 1; i < o.segments; i++) {
            g.fillRect(Math.round(x + (w * i) / o.segments), y + 1, 1, h - 2);
        }
    }
    g.fillStyle = PANEL.goldDark;
    frameLine(g, x, y, w, h, 1);
    if (o.caps ?? h >= 12) {
        const p = frameParts();
        const smooth = g.imageSmoothingEnabled;
        g.imageSmoothingEnabled = false;
        const ch = 16;
        const cy = y + Math.round(h / 2) - ch / 2;
        g.drawImage(p.capL, x - 7, cy, 8, ch);
        g.drawImage(p.capR, x + w - 1, cy, 8, ch);
        g.imageSmoothingEnabled = smooth;
    }
    g.restore();
}
/**
 * メニューの選択カーソル。青い帯（左から右へ薄く）と上下の細い金線、
 * 左にドットの金の指し手（上下にゆっくり 2px 揺れる）。
 */
export function drawCursor(g, r, pulse = 0) {
    const p = frameParts();
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    const w = Math.round(r.w);
    const h = Math.round(r.h);
    g.save();
    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = true;
    g.drawImage(p.select, x, y, w, h);
    g.fillStyle = SELECT.hairline;
    g.fillRect(x, y, Math.round(w * 0.8), 1);
    g.fillRect(x, y + h - 1, Math.round(w * 0.8), 1);
    g.imageSmoothingEnabled = false;
    const bob = Math.round(Math.sin((pulse / 1000) * Math.PI * 2 * 1.2) * 2);
    g.drawImage(p.pointer, x - 14 + bob, y + Math.round(h / 2) - 7, 10, 14);
    g.imageSmoothingEnabled = smooth;
    g.restore();
}
/** 画面全体を覆う暗幕（紺寄りの黒） */
export function drawOverlay(g, w, h, alpha = 0.62) {
    g.save();
    g.fillStyle = `rgba(3,5,12,${alpha})`;
    g.fillRect(0, 0, w, h);
    g.restore();
}
/** 下向きの「続きがある」三角（ログや一覧のスクロール表示） */
export function drawScrollArrow(g, x, y, down, t) {
    const bob = Math.round(Math.sin(t / 220) * 2);
    g.save();
    g.fillStyle = PANEL.goldLight;
    const cx = Math.round(x);
    const cy = Math.round(y) + (down ? bob : -bob);
    // ドットの三角（幅 11・高さ 6）
    for (let i = 0; i < 6; i++) {
        const half = down ? 5 - i : i;
        g.fillRect(cx - half, cy - 3 + i, half * 2 + 1, 1);
    }
    g.restore();
}
/** 小さなバッジ（装備中・呪い・個数など） */
export function drawBadge(g, text, x, y, color, size = 14) {
    g.save();
    g.font = font(size, 'bold');
    const w = Math.round(g.measureText(text).width + 10);
    const h = size + 6;
    const bx = Math.round(x);
    const by = Math.round(y);
    g.fillStyle = color;
    g.fillRect(bx, by, w, h);
    g.fillStyle = 'rgba(11,16,32,0.45)';
    frameLine(g, bx, by, w, h, 1);
    g.fillStyle = '#0b1020';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, bx + w / 2, by + h / 2 + 1);
    g.restore();
    return w;
}
/**
 * 題の札。枠の中の左上に置く、両端に菱形の付いた帯と明朝の見出し。
 * 返り値は札の幅。
 */
export function drawTitlePlaque(g, text, x, y, o = {}) {
    if (!text)
        return 0;
    const size = o.size ?? 20;
    g.save();
    g.font = font(size, 'bold', 'serif');
    const tw = Math.round(g.measureText(text).width);
    const w = tw + 36;
    const h = size + 12;
    const bx = Math.round(x);
    const by = Math.round(y);
    // 帯（中央が濃く、両端へ薄く）
    g.fillStyle = 'rgba(200,168,105,0.10)';
    g.fillRect(bx, by, w, h);
    g.fillStyle = PANEL.goldDark;
    g.fillRect(bx + 8, by + h - 1, w - 16, 1);
    // 両端の菱形（ドット）
    g.fillStyle = PANEL.gold;
    const cy = by + Math.round(h / 2);
    for (const cx of [bx + 5, bx + w - 6]) {
        g.fillRect(cx - 1, cy - 3, 3, 7);
        g.fillRect(cx - 3, cy - 1, 7, 3);
    }
    g.restore();
    drawText(g, text, bx + 18, cy + 1, {
        size, bold: true, family: 'serif', color: o.color ?? UI.cursorEdge, baseline: 'middle',
        outline: 'rgba(11,16,32,0.8)', outlineWidth: 3,
    });
    return w;
}
/** 画面の縁から空けておく幅 */
const SAFE = 12;
/**
 * 枠が画面からはみ出さないように直す。まず上・左へずらし、それでも入らなければ縮める。
 * 大きさを固定で書いたメニューが画面の下へはみ出していた（村の広場で y=808 まで）。
 */
export function fitRect(r) {
    let { x, y, w, h } = r;
    w = Math.min(w, SCREEN_W - SAFE * 2);
    h = Math.min(h, SCREEN_H - SAFE * 2);
    if (x + w > SCREEN_W - SAFE)
        x = SCREEN_W - SAFE - w;
    if (y + h > SCREEN_H - SAFE)
        y = SCREEN_H - SAFE - h;
    x = Math.max(SAFE, x);
    y = Math.max(SAFE, y);
    return { x, y, w, h };
}
//# sourceMappingURL=draw.js.map