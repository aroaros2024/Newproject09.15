/**
 * ガチャの演出。
 *
 * 画面を持たず、村の画面の上に重ねて描くだけの小さな状態機械。
 * 引く処理そのものは game/gacha.ts が済ませていて、ここは
 * 「決まった結果をどう見せるか」しか持たない。
 *
 * 見せ方は 3 段。
 *   ため   石が集まり、脈打つ。この時点では色を出さない
 *   はじけ  光が弾ける。ここで初めてレア度の色が出る
 *   結果   名前と説明。A で次へ
 *
 * レア度が高いほど「ため」が長い。長く待たされるほど期待が上がるので、
 * 色を出す前の時間そのものが演出になる。
 */

import type { PullResult } from '../game/gacha.js';
import { RARITY_COLOR, RARITY_LABEL, type Rarity } from '../data/gacha.js';
import { type Ctx, drawOverlay, drawPanel, drawText, wrapText } from './draw.js';
import { getSprite, sprites } from './sprites.js';
import { tryGetItem } from '../data/registry.js';
import { tryGetPartner } from '../data/partners.js';
import { SCREEN_H, SCREEN_W, UI } from './theme.js';

type Phase = 'charge' | 'burst' | 'reveal' | 'summary';

/** レア度ごとの「ため」の長さ（ミリ秒） */
const CHARGE_MS: Record<Rarity, number> = { n: 420, r: 620, sr: 900, ssr: 1400 };
const BURST_MS = 320;

export class GachaAnim {
  private phase: Phase = 'charge';
  private t = 0;
  private index = 0;
  private skipped = false;

  constructor(
    private results: PullResult[],
    /** 全部見終わったときに呼ばれる */
    private onDone: () => void,
  ) {}

  get current(): PullResult | undefined {
    return this.results[this.index];
  }

  private get chargeMs(): number {
    if (this.skipped) return 60;
    return CHARGE_MS[this.current?.prize.rarity ?? 'n'];
  }

  /** 経過時間を進める。ミリ秒 */
  update(dt: number): void {
    this.t += dt;
    if (this.phase === 'charge' && this.t >= this.chargeMs) {
      this.phase = 'burst';
      this.t = 0;
    } else if (this.phase === 'burst' && this.t >= BURST_MS) {
      this.phase = 'reveal';
      this.t = 0;
    }
  }

  /**
   * 決定キー。
   *
   * 「ため」の途中で押したら飛ばす。10 連を毎回最後まで見せられると、
   * 2 回目からは演出ではなく待ち時間になる。
   */
  advance(): void {
    if (this.phase === 'charge' || this.phase === 'burst') {
      this.skipped = true;
      this.phase = 'reveal';
      this.t = 0;
      return;
    }
    if (this.phase === 'summary') {
      this.onDone();
      return;
    }
    this.index++;
    if (this.index >= this.results.length) {
      // 1 回だけのときに一覧を出しても同じものを 2 度見せるだけ
      if (this.results.length <= 1) {
        this.onDone();
        return;
      }
      this.phase = 'summary';
      this.t = 0;
      return;
    }
    this.phase = 'charge';
    this.t = 0;
  }

  draw(g: Ctx, now: number): void {
    drawOverlay(g, SCREEN_W, SCREEN_H, 0.93);
    if (this.phase === 'summary') {
      this.drawSummary(g);
      return;
    }
    const r = this.current;
    if (!r) return;

    const cx = SCREEN_W / 2;
    const cy = SCREEN_H / 2 - 30;
    const color = RARITY_COLOR[r.prize.rarity];

    if (this.phase === 'charge') {
      // 色はまだ出さない。何が出るか分かってしまう
      const p = Math.min(1, this.t / this.chargeMs);
      const pulse = 1 + Math.sin(now / 90) * 0.08;
      this.drawOrb(g, cx, cy, (26 + p * 34) * pulse, '#c8c8d4', 0.25 + p * 0.5);
      drawText(g, '……', cx, cy + 130, {
        size: 20, align: 'center', color: UI.textDim,
      });
    } else if (this.phase === 'burst') {
      const p = Math.min(1, this.t / BURST_MS);
      this.drawOrb(g, cx, cy, 60 + p * 220, color, (1 - p) * 0.8);
      this.drawRays(g, cx, cy, p, color);
    } else {
      this.drawCard(g, cx, cy, r, now);
    }

    if (this.results.length > 1) {
      drawText(g, `${this.index + 1} / ${this.results.length}`,
        SCREEN_W - 40, 44, { size: 16, align: 'right', color: UI.textDim });
    }
    drawText(g, this.phase === 'reveal' ? 'A：次へ' : 'A：飛ばす',
      SCREEN_W / 2, SCREEN_H - 34, { size: 15, align: 'center', color: UI.textDim });
  }

  private drawOrb(g: Ctx, x: number, y: number, r: number, color: string, alpha: number): void {
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    grad.addColorStop(0, color);
    grad.addColorStop(0.55, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawRays(g: Ctx, x: number, y: number, p: number, color: string): void {
    g.save();
    g.globalAlpha = (1 - p) * 0.7;
    g.strokeStyle = color;
    g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12;
      const r0 = 40 + p * 120;
      const r1 = r0 + 80;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      g.stroke();
    }
    g.restore();
  }

  /** 景品の絵。加護には絵が無いので null */
  private spriteOf(r: PullResult): string | null {
    if (r.prize.partnerId) return tryGetPartner(r.prize.partnerId)?.baseId ?? null;
    if (r.prize.itemId) return tryGetItem(r.prize.itemId)?.sprite ?? r.prize.itemId;
    return null;
  }

  private drawCard(g: Ctx, cx: number, cy: number, r: PullResult, now: number): void {
    const color = RARITY_COLOR[r.prize.rarity];
    const box = { x: cx - 210, y: cy - 160, w: 420, h: 330 };

    // SSR と SR は後ろで光り続ける
    if (r.prize.rarity === 'ssr' || r.prize.rarity === 'sr') {
      this.drawOrb(g, cx, cy, 200 + Math.sin(now / 200) * 16, color, 0.3);
    }
    drawPanel(g, box, { frame: color, alpha: 0.97 });

    drawText(g, RARITY_LABEL[r.prize.rarity], cx, box.y + 40, {
      size: 26, bold: true, align: 'center', color,
    });

    // 絵。SSR は大きく出す
    const spriteId = this.spriteOf(r);
    const icon = spriteId ? getSprite(spriteId) : null;
    const artY = box.y + 130;
    if (icon && spriteId) {
      const size = r.prize.rarity === 'ssr' ? 104 : 76;
      // 台座。絵が背景に溶けないように敷く
      g.save();
      g.globalAlpha = 0.16;
      g.fillStyle = color;
      g.beginPath();
      g.arc(cx, artY, size * 0.72, 0, Math.PI * 2);
      g.fill();
      g.restore();
      sprites.draw(g, spriteId, icon, cx, artY, size, {});
    } else {
      // 加護は絵の代わりに印を出す
      g.save();
      g.globalAlpha = 0.9;
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, artY, 38, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      drawText(g, '加護', cx, artY + 7, {
        size: 20, bold: true, align: 'center', color,
      });
    }

    drawText(g, r.prize.name, cx, box.y + 218, {
      size: 24, bold: true, align: 'center', color: UI.text,
    });

    const lines = wrapText(g, this.noteOf(r), box.w - 50, 15).slice(0, 3);
    lines.forEach((line, i) => {
      drawText(g, line, cx, box.y + 258 + i * 24, {
        size: 15, align: 'center', color: UI.textDim,
      });
    });
  }

  /** その 1 回で何が起きたかを 1 行で */
  private noteOf(r: PullResult): string {
    if (r.bond) return '同じ 相棒。育てられる レベルの 上限が 上がった。';
    if (r.prize.partnerId) return '冒険の 最初から 連れて行ける。倒れても 次の冒険で 戻る。';
    if (r.prize.boost) {
      if (r.refund > 0) return `これ以上は 効かない。${r.refund} 石に 戻した。`;
      return '村に 残る 効果。';
    }
    if (r.lost > 0) return '倉庫が いっぱいで 入らなかった。';
    const n = r.prize.count ?? 1;
    return n > 1 ? `倉庫に ${n} 個 届いた。` : '倉庫に 届いた。';
  }

  private drawSummary(g: Ctx): void {
    const box = { x: 240, y: 70, w: 800, h: 560 };
    drawPanel(g, box, { alpha: 0.95 });
    drawText(g, '引いたもの', box.x + 24, box.y + 36, {
      size: 20, bold: true, color: UI.cursorEdge,
    });

    this.results.forEach((r, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = box.x + 30 + col * 390;
      const y = box.y + 80 + row * 46;
      const color = RARITY_COLOR[r.prize.rarity];
      drawText(g, RARITY_LABEL[r.prize.rarity], x, y, { size: 15, bold: true, color });
      drawText(g, r.prize.name, x + 52, y, { size: 17, color: UI.text });
      const tail = r.bond ? '絆 +1'
        : r.refund > 0 ? `${r.refund} 石`
          : r.lost > 0 ? '入らず'
            : (r.prize.count ?? 1) > 1 ? `×${r.prize.count}` : '';
      if (tail) {
        drawText(g, tail, x + 360, y, { size: 15, align: 'right', color: UI.textDim });
      }
    });

    drawText(g, 'A：閉じる', SCREEN_W / 2, box.y + box.h - 24, {
      size: 15, align: 'center', color: UI.textDim,
    });
  }
}
