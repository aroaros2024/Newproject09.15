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
/** 色調の掛け方 */
export const GRADE_NONE = 0;
/** 色味（soft-light の重ね）だけ */
export const GRADE_TINT = 1;
/** 彩度を落とす ＋ 色味 */
export const GRADE_FULL = 2;
const LOW = {
    level: 0, name: '低', lightDiv: 4, rim: false, bloomLevels: 0, bloomStrength: 0,
    overbright: 0, dof: false, shafts: false, fog: false, grade: GRADE_NONE, vignette: false,
    ambientParticles: 100, particleCap: 512, vfxScale: 0.35, liquidFps: 4, sharpScaling: false,
};
const MEDIUM = {
    level: 1, name: '中', lightDiv: 4, rim: false, bloomLevels: 1, bloomStrength: 0.45,
    overbright: 0.16, dof: false, shafts: false, fog: false, grade: GRADE_TINT, vignette: true,
    ambientParticles: 220, particleCap: 1024, vfxScale: 0.6, liquidFps: 6, sharpScaling: true,
};
const HIGH = {
    level: 2, name: '高', lightDiv: 2, rim: true, bloomLevels: 2, bloomStrength: 0.5,
    overbright: 0.2, dof: true, shafts: true, fog: true, grade: GRADE_FULL, vignette: true,
    ambientParticles: 400, particleCap: 2048, vfxScale: 1, liquidFps: 8, sharpScaling: true,
};
/** 段の表（番号 = 段） */
export const QUALITY_PRESETS = [LOW, MEDIUM, HIGH];
/** 段の番号から表を引く。範囲の外や小数は切り詰める（古いセーブの値でも落ちない） */
export function qualityPreset(level) {
    const q = Number.isFinite(level) ? Math.max(0, Math.min(2, Math.floor(level))) : 2;
    return QUALITY_PRESETS[q];
}
//# sourceMappingURL=quality.js.map