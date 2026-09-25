/**
 * ジオラマ（タイトル・村・結果の背景）の共通の部品。DOM 無し。
 *
 * 層の形・光・星の決まりと、家・灯籠・塔・風車など複数の場面で使う建物をここに置く。
 * 明るさの違い（夜・夕暮れ）は Mood の lift（壁と屋根の段を何段上げるか）で出す。
 * 形の揺らぎは座標のハッシュだけで決める（毎回同じ絵）。
 */
import { ci } from '../palette.js';
import { disc, ellipse, hline, line, rect, vline } from '../pixbuf.js';
import { hash2, hashFloat } from '../hash.js';
export const DIORAMA_W = 460;
export const DIORAMA_H = 240;
export const NIGHT = { lift: 0, windowGlow: 0.7 };
export const DUSK = { lift: 1, windowGlow: 0.45 };
/** なめらかな 1 次元のノイズ（0〜1）。格子の値をハッシュで決め、間をなめらかにつなぐ */
export function noise1(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    const a = hashFloat(i, 0, seed);
    const b = hashFloat(i + 1, 0, seed);
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
}
/** 稜線（山並み・丘）。下を塗りつぶし、左を向いた斜面の縁だけ明るくする */
export function ridge(b, heightAt, base, rim) {
    let prev = heightAt(-1);
    for (let x = 0; x < b.w; x++) {
        const h = heightAt(x);
        vline(b, x, h, b.h - h, base);
        if (prev >= h)
            b.set(x, h, rim);
        prev = h;
    }
}
/**
 * 天輪の塔。tx は中心、top は胴の上端、foot は足元。頂に金の輪（光る）。
 * lift で胴の明るさを上げる（夕暮れは西日で明るい）。
 */
export function tower(b, tx, top, foot, lights, layer, mood, width = 1) {
    const body = ci('steel', 1 + mood.lift);
    const lit = ci('steel', 2 + mood.lift);
    const shade = ci('ink', 1 + mood.lift);
    for (let y = top; y < foot; y++) {
        const t = (y - top) / (foot - top);
        const half = Math.round((3 + t * 6) * width);
        hline(b, tx - half, y, half * 2 + 1, body);
        b.set(tx - half, y, lit);
        b.set(tx - half + 1, y, lit);
        b.set(tx + half, y, shade);
        if ((y - top) % 14 === 0)
            hline(b, tx - half - 1, y, half * 2 + 3, lit);
    }
    for (let y = top + 7; y < foot - 6; y += 14) {
        const on = hash2(tx, y, 51) % 3 !== 0;
        b.set(tx, y, on ? ci('gold', 5) : ci('ink', 0));
        b.set(tx, y + 1, on ? ci('ember', 4) : ci('ink', 0));
        if (on)
            lights.push({ x: tx, y, radius: 10, color: '#ffcf7a', intensity: 0.5 * mood.windowGlow / 0.7, layer, flicker: true });
    }
    vline(b, tx, top - 14, 14, lit);
    b.set(tx, top - 15, ci('gold', 5));
    const rx = Math.round(13 * width);
    ellipse(b, tx, top - 8, rx, 4, ci('gold', 4), false);
    ellipse(b, tx, top - 8, rx - 1, 3, ci('gold', 5), false);
    for (let x = tx - 1; x <= tx + 1; x++)
        b.set(x, top - 11, lit);
    lights.push({ x: tx, y: top - 8, radius: 38, color: '#ffe3a0', intensity: 0.8, layer, flicker: false });
}
/** 家 1 軒（切妻の茅葺き屋根・土壁・灯る窓） */
export function house(b, x, ground, w, lights, seed, mood = NIGHT) {
    const wallH = 16;
    const roofH = Math.round(w * 0.45);
    // 壁
    rect(b, x, ground - wallH, w, wallH, ci('earth', 1 + mood.lift));
    vline(b, x, ground - wallH, wallH, ci('earth', 2 + mood.lift));
    hline(b, x, ground - 1, w, ci('earth', 0));
    // 柱
    for (let px = x + 5; px < x + w - 2; px += 9)
        vline(b, px, ground - wallH, wallH, ci('earth', 0));
    // 窓（灯る）
    const wx = x + Math.floor(w / 2) - 3;
    const wy = ground - wallH + 5;
    rect(b, wx, wy, 6, 5, ci('ember', 4));
    rect(b, wx + 1, wy + 1, 4, 3, ci('gold', 5));
    vline(b, wx + 3, wy, 5, ci('earth', 0));
    lights.push({ x: wx + 3, y: wy + 2, radius: 22, color: '#ffbf5e', intensity: mood.windowGlow, layer: 3, flicker: true });
    // 戸
    if (w > 34)
        rect(b, x + w - 11, ground - 11, 6, 10, ci('earth', 0));
    // 屋根（左が月明かりで明るく、右は暗い。軒が壁より張り出す）
    const peak = x + Math.floor(w / 2);
    for (let r = 0; r < roofH; r++) {
        const y = ground - wallH - roofH + r;
        const half = Math.round(((r + 1) / roofH) * (w / 2 + 4));
        for (let xx = peak - half; xx <= peak + half; xx++) {
            const left = xx < peak;
            const n = hash2(xx, y, seed) % 5;
            const c = left ? ci('gold', (n === 0 ? 2 : 1) + mood.lift) : ci('earth', (n === 0 ? 2 : 1) + mood.lift);
            b.set(xx, y, c);
        }
        b.set(peak - half, y, ci('gold', 2 + mood.lift));
    }
    // 茅の筋
    for (let r = 2; r < roofH; r += 3)
        hline(b, peak - Math.round(((r + 1) / roofH) * (w / 2 + 4)) + 1, ground - wallH - roofH + r, 3, ci('gold', 2 + mood.lift));
    // 棟
    hline(b, peak - 3, ground - wallH - roofH - 1, 7, ci('earth', 0));
}
/** 灯籠 */
export function lantern(b, x, ground, lights, glow = 0.85) {
    vline(b, x, ground - 12, 12, ci('stone', 1));
    rect(b, x - 2, ground - 17, 5, 5, ci('ember', 4));
    rect(b, x - 1, ground - 16, 3, 3, ci('gold', 5));
    hline(b, x - 3, ground - 18, 7, ci('stone', 2));
    b.set(x, ground - 19, ci('stone', 2));
    hline(b, x - 2, ground - 1, 5, ci('stone', 1));
    lights.push({ x, y: ground - 15, radius: 30, color: '#ffb659', intensity: glow, layer: 3, flicker: true });
}
/** 風車の胴（石積み・赤いとんがり屋根）。羽根の軸の位置を返す（羽根は buildWindmillBlades） */
export function windmillBody(b, wx, wg, lights, mood = NIGHT) {
    for (let y = wg - 44; y < wg; y++) {
        const t = (y - (wg - 44)) / 44;
        const half = Math.round(6 + t * 4);
        hline(b, wx - half, y, half * 2 + 1, ci('stone', 2 + mood.lift));
        b.set(wx - half, y, ci('stone', 3 + mood.lift));
        b.set(wx + half, y, ci('stone', 1 + mood.lift));
        if (y % 5 === 0)
            hline(b, wx - half + 1, y, half * 2 - 1, ci('stone', 1 + mood.lift));
    }
    for (let r = 0; r < 10; r++)
        hline(b, wx - r, wg - 54 + r, r * 2 + 1, ci('crimson', (r < 5 ? 2 : 1) + mood.lift));
    rect(b, wx - 2, wg - 30, 4, 5, ci('gold', 5));
    lights.push({ x: wx, y: wg - 28, radius: 18, color: '#ffc46a', intensity: 0.55 * mood.windowGlow / 0.7, layer: 3, flicker: true });
    rect(b, wx - 2, wg - 10, 5, 10, ci('earth', 0));
    return { x: wx, y: wg - 47 };
}
/** 木立（丸い冠を重ねる）。左上の縁を少し明るく */
export function trees(b, count, seed, groundAt, body, rim, skip) {
    for (let i = 0; i < count; i++) {
        const x = Math.floor(hashFloat(i, 0, seed) * b.w);
        if (skip?.(x))
            continue;
        const r = 5 + (hash2(i, 1, seed) % 6);
        const y = groundAt(x) - r + 3;
        disc(b, x, y, r, body);
        for (let a = 0; a < 12; a++) {
            const ang = Math.PI + (a / 12) * (Math.PI / 2);
            b.set(Math.round(x + Math.cos(ang) * r), Math.round(y + Math.sin(ang) * r), rim);
        }
    }
}
export const WINDMILL_SIZE = 49;
export const WINDMILL_FRAMES = 4;
/**
 * 風車の羽根（49×49、軸が中心）。4 枚の羽根が 4 コマで 90° 回る（羽根が 90° ごとに同じ形なので、
 * 22.5° 刻みの 4 コマで途切れず回り続ける）。
 */
export function buildWindmillBlades(frame, out) {
    out.clear();
    const c = 24;
    const base = (frame & 3) * (Math.PI / 8);
    for (let k = 0; k < 4; k++) {
        const a = base + (k * Math.PI) / 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const ex = Math.round(c + dx * 22);
        const ey = Math.round(c + dy * 22);
        line(out, c, c, ex, ey, ci('earth', 1));
        // 帆（羽根の片側に張った布）
        for (let s = 6; s <= 21; s++) {
            for (let w = 1; w <= 4; w++) {
                const x = Math.round(c + dx * s - dy * w);
                const y = Math.round(c + dy * s + dx * w);
                out.set(x, y, w === 4 || s === 21 ? ci('bone', 2) : ci('bone', 3));
            }
        }
    }
    disc(out, c, c, 2, ci('earth', 0));
    out.set(c - 1, c - 1, ci('earth', 2));
}
//# sourceMappingURL=common.js.map