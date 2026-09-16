/**
 * メッセージログ。
 *
 * シレンのログは「直近 3 行が画面上部に出て、しばらくすると薄くなる」形式。
 * 同じ文が続いたら「×n」に畳み、履歴は全画面で読み返せる。
 */

import type { LogStyle } from '../core/types.js';
import { ANIM, LAYOUT, LOG_COLOR, UI } from './theme.js';
import { type Ctx, drawPanel, drawText, wrapText } from './draw.js';

export interface LogEntry {
  text: string;
  style: LogStyle;
  /** 同じ文が続いた回数 */
  count: number;
  /** 追加された時刻(ms) */
  at: number;
}

const HISTORY_LIMIT = 200;
const VISIBLE_LINES = 3;
const LINE_H = 28;

export class MessageLog {
  private entries: LogEntry[] = [];
  /** 文字送りの進み具合（最後の行の表示文字数） */
  private revealed = 0;
  private lastAddedAt = 0;
  /** 文字送りを飛ばす（A ボタン長押し） */
  fastForward = false;

  /** 1 文字あたりのミリ秒。設定で変わる */
  cps: number = ANIM.messageCps;

  add(text: string, style: LogStyle = 'normal', now = 0): void {
    const last = this.entries[this.entries.length - 1];
    if (last && last.text === text && last.style === style && last.count < 99) {
      last.count++;
      last.at = now;
      this.lastAddedAt = now;
      return;
    }
    this.entries.push({ text, style, count: 1, at: now });
    if (this.entries.length > HISTORY_LIMIT) this.entries.shift();
    this.revealed = 0;
    this.lastAddedAt = now;
  }

  clear(): void {
    this.entries = [];
    this.revealed = 0;
  }

  get history(): readonly LogEntry[] {
    return this.entries;
  }

  /** 文字送りが途中か */
  isTyping(): boolean {
    const last = this.entries[this.entries.length - 1];
    if (!last) return false;
    return this.revealed < this.displayText(last).length;
  }

  /** 文字送りを最後まで飛ばす */
  skipTyping(): void {
    const last = this.entries[this.entries.length - 1];
    if (last) this.revealed = this.displayText(last).length;
  }

  private displayText(e: LogEntry): string {
    return e.count > 1 ? `${e.text} ×${e.count}` : e.text;
  }

  update(dtMs: number): void {
    const last = this.entries[this.entries.length - 1];
    if (!last) return;
    const full = this.displayText(last).length;
    if (this.revealed >= full) return;
    const speed = this.fastForward ? 0.5 : this.cps;
    if (speed <= 0) {
      this.revealed = full;
      return;
    }
    this.revealed = Math.min(full, this.revealed + dtMs / speed);
  }

  /** ログ表示の不透明度（しばらく経つと薄くなる） */
  private alphaAt(now: number): number {
    const age = now - this.lastAddedAt;
    if (age <= ANIM.messageHold) return 1;
    const t = Math.min(1, (age - ANIM.messageHold) / ANIM.messageFade);
    return 1 - t * 0.65;
  }

  /** 画面上部に直近 3 行を描く */
  draw(g: Ctx, now: number): void {
    if (this.entries.length === 0) return;
    const r = LAYOUT.message;
    const alpha = this.alphaAt(now);

    // 折り返しを考慮して、後ろから 3 行ぶん取り出す
    const lines: Array<{ text: string; style: LogStyle }> = [];
    for (let i = this.entries.length - 1; i >= 0 && lines.length < VISIBLE_LINES + 2; i--) {
      const e = this.entries[i];
      let text = this.displayText(e);
      if (i === this.entries.length - 1) text = text.slice(0, Math.floor(this.revealed));
      const wrapped = wrapText(g, text, r.w - 32, 18);
      for (let j = wrapped.length - 1; j >= 0; j--) {
        lines.unshift({ text: wrapped[j], style: e.style });
      }
    }
    const shown = lines.slice(-VISIBLE_LINES);
    if (shown.length === 0) return;

    g.save();
    g.globalAlpha = alpha;
    drawPanel(g, r, { alpha: alpha * 0.9 });
    shown.forEach((line, i) => {
      drawText(g, line.text, r.x + 16, r.y + 34 + i * LINE_H, {
        size: 18,
        color: LOG_COLOR[line.style] ?? UI.text,
        outline: 'rgba(0,0,0,0.8)',
        outlineWidth: 3,
      });
    });
    // 文字送り中は「▼」を出さない
    if (!this.isTyping() && this.entries.length > VISIBLE_LINES) {
      drawText(g, '▼', r.x + r.w - 26, r.y + r.h - 12, {
        size: 14, color: UI.textDim,
      });
    }
    g.restore();
  }

  /** 全画面のログ履歴 */
  drawHistory(g: Ctx, w: number, h: number, scroll: number): number {
    g.save();
    g.fillStyle = 'rgba(6,6,12,0.94)';
    g.fillRect(0, 0, w, h);
    drawText(g, 'これまでのできごと', w / 2, 52, {
      size: 26, bold: true, align: 'center', color: UI.cursorEdge,
    });

    const top = 90;
    const bottom = h - 60;
    const rows = Math.floor((bottom - top) / 26);
    const all: Array<{ text: string; style: LogStyle }> = [];
    for (const e of this.entries) {
      const text = e.count > 1 ? `${e.text} ×${e.count}` : e.text;
      for (const line of wrapText(g, text, w - 160, 17)) {
        all.push({ text: line, style: e.style });
      }
    }
    const maxScroll = Math.max(0, all.length - rows);
    const start = Math.max(0, Math.min(maxScroll, scroll));
    all.slice(start, start + rows).forEach((line, i) => {
      drawText(g, line.text, 80, top + 20 + i * 26, {
        size: 17, color: LOG_COLOR[line.style] ?? UI.text,
      });
    });

    drawText(g, '↑↓ でスクロール　　B で閉じる', w / 2, h - 28, {
      size: 16, align: 'center', color: UI.textDim,
    });
    g.restore();
    return maxScroll;
  }
}
