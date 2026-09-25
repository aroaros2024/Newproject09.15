/**
 * 表示専用のなめらかなノイズ。粒子の流れ場（curl.ts）と明滅に使う。
 *
 * - perlin3：Ken Perlin の改良版（2002）。格子点で 0、値はおおよそ -1〜1
 * - valueNoise1：1 次元の値ノイズ。0〜1。蛍・火の粉の明滅の揺らぎ用
 *
 * 並べ替え表は起動時に 1 回だけ、ここだけの乱数（種は固定）で作る。
 * ゲームの乱数（world.rng）は使わない。使うと画面を描いただけで冒険の結果が変わる。
 * 同じ引数からは必ず同じ値が出るので、撮り直しても同じ流れになる。
 *
 * DOM に触れないので、node のテストからそのまま呼べる。
 */
import { Rng } from '../../core/rng.js';
import { hash2 } from '../art/hash.js';
/** 0〜255 の並べ替えを 2 周ぶん（添字の & 255 を省くため） */
const PERM = (() => {
    // ゲームの乱数とは別の実体。種を変えると流れの模様が全部変わる
    const rng = new Rng(0x5eedf00d);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++)
        p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = p[i];
        p[i] = p[j];
        p[j] = t;
    }
    const out = new Uint8Array(512);
    for (let i = 0; i < 512; i++)
        out[i] = p[i & 255];
    return out;
})();
/** 6t^5 - 15t^4 + 10t^3。2 階微分まで連続なので、勾配を取っても折れ目が出ない */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
/** 立方体の 12 本の辺の向きから 1 つ選び、位置との内積を返す */
function grad(h, x, y, z) {
    const k = h & 15;
    const u = k < 8 ? x : y;
    const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
    return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}
/**
 * 3 次元の改良パーリンノイズ。格子の間隔は 1。
 * 割り当ては無い（粒子の毎刻みの計算から呼んでよい）。
 */
export function perlin3(x, y, z) {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const X = fx & 255;
    const Y = fy & 255;
    const Z = fz & 255;
    x -= fx;
    y -= fy;
    z -= fz;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const p = PERM;
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    const x1 = x - 1;
    const y1 = y - 1;
    const z1 = z - 1;
    // 立方体の 8 つの角の寄与（添字は x・y・z の順に 0 = 手前、1 = 奥）
    const g000 = grad(p[AA], x, y, z);
    const g100 = grad(p[BA], x1, y, z);
    const g010 = grad(p[AB], x, y1, z);
    const g110 = grad(p[BB], x1, y1, z);
    const g001 = grad(p[AA + 1], x, y, z1);
    const g101 = grad(p[BA + 1], x1, y, z1);
    const g011 = grad(p[AB + 1], x, y1, z1);
    const g111 = grad(p[BB + 1], x1, y1, z1);
    const l00 = g000 + u * (g100 - g000);
    const l10 = g010 + u * (g110 - g010);
    const l01 = g001 + u * (g101 - g001);
    const l11 = g011 + u * (g111 - g011);
    const m0 = l00 + v * (l10 - l00);
    const m1 = l01 + v * (l11 - l01);
    return m0 + w * (m1 - m0);
}
/**
 * 1 次元の値ノイズ（0 以上 1 未満）。整数ごとの値をなめらかにつなぐ。
 * seed を変えると別の揺らぎになる（粒ごとに位相をずらす）。
 */
export function valueNoise1(t, seed = 0) {
    const i = Math.floor(t);
    const f = t - i;
    const a = hash2(i, 0x51ed, seed) / 4294967296;
    const b = hash2(i + 1, 0x51ed, seed) / 4294967296;
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
}
//# sourceMappingURL=noise.js.map