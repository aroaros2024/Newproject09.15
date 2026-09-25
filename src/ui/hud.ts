/**
 * HUD。ステータス・階層表示・状態異常の札・ショートカット。
 *
 * 世界を広く見せるため、四隅に小さくまとめる（配置は theme.ts の LAYOUT）。
 * 枠は新しい UI の決まり（紺の地・金の二重線）。名前と階は明朝。
 */

import type { PlayerActor, StatusEffect } from '../core/types.js';
import { expToNext } from '../game/rules.js';
import { STATUS_NAME } from '../game/status.js';
import { foodDisplay, maxFoodDisplay } from '../game/hunger.js';
import { type Ctx, drawBar, drawPanel, drawText, ellipsize } from './draw.js';
import { drawIconKey } from './gfx/icons.js';
import { LAYOUT, UI, font, hpColor } from './theme.js';
import { PANEL } from './ui2/tokens.js';

/** 状態異常の短い表示名（札に入れる 1 文字） */
const STATUS_ICON: Record<string, { ch: string; color: string }> = {
  confused: { ch: '乱', color: '#e070d0' },
  blind: { ch: '盲', color: '#9a9aaa' },
  asleep: { ch: '眠', color: '#8090f0' },
  deepAsleep: { ch: '睡', color: '#6070d0' },
  bound: { ch: '縛', color: '#e0c040' },
  paralyzed: { ch: '痺', color: '#e0a040' },
  fainted: { ch: '気', color: '#d08070' },
  poisoned: { ch: '毒', color: '#80d070' },
  deadlyPoisoned: { ch: '猛', color: '#50b050' },
  burning: { ch: '炎', color: '#ff8040' },
  wet: { ch: '濡', color: '#60b0f0' },
  slow: { ch: '鈍', color: '#90a0b0' },
  quick: { ch: '速', color: '#70f0d0' },
  invisible: { ch: '透', color: '#b0e0ff' },
  sealed: { ch: '封', color: '#c070d0' },
  hungryFast: { ch: '飢', color: '#f0a050' },
  strUp: { ch: '力', color: '#ffa070' },
  trapped: { ch: '罠', color: '#d09050' },
  levitate: { ch: '浮', color: '#b0f0ff' },
  terrified: { ch: '怯', color: '#d0b0f0' },
  invincible: { ch: '無', color: '#fff070' },
};

export interface FloorInfo {
  dungeonName: string;
  depth: number;
  turn: number;
  /** 風が吹き始めているか */
  windy: boolean;
  /** 最深部か */
  bottom: boolean;
  /** ショートカットの見え方（数字キー 1〜9） */
  shortcuts: ShortcutView[];
}

/** ショートカット 1 枠の表示内容 */
export interface ShortcutView {
  defId: string | null;
  label: string;
  sprite: string | null;
  count: number;
}

export class Hud {
  /** HP バーの追従表示（減った分がゆっくり追いつく） */
  private hpTrail = 1;

  update(p: PlayerActor, dt: number): void {
    const target = p.maxHp > 0 ? p.hp / p.maxHp : 0;
    if (this.hpTrail > target) {
      this.hpTrail = Math.max(target, this.hpTrail - (dt / 1000) * 0.6);
    } else {
      this.hpTrail = target;
    }
  }

  /** frame は昔の呼び出しとの互換のため残している（枠は常に金） */
  draw(g: Ctx, p: PlayerActor, info: FloorInfo, _frame?: string): void {
    this.drawStatus(g, p);
    this.drawStatusIcons(g, p);
    this.drawFloor(g, info);
    this.drawShortcuts(g, info);
  }

  /**
   * ショートカット。数字キー 1〜9 に割り当てた道具を出しておく。
   *
   * 「持ち物の何番目」を覚えるのは無理なので、割り当てた物を常に見せる。
   * 覚えているのは道具の種類なので、並べ替えても 0 個になっても枠は残る。
   */
  private drawShortcuts(g: Ctx, info: FloorInfo): void {
    const r = LAYOUT.shortcuts;
    drawPanel(g, r, { ornaments: false });
    const slots = info.shortcuts;
    const pad = 8;
    const cellW = Math.floor((r.w - pad * 2) / slots.length);
    for (let i = 0; i < slots.length; i++) {
      const x = r.x + pad + cellW * i;
      const s = slots[i];
      const empty = s.defId === null;
      const out = !empty && s.count === 0;

      // 升目（割り当て済みだけ金の細線を濃く）
      g.save();
      g.fillStyle = empty ? 'rgba(122,101,56,0.25)' : out ? 'rgba(122,101,56,0.45)' : 'rgba(200,168,105,0.55)';
      g.fillRect(x + 2, r.y + 6, cellW - 4, 1);
      g.fillRect(x + 2, r.y + r.h - 7, cellW - 4, 1);
      g.fillRect(x + 2, r.y + 6, 1, r.h - 12);
      g.fillRect(x + cellW - 3, r.y + 6, 1, r.h - 12);
      g.restore();
      // 番号
      drawText(g, `${i + 1}`, x + 7, r.y + 21, {
        size: 14, bold: true, color: empty || out ? UI.textDim : UI.cursorEdge,
      });
      if (empty) continue;
      // 個数（切らしていたら赤く 0）。番号と同じ行に寄せて、下段を名前に空ける
      drawText(g, `${s.count}`, x + cellW - 7, r.y + 21, {
        size: 14, bold: true, align: 'right',
        color: out ? '#d07060' : UI.gitan,
      });
      // アイコン
      if (s.sprite) drawIconKey(g, s.sprite, x + cellW / 2, r.y + 34, 32, 0, { alpha: out ? 0.3 : 1 });
      // 名前。草・巻物・杖は種類に 1 つしか絵が無いので、
      // 名前を出さないと何番に何を入れたのか分からない
      if (s.label) {
        drawText(g, ellipsize(g, s.label, cellW - 8, 14), x + cellW / 2, r.y + r.h - 12, {
          size: 14, align: 'center',
          color: out ? UI.textDim : UI.text,
          outline: 'rgba(11,16,32,0.9)', outlineWidth: 3,
        });
      }
    }
  }

  private drawStatus(g: Ctx, p: PlayerActor): void {
    const r = LAYOUT.status;
    drawPanel(g, r);
    const left = r.x + 18;

    // 1 行目：名前・レベル・次まで
    drawText(g, p.name, left, r.y + 32, {
      size: 22, bold: true, family: 'serif', color: PANEL.goldLight, maxWidth: 150,
    });
    g.save();
    g.font = font(22, 'bold', 'serif');
    const nameW = Math.min(150, g.measureText(p.name).width);
    g.restore();
    drawText(g, `Lv ${p.level}`, left + Math.max(96, nameW + 18), r.y + 32, {
      size: 20, bold: true, family: 'serif', color: UI.cursorEdge,
    });
    const toNext = expToNext(p.level, p.exp);
    drawText(g, toNext > 0 ? `つぎ ${toNext}` : '最大', r.x + r.w - 18, r.y + 31, {
      size: 15, align: 'right', color: UI.textDim,
    });

    // 2 行目：HP
    const hpRatio = p.maxHp > 0 ? p.hp / p.maxHp : 0;
    drawText(g, 'HP', left, r.y + 64, { size: 15, color: UI.textDim });
    drawText(g, `${p.hp}`, left + 78, r.y + 65, {
      size: 22, bold: true, align: 'right', color: hpColor(hpRatio),
    });
    drawText(g, `/${p.maxHp}`, left + 80, r.y + 65, { size: 15, color: UI.textDim });
    const bar = { x: r.x + 150, y: r.y + 52, w: 220, h: 14 };
    // 減った分の残像を先に描き、その上に今の HP を重ねる
    drawBar(g, bar, { ratio: this.hpTrail, color: '#8a3a36' });
    const fw = Math.round((bar.w - 2) * Math.max(0, Math.min(1, hpRatio)));
    if (fw > 0) {
      g.save();
      g.fillStyle = hpColor(hpRatio);
      g.fillRect(bar.x + 1, bar.y + 1, fw, bar.h - 2);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(bar.x + 1, bar.y + 1, fw, 1);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(bar.x + 1, bar.y + bar.h - 2, fw, 1);
      g.restore();
    }

    // 3 行目：満腹・ちから・ギタン
    const foodRatio = p.maxFoodX10 > 0 ? p.foodX10 / p.maxFoodX10 : 0;
    const hungry = foodRatio < 0.2;
    drawText(g, '満腹', left, r.y + 92, { size: 15, color: UI.textDim });
    drawBar(g, { x: left + 40, y: r.y + 82, w: 70, h: 10 }, {
      ratio: foodRatio, color: hungry ? UI.danger : UI.food, caps: false,
    });
    drawText(g, `${foodDisplay(p)}`, left + 150, r.y + 93, {
      size: 17, bold: true, align: 'right', color: hungry ? UI.danger : UI.text,
    });
    drawText(g, `/${maxFoodDisplay(p)}`, left + 151, r.y + 93, { size: 13, color: UI.textDim });
    drawText(g, 'ちから', left + 192, r.y + 92, { size: 15, color: UI.textDim });
    drawText(g, `${p.str}/${p.maxStr}`, left + 272, r.y + 93, {
      size: 17, bold: true, align: 'right', color: p.str < p.maxStr ? UI.warn : UI.text,
    });
    drawText(g, `${p.gitan.toLocaleString('ja-JP')}G`, r.x + r.w - 18, r.y + 93, {
      size: 17, bold: true, align: 'right', color: UI.gitan,
    });
  }

  private drawStatusIcons(g: Ctx, p: PlayerActor): void {
    const active: StatusEffect[] = p.statuses.filter((s) => s.turns !== 0);
    if (active.length === 0) return;
    const r = LAYOUT.statusIcons;
    let x = r.x;
    for (const s of active.slice(0, 10)) {
      const icon = STATUS_ICON[s.id] ?? { ch: '？', color: UI.textDim };
      g.save();
      g.fillStyle = 'rgba(11,16,32,0.88)';
      g.fillRect(x, r.y, 34, 34);
      g.fillStyle = icon.color;
      g.fillRect(x, r.y, 34, 2);
      g.fillRect(x, r.y + 32, 34, 2);
      g.fillRect(x, r.y, 2, 34);
      g.fillRect(x + 32, r.y, 2, 34);
      g.restore();
      drawText(g, icon.ch, x + 17, r.y + 24, {
        size: 19, bold: true, align: 'center', color: icon.color, family: 'serif',
      });
      // 残りターンが少ないと点滅させる
      if (s.turns > 0 && s.turns <= 3) {
        g.save();
        g.globalAlpha = 0.35;
        g.fillStyle = icon.color;
        g.fillRect(x + 2, r.y + 2, 30, 30);
        g.restore();
      }
      if (s.turns > 0) {
        drawText(g, String(s.turns), x + 31, r.y + 38, {
          size: 12, align: 'right', color: UI.text,
          outline: '#0b1020', outlineWidth: 3,
        });
      }
      x += 38;
    }
    if (active.length > 10) {
      drawText(g, `+${active.length - 10}`, x + 4, r.y + 24, {
        size: 15, color: UI.textDim,
      });
    }
  }

  private drawFloor(g: Ctx, info: FloorInfo): void {
    const r = LAYOUT.floor;
    drawPanel(g, r, { ornaments: false });
    drawText(g, info.dungeonName, r.x + 14, r.y + 22, {
      size: 14, color: UI.textDim, maxWidth: r.w - 50,
    });
    drawText(g, `B${info.depth}F`, r.x + 14, r.y + 50, {
      size: 26, bold: true, family: 'serif',
      color: info.bottom ? UI.cursorEdge : PANEL.goldLight,
    });
    drawText(g, `ターン ${info.turn}`, r.x + r.w - 14, r.y + 49, {
      size: 15, align: 'right', color: UI.textDim,
    });
    if (info.windy) {
      drawText(g, '風', r.x + r.w - 14, r.y + 22, {
        size: 15, bold: true, align: 'right', color: UI.warn, family: 'serif',
      });
    }
  }
}

/** 状態異常の名前（ツールチップやログ用） */
export { STATUS_NAME };
