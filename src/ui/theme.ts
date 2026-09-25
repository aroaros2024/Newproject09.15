/**
 * 画面の色と配置。
 *
 * 論理解像度は 1280x720 固定。実際の canvas はここへ整数倍で拡大する。
 * 数値はすべて論理座標。
 */

import type { Rect } from '../core/geom.js';

export const SCREEN_W = 1280;
export const SCREEN_H = 720;

/** 1 マスの大きさ（ピクセル） */
export const TILE = 32;

/**
 * UI の色。深い紺の地に金の縁、文字は温かい白（新しい UI の決まりは ui2/tokens.ts）。
 * 名前は昔のまま残してある（呼び出し側を全部書き換えずに色だけ入れ替えるため）。
 */
export const UI = {
  panelBg: 'rgba(11,16,32,0.86)',
  panelBgSolid: '#0b1020',
  frame: '#c8a869',
  frameInner: 'rgba(232,214,160,0.18)',
  text: '#f1ebdd',
  textDim: '#a9a391',
  textDisabled: '#5e5a52',
  cursorFill: 'rgba(70,110,190,0.45)',
  /** 見出し・選択・強調の金 */
  cursorEdge: '#e8c66a',
  good: '#7fd88f',
  warn: '#f2c45a',
  danger: '#f06a5a',
  curse: '#d070d0',
  equip: '#6fcbef',
  gitan: '#f2ce6a',
  hpHi: '#6edb8c',
  hpMid: '#f2c45a',
  hpLo: '#f06a5a',
  food: '#f0a860',
  exp: '#8fb0ff',
  shadow: 'rgba(3,5,12,0.55)',
  overlay: 'rgba(3,5,12,0.62)',
} as const;

/** ログの種類ごとの文字色 */
export const LOG_COLOR: Record<string, string> = {
  normal: UI.text,
  good: UI.good,
  bad: UI.danger,
  critical: '#ff9b3d',
  item: '#7ee8ff',
  system: UI.textDim,
  warning: UI.warn,
};

/** 日本語が出るフォント指定 */
export const FONT_STACK =
  '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", ' +
  '"Yu Gothic UI", "Meiryo", "MS PGothic", sans-serif';

/** 明朝（見出し・名前・告知）。ui2/tokens.ts と同じもの */
export const SERIF_FONT_STACK =
  '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", "Noto Serif CJK JP", ' +
  '"Source Han Serif JP", "IPAMincho", "IPAexMincho", "MS PMincho", serif';

export type FontFamily = 'sans' | 'serif';

export const font = (
  size: number, weight: 'normal' | 'bold' = 'normal', family: FontFamily = 'sans',
): string =>
  `${weight === 'bold' ? 'bold ' : ''}${size}px ${family === 'serif' ? SERIF_FONT_STACK : FONT_STACK}`;

/** HUD の配置 */
export const LAYOUT = {
  /** メッセージログ */
  message: { x: 16, y: 8, w: 1100, h: 100 } as Rect,
  /** ミニマップ */
  minimap: { x: 1128, y: 8, w: 144, h: 96 } as Rect,
  /** 状態異常アイコン */
  statusIcons: { x: 16, y: 548, w: 456, h: 40 } as Rect,
  /** ステータス */
  status: { x: 16, y: 592, w: 456, h: 112 } as Rect,
  /** 階層表示 */
  floor: { x: 1096, y: 600, w: 168, h: 104 } as Rect,
  /** ショートカット（数字キー 1〜9） */
  shortcuts: { x: 484, y: 626, w: 604, h: 78 } as Rect,
} as const;

/** メニューの配置 */
export const MENU_LAYOUT = {
  /** メインメニュー（右寄せの縦一列） */
  main: { x: 968, y: 120, w: 264, itemH: 44 },
  /** 道具一覧 */
  items: { x: 300, y: 76, w: 580, h: 500, rowH: 34, rows: 13 },
  /** 道具のコンテキストメニュー */
  context: { w: 200, itemH: 38 },
  /** アイテムの説明パネル */
  detail: { x: 300, y: 560, w: 680, h: 120 },
} as const;

/** 演出の時間（ミリ秒）。設定の「アニメ速度」で倍率が掛かる */
export const ANIM = {
  move: 110,
  dashStep: 45,
  attack: 140,
  damage: 220,
  defeat: 320,
  projectile: 26, // 1 マスあたり
  zap: 180,
  explosion: 380,
  floorFade: 420,
  banner: 1400,
  /** メッセージの 1 文字あたり(ms) */
  messageCps: 18,
  /** ログが薄くなり始めるまで */
  messageHold: 2600,
  messageFade: 400,
} as const;

/** 画面のゆれ・フラッシュの強さ */
export const FX = {
  shakeSmall: 4,
  shakeLarge: 10,
  flashDamage: 'rgba(255,60,60,0.30)',
  flashHeal: 'rgba(110,224,110,0.22)',
  flashCritical: 'rgba(255,255,255,0.35)',
} as const;

/** HP の割合から色を選ぶ */
export function hpColor(ratio: number): string {
  if (ratio > 0.5) return UI.hpHi;
  if (ratio > 0.25) return UI.hpMid;
  return UI.hpLo;
}

/** ミニマップの色 */
export const MINIMAP_COLOR = {
  unknown: 'rgba(0,0,0,0)',
  wall: '#2a2a38',
  floor: '#5a5a70',
  corridor: '#464658',
  water: '#2a5878',
  lava: '#8a3a18',
  stairs: '#5ce05c',
  item: '#5cc8ff',
  trap: '#ff9b3d',
  shop: '#ffd24a',
  monster: '#ff5a5a',
  ally: '#6ee06e',
  player: '#ffe24a',
} as const;
