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
import { finalize } from './shade.js';
import { mirrorX } from './pixbuf.js';
import { ci, rampIndex } from './palette.js';
export function makePose() {
    return {
        bob: 0, lean: 0, head: 0, armF: 0, armB: 0, weapon: 0, legL: 0, legR: 0,
        sway: 0, sqX: 0, sqY: 0, eyes: 0, mouth: 0, glow: 0, fx: 0, fx2: 0,
    };
}
export function resetPose(p) {
    p.bob = 0;
    p.lean = 0;
    p.head = 0;
    p.armF = 0;
    p.armB = 0;
    p.weapon = 0;
    p.legL = 0;
    p.legR = 0;
    p.sway = 0;
    p.sqX = 0;
    p.sqY = 0;
    p.eyes = 0;
    p.mouth = 0;
    p.glow = 0;
    p.fx = 0;
    p.fx2 = 0;
}
export const ANIM_IDS = ['idle', 'walk', 'attack', 'cast', 'hurt', 'sleep', 'use'];
/**
 * 8 方向（0 = 北から時計回り）→ 描く向きと、左右反転するか。
 *   dirs 5：S・SE・E・NE・N を描き、西側は反転（主人公）
 *   dirs 3：S・N・E を描き、斜めは横、西側は反転（多くの敵）
 *   dirs 1：S だけ。西向きは反転して向きの見当だけ付ける（スライム・目・植物）
 */
export function facing(dir8, dirs) {
    const d = ((dir8 % 8) + 8) % 8;
    const west = d >= 5;
    if (dirs === 1)
        return { draw: 'S', mirror: west };
    if (dirs === 3) {
        if (d === 0)
            return { draw: 'N', mirror: false };
        if (d === 4)
            return { draw: 'S', mirror: false };
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
export const TIER_BOX = {
    S: { w: 24, h: 24, ax: 12, ay: 21, minW: 10, maxW: 20, minH: 8, maxH: 20, maxColors: 24, minPainted: 60 },
    M: { w: 32, h: 40, ax: 16, ay: 37, minW: 14, maxW: 28, minH: 20, maxH: 36, maxColors: 28, minPainted: 150 },
    hero: { w: 32, h: 48, ax: 16, ay: 45, minW: 14, maxW: 24, minH: 30, maxH: 34, maxColors: 28, minPainted: 200 },
    L: { w: 64, h: 64, ax: 32, ay: 60, minW: 28, maxW: 60, minH: 32, maxH: 60, maxColors: 32, minPainted: 500 },
    boss: { w: 112, h: 112, ax: 56, ay: 106, minW: 60, maxW: 108, minH: 60, maxH: 108, maxColors: 32, minPainted: 1500 },
};
/** 材質と段から色番号。材質が無ければ ink */
export const mat = (v, name, step) => ci(v.ramps[name] ?? 'ink', step);
const rigs = new Map();
const species = new Map();
export function registerRig(rig) {
    rigs.set(rig.id, rig);
}
export function registerSpecies(table) {
    for (const [id, def] of Object.entries(table))
        species.set(id, def);
}
export const getRig = (id) => rigs.get(id);
export const getSpecies = (id) => species.get(id);
export const allSpeciesIds = () => [...species.keys()];
export const allRigIds = () => [...rigs.keys()];
// ---------------------------------------------------------------------------
// 1 コマ描く（テストと sheets.ts の両方から使う）
// ---------------------------------------------------------------------------
const workPose = makePose();
/** 動きを探す。無ければ待機、それも無ければ null */
export function animOf(rig, anim) {
    return rig.anims[anim] ?? rig.anims.idle ?? null;
}
/**
 * 種・動き・8 方向・コマ番号から 1 コマを描く。
 * out は呼ぶ側が TIER_BOX の大きさで用意し、ここで消してから描く。
 */
export function renderFrame(out, rig, v, anim, dir8, frame) {
    out.clear();
    const def = animOf(rig, anim);
    resetPose(workPose);
    if (def)
        def.pose(frame % def.frames, def.frames, workPose);
    const f = facing(dir8, rig.dirs);
    rig.build(out, workPose, f.draw, v);
    if (f.mirror)
        mirrorX(out);
    finalize(out, rig.finish);
}
/** 段の大きさの画用紙を作る */
export const bufferFor = (tier) => new PixBuf(TIER_BOX[tier].w, TIER_BOX[tier].h);
/** 階調の名前が正しいか（種の定義の誤記を見つける） */
export const isRamp = (name) => rampIndex(name) >= 0;
//# sourceMappingURL=rig.js.map