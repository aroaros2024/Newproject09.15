/**
 * ミッション用のカウンタ。
 *
 * 数え方をここ 1 箇所に集める。呼ぶ側が自分で `tally[k] = (tally[k] ?? 0) + 1`
 * と書き始めると、必ずどこかで数え方が食い違う。
 *
 * キーはセーブに載る。配布後に改名すると全員の進捗が 0 に戻るので、
 * 一度決めた文字列は変えないこと。
 */
/** 最大値キーの接頭辞。合流のときにここで足し算と最大値を分ける */
export const MAX_PREFIX = 'max:';
/** 1 つのキーの上限。壊れたセーブで無限大が入ると全ミッションが一斉に達成になる */
export const TALLY_CAP = 1_000_000_000;
/**
 * 数える。
 *
 * `kill:ratField` のように「:」を含むキーを足すと、接頭辞の `kill` も自動で足る。
 * 呼ぶ側が総数と内訳の 2 行を並べて書かなくてよくなるので、
 * 片方だけ書き忘れる形が無くなる。
 */
export function addTally(store, key, n = 1) {
    if (!Number.isFinite(n) || n <= 0)
        return;
    // 最大値キーは足してはいけない。型で防いであるが、
    // セーブ由来の文字列がここに来る道が将来できたときの保険
    if (key.startsWith(MAX_PREFIX))
        return;
    const amount = Math.floor(n);
    const add = (k) => {
        store[k] = Math.min(TALLY_CAP, (store[k] ?? 0) + amount);
    };
    add(key);
    const i = key.indexOf(':');
    if (i > 0)
        add(key.slice(0, i));
}
/** 読む。壊れた値が入っていても 0 として扱う */
export function counted(tally, key) {
    const v = tally?.[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
/**
 * セーブから読んだ数えを直す。
 *
 * 配列・文字列・負の数・無限大が入っていても、ここで無害な形にする。
 * 直さないと「数えるたびに文字列が連結されて永久に達成しない」
 * 「無限大が入っていて全部達成済みになる」といった壊れ方をする。
 */
export function sanitizeTally(raw) {
    const out = {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return out;
    for (const [k, v] of Object.entries(raw)) {
        if (typeof k !== 'string' || k.length === 0)
            continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
            continue;
        out[k] = Math.min(TALLY_CAP, Math.floor(v));
    }
    return out;
}
/** 最大値で覚える。足さずに、これまでの最大とくらべて大きい方を残す */
export function maxTally(store, key, value) {
    if (!Number.isFinite(value) || value <= 0)
        return;
    const k = MAX_PREFIX + key;
    const v = Math.min(TALLY_CAP, Math.floor(value));
    if (v > (store[k] ?? 0))
        store[k] = v;
}
/**
 * 冒険ぶんの数えを村へ移す。
 *
 * `max:` だけは最大値、それ以外は加算。ここを 1 箇所にしておかないと、
 * 合流の分岐を書き忘れてレベル到達が勝手に達成される。
 *
 * 接頭辞の集計（`kill` と `kill:xxx`）は src 側に既に両方入っているので、
 * ここでは addTally を使わず素直に足すこと。二重に集計される。
 */
export function mergeTally(dst, src) {
    for (const [k, v] of Object.entries(src)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
            continue;
        dst[k] = k.startsWith(MAX_PREFIX)
            ? Math.max(dst[k] ?? 0, Math.min(TALLY_CAP, Math.floor(v)))
            : Math.min(TALLY_CAP, (dst[k] ?? 0) + Math.floor(v));
    }
}
//# sourceMappingURL=counters.js.map