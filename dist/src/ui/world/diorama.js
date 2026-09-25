/**
 * ジオラマ（タイトル・村・結果の背景）を描く。
 *
 * 層（art/scenes/*.ts が作る PixBuf）を奥から順に、視差をつけて 3 倍で画面へ貼る。
 * ぼかす層は縮めた紙をなめらかに拡大して貼る（ctx.filter を使わない＝どのブラウザでも同じ）。
 * その上に、灯りの光（加算）・星の瞬き・風車の羽根・カールノイズで舞う粒・周辺減光を重ねる。
 *
 * 位置の揺らぎと瞬きは時刻と座標のハッシュだけで決める。ゲームの乱数は使わない。
 */
import { PixBuf } from '../art/pixbuf.js';
import { hashFloat } from '../art/hash.js';
import { WINDMILL_FRAMES, WINDMILL_SIZE, buildWindmillBlades, } from '../art/scenes/common.js';
import { Rng } from '../../core/rng.js';
import { CURL_GRID_DIORAMA, CurlField } from '../gfx-core/curl.js';
import { ParticlePool } from '../gfx-core/particles.js';
import { drawHDParticles, drawPixelParticles, makeHDAtlas, } from '../gfx/particlesDraw.js';
import { ctx2d, makeCanvas, pixBufToCanvas } from '../gfx/canvas.js';
import { ART_H, ART_SCALE, ART_W, CROP_X, CROP_Y } from '../gfx/view.js';
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
        if (d.windmill) {
            const b = new PixBuf(WINDMILL_SIZE, WINDMILL_SIZE);
            for (let f = 0; f < WINDMILL_FRAMES; f++) {
                buildWindmillBlades(f, b);
                this.blades.push(pixBufToCanvas(b));
            }
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
            // 画面の上の方から生まれて、渦に巻かれながら流れる
            out[0] = r.float() * 440;
            out[1] = 20 + r.float() * 140;
            return true;
        };
        for (const a of d.ambient)
            this.pool.addAmbient(a, spawn);
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
        if (this.d.rain > 0)
            this.drawRain(g, now);
        // 周辺減光
        g.drawImage(this.vignetteCanvas(), 0, 0);
        g.restore();
    }
    /**
     * 雨。画面の座標で細い斜めの線を落とす（ドットではなく HD の層）。
     * 粒の位置は番号のハッシュと時刻だけで決まるので、置き場も乱数も要らない
     */
    drawRain(g, now) {
        const n = Math.round(160 * this.d.rain);
        g.fillStyle = 'rgba(8,12,22,0.22)';
        g.fillRect(0, 0, 1280, 720);
        g.strokeStyle = '#a8bcdc';
        g.lineWidth = 1;
        g.beginPath();
        for (let i = 0; i < n; i++) {
            const speed = 0.9 + hashFloat(i, 1, 77) * 0.6;
            const len = 14 + hashFloat(i, 2, 77) * 18;
            const y = (hashFloat(i, 3, 77) * 900 + now * speed) % 900 - 90;
            const x = ((hashFloat(i, 4, 77) * 1500 - y * 0.18) % 1500 + 1500) % 1500 - 110;
            g.moveTo(x, y);
            g.lineTo(x - len * 0.18, y + len);
        }
        g.globalAlpha = 0.32;
        g.stroke();
        // 地面のはね（短い横線が一瞬だけ出る）
        g.fillStyle = '#c4d4ee';
        for (let i = 0; i < 26; i++) {
            const phase = (now / 420 + hashFloat(i, 5, 77)) % 1;
            if (phase > 0.25)
                continue;
            g.globalAlpha = 0.5 * (1 - phase * 4);
            const x = hashFloat(i, 6, 77) * 1280;
            const y = 612 + hashFloat(i, 7, 77) * 100;
            g.fillRect(x - 3, y, 7, 1);
            g.fillRect(x - 1, y - 2, 1, 2);
            g.fillRect(x + 2, y - 1, 1, 1);
        }
        g.globalAlpha = 1;
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
        const hub = this.d.windmill;
        if (!hub)
            return;
        const f = Math.floor(now / 220) % WINDMILL_FRAMES;
        const c = this.blades[f];
        const half = (WINDMILL_SIZE - 1) / 2;
        g.imageSmoothingEnabled = false;
        g.drawImage(c, (hub.x - half - ox) * ART_SCALE - CROP_X, (hub.y - half) * ART_SCALE - CROP_Y, WINDMILL_SIZE * ART_SCALE, WINDMILL_SIZE * ART_SCALE);
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
        grad.addColorStop(1, `rgba(5,6,16,${this.d.vignette.toFixed(2)})`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 1280, 720);
        this.vignette = c;
        return c;
    }
}
//# sourceMappingURL=diorama.js.map