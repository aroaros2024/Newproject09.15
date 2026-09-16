/**
 * 画面の切り替えと、全画面で共有するもの。
 */
/** アニメ速度の設定 → 倍率 */
export const animScale = (setting) => setting === 0 ? 0.001 : setting === 1 ? 0.6 : 1;
/** メッセージ速度の設定 → 1 文字あたりのミリ秒 */
export const messageCps = (setting) => setting === 0 ? 0 : setting === 1 ? 14 : 30;
//# sourceMappingURL=app.js.map