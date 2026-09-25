/**
 * 演出の表：演出の名前（anim/types.ts の VfxPresetId）→ 粒の吹き出し・一瞬の光・揺れ。DOM 無し。
 *
 * 粒はどれもカールノイズの流れ場に乗る（flowRamp で「飛び出してから流れへ乗り換える」）。
 * 火花は弾けて減速したところで渦に巻き込まれ、煙と魔法の粒は渦を巻きながら薄れる。
 * ドットの粒（画用紙に 1 ドット）と HD の粒（柔らかい光の玉）を重ねて、ドット絵の上に HD の光を載せる
 * （オクトパストラベラーの技の演出と同じ考え方）。
 *
 * fireVfx は割り当てをしない（強さで数や速さを変える時は、使い回しの入れ物に書き写す）。
 */

import {
  RAMP_DUST, RAMP_EMBER, RAMP_GOLD, RAMP_HEAL, RAMP_ICE, RAMP_MAGIC, RAMP_POISON, RAMP_SMOKE,
  RAMP_THUNDER, RAMP_WATER,
} from '../art/palette.js';
import type { BurstOpts, VfxElement, VfxPresetId } from '../anim/types.js';
import {
  type BurstSpec, KIND_HD, KIND_PIXEL, type ParticlePool, TONE_EMBER, TONE_GOLD, TONE_HEAL, TONE_MAGIC,
  TONE_WATER, TONE_WHITE,
} from './particles.js';

const TAU = Math.PI * 2;

/** 一瞬の光 */
export interface VfxLight {
  color: string;
  /** 半径（マス） */
  radius: number;
  intensity: number;
  ms: number;
}

export interface VfxRecipe {
  /** 吹き出す粒（マスの中心から） */
  bursts: readonly BurstSpec[];
  /** 向きのある演出（opts.dir8 の向きへ飛ばす。-1 なら全方向） */
  directional?: boolean;
  /** 一瞬の光（無ければ光らない） */
  light?: VfxLight;
  /** 揺れ（画面 px）と長さ（ms）。無ければ揺らさない */
  shake?: readonly [number, number];
  /** 吹き出す高さ（マスの上端からのドット。8 = マスの真ん中、キャラの胴は 2 くらい） */
  lift?: number;
}

/** 飛び散る火花（ドット）：白 → 橙 → 暗。速く飛び、減速して流れに乗る */
const SPARKS: BurstSpec = {
  count: 14, speed: [60, 150], spread: 1.6, life: [0.25, 0.55], size: 1, ramp: RAMP_EMBER,
  kind: KIND_PIXEL, gain: 1.4, drag: 5, gravity: 60, flowRamp: 2.5, emissive: true,
};
/** 当たった所の光（HD） */
const HIT_GLOW: BurstSpec = {
  count: 3, speed: [4, 14], spread: TAU, life: [0.12, 0.22], size: 7, ramp: RAMP_GOLD,
  kind: KIND_HD, gain: 0, drag: 6, gravity: 0, flowRamp: 0, emissive: true, tone: TONE_WHITE,
};
const FIRE_PX: BurstSpec = {
  count: 22, speed: [30, 90], spread: TAU, life: [0.4, 0.9], size: 1, ramp: RAMP_EMBER,
  kind: KIND_PIXEL, gain: 1.8, drag: 3, gravity: -40, flowRamp: 2, radius: 3, emissive: true,
};
const FIRE_HD: BurstSpec = {
  count: 8, speed: [10, 40], spread: TAU, life: [0.3, 0.6], size: 6, ramp: RAMP_EMBER,
  kind: KIND_HD, gain: 1.2, drag: 3, gravity: -30, flowRamp: 1.5, radius: 3, emissive: true, tone: TONE_EMBER,
};
const MAGIC_PX: BurstSpec = {
  count: 24, speed: [25, 80], spread: TAU, life: [0.6, 1.2], size: 1, ramp: RAMP_MAGIC,
  kind: KIND_PIXEL, gain: 2.2, drag: 2.5, gravity: 0, flowRamp: 1.5, radius: 3, emissive: true,
};
const MAGIC_HD: BurstSpec = {
  count: 8, speed: [10, 35], spread: TAU, life: [0.4, 0.8], size: 5, ramp: RAMP_MAGIC,
  kind: KIND_HD, gain: 1.6, drag: 2.5, gravity: 0, flowRamp: 1.5, radius: 3, emissive: true, tone: TONE_MAGIC,
};
const CRIT_PX: BurstSpec = { ...SPARKS, count: 30, speed: [90, 220], spread: 1.2, life: [0.3, 0.7] };
const CRIT_HD: BurstSpec = { ...HIT_GLOW, count: 5, size: 11, life: [0.15, 0.3] };
const HEAL_PX: BurstSpec = {
  count: 18, speed: [8, 30], spread: 1.2, life: [0.8, 1.4], size: 1, ramp: RAMP_HEAL,
  kind: KIND_PIXEL, gain: 1.2, drag: 1.5, gravity: -28, flowRamp: 0.8, radius: 6, emissive: false,
};
const HEAL_HD: BurstSpec = {
  count: 7, speed: [6, 20], spread: 1.4, life: [0.7, 1.2], size: 4, ramp: RAMP_HEAL,
  kind: KIND_HD, gain: 1, drag: 1.5, gravity: -24, flowRamp: 0.8, radius: 6, emissive: true, tone: TONE_HEAL,
};
/** 撃破：魂の光が昇る（絵が崩れる粒は描く側が fromSprite で出す） */
const SOUL_HD: BurstSpec = {
  count: 6, speed: [6, 18], spread: 1, life: [0.6, 1.1], size: 5, ramp: RAMP_GOLD,
  kind: KIND_HD, gain: 1.4, drag: 2, gravity: -30, flowRamp: 1, radius: 4, emissive: true, tone: TONE_WHITE,
};
const LEVEL_PX: BurstSpec = {
  count: 40, speed: [20, 70], spread: TAU, life: [0.9, 1.6], size: 1, ramp: RAMP_GOLD,
  kind: KIND_PIXEL, gain: 1.6, drag: 1.8, gravity: -36, flowRamp: 1.2, radius: 8, emissive: true,
};
const LEVEL_HD: BurstSpec = {
  count: 14, speed: [8, 30], spread: TAU, life: [0.8, 1.4], size: 5, ramp: RAMP_GOLD,
  kind: KIND_HD, gain: 1.2, drag: 1.8, gravity: -40, flowRamp: 1, radius: 6, emissive: true, tone: TONE_GOLD,
};
const BLAST_FIRE: BurstSpec = {
  count: 44, speed: [50, 160], spread: TAU, life: [0.35, 0.9], size: 1, ramp: RAMP_EMBER,
  kind: KIND_PIXEL, gain: 2, drag: 3.2, gravity: -10, flowRamp: 2, radius: 6, emissive: true,
};
const BLAST_HD: BurstSpec = {
  count: 16, speed: [20, 80], spread: TAU, life: [0.3, 0.7], size: 9, ramp: RAMP_EMBER,
  kind: KIND_HD, gain: 1.5, drag: 3, gravity: -10, flowRamp: 1.5, radius: 6, emissive: true, tone: TONE_EMBER,
};
/** 爆発の煙：渦を巻いて昇りながら薄れる */
const BLAST_SMOKE: BurstSpec = {
  count: 26, speed: [15, 50], spread: TAU, life: [0.9, 1.8], size: 2, ramp: RAMP_SMOKE,
  kind: KIND_PIXEL, gain: 2.4, drag: 2, gravity: -14, flowRamp: 1, radius: 8, emissive: false,
};
const WARP_PX: BurstSpec = {
  count: 26, speed: [10, 40], spread: TAU, life: [0.5, 1.0], size: 1, ramp: RAMP_ICE,
  kind: KIND_PIXEL, gain: 3, drag: 2, gravity: -10, flowRamp: 0.5, radius: 8, emissive: true,
};
const WARP_HD: BurstSpec = {
  count: 6, speed: [4, 16], spread: TAU, life: [0.4, 0.8], size: 5, ramp: RAMP_ICE,
  kind: KIND_HD, gain: 2, drag: 2, gravity: -10, flowRamp: 0.5, radius: 6, emissive: true, tone: TONE_WATER,
};
const DUST_PX: BurstSpec = {
  count: 10, speed: [10, 35], spread: 2.4, life: [0.4, 0.8], size: 1, ramp: RAMP_DUST,
  kind: KIND_PIXEL, gain: 1.6, drag: 3, gravity: -4, flowRamp: 1.5, radius: 4, emissive: false,
};
const SPLASH_PX: BurstSpec = {
  count: 16, speed: [30, 70], spread: 1.8, life: [0.3, 0.6], size: 1, ramp: RAMP_WATER,
  kind: KIND_PIXEL, gain: 0.6, drag: 1.2, gravity: 160, flowRamp: 3, radius: 3, emissive: false,
};
const GAS_PX: BurstSpec = {
  count: 30, speed: [12, 40], spread: TAU, life: [1.0, 1.8], size: 2, ramp: RAMP_POISON,
  kind: KIND_PIXEL, gain: 2.6, drag: 1.6, gravity: -6, flowRamp: 0.8, radius: 6, emissive: false,
};
const STATUS_PX: BurstSpec = {
  count: 12, speed: [10, 30], spread: TAU, life: [0.5, 0.9], size: 1, ramp: RAMP_MAGIC,
  kind: KIND_PIXEL, gain: 2, drag: 2, gravity: -16, flowRamp: 1, radius: 5, emissive: true,
};
const ITEM_HD: BurstSpec = {
  count: 5, speed: [6, 18], spread: 1.2, life: [0.4, 0.7], size: 3, ramp: RAMP_GOLD,
  kind: KIND_HD, gain: 1, drag: 2, gravity: -26, flowRamp: 1, radius: 3, emissive: true, tone: TONE_GOLD,
};
const DIG_PX: BurstSpec = {
  count: 22, speed: [40, 110], spread: TAU, life: [0.35, 0.7], size: 1, ramp: RAMP_DUST,
  kind: KIND_PIXEL, gain: 0.8, drag: 2.5, gravity: 120, flowRamp: 3, radius: 5, emissive: false,
};

export const VFX: Readonly<Record<VfxPresetId, VfxRecipe>> = {
  hitPhysical: { bursts: [SPARKS, HIT_GLOW], directional: true, lift: 2 },
  hitFire: { bursts: [FIRE_PX, FIRE_HD], light: { color: '#ff9a40', radius: 2, intensity: 0.7, ms: 260 }, lift: 2 },
  hitMagic: { bursts: [MAGIC_PX, MAGIC_HD], light: { color: '#b070ff', radius: 2, intensity: 0.6, ms: 260 }, lift: 2 },
  crit: { bursts: [CRIT_PX, CRIT_HD], directional: true, light: { color: '#ffffff', radius: 2.5, intensity: 0.8, ms: 140 }, lift: 2 },
  heal: { bursts: [HEAL_PX, HEAL_HD], light: { color: '#8ff0a0', radius: 2, intensity: 0.5, ms: 500 }, lift: 6 },
  death: { bursts: [SOUL_HD], light: { color: '#fff0c0', radius: 1.5, intensity: 0.5, ms: 400 }, lift: 4 },
  levelUp: { bursts: [LEVEL_PX, LEVEL_HD], light: { color: '#ffe08a', radius: 3.5, intensity: 0.9, ms: 900 }, lift: 6 },
  explosion: {
    bursts: [BLAST_FIRE, BLAST_HD, BLAST_SMOKE],
    light: { color: '#ffa040', radius: 4, intensity: 1, ms: 420 }, shake: [6, 280], lift: 8,
  },
  warp: { bursts: [WARP_PX, WARP_HD], light: { color: '#9bd6f2', radius: 2, intensity: 0.5, ms: 350 }, lift: 6 },
  dust: { bursts: [DUST_PX], lift: 12 },
  splash: { bursts: [SPLASH_PX], lift: 11 },
  trapGas: { bursts: [GAS_PX], lift: 8 },
  statusApplied: { bursts: [STATUS_PX], lift: 2 },
  itemGet: { bursts: [ITEM_HD], lift: 8 },
  dig: { bursts: [DIG_PX], shake: [2, 120], lift: 8 },
};

/** ビームの属性 → 粒の色の進み方と HD の色の組 */
export const ELEMENT_RAMP: Readonly<Record<VfxElement, readonly number[]>> = {
  physical: RAMP_DUST, fire: RAMP_EMBER, ice: RAMP_ICE, thunder: RAMP_THUNDER, water: RAMP_WATER,
  magic: RAMP_MAGIC, poison: RAMP_POISON, light: RAMP_GOLD,
};
export const ELEMENT_TONE: Readonly<Record<VfxElement, number>> = {
  physical: TONE_WHITE, fire: TONE_EMBER, ice: TONE_WATER, thunder: TONE_GOLD, water: TONE_WATER,
  magic: TONE_MAGIC, poison: TONE_HEAL, light: TONE_GOLD,
};

/** 状態異常が掛かった瞬間の粒の色の進み方（無い状態は魔法の紫） */
const STATUS_RAMP: Readonly<Record<string, readonly number[]>> = {
  asleep: RAMP_ICE, deepAsleep: RAMP_ICE, confused: RAMP_GOLD, paralyzed: RAMP_THUNDER, poisoned: RAMP_POISON,
  deadlyPoisoned: RAMP_POISON, burning: RAMP_EMBER, wet: RAMP_WATER, slow: RAMP_SMOKE, quick: RAMP_ICE,
  sealed: RAMP_MAGIC, blind: RAMP_SMOKE, strUp: RAMP_EMBER, invincible: RAMP_GOLD, terrified: RAMP_ICE,
};
export const statusRamp = (id: string): readonly number[] => STATUS_RAMP[id] ?? RAMP_MAGIC;

/** 8 方向の向き（0 = 北から時計回り） */
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

/** 強さや色を変える時の使い回しの入れ物（書き写してから吹き出す） */
const scratchSpeed: [number, number] = [0, 0];
const scratch: BurstSpec = { ...SPARKS, speed: scratchSpeed };

function copyInto(dst: BurstSpec, src: Readonly<BurstSpec>): void {
  dst.count = src.count;
  dst.spread = src.spread;
  dst.life = src.life;
  dst.size = src.size;
  dst.ramp = src.ramp;
  dst.kind = src.kind;
  dst.gain = src.gain;
  dst.drag = src.drag;
  dst.gravity = src.gravity;
  dst.flowRamp = src.flowRamp;
  dst.radius = src.radius;
  dst.emissive = src.emissive;
  dst.tone = src.tone;
}

/**
 * 演出を吹き出す。(ax, ay) はマスの左上の世界のドット（tileX × 16, tileY × 16）。
 * 強さ（opts.power）で粒の数と速さを変える。trapGas・statusApplied は色を差し替える。
 * 生まれた粒の数を返す。光と揺れは呼ぶ側が VFX[preset] を見て出す
 */
export function fireVfx(pool: ParticlePool, preset: VfxPresetId, ax: number, ay: number,
  opts: Readonly<BurstOpts>): number {
  const r = VFX[preset];
  const cx = ax + 8;
  const cy = ay + (r.lift ?? 8);
  const dir = r.directional && opts.dir8 >= 0 ? opts.dir8 & 7 : -1;
  const p = opts.power > 0 ? opts.power : 1;
  let made = 0;
  for (const b of r.bursts) {
    let spec: Readonly<BurstSpec> = b;
    const recolor = preset === 'statusApplied' || (preset === 'trapGas' && opts.tag !== '');
    if (p !== 1 || recolor) {
      copyInto(scratch, b);
      const k = preset === 'explosion' ? Math.min(3, p) : p;
      scratch.count = Math.max(1, Math.round(b.count * k));
      scratchSpeed[0] = b.speed[0] * Math.sqrt(k);
      scratchSpeed[1] = b.speed[1] * Math.sqrt(k);
      if (preset === 'statusApplied') scratch.ramp = statusRamp(opts.tag);
      if (preset === 'trapGas' && opts.tag !== '') scratch.ramp = statusRamp(opts.tag);
      spec = scratch;
    }
    made += dir >= 0 ? pool.burst(spec, cx, cy, DX[dir], DY[dir]) : pool.burst(spec, cx, cy);
  }
  return made;
}
