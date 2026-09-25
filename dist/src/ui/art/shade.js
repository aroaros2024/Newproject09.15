/**
 * 仕上げ：輪郭・リムライト・影の縁を自動で付ける。
 *
 * 形を描いた「あと」に 1 回だけ掛ける。左右反転の「あと」に掛けるので、
 * 右向きの絵を反転して左向きにしても、光はいつも左上から当たる。
 *
 * 全部の絵がここを通るので、描き手が違っても輪郭と光の向きが揃う。
 * 決まりは docs/ART_GUIDE.md に書いてある。
 *
 * - 輪郭：形の外側 1 画素。隣の色の階調の一番暗い段。形の上と左に付く輪郭は 1 段明るい
 *   （光の当たる側は輪郭も明るい＝「セルアウト」）。光る色の隣には付けない
 * - リムライト：形の左上の縁を 1 段明るくする
 * - 影の縁：形の右下の縁を 1 段暗くする
 */
import { TRANSPARENT, isEmissive, outlineOf, shiftStep } from './palette.js';
/** 作業用。最大の枠（ボス 112×112）より大きめに確保して使い回す */
let scratch = new Uint8Array(128 * 128);
export function finalize(b, o = {}) {
    const outline = o.outline !== false;
    const rim = o.rim !== false;
    const shadowEdge = o.shadowEdge !== false;
    const keep = o.keep;
    const { w, h, px } = b;
    const n = w * h;
    if (scratch.length < n)
        scratch = new Uint8Array(n);
    const src = scratch;
    src.set(px.subarray(0, n));
    const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? TRANSPARENT : src[y * w + x];
    // 1. 縁の明暗（元の形で判定する）
    if (rim || shadowEdge) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const c = src[y * w + x];
                if (c === TRANSPARENT || isEmissive(c) || (keep && keep.has(c)))
                    continue;
                const openUp = at(x, y - 1) === TRANSPARENT;
                const openLeft = at(x - 1, y) === TRANSPARENT;
                const openDown = at(x, y + 1) === TRANSPARENT;
                const openRight = at(x + 1, y) === TRANSPARENT;
                if (rim && (openUp || openLeft) && !(openDown && openRight)) {
                    px[y * w + x] = shiftStep(c, 1);
                }
                else if (shadowEdge && (openDown || openRight) && !(openUp || openLeft)) {
                    px[y * w + x] = shiftStep(c, -1);
                }
            }
        }
    }
    // 2. 輪郭（形の外側に 1 画素）
    if (!outline)
        return;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (src[y * w + x] !== TRANSPARENT)
                continue;
            // 上下左右のどれかに形があれば輪郭。優先は 下 → 右 → 上 → 左
            // （下と右にある形の輪郭＝形の上と左に付く輪郭＝光の側）
            const below = at(x, y + 1);
            const right = at(x + 1, y);
            const above = at(x, y - 1);
            const left = at(x - 1, y);
            let c = TRANSPARENT;
            let lightSide = false;
            if (below !== TRANSPARENT && !isEmissive(below)) {
                c = below;
                lightSide = true;
            }
            else if (right !== TRANSPARENT && !isEmissive(right)) {
                c = right;
                lightSide = true;
            }
            else if (above !== TRANSPARENT && !isEmissive(above)) {
                c = above;
            }
            else if (left !== TRANSPARENT && !isEmissive(left)) {
                c = left;
            }
            if (c !== TRANSPARENT)
                px[y * w + x] = outlineOf(c, lightSide);
        }
    }
}
//# sourceMappingURL=shade.js.map