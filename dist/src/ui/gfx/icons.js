/**
 * UI に出す小さな絵（一覧の行・ショートカット・ガチャのカード・図鑑）を 1 か所で描く。
 *
 * 鍵の読み方（上から順に探す）
 *   1. 道具の絵の鍵・「trap:<ワナ>」 → 新しい 16×16 の絵（sprites.ts の橋渡し経由）
 *   2. 種の id（敵・相棒）で、リグが登録されていれば → 待機のコマ（動く）。枠に収まる整数倍で
 *   3. どれも無ければ旧い 16×16 の絵（新しい絵が揃うまでの仮）
 *
 * 種の絵は（種・動き・向き・コマ）ごとに 1 度だけ焼いて覚える。毎フレーム描き直さない。
 * ドットは整数倍でしか拡大しない（半端な倍率はドットの幅がばらつく）。
 */
import { hasIcon } from '../art/items.js';
import { PixBuf, bbox } from '../art/pixbuf.js';
import { TIER_BOX, animOf, getRig, getSpecies, renderFrame } from '../art/rig.js';
import { getSprite, sprites } from '../sprites.js';
import { pixBufToCanvas } from './canvas.js';
const frames = new Map();
/** 種の 1 コマを焼いて返す。リグが無ければ null */
export function speciesFrame(id, anim = 'idle', dir8 = 4, frame = 0) {
    const key = `${id}|${anim}|${dir8}|${frame}`;
    const hit = frames.get(key);
    if (hit !== undefined)
        return hit;
    const def = getSpecies(id);
    const rig = def ? getRig(def.rig) : undefined;
    let out = null;
    if (def && rig) {
        const box = TIER_BOX[rig.tier];
        const b = new PixBuf(box.w, box.h);
        renderFrame(b, rig, def.variant, anim, dir8, frame);
        const r = bbox(b);
        out = { canvas: pixBufToCanvas(b), bx: r.x, by: r.y, bw: r.w, bh: r.h, ax: box.ax, ay: box.ay };
    }
    frames.set(key, out);
    return out;
}
export const hasSpeciesArt = (id) => {
    const def = getSpecies(id);
    return !!def && !!getRig(def.rig);
};
/** 待機のコマ番号（時刻から。種ごとの fps） */
function idleFrame(id, now) {
    const def = getSpecies(id);
    const rig = def ? getRig(def.rig) : undefined;
    const a = rig ? animOf(rig, 'idle') : null;
    if (!a)
        return 0;
    return Math.floor((now / 1000) * a.fps) % a.frames;
}
/**
 * 種の待機の絵を、size × size の枠に収まる一番大きな整数倍で、中心 (cx, cy) に描く。
 * 塗られている範囲で合わせるので、小さな敵も枠いっぱいに見える。リグが無ければ false
 */
export function drawSpeciesFit(g, id, cx, cy, size, now, alpha = 1) {
    const f0 = speciesFrame(id, 'idle', 4, 0);
    if (!f0 || f0.bw === 0)
        return false;
    const f = speciesFrame(id, 'idle', 4, idleFrame(id, now)) ?? f0;
    // 大きさはコマ 0 の範囲で決める（コマごとに倍率が変わって跳ねないように）
    const k = Math.max(1, Math.floor(size / Math.max(f0.bw, f0.bh)));
    const x = Math.round(cx - (f0.bw * k) / 2 - f0.bx * k);
    const y = Math.round(cy - (f0.bh * k) / 2 - f0.by * k);
    g.save();
    g.imageSmoothingEnabled = false;
    if (alpha < 1)
        g.globalAlpha *= alpha;
    g.drawImage(f.canvas, x, y, f.canvas.width * k, f.canvas.height * k);
    g.restore();
    return true;
}
/** 種の絵を足元 (feetX, feetY) に合わせて scale 倍で描く（村の人・カードの大きな絵） */
export function drawSpeciesAt(g, id, feetX, feetY, scale, now, o = {}) {
    const def = getSpecies(id);
    const rig = def ? getRig(def.rig) : undefined;
    if (!rig)
        return false;
    const anim = o.anim ?? 'idle';
    const a = animOf(rig, anim);
    const frame = a ? Math.floor((now / 1000) * a.fps) % a.frames : 0;
    const f = speciesFrame(id, anim, o.dir8 ?? 4, frame);
    if (!f)
        return false;
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(f.canvas, Math.round(feetX - f.ax * scale), Math.round(feetY - f.ay * scale), f.canvas.width * scale, f.canvas.height * scale);
    g.restore();
    return true;
}
/**
 * 鍵の絵を中心 (cx, cy)・大きさ size で描く。描けなければ false（呼ぶ側は何も描かない）。
 * 道具の絵を先に見るので、道具と同じ名前の種があっても道具の絵になる。
 */
export function drawIconKey(g, key, cx, cy, size, now = 0, o = {}) {
    const alpha = o.alpha ?? 1;
    if (!hasIcon(key) && !key.startsWith('trap:') && drawSpeciesFit(g, key, cx, cy, size, now, alpha))
        return true;
    const legacy = getSprite(key);
    if (!legacy)
        return false;
    sprites.draw(g, key, legacy, cx, cy, size, alpha < 1 ? { alpha } : {});
    return true;
}
//# sourceMappingURL=icons.js.map