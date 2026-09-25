/**
 * 画面の上に一時だけ出す部品（ダンジョンの画面が使う）。
 *
 * - PopupLayer：ダメージ・回復・MISS などの数字。当たった瞬間に弾んで出て、昇って消える
 * - drawBanner：画面を横切る告知の帯（「モンスターハウスだ！」「レベルアップ」）
 * - drawFloorCard：階に入った時の札（ダンジョン名と「B5F」）
 * - drawLetterbox：ボスが出た時の上下の黒帯
 *
 * どれも UI の座標（1280×720）で描く。ドットの拡大は掛けない（文字をくっきり見せる）。
 * 数字の置き場は最初に確保して使い回す（毎フレームの割り当てを作らない）。
 */
import { font } from '../theme.js';
import { PANEL } from './tokens.js';
import { frameParts } from './frame.js';
const POPUP_STYLE = {
    damage: { size: 28, color: '#ffffff', outline: '#1a1020', family: 'sans', rise: 26, life: 900, pop: 1.5 },
    damageToPlayer: { size: 28, color: '#ff8a78', outline: '#2a0c0c', family: 'sans', rise: 26, life: 950, pop: 1.5 },
    crit: { size: 38, color: '#ffc04a', outline: '#3a1400', family: 'sans', rise: 34, life: 1100, pop: 1.9 },
    heal: { size: 26, color: '#8ff0a0', outline: '#0c2a14', family: 'sans', rise: 30, life: 1000, pop: 1.3 },
    miss: { size: 22, color: '#c8c4bc', outline: '#1a1a22', family: 'serif', rise: 18, life: 800, pop: 1.2 },
    exp: { size: 18, color: '#e8d6a0', outline: '#241a08', family: 'sans', rise: 22, life: 1000, pop: 1.1 },
    levelUp: { size: 30, color: '#ffe08a', outline: '#3a2a00', family: 'serif', rise: 40, life: 1500, pop: 1.6 },
    info: { size: 20, color: '#f1ebdd', outline: '#101420', family: 'sans', rise: 20, life: 1000, pop: 1.2 },
};
const POPUP_CAP = 48;
/**
 * 数字の置き場。位置はマス（小数可）で持ち、描く時に画面へ直す
 * （カメラが動いても数字はそのマスの上に留まる）。
 */
export class PopupLayer {
    text = new Array(POPUP_CAP).fill('');
    kind = new Array(POPUP_CAP).fill('info');
    tx = new Float32Array(POPUP_CAP);
    ty = new Float32Array(POPUP_CAP);
    age = new Float32Array(POPUP_CAP);
    /** 同じマスに重なった時の段（上へずらす） */
    stack = new Uint8Array(POPUP_CAP);
    n = 0;
    get count() {
        return this.n;
    }
    clear() {
        this.n = 0;
    }
    /** 数字を出す。いっぱいなら一番古いものを捨てる */
    spawn(text, kind, tileX, tileY) {
        if (this.n >= POPUP_CAP)
            this.removeAt(0);
        // 同じマスでまだ若い数字があれば、その上に積む
        let stack = 0;
        for (let i = 0; i < this.n; i++) {
            if (this.tx[i] === tileX && this.ty[i] === tileY && this.age[i] < 350)
                stack = Math.max(stack, this.stack[i] + 1);
        }
        const i = this.n++;
        this.text[i] = text;
        this.kind[i] = kind;
        this.tx[i] = tileX;
        this.ty[i] = tileY;
        this.age[i] = 0;
        this.stack[i] = Math.min(4, stack);
    }
    update(dtMs) {
        for (let i = 0; i < this.n;) {
            this.age[i] += dtMs;
            if (this.age[i] >= POPUP_STYLE[this.kind[i]].life)
                this.removeAt(i);
            else
                i++;
        }
    }
    /** 古い順を保って詰める（重なりの順が変わらないように） */
    removeAt(i) {
        for (let j = i; j < this.n - 1; j++) {
            this.text[j] = this.text[j + 1];
            this.kind[j] = this.kind[j + 1];
            this.tx[j] = this.tx[j + 1];
            this.ty[j] = this.ty[j + 1];
            this.age[j] = this.age[j + 1];
            this.stack[j] = this.stack[j + 1];
        }
        this.n--;
    }
    /**
     * 描く。マス (tx, ty) の画面の位置 = origin + マス × tilePx（マスの左上）。
     * headPx はマスの上端から数字の出る高さ（キャラの頭の上）。
     */
    draw(g, originX, originY, tilePx, headPx = 40) {
        if (this.n === 0)
            return;
        g.save();
        g.textAlign = 'center';
        g.textBaseline = 'alphabetic';
        g.lineJoin = 'round';
        for (let i = 0; i < this.n; i++) {
            const st = POPUP_STYLE[this.kind[i]];
            const a = this.age[i];
            const t = a / st.life;
            // 出る瞬間に弾む（大きく出て 140ms で元の大きさへ）
            const popT = Math.min(1, a / 140);
            const scale = 1 + (st.pop - 1) * (1 - popT) * (1 - popT);
            // 昇りは始めに速く、後はゆっくり
            const rise = st.rise * (1 - (1 - Math.min(1, t * 1.6)) ** 3);
            const alpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
            const x = Math.round(originX + (this.tx[i] + 0.5) * tilePx);
            const y = Math.round(originY + this.ty[i] * tilePx + tilePx - headPx - rise - this.stack[i] * st.size * 0.9);
            const size = Math.round(st.size * scale);
            g.globalAlpha = alpha;
            g.font = font(size, 'bold', st.family);
            g.lineWidth = Math.max(3, Math.round(size / 6));
            g.strokeStyle = st.outline;
            g.strokeText(this.text[i], x, y);
            g.fillStyle = st.color;
            g.fillText(this.text[i], x, y);
        }
        g.restore();
    }
}
// ---------------------------------------------------------------------------
// 告知の帯・階の札・黒帯
// ---------------------------------------------------------------------------
/** 出て・留まって・消える、の明るさ（0〜1） */
export function envelope(tMs, durMs, inMs = 200, outMs = 320) {
    if (tMs <= 0 || tMs >= durMs)
        return 0;
    if (tMs < inMs)
        return tMs / inMs;
    if (tMs > durMs - outMs)
        return (durMs - tMs) / outMs;
    return 1;
}
/**
 * 告知の帯（画面幅・高さ 120px）。紺の帯に金の細線、明朝 44。
 * t は出てからの ms、dur は全体の長さ。文字は右から少し滑り込む。
 */
export function drawBanner(g, text, sub, tMs, durMs = 1800, y = 250, color = PANEL.goldLight) {
    const a = envelope(tMs, durMs);
    if (a <= 0)
        return;
    const h = 120;
    const W = 1280;
    g.save();
    g.globalAlpha = a;
    // 帯（上下を薄くぼかすため 3 段で塗る）
    g.fillStyle = 'rgba(11,16,32,0.55)';
    g.fillRect(0, y - 8, W, h + 16);
    g.fillStyle = 'rgba(11,16,32,0.82)';
    g.fillRect(0, y, W, h);
    // 金の細線（真ん中が濃く、端へ薄く）
    const hair = g.createLinearGradient(0, 0, W, 0);
    hair.addColorStop(0, 'rgba(200,168,105,0)');
    hair.addColorStop(0.5, 'rgba(232,214,160,0.95)');
    hair.addColorStop(1, 'rgba(200,168,105,0)');
    g.fillStyle = hair;
    g.fillRect(0, y + 6, W, 2);
    g.fillRect(0, y + h - 8, W, 2);
    g.fillStyle = 'rgba(122,101,56,0.6)';
    g.fillRect(0, y + 9, W, 1);
    g.fillRect(0, y + h - 5, W, 1);
    // 文字
    const slide = Math.round(40 * (1 - Math.min(1, tMs / 260)) ** 2);
    const cx = W / 2 + slide;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = font(44, 'bold', 'serif');
    const ty = sub ? y + 66 : y + 76;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillText(text, cx + 2, ty + 3);
    g.fillStyle = color;
    g.fillText(text, cx, ty);
    if (sub) {
        g.font = font(20);
        g.fillStyle = '#c9c2ae';
        g.fillText(sub, cx, y + 98);
    }
    // 両脇の菱形
    const parts = frameParts();
    g.imageSmoothingEnabled = false;
    g.drawImage(parts.capL, W / 2 - 300, y + 3, 8, 16);
    g.drawImage(parts.capR, W / 2 + 292, y + 3, 8, 16);
    g.restore();
}
/**
 * 階に入った時の札。明朝の「B5F」とダンジョン名。alpha は外から（暗転と揃える）。
 */
export function drawFloorCard(g, dungeonName, depthLabel, alpha, cx = 640, cy = 330) {
    if (alpha <= 0)
        return;
    g.save();
    g.globalAlpha = Math.min(1, alpha);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = font(22, 'normal', 'serif');
    g.fillStyle = '#c9c2ae';
    g.fillText(dungeonName, cx, cy - 34);
    // 名前と階の間の金の線
    const line = g.createLinearGradient(cx - 150, 0, cx + 150, 0);
    line.addColorStop(0, 'rgba(200,168,105,0)');
    line.addColorStop(0.5, 'rgba(232,214,160,0.9)');
    line.addColorStop(1, 'rgba(200,168,105,0)');
    g.fillStyle = line;
    g.fillRect(cx - 150, cy - 20, 300, 1);
    g.font = font(60, 'bold', 'serif');
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(depthLabel, cx + 3, cy + 46);
    g.fillStyle = PANEL.goldLight;
    g.fillText(depthLabel, cx, cy + 43);
    g.restore();
}
/** ボスが出た時などの上下の黒帯。amount は 0〜1（1 で上下 72px ずつ） */
export function drawLetterbox(g, amount, maxPx = 72) {
    if (amount <= 0)
        return;
    const h = Math.round(maxPx * Math.min(1, amount));
    g.save();
    g.fillStyle = '#05060b';
    g.fillRect(0, 0, 1280, h);
    g.fillRect(0, 720 - h, 1280, h);
    g.fillStyle = 'rgba(200,168,105,0.45)';
    g.fillRect(0, h, 1280, 1);
    g.fillRect(0, 720 - h - 1, 1280, 1);
    g.restore();
}
/** ボスの名前の札（黒帯の上に出す） */
export function drawBossTitle(g, name, epithet, tMs, durMs = 2400) {
    const a = envelope(tMs, durMs, 300, 500);
    if (a <= 0)
        return;
    g.save();
    g.globalAlpha = a;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const x = 96 + Math.round(30 * (1 - Math.min(1, tMs / 400)) ** 2);
    if (epithet) {
        g.font = font(20, 'normal', 'serif');
        g.fillStyle = '#c9c2ae';
        g.fillText(epithet, x, 590);
    }
    g.font = font(48, 'bold', 'serif');
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillText(name, x + 3, 643);
    g.fillStyle = '#f3d9a4';
    g.fillText(name, x, 640);
    g.fillStyle = 'rgba(232,214,160,0.8)';
    g.fillRect(x, 652, Math.min(520, name.length * 48 + 40), 2);
    g.restore();
}
//# sourceMappingURL=widgets.js.map