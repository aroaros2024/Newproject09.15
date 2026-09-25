/**
 * 操作ヘルプ。
 */

import { type Ctx, drawOverlay, drawPanel, drawText, drawTitlePlaque } from '../draw.js';
import { UI } from '../theme.js';

const SECTIONS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: '移動',
    rows: [
      ['↑ ↓ ← → / W A S D', '8 方向へ歩く（2 キー同時押しで斜め）'],
      ['テンキー 1 3 7 9', '斜めへ直接歩く'],
      ['Q（押しながら）', '斜め移動に固定する'],
      ['R（押しながら）', 'その場で向きだけ変える'],
      ['Shift / X ＋ 方向', 'ダッシュ（曲がり角・敵・アイテムで止まる）'],
      ['.（ピリオド）', 'その場で 1 ターン待つ'],
    ],
  },
  {
    title: '戦う・調べる',
    rows: [
      ['Z / Enter / Space', '向いている方向へ攻撃・決定'],
      ['敵に向かって歩く', '攻撃する'],
      ['Shift ＋ .', '階段を降りる'],
      ['F', '足元のメニュー'],
    ],
  },
  {
    title: 'メニュー',
    rows: [
      ['E / Esc', 'メインメニュー'],
      ['I', '持ち物を直接開く'],
      ['T', '特殊メニュー（休む・名前をつける）'],
      ['C', '作戦メニュー（仲間への指示）'],
      ['1〜9', 'ショートカットに入れた道具をすぐ使う'],
      ['F', '一覧を整理する（持ち物・倉庫・売る・持ち込み）'],
      ['Esc / BackSpace / X', '一つ戻る'],
    ],
  },
  {
    title: '画面',
    rows: [
      ['Tab（押している間）', '全体図を見る'],
      ['M', 'ミニマップ 通常 → 拡大 → 消す'],
      ['L', 'これまでのできごと'],
      ['P', 'プレイログをコピー（この冒険を再現できる記録）'],
      ['H / F1', 'このヘルプ'],
    ],
  },
  {
    title: '覚えておくこと',
    rows: [
      ['満腹度', '0 になると HP が減り続ける。食料は大事に'],
      ['未識別のアイテム', '飲む・読む・店で売ると種類が分かる'],
      ['呪われた装備', '外せなくなる。解呪の巻物かおはらいの壺で'],
      ['モンスターハウス', '部屋中が敵。巻物や杖で切り抜ける'],
      ['不定の風', '長居しすぎると次の階へ飛ばされる'],
    ],
  },
];

export function drawHelp(g: Ctx, w: number, h: number): void {
  drawOverlay(g, w, h, 0.78);
  const r = { x: 40, y: 28, w: w - 80, h: h - 56 };
  drawPanel(g, r);
  drawTitlePlaque(g, '操作方法', r.x + 20, r.y + 14, { size: 24 });

  const colW = (r.w - 80) / 2;
  let x = r.x + 32;
  let y = r.y + 88;
  let col = 0;
  for (const section of SECTIONS) {
    const needed = 34 + section.rows.length * 28;
    if (y + needed > r.y + r.h - 50 && col === 0) {
      col = 1;
      x = r.x + 32 + colW + 24;
      y = r.y + 88;
    }
    drawText(g, section.title, x, y, {
      size: 20, bold: true, family: 'serif', color: UI.cursorEdge,
    });
    y += 30;
    for (const [key, desc] of section.rows) {
      drawText(g, key, x + 8, y, { size: 17, bold: true, color: UI.equip });
      drawText(g, desc, x + 200, y, { size: 17, color: UI.text });
      y += 28;
    }
    y += 12;
  }

  drawText(g, 'B / Esc で閉じる', w / 2, r.y + r.h - 20, {
    size: 16, align: 'center', color: UI.textDim,
  });
}
