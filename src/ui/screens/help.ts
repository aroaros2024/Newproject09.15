/**
 * 操作ヘルプ。
 */

import { type Ctx, drawText } from '../draw.js';
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
      ['1〜0', 'その番号の道具をすぐ使う'],
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
  g.save();
  g.fillStyle = 'rgba(6,6,12,0.95)';
  g.fillRect(0, 0, w, h);
  drawText(g, '操作方法', w / 2, 48, {
    size: 26, bold: true, align: 'center', color: UI.cursorEdge,
  });

  const colW = (w - 120) / 2;
  let x = 60;
  let y = 90;
  let col = 0;
  for (const section of SECTIONS) {
    const needed = 30 + section.rows.length * 24;
    if (y + needed > h - 60 && col === 0) {
      col = 1;
      x = 60 + colW + 20;
      y = 90;
    }
    drawText(g, section.title, x, y, { size: 18, bold: true, color: UI.cursorEdge });
    y += 26;
    for (const [key, desc] of section.rows) {
      drawText(g, key, x + 8, y, { size: 14, color: UI.equip });
      drawText(g, desc, x + 200, y, { size: 14, color: UI.text });
      y += 24;
    }
    y += 14;
  }

  drawText(g, 'B / Esc で閉じる', w / 2, h - 26, {
    size: 15, align: 'center', color: UI.textDim,
  });
  g.restore();
}
