/**
 * 粒子を描く（gfx-core/particles.ts の置き場を読むだけ）。
 *
 * 描き方は 2 通り。
 *   - ドットの粒：画用紙（428×240 ドット）に 1 ドットの四角。色はパレットの番号なので、
 *     光の乗算・拡大がほかのドット絵と同じに掛かる
 *   - HD の粒：画面の実画素（1280×720）に、柔らかい光の玉を加算で重ねる。
 *     光の玉は 16×16 の 8 色を 1 枚の atlas に先に焼いておき、drawImage で写すだけ
 * 光る粒はブルームの層にも描く（drawEmissive）。
 *
 * 毎フレームの割り当ては無い。色の文字列はパレットの表（PAL_CSS）をそのまま渡す。
 */
import { EMISSIVE, PAL_CSS, rgbOf, shiftStep } from '../art/palette.js';
import { HD_TONE_CORE, HD_TONE_COUNT, HD_TONE_RIM, KIND_HD, KIND_PIXEL, PF_EMISSIVE, PF_LIT, } from '../gfx-core/particles.js';
import { ctx2d, makeCanvas } from './canvas.js';
/** 光の玉 1 つの大きさ（atlas の 1 マス、px） */
export const HD_DOT = 16;
/**
 * 光の玉の atlas を焼く。起動時に 1 回だけ呼ぶ。
 * 芯は明るい色で、外へ向かって縁の色で薄れる。
 */
export function makeHDAtlas() {
    const cell = HD_DOT;
    const c = makeCanvas(cell * HD_TONE_COUNT, cell);
    const g = ctx2d(c);
    g.clearRect(0, 0, cell * HD_TONE_COUNT, cell);
    const r = cell / 2;
    for (let t = 0; t < HD_TONE_COUNT; t++) {
        const cx = t * cell + r;
        const [cr, cg, cb] = rgbOf(HD_TONE_CORE[t]);
        const [er, eg, eb] = rgbOf(HD_TONE_RIM[t]);
        const grad = g.createRadialGradient(cx, r, 0, cx, r, r);
        // 芯を小さく、裾を長く（硬い円盤に見えないように）
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
        grad.addColorStop(0.1, `rgba(${cr},${cg},${cb},0.85)`);
        grad.addColorStop(0.3, `rgba(${er},${eg},${eb},0.4)`);
        grad.addColorStop(0.6, `rgba(${er},${eg},${eb},0.12)`);
        grad.addColorStop(1, `rgba(${er},${eg},${eb},0)`);
        g.fillStyle = grad;
        g.fillRect(t * cell, 0, cell, cell);
    }
    return { canvas: c, cell };
}
/**
 * ドットの粒を画用紙に描く。(camX, camY) は画用紙の左上の世界座標（整数のドット）。
 * lightStep を付けると、光らない粒（PF_LIT）の色を階調の中で何段かずらす
 * （暗い部屋で −1 など。光の層より後に描く場合の簡易な陰り）。HD の粒は描かない。
 */
export function drawPixelParticles(ctx, pool, camX, camY, lightStep = 0) {
    const n = pool.count;
    const { x, y, size, kind, flags } = pool;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    let last = -1;
    for (let i = 0; i < n; i++) {
        if (kind[i] !== KIND_PIXEL)
            continue;
        const px = Math.round(x[i]) - camX;
        const py = Math.round(y[i]) - camY;
        const s = size[i] <= 1 ? 1 : Math.round(size[i]);
        if (px + s <= 0 || py + s <= 0 || px >= w || py >= h)
            continue;
        let c = pool.colorIndexOf(i);
        if (lightStep !== 0 && (flags[i] & PF_LIT) !== 0)
            c = shiftStep(c, lightStep);
        // 同じ色が続くときは fillStyle を触らない（文字列の解釈を省く）
        if (c !== last) {
            ctx.fillStyle = PAL_CSS[c];
            last = c;
        }
        ctx.fillRect(px, py, s, s);
    }
}
/**
 * HD の粒を加算で描く。濃さは pool.alphaOf（技の粒は 1 − 年齢/寿命）。
 * 描き終わったら合成の設定を元に戻す。
 */
export function drawHDParticles(ctx, pool, xf, atlas) {
    const n = pool.count;
    const { x, y, size, kind, tone } = pool;
    const cell = atlas.cell;
    const k = xf.scale;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
        if (kind[i] !== KIND_HD)
            continue;
        const a = pool.alphaOf(i);
        if (a <= 0.01)
            continue;
        // 玉の半径（px）。atlas の玉は 1 マスの半分まで広がる
        const r = size[i] * k;
        const cx = (x[i] + 0.5) * k + xf.offX;
        const cy = (y[i] + 0.5) * k + xf.offY;
        if (cx + r < 0 || cy + r < 0 || cx - r > w || cy - r > h)
            continue;
        ctx.globalAlpha = a > 1 ? 1 : a;
        ctx.drawImage(atlas.canvas, tone[i] * cell, 0, cell, cell, cx - r, cy - r, r * 2, r * 2);
    }
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
}
/**
 * ブルームの層に、光る粒（PF_EMISSIVE）だけを描く。
 * ドットの粒は今の色が光る色（EMISSIVE）の間だけ載せる（火の粉は煤になったら光らない）。
 * 層の大きさは自由（1/4 に縮めた紙なら scale = 0.75 など）。加算で重ねる。
 */
export function drawEmissive(ctx, pool, xf, atlas) {
    const n = pool.count;
    const { x, y, size, kind, flags, tone } = pool;
    const cell = atlas.cell;
    const k = xf.scale;
    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    let last = -1;
    for (let i = 0; i < n; i++) {
        if ((flags[i] & PF_EMISSIVE) === 0)
            continue;
        if (kind[i] === KIND_HD) {
            const a = pool.alphaOf(i);
            if (a <= 0.01)
                continue;
            const r = size[i] * k;
            ctx.globalAlpha = a > 1 ? 1 : a;
            ctx.drawImage(atlas.canvas, tone[i] * cell, 0, cell, cell, (x[i] + 0.5) * k + xf.offX - r, (y[i] + 0.5) * k + xf.offY - r, r * 2, r * 2);
            continue;
        }
        const c = pool.colorIndexOf(i);
        if (EMISSIVE[c] !== 1)
            continue;
        ctx.globalAlpha = 1;
        if (c !== last) {
            ctx.fillStyle = PAL_CSS[c];
            last = c;
        }
        const s = (size[i] <= 1 ? 1 : Math.round(size[i])) * k;
        ctx.fillRect(Math.round(x[i]) * k + xf.offX, Math.round(y[i]) * k + xf.offY, s, s);
    }
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
}
//# sourceMappingURL=particlesDraw.js.map