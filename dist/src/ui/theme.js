/**
 * 画面の色と配置。
 *
 * 論理解像度は 1280x720 固定。実際の canvas はここへ整数倍で拡大する。
 * 数値はすべて論理座標。
 */
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
};
/** ログの種類ごとの文字色 */
export const LOG_COLOR = {
    normal: UI.text,
    good: UI.good,
    bad: UI.danger,
    critical: '#ff9b3d',
    item: '#7ee8ff',
    system: UI.textDim,
    warning: UI.warn,
};
/** 日本語が出るフォント指定 */
export const FONT_STACK = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", ' +
    '"Yu Gothic UI", "Meiryo", "MS PGothic", sans-serif';
/** 明朝（見出し・名前・告知）。ui2/tokens.ts と同じもの */
export const SERIF_FONT_STACK = '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", "Noto Serif CJK JP", ' +
    '"Source Han Serif JP", "IPAMincho", "IPAexMincho", "MS PMincho", serif';
export const font = (size, weight = 'normal', family = 'sans') => `${weight === 'bold' ? 'bold ' : ''}${size}px ${family === 'serif' ? SERIF_FONT_STACK : FONT_STACK}`;
/**
 * HUD の配置。世界を広く見せるため、四隅に小さくまとめて中央（400〜880 × 130〜580）を空ける。
 * 世界は 1 マス 48px なので、画面には横 26・縦 15 マスしか出ない。常時表示が大きいと部屋が見えない。
 */
export const LAYOUT = {
    /** ステータス（左上） */
    status: { x: 16, y: 12, w: 388, h: 104 },
    /** 状態異常の札（ステータスの下） */
    statusIcons: { x: 16, y: 122, w: 380, h: 34 },
    /** 階層表示（右上） */
    floor: { x: 1052, y: 12, w: 212, h: 58 },
    /** ミニマップ（階層表示の下）。中は 200×136 で、48×32 マスの階が 1 マス 4px で収まる */
    minimap: { x: 1052, y: 76, w: 212, h: 148 },
    /** メッセージ（左下の会話窓） */
    message: { x: 16, y: 588, w: 700, h: 120 },
    /** ショートカット（右下、数字キー 1〜9） */
    shortcuts: { x: 728, y: 640, w: 536, h: 68 },
};
/** メニューの配置 */
export const MENU_LAYOUT = {
    /** メインメニュー（右寄せの縦一列） */
    main: { x: 968, y: 236, w: 296, itemH: 46 },
    /** 道具一覧 */
    items: { x: 236, y: 60, w: 640, h: 464, rowH: 40, rows: 10 },
    /** 道具のコンテキストメニュー */
    context: { w: 220, itemH: 42 },
    /** アイテムの説明パネル */
    detail: { x: 236, y: 560, w: 720, h: 136 },
};
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
    messageHold: 3000,
    messageFade: 500,
};
/** 画面のゆれ・フラッシュの強さ */
export const FX = {
    shakeSmall: 4,
    shakeLarge: 10,
    flashDamage: 'rgba(255,60,60,0.30)',
    flashHeal: 'rgba(110,224,110,0.22)',
    flashCritical: 'rgba(255,255,255,0.35)',
};
/** HP の割合から色を選ぶ */
export function hpColor(ratio) {
    if (ratio > 0.5)
        return UI.hpHi;
    if (ratio > 0.25)
        return UI.hpMid;
    return UI.hpLo;
}
/** ミニマップの色 */
export const MINIMAP_COLOR = {
    unknown: 'rgba(0,0,0,0)',
    wall: '#262a3c',
    floor: '#5b6178',
    corridor: '#464b60',
    water: '#2f6a98',
    lava: '#b24a1c',
    stairs: '#7fd88f',
    item: '#6fcbef',
    trap: '#f0a860',
    shop: '#e8c66a',
    monster: '#f06a5a',
    ally: '#7fd88f',
    player: '#fff0b0',
};
//# sourceMappingURL=theme.js.map