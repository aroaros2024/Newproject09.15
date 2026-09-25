/**
 * 枠の部品を一度だけ焼いておく（毎フレーム作らない）。
 *
 * - 四隅の飾り：ドット絵（8×8 ドット）を 2 倍で描く。金の階調だけで描き、左上の 1 枚を反転して 4 隅に使う
 * - 地のグラデーション：1×64 の帯を焼いて、枠の大きさに引き伸ばす（グラデーションの生成を毎回しない）
 * - 選択の帯：64×1 の帯を焼いて引き伸ばす
 * - 指し手：金のドットの三角（5×7 ドット）
 * - ゲージの両端の菱形
 */
import { PixBuf, mirrorX, runs } from '../art/pixbuf.js';
import { ci } from '../art/palette.js';
import { ctx2d, makeCanvas, pixBufToCanvas } from '../gfx/canvas.js';
import { PANEL, SELECT } from './tokens.js';
/** 金の階調（暗 → 明） */
const G = {
    e: ci('gold', 0),
    d: ci('gold', 1),
    c: ci('gold', 2),
    b: ci('gold', 3),
    a: ci('gold', 4),
    w: ci('gold', 5),
};
/**
 * 左上の飾り（12×12 ドット、2 倍で描く）。枠の角に菱形の飾りを置き、
 * そこから上辺と左辺に沿って短い腕を伸ばす。菱形の中心（4, 4）が枠の角に重なる。
 * （'.' は透明。w が一番明るい。光は左上から）
 */
const CORNER_ROWS = [
    '....a.......',
    '...awb......',
    '..awwbc.....',
    '.awwbbcd....',
    'abbbcccdbbcd',
    '.bcccdd.....',
    '..cddd......',
    '...dd.......',
    '....b.......',
    '....c.......',
    '....c.......',
    '....d.......',
];
/** ゲージの端の菱形（4×8） */
const CAP_ROWS = [
    '.ab.',
    'awbc',
    'abcd',
    'abcd',
    'bccd',
    'bccd',
    '.cd.',
    '....',
];
/** 選択の指し手（5×7、右向き） */
const POINTER_ROWS = [
    'a....',
    'wa...',
    'wba..',
    'abbc.',
    'bccd.',
    'cdd..',
    'd....',
];
let parts = null;
function fromRows(rows, flipX = false, flipY = false) {
    const w = rows[0].length;
    const h = rows.length;
    const b = new PixBuf(w, h);
    runs(b, 0, 0, flipY ? [...rows].reverse() : rows, G);
    if (flipX)
        mirrorX(b);
    return pixBufToCanvas(b);
}
/** 部品を用意する（初めて呼ばれたときに 1 回だけ焼く） */
export function frameParts() {
    if (parts)
        return parts;
    const bg = makeCanvas(1, 64);
    {
        const g = ctx2d(bg);
        const grad = g.createLinearGradient(0, 0, 0, 64);
        grad.addColorStop(0, PANEL.bgTop);
        grad.addColorStop(1, PANEL.bgBottom);
        g.fillStyle = grad;
        g.fillRect(0, 0, 1, 64);
    }
    const select = makeCanvas(64, 1);
    {
        const g = ctx2d(select);
        const grad = g.createLinearGradient(0, 0, 64, 0);
        grad.addColorStop(0, SELECT.from);
        grad.addColorStop(1, SELECT.to);
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 1);
    }
    parts = {
        corners: [
            fromRows(CORNER_ROWS),
            fromRows(CORNER_ROWS, true),
            fromRows(CORNER_ROWS, false, true),
            fromRows(CORNER_ROWS, true, true),
        ],
        bg,
        select,
        pointer: fromRows(POINTER_ROWS),
        capL: fromRows(CAP_ROWS),
        capR: fromRows(CAP_ROWS, true),
    };
    return parts;
}
//# sourceMappingURL=frame.js.map