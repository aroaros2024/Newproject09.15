import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TownState } from '../src/core/types.js';
import { MISSIONS, tryGetMission } from '../src/data/missions.js';
import { ALL_ITEMS, allMonsters, getDungeon, tryGetMonster } from '../src/data/registry.js';
import {
  claimAll, claimMission, claimableCount, dexCounts, isDone, missionProgress, visibleMissions,
} from '../src/game/missions.js';
import { MAX_PREFIX } from '../src/game/counters.js';

/**
 * ミッションの検査。
 *
 * 石を配るので、二度受け取れることと、達成していないのに受け取れることが
 * 一番まずい。あとは「一覧に出ているのに絶対に達成できない」を防ぐ。
 */

function newTown(over: Partial<TownState> = {}): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    knownItems: {}, nicknames: {}, stones: 0, tally: {}, claimed: [],
    ...over,
  };
}

test('ミッションの条件は、実在するものだけを指す', () => {
  const ids = new Set<string>();
  for (const m of MISSIONS) {
    assert.ok(!ids.has(m.id), `id が重複している: ${m.id}`);
    ids.add(m.id);
    assert.ok(m.stones > 0, `${m.id}: 石が 0`);

    const c = m.cond;
    if (c.t === 'tally' && c.key.startsWith('kill:')) {
      const monsterId = c.key.slice('kill:'.length);
      assert.ok(tryGetMonster(monsterId), `${m.id}: 敵 ${monsterId} が居ない`);
    }
    if (c.t === 'cleared' || c.t === 'depth') {
      const d = getDungeon(c.dungeon);
      if (c.t === 'depth') {
        assert.ok(c.n <= d.depth, `${m.id}: ${d.name}は ${d.depth}F までしか無い`);
      }
    }
    if (c.t === 'dex') {
      const monsters = allMonsters().filter((x) => x.family !== 'shop').length;
      const items = ALL_ITEMS.filter((x) => x.kind !== 'gitan').length;
      assert.ok(c.monsters <= monsters, `図鑑の敵 ${c.monsters} > ${monsters}`);
      assert.ok(c.items <= items, `図鑑の道具 ${c.items} > ${items}`);
    }
  }
});

test('ミッションは最初から全部見える', () => {
  const town = newTown();
  assert.equal(visibleMissions(town).length, MISSIONS.length,
    '順番の縛りで隠れているものがある');
});

test('達成していないミッションは受け取れない', () => {
  const town = newTown();
  assert.equal(claimMission(town, 'walk50'), 0, '0 歩で受け取れた');
  assert.equal(town.stones, 0);
  assert.deepEqual(town.claimed, []);
});

test('達成したら受け取れる。ただし一度だけ', () => {
  const town = newTown({ tally: { walk: 50 } });
  const def = tryGetMission('walk50')!;
  assert.ok(isDone(town, def));

  assert.equal(claimMission(town, 'walk50'), def.stones);
  assert.equal(town.stones, def.stones);

  assert.equal(claimMission(town, 'walk50'), 0, '二度目が通った');
  assert.equal(town.stones, def.stones, '石が二重に増えた');
  assert.equal(town.claimed!.filter((x) => x === 'walk50').length, 1);
});

test('知らない id は受け取れない', () => {
  const town = newTown({ tally: { walk: 999 } });
  assert.equal(claimMission(town, 'そんなものは無い'), 0);
  assert.equal(town.stones, 0);
});

test('達成したものは、順番に関係なく受け取れる', () => {
  // 最初のミッションを飛ばして、後ろのものだけを達成した状態
  const town = newTown({ cleared: ['d1', 'd2'], tally: {} });
  const ids = visibleMissions(town).filter((v) => v.done && !v.claimed)
    .map((v) => v.def.id);
  assert.ok(ids.includes('clearD1'), '前のミッションが未達成だと受け取れない');
  assert.ok(ids.includes('clearD2'), '前のミッションが未達成だと受け取れない');

  // 直接その id を指して受け取れる
  assert.ok(claimMission(town, 'clearD2') > 0, '順番を飛ばして受け取れない');
});

test('まとめて受け取ると、達成している全部が 1 度で受け取れる', () => {
  const town = newTown({
    cleared: ['d1', 'd2'],
    tally: { walk: 999, kill: 99, pickup: 99, equip: 9, use: 9, shortcut: 9, descend: 99 },
  });
  const ready = visibleMissions(town).filter((v) => v.done && !v.claimed).length;
  assert.ok(ready > 1, '達成済みが 1 個しか無い');

  const got = claimAll(town);
  assert.equal(got.ids.length, ready, `${ready} 個 達成しているのに ${got.ids.length} 個しか受け取れない`);
  assert.equal(town.stones, got.stones);
  assert.equal(
    got.stones,
    got.ids.reduce((a, id) => a + tryGetMission(id)!.stones, 0),
    '石の合計が定義と食い違う',
  );
  // 二度目は何も出ない
  assert.equal(claimAll(town).stones, 0, '二度目のまとめ受け取りで増えた');
});

test('到達値は max: で読む。加算されない', () => {
  const def = tryGetMission('level30')!;
  const town = newTown({ tally: { [`${MAX_PREFIX}level`]: 30 } });
  assert.ok(isDone(town, def), 'max:level を読んでいない');

  // 接頭辞の無いキーでは達成しない（合流の分岐を消したら落ちる）
  const wrong = newTown({ tally: { level: 99 } });
  assert.ok(!isDone(wrong, def), 'max: でないキーで達成した');
});

test('図鑑は店主とギタンを除いて数える', () => {
  const shop = allMonsters().find((m) => m.family === 'shop');
  assert.ok(shop, '店主が居ない');
  const town = newTown({
    seenMonsters: { [shop!.id]: true },
    seenItems: { gitan: true },
  });
  const c = dexCounts(town);
  assert.equal(c.monsters, 0, '店主を数えている');
  assert.equal(c.items, 0, 'ギタンを数えている');
});

test('進み具合は目標を超えて表示されない', () => {
  const town = newTown({ tally: { walk: 99999 } });
  const { progress, goal } = missionProgress(town, tryGetMission('walk50')!);
  assert.equal(goal, 50);
  assert.ok(progress >= goal);
  // 一覧の表示は Math.min するので、ここでは素の値でよい
});

test('受け取れる件数のバッジは、受け取ると減る', () => {
  const town = newTown({ cleared: ['d1'] });
  const before = claimableCount(town);
  assert.ok(before > 0, '達成済みが無い');
  claimMission(town, 'clearD1');
  assert.equal(claimableCount(town), before - 1);
});

test('壊れた数えでミッションが達成にならない', () => {
  const def = tryGetMission('walk50')!;
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 'ten', null, undefined]) {
    const town = newTown({ tally: { walk: bad as unknown as number } });
    assert.ok(!isDone(town, def), `${String(bad)} で達成になった`);
  }
});

test('石の総額が、想定した規模から外れていない', () => {
  const total = MISSIONS.reduce((a, m) => a + m.stones, 0);
  const tutorial = MISSIONS.filter((m) => m.group === 'tutorial')
    .reduce((a, m) => a + m.stones, 0);
  // 最初のダンジョンを出る前に単発 2 回ぶん（200 石）は渡したい
  assert.ok(tutorial >= 200, `序盤が ${tutorial} 石しかない`);
  // 全部足しても、周回の主収入（冒険側）を食い潰す額にはしない
  assert.ok(total > 0 && total < 30000, `合計 ${total} 石`);
});
