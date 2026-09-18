/**
 * プレイログの文字列。
 *
 * 貼り付けた人が上から順に読めて、下半分を道具に食わせれば
 * 同じ冒険がそのまま再生できる、という 1 枚のテキストにする。
 *
 *   # 見出し（いつ・どこ・どうなったか）
 *   --- できごと ---   ターン番号と階の付いた行
 *   --- 再現データ --- 1 行の文字列
 *
 * 書き出しと読み戻しは**必ずこのファイルの中で隣り合わせに置く**。
 * 離すと片方だけ直されて、静かに壊れる。
 */
import { decodeActions, encodeActions } from './recorder.js';
/** 再現データの先頭に付ける印。z が付いていれば gzip 済み */
const TAG_RAW = 'r1:';
const TAG_GZIP = 'r1z:';
/** できごとの色。番号で書き出すので順番を変えないこと */
const STYLES = [
    'normal', 'good', 'bad', 'critical', 'item', 'system', 'warning',
];
/** 見出しのあとに出すできごとの行数。全部出すと貼り付けられない長さになる */
export const HEAD_LINES = 200;
// ---------------------------------------------------------------------------
// base64（ブラウザと node のどちらでも動く）
// ---------------------------------------------------------------------------
function bytesToBase64(bytes) {
    let bin = '';
    // 引数を一度に渡すと、長い配列で呼び出し上限に当たる
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}
function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** gzip が使えるか。使えなければ生のまま出す */
async function gzip(bytes) {
    const C = globalThis.CompressionStream;
    if (!C)
        return null;
    try {
        const stream = new Blob([bytes]).stream()
            .pipeThrough(new C('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    catch {
        return null;
    }
}
async function gunzip(bytes) {
    const D = globalThis.DecompressionStream;
    if (!D)
        return null;
    try {
        const stream = new Blob([bytes]).stream()
            .pipeThrough(new D('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    catch {
        return null;
    }
}
const encodeLines = (lines) => lines
    .map((l) => `${l.turn}|${l.depth}|${Math.max(0, STYLES.indexOf(l.style))}|${l.text}`)
    .join('\n');
function decodeLines(s) {
    if (s.length === 0)
        return [];
    return s.split('\n').map((row) => {
        const [turn, depth, style, ...rest] = row.split('|');
        return {
            turn: Number(turn) || 0,
            depth: Number(depth) || 0,
            style: STYLES[Number(style)] ?? 'normal',
            text: rest.join('|'),
        };
    });
}
/** 再現データ 1 行を作る。gzip が使えれば縮める */
export async function encodeReplay(replay) {
    const payload = {
        v: 1,
        d: replay.dungeonId,
        s: replay.seed,
        t: replay.town,
        b: replay.bring,
        a: encodeActions(replay.actions),
        l: encodeLines(replay.lines),
    };
    if (replay.truncated)
        payload.x = 1;
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const packed = await gzip(raw);
    return packed
        ? TAG_GZIP + bytesToBase64(packed)
        : TAG_RAW + bytesToBase64(raw);
}
/** 再現データ 1 行を読み戻す。読めなければ null */
export async function decodeReplay(text) {
    const line = text.trim();
    const zipped = line.startsWith(TAG_GZIP);
    if (!zipped && !line.startsWith(TAG_RAW))
        return null;
    try {
        const body = base64ToBytes(line.slice(zipped ? TAG_GZIP.length : TAG_RAW.length));
        const bytes = zipped ? await gunzip(body) : body;
        if (!bytes)
            return null;
        const p = JSON.parse(new TextDecoder().decode(bytes));
        if (p.v !== 1)
            return null;
        return {
            version: 1,
            dungeonId: p.d,
            seed: p.s,
            town: p.t,
            bring: Array.isArray(p.b) ? p.b : [],
            actions: decodeActions(p.a),
            lines: decodeLines(p.l),
            truncated: p.x === 1,
        };
    }
    catch {
        return null;
    }
}
const two = (n) => `${n}`.padStart(2, '0');
function stamp(at) {
    if (!at)
        return '';
    const d = new Date(at);
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} `
        + `${two(d.getHours())}:${two(d.getMinutes())}`;
}
/**
 * 貼り付ける 1 枚を作る。
 *
 * 上半分は読むためのもの、下半分は再生するためのもの。
 * できごとは末尾 HEAD_LINES 行だけ出す（全部は再現データの中に入っている）。
 */
export async function buildPlayLog(replay, head) {
    const p = head.player;
    const out = [];
    out.push('# 風の村と天輪の塔 プレイログ');
    const when = stamp(head.at);
    out.push([
        '形式 1',
        when,
        `${head.dungeonName} ${head.depth}F`,
        `${head.turn} ターン`,
    ].filter((s) => s.length > 0).join(' / '));
    if (p) {
        out.push(`HP ${p.hp}/${p.maxHp}　Lv ${p.level}　ちから ${p.str}/${p.maxStr}`
            + `　満腹 ${Math.floor(p.foodX10 / 10)}/${Math.floor(p.maxFoodX10 / 10)}`
            + `　ギタン ${p.gitan}`);
    }
    out.push(`終わり方: ${head.ending ?? '冒険の 途中'}`);
    out.push(`行動 ${replay.actions.length} 手　できごと ${replay.lines.length} 行`
        + (replay.truncated ? '　※ 長すぎたので途中で記録をやめている（再現はできません）' : ''));
    const shown = replay.lines.slice(-HEAD_LINES);
    out.push('');
    out.push(`--- できごと（末尾 ${shown.length} 行）---`);
    for (const l of shown)
        out.push(`[${l.turn}] ${l.depth}F  ${l.text}`);
    out.push('');
    out.push('--- 再現データ ---');
    out.push(await encodeReplay(replay));
    return out.join('\n');
}
/** 貼り付けた 1 枚から再現データだけを取り出す */
export async function parsePlayLog(text) {
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (t.startsWith(TAG_RAW) || t.startsWith(TAG_GZIP))
            return decodeReplay(t);
    }
    return null;
}
//# sourceMappingURL=playlog.js.map