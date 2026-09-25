/**
 * ジオラマ（タイトル・村・結果の背景）を描く。
 *
 * 層（art/scenes/*.ts が作る PixBuf）を奥から順に、視差をつけて 3 倍で画面へ貼る。
 * ぼかす層は縮めた紙をなめらかに拡大して貼る（ctx.filter を使わない＝どのブラウザでも同じ）。
 * その上に、灯りの光（加算）・星の瞬き・風車の羽根・カールノイズで舞う粒・周辺減光を重ねる。
 *
 * 位置の揺らぎと瞬きは時刻と座標のハッシュだけで決める。ゲームの乱数は使わない。
 */
import { RAMP_HEAL } from '../art/palette.js';
import { PixBuf } from '../art/pixbuf.js';
import { hashFloat } from '../art/hash.js';
import { WINDMILL_FRAMES, WINDMILL_SIZE, buildWindmillBlades } from '../art/scenes/title.js';
import { Rng } from '../../core/rng.js';
import { CURL_GRID_DIORAMA, CurlField } from '../gfx-core/curl.js';
import { ParticlePool } from '../gfx-core/particles.js';
import { drawHDParticles, drawPixelParticles, makeHDAtlas, } from '../gfx/particlesDraw.js';
import { ctx2d, makeCanvas, pixBufToCanvas } from '../gfx/canvas.js';
import { ART_H, ART_SCALE, ART_W, CROP_X, CROP_Y } from '../gfx/view.js';
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
const glowCache = new Map();
/** 柔らかい光の玉（加算で重ねる）。色ごとに 1 枚だけ焼く */
function glowSprite(color) {
    const hit = glowCache.get(color);
    if (hit)
        return hit;
    const c = makeCanvas(64, 64);
    const g = ctx2d(c);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, `${color}88`);
    grad.addColorStop(1, `${color}00`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
    return c;
}
export class DioramaView {
    d;
    layers = [];
    blades = [];
    field = new CurlField(CURL_GRID_DIORAMA);
    pool;
    atlas;
    particleArt = makeCanvas(ART_W, ART_H);
    pg = ctx2d(this.particleArt);
    vignette = null;
    skyCanvas = null;
    xf = { scale: ART_SCALE, offX: 0, offY: 0 };
    /** 画用紙の上でカメラがどれだけ横へずれているか（ドット） */
    camX = 0;
    constructor(d) {
        this.d = d;
        for (const l of d.layers) {
            const sharp = pixBufToCanvas(l.buf);
            let soft = null;
            const shrink = l.blur === 2 ? 4 : 2;
            if (l.blur > 0) {
                soft = makeCanvas(l.buf.w / shrink, l.buf.h / shrink);
                const sg = ctx2d(soft);
                sg.imageSmoothingEnabled = true;
                sg.imageSmoothingQuality = 'high';
                sg.drawImage(sharp, 0, 0, soft.width, soft.height);
            }
            this.layers.push({ sharp, soft, shrink, parallax: l.parallax, blur: l.blur });
        }
        const b = new PixBuf(WINDMILL_SIZE, WINDMILL_SIZE);
        for (let f = 0; f < WINDMILL_FRAMES; f++) {
            buildWindmillBlades(f, b);
            this.blades.push(pixBufToCanvas(b));
        }
        this.pool = new ParticlePool(512, new Rng('fx:diorama'));
        this.atlas = makeHDAtlas();
        const lanterns = d.lights.filter((l) => l.layer === 3 && l.radius >= 25);
        const spawn = (region, out, r) => {
            if (region === 'torch' && lanterns.length > 0) {
                const l = lanterns[r.int(lanterns.length)];
                out[0] = l.x + (r.float() - 0.5) * 30;
                out[1] = l.y + (r.float() - 0.5) * 20;
                return true;
            }
            // 葉は上の方から生まれて、渦に巻かれながら落ちる
            out[0] = r.float() * 440;
            out[1] = 20 + r.float() * 140;
            return true;
        };
        this.pool.addAmbient(LEAVES, spawn);
        this.pool.addAmbient(FIREFLIES, spawn);
        this.pool.prewarm(this.field, 6);
    }
    /** 60Hz の刻み */
    tick(stepSeconds) {
        this.field.tick();
        this.pool.step(stepSeconds, this.field, 6);
    }
    /** 層の横のずれ（画用紙のドット、整数） */
    offsetOf(parallax) {
        return Math.round(this.camX * parallax);
    }
    draw(g, now) {
        const W = ART_W * ART_SCALE;
        const H = ART_H * ART_SCALE;
        g.save();
        g.drawImage(this.skyGradient(), 0, 0);
        // 層
        this.layers.forEach((l, i) => {
            const ox = Math.min(l.sharp.width - ART_W, this.offsetOf(l.parallax));
            if (l.soft) {
                g.imageSmoothingEnabled = true;
                g.drawImage(l.soft, ox / l.shrink, 0, ART_W / l.shrink, ART_H / l.shrink, -CROP_X, -CROP_Y, W, H);
            }
            else {
                g.imageSmoothingEnabled = false;
                g.drawImage(l.sharp, ox, 0, ART_W, ART_H, -CROP_X, -CROP_Y, W, H);
            }
            if (i === 0)
                this.drawStars(g, now, ox);
            if (i === 3)
                this.drawBlades(g, now, ox);
        });
        // 灯りの光（加算）
        g.globalCompositeOperation = 'lighter';
        g.imageSmoothingEnabled = true;
        for (const l of this.d.lights) {
            const ox = this.offsetOf(this.d.layers[l.layer].parallax);
            const flick = l.flicker ? 0.88 + 0.12 * Math.sin(now / 90 + hashFloat(l.x, l.y, 5) * 40) : 1;
            const r = l.radius * ART_SCALE * (0.96 + 0.04 * flick);
            g.globalAlpha = Math.min(1, l.intensity * flick * 0.55);
            g.drawImage(glowSprite(l.color), (l.x - ox) * ART_SCALE - CROP_X - r, l.y * ART_SCALE - CROP_Y - r, r * 2, r * 2);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        // 粒（ドットの葉は画用紙に 1 ドットで描いて 3 倍、蛍は HD の光）
        const ox3 = this.offsetOf(1);
        this.pg.clearRect(0, 0, ART_W, ART_H);
        drawPixelParticles(this.pg, this.pool, ox3, 0);
        g.imageSmoothingEnabled = false;
        g.drawImage(this.particleArt, -CROP_X, -CROP_Y, W, H);
        this.xf.offX = -ox3 * ART_SCALE - CROP_X;
        this.xf.offY = -CROP_Y;
        drawHDParticles(g, this.pool, this.xf, this.atlas);
        // 周辺減光
        g.drawImage(this.vignetteCanvas(), 0, 0);
        g.restore();
    }
    drawStars(g, now, ox) {
        g.fillStyle = '#ffffff';
        for (const s of this.d.stars) {
            const tw = 0.5 + 0.5 * Math.sin(now / 700 + s.phase * 6.283);
            const x = (s.x - ox) * ART_SCALE - CROP_X;
            const y = s.y * ART_SCALE - CROP_Y;
            if (s.big) {
                // 明るい星は十字に光る
                g.globalAlpha = 0.35 + 0.5 * tw;
                g.fillRect(x - 3, y + 1, 9, 1);
                g.fillRect(x + 1, y - 3, 1, 9);
            }
            else if (tw > 0.8) {
                g.globalAlpha = (tw - 0.8) * 3;
                g.fillRect(x, y, 3, 3);
            }
        }
        g.globalAlpha = 1;
    }
    drawBlades(g, now, ox) {
        const f = Math.floor(now / 220) % WINDMILL_FRAMES;
        const c = this.blades[f];
        const half = (WINDMILL_SIZE - 1) / 2;
        g.imageSmoothingEnabled = false;
        g.drawImage(c, (this.d.windmill.x - half - ox) * ART_SCALE - CROP_X, (this.d.windmill.y - half) * ART_SCALE - CROP_Y, WINDMILL_SIZE * ART_SCALE, WINDMILL_SIZE * ART_SCALE);
    }
    /** 空（なめらかなグラデーション。縦 1 列を焼いて横へ伸ばす） */
    skyGradient() {
        if (this.skyCanvas)
            return this.skyCanvas;
        const c = makeCanvas(1280, 720);
        const g = ctx2d(c);
        const grad = g.createLinearGradient(0, 0, 0, 720);
        for (const [t, col] of this.d.sky)
            grad.addColorStop(t, col);
        g.fillStyle = grad;
        g.fillRect(0, 0, 1280, 720);
        this.skyCanvas = c;
        return c;
    }
    vignetteCanvas() {
        if (this.vignette)
            return this.vignette;
        const c = makeCanvas(1280, 720);
        const g = ctx2d(c);
        const grad = g.createRadialGradient(640, 330, 260, 640, 360, 820);
        grad.addColorStop(0, 'rgba(5,6,16,0)');
        grad.addColorStop(1, 'rgba(5,6,16,0.6)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 1280, 720);
        this.vignette = c;
        return c;
    }
}
//# sourceMappingURL=diorama.js.map