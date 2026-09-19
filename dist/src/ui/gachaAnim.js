/**
 * ガチャの演出。
 *
 * 画面を持たず、村の画面の上に重ねて描くだけの小さな状態機械。
 * 引く処理そのものは game/gacha.ts が済ませていて、ここは
 * 「決まった結果をどう見せるか」しか持たない。
 *
 * 見せ方は 3 段。
 *   ため   石が集まり、脈打つ。この時点では色を出さない
 *   はじけ  光が弾ける。ここで初めてレア度の色が出る
 *   結果   名前と説明。A で次へ
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
import { drawOverlay, drawPanel, drawText, wrapText } from './draw.js';
import { getSprite, sprites } from './sprites.js';
import { tryGetItem } from '../data/registry.js';
import { tryGetPartner } from '../data/partners.js';
import { charmName } from '../game/charm.js';
import { SCREEN_H, SCREEN_W, UI } from './theme.js';
/** レア度ごとの「ため」の長さ（ミリ秒） */
const CHARGE_MS = { n: 420, r: 620, sr: 900, ssr: 1400 };
const BURST_MS = 320;
/** 出るものが尽きたあとのギタンの色 */
const GITAN_COLOR = '#ffd98a';
export class GachaAnim {
    results;
    onDone;
    phase = 'charge';
    t = 0;
    index = 0;
    skipped = false;
    /** 一覧で選んでいる行 */
    cursor = 0;
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
            const pulse = 1 + Math.sin(now / 90) * 0.08;
            this.drawOrb(g, cx, cy, (26 + p * 34) * pulse, '#c8c8d4', 0.25 + p * 0.5);
            drawText(g, '……', cx, cy + 130, {
                size: 20, align: 'center', color: UI.textDim,
            });
        }
        else if (this.phase === 'burst') {
            const p = Math.min(1, this.t / BURST_MS);
            this.drawOrb(g, cx, cy, 60 + p * 220, color, (1 - p) * 0.8);
            this.drawRays(g, cx, cy, p, color);
        }
        else {
            this.drawCard(g, cx, cy, r, now);
        }
        if (this.results.length > 1) {
            drawText(g, `${this.index + 1} / ${this.results.length}`, SCREEN_W - 40, 44, { size: 16, align: 'right', color: UI.textDim });
        }
        drawText(g, this.phase === 'reveal' ? 'A：次へ' : 'A：飛ばす', SCREEN_W / 2, SCREEN_H - 34, { size: 15, align: 'center', color: UI.textDim });
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
            return tryGetItem(p.boost.itemId)?.sprite ?? null;
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
        const box = { x: cx - 210, y: cy - 160, w: 420, h: 330 };
        // SSR と SR は後ろで光り続ける
        if (r.rarity === 'ssr' || r.rarity === 'sr') {
            this.drawOrb(g, cx, cy, 200 + Math.sin(now / 200) * 16, color, 0.3);
        }
        drawPanel(g, box, { frame: color, alpha: 0.97 });
        drawText(g, r.rarity ? RARITY_LABEL[r.rarity] : 'ギタン', cx, box.y + 40, {
            size: 26, bold: true, align: 'center', color,
        });
        // 絵。SSR は大きく出す
        const spriteId = this.spriteOf(r);
        const icon = spriteId ? getSprite(spriteId) : null;
        const artY = box.y + 130;
        if (icon && spriteId) {
            const size = r.rarity === 'ssr' ? 104 : 76;
            // 台座。絵が背景に溶けないように敷く
            g.save();
            g.globalAlpha = 0.16;
            g.fillStyle = color;
            g.beginPath();
            g.arc(cx, artY, size * 0.72, 0, Math.PI * 2);
            g.fill();
            g.restore();
            sprites.draw(g, spriteId, icon, cx, artY, size, {});
        }
        else {
            // 加護とギタンは絵の代わりに印を出す
            g.save();
            g.globalAlpha = 0.9;
            g.strokeStyle = color;
            g.lineWidth = 3;
            g.beginPath();
            g.arc(cx, artY, 38, 0, Math.PI * 2);
            g.stroke();
            g.restore();
            drawText(g, r.prize ? '加護' : 'G', cx, artY + 7, {
                size: 20, bold: true, align: 'center', color,
            });
        }
        drawText(g, this.titleOf(r), cx, box.y + 218, {
            size: 22, bold: true, align: 'center', color: UI.text,
        });
        const lines = wrapText(g, this.noteOf(r), box.w - 50, 15).slice(0, 3);
        lines.forEach((line, i) => {
            drawText(g, line, cx, box.y + 258 + i * 24, {
                size: 15, align: 'center', color: UI.textDim,
            });
        });
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
        const box = { x: 240, y: 70, w: 800, h: 560 };
        drawPanel(g, box, { alpha: 0.95 });
        drawText(g, '引いたもの', box.x + 24, box.y + 36, {
            size: 20, bold: true, color: UI.cursorEdge,
        });
        this.results.forEach((r, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = box.x + 30 + col * 390;
            const y = box.y + 84 + row * 46;
            const color = r.rarity ? RARITY_COLOR[r.rarity] : GITAN_COLOR;
            if (i === this.cursor) {
                drawPanel(g, { x: x - 10, y: y - 22, w: 372, h: 36 }, { frame: UI.cursorEdge, alpha: 0.2 });
            }
            drawText(g, r.rarity ? RARITY_LABEL[r.rarity] : 'G', x, y, { size: 15, bold: true, color });
            // 1 枚ずつのカードを出さなくなったぶん、ここに絵も出す
            const spriteId = this.spriteOf(r);
            const icon = spriteId ? getSprite(spriteId) : null;
            if (spriteId && icon)
                sprites.draw(g, spriteId, icon, x + 62, y - 6, 22);
            drawText(g, this.titleOf(r), x + 82, y, { size: 16, color: UI.text });
        });
        // 選んでいる行の説明。カードに出していた 1 行がここへ移る
        const sel = this.results[this.cursor];
        if (sel) {
            drawText(g, this.noteOf(sel), box.x + 24, box.y + box.h - 54, {
                size: 15, color: UI.textDim,
            });
        }
        drawText(g, '↑↓：見る　　A：閉じる', SCREEN_W / 2, box.y + box.h - 24, {
            size: 15, align: 'center', color: UI.textDim,
        });
    }
}
//# sourceMappingURL=gachaAnim.js.map