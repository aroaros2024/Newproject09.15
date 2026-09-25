/**
 * 基本パレット。ゲーム中のドットはすべてこの中の色を使う。
 *
 * 16 の階調 × 6 段（暗 → 明）＋ 白 ＝ 97 色。0 番は透明。
 * 階調は色相をずらしてある。影の側は青紫へ、明るい側は黄へ寄る。
 * 同じ色を明るくしただけの階調だと、影が灰色に濁って「ベクターを縮めた絵」に見える。
 *
 * 輪郭に真っ黒は使わない。隣の色の階調の一番暗い段を使う（shade.ts）。
 * UI の金（#C8A869）は gold の 3 段目。
 */

/** 階調の名前。並び順が番号になる */
export const RAMPS = [
  'ink', 'stone', 'earth', 'skin', 'crimson', 'ember', 'gold', 'leaf',
  'moss', 'water', 'sky', 'indigo', 'violet', 'rose', 'bone', 'steel',
] as const;

export type RampName = typeof RAMPS[number];

/** 1 つの階調の段数 */
export const STEPS = 6;

const RAMP_HEX: Readonly<Record<RampName, readonly string[]>> = {
  ink: ['#0f0d17', '#1e1b2b', '#312d42', '#4b4760', '#6f6b85', '#a19cb4'],
  stone: ['#1b1512', '#2e2520', '#473a31', '#635246', '#85705f', '#ab9784'],
  earth: ['#1d120c', '#3a2415', '#5a3a20', '#7c552d', '#a0773f', '#c79e5e'],
  skin: ['#3b1f1a', '#6a3a2c', '#9c5f45', '#c98a63', '#e8b48a', '#fad8b5'],
  crimson: ['#220a14', '#4a1020', '#7a1c28', '#ad2e30', '#d95a3c', '#f59263'],
  ember: ['#2a0f08', '#6a1f0c', '#b23c10', '#e8701c', '#ffb13b', '#fff1a8'],
  gold: ['#2a1c08', '#574014', '#8a6a2a', '#c8a869', '#e8d6a0', '#fff7de'],
  leaf: ['#0e1f12', '#1b3a1f', '#2f5e2c', '#4f8a3a', '#86b64e', '#c5e07a'],
  moss: ['#08201f', '#0f3b38', '#1d5d55', '#2f8876', '#58b39a', '#9fdcc0'],
  water: ['#0a1430', '#11275a', '#1b438a', '#2a6cb8', '#4fa0dc', '#9bd6f2'],
  sky: ['#1c2a44', '#2f4a6e', '#4d7399', '#78a2c2', '#aacde0', '#e4f4fb'],
  indigo: ['#120e2e', '#211a55', '#33298a', '#4d44b8', '#7a74db', '#b2b0f0'],
  violet: ['#1a0a26', '#36114d', '#5a1d7a', '#8a34a8', '#bd66d0', '#eaa8ef'],
  rose: ['#2a0a1e', '#52123a', '#85204f', '#bb3f6a', '#e2738a', '#f8b4bc'],
  bone: ['#2b241c', '#4f4536', '#7c6e57', '#a89a7c', '#d2c6a6', '#f3ecd6'],
  steel: ['#121821', '#232e3b', '#3a4a5c', '#5a6f84', '#8aa0b2', '#c6d4de'],
};

/** 透明 */
export const TRANSPARENT = 0;
/** 白（被弾の閃き・鏡面の光） */
export const WHITE = 1 + RAMPS.length * STEPS;
/** 色の総数（透明を含む） */
export const PAL_SIZE = WHITE + 1;

/** 階調の番号 */
export const rampIndex = (name: RampName): number => RAMPS.indexOf(name);

/** 階調と段から色番号。段は 0〜5 に切り詰める */
export function ci(ramp: RampName | number, step: number): number {
  const r = typeof ramp === 'number' ? ramp : RAMPS.indexOf(ramp);
  const s = step < 0 ? 0 : step > STEPS - 1 ? STEPS - 1 : Math.round(step);
  return 1 + r * STEPS + s;
}

/** 色番号 → 階調の番号（透明と白は -1） */
export const rampOf = (i: number): number =>
  i <= 0 || i >= WHITE ? -1 : Math.floor((i - 1) / STEPS);

/** 色番号 → 段（透明は -1、白は 6） */
export const stepOf = (i: number): number =>
  i <= 0 ? -1 : i >= WHITE ? STEPS : (i - 1) % STEPS;

/** 同じ階調の中で段をずらす。白は明るくも暗くもしない */
export function shiftStep(i: number, d: number): number {
  const r = rampOf(i);
  if (r < 0) return i;
  return ci(r, stepOf(i) + d);
}

/**
 * 輪郭の色。隣の色の階調の一番暗い段。
 * 白は墨の 1 段目で縁取る（真っ白に真っ黒は強すぎる）。
 */
export function outlineOf(i: number, lightSide = false): number {
  const r = rampOf(i);
  if (r < 0) return ci('ink', lightSide ? 2 : 1);
  return ci(r, lightSide ? 1 : 0);
}

const hexList: string[] = ['#000000'];
for (const name of RAMPS) for (const h of RAMP_HEX[name]) hexList.push(h);
hexList.push('#ffffff');

/** 色番号 → '#rrggbb'（0 番の透明には '#000000' が入っているが描かない） */
export const PAL_HEX: readonly string[] = hexList;

/** fillStyle にそのまま渡せる文字列（毎フレーム文字列を作らないため） */
export const PAL_CSS: readonly string[] = hexList;

/**
 * 色番号 → ImageData 用の 32bit 値（リトルエンディアンの ABGR）。
 * 0 番は完全な透明。
 */
export const PAL_RGBA: Uint32Array = (() => {
  const out = new Uint32Array(PAL_SIZE);
  for (let i = 1; i < PAL_SIZE; i++) {
    const h = hexList[i];
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    out[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return out;
})();

/** 色番号 → [r, g, b]（0〜255）。光の計算とテスト用 */
export function rgbOf(i: number): [number, number, number] {
  const h = hexList[i] ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** 相対輝度（0〜1）。階調が単調に明るくなっているかの検査に使う */
export function luminance(i: number): number {
  const [r, g, b] = rgbOf(i);
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * 自分で光る色。この色の画素は輪郭で縁取らず、ブルームの層にも描く。
 * 火・魔法・金の最も明るい段・空の最も明るい段・白。
 */
export const EMISSIVE: Uint8Array = (() => {
  const out = new Uint8Array(PAL_SIZE);
  const mark = (ramp: RampName, from: number): void => {
    for (let s = from; s < STEPS; s++) out[ci(ramp, s)] = 1;
  };
  mark('ember', 3);
  mark('violet', 4);
  mark('gold', 5);
  mark('sky', 5);
  out[WHITE] = 1;
  return out;
})();

export const isEmissive = (i: number): boolean => EMISSIVE[i] === 1;

// ---------------------------------------------------------------------------
// 粒子の色の進み方（年齢 0 → 1 でこの順に進む）
// ---------------------------------------------------------------------------

/** 魔法：白 → 紫 → 暗 */
export const RAMP_MAGIC: readonly number[] = [
  WHITE, ci('violet', 5), ci('violet', 4), ci('violet', 3), ci('violet', 2), ci('ink', 1),
];
/** 火：白 → 黄 → 橙 → 赤 → 煤 */
export const RAMP_EMBER: readonly number[] = [
  ci('ember', 5), ci('ember', 4), ci('ember', 3), ci('ember', 2), ci('ember', 1), ci('ink', 1),
];
/** 回復：白 → 若葉 → 緑 */
export const RAMP_HEAL: readonly number[] = [
  WHITE, ci('leaf', 5), ci('leaf', 4), ci('moss', 4), ci('moss', 3), ci('moss', 2),
];
/** 塵：明るい石 → 暗い石 */
export const RAMP_DUST: readonly number[] = [
  ci('bone', 4), ci('bone', 3), ci('stone', 4), ci('stone', 3), ci('stone', 2),
];
/** 水：白 → 水色 → 青 */
export const RAMP_WATER: readonly number[] = [
  WHITE, ci('sky', 5), ci('water', 5), ci('water', 4), ci('water', 3), ci('water', 2),
];
/** 毒：黄緑 → 紫 */
export const RAMP_POISON: readonly number[] = [
  ci('leaf', 5), ci('leaf', 4), ci('moss', 3), ci('violet', 3), ci('violet', 2),
];
/** 金：白 → 金 → 茶 */
export const RAMP_GOLD: readonly number[] = [
  WHITE, ci('gold', 5), ci('gold', 4), ci('gold', 3), ci('gold', 2), ci('gold', 1),
];
/** 煙：灰 → 墨 */
export const RAMP_SMOKE: readonly number[] = [
  ci('ink', 5), ci('ink', 4), ci('ink', 3), ci('ink', 2), ci('ink', 1),
];
/** 冷気：白 → 空 → 藍 */
export const RAMP_ICE: readonly number[] = [
  WHITE, ci('sky', 5), ci('sky', 4), ci('sky', 3), ci('indigo', 3), ci('indigo', 2),
];
/** 雷：白 → 黄 → 金 */
export const RAMP_THUNDER: readonly number[] = [
  WHITE, ci('ember', 5), ci('gold', 5), ci('ember', 4), ci('gold', 3), ci('gold', 2),
];
