/**
 * ガチャの演出。
 *
 * 画面を持たず、村の画面の上に重ねて描くだけの小さな状態機械。
 * 引く処理そのものは game/gacha.ts が済ませていて、ここは
 * 「決まった結果をどう見せるか」しか持たない。
 *
 * 見せ方は 3 段。
 *   ため   銀の光の筋がカールノイズの流れにうねりながら中心へ渦を巻いて集まり、光の玉になる。
 *          この時点では色を出さない（色で結果が分かってしまう）
 *   はじけ  光が弾ける。ここで初めてレア度の色が出る。粒は流れ場に乗って渦を巻き続ける
 *   結果   飾り枠のカードに名前と説明。A で次へ
 *
 * レア度が高いほど「ため」が長い。長く待たされるほど期待が上がるので、
 * 色を出す前の時間そのものが演出になる。
 *
 * 2 個以上まとめて引いたときは、ためとはじけを 1 回だけやって一覧へ飛ぶ。
 * 1 つずつ見せていた頃は 10 連で A キーを 11 回押す必要があり、
 * 2 回目からは演出ではなく待ち時間になっていた。
 * ための長さは「10 個のうち一番良いレア度」で決めるので、期待は残る。
 */
import { RARITY_COLOR, RARITY_LABEL } from '../data/gacha.js';
import { Rng } from '../core/rng.js';
import { RAMP_GOLD } from './art/palette.js';
import { hashFloat } from './art/hash.js';
import { CURL_GRID_DIORAMA, CurlField } from './gfx-core/curl.js';
import { KIND_HD, ParticlePool, TONE_GOLD, TONE_MAGIC, TONE_WATER, TONE_WHITE, } from './gfx-core/particles.js';
import { drawHDParticles, makeHDAtlas } from './gfx/particlesDraw.js';
import { ctx2d, makeCanvas } from './gfx/canvas.js';
import { drawCursor, drawOverlay, drawPanel, drawText, drawTitlePlaque, wrapText, } from './draw.js';
import { getSprite, sprites } from './sprites.js';
import { tryGetItem } from '../data/registry.js';
import { iconKeyForCatalog } from './art/items.js';
import { tryGetPartner } from '../data/partners.js';
import { charmName } from '../game/charm.js';
import { SCREEN_H, SCREEN_W, UI } from './theme.js';
/** レア度ごとの「ため」の長さ（ミリ秒） */
const CHARGE_MS = { n: 420, r: 620, sr: 900, ssr: 1400 };
const BURST_MS = 320;
/** 出るものが尽きたあとのギタンの色 */
const GITAN_COLOR = '#ffd98a';
/** 光の粒の色の組（レア度ごと） */
const RARITY_TONE = { n: TONE_WHITE, r: TONE_WATER, sr: TONE_MAGIC, ssr: TONE_GOLD };
/** 集まる光の筋の数 */
const STREAMS = 56;
/** 画面の中心（画用紙のドット。画面 = ドット × 3） */
const CX = 640 / 3;
const CY = 330 / 3;
/** はじける光（HD の粒）。数と速さはレア度で変える */
function burstSpec(rarity) {
    const big = rarity === 'ssr' ? 2 : rarity === 'sr' ? 1.4 : 1;
    return {
        count: Math.round(60 * big), speed: [40, 150 * big], spread: Math.PI * 2, life: [0.9, 2.2],
        size: 3, ramp: RAMP_GOLD, kind: KIND_HD, gain: 1.8, drag: 1.4, gravity: 0, flowRamp: 1.6,
        radius: 4, emissive: true, tone: rarity ? RARITY_TONE[rarity] : TONE_GOLD,
    };
}
/** カードのまわりに湧く粒 */
const SPARKLE = {
    ssr: { ...burstSpec('ssr'), count: 2, speed: [6, 20], life: [1.2, 2.4], size: 2.5, gravity: -8 },
    sr: { ...burstSpec('sr'), count: 1, speed: [6, 18], life: [1.0, 2.0], size: 2.2, gravity: -6 },
};
/** 柔らかい光の玉（色ごとに 1 枚だけ焼く） */
const glowCache = new Map();
function glow(color) {
    const hit = glowCache.get(color);
    if (hit)
        return hit;
    const c = makeCanvas(64, 64);
    const g = ctx2d(c);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, color);
    grad.addColorStop(0.5, `${color}55`);
    grad.addColorStop(1, `${color}00`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
    return c;
}
export class GachaAnim {
    results;
    onDone;
    phase = 'charge';
    t = 0;
    index = 0;
    skipped = false;
    /** 一覧で選んでいる行 */
    cursor = 0;
    /** 粒（表示専用の乱数。ゲームの乱数は使わない） */
    field = new CurlField(CURL_GRID_DIORAMA);
    pool = new ParticlePool(900, new Rng('fx:gacha'));
    atlas = makeHDAtlas();
    xf = { scale: 3, offX: 0, offY: 0 };
    flow = new Float64Array(2);
    /** はじけた瞬間からの時間（白い閃きと衝撃の輪） */
    flashT = -1;
    /** SSR・SR のカードのまわりに湧き続ける粒の間隔 */
    sparkleAcc = 0;
    constructor(results, 
    /** 全部見終わったときに呼ばれる */
    onDone) {
        this.results = results;
        this.onDone = onDone;
    }
    get current() {
        return this.results[this.index];
    }
    /** まとめ引きか。1 個ずつ見せずに一覧へ飛ぶ */
    get bulk() {
        return this.results.length > 1;
    }
    /** まとめ引きのときの代表レア度（一番良いもの） */
    get bestRarity() {
        let best = null;
        for (const r of this.results) {
            if (!r.rarity)
                continue;
            if (best === null || CHARGE_MS[r.rarity] > CHARGE_MS[best])
                best = r.rarity;
        }
        return best;
    }
    get chargeMs() {
        if (this.skipped)
            return 60;
        const rarity = this.bulk ? this.bestRarity : (this.current?.rarity ?? null);
        return CHARGE_MS[rarity ?? 'n'];
    }
    /** 経過時間を進める。ミリ秒 */
    update(dt) {
        this.t += dt;
        if (this.phase === 'charge' && this.t >= this.chargeMs) {
            this.phase = 'burst';
            this.t = 0;
            this.explode();
        }
        else if (this.phase === 'burst' && this.t >= BURST_MS) {
            // まとめ引きは 1 枚ずつ見せない。はじけたらそのまま一覧へ
            this.phase = this.bulk ? 'summary' : 'reveal';
            this.t = 0;
        }
    }
    /**
     * 決定キー。
     *
     * 「ため」の途中で押したら飛ばす。10 連を毎回最後まで見せられると、
     * 2 回目からは演出ではなく待ち時間になる。
     */
    advance() {
        if (this.phase === 'charge' || this.phase === 'burst') {
            if (this.phase === 'charge')
                this.explode();
            this.skipped = true;
            this.phase = this.bulk ? 'summary' : 'reveal';
            this.t = 0;
            return;
        }
        if (this.phase === 'summary') {
            this.onDone();
            return;
        }
        this.index++;
        if (this.index >= this.results.length) {
            // 1 回だけのときに一覧を出しても同じものを 2 度見せるだけ
            if (this.results.length <= 1) {
                this.onDone();
                return;
            }
            this.phase = 'summary';
            this.t = 0;
            return;
        }
        this.phase = 'charge';
        this.t = 0;
    }
    /** 表示のレア度（まとめ引きは一番良いもの） */
    get shownRarity() {
        return this.bulk ? this.bestRarity : (this.current?.rarity ?? null);
    }
    explode() {
        this.pool.burst(burstSpec(this.shownRarity), CX, CY);
        this.flashT = 0;
    }
    /** 60Hz の刻み（粒と流れ場） */
    tick(stepMs) {
        this.field.tick();
        this.pool.step(stepMs / 1000, this.field);
        if (this.flashT >= 0)
            this.flashT += stepMs;
        // SSR・SR のカードのまわりに光の粒が湧き続ける
        const r = this.shownRarity;
        if (this.phase === 'reveal' && (r === 'ssr' || r === 'sr')) {
            this.sparkleAcc += stepMs;
            while (this.sparkleAcc > (r === 'ssr' ? 60 : 110)) {
                this.sparkleAcc -= r === 'ssr' ? 60 : 110;
                const a = hashFloat(this.pool.count, Math.floor(this.sparkleAcc * 7), 3) * Math.PI * 2;
                this.pool.burst(SPARKLE[r], CX + Math.cos(a) * 80, CY + Math.sin(a) * 60);
            }
        }
    }
    /** 一覧の中でカーソルを動かす。選んだ行の説明が下に出る */
    move(dy) {
        if (this.phase !== 'summary')
            return;
        const n = this.results.length;
        if (n === 0)
            return;
        this.cursor = (this.cursor + dy + n) % n;
    }
    draw(g, now) {
        drawOverlay(g, SCREEN_W, SCREEN_H, 0.93);
        if (this.phase === 'summary') {
            const best = this.bestRarity;
            this.drawParticlesAndFlash(g, best ? RARITY_COLOR[best] : GITAN_COLOR);
            this.drawSummary(g);
            return;
        }
        const r = this.current;
        if (!r)
            return;
        const cx = SCREEN_W / 2;
        const cy = SCREEN_H / 2 - 30;
        const color = r.rarity ? RARITY_COLOR[r.rarity] : GITAN_COLOR;
        if (this.phase === 'charge') {
            // 色はまだ出さない。何が出るか分かってしまう
            const p = Math.min(1, this.t / this.chargeMs);
            this.drawStreams(g, p);
            const pulse = 1 + Math.sin(now / 90) * 0.08;
            this.drawOrb(g, cx, cy, (18 + p * 40) * pulse, '#c8c8d4', 0.3 + p * 0.55);
        }
        else if (this.phase === 'burst') {
            const p = Math.min(1, this.t / BURST_MS);
            this.drawOrb(g, cx, cy, 60 + p * 220, color, (1 - p) * 0.8);
            if (r.rarity === 'ssr' || r.rarity === 'sr')
                this.drawRays(g, cx, cy, p, color);
        }
        else {
            this.drawCard(g, cx, cy, r, now);
        }
        this.drawParticlesAndFlash(g, color);
        if (this.results.length > 1) {
            drawText(g, `${this.index + 1} / ${this.results.length}`, SCREEN_W - 40, 44, { size: 16, align: 'right', color: UI.textDim });
        }
        drawText(g, this.phase === 'reveal' ? 'A：次へ' : 'A：飛ばす', SCREEN_W / 2, SCREEN_H - 34, { size: 15, align: 'center', color: UI.textDim });
    }
    /**
     * 集まる光の筋。筋ごとに生まれる向き・半径・出だしをハッシュで決め、
     * 半径を縮めながら角度を進めて渦を巻かせる。カールノイズの流れ場で位置をうねらせる。
     */
    drawStreams(g, p) {
        const dot = glow('#c8c8d4');
        g.save();
        g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < STREAMS; i++) {
            const delay = hashFloat(i, 1, 41) * 0.55;
            const r0 = 70 + hashFloat(i, 2, 41) * 110;
            const a0 = hashFloat(i, 3, 41) * Math.PI * 2;
            for (let k = 0; k < 5; k++) {
                const q = Math.max(0, Math.min(1, (p - delay) / (1 - delay) - k * 0.035));
                if (q <= 0 || q >= 1)
                    continue;
                const rad = r0 * (1 - q * q);
                const ang = a0 + q * 2.6;
                let x = CX + Math.cos(ang) * rad;
                let y = CY + Math.sin(ang) * rad * 0.8;
                this.field.sample(x, y, this.flow);
                x += this.flow[0] * 0.25 * (1 - q);
                y += this.flow[1] * 0.25 * (1 - q);
                const size = (k === 0 ? 16 : 10 - k) * (0.6 + q * 0.6);
                g.globalAlpha = (k === 0 ? 0.9 : 0.45 / k) * Math.min(1, q * 6);
                g.drawImage(dot, x * 3 - size, y * 3 - size, size * 2, size * 2);
            }
        }
        g.restore();
    }
    /** はじけた粒（流れ場で渦を巻く）と、白い閃き・衝撃の輪 */
    drawParticlesAndFlash(g, color) {
        drawHDParticles(g, this.pool, this.xf, this.atlas);
        if (this.flashT < 0 || this.flashT > 700)
            return;
        g.save();
        const f = this.flashT;
        if (f < 160) {
            g.globalAlpha = 0.55 * (1 - f / 160);
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, SCREEN_W, SCREEN_H);
        }
        const k = f / 700;
        g.globalAlpha = 0.8 * (1 - k);
        g.strokeStyle = color;
        g.lineWidth = 6 * (1 - k) + 1;
        g.beginPath();
        g.ellipse(CX * 3, CY * 3, 40 + k * 520, 30 + k * 400, 0, 0, Math.PI * 2);
        g.stroke();
        g.restore();
    }
    drawOrb(g, x, y, r, color, alpha) {
        g.save();
        g.globalAlpha = Math.max(0, Math.min(1, alpha));
        const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
        grad.addColorStop(0, color);
        grad.addColorStop(0.55, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
        g.fill();
        g.restore();
    }
    drawRays(g, x, y, p, color) {
        g.save();
        g.globalAlpha = (1 - p) * 0.7;
        g.strokeStyle = color;
        g.lineWidth = 3;
        for (let i = 0; i < 12; i++) {
            const a = (Math.PI * 2 * i) / 12;
            const r0 = 40 + p * 120;
            const r1 = r0 + 80;
            g.beginPath();
            g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
            g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
            g.stroke();
        }
        g.restore();
    }
    /**
     * 景品の絵。
     *
     * 知識はその道具の絵を出す。ただし未識別の道具は種類ごとに同じ絵なので
     * （草 22 種 → herb 1 枚）、出るのは「草」「巻物」といった見た目まで。
     * 何の草かは名前が伝える。
     */
    spriteOf(r) {
        if (r.charm)
            return 'charm';
        const p = r.prize;
        if (!p)
            return null;
        if (p.partnerId)
            return tryGetPartner(p.partnerId)?.baseId ?? null;
        if (p.boost?.t === 'knownItem')
            return tryGetItem(p.boost.itemId) ? iconKeyForCatalog(p.boost.itemId) : null;
        return null;
    }
    /** カードに出す名前 */
    titleOf(r) {
        if (r.charm)
            return charmName(r.charm);
        if (r.prize)
            return r.prize.name;
        return `${r.gitan} ギタン`;
    }
    drawCard(g, cx, cy, r, now) {
        const color = r.rarity ? RARITY_COLOR[r.rarity] : GITAN_COLOR;
        const box = { x: cx - 220, y: cy - 170, w: 440, h: 350 };
        const appear = Math.min(1, this.t / 220);
        // SSR と SR は後ろで光り続け、SSR はゆっくり回る光条を背負う
        if (r.rarity === 'ssr' || r.rarity === 'sr') {
            this.drawOrb(g, cx, cy, 210 + Math.sin(now / 200) * 16, color, 0.28);
            if (r.rarity === 'ssr')
                this.drawHalo(g, cx, cy, now, color);
        }
        g.save();
        g.globalAlpha = appear;
        // 出る瞬間に少し大きく見せてから落ち着く
        const k = 1 + 0.06 * (1 - appear);
        g.translate(cx, cy);
        g.scale(k, k);
        g.translate(-cx, -cy);
        drawPanel(g, box, { alpha: 0.96 });
        // レア度の札（枠の上辺に掛ける）と、レア度の色の細線
        drawTitlePlaque(g, r.rarity ? RARITY_LABEL[r.rarity] : 'ギタン', cx, box.y - 16, { size: 24, color, align: 'center' });
        g.fillStyle = color;
        g.globalAlpha = appear * 0.8;
        g.fillRect(box.x + 30, box.y + 44, box.w - 60, 1);
        g.fillRect(box.x + 30, box.y + box.h - 40, box.w - 60, 1);
        g.globalAlpha = appear;
        // 絵。台座の光の上に置く。SSR は大きく出す
        const spriteId = this.spriteOf(r);
        const icon = spriteId ? getSprite(spriteId) : null;
        const artY = box.y + 128;
        const pedestal = glow(color);
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.5 * appear;
        g.drawImage(pedestal, cx - 90, artY - 70, 180, 140);
        g.restore();
        if (icon && spriteId) {
            const size = r.rarity === 'ssr' ? 112 : 80;
            const bob = Math.round(Math.sin(now / 420) * 3);
            sprites.draw(g, spriteId, icon, cx, artY + bob, size, {});
        }
        else {
            // 加護とギタンは絵の代わりに印を出す
            g.strokeStyle = color;
            g.lineWidth = 3;
            g.beginPath();
            g.arc(cx, artY, 38, 0, Math.PI * 2);
            g.stroke();
            drawText(g, r.prize ? '加護' : 'G', cx, artY + 8, {
                size: 22, bold: true, align: 'center', color, family: 'serif',
            });
        }
        drawText(g, this.titleOf(r), cx, box.y + 232, {
            size: 26, bold: true, align: 'center', color: UI.text, family: 'serif',
        });
        const lines = wrapText(g, this.noteOf(r), box.w - 60, 17).slice(0, 3);
        lines.forEach((line, i) => {
            drawText(g, line, cx, box.y + 268 + i * 24, {
                size: 17, align: 'center', color: UI.textDim,
            });
        });
        g.restore();
    }
    /** SSR の後ろでゆっくり回る光条 */
    drawHalo(g, cx, cy, now, color) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.translate(cx, cy);
        g.rotate(now / 6000);
        for (let i = 0; i < 16; i++) {
            g.rotate(Math.PI / 8);
            const grad = g.createLinearGradient(0, 0, 0, -330);
            grad.addColorStop(0, `${color}00`);
            grad.addColorStop(0.3, `${color}30`);
            grad.addColorStop(1, `${color}00`);
            g.fillStyle = grad;
            g.beginPath();
            g.moveTo(-10, 0);
            g.lineTo(10, 0);
            g.lineTo(i % 2 === 0 ? 34 : 22, -330);
            g.lineTo(i % 2 === 0 ? -34 : -22, -330);
            g.closePath();
            g.fill();
        }
        g.restore();
    }
    /** その 1 回で何が起きたかを 1 行で */
    noteOf(r) {
        if (r.charm)
            return '村で 1 つだけ 着けられる。冒険の 最初から 印が 効く。';
        if (!r.prize)
            return '出るものは もう 無い。石が ギタンに 変わる。';
        if (r.prize.partnerId)
            return '冒険の 最初から 連れて行ける。倒れても 次の冒険で 戻る。';
        if (r.prize.boost?.t === 'knownItem') {
            return 'これから ずっと、冒険の 最初から 名前が 見える。';
        }
        return '村に 残る 効果。';
    }
    drawSummary(g) {
        const n = this.results.length;
        const rows = Math.ceil(n / 2);
        const rowH = 54;
        const box = { x: 220, y: Math.max(40, 360 - (rows * rowH + 170) / 2), w: 840, h: rows * rowH + 170 };
        drawPanel(g, box, { alpha: 0.95 });
        drawTitlePlaque(g, `引いたもの　${n} 回`, box.x + 14, box.y + 10);
        this.results.forEach((r, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = box.x + 32 + col * 400;
            const y = box.y + 64 + row * rowH;
            const color = r.rarity ? RARITY_COLOR[r.rarity] : GITAN_COLOR;
            if (i === this.cursor)
                drawCursor(g, { x: x - 6, y: y + 2, w: 384, h: rowH - 8 }, 0);
            // レア度の札
            g.save();
            g.fillStyle = 'rgba(11,16,32,0.8)';
            g.fillRect(x + 6, y + 12, 52, 26);
            g.fillStyle = color;
            g.fillRect(x + 6, y + 12, 52, 2);
            g.fillRect(x + 6, y + 36, 52, 2);
            g.restore();
            drawText(g, r.rarity ? RARITY_LABEL[r.rarity] : 'G', x + 32, y + 32, { size: 17, bold: true, align: 'center', color, family: 'serif' });
            // 1 枚ずつのカードを出さなくなったぶん、ここに絵も出す
            const spriteId = this.spriteOf(r);
            const icon = spriteId ? getSprite(spriteId) : null;
            if (spriteId && icon)
                sprites.draw(g, spriteId, icon, x + 86, y + 25, 32);
            drawText(g, this.titleOf(r), x + 112, y + 33, { size: 20, color: UI.text });
        });
        // 選んでいる行の説明。カードに出していた 1 行がここへ移る
        const sel = this.results[this.cursor];
        if (sel) {
            drawText(g, this.noteOf(sel), box.x + 32, box.y + box.h - 58, {
                size: 19, color: UI.textDim,
            });
        }
        drawText(g, '↑↓：見る　　A：閉じる', SCREEN_W / 2, box.y + box.h - 22, {
            size: 16, align: 'center', color: UI.textDim,
        });
    }
}
//# sourceMappingURL=gachaAnim.js.map