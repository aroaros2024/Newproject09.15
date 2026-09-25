/**
 * カールノイズの流れ場。粒子（particles.ts）はこの速度に乗って渦を巻く。
 *
 * なめらかなノイズを「流れ関数」ψ として置き、速度を
 *   v = (∂ψ/∂y, −∂ψ/∂x)
 * とする（ψ の勾配を 90° 回したもの）。この速度場は発散が 0 なので、
 * 粒がどこかに溜まったり湧き出したりせず、ψ の等高線に沿って回り続ける。
 *
 * 計算を軽くするため、ψ はマスごとの格子点（既定 16 ドット間隔）にだけ置き、
 * 粒は格子の双線形補間から **解析的に** 速度を読む。
 *   ψ(fx, fy) = p00(1−fx)(1−fy) + p10·fx(1−fy) + p01(1−fx)fy + p11·fx·fy
 * を微分すると ∂vx/∂x + ∂vy/∂y = 0 がマスの中でちょうど成り立つ。
 * マスの境目では法線の成分（縦の境目なら vx）が境目の 2 点だけで決まるので連続する。
 *
 * 格子は時間でゆっくり変わる。毎秒 4 回（15 刻みごと）の「前」と「後」の格子を持ち、
 * その間を刻みの位相で補間する。次の格子は 15 刻みに分けて行ごとに作るので、
 * 1 刻みの重さが揃う。
 *
 * 格子は世界（マップ）に固定する。カメラが動いても流れは地面に貼り付いたまま。
 * ゲームの乱数は使わない（noise.ts の固定表だけ）。DOM にも触れない。
 */
import { perlin3 } from './noise.js';
/** 見た目の固定刻み（秒）。screens/app.ts の TICK_MS と同じ 60Hz */
export const CURL_TICK_S = 1 / 60;
/** 格子を作り直す間隔（刻み）。15 刻み = 0.25 秒 = 毎秒 4 回 */
export const CURL_KEY_TICKS = 15;
/**
 * ψ の目盛り。速度（ドット/秒）= FLOW_K × ψ の勾配（1/ドット）× gain。
 * 格子 16 ドット・既定の ψ で、平均の速さが約 12 ドット/秒（画面 36px/秒）になるよう測って決めた。
 * これより速いと塵が「飛んで」見え、遅いと止まって見える。
 */
export const FLOW_K = 720;
/**
 * 流れ関数 ψ（x, y はドット、t は秒）。
 * 大きなうねり（64 ドット ≒ 4 マス）と細かい渦（24 ドット）の 2 層。
 * 時間の係数が小さいほど模様の変わり方がゆっくりになる（大 14 秒・小 7 秒ほどで入れ替わる）。
 */
export function streamFunction(x, y, t) {
    return perlin3(x / 64, y / 64, 0.07 * t) + 0.45 * perlin3(x / 24, y / 24, 0.15 * t + 17);
}
/** ダンジョンの階（48×32 マス → 格子点 49×33） */
export const CURL_GRID_DUNGEON = { cols: 48, rows: 32 };
/** タイトル・村のジオラマ（28×16 マス。画面 428×240 ドットを覆う） */
export const CURL_GRID_DIORAMA = { cols: 28, rows: 16 };
export class CurlField {
    cols;
    rows;
    /** 格子点の数（横・縦） */
    nx;
    ny;
    cellSize;
    originX;
    originY;
    /** 流れの強さの倍率。いつ変えてもよい */
    gain;
    invCell;
    /** 前の格子（時刻 keyIndex × 0.25 秒） */
    psiA;
    /** 後の格子（その 0.25 秒後） */
    psiB;
    /** 作っている途中の次の格子（さらに 0.25 秒後） */
    psiNext;
    /** 今の刻みで補間した格子。sample はこれだけを読む */
    cur;
    /** 通算の刻み。時刻 = tickNo / 60 */
    tickNo = 0;
    /** 前の格子の番号 */
    keyIndex = 0;
    /** 次の格子の、次に作る行 */
    buildRow = 0;
    rowsPerTick;
    constructor(o = {}) {
        this.cols = Math.max(1, (o.cols ?? 48) | 0);
        this.rows = Math.max(1, (o.rows ?? 32) | 0);
        this.nx = this.cols + 1;
        this.ny = this.rows + 1;
        this.cellSize = o.cellSize ?? 16;
        this.invCell = 1 / this.cellSize;
        this.originX = o.originX ?? 0;
        this.originY = o.originY ?? 0;
        this.gain = o.gain ?? 1;
        const n = this.nx * this.ny;
        this.psiA = new Float32Array(n);
        this.psiB = new Float32Array(n);
        this.psiNext = new Float32Array(n);
        this.cur = new Float32Array(n);
        this.rowsPerTick = Math.ceil(this.ny / CURL_KEY_TICKS);
        this.reset(o.t0 ?? 0);
    }
    /** 今の時刻（秒） */
    get time() {
        return this.tickNo * CURL_TICK_S;
    }
    /**
     * 時刻を飛ばして全部の格子を作り直す（階に入ったとき・検証用）。
     * 刻みで進めてきた場と、同じ時刻へ reset した場は同じ値になる。
     */
    reset(tSeconds) {
        this.tickNo = Math.max(0, Math.round(tSeconds / CURL_TICK_S));
        this.keyIndex = Math.floor(this.tickNo / CURL_KEY_TICKS);
        this.fillAll(this.psiA, this.keyTime(this.keyIndex));
        this.fillAll(this.psiB, this.keyTime(this.keyIndex + 1));
        this.fillAll(this.psiNext, this.keyTime(this.keyIndex + 2));
        this.buildRow = this.ny;
        this.blend();
    }
    /**
     * 1 刻み（1/60 秒）進める。次の格子を数行作り、15 刻みごとに前・後を入れ替える。
     * 割り当ては無い。
     */
    tick() {
        // 次の格子を少しずつ作る
        const tNext = this.keyTime(this.keyIndex + 2);
        const end = Math.min(this.ny, this.buildRow + this.rowsPerTick);
        for (let j = this.buildRow; j < end; j++)
            this.fillRow(this.psiNext, j, tNext);
        this.buildRow = end;
        this.tickNo++;
        if (this.tickNo - this.keyIndex * CURL_KEY_TICKS >= CURL_KEY_TICKS) {
            // 作り残しがあれば仕上げる（行の数が 15 刻みで割り切れないときの保険）
            for (let j = this.buildRow; j < this.ny; j++)
                this.fillRow(this.psiNext, j, tNext);
            const old = this.psiA;
            this.psiA = this.psiB;
            this.psiB = this.psiNext;
            this.psiNext = old;
            this.keyIndex++;
            this.buildRow = 0;
        }
        this.blend();
    }
    /**
     * (ax, ay)（世界のドット）の速度を out に書く。out[0] = vx、out[1] = vy（ドット/秒）。
     * 格子の外は一番近い縁の値を使う。割り当ては無い。
     */
    sample(ax, ay, out) {
        const cols = this.cols;
        const rows = this.rows;
        let u = (ax - this.originX) * this.invCell;
        let v = (ay - this.originY) * this.invCell;
        let i;
        let j;
        // NaN も左上の縁へ寄せる（!(u > 0) で拾う）
        if (!(u > 0)) {
            i = 0;
            u = 0;
        }
        else if (u >= cols) {
            i = cols - 1;
            u = cols;
        }
        else {
            i = Math.floor(u);
        }
        if (!(v > 0)) {
            j = 0;
            v = 0;
        }
        else if (v >= rows) {
            j = rows - 1;
            v = rows;
        }
        else {
            j = Math.floor(v);
        }
        const fx = u - i;
        const fy = v - j;
        const nx = this.nx;
        const k = j * nx + i;
        const c = this.cur;
        const p00 = c[k];
        const p10 = c[k + 1];
        const p01 = c[k + nx];
        const p11 = c[k + nx + 1];
        const s = FLOW_K * this.gain * this.invCell;
        // vx = ∂ψ/∂y、vy = −∂ψ/∂x（双線形の式をそのまま微分したもの）
        out[0] = s * ((p01 - p00) * (1 - fx) + (p11 - p10) * fx);
        out[1] = -s * ((p10 - p00) * (1 - fy) + (p11 - p01) * fy);
    }
    /** (ax, ay) の ψ（補間した値）。流れの見える化に使う */
    psiAt(ax, ay) {
        let u = (ax - this.originX) * this.invCell;
        let v = (ay - this.originY) * this.invCell;
        u = !(u > 0) ? 0 : u > this.cols ? this.cols : u;
        v = !(v > 0) ? 0 : v > this.rows ? this.rows : v;
        const i = Math.min(this.cols - 1, Math.floor(u));
        const j = Math.min(this.rows - 1, Math.floor(v));
        const fx = u - i;
        const fy = v - j;
        const k = j * this.nx + i;
        const c = this.cur;
        return c[k] * (1 - fx) * (1 - fy) + c[k + 1] * fx * (1 - fy)
            + c[k + this.nx] * (1 - fx) * fy + c[k + this.nx + 1] * fx * fy;
    }
    // ------------------------------------------------------------------
    keyTime(k) {
        return (k * CURL_KEY_TICKS) * CURL_TICK_S;
    }
    fillRow(dst, j, t) {
        const nx = this.nx;
        const y = this.originY + j * this.cellSize;
        for (let i = 0; i < nx; i++) {
            dst[j * nx + i] = streamFunction(this.originX + i * this.cellSize, y, t);
        }
    }
    fillAll(dst, t) {
        for (let j = 0; j < this.ny; j++)
            this.fillRow(dst, j, t);
    }
    /** 前と後の格子を今の位相で混ぜる */
    blend() {
        const phase = (this.tickNo - this.keyIndex * CURL_KEY_TICKS) / CURL_KEY_TICKS;
        const a = this.psiA;
        const b = this.psiB;
        const c = this.cur;
        for (let i = 0; i < c.length; i++)
            c[i] = a[i] + (b[i] - a[i]) * phase;
    }
}
//# sourceMappingURL=curl.js.map