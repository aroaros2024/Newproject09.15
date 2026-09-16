/**
 * HUD。ステータス・階層表示・状態異常アイコン。
 */

import type { PlayerActor, StatusEffect } from '../core/types.js';
import { expToNext } from '../game/rules.js';
import { STATUS_NAME } from '../game/status.js';
import { foodDisplay, maxFoodDisplay } from '../game/hunger.js';
import { type Ctx, drawBar, drawPanel, drawText, roundRect } from './draw.js';
import { LAYOUT, UI, hpColor } from './theme.js';

/** 状態異常の短い表示名（アイコンに入れる 1 文字） */
const STATUS_ICON: Record<string, { ch: string; color: string }> = {
  confused: { ch: '乱', color: '#e070d0' },
  blind: { ch: '盲', color: '#8a8a9a' },
  asleep: { ch: '眠', color: '#7080e0' },
  deepAsleep: { ch: '睡', color: '#5060c0' },
  bound: { ch: '縛', color: '#e0c040' },
  paralyzed: { ch: '痺', color: '#e0a040' },
  fainted: { ch: '気', color: '#c07060' },
  poisoned: { ch: '毒', color: '#70c060' },
  deadlyPoisoned: { ch: '猛', color: '#40a040' },
  burning: { ch: '炎', color: '#ff7030' },
  wet: { ch: '濡', color: '#50a0e0' },
  slow: { ch: '鈍', color: '#8090a0' },
  quick: { ch: '速', color: '#60e0c0' },
  invisible: { ch: '透', color: '#a0d0f0' },
  sealed: { ch: '封', color: '#b060c0' },
  hungryFast: { ch: '飢', color: '#e09040' },
  strUp: { ch: '力', color: '#ff9060' },
  trapped: { ch: '罠', color: '#c08040' },
  levitate: { ch: '浮', color: '#a0e0ff' },
  terrified: { ch: '怯', color: '#c0a0e0' },
  invincible: { ch: '無', color: '#ffe060' },
};

export interface FloorInfo {
  dungeonName: string;
  depth: number;
  turn: number;
  /** 風が吹き始めているか */
  windy: boolean;
  /** 最深部か */
  bottom: boolean;
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

  draw(g: Ctx, p: PlayerActor, info: FloorInfo, frame: string): void {
    this.drawStatus(g, p, frame);
    this.drawStatusIcons(g, p);
    this.drawFloor(g, info, frame);
  }

  private drawStatus(g: Ctx, p: PlayerActor, frame: string): void {
    const r = LAYOUT.status;
    drawPanel(g, r, { frame });

    const left = r.x + 20;
    drawText(g, p.name, left, r.y + 30, { size: 20, bold: true });
    drawText(g, `Lv ${p.level}`, left + 150, r.y + 30, { size: 20, bold: true, color: UI.exp });

    const toNext = expToNext(p.level, p.exp);
    drawText(g, toNext > 0 ? `次まで ${toNext}` : '最大レベル',
      r.x + r.w - 20, r.y + 30, { size: 13, align: 'right', color: UI.textDim });

    // HP
    const hpRatio = p.maxHp > 0 ? p.hp / p.maxHp : 0;
    drawText(g, 'HP', left, r.y + 58, { size: 15, color: UI.textDim });
    drawText(g, `${p.hp}`, left + 78, r.y + 58, {
      size: 19, bold: true, align: 'right', color: hpColor(hpRatio),
    });
    drawText(g, `/${p.maxHp}`, left + 80, r.y + 58, { size: 15, color: UI.textDim });
    const barRect = { x: left + 140, y: r.y + 45, w: 268, h: 16 };
    // 減った分の残像を先に描く
    drawBar(g, barRect, { ratio: this.hpTrail, color: 'rgba(255,90,90,0.45)' });
    g.save();
    roundRect(g, barRect.x, barRect.y, barRect.w, barRect.h, 3);
    g.clip();
    drawBar(g, barRect, { ratio: hpRatio, color: hpColor(hpRatio), bg: 'transparent' });
    g.restore();

    // 満腹度とちから
    const foodRatio = p.maxFoodX10 > 0 ? p.foodX10 / p.maxFoodX10 : 0;
    drawText(g, '満腹', left, r.y + 84, { size: 15, color: UI.textDim });
    drawText(g, `${foodDisplay(p)}/${maxFoodDisplay(p)}`, left + 80, r.y + 84, {
      size: 15, align: 'right', color: foodRatio < 0.2 ? UI.danger : UI.text,
    });
    drawBar(g, { x: left + 92, y: r.y + 72, w: 120, h: 12 }, {
      ratio: foodRatio, color: foodRatio < 0.2 ? UI.danger : UI.food,
    });

    drawText(g, 'ちから', left + 232, r.y + 84, { size: 15, color: UI.textDim });
    drawText(g, `${p.str}/${p.maxStr}`, left + 310, r.y + 84, {
      size: 15, align: 'right', color: p.str < p.maxStr ? UI.warn : UI.text,
    });

    drawText(g, `${p.gitan.toLocaleString('ja-JP')} G`, r.x + r.w - 20, r.y + 84, {
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
      g.fillStyle = 'rgba(10,10,16,0.82)';
      roundRect(g, x, r.y, 36, 36, 5);
      g.fill();
      g.strokeStyle = icon.color;
      g.lineWidth = 2;
      roundRect(g, x + 1, r.y + 1, 34, 34, 4);
      g.stroke();
      drawText(g, icon.ch, x + 18, r.y + 25, {
        size: 19, bold: true, align: 'center', color: icon.color,
      });
      // 残りターンが少ないと点滅させる
      if (s.turns > 0 && s.turns <= 3) {
        g.globalAlpha = 0.5;
        g.fillStyle = icon.color;
        roundRect(g, x + 1, r.y + 1, 34, 34, 4);
        g.fill();
      }
      g.restore();
      if (s.turns > 0) {
        drawText(g, String(s.turns), x + 32, r.y + 38, {
          size: 11, align: 'right', color: UI.textDim,
          outline: '#000', outlineWidth: 3,
        });
      }
      x += 42;
    }
    if (active.length > 10) {
      drawText(g, `+${active.length - 10}`, x + 4, r.y + 25, {
        size: 14, color: UI.textDim,
      });
    }
  }

  private drawFloor(g: Ctx, info: FloorInfo, frame: string): void {
    const r = LAYOUT.floor;
    drawPanel(g, r, { frame });
    const cx = r.x + r.w / 2;
    drawText(g, info.dungeonName, cx, r.y + 26, {
      size: 14, align: 'center', color: UI.textDim,
    });
    drawText(g, `B ${info.depth} F`, cx, r.y + 58, {
      size: 28, bold: true, align: 'center',
      color: info.bottom ? UI.cursorEdge : UI.text,
    });
    drawText(g, `ターン ${info.turn}`, cx, r.y + 82, {
      size: 13, align: 'center', color: UI.textDim,
    });
    if (info.windy) {
      drawText(g, '［風］', r.x + r.w - 14, r.y + 24, {
        size: 14, align: 'right', color: UI.warn,
      });
    }
  }
}

/** 状態異常の名前（ツールチップやログ用） */
export { STATUS_NAME };
