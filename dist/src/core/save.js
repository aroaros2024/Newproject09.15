/**
 * セーブとロード（localStorage）。
 *
 * 村のデータは永続、冒険は「中断」1 つだけ。
 * 壊れたデータを読んでゲームが起動しなくなるのが最悪なので、
 * 読み込みは必ず検証してから返し、駄目なら既定値に落とす。
 */
import { SAVE_VERSION } from './types.js';
import { sanitizeTally } from '../game/counters.js';
import { tryGetPrize } from '../data/gacha.js';
import { CHARM_BOX_LIMIT, CHARM_MAX_SLOTS, charmRuneRule } from '../data/charms.js';
import { tryGetPartner } from '../data/partners.js';
import { partnerLevelCap } from '../game/partner.js';
const PREFIX = 'fushigi-dungeon';
const KEY_TOWN = `${PREFIX}:town`;
const KEY_RUN = `${PREFIX}:run`;
const KEY_SETTINGS = `${PREFIX}:settings`;
/**
 * プレイログの記録。
 *
 * 中断セーブ（KEY_RUN）とは別にしてある。中断データは「遊びを続けるための物」で、
 * 記録は「あとで再現するための物」。混ぜると中断データが肥大し、
 * syncForSave の役割もぼやける。
 */
const KEY_REPLAY = `${PREFIX}:replay`;
export const DEFAULT_SETTINGS = {
    messageSpeed: 1,
    animSpeed: 1,
    diagonalFree: true,
    dashStopAtCorner: true,
    confirmUnknown: false,
    confirmStairs: true,
    masterVolume: 0.7,
    sfxVolume: 0.8,
    bgmVolume: 0.45,
    muted: false,
    colorAssist: false,
    reduceMotion: false,
};
export function defaultTown(playerName = 'ナギ') {
    return {
        playerName,
        storage: [],
        bankGitan: 0,
        gitan: 0,
        cleared: [],
        unlocked: ['d1'],
        bestDepth: {},
        seenItems: {},
        knownItems: {},
        nicknames: {},
        stones: 0,
        tally: {},
        claimed: [],
        gachaOwned: {},
        gachaPulls: 0,
        partners: {},
        activePartner: null,
        charms: [],
        activeCharm: null,
        seenMonsters: {},
        history: [],
        totalRuns: 0,
        nextUid: 1,
    };
}
/** localStorage が使えるか（プライベートモードでは投げることがある） */
function storage() {
    try {
        const s = window.localStorage;
        const probe = `${PREFIX}:probe`;
        s.setItem(probe, '1');
        s.removeItem(probe);
        return s;
    }
    catch {
        return null;
    }
}
function write(key, data) {
    const s = storage();
    if (!s)
        return false;
    try {
        const env = { version: SAVE_VERSION, savedAt: Date.now(), data };
        s.setItem(key, JSON.stringify(env));
        return true;
    }
    catch {
        // 容量超過など。保存できなくてもゲームは続けられる
        return false;
    }
}
function read(key) {
    const s = storage();
    if (!s)
        return null;
    try {
        const raw = s.getItem(key);
        if (!raw)
            return null;
        const env = JSON.parse(raw);
        if (!env || typeof env !== 'object')
            return null;
        if (env.version !== SAVE_VERSION) {
            // 版が違うデータは読まない（壊れた状態で遊ばせない）
            return null;
        }
        return env.data ?? null;
    }
    catch {
        return null;
    }
}
function remove(key) {
    const s = storage();
    if (!s)
        return;
    try {
        s.removeItem(key);
    }
    catch {
        // 消せなくても致命的ではない
    }
}
// ---------------------------------------------------------------------------
// 村
// ---------------------------------------------------------------------------
export const saveTown = (town) => write(KEY_TOWN, town);
export function loadTown() {
    const data = read(KEY_TOWN);
    if (!data)
        return defaultTown();
    return validateTown(data);
}
/** 欠けている項目を既定値で埋める。壊れていたら既定の村に落とす */
function validateTown(t) {
    const base = defaultTown();
    if (typeof t !== 'object' || t === null)
        return base;
    const out = {
        playerName: typeof t.playerName === 'string' && t.playerName.length > 0
            ? t.playerName.slice(0, 12) : base.playerName,
        storage: Array.isArray(t.storage) ? t.storage : [],
        bankGitan: Number.isFinite(t.bankGitan) ? Math.max(0, Math.floor(t.bankGitan)) : 0,
        gitan: Number.isFinite(t.gitan) ? Math.max(0, Math.floor(t.gitan)) : 0,
        cleared: Array.isArray(t.cleared) ? t.cleared.filter((x) => typeof x === 'string') : [],
        unlocked: Array.isArray(t.unlocked) && t.unlocked.length > 0
            ? t.unlocked.filter((x) => typeof x === 'string') : ['d1'],
        bestDepth: typeof t.bestDepth === 'object' && t.bestDepth ? t.bestDepth : {},
        seenItems: typeof t.seenItems === 'object' && t.seenItems ? t.seenItems : {},
        knownItems: typeof t.knownItems === 'object' && t.knownItems ? t.knownItems : {},
        nicknames: typeof t.nicknames === 'object' && t.nicknames ? t.nicknames : {},
        stones: Number.isFinite(t.stones) ? Math.max(0, Math.floor(t.stones)) : 0,
        tally: sanitizeTally(t.tally),
        claimed: Array.isArray(t.claimed) ? t.claimed.filter((x) => typeof x === 'string') : [],
        gachaOwned: sanitizeOwned(t.gachaOwned),
        gachaPulls: Number.isFinite(t.gachaPulls)
            ? Math.max(0, Math.floor(t.gachaPulls)) : 0,
        partners: sanitizePartners(t.partners),
        activePartner: typeof t.activePartner === 'string' ? t.activePartner : null,
        charms: sanitizeCharms(t.charms),
        activeCharm: Number.isFinite(t.activeCharm) ? Math.floor(t.activeCharm) : null,
        seenMonsters: typeof t.seenMonsters === 'object' && t.seenMonsters ? t.seenMonsters : {},
        history: Array.isArray(t.history) ? t.history.slice(-50) : [],
        totalRuns: Number.isFinite(t.totalRuns) ? Math.max(0, Math.floor(t.totalRuns)) : 0,
        nextUid: Number.isFinite(t.nextUid) ? Math.max(1, Math.floor(t.nextUid)) : 1,
    };
    if (!out.unlocked.includes('d1'))
        out.unlocked.push('d1');
    // 持っていない護石を指していたら外す
    if (!(out.charms ?? []).some((c) => c.uid === out.activeCharm))
        out.activeCharm = null;
    renumberStorage(out);
    return out;
}
/**
 * 護石。実在しない印と壊れた値を捨てる。
 *
 * 護石は表から引くのではなく生成物なので、id で実在を確かめられない。
 * 中身（印・レベル・空きスロット）を 1 つずつ見て組み直す。
 * ここが緩いと、セーブを書き換えるだけで上限を超えた印を着けられてしまう。
 */
function sanitizeCharms(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    const usedUid = new Set();
    for (const v of raw.slice(0, CHARM_BOX_LIMIT)) {
        if (typeof v !== 'object' || v === null)
            continue;
        const c = v;
        if (!Number.isFinite(c.uid) || !Array.isArray(c.runes))
            continue;
        const uid = Math.max(1, Math.floor(c.uid));
        if (usedUid.has(uid))
            continue;
        // 印は「護石に乗る物」「護石での上限レベル」の両方で切り詰める
        const level = new Map();
        for (const r of c.runes) {
            if (typeof r !== 'string')
                continue;
            const rule = charmRuneRule(r);
            if (!rule)
                continue;
            const n = (level.get(r) ?? 0) + 1;
            if (n > rule.maxLevel)
                continue;
            level.set(r, n);
        }
        const runes = [];
        for (const [id, n] of level)
            for (let i = 0; i < n; i++)
                runes.push(id);
        if (runes.length === 0)
            continue;
        usedUid.add(uid);
        out.push({
            uid,
            runes,
            slots: Number.isFinite(c.slots)
                ? Math.max(0, Math.min(CHARM_MAX_SLOTS, Math.floor(c.slots))) : 0,
        });
    }
    return out;
}
/**
 * ガチャの所持枚数。実在しない景品と壊れた値を捨てる。
 *
 * 加護の効き目はここから計算するので、ここが壊れていると
 * 保持枠が 0 になったり、無限に増えたりする。
 */
function sanitizeOwned(raw) {
    const out = {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return out;
    for (const [k, v] of Object.entries(raw)) {
        if (!tryGetPrize(k))
            continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
            continue;
        out[k] = Math.min(OWNED_CAP, Math.floor(v));
    }
    return out;
}
/** 1 つの景品を何枚まで数えるか。壊れたセーブの無限大よけ */
const OWNED_CAP = 9999;
/** 相棒の記録。実在しない相棒と壊れた値を捨てる */
function sanitizePartners(raw) {
    const out = {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return out;
    for (const [k, v] of Object.entries(raw)) {
        if (!tryGetPartner(k))
            continue;
        if (typeof v !== 'object' || v === null)
            continue;
        const r = v;
        // 古いセーブの dupes（絆）は読まない。相棒は 1 体 1 回になり、
        // レベルの上限は最初から最大になった
        const rec = {
            id: k,
            level: 1,
            exp: Number.isFinite(r.exp) ? Math.max(0, Math.floor(r.exp)) : 0,
        };
        const level = Number.isFinite(r.level) ? Math.floor(r.level) : 1;
        rec.level = Math.max(1, Math.min(partnerLevelCap(), level));
        if (typeof r.nickname === 'string' && r.nickname.length > 0) {
            rec.nickname = r.nickname.slice(0, 8);
        }
        out[k] = rec;
    }
    return out;
}
/**
 * 倉庫の uid を 1 から振り直す。
 *
 * 倉庫の操作（売る・鍛える・持っていく）は uid の先頭一致で対象を探すので、
 * 重複があると別の道具に作用してしまう。以前のセーブには
 * 冒険側の uid がそのまま混ざっているものがあるため、読み込み時に均す。
 */
function renumberStorage(town) {
    let next = 1;
    for (const item of town.storage) {
        if (!item || typeof item !== 'object')
            continue;
        item.uid = next++;
        if (Array.isArray(item.contents)) {
            for (const c of item.contents)
                c.uid = next++;
        }
    }
    town.nextUid = Math.max(next, town.nextUid);
}
// ---------------------------------------------------------------------------
// 冒険の中断
// ---------------------------------------------------------------------------
export const saveRun = (run) => write(KEY_RUN, run);
export function loadRun() {
    const data = read(KEY_RUN);
    if (!data)
        return null;
    // 最低限の形だけ確かめる。細かい検証は復元側に任せる
    if (typeof data.dungeonId !== 'string')
        return null;
    if (!data.map || !Array.isArray(data.map.tiles))
        return null;
    if (!data.player || typeof data.player.hp !== 'number')
        return null;
    if (data.map.tiles.length !== data.map.width * data.map.height)
        return null;
    // 決着（死亡・クリア）は World 側の finished が持っていて RunState には載らない。
    // 倒れた状態の中断データをそのまま読むと、生き返って冒険が続いてしまう
    if (data.player.hp <= 0 || data.player.alive === false)
        return null;
    // 古い中断データには無い項目を埋める（loadRun は検証しかしないので、ここだけ）
    data.tally = sanitizeTally(data.tally);
    data.pendingRejoin ??= [];
    // 相棒の記録が壊れていたら、連れていないことにする（冒険は続けられる）
    const rp = data.partner;
    if (rp && (!tryGetPartner(rp.id ?? '')
        || !Number.isFinite(rp.actorId) || !Number.isFinite(rp.level))) {
        delete data.partner;
    }
    else if (rp) {
        rp.exp = Number.isFinite(rp.exp) ? Math.max(0, Math.floor(rp.exp)) : 0;
    }
    return data;
}
export const hasRun = () => loadRun() !== null;
export const clearRun = () => remove(KEY_RUN);
// ---------------------------------------------------------------------------
// プレイログ
// ---------------------------------------------------------------------------
export const saveReplay = (replay) => write(KEY_REPLAY, replay);
/**
 * 記録を読み戻す。形が合わなければ null。
 *
 * 中身の細かい検証はしない。ここが厳しすぎると、
 * 「不具合を報告するための記録」が不具合のせいで読めなくなる。
 */
export function loadReplay() {
    const data = read(KEY_REPLAY);
    if (!data)
        return null;
    if (data.version !== 1)
        return null;
    if (typeof data.dungeonId !== 'string' || !Number.isFinite(data.seed))
        return null;
    if (!Array.isArray(data.actions) || !Array.isArray(data.lines))
        return null;
    if (typeof data.town !== 'object' || data.town === null)
        return null;
    return data;
}
export const clearReplay = () => remove(KEY_REPLAY);
// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
export const saveSettings = (s) => write(KEY_SETTINGS, s);
export function loadSettings() {
    const data = read(KEY_SETTINGS);
    if (!data)
        return { ...DEFAULT_SETTINGS };
    const out = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        const v = data[key];
        if (typeof v === typeof DEFAULT_SETTINGS[key]) {
            out[key] = v;
        }
    }
    out.masterVolume = clamp01(out.masterVolume);
    out.sfxVolume = clamp01(out.sfxVolume);
    out.bgmVolume = clamp01(out.bgmVolume);
    out.messageSpeed = Math.max(0, Math.min(2, Math.floor(out.messageSpeed)));
    out.animSpeed = Math.max(0, Math.min(2, Math.floor(out.animSpeed)));
    return out;
}
const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);
/** すべて消す（「はじめから」） */
export function clearAll() {
    remove(KEY_TOWN);
    remove(KEY_RUN);
    remove(KEY_SETTINGS);
    remove(KEY_REPLAY);
}
/** 書き出し（デバッグ・バックアップ用） */
export function exportSave() {
    return JSON.stringify({
        version: SAVE_VERSION,
        town: read(KEY_TOWN),
        run: read(KEY_RUN),
        settings: read(KEY_SETTINGS),
    });
}
/** 読み込み（バックアップからの復元） */
export function importSave(json) {
    try {
        const parsed = JSON.parse(json);
        if (parsed.version !== SAVE_VERSION)
            return false;
        if (parsed.town)
            write(KEY_TOWN, validateTown(parsed.town));
        if (parsed.run)
            write(KEY_RUN, parsed.run);
        if (parsed.settings)
            write(KEY_SETTINGS, parsed.settings);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=save.js.map