/**
 * ミッションの判定と受け取り。
 *
 * 判定は村の状態だけを見る純関数。副作用があるのは claimMission だけ。
 * 「達成しているか」と「受け取ったか」は別で、達成しても自分で受け取るまで
 * 石にならない。冒険から戻った瞬間に石が勝手に増えると、何で増えたのか
 * 分からなくなるため。
 */
import { MISSIONS, tryGetMission } from '../data/missions.js';
import { tryGetItem, tryGetMonster } from '../data/registry.js';
import { MAX_PREFIX, counted } from './counters.js';
/**
 * 図鑑の実数。
 *
 * seenMonsters には店主と番犬が、seenItems には床のギタンが入りうる。
 * collectionRate の分母はそれらを除いているので、分子も同じ条件で絞らないと
 * 達成率が 100% を超える。
 */
export function dexCounts(town) {
    return {
        monsters: Object.keys(town.seenMonsters)
            .filter((id) => tryGetMonster(id)?.family !== 'shop').length,
        items: Object.keys(town.seenItems)
            .filter((id) => tryGetItem(id)?.kind !== 'gitan').length,
    };
}
/** いまの進み具合と、必要な数 */
export function missionProgress(town, def) {
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
    }
}
export function isDone(town, def) {
    const { progress, goal } = missionProgress(town, def);
    return progress >= goal;
}
export const isClaimed = (town, id) => (town.claimed ?? []).includes(id);
/**
 * 一覧に出すぶん。
 *
 * `after` が受け取り済みになるまでは出さない。チュートリアルを一度に
 * 8 個並べると、どれから手を付ければよいのか分からなくなる。
 * 受け取り済みのものは、達成した記録として後ろに残す。
 */
export function visibleMissions(town) {
    const out = [];
    for (const def of MISSIONS) {
        if (def.after && !isClaimed(town, def.after))
            continue;
        const { progress, goal } = missionProgress(town, def);
        out.push({
            def, progress, goal,
            done: progress >= goal,
            claimed: isClaimed(town, def.id),
        });
    }
    // 受け取れるものを先頭に、次に未達成、受け取り済みは最後
    const rank = (v) => (v.claimed ? 2 : v.done ? 0 : 1);
    return out.sort((a, b) => rank(a) - rank(b));
}
/** 受け取れる石の合計。バッジの数字に使う */
export function claimableCount(town) {
    return visibleMissions(town).filter((v) => v.done && !v.claimed).length;
}
/**
 * 受け取る。受け取れたら石の数を返し、受け取れなければ 0。
 *
 * 二度受け取れないよう claimed に入れてから石を足す。
 */
export function claimMission(town, id) {
    const def = tryGetMission(id);
    if (!def)
        return 0;
    if (isClaimed(town, id))
        return 0;
    if (!isDone(town, def))
        return 0;
    town.claimed ??= [];
    town.claimed.push(id);
    town.stones = (town.stones ?? 0) + def.stones;
    return def.stones;
}
/** 受け取れるものを全部まとめて受け取る。返すのは合計の石 */
export function claimAll(town) {
    const ids = [];
    let stones = 0;
    for (const v of visibleMissions(town)) {
        if (!v.done || v.claimed)
            continue;
        const got = claimMission(town, v.def.id);
        if (got > 0) {
            stones += got;
            ids.push(v.def.id);
        }
    }
    // 受け取ったことで after が解けて、新しく達成済みのものが出てくることがある。
    // 一度で全部受け取れないと「全部受け取る」を何度も押すことになる
    if (ids.length > 0) {
        const more = claimAll(town);
        stones += more.stones;
        ids.push(...more.ids);
    }
    return { stones, ids };
}
//# sourceMappingURL=missions.js.map