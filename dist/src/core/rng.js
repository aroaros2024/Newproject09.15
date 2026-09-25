/**
 * シード付き擬似乱数生成器（xorshift128）
 *
 * ダンジョン生成・アイテム抽選・戦闘乱数のすべてをここに集約する。
 * `Math.random()` はゲームロジックから一切呼ばないこと（再現性が壊れるため）。
 *
 * - 同じ seed からは必ず同じ系列が出る
 * - `derive()` でフロア毎／用途毎の独立した子 RNG を作れる
 * - `serialize()` / `restore()` で中断セーブに状態を載せられる
 */
/** 32bit 符号なしに丸める */
const u32 = (n) => n >>> 0;
/**
 * 文字列・数値から 32bit のシード値を作る（FNV-1a 32bit）。
 * 0 は xorshift の不動点なので避ける。
 */
export function hashSeed(input) {
    const s = typeof input === 'number' ? String(input) : input;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        // h *= 16777619 を 32bit で
        h = u32(h + u32((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)));
    }
    return h === 0 ? 0x9e3779b9 : u32(h);
}
export class Rng {
    x;
    y;
    z;
    w;
    constructor(seed = 0x12345678) {
        const s = typeof seed === 'string' ? hashSeed(seed) : u32(seed) || 0x9e3779b9;
        // splitmix 風に 4 ワードへ展開して初期状態の偏りを消す
        this.x = u32(s ^ 0x9e3779b9);
        this.y = u32(Math.imul(s, 0x85ebca6b) ^ 0x243f6a88);
        this.z = u32(Math.imul(s, 0xc2b2ae35) ^ 0xb7e15162);
        this.w = u32(Math.imul(s ^ (s >>> 16), 0x27d4eb2f) ^ 0x1f83d9ab);
        if ((this.x | this.y | this.z | this.w) === 0)
            this.w = 0x9e3779b9;
        // 初期の相関を捨てる
        for (let i = 0; i < 16; i++)
            this.next();
    }
    /** 次の 32bit 符号なし整数 */
    next() {
        const t = u32(this.x ^ (this.x << 11));
        this.x = this.y;
        this.y = this.z;
        this.z = this.w;
        this.w = u32(this.w ^ (this.w >>> 19) ^ t ^ (t >>> 8));
        return this.w;
    }
    /** [0, 1) の浮動小数 */
    float() {
        return this.next() / 4294967296;
    }
    /** [0, n) の整数。n <= 0 のときは 0 */
    int(n) {
        if (n <= 0)
            return 0;
        return Math.floor(this.float() * n);
    }
    /** [min, max] の整数（両端を含む） */
    range(min, max) {
        if (max < min)
            [min, max] = [max, min];
        return min + this.int(max - min + 1);
    }
    /** 確率 p (0.0〜1.0) で true */
    chance(p) {
        return this.float() < p;
    }
    /** 確率 n/d で true（整数で書きたいとき用） */
    oneIn(n) {
        return n <= 1 ? true : this.int(n) === 0;
    }
    /** 百分率で true（percent = 0〜100） */
    percent(percent) {
        if (percent <= 0)
            return false;
        if (percent >= 100)
            return true;
        return this.float() * 100 < percent;
    }
    /** 配列からひとつ選ぶ。空配列は undefined */
    pick(arr) {
        return arr[this.int(arr.length)];
    }
    /** 重み付き抽選。weights[i] は非負。合計 0 なら 0 を返す */
    weightedIndex(weights) {
        let total = 0;
        for (const w of weights)
            total += w > 0 ? w : 0;
        if (total <= 0)
            return 0;
        let r = this.float() * total;
        for (let i = 0; i < weights.length; i++) {
            const w = weights[i] > 0 ? weights[i] : 0;
            r -= w;
            if (r < 0)
                return i;
        }
        return weights.length - 1;
    }
    /** 重み付きでオブジェクトを選ぶ */
    weightedPick(entries, weightOf) {
        if (entries.length === 0)
            return undefined;
        const idx = this.weightedIndex(entries.map(weightOf));
        return entries[idx];
    }
    /** Fisher-Yates。元配列を破壊的にシャッフルして返す */
    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            const t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
        return arr;
    }
    /** 非破壊シャッフル */
    shuffled(arr) {
        return this.shuffle(arr.slice());
    }
    /** 重複なしで n 個取り出す */
    sample(arr, n) {
        if (n >= arr.length)
            return this.shuffled(arr);
        return this.shuffled(arr).slice(0, n);
    }
    /**
     * 子 RNG を作る。tag が同じなら常に同じ子が得られる。
     * フロア生成は `rng.derive('floor:' + dungeonId + ':' + depth)` のように使う。
     */
    derive(tag) {
        const base = typeof tag === 'number' ? tag : hashSeed(tag);
        return new Rng(u32(this.next() ^ base));
    }
    /** 現在の内部状態（セーブ用） */
    serialize() {
        return { x: this.x, y: this.y, z: this.z, w: this.w };
    }
    /** 内部状態を復元（ロード用） */
    restore(s) {
        this.x = u32(s.x);
        this.y = u32(s.y);
        this.z = u32(s.z);
        this.w = u32(s.w);
        if ((this.x | this.y | this.z | this.w) === 0)
            this.w = 0x9e3779b9;
    }
    /** 状態ごと複製する（先読みシミュレーション用） */
    clone() {
        const r = new Rng(1);
        r.restore(this.serialize());
        return r;
    }
    static fromState(s) {
        const r = new Rng(1);
        r.restore(s);
        return r;
    }
}
/**
 * 演出・UI 専用の乱数。ゲームの乱数（world.rng）とは別の実体。
 *
 * ゲームロジックには絶対に使わないこと（リプレイの再現性が壊れる）。
 * 逆に演出がゲームの乱数を読むと、画面の設定で結果が変わってしまう。
 * 種を固定しているのは、検証用の場面を撮り直したときに同じ絵にするため。
 */
export const fxRng = new Rng('fx');
/** 演出・UI 用の 0 以上 1 未満 */
export const fxRandom = () => fxRng.float();
//# sourceMappingURL=rng.js.map