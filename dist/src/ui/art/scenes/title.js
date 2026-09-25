/**
 * タイトルの背景（夜の風の村と、遠くの天輪の塔）。DOM 無し。
 *
 * 428×240 の画用紙（ダンジョンと同じ 3 倍の世界）に、奥から順に 5 枚の層で描く。
 * 層ごとに「ずらす量（視差）」と「ぼかす段（被写界深度）」を持つので、
 * 描く側はゆっくり横へ流しながら、奥と手前をぼかして中央（村）をくっきり見せる。
 *
 *   0 空：月・星（空の色はなめらかなグラデーションで、描く側が塗る）
 *   1 遠景：山並みと天輪の塔（塔の窓と頂の輪が光る）
 *   2 中景：丘と木立、遠くの家の灯り
 *   3 村：家々・風車・灯籠・小道（主役。ぼかさない）
 *   4 手前：草むらと柵の影（ぼかす）
 */
import { RAMP_HEAL, WHITE, ci } from '../palette.js';
import { PixBuf, disc, hline, rect, vline } from '../pixbuf.js';
import { hash2 } from '../hash.js';
import { DIORAMA_H, DIORAMA_W, NIGHT, house, lantern, noise1, ridge, tower, trees, windmillBody, } from './common.js';
/** 夜風に舞う葉（ドットの粒） */
const LEAVES = {
    name: '葉', region: 'view', cap: 28, rate: 5, life: [5, 9], ramp: RAMP_HEAL, glow: null,
    size: 1, flow: 1.6, gravity: 5,
};
/** 灯籠のまわりの蛍（HD の粒・明滅） */
const FIREFLIES = {
    name: '蛍', region: 'torch', cap: 14, rate: 3, life: [4, 8], ramp: null, glow: '#e8f09a',
    size: 2, flow: 0.9, gravity: -2, blink: true, emissive: true,
};
function sky(b, stars) {
    // 空の色そのものは描く側がなめらかなグラデーションで塗る（Diorama.sky）。
    // ドットのディザで塗ると横縞が目立つので、ここでは月と星だけを描く
    // 月（左上。光は左上から来るので、月も左上に置く）
    const mx = 74;
    const my = 44;
    disc(b, mx, my, 13, ci('bone', 5));
    disc(b, mx + 3, my + 2, 11, ci('bone', 4));
    disc(b, mx + 1, my, 10, ci('bone', 5));
    for (const [x, y, r] of [[mx + 4, my - 3, 2], [mx - 3, my + 4, 1], [mx + 6, my + 5, 2]]) {
        disc(b, x, y, r, ci('bone', 4));
    }
    b.set(mx - 5, my - 6, WHITE);
    // 星
    for (let y = 2; y < 150; y++) {
        for (let x = 2; x < DIORAMA_W - 2; x++) {
            const h = hash2(x, y, 7101);
            if (h % 523 !== 0)
                continue;
            if (Math.hypot(x - mx, y - my) < 22)
                continue;
            const big = (h >>> 12) % 7 === 0;
            stars.push({ x, y, big, phase: ((h >>> 4) % 1000) / 1000 });
            b.set(x, y, big ? WHITE : ci('indigo', y < 60 ? 5 : 4));
        }
    }
}
/** 遠景：山並みと天輪の塔 */
function far(b, lights) {
    ridge(b, (x) => Math.round(150 + 26 * noise1(x / 70, 11) - 18 * noise1(x / 23, 12) + 4 * noise1(x / 7, 13)), ci('ink', 1), ci('ink', 2));
    tower(b, 318, 34, 162, lights, 1, NIGHT);
}
/** 中景：丘と木立、遠くの家の灯り */
function mid(b, lights) {
    const hill = (x) => Math.round(186 + 10 * noise1(x / 55, 21) - 6 * noise1(x / 19, 22));
    for (let x = 0; x < DIORAMA_W; x++)
        vline(b, x, hill(x), DIORAMA_H - hill(x), ci('moss', 0));
    // 塔の足元は空けて見せる
    trees(b, 40, 31, hill, ci('moss', 0), ci('moss', 1), (x) => x > 300 && x < 336);
    for (const x of [58, 148, 232, 402]) {
        const y = hill(x) + 2;
        rect(b, x - 4, y - 3, 8, 5, ci('ink', 1));
        b.set(x - 2, y - 1, ci('gold', 5));
        b.set(x + 1, y - 1, ci('ember', 4));
        lights.push({ x, y: y - 1, radius: 9, color: '#ffc46a', intensity: 0.45, layer: 2, flicker: true });
    }
}
/** 村：家々・風車・灯籠・小道。主役なのでぼかさない */
function village(b, lights) {
    const ground = (x) => Math.round(206 + 4 * noise1(x / 40, 41));
    for (let x = 0; x < DIORAMA_W; x++) {
        const g = ground(x);
        vline(b, x, g, DIORAMA_H - g, ci('moss', 1));
        b.set(x, g, ci('moss', 2));
    }
    // 小道（手前から村の真ん中へ）
    for (let y = 214; y < DIORAMA_H; y++) {
        const t = (y - 214) / (DIORAMA_H - 214);
        const cx = Math.round(236 - t * 30);
        const half = Math.round(4 + t * 18);
        hline(b, cx - half, y, half * 2, ci('earth', 1));
        if (hash2(cx, y, 43) % 3 === 0)
            b.set(cx - half + 2, y, ci('earth', 2));
    }
    house(b, 36, ground(56), 42, lights, 1);
    house(b, 128, ground(146), 34, lights, 2);
    house(b, 268, ground(290), 46, lights, 3);
    const hub = windmillBody(b, 392, ground(392), lights);
    lantern(b, 214, ground(214), lights);
    lantern(b, 262, ground(262) + 2, lights);
    return hub;
}
/** 手前：草むらと柵の影（ぼかす層） */
function near(b) {
    const top = (x) => Math.round(226 + 8 * noise1(x / 30, 61));
    for (let x = 0; x < DIORAMA_W; x++) {
        const t = top(x);
        if (x > 190 && x < 260)
            continue; // 道の上は空ける
        vline(b, x, t, DIORAMA_H - t, ci('ink', 0));
        if (hash2(x, 0, 62) % 3 === 0) {
            const h = 3 + (hash2(x, 1, 62) % 6);
            vline(b, x, t - h, h, ci('moss', 0));
        }
    }
    for (let x = 12; x < 180; x += 22) {
        vline(b, x, 214, 26, ci('ink', 0));
        vline(b, x + 1, 214, 26, ci('ink', 1));
    }
    hline(b, 10, 220, 172, ci('ink', 1));
    hline(b, 10, 228, 172, ci('ink', 0));
}
/** タイトルの背景を組み立てる（呼ぶたびに同じ絵） */
export function buildTitleDiorama() {
    const lights = [];
    const stars = [];
    const L = () => new PixBuf(DIORAMA_W, DIORAMA_H);
    const l0 = L();
    sky(l0, stars);
    const l1 = L();
    far(l1, lights);
    const l2 = L();
    mid(l2, lights);
    const l3 = L();
    const windmill = village(l3, lights);
    const l4 = L();
    near(l4);
    // 月の光
    lights.push({ x: 74, y: 44, radius: 70, color: '#cfd8ff', intensity: 0.35, layer: 0, flicker: false });
    return {
        sky: [[0, '#0d0b26'], [0.35, '#1a1850'], [0.62, '#15306a'], [0.8, '#2f4a6e']],
        layers: [
            { buf: l0, parallax: 0.1, blur: 0 },
            { buf: l1, parallax: 0.25, blur: 1 },
            { buf: l2, parallax: 0.5, blur: 1 },
            { buf: l3, parallax: 1, blur: 0 },
            { buf: l4, parallax: 1.6, blur: 2 },
        ],
        lights,
        stars,
        windmill,
        ambient: [LEAVES, FIREFLIES],
        vignette: 0.6,
    };
}
//# sourceMappingURL=title.js.map