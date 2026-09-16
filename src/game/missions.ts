/**
 * ミッションの判定と受け取り。
 *
 * 判定は村の状態だけを見る純関数。副作用があるのは claimMission だけ。
 * 「達成しているか」と「受け取ったか」は別で、達成しても自分で受け取るまで
 * 石にならない。冒険から戻った瞬間に石が勝手に増えると、何で増えたのか
 * 分からなくなるため。
 */

import type { TownState } from '../core/types.js';
import { MISSIONS, type MissionDef, tryGetMission } from '../data/missions.js';
import { tryGetItem, tryGetMonster } from '../data/registry.js';
import { MAX_PREFIX, counted } from './counters.js';

/** 一覧に出す 1 行 */
export interface MissionView {
  def: MissionDef;
  /** いまの数え */
  progress: number;
  /** 必要な数え */
  goal: number;
  done: boolean;
  claimed: boolean;
}

/**
 * 図鑑の実数。
 *
 * seenMonsters には店主と番犬が、seenItems には床のギタンが入りうる。
 * collectionRate の分母はそれらを除いているので、分子も同じ条件で絞らないと
 * 達成率が 100% を超える。
 */
export function dexCounts(town: TownState): { monsters: number; items: number } {
  return {
    monsters: Object.keys(town.seenMonsters)
      .filter((id) => tryGetMonster(id)?.family !== 'shop').length,
    items: Object.keys(town.seenItems)
      .filter((id) => tryGetItem(id)?.kind !== 'gitan').length,
  };
}

/** いまの進み具合と、必要な数 */
export function missionProgress(town: TownState, def: MissionDef): {
  progress: number; goal: number;
} {
  const c = def.cond;
  switch (c.t) {
    case 'tally':
      return { progress: counted(town.tally, c.key), goal: c.n };
    case 'max':
      return { progress: counted(town.tally, MAX_PREFIX + c.key), goal: c.n };
    case 'cleared':
      return { progress: town.cleared.includes(c.dungeon) ? 1 : 0, goal: 1 };
    case 'depth':
      return { progress: Math.max(0, Math.floor(town.bestDepth[c.dungeon] ?? 0)), goal: c.n };
    case 'storage':
      return { progress: town.storage.length, goal: c.n };
    case 'dex': {
      // 敵と道具の両方が要る。少ない方の達成率を進み具合として見せる
      const have = dexCounts(town);
      const rate = Math.min(have.monsters / c.monsters, have.items / c.items);
      return { progress: Math.min(100, Math.floor(rate * 100)), goal: 100 };
    }
    case 'every': {
      // 「3 つのうち 2 つ達成」と見せる。中身の細かい進み具合は出さない
      const done = c.conds.filter((sub) => {
        const r = missionProgress(town, { ...def, cond: sub });
        return r.progress >= r.goal;
      }).length;
      return { progress: done, goal: c.conds.length };
    }
  }
}

export function isDone(town: TownState, def: MissionDef): boolean {
  const { progress, goal } = missionProgress(town, def);
  return progress >= goal;
}

export const isClaimed = (town: TownState, id: string): boolean =>
  (town.claimed ?? []).includes(id);

/**
 * 一覧に出すぶん。
 *
 * 順番の縛りは無い。100 個が最初から全部見えていて、
 * 達成したものは順番に関係なく受け取れる。
 *
 * 並びは「受け取れる → 近い → 遠い → 受け取り済み」。
 * 未達成のものは達成率の高い順に並べるので、
 * 100 個あっても「いま自分に届くもの」が自然と上に来る。
 */
export function visibleMissions(town: TownState): MissionView[] {
  const out: MissionView[] = MISSIONS.map((def) => {
    const { progress, goal } = missionProgress(town, def);
    return {
      def, progress, goal,
      done: progress >= goal,
      claimed: isClaimed(town, def.id),
    };
  });
  const rank = (v: MissionView): number => (v.claimed ? 2 : v.done ? 0 : 1);
  const rate = (v: MissionView): number => (v.goal > 0 ? v.progress / v.goal : 0);
  return out.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    // 同じ段の中では、近いものが上
    if (rank(a) === 1) return rate(b) - rate(a);
    return 0;
  });
}

/** 受け取れる石の合計。バッジの数字に使う */
export function claimableCount(town: TownState): number {
  return visibleMissions(town).filter((v) => v.done && !v.claimed).length;
}

/**
 * 受け取る。受け取れたら石の数を返し、受け取れなければ 0。
 *
 * 二度受け取れないよう claimed に入れてから石を足す。
 */
export function claimMission(town: TownState, id: string): number {
  const def = tryGetMission(id);
  if (!def) return 0;
  if (isClaimed(town, id)) return 0;
  if (!isDone(town, def)) return 0;
  town.claimed ??= [];
  town.claimed.push(id);
  town.stones = (town.stones ?? 0) + def.stones;
  return def.stones;
}

/**
 * 受け取れるものを全部まとめて受け取る。返すのは合計の石。
 *
 * 順番の縛りが無いので 1 周で足りる。
 * 受け取ったことで新しく出てくるミッションは存在しない。
 */
export function claimAll(town: TownState): { stones: number; ids: string[] } {
  const ids: string[] = [];
  let stones = 0;
  for (const def of MISSIONS) {
    if (isClaimed(town, def.id)) continue;
    const got = claimMission(town, def.id);
    if (got > 0) {
      stones += got;
      ids.push(def.id);
    }
  }
  return { stones, ids };
}
