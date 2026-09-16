/**
 * セーブとロード（localStorage）。
 *
 * 村のデータは永続、冒険は「中断」1 つだけ。
 * 壊れたデータを読んでゲームが起動しなくなるのが最悪なので、
 * 読み込みは必ず検証してから返し、駄目なら既定値に落とす。
 */

import type { RunState, Settings, TownState } from './types.js';
import { SAVE_VERSION } from './types.js';

const PREFIX = 'fushigi-dungeon';
const KEY_TOWN = `${PREFIX}:town`;
const KEY_RUN = `${PREFIX}:run`;
const KEY_SETTINGS = `${PREFIX}:settings`;

export const DEFAULT_SETTINGS: Settings = {
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

export function defaultTown(playerName = 'ナギ'): TownState {
  return {
    playerName,
    storage: [],
    bankGitan: 0,
    gitan: 0,
    cleared: [],
    unlocked: ['d1'],
    bestDepth: {},
    seenItems: {},
    seenMonsters: {},
    history: [],
    totalRuns: 0,
    nextUid: 1,
  };
}

/** localStorage が使えるか（プライベートモードでは投げることがある） */
function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = `${PREFIX}:probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

interface Envelope<T> {
  version: number;
  savedAt: number;
  data: T;
}

function write<T>(key: string, data: T): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const env: Envelope<T> = { version: SAVE_VERSION, savedAt: Date.now(), data };
    s.setItem(key, JSON.stringify(env));
    return true;
  } catch {
    // 容量超過など。保存できなくてもゲームは続けられる
    return false;
  }
}

function read<T>(key: string): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env !== 'object') return null;
    if (env.version !== SAVE_VERSION) {
      // 版が違うデータは読まない（壊れた状態で遊ばせない）
      return null;
    }
    return env.data ?? null;
  } catch {
    return null;
  }
}

function remove(key: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // 消せなくても致命的ではない
  }
}

// ---------------------------------------------------------------------------
// 村
// ---------------------------------------------------------------------------

export const saveTown = (town: TownState): boolean => write(KEY_TOWN, town);

export function loadTown(): TownState {
  const data = read<TownState>(KEY_TOWN);
  if (!data) return defaultTown();
  return validateTown(data);
}

/** 欠けている項目を既定値で埋める。壊れていたら既定の村に落とす */
function validateTown(t: Partial<TownState>): TownState {
  const base = defaultTown();
  if (typeof t !== 'object' || t === null) return base;
  const out: TownState = {
    playerName: typeof t.playerName === 'string' && t.playerName.length > 0
      ? t.playerName.slice(0, 12) : base.playerName,
    storage: Array.isArray(t.storage) ? t.storage : [],
    bankGitan: Number.isFinite(t.bankGitan) ? Math.max(0, Math.floor(t.bankGitan as number)) : 0,
    gitan: Number.isFinite(t.gitan) ? Math.max(0, Math.floor(t.gitan as number)) : 0,
    cleared: Array.isArray(t.cleared) ? t.cleared.filter((x) => typeof x === 'string') : [],
    unlocked: Array.isArray(t.unlocked) && t.unlocked.length > 0
      ? t.unlocked.filter((x) => typeof x === 'string') : ['d1'],
    bestDepth: typeof t.bestDepth === 'object' && t.bestDepth ? t.bestDepth : {},
    seenItems: typeof t.seenItems === 'object' && t.seenItems ? t.seenItems : {},
    seenMonsters: typeof t.seenMonsters === 'object' && t.seenMonsters ? t.seenMonsters : {},
    history: Array.isArray(t.history) ? t.history.slice(-50) : [],
    totalRuns: Number.isFinite(t.totalRuns) ? Math.max(0, Math.floor(t.totalRuns as number)) : 0,
    nextUid: Number.isFinite(t.nextUid) ? Math.max(1, Math.floor(t.nextUid as number)) : 1,
  };
  if (!out.unlocked.includes('d1')) out.unlocked.push('d1');
  renumberStorage(out);
  return out;
}

/**
 * 倉庫の uid を 1 から振り直す。
 *
 * 倉庫の操作（売る・鍛える・持っていく）は uid の先頭一致で対象を探すので、
 * 重複があると別の道具に作用してしまう。以前のセーブには
 * 冒険側の uid がそのまま混ざっているものがあるため、読み込み時に均す。
 */
function renumberStorage(town: TownState): void {
  let next = 1;
  for (const item of town.storage) {
    if (!item || typeof item !== 'object') continue;
    item.uid = next++;
    if (Array.isArray(item.contents)) {
      for (const c of item.contents) c.uid = next++;
    }
  }
  town.nextUid = Math.max(next, town.nextUid);
}

// ---------------------------------------------------------------------------
// 冒険の中断
// ---------------------------------------------------------------------------

export const saveRun = (run: RunState): boolean => write(KEY_RUN, run);

export function loadRun(): RunState | null {
  const data = read<RunState>(KEY_RUN);
  if (!data) return null;
  // 最低限の形だけ確かめる。細かい検証は復元側に任せる
  if (typeof data.dungeonId !== 'string') return null;
  if (!data.map || !Array.isArray(data.map.tiles)) return null;
  if (!data.player || typeof data.player.hp !== 'number') return null;
  if (data.map.tiles.length !== data.map.width * data.map.height) return null;
  return data;
}

export const hasRun = (): boolean => loadRun() !== null;
export const clearRun = (): void => remove(KEY_RUN);

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

export const saveSettings = (s: Settings): boolean => write(KEY_SETTINGS, s);

export function loadSettings(): Settings {
  const data = read<Partial<Settings>>(KEY_SETTINGS);
  if (!data) return { ...DEFAULT_SETTINGS };
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    const v = data[key];
    if (typeof v === typeof DEFAULT_SETTINGS[key]) {
      (out[key] as unknown) = v;
    }
  }
  out.masterVolume = clamp01(out.masterVolume);
  out.sfxVolume = clamp01(out.sfxVolume);
  out.bgmVolume = clamp01(out.bgmVolume);
  out.messageSpeed = Math.max(0, Math.min(2, Math.floor(out.messageSpeed)));
  out.animSpeed = Math.max(0, Math.min(2, Math.floor(out.animSpeed)));
  return out;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);

/** すべて消す（「はじめから」） */
export function clearAll(): void {
  remove(KEY_TOWN);
  remove(KEY_RUN);
  remove(KEY_SETTINGS);
}

/** 書き出し（デバッグ・バックアップ用） */
export function exportSave(): string {
  return JSON.stringify({
    version: SAVE_VERSION,
    town: read<TownState>(KEY_TOWN),
    run: read<RunState>(KEY_RUN),
    settings: read<Settings>(KEY_SETTINGS),
  });
}

/** 読み込み（バックアップからの復元） */
export function importSave(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as {
      version?: number; town?: TownState; run?: RunState; settings?: Settings;
    };
    if (parsed.version !== SAVE_VERSION) return false;
    if (parsed.town) write(KEY_TOWN, validateTown(parsed.town));
    if (parsed.run) write(KEY_RUN, parsed.run);
    if (parsed.settings) write(KEY_SETTINGS, parsed.settings);
    return true;
  } catch {
    return false;
  }
}
