/**
 * キャンバスを作る道具と、ドットの画用紙（PixBuf）を画面へ写す道具。
 *
 * OffscreenCanvas がある環境ではそれを使い、無ければ <canvas> を作る。
 * どちらも drawImage の元にできる。
 */
import { PAL_RGBA } from '../art/palette.js';
export function makeCanvas(w, h) {
    const cw = Math.max(1, Math.floor(w));
    const ch = Math.max(1, Math.floor(h));
    if (typeof OffscreenCanvas !== 'undefined')
        return new OffscreenCanvas(cw, ch);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return c;
}
export function ctx2d(c) {
    const g = c.getContext('2d');
    if (!g)
        throw new Error('2D コンテキストを取得できませんでした');
    g.imageSmoothingEnabled = false;
    return g;
}
/**
 * 画用紙の中身を ImageData に写す。
 * data は呼ぶ側で使い回せるよう、足りなければ作り直して返す。
 */
export function pixBufToImageData(b, reuse) {
    const img = reuse && reuse.width === b.w && reuse.height === b.h
        ? reuse : new ImageData(b.w, b.h);
    const u32 = new Uint32Array(img.data.buffer);
    const px = b.px;
    for (let i = 0; i < px.length; i++)
        u32[i] = PAL_RGBA[px[i]];
    return img;
}
/** 画用紙を 1 枚のキャンバスにする（見本帳・一覧の小さな絵用） */
export function pixBufToCanvas(b) {
    const c = makeCanvas(b.w, b.h);
    const g = ctx2d(c);
    g.putImageData(pixBufToImageData(b), 0, 0);
    return c;
}
//# sourceMappingURL=canvas.js.map