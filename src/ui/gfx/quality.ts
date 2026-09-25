/**
 * 画質の段（0 = 低・1 = 中・2 = 高）。どの重ね描きをするかをここで決める。
 *
 * 重いのは「画面全体に補間しながら描く」こと（ソフトウェア描画で 1 回 3〜4ms。最近傍なら 0.5ms）。
 * 光の乗算・光だまり・床の物とキャラの重ね・彩度は画用紙（428×240）の上で済ませるので、
 * 画面全体への描き込みは段ごとに次の回数になる（compositor.ts）：
 *   高 7 回：地形・ぼかしの帯（上下 1/4）・床の物とキャラ・霧（上半分）・加算（ブルーム 2 段＋光の筋）・色味・周辺減光
 *   中 4 回：世界（1 枚にまとめた画用紙）・加算（ブルーム 1 段）・周辺減光（色味は画用紙の上）
 *   低 1 回：世界
 * 目標（実機）は描画 高 6ms・中 4ms・低 2.5ms。headless Chromium では p95 が 20 / 14 / 10ms 以内。
 *
 * 数字は計画の表（光の解像度・ブルームの段・環境の粒の数）に合わせてある。
 * DOM に触れないので node のテストから読める。
 */

export type QualityLevel = 0 | 1 | 2;

/** 色調の掛け方 */
export const GRADE_NONE = 0;
/** 色味（soft-light の重ね）だけ */
export const GRADE_TINT = 1;
/** 彩度を落とす ＋ 色味 */
export const GRADE_FULL = 2;

export interface QualityPreset {
  readonly level: QualityLevel;
  /** 設定画面に出す名前 */
  readonly name: string;
  /**
   * 光の紙の 1 画素が画用紙の何ドットか。2 なら 214×120、4 なら 107×60。
   * 光はぼかして広げるので粗くても形は崩れないが、細い光の縁は 2 の方がきれい
   */
  readonly lightDiv: 2 | 4;
  /** キャラの輪郭に光の側から縁の光を足す */
  readonly rim: boolean;
  /** ブルームの段（0 = 無し。1 = 1/8、2 = 1/8 と 1/16） */
  readonly bloomLevels: 0 | 1 | 2;
  /** ブルームを足す強さ（0.35〜0.6。強すぎると画面が濁る） */
  readonly bloomStrength: number;
  /** 光だまりを加算で少し明るくする量（0 で描かない） */
  readonly overbright: number;
  /** 被写界深度（画面の上下の地形をぼかす）。設定で切ればこれより優先して切れる */
  readonly dof: boolean;
  /** 光の筋 */
  readonly shafts: boolean;
  /** 奥の霧（2 枚の視差） */
  readonly fog: boolean;
  /** 色調 GRADE_NONE / GRADE_TINT / GRADE_FULL */
  readonly grade: number;
  /** 周辺減光 */
  readonly vignette: boolean;
  /** 環境の粒の上限（塵・火の粉など） */
  readonly ambientParticles: number;
  /** 粒の置き場の上限（技の粒も含む） */
  readonly particleCap: number;
  /** 技の演出の粒の数に掛ける倍率 */
  readonly vfxScale: number;
  /** 水・溶岩のコマ送りの速さ（毎秒のコマ数） */
  readonly liquidFps: number;
  /**
   * 倍率が整数でない画面で、一度大きく最近傍で拡大してから滑らかに縮める（ドットの幅を揃える）。
   * 切ると最近傍のまま描く（速いが、ドットの幅が 1px ずつばらつく）
   */
  readonly sharpScaling: boolean;
}

const LOW: QualityPreset = {
  level: 0, name: '低', lightDiv: 4, rim: false, bloomLevels: 0, bloomStrength: 0,
  overbright: 0, dof: false, shafts: false, fog: false, grade: GRADE_NONE, vignette: false,
  ambientParticles: 100, particleCap: 512, vfxScale: 0.35, liquidFps: 4, sharpScaling: false,
};

const MEDIUM: QualityPreset = {
  level: 1, name: '中', lightDiv: 4, rim: false, bloomLevels: 1, bloomStrength: 0.45,
  overbright: 0.16, dof: false, shafts: false, fog: false, grade: GRADE_TINT, vignette: true,
  ambientParticles: 220, particleCap: 1024, vfxScale: 0.6, liquidFps: 6, sharpScaling: true,
};

const HIGH: QualityPreset = {
  level: 2, name: '高', lightDiv: 2, rim: true, bloomLevels: 2, bloomStrength: 0.5,
  overbright: 0.2, dof: true, shafts: true, fog: true, grade: GRADE_FULL, vignette: true,
  ambientParticles: 400, particleCap: 2048, vfxScale: 1, liquidFps: 8, sharpScaling: true,
};

/** 段の表（番号 = 段） */
export const QUALITY_PRESETS: readonly QualityPreset[] = [LOW, MEDIUM, HIGH];

/** 段の番号から表を引く。範囲の外や小数は切り詰める（古いセーブの値でも落ちない） */
export function qualityPreset(level: number): QualityPreset {
  const q = Number.isFinite(level) ? Math.max(0, Math.min(2, Math.floor(level))) : 2;
  return QUALITY_PRESETS[q];
}
