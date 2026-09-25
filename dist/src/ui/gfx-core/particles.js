/**
 * 粒子の置き場と動き。粒はカールノイズの流れ場（curl.ts）に乗って渦を巻く。
 *
 * 置き場は最初に確保した型付き配列だけ（構造体の配列ではなく、項目ごとの配列）。
 * 粒が消えたら末尾の粒をその場所へ移して詰める。毎刻みの割り当てはゼロ
 * （配列・関数・文字列を作らない）。上限は 2,048 個。
 *
 * 並び：[0, ambientCount) が環境の粒（塵・胞子・火の粉）、[ambientCount, count) が技の粒。
 * 分けておくと、技の粒で満杯のときに環境の粒を 1 つ追い出すのが O(1) で済む。
 *   - 技の粒（burst・fromSprite）は、満杯なら環境の粒を追い出して入る
 *   - 環境の粒は、満杯なら生まれない（遊びの情報に近い技の演出を優先する）
 *
 * 動き（1 刻み h 秒）
 *   k  = gain × min(1, 年齢/寿命 × flowRamp)   … 飛び出した粒は、年齢とともに流れへ乗り換える
 *   v += ((流れ × k + 風) − v) × (1 − e^(−drag·h))、縦は + 重力 × h
 *   x += v × h
 * 弾けた火花は最初は自分の速さで飛び、減衰して止まりかけたところで渦に巻き込まれる。
 *
 * 乱数は表示専用の fxRng（または呼ぶ側が渡す Rng）。ゲームの乱数と Math.random は使わない。
 * 地図の形は知らない。環境の粒の生まれる場所は、呼ぶ側が関数で答える（SpawnPointFn）。
 * DOM に触れないので、node のテストから 1 万刻み回して置き場が増えないことを確かめられる。
 */
import { fxRng } from '../../core/rng.js';
import { EMISSIVE, RAMP_DUST, RAMP_EMBER, RAMP_GOLD, RAMP_HEAL, RAMP_ICE, RAMP_MAGIC, RAMP_POISON, RAMP_SMOKE, RAMP_THUNDER, RAMP_WATER, TRANSPARENT, WHITE, ci, rampIndex, rampOf, rgbOf, stepOf, } from '../art/palette.js';
import { valueNoise1 } from './noise.js';
/** 置き場の既定の上限 */
export const PARTICLE_CAPACITY = 2048;
/** 倒れた敵の絵から作る粒の上限（これより多い絵は間引く） */
export const SPRITE_PARTICLE_MAX = 120;
/** 環境の粒の出どころの数の上限 */
export const MAX_EMITTERS = 16;
/** 環境の粒が流れの速さへ寄る速さ（1/秒）。0.5 秒ほどで流れに馴染む */
export const AMBIENT_DRAG = 2;
export const KIND_PIXEL = 0;
export const KIND_HD = 1;
/** 年齢で階調を 1 方向に進む（白 → 魔法色 → 暗色） */
export const MODE_AGE = 0;
/** 明滅する（蛍）。明るさは 1 次元の値ノイズ */
export const MODE_BLINK = 1;
/** 絵の 1 ドットの色から、同じ階調を暗い方へ下りる（倒れた敵が崩れる） */
export const MODE_SPRITE = 2;
/** 暗 → 明 → 暗（環境の塵。ぽつんと現れて消えないように） */
export const MODE_SWELL = 3;
/** 加算で描く（HD の粒） */
export const PF_ADDITIVE = 1;
/** 光る。ブルームの層にも描く */
export const PF_EMISSIVE = 2;
/** 光の層で暗くなる（光らない粒） */
export const PF_LIT = 4;
/** 年齢とともに流れへ乗り換える（flowIn を使う） */
export const PF_FLOW_RAMP = 8;
/** 環境の粒 */
export const PF_AMBIENT = 16;
/** 環境の粒でない印（emitter の値） */
const NO_EMITTER = 255;
/** 寿命の下限（秒）。0 だと年齢/寿命が割り切れず色が引けない */
const MIN_LIFE = 1e-3;
/** 白の画素が崩れるときに下りる階調（白には階調が無いので骨の色で暗くなる） */
const BONE = rampIndex('bone');
// ---------------------------------------------------------------------------
// 階調の表（palette.ts の RAMP_* を番号で引く）
// ---------------------------------------------------------------------------
const rampTable = [];
/** 階調の番号 → HD の粒の色の組 */
const rampToneTable = new Uint8Array(256);
// ---------------------------------------------------------------------------
// HD の粒の色の組（柔らかい光の玉。gfx/particlesDraw.ts が 8 段の atlas に焼く）
// ---------------------------------------------------------------------------
export const TONE_WHITE = 0;
export const TONE_EMBER = 1;
export const TONE_GOLD = 2;
export const TONE_MAGIC = 3;
export const TONE_HEAL = 4;
export const TONE_WATER = 5;
export const TONE_CRIMSON = 6;
export const TONE_VOID = 7;
export const HD_TONE_COUNT = 8;
/** 色の組の芯の色（パレットの番号） */
export const HD_TONE_CORE = [
    WHITE, ci('ember', 5), ci('gold', 5), ci('violet', 5),
    ci('leaf', 5), ci('sky', 5), ci('crimson', 5), ci('indigo', 5),
];
/** 色の組の外側の色（芯から外へ向かってこの色で薄れる） */
export const HD_TONE_RIM = [
    ci('gold', 4), ci('ember', 3), ci('gold', 3), ci('violet', 3),
    ci('leaf', 3), ci('water', 4), ci('crimson', 3), ci('indigo', 3),
];
/** 色から組を選ぶときの見本（芯・中・外） */
const TONE_SAMPLES = [
    [WHITE, ci('bone', 5), ci('gold', 5)],
    [ci('ember', 5), ci('ember', 4), ci('ember', 3)],
    [ci('gold', 5), ci('gold', 4), ci('gold', 3)],
    [ci('violet', 5), ci('violet', 4), ci('violet', 3)],
    [ci('leaf', 5), ci('leaf', 4), ci('moss', 4)],
    [ci('sky', 5), ci('water', 5), ci('water', 4)],
    [ci('crimson', 5), ci('crimson', 4), ci('crimson', 3)],
    [ci('indigo', 5), ci('indigo', 4), ci('indigo', 3)],
];
/** r, g, b（0〜255）に一番近い色の組 */
function nearestTone(r, g, b) {
    let best = 0;
    let bestD = Infinity;
    for (let t = 0; t < TONE_SAMPLES.length; t++) {
        for (const c of TONE_SAMPLES[t]) {
            const [cr, cg, cb] = rgbOf(c);
            const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
            if (d < bestD) {
                bestD = d;
                best = t;
            }
        }
    }
    return best;
}
/** パレットの色 → HD の粒の色の組 */
export function toneOfColor(c) {
    const [r, g, b] = rgbOf(c);
    return nearestTone(r, g, b);
}
/** '#rrggbb' → HD の粒の色の組（AmbientSpec.glow 用。登録のときに 1 回だけ呼ぶ） */
export function toneOfHex(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (Number.isNaN(r + g + b))
        return TONE_WHITE;
    return nearestTone(r, g, b);
}
/**
 * 階調の配列 → 番号。同じ配列（同じ実体）なら同じ番号。
 * 初めて見る配列はここで登録する（1 回だけ割り当てが起きる）。
 * 階調はモジュールの定数として 1 回だけ作ること。毎回新しい配列を渡すと表が埋まる。
 */
export function rampIdOf(ramp) {
    for (let i = 0; i < rampTable.length; i++)
        if (rampTable[i] === ramp)
            return i;
    if (rampTable.length >= 255 || ramp.length === 0)
        return 0;
    rampTable.push(ramp);
    const id = rampTable.length - 1;
    // 白で始まる階調が多いので、2 番目（色の付いた明るい段）で色の組を決める
    rampToneTable[id] = toneOfColor(ramp[Math.min(1, ramp.length - 1)]);
    return id;
}
/** 番号 → 階調の配列 */
export const rampById = (id) => rampTable[id] ?? RAMP_DUST;
/** palette.ts の粒子用の階調（番号は登録の順） */
export const RAMP_ID = {
    dust: rampIdOf(RAMP_DUST),
    magic: rampIdOf(RAMP_MAGIC),
    ember: rampIdOf(RAMP_EMBER),
    heal: rampIdOf(RAMP_HEAL),
    water: rampIdOf(RAMP_WATER),
    poison: rampIdOf(RAMP_POISON),
    gold: rampIdOf(RAMP_GOLD),
    smoke: rampIdOf(RAMP_SMOKE),
    ice: rampIdOf(RAMP_ICE),
    thunder: rampIdOf(RAMP_THUNDER),
};
// 色の近さだけでは外れる組を決め打ちする（火の橙は金に、毒は緑に寄りすぎる）
rampToneTable[RAMP_ID.dust] = TONE_GOLD;
rampToneTable[RAMP_ID.magic] = TONE_MAGIC;
rampToneTable[RAMP_ID.ember] = TONE_EMBER;
rampToneTable[RAMP_ID.heal] = TONE_HEAL;
rampToneTable[RAMP_ID.water] = TONE_WATER;
rampToneTable[RAMP_ID.poison] = TONE_MAGIC;
rampToneTable[RAMP_ID.gold] = TONE_GOLD;
rampToneTable[RAMP_ID.smoke] = TONE_WHITE;
rampToneTable[RAMP_ID.ice] = TONE_WATER;
rampToneTable[RAMP_ID.thunder] = TONE_GOLD;
/** 階調の番号 → HD の粒の色の組 */
export const toneOfRamp = (id) => rampToneTable[id];
// ---------------------------------------------------------------------------
export class ParticlePool {
    capacity;
    // 位置と速度（世界のドット、ドット/秒）
    x;
    y;
    vx;
    vy;
    /** 年齢と寿命（秒） */
    age;
    life;
    /** 大きさ（ドット）。ドットの粒は 1 辺、HD の粒は半径 */
    size;
    /** 流れに乗る強さ */
    gain;
    /** 流れへ寄る速さ（1/秒） */
    drag;
    /** 重力（ドット/秒²） */
    grav;
    /** 流れへ乗り換える速さ（PF_FLOW_RAMP のとき） */
    flowIn;
    /** 0〜1 の位相（明滅をずらす） */
    phase;
    /** KIND_PIXEL / KIND_HD */
    kind;
    /** 階調の番号。MODE_SPRITE のときは始まりの色（パレットの番号） */
    rampId;
    /** MODE_* */
    mode;
    /** PF_* の組み合わせ */
    flags;
    /** HD の粒の色の組（TONE_*） */
    tone;
    /** 環境の粒の出どころの番号（技の粒は 255） */
    emitter;
    n = 0;
    na = 0;
    ambientScale = 1;
    rng;
    /** 流れ場の速度を受け取る場所（使い回す） */
    flow = new Float64Array(2);
    /** 生まれる点を受け取る場所（使い回す） */
    spawnPt = new Float32Array(2);
    // 環境の粒の出どころ（最初に MAX_EMITTERS ぶん確保）
    emSpec;
    emSpawn;
    emAcc;
    emAlive;
    emRamp;
    emTone;
    constructor(capacity = PARTICLE_CAPACITY, rng = fxRng) {
        this.capacity = Math.max(1, capacity | 0);
        const c = this.capacity;
        this.x = new Float32Array(c);
        this.y = new Float32Array(c);
        this.vx = new Float32Array(c);
        this.vy = new Float32Array(c);
        this.age = new Float32Array(c);
        this.life = new Float32Array(c);
        this.size = new Float32Array(c);
        this.gain = new Float32Array(c);
        this.drag = new Float32Array(c);
        this.grav = new Float32Array(c);
        this.flowIn = new Float32Array(c);
        this.phase = new Float32Array(c);
        this.kind = new Uint8Array(c);
        this.rampId = new Uint8Array(c);
        this.mode = new Uint8Array(c);
        this.flags = new Uint8Array(c);
        this.tone = new Uint8Array(c);
        this.emitter = new Uint8Array(c);
        this.rng = rng;
        this.emSpec = new Array(MAX_EMITTERS).fill(null);
        this.emSpawn = new Array(MAX_EMITTERS).fill(null);
        this.emAcc = new Float64Array(MAX_EMITTERS);
        this.emAlive = new Uint16Array(MAX_EMITTERS);
        this.emRamp = new Uint8Array(MAX_EMITTERS);
        this.emTone = new Uint8Array(MAX_EMITTERS);
    }
    /** 生きている粒の数 */
    get count() {
        return this.n;
    }
    /** そのうち環境の粒の数（添字 0〜ambientCount−1） */
    get ambientCount() {
        return this.na;
    }
    /** 全部消す（出どころは残す） */
    clear() {
        this.n = 0;
        this.na = 0;
        this.emAlive.fill(0);
    }
    // ------------------------------------------------------------------ 環境の粒
    /**
     * 画質に合わせて環境の粒の数と生まれる速さを絞る（高 1・中 0.55・低 0.25）。
     * 減らしたときは、多すぎる分が寿命で消えるのを待つ（一度に消すと目立つ）。
     */
    setAmbientScale(s) {
        this.ambientScale = s < 0 ? 0 : s;
    }
    /**
     * 環境の粒の出どころを足す。番号を返す（いっぱいなら -1）。
     * spec は階の間ずっと使うので、テーマの定数をそのまま渡す。
     */
    addAmbient(spec, spawn) {
        let e = -1;
        for (let i = 0; i < MAX_EMITTERS; i++) {
            if (this.emSpec[i] === null) {
                e = i;
                break;
            }
        }
        if (e < 0)
            return -1;
        this.emSpec[e] = spec;
        this.emSpawn[e] = spawn;
        this.emAcc[e] = 0;
        this.emAlive[e] = 0;
        if (spec.ramp) {
            const id = rampIdOf(spec.ramp);
            this.emRamp[e] = id;
            this.emTone[e] = spec.glow ? toneOfHex(spec.glow) : toneOfRamp(id);
        }
        else {
            this.emRamp[e] = RAMP_ID.gold;
            this.emTone[e] = spec.glow ? toneOfHex(spec.glow) : TONE_WHITE;
        }
        return e;
    }
    /** 出どころを 1 つ外し、その粒を消す */
    removeAmbient(e) {
        if (e < 0 || e >= MAX_EMITTERS || this.emSpec[e] === null)
            return;
        for (let i = this.na - 1; i >= 0; i--)
            if (this.emitter[i] === e)
                this.kill(i);
        this.emSpec[e] = null;
        this.emSpawn[e] = null;
        this.emAlive[e] = 0;
    }
    /** 出どころを全部外し、環境の粒を全部消す（階を移るとき） */
    clearAmbient() {
        const na = this.na;
        // 技の粒を前へ詰める（移し先は移し元より前なので、前から順に移せば壊れない）
        for (let j = na; j < this.n; j++)
            this.move(j, j - na);
        this.n -= na;
        this.na = 0;
        for (let e = 0; e < MAX_EMITTERS; e++) {
            this.emSpec[e] = null;
            this.emSpawn[e] = null;
            this.emAlive[e] = 0;
            this.emAcc[e] = 0;
        }
    }
    /**
     * 何秒か先まで回しておく（階に入った瞬間に塵が 1 つも無い、を避ける）。
     * 流れ場は進めない。
     */
    prewarm(field, seconds, windX = 0) {
        const h = 1 / 30;
        for (let t = 0; t < seconds; t += h)
            this.step(h, field, windX);
    }
    // ------------------------------------------------------------------ 技の粒
    /**
     * (ax, ay)（世界のドット）で粒を弾けさせる。(dx, dy) は飛ぶ向き（長さは問わない）。
     * 向きを省くと真上を中心に spread の幅で飛ぶ。生まれた数を返す。
     * 満杯なら環境の粒を追い出して入り、それでも入らない分は捨てる。
     */
    burst(spec, ax, ay, dx = 0, dy = 0) {
        const rng = this.rng;
        const rid = rampIdOf(spec.ramp);
        const tone = spec.tone ?? rampToneTable[rid];
        const base = dx === 0 && dy === 0 ? -Math.PI / 2 : Math.atan2(dy, dx);
        const radius = spec.radius ?? 0;
        const s0 = spec.speed[0];
        const s1 = spec.speed[1];
        const l0 = spec.life[0];
        const l1 = spec.life[1];
        const hd = spec.kind === KIND_HD;
        let fl = spec.emissive ? PF_EMISSIVE : PF_LIT;
        if (hd)
            fl |= PF_ADDITIVE;
        if (spec.flowRamp > 0)
            fl |= PF_FLOW_RAMP;
        let made = 0;
        for (let k = 0; k < spec.count; k++) {
            const i = this.allocVfx();
            if (i < 0)
                break;
            const ang = base + (rng.float() - 0.5) * spec.spread;
            const cs = Math.cos(ang);
            const sn = Math.sin(ang);
            const sp = s0 + (s1 - s0) * rng.float();
            // 位置のばらつきは飛ぶ向きへずらす（輪のように広がって見える）
            const r = radius * Math.sqrt(rng.float());
            this.x[i] = ax + cs * r;
            this.y[i] = ay + sn * r;
            this.vx[i] = cs * sp;
            this.vy[i] = sn * sp;
            this.age[i] = 0;
            const life = l0 + (l1 - l0) * rng.float();
            this.life[i] = life > MIN_LIFE ? life : MIN_LIFE;
            this.size[i] = spec.size;
            this.gain[i] = spec.gain;
            this.drag[i] = spec.drag;
            this.grav[i] = spec.gravity;
            this.flowIn[i] = spec.flowRamp;
            this.phase[i] = rng.float();
            this.kind[i] = spec.kind;
            this.rampId[i] = rid;
            this.mode[i] = MODE_AGE;
            this.flags[i] = fl;
            this.tone[i] = tone;
            this.emitter[i] = NO_EMITTER;
            made++;
        }
        return made;
    }
    /**
     * 絵を 1 ドットずつ粒にして崩す（倒れた敵）。(ax, ay) は絵の左上の世界座標（ドット）。
     * 透明でない画素 every 個に 1 つを粒にする。多すぎる絵は SPRITE_PARTICLE_MAX 個に収まるまで間引く。
     * 粒はその画素の色から始まり、同じ階調を暗い方へ下りながら昇って流れに乗る。生まれた数を返す。
     */
    fromSprite(buf, ax, ay, every = 2) {
        const { w, h, px } = buf;
        // 1 周目：数と重心
        let opaque = 0;
        let sx = 0;
        let sy = 0;
        for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
                if (px[yy * w + xx] === TRANSPARENT)
                    continue;
                opaque++;
                sx += xx;
                sy += yy;
            }
        }
        if (opaque === 0)
            return 0;
        const cx = sx / opaque;
        const cy = sy / opaque;
        const stride = Math.max(1, every | 0, Math.ceil(opaque / SPRITE_PARTICLE_MAX));
        const rng = this.rng;
        // 2 周目：間引いて粒にする
        let k = 0;
        let made = 0;
        for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
                const c = px[yy * w + xx];
                if (c === TRANSPARENT)
                    continue;
                if (k++ % stride !== 0)
                    continue;
                const i = this.allocVfx();
                if (i < 0)
                    return made;
                // 重心から外へ少し広がり、上へ昇る
                const ox = xx - cx;
                const oy = yy - cy;
                const len = Math.sqrt(ox * ox + oy * oy) || 1;
                const sp = 4 + 10 * rng.float();
                this.x[i] = ax + xx;
                this.y[i] = ay + yy;
                this.vx[i] = (ox / len) * sp + (rng.float() - 0.5) * 6;
                this.vy[i] = (oy / len) * sp * 0.5 - 6 - 8 * rng.float();
                this.age[i] = 0;
                // 上の方の画素ほど少し長く残る（下から崩れて、頭が最後に散る）
                this.life[i] = 0.55 + 0.7 * rng.float() + 0.35 * (1 - yy / h);
                this.size[i] = 1;
                this.gain[i] = 1.3;
                this.drag[i] = 2.5;
                this.grav[i] = -16;
                this.flowIn[i] = 1.5;
                this.phase[i] = rng.float();
                this.kind[i] = KIND_PIXEL;
                this.rampId[i] = c;
                this.mode[i] = MODE_SPRITE;
                this.flags[i] = PF_FLOW_RAMP | (EMISSIVE[c] ? PF_EMISSIVE : PF_LIT);
                this.tone[i] = TONE_WHITE;
                this.emitter[i] = NO_EMITTER;
                made++;
            }
        }
        return made;
    }
    // ------------------------------------------------------------------ 動き
    /**
     * dtSeconds 秒進める（ふつうは 1/60）。流れ場は呼ぶ側が先に tick しておく。
     * windX は全体に掛かる横風（ドット/秒）。割り当ては無い。
     */
    step(dtSeconds, field, windX = 0) {
        const h = dtSeconds;
        const { x, y, vx, vy, age, life, gain, drag, grav, flowIn, flags } = this;
        const f = this.flow;
        // 後ろから回す。消した粒の場所には、もう進めた粒（後ろの粒）が入る
        for (let i = this.n - 1; i >= 0; i--) {
            const a = age[i] + h;
            if (a >= life[i]) {
                this.kill(i);
                continue;
            }
            age[i] = a;
            let k = gain[i];
            if ((flags[i] & PF_FLOW_RAMP) !== 0) {
                const r = (a / life[i]) * flowIn[i];
                if (r < 1)
                    k *= r;
            }
            field.sample(x[i], y[i], f);
            const d = 1 - Math.exp(-drag[i] * h);
            const nvx = vx[i] + (f[0] * k + windX - vx[i]) * d;
            const nvy = vy[i] + (f[1] * k - vy[i]) * d + grav[i] * h;
            vx[i] = nvx;
            vy[i] = nvy;
            x[i] += nvx * h;
            y[i] += nvy * h;
        }
        this.emitAmbient(h, field);
    }
    // ------------------------------------------------------------------ 描く側が読むもの
    /**
     * 今の色（パレットの番号）。ドットの粒はこの色で 1 ドット描く。
     * HD の粒は色の組（tone）で描くので、ここはブルームの判定にだけ使う。
     */
    colorIndexOf(i) {
        const m = this.mode[i];
        if (m === MODE_SPRITE) {
            const c0 = this.rampId[i];
            const t = this.age[i] / this.life[i];
            const s0 = stepOf(c0);
            const drop = Math.floor(t * (s0 + 1));
            if (drop <= 0)
                return c0;
            const r = c0 === WHITE ? BONE : rampOf(c0);
            return ci(r, s0 - drop);
        }
        const ramp = rampTable[this.rampId[i]] ?? RAMP_DUST;
        return ramp[this.rampStepOf(i)];
    }
    /**
     * 階調の中の位置（0 = 最初の色）。MODE_AGE では年齢とともに増えるだけで戻らない。
     * MODE_SPRITE では暗くなった段の数。
     */
    rampStepOf(i) {
        const m = this.mode[i];
        const t = this.age[i] / this.life[i];
        if (m === MODE_SPRITE)
            return Math.floor(t * (stepOf(this.rampId[i]) + 1));
        const len = (rampTable[this.rampId[i]] ?? RAMP_DUST).length;
        const last = len - 1;
        if (m === MODE_AGE) {
            const s = Math.floor(t * len);
            return s > last ? last : s;
        }
        // 暗 → 明 → 暗：真ん中で 0（一番明るい）、両端で最後の段
        let b = 1 - Math.abs(2 * t - 1);
        if (m === MODE_BLINK)
            b *= this.blinkOf(i);
        const s = last - Math.floor(b * last + 0.5);
        return s < 0 ? 0 : s > last ? last : s;
    }
    /**
     * HD の粒の濃さ（0〜1）。技の粒は年齢で薄れ、環境の粒は現れて消える。
     * 蛍は明滅を掛ける。ドットの粒はいつも 1。
     */
    alphaOf(i) {
        if (this.kind[i] !== KIND_HD)
            return 1;
        const t = this.age[i] / this.life[i];
        let a;
        if ((this.flags[i] & PF_AMBIENT) !== 0) {
            const up = t * 5;
            const down = (1 - t) * 4;
            a = up < down ? up : down;
            if (a > 1)
                a = 1;
        }
        else {
            a = 1 - t;
        }
        if (this.mode[i] === MODE_BLINK)
            a *= 0.1 + 0.9 * this.blinkOf(i);
        return a < 0 ? 0 : a;
    }
    // ------------------------------------------------------------------ 中身
    /** 明滅の明るさ 0〜1。明るい時間を短く（蛍は光っている方が短い） */
    blinkOf(i) {
        const v = valueNoise1(this.age[i] * 2.2 + this.phase[i] * 97, 7);
        const b = (v - 0.35) / 0.65;
        return b <= 0 ? 0 : b * b;
    }
    /** 技の粒の場所を 1 つ取る。満杯なら環境の粒を 1 つ追い出す。取れなければ -1 */
    allocVfx() {
        if (this.n < this.capacity)
            return this.n++;
        if (this.na > 0) {
            // 環境の区画の最後の場所を、そのまま技の区画の先頭にする（移し替え無し）
            const e = --this.na;
            const em = this.emitter[e];
            if (em !== NO_EMITTER && this.emAlive[em] > 0)
                this.emAlive[em]--;
            return e;
        }
        return -1;
    }
    /** 環境の粒の場所を 1 つ取る。満杯なら -1（生まれない） */
    allocAmbient() {
        if (this.n >= this.capacity)
            return -1;
        // 技の区画の先頭を末尾へ移し、空いた所を環境の区画に足す
        if (this.n > this.na)
            this.move(this.na, this.n);
        this.n++;
        return this.na++;
    }
    /** i 番の粒を消し、区画を保ったまま詰める */
    kill(i) {
        const em = this.emitter[i];
        if (em !== NO_EMITTER && this.emAlive[em] > 0)
            this.emAlive[em]--;
        const last = this.n - 1;
        if (i < this.na) {
            const lastA = this.na - 1;
            if (i !== lastA)
                this.move(lastA, i);
            if (last !== lastA)
                this.move(last, lastA);
            this.na--;
        }
        else if (i !== last) {
            this.move(last, i);
        }
        this.n--;
    }
    /** 粒を移す（全部の項目を写す） */
    move(from, to) {
        this.x[to] = this.x[from];
        this.y[to] = this.y[from];
        this.vx[to] = this.vx[from];
        this.vy[to] = this.vy[from];
        this.age[to] = this.age[from];
        this.life[to] = this.life[from];
        this.size[to] = this.size[from];
        this.gain[to] = this.gain[from];
        this.drag[to] = this.drag[from];
        this.grav[to] = this.grav[from];
        this.flowIn[to] = this.flowIn[from];
        this.phase[to] = this.phase[from];
        this.kind[to] = this.kind[from];
        this.rampId[to] = this.rampId[from];
        this.mode[to] = this.mode[from];
        this.flags[to] = this.flags[from];
        this.tone[to] = this.tone[from];
        this.emitter[to] = this.emitter[from];
    }
    /** 環境の粒を生む（出どころごとに、1 秒あたりの数 × 経った時間ぶん） */
    emitAmbient(h, field) {
        const scale = this.ambientScale;
        for (let e = 0; e < MAX_EMITTERS; e++) {
            const spec = this.emSpec[e];
            if (spec === null)
                continue;
            const cap = Math.floor(spec.cap * scale);
            let acc = this.emAcc[e] + spec.rate * scale * h;
            while (acc >= 1) {
                acc -= 1;
                if (this.emAlive[e] >= cap)
                    continue;
                if (!this.spawnAmbient(e, spec, field))
                    break;
            }
            // 満杯や場所が無くて生まれなかった分は持ち越さない（空いた瞬間にまとめて湧かないように）
            this.emAcc[e] = acc >= 1 ? 0 : acc;
        }
    }
    spawnAmbient(e, spec, field) {
        const spawn = this.emSpawn[e];
        if (spawn === null)
            return false;
        const pt = this.spawnPt;
        const rng = this.rng;
        if (!spawn(spec.region, pt, rng))
            return true;
        const i = this.allocAmbient();
        if (i < 0)
            return false;
        const hd = spec.ramp === null;
        const px = pt[0];
        const py = pt[1];
        // 生まれたときから流れの速さで動く（止まった所から急に動き出さないように）
        const f = this.flow;
        field.sample(px, py, f);
        this.x[i] = px;
        this.y[i] = py;
        this.vx[i] = f[0] * spec.flow;
        this.vy[i] = f[1] * spec.flow;
        this.age[i] = 0;
        const life = spec.life[0] + (spec.life[1] - spec.life[0]) * rng.float();
        this.life[i] = life > MIN_LIFE ? life : MIN_LIFE;
        this.size[i] = spec.size;
        this.gain[i] = spec.flow;
        this.drag[i] = AMBIENT_DRAG;
        this.grav[i] = spec.gravity;
        this.flowIn[i] = 0;
        this.phase[i] = rng.float();
        this.kind[i] = hd ? KIND_HD : KIND_PIXEL;
        this.rampId[i] = this.emRamp[e];
        this.mode[i] = spec.blink ? MODE_BLINK : hd ? MODE_AGE : MODE_SWELL;
        this.flags[i] = PF_AMBIENT | (spec.emissive ? PF_EMISSIVE : PF_LIT) | (hd ? PF_ADDITIVE : 0);
        this.tone[i] = this.emTone[e];
        this.emitter[i] = e;
        this.emAlive[e]++;
        return true;
    }
}
//# sourceMappingURL=particles.js.map