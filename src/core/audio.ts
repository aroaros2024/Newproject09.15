/**
 * WebAudio による手続き生成のサウンド。
 *
 * 音声アセットを一切持たず、オシレータとノイズだけで効果音と BGM を合成する。
 * AudioContext はブラウザの制約でユーザー操作後にしか動かないため、
 * 最初の入力で `unlock()` を呼ぶこと。
 */

export type SfxName =
  | 'step' | 'stepWater' | 'bump'
  | 'hit' | 'hitCritical' | 'hitMiss' | 'damage' | 'defeat'
  | 'levelUp' | 'statUp' | 'statDown'
  | 'pickup' | 'drop' | 'throw' | 'land' | 'break'
  | 'stairs' | 'trap' | 'warp' | 'explosion'
  | 'scroll' | 'drink' | 'eat' | 'zap' | 'equip' | 'curse'
  | 'identify' | 'synthesis' | 'gitan' | 'buy' | 'steal'
  | 'cursor' | 'confirm' | 'cancel' | 'error' | 'page'
  | 'hungry' | 'starving' | 'heal' | 'sleep' | 'confuse' | 'paralyze'
  | 'monsterHouse' | 'bossAppear' | 'wind' | 'gameOver' | 'fanfare' | 'splash';

export type BgmTrack =
  | 'title' | 'town' | 'cave' | 'forest' | 'volcano' | 'waterway'
  | 'tower' | 'abyss' | 'boss' | 'shop' | 'monsterHouse' | 'result';

export interface AudioSettings {
  master: number; // 0..1
  sfx: number; // 0..1
  bgm: number; // 0..1
  muted: boolean;
}

const DEFAULT_SETTINGS: AudioSettings = { master: 0.7, sfx: 0.8, bgm: 0.45, muted: false };

/** 12 平均律。A4=440Hz を基準に MIDI ノート番号から周波数を出す */
const noteHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

type Wave = OscillatorType;

interface ToneSpec {
  wave: Wave;
  /** 開始周波数(Hz) */
  freq: number;
  /** 終了周波数(Hz)。省略時は freq と同じ */
  freq2?: number;
  /** 発音開始のオフセット秒 */
  delay?: number;
  /** 長さ秒 */
  dur: number;
  /** ピーク音量 */
  gain: number;
  /** アタック秒 */
  attack?: number;
  /** 周波数スイープを指数で行うか */
  exp?: boolean;
  /** デチューン(セント) */
  detune?: number;
}

interface NoiseSpec {
  dur: number;
  gain: number;
  delay?: number;
  /** バンドパス/ローパスの中心周波数 */
  filter?: number;
  filter2?: number;
  type?: BiquadFilterType;
  q?: number;
}

interface SfxSpec {
  tones?: ToneSpec[];
  noises?: NoiseSpec[];
}

/**
 * 効果音の定義表。
 * 「短く、うるさすぎず、重なっても濁らない」ことを重視している。
 */
const SFX: Record<SfxName, SfxSpec> = {
  // --- 移動 ---
  step: { noises: [{ dur: 0.045, gain: 0.05, filter: 900, q: 0.8, type: 'lowpass' }] },
  stepWater: { noises: [{ dur: 0.12, gain: 0.07, filter: 2400, filter2: 700, type: 'bandpass', q: 1.2 }] },
  bump: { tones: [{ wave: 'square', freq: 120, freq2: 70, dur: 0.07, gain: 0.08, exp: true }] },

  // --- 戦闘 ---
  hit: {
    tones: [{ wave: 'square', freq: 320, freq2: 110, dur: 0.1, gain: 0.13, exp: true }],
    noises: [{ dur: 0.09, gain: 0.14, filter: 1800, filter2: 400, type: 'bandpass', q: 1 }],
  },
  hitCritical: {
    tones: [
      { wave: 'square', freq: 520, freq2: 130, dur: 0.16, gain: 0.16, exp: true },
      { wave: 'sawtooth', freq: 260, freq2: 80, dur: 0.2, gain: 0.1, exp: true, delay: 0.02 },
    ],
    noises: [{ dur: 0.18, gain: 0.18, filter: 3200, filter2: 300, type: 'bandpass', q: 0.8 }],
  },
  hitMiss: { noises: [{ dur: 0.14, gain: 0.09, filter: 5000, filter2: 1400, type: 'bandpass', q: 2 }] },
  damage: {
    tones: [{ wave: 'sawtooth', freq: 220, freq2: 60, dur: 0.22, gain: 0.15, exp: true }],
    noises: [{ dur: 0.14, gain: 0.1, filter: 800, type: 'lowpass' }],
  },
  defeat: {
    tones: [
      { wave: 'square', freq: 400, freq2: 60, dur: 0.3, gain: 0.12, exp: true },
      { wave: 'triangle', freq: 200, freq2: 40, dur: 0.34, gain: 0.1, exp: true, delay: 0.03 },
    ],
    noises: [{ dur: 0.26, gain: 0.12, filter: 2000, filter2: 200, type: 'lowpass' }],
  },

  // --- 成長 ---
  levelUp: {
    tones: [
      { wave: 'square', freq: noteHz(72), dur: 0.1, gain: 0.11 },
      { wave: 'square', freq: noteHz(76), dur: 0.1, gain: 0.11, delay: 0.09 },
      { wave: 'square', freq: noteHz(79), dur: 0.1, gain: 0.11, delay: 0.18 },
      { wave: 'square', freq: noteHz(84), dur: 0.34, gain: 0.13, delay: 0.27 },
      { wave: 'triangle', freq: noteHz(88), dur: 0.34, gain: 0.07, delay: 0.27 },
    ],
  },
  statUp: {
    tones: [
      { wave: 'triangle', freq: noteHz(69), dur: 0.09, gain: 0.1 },
      { wave: 'triangle', freq: noteHz(76), dur: 0.18, gain: 0.1, delay: 0.08 },
    ],
  },
  statDown: {
    tones: [
      { wave: 'triangle', freq: noteHz(69), dur: 0.09, gain: 0.1 },
      { wave: 'triangle', freq: noteHz(62), dur: 0.22, gain: 0.1, delay: 0.08 },
    ],
  },

  // --- アイテム ---
  pickup: {
    tones: [
      { wave: 'square', freq: noteHz(81), dur: 0.05, gain: 0.08 },
      { wave: 'square', freq: noteHz(88), dur: 0.09, gain: 0.08, delay: 0.045 },
    ],
  },
  drop: { tones: [{ wave: 'triangle', freq: 300, freq2: 150, dur: 0.1, gain: 0.08, exp: true }] },
  throw: { noises: [{ dur: 0.16, gain: 0.08, filter: 900, filter2: 3600, type: 'bandpass', q: 3 }] },
  land: { tones: [{ wave: 'triangle', freq: 180, freq2: 90, dur: 0.09, gain: 0.09, exp: true }] },
  break: {
    noises: [
      { dur: 0.22, gain: 0.16, filter: 5200, filter2: 900, type: 'bandpass', q: 0.7 },
      { dur: 0.1, gain: 0.1, filter: 8000, type: 'highpass', delay: 0.02 },
    ],
  },

  // --- 地形 ---
  stairs: {
    tones: [
      { wave: 'triangle', freq: noteHz(64), dur: 0.11, gain: 0.1 },
      { wave: 'triangle', freq: noteHz(67), dur: 0.11, gain: 0.1, delay: 0.1 },
      { wave: 'triangle', freq: noteHz(72), dur: 0.26, gain: 0.11, delay: 0.2 },
    ],
  },
  trap: {
    tones: [{ wave: 'sawtooth', freq: 620, freq2: 90, dur: 0.26, gain: 0.13, exp: true }],
    noises: [{ dur: 0.2, gain: 0.1, filter: 1500, type: 'bandpass', q: 1.5 }],
  },
  warp: {
    tones: [
      { wave: 'sine', freq: 180, freq2: 2200, dur: 0.34, gain: 0.11, exp: true },
      { wave: 'sine', freq: 190, freq2: 2300, dur: 0.34, gain: 0.07, exp: true, detune: 20 },
    ],
  },
  explosion: {
    tones: [{ wave: 'sawtooth', freq: 140, freq2: 30, dur: 0.5, gain: 0.16, exp: true }],
    noises: [
      { dur: 0.55, gain: 0.2, filter: 1400, filter2: 120, type: 'lowpass' },
      { dur: 0.12, gain: 0.14, filter: 6000, type: 'highpass' },
    ],
  },

  // --- 道具使用 ---
  scroll: { noises: [{ dur: 0.36, gain: 0.1, filter: 1200, filter2: 5200, type: 'bandpass', q: 1.5 }] },
  drink: {
    tones: [
      { wave: 'sine', freq: 420, freq2: 720, dur: 0.14, gain: 0.09, exp: true },
      { wave: 'sine', freq: 520, freq2: 880, dur: 0.14, gain: 0.08, exp: true, delay: 0.1 },
    ],
  },
  eat: { noises: [{ dur: 0.1, gain: 0.1, filter: 700, type: 'lowpass' }, { dur: 0.1, gain: 0.08, filter: 600, type: 'lowpass', delay: 0.13 }] },
  zap: {
    tones: [
      { wave: 'sawtooth', freq: 1400, freq2: 260, dur: 0.2, gain: 0.1, exp: true },
      { wave: 'square', freq: 700, freq2: 130, dur: 0.2, gain: 0.06, exp: true },
    ],
  },
  equip: {
    tones: [{ wave: 'square', freq: 900, freq2: 1500, dur: 0.06, gain: 0.08, exp: true }],
    noises: [{ dur: 0.14, gain: 0.1, filter: 4200, type: 'bandpass', q: 3 }],
  },
  curse: {
    tones: [
      { wave: 'sawtooth', freq: 160, freq2: 70, dur: 0.5, gain: 0.11, exp: true },
      { wave: 'sawtooth', freq: 166, freq2: 73, dur: 0.5, gain: 0.09, exp: true, detune: -30 },
    ],
  },
  identify: {
    tones: [
      { wave: 'sine', freq: noteHz(76), dur: 0.1, gain: 0.09 },
      { wave: 'sine', freq: noteHz(83), dur: 0.1, gain: 0.09, delay: 0.08 },
      { wave: 'sine', freq: noteHz(88), dur: 0.3, gain: 0.1, delay: 0.16 },
    ],
  },
  synthesis: {
    tones: [
      { wave: 'triangle', freq: 200, freq2: 900, dur: 0.4, gain: 0.1, exp: true },
      { wave: 'square', freq: noteHz(84), dur: 0.3, gain: 0.09, delay: 0.36 },
    ],
    noises: [{ dur: 0.3, gain: 0.1, filter: 2600, type: 'bandpass', q: 2 }],
  },
  gitan: {
    tones: [
      { wave: 'square', freq: noteHz(88), dur: 0.05, gain: 0.07 },
      { wave: 'square', freq: noteHz(93), dur: 0.12, gain: 0.07, delay: 0.05 },
    ],
  },
  buy: {
    tones: [
      { wave: 'square', freq: noteHz(79), dur: 0.07, gain: 0.08 },
      { wave: 'square', freq: noteHz(86), dur: 0.14, gain: 0.08, delay: 0.07 },
    ],
  },
  steal: {
    tones: [
      { wave: 'sawtooth', freq: 900, freq2: 200, dur: 0.16, gain: 0.12, exp: true },
      { wave: 'sawtooth', freq: 900, freq2: 200, dur: 0.16, gain: 0.12, exp: true, delay: 0.18 },
    ],
  },

  // --- UI ---
  cursor: { tones: [{ wave: 'square', freq: 1200, dur: 0.028, gain: 0.05 }] },
  confirm: {
    tones: [
      { wave: 'square', freq: noteHz(84), dur: 0.04, gain: 0.07 },
      { wave: 'square', freq: noteHz(91), dur: 0.07, gain: 0.07, delay: 0.038 },
    ],
  },
  cancel: { tones: [{ wave: 'square', freq: 520, freq2: 300, dur: 0.07, gain: 0.06, exp: true }] },
  error: { tones: [{ wave: 'square', freq: 200, dur: 0.12, gain: 0.09 }, { wave: 'square', freq: 150, dur: 0.14, gain: 0.09, delay: 0.1 }] },
  page: { noises: [{ dur: 0.08, gain: 0.06, filter: 3000, type: 'bandpass', q: 2 }] },

  // --- 状態 ---
  hungry: { tones: [{ wave: 'triangle', freq: 300, freq2: 200, dur: 0.3, gain: 0.08, exp: true }] },
  starving: {
    tones: [
      { wave: 'triangle', freq: 260, freq2: 130, dur: 0.4, gain: 0.11, exp: true },
      { wave: 'triangle', freq: 200, freq2: 100, dur: 0.4, gain: 0.09, exp: true, delay: 0.3 },
    ],
  },
  heal: {
    tones: [
      { wave: 'sine', freq: noteHz(72), dur: 0.16, gain: 0.09 },
      { wave: 'sine', freq: noteHz(79), dur: 0.16, gain: 0.09, delay: 0.1 },
      { wave: 'sine', freq: noteHz(84), dur: 0.3, gain: 0.09, delay: 0.2 },
    ],
  },
  sleep: {
    tones: [
      { wave: 'sine', freq: 500, freq2: 180, dur: 0.5, gain: 0.09, exp: true },
      { wave: 'sine', freq: 380, freq2: 140, dur: 0.5, gain: 0.07, exp: true, delay: 0.12 },
    ],
  },
  confuse: {
    tones: [
      { wave: 'sine', freq: 400, freq2: 800, dur: 0.18, gain: 0.08, exp: true },
      { wave: 'sine', freq: 800, freq2: 400, dur: 0.18, gain: 0.08, exp: true, delay: 0.16 },
      { wave: 'sine', freq: 400, freq2: 800, dur: 0.18, gain: 0.08, exp: true, delay: 0.32 },
    ],
  },
  paralyze: {
    tones: [
      { wave: 'square', freq: 900, dur: 0.03, gain: 0.08 },
      { wave: 'square', freq: 900, dur: 0.03, gain: 0.08, delay: 0.06 },
      { wave: 'square', freq: 900, dur: 0.03, gain: 0.08, delay: 0.12 },
      { wave: 'square', freq: 600, dur: 0.16, gain: 0.08, delay: 0.18 },
    ],
  },

  // --- 演出 ---
  monsterHouse: {
    tones: [
      { wave: 'sawtooth', freq: 180, freq2: 420, dur: 0.5, gain: 0.13, exp: true },
      { wave: 'sawtooth', freq: 420, freq2: 180, dur: 0.5, gain: 0.13, exp: true, delay: 0.5 },
      { wave: 'sawtooth', freq: 180, freq2: 460, dur: 0.6, gain: 0.13, exp: true, delay: 1.0 },
    ],
  },
  bossAppear: {
    tones: [
      { wave: 'sawtooth', freq: 70, freq2: 45, dur: 1.4, gain: 0.16, exp: true },
      { wave: 'square', freq: noteHz(41), dur: 0.5, gain: 0.1, delay: 0.1 },
      { wave: 'square', freq: noteHz(42), dur: 0.9, gain: 0.1, delay: 0.62 },
    ],
    noises: [{ dur: 1.2, gain: 0.12, filter: 400, filter2: 90, type: 'lowpass' }],
  },
  wind: { noises: [{ dur: 1.6, gain: 0.13, filter: 420, filter2: 1500, type: 'bandpass', q: 0.6 }] },
  gameOver: {
    tones: [
      { wave: 'triangle', freq: noteHz(69), dur: 0.34, gain: 0.11 },
      { wave: 'triangle', freq: noteHz(65), dur: 0.34, gain: 0.11, delay: 0.32 },
      { wave: 'triangle', freq: noteHz(62), dur: 0.34, gain: 0.11, delay: 0.64 },
      { wave: 'triangle', freq: noteHz(57), dur: 1.3, gain: 0.12, delay: 0.96 },
      { wave: 'sine', freq: noteHz(45), dur: 1.4, gain: 0.09, delay: 0.96 },
    ],
  },
  fanfare: {
    tones: [
      { wave: 'square', freq: noteHz(72), dur: 0.14, gain: 0.11 },
      { wave: 'square', freq: noteHz(72), dur: 0.14, gain: 0.11, delay: 0.15 },
      { wave: 'square', freq: noteHz(72), dur: 0.14, gain: 0.11, delay: 0.3 },
      { wave: 'square', freq: noteHz(76), dur: 0.7, gain: 0.13, delay: 0.46 },
      { wave: 'triangle', freq: noteHz(79), dur: 0.7, gain: 0.09, delay: 0.46 },
      { wave: 'triangle', freq: noteHz(84), dur: 0.7, gain: 0.07, delay: 0.46 },
    ],
  },
  splash: { noises: [{ dur: 0.26, gain: 0.12, filter: 3000, filter2: 500, type: 'bandpass', q: 1 }] },
};

/** BGM 1 トラックの定義 */
interface BgmSpec {
  /** 1 拍の長さ（秒） */
  beat: number;
  /** ベース音（MIDI ノート）のループ */
  bass: (number | null)[];
  /** メロディ（MIDI ノート）のループ。null は休符 */
  lead: (number | null)[];
  /** メロディの波形 */
  leadWave: Wave;
  bassWave: Wave;
  /** 全体音量倍率 */
  vol: number;
  /** パーカッション（ノイズ）を鳴らす拍 */
  perc?: number[];
}

// スケール素材（MIDI ノート）
const A_MINOR = [57, 59, 60, 62, 64, 65, 67, 69]; // イ短調
const HIRAJOSHI = [57, 59, 60, 64, 65, 69, 71, 72]; // 平調子（和風）
const PHRYGIAN = [57, 58, 60, 62, 64, 65, 67, 69]; // フリギア（不穏）
const MAJOR = [60, 62, 64, 65, 67, 69, 71, 72]; // ハ長調

const seq = (scale: number[], idx: (number | null)[], oct = 0): (number | null)[] =>
  idx.map((i) => (i === null ? null : scale[i % scale.length] + 12 * (oct + Math.floor(i / scale.length))));

const BGM: Record<BgmTrack, BgmSpec> = {
  title: {
    beat: 0.42, vol: 0.9, leadWave: 'triangle', bassWave: 'sine',
    lead: seq(HIRAJOSHI, [0, null, 2, 3, null, 4, 3, 2, 0, null, null, null, 4, 5, 4, null]),
    bass: seq(HIRAJOSHI, [0, null, null, null, 3, null, null, null], -1),
  },
  town: {
    beat: 0.3, vol: 0.85, leadWave: 'square', bassWave: 'triangle',
    lead: seq(MAJOR, [0, 2, 4, 2, 5, 4, 2, 0, 1, 3, 5, 3, 4, 2, 0, null]),
    bass: seq(MAJOR, [0, null, 4, null, 3, null, 4, null], -2),
    perc: [0, 4, 8, 12],
  },
  cave: {
    beat: 0.34, vol: 0.8, leadWave: 'triangle', bassWave: 'sine',
    lead: seq(A_MINOR, [0, null, 2, null, 4, null, 2, null, 3, null, 2, null, 0, null, null, null]),
    bass: seq(A_MINOR, [0, null, null, null, 0, null, null, null], -2),
    perc: [0, 8],
  },
  forest: {
    beat: 0.3, vol: 0.8, leadWave: 'triangle', bassWave: 'sine',
    lead: seq(HIRAJOSHI, [4, 3, 2, 3, 4, 5, 4, null, 2, 0, 2, 3, 2, null, null, null]),
    bass: seq(HIRAJOSHI, [0, null, 2, null, 4, null, 2, null], -2),
    perc: [2, 6, 10, 14],
  },
  volcano: {
    beat: 0.22, vol: 0.85, leadWave: 'sawtooth', bassWave: 'square',
    lead: seq(PHRYGIAN, [0, 1, 0, 4, 0, 1, 0, 5, 0, 1, 0, 4, 3, 2, 1, 0]),
    bass: seq(PHRYGIAN, [0, 0, 0, 0, 1, 1, 0, 0], -2),
    perc: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  waterway: {
    beat: 0.38, vol: 0.75, leadWave: 'sine', bassWave: 'sine',
    lead: seq(PHRYGIAN, [0, null, null, 1, null, null, 4, null, 3, null, null, 1, null, 0, null, null]),
    bass: seq(PHRYGIAN, [0, null, null, null, 1, null, null, null], -2),
  },
  tower: {
    beat: 0.26, vol: 0.9, leadWave: 'square', bassWave: 'sawtooth',
    lead: seq(A_MINOR, [7, 6, 4, 6, 7, 9, 7, 6, 4, 3, 2, 3, 4, 6, 4, null]),
    bass: seq(A_MINOR, [0, 4, 0, 4, 3, 7, 3, 7], -2),
    perc: [0, 4, 8, 12],
  },
  abyss: {
    beat: 0.24, vol: 0.85, leadWave: 'sawtooth', bassWave: 'sawtooth',
    lead: seq(PHRYGIAN, [0, 4, 3, 4, 1, 5, 4, 5, 0, 4, 3, 4, 7, 6, 5, 4]),
    bass: seq(PHRYGIAN, [0, 0, 1, 1, 0, 0, 4, 3], -2),
    perc: [0, 3, 6, 8, 11, 14],
  },
  boss: {
    beat: 0.19, vol: 0.95, leadWave: 'sawtooth', bassWave: 'square',
    lead: seq(PHRYGIAN, [7, 7, 6, 7, 4, 4, 3, 4, 7, 7, 8, 9, 8, 7, 6, 4]),
    bass: seq(PHRYGIAN, [0, 0, 0, 1, 0, 0, 0, 4], -2),
    perc: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  shop: {
    beat: 0.28, vol: 0.8, leadWave: 'square', bassWave: 'triangle',
    lead: seq(MAJOR, [4, 5, 6, 7, 6, 5, 4, 2, 0, 2, 4, 2, 1, null, null, null]),
    bass: seq(MAJOR, [0, null, 4, null, 5, null, 4, null], -2),
    perc: [0, 4, 8, 12],
  },
  monsterHouse: {
    beat: 0.16, vol: 0.9, leadWave: 'square', bassWave: 'sawtooth',
    lead: seq(PHRYGIAN, [0, 1, 0, 1, 0, 1, 4, 3, 0, 1, 0, 1, 4, 3, 1, 0]),
    bass: seq(PHRYGIAN, [0, 0, 0, 0, 0, 0, 0, 0], -2),
    perc: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  result: {
    beat: 0.4, vol: 0.8, leadWave: 'triangle', bassWave: 'sine',
    lead: seq(MAJOR, [0, 2, 4, 7, 6, 4, 2, null, 1, 3, 5, 4, 2, 0, null, null]),
    bass: seq(MAJOR, [0, null, 3, null, 4, null, 0, null], -2),
  },
};

/**
 * サウンド全体の管理。シングルトンとして `audio` をエクスポートする。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: AudioSettings = { ...DEFAULT_SETTINGS };

  private currentTrack: BgmTrack | null = null;
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private bgmNextTime = 0;

  /** 同時発音が増えすぎたときに間引くための記録 */
  private recentPlays = new Map<SfxName, number>();
  private available = true;

  get isAvailable(): boolean {
    return this.available;
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  setSettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applyVolumes();
  }

  /** ブラウザの自動再生制限を解除する。最初のキー入力/クリックで呼ぶこと */
  unlock(): void {
    try {
      this.ensureCtx();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.available = false;
    }
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (!this.available) return null;
    const Ctor: typeof AudioContext | undefined =
      (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.available = false;
      return null;
    }
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.masterGain = ctx.createGain();
      this.sfxGain = ctx.createGain();
      this.bgmGain = ctx.createGain();
      this.sfxGain.connect(this.masterGain);
      this.bgmGain.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);
      this.applyVolumes();
      this.noiseBuffer = this.makeNoiseBuffer(ctx);
      return ctx;
    } catch {
      this.available = false;
      return null;
    }
  }

  private applyVolumes(): void {
    if (!this.masterGain || !this.sfxGain || !this.bgmGain) return;
    const m = this.settings.muted ? 0 : this.settings.master;
    this.masterGain.gain.value = m;
    this.sfxGain.gain.value = this.settings.sfx;
    this.bgmGain.gain.value = this.settings.bgm;
  }

  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // 乱数はシード付きにしない（音の微妙な揺らぎはゲーム進行に影響しない）
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 効果音を鳴らす */
  play(name: SfxName, volumeScale = 1): void {
    const ctx = this.ensureCtx();
    if (!ctx || this.settings.muted) return;
    if (ctx.state === 'suspended') return;

    // 同じ音が 1 フレーム内に大量に鳴るのを抑える
    const now = ctx.currentTime;
    const last = this.recentPlays.get(name) ?? -1;
    if (now - last < 0.02) return;
    this.recentPlays.set(name, now);

    const spec = SFX[name];
    if (!spec) return;
    const dest = this.sfxGain;
    if (!dest) return;

    for (const t of spec.tones ?? []) this.playTone(ctx, dest, t, now, volumeScale);
    for (const n of spec.noises ?? []) this.playNoise(ctx, dest, n, now, volumeScale);
  }

  private playTone(
    ctx: AudioContext, dest: AudioNode, t: ToneSpec, base: number, scale: number,
  ): void {
    const start = base + (t.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = t.wave;
    if (t.detune) osc.detune.value = t.detune;
    const f2 = t.freq2 ?? t.freq;
    osc.frequency.setValueAtTime(Math.max(1, t.freq), start);
    if (f2 !== t.freq) {
      if (t.exp) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), start + t.dur);
      else osc.frequency.linearRampToValueAtTime(Math.max(1, f2), start + t.dur);
    }
    const peak = Math.max(0.0001, t.gain * scale);
    const atk = t.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(start + t.dur + 0.02);
  }

  private playNoise(
    ctx: AudioContext, dest: AudioNode, n: NoiseSpec, base: number, scale: number,
  ): void {
    if (!this.noiseBuffer) return;
    const start = base + (n.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const g = ctx.createGain();
    const peak = Math.max(0.0001, n.gain * scale);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);

    let node: AudioNode = src;
    if (n.filter) {
      const f = ctx.createBiquadFilter();
      f.type = n.type ?? 'bandpass';
      f.frequency.setValueAtTime(n.filter, start);
      if (n.filter2 && n.filter2 !== n.filter) {
        f.frequency.exponentialRampToValueAtTime(Math.max(1, n.filter2), start + n.dur);
      }
      if (n.q) f.Q.value = n.q;
      src.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest);
    src.start(start);
    src.stop(start + n.dur + 0.02);
  }

  // ---------------------------------------------------------------- BGM

  /** BGM を切り替える。同じトラックなら何もしない */
  playBgm(track: BgmTrack | null): void {
    if (this.currentTrack === track) return;
    this.stopBgm();
    this.currentTrack = track;
    if (!track) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    this.bgmStep = 0;
    this.bgmNextTime = ctx.currentTime + 0.1;
    this.scheduleBgm();
  }

  stopBgm(): void {
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    this.currentTrack = null;
  }

  getBgm(): BgmTrack | null {
    return this.currentTrack;
  }

  /**
   * 先読みスケジューラ。setInterval で定期的に起き、
   * 50ms 先までの音を WebAudio のタイムラインへ積む。
   */
  private scheduleBgm(): void {
    const tick = (): void => {
      const ctx = this.ctx;
      const track = this.currentTrack;
      const dest = this.bgmGain;
      if (!ctx || !track || !dest || this.settings.muted) return;
      if (ctx.state === 'suspended') return;
      const spec = BGM[track];
      const lookahead = ctx.currentTime + 0.25;
      let guard = 0;
      while (this.bgmNextTime < lookahead && guard++ < 64) {
        const step = this.bgmStep;
        const t = this.bgmNextTime;

        const lead = spec.lead[step % spec.lead.length];
        if (lead !== null && lead !== undefined) {
          this.playTone(ctx, dest, {
            wave: spec.leadWave, freq: noteHz(lead), dur: spec.beat * 0.9,
            gain: 0.09 * spec.vol, attack: 0.01,
          }, t, 1);
        }
        const bass = spec.bass[step % spec.bass.length];
        if (bass !== null && bass !== undefined) {
          this.playTone(ctx, dest, {
            wave: spec.bassWave, freq: noteHz(bass), dur: spec.beat * 1.6,
            gain: 0.1 * spec.vol, attack: 0.012,
          }, t, 1);
        }
        if (spec.perc && spec.perc.includes(step % 16)) {
          this.playNoise(ctx, dest, {
            dur: 0.05, gain: 0.05 * spec.vol, filter: 2600, type: 'bandpass', q: 1.2,
          }, t, 1);
        }

        this.bgmStep = (step + 1) % 64;
        this.bgmNextTime += spec.beat;
      }
    };
    tick();
    this.bgmTimer = setInterval(tick, 60) as unknown as number;
  }

  /** 画面が隠れたら BGM を止め、戻ったら再開する */
  handleVisibility(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }
}

export const audio = new AudioEngine();
