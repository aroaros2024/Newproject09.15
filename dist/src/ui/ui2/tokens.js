/**
 * 新しい UI の決まり（色・書体・大きさ）。
 *
 * オクトパストラベラーの枠を手本にした：深い紺の半透明の地に、金の二重線と四隅の飾り。
 * 見出し・名前・告知は明朝、本文はゴシック。本文は 20px 以上
 * （オクトパストラベラーは文字が小さすぎると言われた。同じ轍を踏まない）。
 */
/** 枠と地の色 */
export const PANEL = {
    /** 地のグラデーション（上 → 下） */
    bgTop: '#141a2e',
    bgBottom: '#0b1020',
    /** 地の不透明度 */
    bgAlpha: 0.86,
    /** 金（パレットの gold 3 段目と同じ） */
    gold: '#c8a869',
    goldLight: '#e8d6a0',
    goldDark: '#7a6538',
    goldEdge: '#3a2c14',
    /** 危ない確認（「はじめから」など）の枠 */
    danger: '#c0564a',
    dangerLight: '#f0a090',
    /** 影 */
    shadow: 'rgba(3,5,12,0.55)',
};
/** 選んでいる行の帯 */
export const SELECT = {
    /** 帯の左端と右端（左から右へ薄くなる） */
    from: 'rgba(70,110,190,0.55)',
    to: 'rgba(70,110,190,0.08)',
    /** 帯の上下の細線 */
    hairline: 'rgba(232,214,160,0.7)',
};
/** 明朝（見出し・名前・告知） */
export const SERIF_STACK = '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", "Noto Serif CJK JP", ' +
    '"Source Han Serif JP", "IPAMincho", "IPAexMincho", "MS PMincho", serif';
/** 文字の大きさ（px） */
export const TYPE = {
    display: 64,
    banner: 44,
    h1: 30,
    h2: 22,
    body: 20,
    number: 22,
    small: 17,
    micro: 14,
};
/** 余白と行の高さ */
export const SPACE = {
    pad: 16,
    row: 40,
    /** 四隅の飾りの大きさ（画面 px） */
    ornament: 16,
};
//# sourceMappingURL=tokens.js.map