/**
 * プレイログの記録。
 *
 * 目的は 1 つだけ。**作者が出会った不具合を、こちらで 1 手ずつ再現できるようにする**こと。
 *
 * この作品はゲームの中身が全部シード付きの Rng を通っていて、
 * Math.random はエフェクト（ui/fx.ts）と効果音（core/audio.ts）にしか使っていない。
 * だから「シード ＋ 出発時の村 ＋ 押した順の行動」があれば、同じ冒険がそのまま再生できる。
 * 足りなかったのは行動の列だけなので、ここで溜める。
 *
 * 記録するのは ui/screens/dungeon.ts の stepTurn を呼ぶ 1 箇所。
 * turn.ts が内部で呼ぶ stepTurn（風で飛ばされたときの自動待機）は
 * 再生でも同じように起きるので、記録してはいけない。UI 側で録ればそうなる。
 */

import type {
  Action, AllyTactic, Dir, ItemInstance, LogLine, LogStyle, Replay, TownState,
} from '../core/types.js';
import { startRun } from './run.js';
import { stepTurn } from './turn.js';
import type { World } from './world.js';

/**
 * 上限。超えたら truncated を立てて**記録を止める**。
 *
 * 末尾だけ残す形にすると先頭が欠けて再生できなくなり、
 * 「再現データ」と書いてあるのに再現できないものが出来上がる。
 */
export const MAX_ACTIONS = 50_000;
export const MAX_LINES = 5_000;

/** 仲間の作戦。番号で書き出すので、順番を変えないこと */
const TACTICS: readonly AllyTactic[] = ['follow', 'free', 'stay', 'avoid'];

// ---------------------------------------------------------------------------
// 行動の書き出しと読み戻し
// ---------------------------------------------------------------------------

/**
 * 行動 1 つを短い文字列にする。
 *
 * そのまま JSON にすると 5,000 手で 150KB を超えて、貼り付けるには大きい。
 * 書き出しと読み戻しは**必ずこのファイルの中で隣り合わせに置く**。
 * 離すと片方だけ直されて、静かに壊れる。
 */
interface Codec {
  /** 1 文字の印。セーブに載るので変えないこと */
  tag: string;
  enc: (a: Action) => string[];
  dec: (v: string[]) => Action;
}

const num = (s: string): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const dir = (s: string): Dir => (num(s) & 7) as Dir;

const CODECS: readonly Codec[] = [
  {
    tag: 'm',
    enc: (a) => (a.type === 'move' && a.dash ? [`${a.dir}`, '1'] : [`${(a as { dir: Dir }).dir}`]),
    dec: (v) => (v[1] === '1'
      ? { type: 'move', dir: dir(v[0]), dash: true }
      : { type: 'move', dir: dir(v[0]) }),
  },
  { tag: 'a', enc: (a) => [`${(a as { dir: Dir }).dir}`], dec: (v) => ({ type: 'attack', dir: dir(v[0]) }) },
  { tag: 'r', enc: (a) => [`${(a as { dir: Dir }).dir}`], dec: (v) => ({ type: 'turn', dir: dir(v[0]) }) },
  { tag: 'w', enc: () => [], dec: () => ({ type: 'wait' }) },
  { tag: 'p', enc: () => [], dec: () => ({ type: 'pickup' }) },
  { tag: 'P', enc: (a) => [`${(a as { uid: number }).uid}`], dec: (v) => ({ type: 'place', uid: num(v[0]) }) },
  { tag: 'S', enc: (a) => [`${(a as { uid: number }).uid}`], dec: (v) => ({ type: 'swap', uid: num(v[0]) }) },
  {
    tag: 'u',
    enc: (a) => {
      const x = a as { uid: number; targetUid?: number; dir?: Dir };
      return [`${x.uid}`, x.targetUid === undefined ? '' : `${x.targetUid}`,
        x.dir === undefined ? '' : `${x.dir}`];
    },
    dec: (v) => {
      const out: Action = { type: 'use', uid: num(v[0]) };
      if (v[1] !== undefined && v[1] !== '') out.targetUid = num(v[1]);
      if (v[2] !== undefined && v[2] !== '') out.dir = dir(v[2]);
      return out;
    },
  },
  { tag: 'e', enc: (a) => [`${(a as { uid: number }).uid}`], dec: (v) => ({ type: 'equip', uid: num(v[0]) }) },
  { tag: 'E', enc: (a) => [`${(a as { uid: number }).uid}`], dec: (v) => ({ type: 'unequip', uid: num(v[0]) }) },
  {
    tag: 't',
    enc: (a) => { const x = a as { uid: number; dir: Dir }; return [`${x.uid}`, `${x.dir}`]; },
    dec: (v) => ({ type: 'throw', uid: num(v[0]), dir: dir(v[1]) }),
  },
  {
    tag: 'i',
    enc: (a) => { const x = a as { potUid: number; uid: number }; return [`${x.potUid}`, `${x.uid}`]; },
    dec: (v) => ({ type: 'putIn', potUid: num(v[0]), uid: num(v[1]) }),
  },
  {
    tag: 'o',
    enc: (a) => { const x = a as { potUid: number; index: number }; return [`${x.potUid}`, `${x.index}`]; },
    dec: (v) => ({ type: 'takeOut', potUid: num(v[0]), index: num(v[1]) }),
  },
  { tag: 's', enc: () => [], dec: () => ({ type: 'stairs' }) },
  { tag: 'b', enc: () => [], dec: () => ({ type: 'buy' }) },
  { tag: 'l', enc: (a) => [`${(a as { uid: number }).uid}`], dec: (v) => ({ type: 'sell', uid: num(v[0]) }) },
  {
    tag: 'c',
    enc: (a) => [`${Math.max(0, TACTICS.indexOf((a as { tactic: AllyTactic }).tactic))}`],
    dec: (v) => ({ type: 'setTactic', tactic: TACTICS[num(v[0])] ?? 'follow' }),
  },
  { tag: 'n', enc: () => [], dec: () => ({ type: 'none' }) },
];

/** Action の type → 印。型を足したら必ずここも埋まる（下の検査で落ちる） */
const TAG_OF: Record<Action['type'], string> = {
  move: 'm', attack: 'a', turn: 'r', wait: 'w', pickup: 'p', place: 'P', swap: 'S',
  use: 'u', equip: 'e', unequip: 'E', throw: 't', putIn: 'i', takeOut: 'o',
  stairs: 's', buy: 'b', sell: 'l', setTactic: 'c', none: 'n',
};

const BY_TAG = new Map(CODECS.map((c) => [c.tag, c]));

/** 行動 1 つを文字列に。末尾の空欄は落とす */
export function encodeAction(a: Action): string {
  const codec = BY_TAG.get(TAG_OF[a.type]);
  if (!codec) return 'n';
  const args = codec.enc(a);
  while (args.length > 0 && args[args.length - 1] === '') args.pop();
  return codec.tag + args.join(',');
}

/** 文字列を行動 1 つに。読めなければ「何もしない」を返す（落とさない） */
export function decodeAction(s: string): Action {
  const codec = BY_TAG.get(s.slice(0, 1));
  if (!codec) return { type: 'none' };
  const rest = s.slice(1);
  return codec.dec(rest.length > 0 ? rest.split(',') : []);
}

export const encodeActions = (list: readonly Action[]): string =>
  list.map(encodeAction).join(' ');

export const decodeActions = (s: string): Action[] =>
  (s.length === 0 ? [] : s.split(' ').map(decodeAction));

// ---------------------------------------------------------------------------
// 記録
// ---------------------------------------------------------------------------

export class Recorder {
  private replay: Replay | null = null;
  private pending: { town: TownState; bring: ItemInstance[] } | null = null;

  /**
   * 出発時の村を写し取る。**startRun を呼ぶ前に**呼ぶこと。
   *
   * startRun は村のギタンを冒険へ移す（town.gitan が 0 になる）。
   * 潜ったあとに写すと、再生の出発点が本物と違ってしまう。
   * 写すのと記録を始めるのを 2 つに分けてあるのは、
   * 「順番を間違えても静かに壊れる」形にしないため。
   */
  snapshot(town: TownState, bring: readonly ItemInstance[]): void {
    this.pending = {
      town: JSON.parse(JSON.stringify(town)) as TownState,
      bring: JSON.parse(JSON.stringify(bring)) as ItemInstance[],
    };
  }

  /** 冒険の始まりで呼ぶ。seed は startRun のあとでないと分からない */
  begin(dungeonId: string, seed: number): void {
    const snap = this.pending;
    this.pending = null;
    if (!snap) {
      // 写し取らずに始まった。記録しても再生できないので、記録しない
      this.replay = null;
      return;
    }
    this.replay = {
      version: 1,
      dungeonId,
      seed,
      town: snap.town,
      bring: snap.bring,
      actions: [],
      lines: [],
      truncated: false,
    };
  }

  /** 中断から再開したときに、保存してあった記録を戻す */
  resume(replay: Replay): void {
    this.replay = replay;
  }

  get current(): Replay | null {
    return this.replay;
  }

  get recording(): boolean {
    return this.replay !== null && !this.replay.truncated;
  }

  /**
   * プレイヤーの行動を 1 つ記録する。
   *
   * ターンを消費しなかった行動も記録する。弾かれる前に乱数を減らしている
   * 経路があり、そこを飛ばすと以後の乱数列がずれる。
   */
  action(a: Action): void {
    const r = this.replay;
    if (!r || r.truncated) return;
    if (r.actions.length >= MAX_ACTIONS) {
      r.truncated = true;
      return;
    }
    r.actions.push(a);
  }

  /** できごとを 1 行記録する。ターン番号と階を添える */
  line(turn: number, depth: number, text: string, style: LogStyle): void {
    const r = this.replay;
    if (!r || r.truncated) return;
    if (r.lines.length >= MAX_LINES) {
      // できごとが溢れただけなら、行動の記録は続けたい（再現はできる）。
      // 古い行から捨てる
      r.lines.shift();
    }
    r.lines.push({ turn, depth, text, style });
  }

  clear(): void {
    this.replay = null;
  }
}

// ---------------------------------------------------------------------------
// 再生
// ---------------------------------------------------------------------------

export interface ReplayResult {
  world: World;
  /** 実際に流した行動の数 */
  applied: number;
  /** 再生中に出たできごと（ターン番号と階つき） */
  lines: LogLine[];
}

/**
 * 記録した冒険をもう一度動かす。
 *
 * seed を明に渡すので、村の totalRuns や名前が変わっていても同じ地形になる。
 * 冒険が終わった（倒れた・クリアした）ら、そこで止める。
 */
export function replayRun(
  replay: Replay, opts: { untilAction?: number } = {},
): ReplayResult {
  const world = startRun(replay.dungeonId, replay.town, {
    bring: replay.bring,
    seed: replay.seed,
  });
  const lines: LogLine[] = [];
  const pump = (): void => {
    for (const e of world.drainEvents()) {
      if (e.t === 'message') {
        lines.push({
          turn: world.run.totalTurn,
          depth: world.run.depth,
          text: e.text,
          style: e.style ?? 'normal',
        });
      }
    }
  };
  pump();

  const limit = opts.untilAction ?? replay.actions.length;
  let applied = 0;
  for (const a of replay.actions) {
    if (applied >= limit) break;
    if (world.finished) break;
    stepTurn(world, a);
    pump();
    applied++;
  }
  return { world, applied, lines };
}
