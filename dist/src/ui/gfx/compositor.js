/**
 * HD-2D の合成（1 フレームの描き方。計画 4 章）。
 *
 * 場面に画用紙（428×240 ドット）の 3 枚を描かせ、光・ぼかし・ブルームを重ねて画面へ出す。
 *
 *   画用紙の上（画面の外。1/9 の画素で済む所は全部ここでやる）
 *     A  地形 → 未探索マスを真っ黒に（ぼかしより前）→ 光を乗算・光だまりを加算 →（高）彩度を少し落とす
 *     A2 床の物 → 光を乗算（見えないマスでは暗い）      B キャラ（1 体ずつ足元の明るさで色付け済み）
 *     G  = 照らした A2 ＋ B（光の乗算より上にキャラが乗る）
 *     L / LA 光（214×120 か 107×60）→ La（画用紙の大きさへ滑らかに）
 *     E  光る物（320×180）→ 光を通す量を乗算 → 1/8・1/16 へ縮める（ブルーム）
 *     H  加算の紙（640×360）＝ ブルームの段 ＋ 光の筋
 *   画面へ
 *     A を拡大 → 被写界深度（照らした地形だけ。上下の帯）→ G を拡大
 *     → 霧 → HD の層（粒子・数字）→ H を加算 → 色味 → 周辺減光 → 暗転・フラッシュ
 *     （ぼかしを使わない時・整数でない倍率の時は、A に G を重ねて 1 枚にし、色味もその上で掛ける）
 *   このあと UI が論理座標（1280×720）のまま描く。
 *
 * なぜ光を画用紙の上で掛けるか：画面の大きさで「補間しながら乗算」すると、1 回 4ms ほど掛かる
 * （headless Chromium のソフトウェア描画で計測。最近傍の拡大は 0.5ms、補間は 3〜4ms）。
 * 光の勾配はもともと滑らかなので、1 ドットごとに掛けても 3×3 の段は見えない。
 * 画面の大きさで補間するのは、ぼかしの帯（画面の 1/4）と、半分の紙から 2 倍で貼る霧・加算・減光だけ。
 *
 * ドットの拡大：画面の 1 ドットが実画素の整数倍（3 × 実画素の高さ / 720）なら、最近傍でそのまま拡大する。
 * 整数でなければ、いったん k 倍（k = 2〜4）に最近傍で拡大した紙を作り、それを滑らかに縮めて貼る
 * （どのドットも同じ幅に見える。最近傍のままだと 1px ずつ幅がばらつき、動くと揺れて見える）。
 * この拡大は 1 回 8ms 近く掛かるので、そのときは A・ぼかし・G を画用紙の上で重ねてから 1 回だけ拡大する。
 *
 * 紙はすべて最初（と大きさ・画質が変わった時）に作る。毎フレームの割り当てはゼロ。
 * ctx.filter は使わない（Safari で効かない）。ぼかしは全部「縮めて拡大」。
 */
import { Surface, LightRenderer } from './lighting.js';
import { Bloom } from './bloom.js';
import { DepthOfField } from './dof.js';
import { PostFx } from './post.js';
import { PerfMeter } from './perf.js';
import { qualityPreset } from './quality.js';
import { ART_H, ART_SCALE, ART_W, CROP_X, CROP_Y } from './view.js';
import { SCREEN_H, SCREEN_W } from '../theme.js';
/** 画素密度の上限（それ以上は描く画素が増えるだけで見た目が変わらない） */
export const MAX_DPR = 2;
/**
 * 表示できる広さ（CSS px）と画素密度から、キャンバスの大きさを決める。
 *   ふつう：16:9 を保って収まる最大の大きさ。実画素は round(CSS × dpr)
 *   整数倍：実画素が 1280×720 のちょうど n 倍になる最大の n（ドットの幅が完全に揃う。余白が出る）
 */
export function computeBacking(availW, availH, dpr, pixelPerfect) {
    const d = Math.max(0.5, Math.min(MAX_DPR, Number.isFinite(dpr) && dpr > 0 ? dpr : 1));
    const aw = Math.max(1, availW);
    const ah = Math.max(1, availH);
    let cssW;
    let cssH;
    let backW;
    let backH;
    if (pixelPerfect) {
        const n = Math.max(1, Math.floor(Math.min((aw * d) / SCREEN_W, (ah * d) / SCREEN_H) + 1e-9));
        backW = SCREEN_W * n;
        backH = SCREEN_H * n;
        cssW = backW / d;
        cssH = backH / d;
    }
    else {
        const scale = Math.min(aw / SCREEN_W, ah / SCREEN_H);
        cssW = Math.max(1, Math.floor(SCREEN_W * scale));
        cssH = Math.max(1, Math.floor(SCREEN_H * scale));
        backW = Math.max(1, Math.round(cssW * d));
        backH = Math.max(1, Math.round(cssH * d));
    }
    return { cssW, cssH, backW, backH, dpr: d, ...pixelInfo(backW, backH) };
}
/** 実画素の大きさから、1 ドットの実画素と、それが整数かを出す */
export function pixelInfo(backW, backH) {
    const px = (ART_SCALE * backH) / SCREEN_H;
    const pxW = (ART_SCALE * backW) / SCREEN_W;
    const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-6 && Math.round(v) >= 1;
    return { artPx: px, integer: isInt(px) && isInt(pxW) };
}
/** 整数でない倍率のときに作る中間の紙の倍率（2〜4） */
export const sharpFactor = (artPx) => Math.max(2, Math.min(4, Math.floor(artPx + 1e-9)));
// ---------------------------------------------------------------------------
// 段の名前（計測用）
// ---------------------------------------------------------------------------
export const PASS_NAMES = [
    'prep', 'terrain', 'ground', 'actors', 'emissive', 'light', 'artLight', 'offHD',
    'blitA', 'dof', 'blitG', 'fog', 'hd', 'add', 'grade', 'overlay',
];
const P_PREP = 0;
const P_TERRAIN = 1;
const P_GROUND = 2;
const P_ACTORS = 3;
const P_EMISSIVE = 4;
const P_LIGHT = 5;
const P_ART_LIGHT = 6;
const P_OFF_HD = 7;
const P_BLIT_A = 8;
const P_DOF = 9;
const P_BLIT_G = 10;
const P_FOG = 11;
const P_HD = 12;
const P_ADD = 13;
const P_GRADE = 14;
const P_OVERLAY = 15;
// ---------------------------------------------------------------------------
export class Compositor {
    lighting = new LightRenderer();
    bloom = new Bloom();
    post = new PostFx();
    perf = new PerfMeter(PASS_NAMES);
    /** 被写界深度は使う画質になった時に作る */
    dof = null;
    /** 設定の「被写界深度」（画質が高でも、切っていれば描かない） */
    dofEnabled = true;
    /** 地形（照らした後は「照らした地形」） */
    A = new Surface(ART_W, ART_H, true, false);
    /** 床の物（場面が描く） */
    A2 = new Surface(ART_W, ART_H, false, false);
    /** キャラ（場面が lighter で描く） */
    B = new Surface(ART_W, ART_H, false, false);
    /** 照らした床の物 ＋ キャラ */
    G = new Surface(ART_W, ART_H, false, false);
    /** 整数でない倍率のときの中間の紙（k 倍） */
    up = null;
    upK = 0;
    /** 前のフレームの画面の実画素と、そこから決めた拡大のしかた */
    lastW = 0;
    lastH = 0;
    lastInteger = true;
    lastK = 2;
    q;
    look = null;
    size = null;
    frame;
    constructor(level = 2) {
        this.q = qualityPreset(level);
        this.frame = {
            now: 0, time: 0, quality: this.q, camX: 0, camY: 0, viewW: ART_W, viewH: ART_H,
        };
        this.applyQuality();
    }
    get quality() {
        return this.q;
    }
    /** 画質の段を変える（紙の作り直しはここでだけ起きる） */
    setQuality(level) {
        const q = qualityPreset(level);
        if (q === this.q)
            return;
        this.q = q;
        this.applyQuality();
    }
    applyQuality() {
        this.lighting.setDiv(this.q.lightDiv);
        if (this.q.dof && !this.dof)
            this.dof = new DepthOfField();
    }
    /**
     * キャンバスの大きさを決めて当てはめる（窓の大きさ・画素密度・整数倍の設定が変わった時）。
     * availW / availH は表示に使える広さ（CSS px）
     */
    resize(canvas, availW, availH, dpr, pixelPerfect) {
        const s = computeBacking(availW, availH, dpr, pixelPerfect);
        canvas.style.width = `${s.cssW}px`;
        canvas.style.height = `${s.cssH}px`;
        if (canvas.width !== s.backW)
            canvas.width = s.backW;
        if (canvas.height !== s.backH)
            canvas.height = s.backH;
        this.size = s;
        return s;
    }
    /** 最後に決めた大きさ */
    get backing() {
        return this.size;
    }
    /**
     * 世界を 1 フレーム描く。g は画面のキャンバスの 2D コンテキスト（向きは問わない）。
     * 描き終えると g は論理座標（1280×720）の向き・通常の合成・補間なしに戻る（続けて UI を描ける）
     */
    render(g, scene, now) {
        const perf = this.perf;
        perf.begin(now);
        const q = this.q;
        const f = this.frame;
        const camX = Math.floor(scene.camX) || 0;
        const camY = Math.floor(scene.camY) || 0;
        f.now = now;
        f.time = now / 1000;
        f.quality = q;
        f.camX = camX;
        f.camY = camY;
        // ---- 準備：テーマとマスの状態、光の一覧
        if (scene.look !== this.look) {
            this.look = scene.look;
            this.lighting.setLook(scene.look);
            this.post.setLook(scene.look);
        }
        const lighting = this.lighting;
        lighting.syncTiles(scene);
        const lights = lighting.field.lights;
        lights.clear();
        scene.collectLights(lights, f);
        lights.prepare(f.time);
        perf.mark(P_PREP);
        // ---- A 地形
        const a = this.A.g;
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.globalCompositeOperation = 'source-over';
        a.globalAlpha = 1;
        a.fillStyle = '#000';
        a.fillRect(0, 0, ART_W, ART_H);
        a.setTransform(1, 0, 0, 1, -camX, -camY);
        scene.paintTerrain(a, f);
        a.globalCompositeOperation = 'source-over';
        a.globalAlpha = 1;
        lighting.maskUnexplored(a);
        perf.mark(P_TERRAIN, a);
        // ---- A2 床の物
        const a2 = this.A2.g;
        a2.setTransform(1, 0, 0, 1, 0, 0);
        a2.clearRect(0, 0, ART_W, ART_H);
        a2.setTransform(1, 0, 0, 1, -camX, -camY);
        scene.paintGround(a2, f);
        a2.globalCompositeOperation = 'source-over';
        a2.globalAlpha = 1;
        perf.mark(P_GROUND, a2);
        // ---- B キャラ（1 体ずつ色付けして描かれる）
        const b = this.B.g;
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.clearRect(0, 0, ART_W, ART_H);
        b.setTransform(1, 0, 0, 1, -camX, -camY);
        lighting.lighter.bind(b, q.rim);
        scene.paintActors(b, lighting.lighter, f);
        b.globalCompositeOperation = 'source-over';
        b.globalAlpha = 1;
        perf.mark(P_ACTORS, b);
        // ---- E 光る物（ブルームの元）
        if (q.bloomLevels > 0) {
            const e = this.bloom.begin(camX, camY);
            scene.paintEmissive(e, f);
            e.globalCompositeOperation = 'source-over';
            e.globalAlpha = 1;
            lighting.multiplyGate(e);
            this.bloom.process(q.bloomLevels);
            perf.mark(P_EMISSIVE, e);
        }
        // ---- 光の紙（L・LA・La）
        lighting.build(camX, camY);
        perf.mark(P_LIGHT, lighting.La.g);
        // ---- 画用紙の上で光を掛ける：地形・床の物。キャラを重ねて G にする
        lighting.lightTerrain(a, q.overbright);
        if (PostFx.desaturates(q))
            this.post.desaturateArt(a, ART_W, ART_H);
        lighting.lightGround(this.A2.c, this.G);
        const gg = this.G.g;
        gg.drawImage(this.B.c, 0, 0);
        const dof = q.dof && this.dofEnabled ? this.dof : null;
        if (dof)
            dof.render(this.A.c);
        perf.mark(P_ART_LIGHT, gg);
        // ---- 画面の外で HD の紙を用意する（霧・加算の紙）
        const addOn = q.bloomLevels > 0 || q.shafts;
        if (addOn) {
            const h = this.bloom.compose(q.bloomStrength, q.bloomLevels);
            if (q.shafts)
                this.post.drawShafts(h, f, 0.25, 0.25);
            this.bloom.finish();
        }
        if (q.fog)
            this.post.prepareFog(f);
        perf.mark(P_OFF_HD);
        // ---- 画面へ
        const cw = g.canvas.width;
        const ch = g.canvas.height;
        const sx = cw / SCREEN_W;
        const sy = ch / SCREEN_H;
        if (cw !== this.lastW || ch !== this.lastH) {
            // 大きさが変わった時だけ測り直す（毎フレーム物を作らない）
            const pi = pixelInfo(cw, ch);
            this.lastW = cw;
            this.lastH = ch;
            this.lastInteger = pi.integer;
            this.lastK = sharpFactor(pi.artPx);
        }
        const sharp = !this.lastInteger && q.sharpScaling;
        if (sharp)
            this.ensureUp(this.lastK);
        const shx = scene.shakeX ?? 0;
        const shy = scene.shakeY ?? 0;
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        if (shx !== 0 || shy !== 0) {
            // 揺れて空いた縁に前のフレームが残らないよう、先に黒で塗る
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.fillStyle = '#000';
            g.fillRect(0, 0, cw, ch);
        }
        g.setTransform(sx, 0, 0, sy, shx * sx, shy * sy);
        // 色味：世界を 1 枚の画用紙にまとめる時は、画用紙の上で掛ける（画面いっぱいの 'soft-light' は 3ms、
        // 画用紙なら 0.5ms）。ブルームと粒子には掛からないが、色味は 1 割ほどなので見分けは付かない
        const merged = sharp || !dof;
        if (merged) {
            // 1 回の拡大にまとめる：地形 ＋（ぼかし）＋ 床の物とキャラ
            if (dof)
                dof.applyArt(a);
            a.drawImage(this.G.c, 0, 0);
            this.post.drawGrade(a, q, ART_W, ART_H);
            perf.mark(P_DOF, a);
            this.blit(g, this.A, sharp);
            perf.mark(P_BLIT_A, g);
        }
        else {
            this.blit(g, this.A, false);
            perf.mark(P_BLIT_A, g);
            dof.apply(g);
            perf.mark(P_DOF, g);
            this.blit(g, this.G, false);
            perf.mark(P_BLIT_G, g);
        }
        // 霧（画面に固定。揺れに乗せない）
        if (q.fog) {
            g.setTransform(sx, 0, 0, sy, 0, 0);
            this.post.drawFog(g);
            perf.mark(P_FOG, g);
        }
        // HD の層（粒子・光線・数字）。世界に付いているので揺れに乗せる
        g.setTransform(sx, 0, 0, sy, shx * sx, shy * sy);
        g.imageSmoothingEnabled = true;
        scene.paintHD(g, f);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        perf.mark(P_HD, g);
        // ブルーム ＋ 光の筋（揺れに乗せる。筋は画面に固定したいが、揺れは一瞬なので分けない）
        if (addOn) {
            this.bloom.apply(g);
            perf.mark(P_ADD, g);
        }
        g.setTransform(sx, 0, 0, sy, 0, 0);
        if (!merged)
            this.post.drawGrade(g, q, SCREEN_W, SCREEN_H);
        if (q.vignette)
            this.post.drawVignette(g);
        perf.mark(P_GRADE, g);
        this.post.drawOverlay(g, scene.fade ?? 0, scene.flashAlpha ?? 0, scene.flashColor);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.imageSmoothingEnabled = false;
        perf.mark(P_OVERLAY, g);
        perf.end(g);
    }
    /** 画用紙を画面へ拡大して貼る。g は論理座標（＋揺れ）の向き */
    blit(g, s, sharp) {
        if (!sharp || !this.up) {
            g.imageSmoothingEnabled = false;
            g.drawImage(s.c, 0, 0, ART_W, ART_H, -CROP_X, -CROP_Y, ART_W * ART_SCALE, ART_H * ART_SCALE);
            return;
        }
        // 最近傍で k 倍 → 滑らかに縮めて貼る（'copy' なので前の中身を消す手間が要らない）
        const up = this.up;
        const k = this.upK;
        up.g.globalCompositeOperation = 'copy';
        up.g.drawImage(s.c, 0, 0, ART_W, ART_H, 0, 0, ART_W * k, ART_H * k);
        up.g.globalCompositeOperation = 'source-over';
        g.imageSmoothingEnabled = true;
        g.drawImage(up.c, 0, 0, ART_W * k, ART_H * k, -CROP_X, -CROP_Y, ART_W * ART_SCALE, ART_H * ART_SCALE);
    }
    ensureUp(k) {
        if (this.up && this.upK === k)
            return;
        this.up?.release();
        this.up = new Surface(ART_W * k, ART_H * k, false, false);
        this.upK = k;
    }
    /** 検証用：中の紙を全部並べる（毎フレームは呼ばない） */
    debugBuffers() {
        const out = [
            { name: 'A terrain (lit)', c: this.A.c },
            { name: 'A2 ground (unlit)', c: this.A2.c },
            { name: 'B actors (lit per actor)', c: this.B.c },
            { name: 'G = A2 x La + B', c: this.G.c },
        ];
        this.lighting.debugBuffers(out);
        this.bloom.debugBuffers(out);
        this.dof?.debugBuffers(out);
        this.post.debugBuffers(out);
        if (this.up)
            out.push({ name: `sharp x${this.upK}`, c: this.up.c });
        return out;
    }
}
//# sourceMappingURL=compositor.js.map