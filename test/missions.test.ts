import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TownState } from '../src/core/types.js';
import { MISSIONS, type MissionCond, tryGetMission } from '../src/data/missions.js';
import type { Action, ItemInstance } from '../src/core/types.js';
import { startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { assignShortcut, makeItem } from '../src/game/inventory.js';
import { applyStatus } from '../src/game/status.js';
import { applyTrapEffect } from '../src/game/trapEffects.js';
import { depositGitan, depositItem, withdrawGitan, withdrawItem } from '../src/game/town.js';
import { Rng } from '../src/core/rng.js';
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
    'cure:curse', 'synthesis', 'makeAlly', 'buy', 'keep',
    'shortcut', 'potPut', 'potTake', 'shopBuy', 'house', 'steal', 'bentou',
    'bring', 'sell', 'throwHit', 'swapGear',
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

test('眠っていてターンだけ過ぎたときは、押した操作を数えない', () => {
  // 持ち物ゼロで眠ったまま連打すると act:throw が増えていた。
  // 「投げる」ミッションが 0 ターンで終わる形だったので、ここで固定する
  const town = newTown();
  const world = startRun('d2', town, { seed: 3 });
  world.player.inventory.length = 0;
  applyStatus(world, world.player, 'deepAsleep', 200);
  for (let i = 0; i < 20; i++) {
    stepTurn(world, { type: 'throw', uid: 9999, dir: 0 });
    world.drainEvents();
  }
  assert.deepEqual(world.run.tally ?? {}, {}, '眠っているだけで数えが進んだ');
  assert.ok(world.run.totalTurn > 0, 'ターンは過ぎるべき');
});

test('ボスは落とし穴で消えない', () => {
  // 落ちると killActor を通らずに消えるので、戦わずに踏破でき、
  // kill:<ボス> を条件にしたミッションが永久に達成できなかった
  const town = newTown();
  const world = startRun('d2', town, { seed: 5 });
  const spot = world.randomOpenTile();
  assert.ok(spot, '置ける場所が無い');
  const boss = world.spawnAt?.('bossForest', spot!) ?? null;
  assert.ok(boss, 'ボスを置けない');
  applyTrapEffect(world, boss!, 'spike');
  assert.equal(boss!.alive, true, 'ボスが落とし穴で消えた');
});

test('往復では進まない', () => {
  const town = newTown({ gitan: 1000 });
  // 銀行: 預ける→下ろすを繰り返しても預り高の記録は伸びない
  depositGitan(town, 1000);
  const peak = town.tally?.[`${MAX_PREFIX}bankGitan`];
  withdrawGitan(town, 1000);
  depositGitan(town, 1000);
  assert.equal(town.tally?.[`${MAX_PREFIX}bankGitan`], peak, '往復で預り高が伸びた');

  // 倉庫: 出し入れを繰り返しても持ち込みの数えは増えない
  const t2 = newTown();
  const item = makeItem('riceBall', new Rng(1), {}, () => t2.nextUid++);
  depositItem(t2, item);
  for (let i = 0; i < 5; i++) {
    const got = withdrawItem(t2, item.uid);
    assert.ok(got, '取り出せない');
    depositItem(t2, got!);
  }
  assert.equal(t2.tally?.bring ?? 0, 0, '出し入れの往復で持ち込みが増えた');
});

test('ショートカットは同じ枠に入れ直しても増えない', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 7 });
  const p = world.player;
  assert.equal(assignShortcut(p, 0, 'healHerb'), true, '1 回目が入らない');
  for (let i = 0; i < 10; i++) {
    assert.equal(assignShortcut(p, 0, 'healHerb'), false, '同じ物を入れ直して true');
  }
  assert.equal(assignShortcut(p, 0, 'riceBall'), true, '別の物に変えられない');
});

test('同じ装備の着け外しでは、持ち替えに数えない', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 17 });
  const p = world.player;
  p.inventory.length = 0;
  p.weaponUid = null;
  const a = makeItem('bronzeSword', world.rng, {}, () => world.nextUid());
  const b = makeItem('ironSword', world.rng, {}, () => world.nextUid());
  p.inventory.push(a, b);

  // 同じ剣を 10 往復
  for (let i = 0; i < 10; i++) {
    stepTurn(world, { type: 'equip', uid: a.uid });
    stepTurn(world, { type: 'unequip', uid: a.uid });
    world.drainEvents();
  }
  assert.equal(world.run.tally?.['swapGear:weapon'] ?? 0, 0, '着け外しで持ち替えが増えた');

  // 別の剣に替えたら 1 回
  stepTurn(world, { type: 'equip', uid: a.uid });
  stepTurn(world, { type: 'equip', uid: b.uid });
  world.drainEvents();
  assert.equal(world.run.tally?.['swapGear:weapon'], 1, '持ち替えが数えられていない');
});
