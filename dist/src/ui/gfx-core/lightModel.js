/**
 * 光の計算（DOM に触れない部分）。
 *
 * 描画エンジン（gfx/lighting.ts）は光を小さな紙に描いて画面へ掛け合わせるが、
 * キャラは 1 体ずつ「足元の明るさ」で色を付けるので、同じ光を CPU でも求める必要がある。
 * 両方が同じ式を使うよう、ここに置く：
 *
 *   明るさ = 地の明るさ[マスの状態] + 光を通す量[マスの状態] × Σ 光の色 × 強さ × 減衰(距離)
 *
 * - 地の明るさと光を通す量はマスの状態（下の 4 つ）で決まる（計画の表のとおり）
 * - 減衰は (1 - (d/r)²)²。光の絵（lighting.ts が焼く放射状の絵）もこの式で焼く
 * - 松明の揺らぎは値ノイズ（毎秒 8〜12 回・±10%）。描画用の値なのでゲームの乱数は使わない
 *   （格子点の値は座標の整数ハッシュ。art/hash.ts の hash2 と同じ混ぜ方を 24 ビットで使う）
 *
 * 座標は「世界の画用紙のドット」。マス (tx, ty) は x = 16tx 〜 16tx+16 を占める。
 */
/** 同時に置ける光の数 */
export const LIGHT_CAP = 16;
/** 1 マスのドット数（view.ts の TILE_ART と同じ。DOM 無しで読めるようにここにも置く） */
const TILE = 16;
// ---------------------------------------------------------------------------
// マスの状態
// ---------------------------------------------------------------------------
/** 未探索（真っ黒。光も通さない） */
export const TILE_UNEXPLORED = 0;
/** 探索済みで今は見えていない（記憶の冷たい暗色） */
export const TILE_EXPLORED = 1;
/** 見えている通路・暗い部屋 */
export const TILE_VISIBLE_DARK = 2;
/** 見えている明るい部屋 */
export const TILE_VISIBLE_LIT = 3;
/** 状態の数 */
export const TILE_STATES = 4;
/** 探索済みの地の明るさ（記憶の色に掛ける） */
export const EXPLORED_LEVEL = 0.30;
/** 探索済みのマスが光を通す量 */
export const EXPLORED_GATE = 0.35;
/** 見えているマスの明るさの下限（これより暗いと敵や道具が読めない） */
export const MIN_VISIBLE_LEVEL = 0.45;
// ---------------------------------------------------------------------------
// 減衰と揺らぎ
// ---------------------------------------------------------------------------
/**
 * 距離 d・半径 r の減衰。中心で 1、半径で 0、その間はなめらかに下がる。
 * (1 - (d/r)²)² は半径の所で傾きも 0 になるので、光の縁に輪が出ない。
 */
export function falloff(d, r) {
    if (r <= 0 || d >= r)
        return 0;
    const q = 1 - (d * d) / (r * r);
    return q * q;
}
/** 揺らぎの幅（±10%） */
export const FLICKER_AMP = 0.1;
/**
 * 24 ビットの整数ハッシュ（0〜0xffffff）。hash2 と同じ混ぜ方だが、結果を 24 ビットに切る。
 * 毎フレーム光ごとに呼ぶので、V8 が小さな整数のまま扱える範囲に収めて、数の箱を作らせない
 * （32 ビットの符号なし整数は小さな整数の範囲を超え、関数から返すたびに箱が要る）
 */
function hash24(x, y) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ 0x51ed27;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) & 0xffffff;
}
/** 1 次元の値ノイズ（0〜1）。格子点の値は整数のハッシュ */
function valueNoise(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash24(i, seed) / 16777216;
    const b = hash24(i + 1, seed) / 16777216;
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
}
/**
 * 揺らぎの倍率（0.9〜1.1）。seed が 0 の光は揺らがない（ランタン・溶岩・魔法）。
 * 速さは光ごとに毎秒 8〜12 回（seed のハッシュで決める）。並んだ松明が揃って揺れないため。
 */
export function flicker(seed, timeSec) {
    const s = seed | 0;
    if (s === 0)
        return 1;
    const hz = 8 + 4 * (hash24(s, 0x3c1) / 16777216);
    return 1 + FLICKER_AMP * (2 * valueNoise(timeSec * hz, s) - 1);
}
/** マス座標から揺らぎの種を作る（0 にならない、Float32 で正確に持てる 24 ビット） */
export const flickerSeed = (tx, ty, salt = 0) => hash24(tx, Math.imul(ty | 0, 0x9e3779b1) ^ (0x70c4 + salt)) | 1;
// ---------------------------------------------------------------------------
// 光の一覧
// ---------------------------------------------------------------------------
/**
 * 光の一覧。型付き配列を最初に確保して使い回す（毎フレームの割り当てを出さない）。
 * 満杯のときに足すと、いちばん弱い光（強さ × 半径）と入れ替える。
 * 主人公のランタンのような大きな光が、小さな火花に追い出されないため。
 */
export class LightList {
    cap = LIGHT_CAP;
    count = 0;
    /** 中心（世界のドット） */
    x = new Float32Array(LIGHT_CAP);
    y = new Float32Array(LIGHT_CAP);
    /** 半径（ドット） */
    radius = new Float32Array(LIGHT_CAP);
    /** 色（0〜1） */
    r = new Float32Array(LIGHT_CAP);
    g = new Float32Array(LIGHT_CAP);
    b = new Float32Array(LIGHT_CAP);
    /** 強さ（0〜1。1 を超えた分は描いても出ないので切り詰める） */
    intensity = new Float32Array(LIGHT_CAP);
    /** 揺らぎの種（0 = 揺らがない） */
    seed = new Float32Array(LIGHT_CAP);
    /** prepare() が書く：揺らぎを掛けたその瞬間の強さ（0〜1） */
    strength = new Float32Array(LIGHT_CAP);
    clear() {
        this.count = 0;
    }
    /** 光を足す。入った位置を返す（弱すぎて入らなければ -1） */
    add(x, y, radius, r, g, b, intensity, seed = 0) {
        if (!(radius > 0) || !(intensity > 0))
            return -1;
        const inten = intensity > 1 ? 1 : intensity;
        let i = this.count;
        if (i >= LIGHT_CAP) {
            let weakest = -1;
            let weakestV = inten * radius;
            for (let k = 0; k < LIGHT_CAP; k++) {
                const v = this.intensity[k] * this.radius[k];
                if (v < weakestV) {
                    weakestV = v;
                    weakest = k;
                }
            }
            if (weakest < 0)
                return -1;
            i = weakest;
        }
        else {
            this.count++;
        }
        this.x[i] = x;
        this.y[i] = y;
        this.radius[i] = radius;
        this.r[i] = clamp01(r);
        this.g[i] = clamp01(g);
        this.b[i] = clamp01(b);
        this.intensity[i] = inten;
        this.seed[i] = seed;
        this.strength[i] = inten;
        return i;
    }
    /** 色を 0xRRGGBB の数で渡す版（文字列を毎フレーム解かないため） */
    addRgb(x, y, radius, rgb, intensity, seed = 0) {
        return this.add(x, y, radius, ((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, intensity, seed);
    }
    /** その瞬間の強さ（揺らぎ込み）を求める。描く前に 1 回だけ呼ぶ */
    prepare(timeSec) {
        for (let i = 0; i < this.count; i++) {
            const s = this.intensity[i] * flicker(this.seed[i], timeSec);
            this.strength[i] = s > 1 ? 1 : s < 0 ? 0 : s;
        }
    }
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function makeLevels() {
    return { base: new Float32Array(TILE_STATES * 3), gate: new Float32Array(TILE_STATES) };
}
/** '#rrggbb' → 0xRRGGBB。読めなければ灰色 */
export function parseHex(hex) {
    let h = hex.trim();
    if (h.startsWith('#'))
        h = h.slice(1);
    if (h.length === 3)
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 && h.length !== 8)
        return 0x808080;
    const n = parseInt(h.slice(0, 6), 16);
    return Number.isNaN(n) ? 0x808080 : n;
}
/**
 * テーマの空気から状態ごとの表を作る。
 *
 * | 状態 | 地の明るさ | 光を通す量 |
 * | 未探索 | 0 | 0 |
 * | 探索済み・見えない | 記憶の色 × 0.30 | 0.35 |
 * | 見えている通路・暗い部屋 | 環境光 × darkLevel（0.45 未満にしない） | 1 |
 * | 見えている明るい部屋 | 環境光 × litLevel | 1 |
 */
export function levelsFromLook(look, out = makeLevels()) {
    const amb = parseHex(look.ambient);
    const mem = parseHex(look.memoryColor);
    const dark = Math.max(MIN_VISIBLE_LEVEL, Math.min(1, look.darkLevel));
    const lit = Math.max(dark, Math.min(1, look.litLevel));
    const put = (state, rgb, k, gate) => {
        out.base[state * 3] = (((rgb >> 16) & 255) / 255) * k;
        out.base[state * 3 + 1] = (((rgb >> 8) & 255) / 255) * k;
        out.base[state * 3 + 2] = ((rgb & 255) / 255) * k;
        out.gate[state] = gate;
    };
    put(TILE_UNEXPLORED, 0, 0, 0);
    put(TILE_EXPLORED, mem, EXPLORED_LEVEL, EXPLORED_GATE);
    put(TILE_VISIBLE_DARK, amb, dark, 1);
    put(TILE_VISIBLE_LIT, amb, lit, 1);
    return out;
}
/**
 * 1 マス 1 画素の紙に描く中身を作る（ImageData 用の 32bit 値、リトルエンディアンの ABGR）。
 *   base  … 地の色（不透明）
 *   mask  … 光を通す量の灰色（不透明。光の紙に乗算する）
 *   unexp … 未探索なら不透明な黒、それ以外は透明（地形の紙を真っ黒に塗る）
 */
export function fillTileImages(states, count, levels, base, mask, unexp) {
    // 状態ごとの値を先に 4 つ作っておく
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, m0 = 0, m1 = 0, m2 = 0, m3 = 0;
    for (let s = 0; s < TILE_STATES; s++) {
        const r = Math.round(clamp01(levels.base[s * 3]) * 255);
        const g = Math.round(clamp01(levels.base[s * 3 + 1]) * 255);
        const b = Math.round(clamp01(levels.base[s * 3 + 2]) * 255);
        const bv = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
        const m = Math.round(clamp01(levels.gate[s]) * 255);
        const mv = ((255 << 24) | (m << 16) | (m << 8) | m) >>> 0;
        if (s === 0) {
            b0 = bv;
            m0 = mv;
        }
        else if (s === 1) {
            b1 = bv;
            m1 = mv;
        }
        else if (s === 2) {
            b2 = bv;
            m2 = mv;
        }
        else {
            b3 = bv;
            m3 = mv;
        }
    }
    const black = (255 << 24) >>> 0;
    for (let i = 0; i < count; i++) {
        const s = states[i];
        if (s === TILE_UNEXPLORED || s >= TILE_STATES) {
            base[i] = b0;
            mask[i] = m0;
            unexp[i] = black;
        }
        else {
            base[i] = s === 1 ? b1 : s === 2 ? b2 : b3;
            mask[i] = s === 1 ? m1 : s === 2 ? m2 : m3;
            unexp[i] = 0;
        }
    }
}
/**
 * 放射状の光の絵（size × size、RGBA 8bit）を焼く。
 * 色はそのままで、透明度に減衰を入れる。加算（'lighter'）で重ねると 色 × 減衰 × 強さ が足される。
 * 画素の中心で距離を測るので、sampleLight と同じ値になる。
 */
export function bakeLightSprite(out, size, r, g, b) {
    const half = size / 2;
    const R = Math.round(clamp01(r) * 255);
    const G = Math.round(clamp01(g) * 255);
    const B = Math.round(clamp01(b) * 255);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x + 0.5 - half;
            const dy = y + 0.5 - half;
            const f = falloff(Math.sqrt(dx * dx + dy * dy), half);
            const i = (y * size + x) * 4;
            out[i] = R;
            out[i + 1] = G;
            out[i + 2] = B;
            out[i + 3] = Math.round(f * 255);
        }
    }
}
// ---------------------------------------------------------------------------
// 1 点の明るさ（キャラの足元）
// ---------------------------------------------------------------------------
/** 明るさを 16 段に丸める（色の文字列を 16³ 通りだけ用意すれば済むように） */
export const quantize16 = (v) => (v <= 0 ? 0 : v >= 1 ? 15 : Math.round(v * 15));
/** 丸めた 3 色を 1 つの番号（0〜4095）に */
export const quantIndex = (r, g, b) => (quantize16(r) << 8) | (quantize16(g) << 4) | quantize16(b);
/**
 * 階の光の場。マスの状態と光の一覧を持ち、任意の点の明るさを CPU で求める。
 * 描画エンジンの光の紙と同じ表・同じ減衰を使う。
 */
export class LightField {
    /** 地図の大きさ（マス） */
    w = 0;
    h = 0;
    /** マスの状態（y * w + x） */
    states = new Uint8Array(0);
    levels = makeLevels();
    lights = new LightList();
    /**
     * 地図の大きさを合わせる。状態は全部「未探索」に戻す。
     * 配列の長さはいつも w × h ちょうど（場面の writeTileStates にそのまま渡せるように）
     */
    resize(w, h) {
        const n = Math.max(0, w | 0) * Math.max(0, h | 0);
        if (n !== this.states.length)
            this.states = new Uint8Array(n);
        else
            this.states.fill(0);
        this.w = w | 0;
        this.h = h | 0;
    }
    /** 世界のドット座標のマスの状態（地図の外は未探索） */
    stateAt(ax, ay) {
        const tx = Math.floor(ax / TILE);
        const ty = Math.floor(ay / TILE);
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h)
            return TILE_UNEXPLORED;
        const s = this.states[ty * this.w + tx];
        return s < TILE_STATES ? s : TILE_UNEXPLORED;
    }
    /**
     * 点 (ax, ay) の明るさ。out[0..2] に r, g, b（0〜1、16 段に丸めた値）を書く。
     * マスの状態は足元のマスで決める（キャラが見えているマスの上なら、明るさの下限を割らない）。
     */
    sampleLight(ax, ay, out) {
        const s = this.stateAt(ax, ay);
        const lv = this.levels;
        let r = lv.base[s * 3];
        let g = lv.base[s * 3 + 1];
        let b = lv.base[s * 3 + 2];
        const gate = lv.gate[s];
        if (gate > 0) {
            const L = this.lights;
            let lr = 0, lg = 0, lb = 0;
            for (let i = 0; i < L.count; i++) {
                const dx = ax - L.x[i];
                const dy = ay - L.y[i];
                const f = falloff(Math.sqrt(dx * dx + dy * dy), L.radius[i]);
                if (f <= 0)
                    continue;
                const k = f * L.strength[i];
                lr += L.r[i] * k;
                lg += L.g[i] * k;
                lb += L.b[i] * k;
            }
            r += gate * lr;
            g += gate * lg;
            b += gate * lb;
        }
        out[0] = quantize16(r) / 15;
        out[1] = quantize16(g) / 15;
        out[2] = quantize16(b) / 15;
    }
    /**
     * いちばん強く当たっている光（リムライト用）。自分の真上の光（ランタンを持つ本人）は除く。
     * out = [強さ 0〜1, 光への向き x, y（長さ 1）, r, g, b]。当たっていなければ強さ 0。
     */
    sampleRim(ax, ay, out) {
        out[0] = 0;
        const s = this.stateAt(ax, ay);
        const gate = this.levels.gate[s];
        if (gate <= 0)
            return;
        const L = this.lights;
        let best = 0;
        for (let i = 0; i < L.count; i++) {
            const dx = L.x[i] - ax;
            const dy = L.y[i] - ay;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < RIM_MIN_DIST)
                continue;
            const lum = 0.3 * L.r[i] + 0.55 * L.g[i] + 0.15 * L.b[i];
            const k = falloff(d, L.radius[i]) * L.strength[i] * lum * gate;
            if (k <= best)
                continue;
            best = k;
            out[0] = k > 1 ? 1 : k;
            out[1] = dx / d;
            out[2] = dy / d;
            out[3] = L.r[i];
            out[4] = L.g[i];
            out[5] = L.b[i];
        }
    }
}
/**
 * これより近い光はリムを作らない。ランタンは持ち主の足元から 10 ドットほど上に置くので、
 * それを拾うと自分の頭の上に縁の光が出てしまう
 */
const RIM_MIN_DIST = 14;
//# sourceMappingURL=lightModel.js.map