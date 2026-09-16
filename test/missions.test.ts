import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TownState } from '../src/core/types.js';
import { MISSIONS, type MissionCond, tryGetMission } from '../src/data/missions.js';
import type { Action, ItemInstance } from '../src/core/types.js';
import { startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { makeItem } from '../src/game/inventory.js';
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
  assert.equal(claimMission(town, 'walk5000'), 0, '0 歩で受け取れた');
  assert.equal(town.stones, 0);
  assert.deepEqual(town.claimed, []);
});

test('達成したら受け取れる。ただし一度だけ', () => {
  const town = newTown({ tally: { walk: 5000 } });
  const def = tryGetMission('walk5000')!;
  assert.ok(isDone(town, def));

  assert.equal(claimMission(town, 'walk5000'), def.stones);
  assert.equal(town.stones, def.stones);

  assert.equal(claimMission(town, 'walk5000'), 0, '二度目が通った');
  assert.equal(town.stones, def.stones, '石が二重に増えた');
  assert.equal(town.claimed!.filter((x) => x === 'walk5000').length, 1);
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
  const { progress, goal } = missionProgress(town, tryGetMission('walk5000')!);
  assert.equal(goal, 5000);
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
  const def = tryGetMission('walk5000')!;
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
  // 全部足しても、周回の主収入（冒険側）を食い潰す額にはしない。
  // ex の再クリアが毎回 945 石なので、一度きりのミッションが
  // その 40 周ぶんを超えると、潜る意味が薄くなる
  assert.ok(total > 0 && total < 40000, `合計 ${total} 石`);
});

/** ミッションが使っている tally キーを全部集める（every の中も見る） */
function tallyKeysOf(cond: MissionCond, out: string[] = []): string[] {
  if (cond.t === 'tally') out.push(cond.key);
  if (cond.t === 'every') for (const c of cond.conds) tallyKeysOf(c, out);
  return out;
}

test('act: を条件にした操作は、本当にターンを使う', () => {
  // turn.ts は「ターンを使った操作」しか数えない。
  // その場で向きを変える・作戦を変えるはターンを使わないので、
  // act:turn / act:setTactic を条件にすると永久に達成できない
  // ミッションになる（実際に作ってしまったので、ここで止める）。
  const used = new Set<string>();
  for (const def of MISSIONS) {
    for (const key of tallyKeysOf(def.cond)) {
      if (key.startsWith('act:')) used.add(key.slice('act:'.length));
    }
  }
  assert.ok(used.size > 0, 'act: を使っているミッションが 1 つも無い');

  const town = newTown();
  for (const type of used) {
    const world = startRun('d2', town, { seed: 31 });
    const p = world.player;
    // どの操作も成立するように持ち物を整える
    const mk = (id: string): ItemInstance =>
      makeItem(id, world.rng, { plusKnown: true }, () => world.nextUid());
    const sword = mk('bronzeSword');
    const herb = mk('healHerb');
    const pot = mk('storagePot');
    pot.contents = [mk('riceBall')];
    p.inventory.length = 0;
    p.inventory.push(sword, herb, pot);
    p.weaponUid = sword.uid;

    const action: Action | null =
      type === 'wait' ? { type: 'wait' }
        : type === 'throw' ? { type: 'throw', uid: herb.uid, dir: 0 }
          : type === 'place' ? { type: 'place', uid: herb.uid }
            : type === 'unequip' ? { type: 'unequip', uid: sword.uid }
              : type === 'takeOut' ? { type: 'takeOut', potUid: pot.uid, index: 0 }
                : null;
    // 店が要る操作はここでは組み立てられない。
    // 実測では sell も swap もターンを使うことを確かめてある
    if (!action) {
      assert.ok(['sell', 'swap'].includes(type),
        `act:${type} の確かめ方が用意されていない`);
      continue;
    }

    const before = world.run.tally?.[`act:${type}`] ?? 0;
    stepTurn(world, action);
    world.drainEvents();
    const after = world.run.tally?.[`act:${type}`] ?? 0;
    assert.ok(after > before,
      `act:${type} が数えられていない。ターンを使わない操作を条件にしている`);
  }
});

test('ミッションが使うキーは、どこかで数えられている', () => {
  // 接頭辞は addTally が自動で足すので、その形に合っているかだけ見る
  const known = new Set([
    'walk', 'pickup', 'descend', 'kill', 'trap', 'equip', 'use', 'act',
    'cure:curse', 'synthesis', 'makeAlly', 'buy', 'bank', 'keep',
    'shortcut', 'potPut', 'shopBuy', 'house', 'steal', 'bentou', 'withdraw',
  ]);
  for (const def of MISSIONS) {
    for (const key of tallyKeysOf(def.cond)) {
      const base = key.includes(':') ? key.slice(0, key.indexOf(':')) : key;
      assert.ok(known.has(key) || known.has(base),
        `${def.id}: ${key} を数えている場所が無い`);
    }
  }
});

test('ちょうど 100 個ある', () => {
  assert.equal(MISSIONS.length, 100, `${MISSIONS.length} 個になっている`);
});
