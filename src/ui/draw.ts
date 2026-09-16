/**
 * Canvas への描画ヘルパ。
 * ウィンドウ枠・テキスト・バー・カーソルなど、UI 全体で使い回す部品。
 */

import type { Rect } from '../core/geom.js';
import { UI, font } from './theme.js';

export type Ctx = CanvasRenderingContext2D;

/** 角丸矩形のパスを引く（ctx.roundRect は使わない＝古い環境への配慮） */
export function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
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

export interface PanelOptions {
  /** 枠の色。省略時は UI.frame */
  frame?: string;
  /** 背景の不透明度（0〜1）。省略時は既定 */
  alpha?: number;
  /** 角の丸み */
  radius?: number;
  /** 影を落とすか */
  shadow?: boolean;
}

/** ウィンドウ枠。二重線にすることで「メニューらしさ」を出す */
export function drawPanel(g: Ctx, r: Rect, o: PanelOptions = {}): void {
  const radius = o.radius ?? 6;
  g.save();
  if (o.shadow !== false) {
    g.fillStyle = UI.shadow;
    roundRect(g, r.x + 3, r.y + 4, r.w, r.h, radius);
    g.fill();
  }
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  g.fillStyle = UI.panelBg;
  roundRect(g, r.x, r.y, r.w, r.h, radius);
  g.fill();
  g.globalAlpha = 1;

  g.strokeStyle = o.frame ?? UI.frame;
  g.lineWidth = 2;
  roundRect(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, radius - 1);
  g.stroke();

  g.strokeStyle = UI.frameInner;
  g.lineWidth = 1;
  roundRect(g, r.x + 4, r.y + 4, r.w - 8, r.h - 8, Math.max(1, radius - 3));
  g.stroke();
  g.restore();
}

export interface TextOptions {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** 縁取りの色。指定すると読みやすくなる（ダンジョン上の表示向け） */
  outline?: string;
  outlineWidth?: number;
  /** この幅を超えたら縮める */
  maxWidth?: number;
  alpha?: number;
}

export function drawText(g: Ctx, text: string, x: number, y: number, o: TextOptions = {}): void {
  g.save();
  g.font = font(o.size ?? 18, o.bold ? 'bold' : 'normal');
  g.textAlign = o.align ?? 'left';
  g.textBaseline = o.baseline ?? 'alphabetic';
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
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

/** 指定幅に収まるよう「…」で省略する */
export function ellipsize(g: Ctx, text: string, maxWidth: number, size = 18): string {
  g.save();
  g.font = font(size);
  if (g.measureText(text).width <= maxWidth) {
    g.restore();
    return text;
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  g.restore();
  return `${text.slice(0, lo)}…`;
}

/** 指定幅で折り返した行の配列を返す（日本語なので文字単位で折る） */
export function wrapText(g: Ctx, text: string, maxWidth: number, size = 18): string[] {
  g.save();
  g.font = font(size);
  const lines: string[] = [];
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
    } else {
      line = next;
    }
  }
  if (line.length > 0) lines.push(line);
  g.restore();
  return lines;
}

export interface BarOptions {
  /** 0〜1 */
  ratio: number;
  color: string;
  bg?: string;
  /** 目盛りの数。0 なら描かない */
  segments?: number;
  radius?: number;
}

/** HP バーなど */
export function drawBar(g: Ctx, r: Rect, o: BarOptions): void {
  const ratio = Math.max(0, Math.min(1, o.ratio));
  g.save();
  g.fillStyle = o.bg ?? 'rgba(0,0,0,0.5)';
  roundRect(g, r.x, r.y, r.w, r.h, o.radius ?? 3);
  g.fill();

  if (ratio > 0) {
    g.save();
    roundRect(g, r.x, r.y, r.w, r.h, o.radius ?? 3);
    g.clip();
    g.fillStyle = o.color;
    g.fillRect(r.x, r.y, r.w * ratio, r.h);
    // 上半分を少し明るくして立体感を出す
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(r.x, r.y, r.w * ratio, r.h / 2);
    g.restore();
  }

  if (o.segments && o.segments > 1) {
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1;
    for (let i = 1; i < o.segments; i++) {
      const x = Math.round(r.x + (r.w * i) / o.segments) + 0.5;
      g.beginPath();
      g.moveTo(x, r.y + 1);
      g.lineTo(x, r.y + r.h - 1);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 1;
  roundRect(g, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, o.radius ?? 3);
  g.stroke();
  g.restore();
}

/** メニューの選択カーソル */
export function drawCursor(g: Ctx, r: Rect, pulse = 0): void {
  g.save();
  const glow = 0.22 + 0.1 * Math.sin(pulse / 160);
  g.fillStyle = `rgba(255,210,74,${glow.toFixed(3)})`;
  roundRect(g, r.x, r.y, r.w, r.h, 4);
  g.fill();
  g.strokeStyle = UI.cursorEdge;
  g.lineWidth = 2;
  roundRect(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 3);
  g.stroke();
  // 左端の三角
  g.fillStyle = UI.cursorEdge;
  g.beginPath();
  g.moveTo(r.x - 10, r.y + r.h / 2 - 6);
  g.lineTo(r.x - 2, r.y + r.h / 2);
  g.lineTo(r.x - 10, r.y + r.h / 2 + 6);
  g.closePath();
  g.fill();
  g.restore();
}

/** 画面全体を覆う暗幕 */
export function drawOverlay(g: Ctx, w: number, h: number, alpha = 0.62): void {
  g.save();
  g.fillStyle = `rgba(0,0,0,${alpha})`;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** 下向きの「続きがある」三角（ログや一覧のスクロール表示） */
export function drawScrollArrow(g: Ctx, x: number, y: number, down: boolean, t: number): void {
  const bob = Math.sin(t / 220) * 2;
  g.save();
  g.fillStyle = UI.cursorEdge;
  g.beginPath();
  if (down) {
    g.moveTo(x - 7, y - 4 + bob);
    g.lineTo(x + 7, y - 4 + bob);
    g.lineTo(x, y + 5 + bob);
  } else {
    g.moveTo(x - 7, y + 4 - bob);
    g.lineTo(x + 7, y + 4 - bob);
    g.lineTo(x, y - 5 - bob);
  }
  g.closePath();
  g.fill();
  g.restore();
}

/** 小さなバッジ（装備中・呪い・個数など） */
export function drawBadge(
  g: Ctx, text: string, x: number, y: number, color: string, size = 14,
): number {
  g.save();
  g.font = font(size, 'bold');
  const w = g.measureText(text).width + 10;
  const h = size + 6;
  g.fillStyle = color;
  roundRect(g, x, y, w, h, 3);
  g.fill();
  g.fillStyle = '#10101a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + w / 2, y + h / 2 + 1);
  g.restore();
  return w;
}
