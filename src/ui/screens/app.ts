/**
 * 画面の切り替えと、全画面で共有するもの。
 */

import type { InputManager } from '../../core/input.js';
import type { Settings, TownState } from '../../core/types.js';
import type { AudioEngine } from '../../core/audio.js';
import type { Ctx } from '../draw.js';
import type { Recorder } from '../../game/recorder.js';
import type { MessageLog } from '../log.js';

export interface Screen {
  readonly id: string;
  enter?(): void;
  exit?(): void;
  update(dt: number, now: number): void;
  draw(g: Ctx, now: number): void;
}

export interface App {
  readonly input: InputManager;
  readonly audio: AudioEngine;
  readonly log: MessageLog;
  /** プレイログの記録。冒険の外では中身が空のこともある */
  readonly recorder: Recorder;
  settings: Settings;
  town: TownState;
  /** 画面を切り替える */
  goTo(screen: Screen): void;
  /** 設定と村のデータを保存する */
  persist(): void;
  /** 設定を反映し直す（音量・アニメ速度） */
  applySettings(): void;
  /** 「はじめから」。記録をすべて消して読み込み直す */
  resetAll(): void;
  /** 今の画面 */
  readonly current: Screen | null;
}

/** アニメ速度の設定 → 倍率 */
export const animScale = (setting: number): number =>
  setting === 0 ? 0.001 : setting === 1 ? 0.6 : 1;

/** メッセージ速度の設定 → 1 文字あたりのミリ秒 */
export const messageCps = (setting: number): number =>
  setting === 0 ? 0 : setting === 1 ? 14 : 30;
