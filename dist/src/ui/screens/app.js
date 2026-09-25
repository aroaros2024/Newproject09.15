/**
 * 画面の切り替えと、全画面で共有するもの。
 */
/** 見た目の固定刻み（ミリ秒） */
export const TICK_MS = 1000 / 60;
/** アニメ速度の設定 → 倍率 */
export const animScale = (setting) => setting === 0 ? 0.001 : setting === 1 ? 0.6 : 1;
/** メッセージ速度の設定 → 1 文字あたりのミリ秒 */
export const messageCps = (setting) => setting === 0 ? 0 : setting === 1 ? 14 : 30;
//# sourceMappingURL=app.js.map