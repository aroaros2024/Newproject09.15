/**
 * キャラクターの組み立て（リグ）の約束。
 *
 * 絵は文字の格子ではなく、関数で組み立てる。関数は「姿勢」を受け取り、
 * 矩形・点の並び・楕円で画用紙に描く。姿勢を少しずつ変えればコマになる。
 *
 *   Pose     … 姿勢のつまみ（上下・前傾・頭・腕・武器の角度・脚・揺れ・伸縮・目・口・発光）
 *   AnimDef  … 動き 1 つ。コマ番号から姿勢を作る
 *   Rig      … 系統 1 つ（スライム・ネズミ…）。姿勢と向きと色の組から 1 コマ描く
 *   Species  … 敵 1 種。どのリグを、どの色の組と飾りで描くか
 *
 * 姿勢の値は小数でよい。描くときに必ず整数へ丸める（build の中で Math.round）。
 * 60fps で滑らかに動く値を、ドットの格子に落として 8〜12fps のコマ送りに見せる。
 */

import { PixBuf } from './pixbuf.js';
import { finalize, type FinalizeOptions } from './shade.js';
import { mirrorX } from './pixbuf.js';
import { type RampName, ci, rampIndex } from './palette.js';

// ---------------------------------------------------------------------------
// 姿勢
// ---------------------------------------------------------------------------

export interface Pose {
  /** 全身の上下（ドット。負が上） */
  bob: number;
  /** 前傾（ドット。正が前＝向いている方） */
  lean: number;
  /** 頭の上下・傾き（ドット） */
  head: number;
  /** 前の腕の上げ具合（0 = 下ろす、1 = 水平、2 = 真上） */
  armF: number;
  /** 後ろの腕 */
  armB: number;
  /** 武器・杖の角度。0〜15（22.5° 刻み、0 が真上、4 が前、8 が真下） */
  weapon: number;
  /** 脚（-1〜1。前に出ている量） */
  legL: number;
  legR: number;
  /** 布・髪・尾の揺れ（ドット） */
  sway: number;
  /** 横と縦の伸び縮み（ドット。正で伸びる） */
  sqX: number;
  sqY: number;
  /** 目 0 = 開く、1 = 細目、2 = 閉じる */
  eyes: number;
  /** 口 0 = 閉じる、1 = 開く、2 = 大きく開く */
  mouth: number;
  /** 発光の強さ 0〜1（宝石・目・口の炎） */
  glow: number;
  /** 系統ごとの自由なつまみ（翼の角度・触手・炎の丈など） */
  fx: number;
  fx2: number;
}

export function makePose(): Pose {
  return {
    bob: 0, lean: 0, head: 0, armF: 0, armB: 0, weapon: 0, legL: 0, legR: 0,
    sway: 0, sqX: 0, sqY: 0, eyes: 0, mouth: 0, glow: 0, fx: 0, fx2: 0,
  };
}

export function resetPose(p: Pose): void {
  p.bob = 0; p.lean = 0; p.head = 0; p.armF = 0; p.armB = 0; p.weapon = 0;
  p.legL = 0; p.legR = 0; p.sway = 0; p.sqX = 0; p.sqY = 0; p.eyes = 0;
  p.mouth = 0; p.glow = 0; p.fx = 0; p.fx2 = 0;
}

// ---------------------------------------------------------------------------
// 動き
// ---------------------------------------------------------------------------

export type AnimId = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'sleep' | 'use';

export const ANIM_IDS: readonly AnimId[] = ['idle', 'walk', 'attack', 'cast', 'hurt', 'sleep', 'use'];

export interface AnimDef {
  /** コマ数 */
  frames: number;
  /** 1 秒あたりのコマ数（歩きは進んだ距離でコマを進めるので参考値） */
  fps: number;
  /** 繰り返すか */
  loop: boolean;
  /** 攻撃が当たるコマ（攻撃・詠唱だけ） */
  strike?: number;
  /** i 番目のコマの姿勢を out に書く（n = コマ数） */
  pose(i: number, n: number, out: Pose): void;
}

// ---------------------------------------------------------------------------
// 向き
// ---------------------------------------------------------------------------

/** 描く向き。S = 手前（下）、N = 奥（上）、E = 右。斜めは主人公だけ */
export type DrawDir = 'S' | 'SE' | 'E' | 'NE' | 'N';

/**
 * 8 方向（0 = 北から時計回り）→ 描く向きと、左右反転するか。
 *   dirs 5：S・SE・E・NE・N を描き、西側は反転（主人公）
 *   dirs 3：S・N・E を描き、斜めは横、西側は反転（多くの敵）
 *   dirs 1：S だけ。西向きは反転して向きの見当だけ付ける（スライム・目・植物）
 */
export function facing(dir8: number, dirs: 1 | 3 | 5): { draw: DrawDir; mirror: boolean } {
  const d = ((dir8 % 8) + 8) % 8;
  const west = d >= 5;
  if (dirs === 1) return { draw: 'S', mirror: west };
  if (dirs === 3) {
    if (d === 0) return { draw: 'N', mirror: false };
    if (d === 4) return { draw: 'S', mirror: false };
    return { draw: 'E', mirror: west };
  }
  switch (d) {
    case 0: return { draw: 'N', mirror: false };
    case 1: return { draw: 'NE', mirror: false };
    case 2: return { draw: 'E', mirror: false };
    case 3: return { draw: 'SE', mirror: false };
    case 4: return { draw: 'S', mirror: false };
    case 5: return { draw: 'SE', mirror: true };
    case 6: return { draw: 'E', mirror: true };
    default: return { draw: 'NE', mirror: true };
  }
}

// ---------------------------------------------------------------------------
// 大きさの段
// ---------------------------------------------------------------------------

export type Tier = 'S' | 'M' | 'hero' | 'L' | 'boss';

export interface TierBox {
  /** 画用紙の大きさ */
  w: number;
  h: number;
  /** 足元（マスの (8, 13) に合わせる点） */
  ax: number;
  ay: number;
  /** 待機のコマで見える大きさの範囲（テストで確かめる） */
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  /** 使ってよい色の数（輪郭を含む） */
  maxColors: number;
  /** 描かれている画素の下限（小さすぎる・薄すぎる絵を弾く） */
  minPainted: number;
}

export const TIER_BOX: Readonly<Record<Tier, TierBox>> = {
  S: { w: 24, h: 24, ax: 12, ay: 21, minW: 10, maxW: 20, minH: 8, maxH: 20, maxColors: 24, minPainted: 60 },
  M: { w: 32, h: 40, ax: 16, ay: 37, minW: 14, maxW: 28, minH: 20, maxH: 36, maxColors: 28, minPainted: 150 },
  hero: { w: 32, h: 48, ax: 16, ay: 45, minW: 14, maxW: 24, minH: 30, maxH: 34, maxColors: 28, minPainted: 200 },
  L: { w: 64, h: 64, ax: 32, ay: 60, minW: 28, maxW: 60, minH: 32, maxH: 60, maxColors: 32, minPainted: 500 },
  boss: { w: 112, h: 112, ax: 56, ay: 106, minW: 60, maxW: 108, minH: 60, maxH: 108, maxColors: 32, minPainted: 1500 },
};

// ---------------------------------------------------------------------------
// リグと種
// ---------------------------------------------------------------------------

/**
 * 色の組。リグは「体」「腹」「目」のような材質の名前で色を指し、
 * 種ごとにどの階調を使うかを決める。段（明暗）はリグが決める。
 */
export interface Variant {
  /** 材質の名前 → 階調 */
  ramps: Readonly<Record<string, RampName>>;
  /** 飾りの有無などのビット（リグごとに意味を決める） */
  flags?: number;
  /** 系統の中での大きさの差（ドット。0 が基準） */
  grow?: number;
  /** リグごとの自由な数値（角の長さ・尾の本数など） */
  params?: Readonly<Record<string, number>>;
}

/** 材質と段から色番号。材質が無ければ ink */
export const mat = (v: Readonly<Variant>, name: string, step: number): number =>
  ci(v.ramps[name] ?? 'ink', step);

export interface Rig {
  id: string;
  tier: Tier;
  /** 描く向きの数 */
  dirs: 1 | 3 | 5;
  /** 持っている動き。無い動きは待機で代える */
  anims: Partial<Record<AnimId, AnimDef>>;
  /**
   * 1 コマ描く。画用紙は TIER_BOX の大きさで、空の状態で渡される。
   * 足元を (ax, ay) に置き、枠の内側 2 ドットは空けておく（輪郭が 1 ドット外へ出るため）。
   * 西向きは呼ぶ側が反転するので、ここでは描く向き（dir）のとおりに描けばよい。
   */
  build(b: PixBuf, pose: Readonly<Pose>, dir: DrawDir, v: Readonly<Variant>): void;
  /** 仕上げの指定（既定はすべて有効） */
  finish?: FinalizeOptions;
  /** 浮いている高さ（ドット）。影は地面に残る */
  hover?: number;
  /** 水に沈めて描く深さ（ドット）。影の代わりに波紋 */
  submerge?: number;
  /** 顔の範囲（一覧の小さな絵に使う）。無ければ待機の全身 */
  headBox?: { x: number; y: number; w: number; h: number };
}

export interface SpeciesDef {
  rig: string;
  variant: Variant;
  /** 自分で光るか（見えている時だけ光源になる） */
  light?: { color: string; radius: number; intensity: number };
}

const rigs = new Map<string, Rig>();
const species = new Map<string, SpeciesDef>();

export function registerRig(rig: Rig): void {
  rigs.set(rig.id, rig);
}

export function registerSpecies(table: Readonly<Record<string, SpeciesDef>>): void {
  for (const [id, def] of Object.entries(table)) species.set(id, def);
}

export const getRig = (id: string): Rig | undefined => rigs.get(id);
export const getSpecies = (id: string): SpeciesDef | undefined => species.get(id);
export const allSpeciesIds = (): string[] => [...species.keys()];
export const allRigIds = (): string[] => [...rigs.keys()];

// ---------------------------------------------------------------------------
// 1 コマ描く（テストと sheets.ts の両方から使う）
// ---------------------------------------------------------------------------

const workPose = makePose();

/** 動きを探す。無ければ待機、それも無ければ null */
export function animOf(rig: Rig, anim: AnimId): AnimDef | null {
  return rig.anims[anim] ?? rig.anims.idle ?? null;
}

/**
 * 種・動き・8 方向・コマ番号から 1 コマを描く。
 * out は呼ぶ側が TIER_BOX の大きさで用意し、ここで消してから描く。
 */
export function renderFrame(
  out: PixBuf, rig: Rig, v: Readonly<Variant>, anim: AnimId, dir8: number, frame: number,
): void {
  out.clear();
  const def = animOf(rig, anim);
  resetPose(workPose);
  if (def) def.pose(frame % def.frames, def.frames, workPose);
  const f = facing(dir8, rig.dirs);
  rig.build(out, workPose, f.draw, v);
  if (f.mirror) mirrorX(out);
  finalize(out, rig.finish);
}

/** 段の大きさの画用紙を作る */
export const bufferFor = (tier: Tier): PixBuf => new PixBuf(TIER_BOX[tier].w, TIER_BOX[tier].h);

/** 階調の名前が正しいか（種の定義の誤記を見つける） */
export const isRamp = (name: string): name is RampName => rampIndex(name as RampName) >= 0;
