import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunState, TownState } from '../src/core/types.js';
import { Rng } from '../src/core/rng.js';
import { DIRS } from '../src/core/geom.js';
import type { Dir } from '../src/core/types.js';
import { getDungeon } from '../src/data/registry.js';
import { attachFactories, startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { finishRun } from '../src/game/town.js';
import { World } from '../src/game/world.js';
import { killActor } from '../src/game/combat.js';
import { TALLY_CAP, addTally, sanitizeTally } from '../src/game/counters.js';
import { ITEM_EFFECTS } from '../src/game/itemEffects.js';
import { makeItem } from '../src/game/inventory.js';
import { smithUncurse } from '../src/game/town.js';

/**
 * ミッション用カウンタの検査。
 *
 * 数える口は World.tally 1 本だけ。冒険中は RunState に溜め、
 * finishRun で村へ一度だけ移す。村へ直接書くと、中断セーブから
 * 再開したときに同じぶんを二度数えてしまう。
 */

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1', 'd2', 'd3'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    knownItems: {}, nicknames: {}, stones: 0, tally: {}, claimed: [],
  };
}

/** ランダムに動かす。歩数は必ず増える */
function play(world: ReturnType<typeof startRun>, turns: number, seed: number): void {
  const rng = new Rng(seed);
  for (let i = 0; i < turns && !world.finished; i++) {
    stepTurn(world, { type: 'move', dir: rng.pick(DIRS) as Dir });
    world.drainEvents();
    world.player.hp = world.player.maxHp;
  }
}

test('冒険中の数えは、帰るまで村に入らない', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 11 });
  play(world, 60, 1);
  assert.ok((world.run.tally?.act ?? 0) > 0, '冒険側で数えていない');
  assert.equal(town.tally?.act ?? 0, 0, '帰る前に村へ入っている');

  finishRun(world, town, 'escape', 'テスト');
  assert.ok((town.tally?.act ?? 0) > 0, '帰っても村へ入らない');
  assert.equal(world.run.tally?.act ?? 0, 0, '移したのに冒険側に残っている');
});

test('歩数と拾得数は、帰るときに 1 度だけ合流する', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 11 });
  play(world, 60, 1);
  // 冒険中は p.steps だけが真実。tally に二重に持たない
  assert.ok(world.player.steps > 0, '歩いていない');
  assert.equal(world.run.tally?.walk ?? 0, 0, '冒険中に walk を数えている');

  const steps = world.player.steps;
  finishRun(world, town, 'escape', 'テスト');
  assert.equal(town.tally?.walk, steps, '歩数が p.steps と食い違う');
});

test('中断して再開しても、二重に数えない', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 12 });
  play(world, 40, 2);
  const walked = world.run.tally?.act ?? 0;
  assert.ok(walked > 0);

  // 中断（JSON を往復）して再開する
  const snapshot = JSON.parse(JSON.stringify(world.syncForSave())) as RunState;
  const revived = new World(snapshot, getDungeon(snapshot.dungeonId));
  attachFactories(revived);
  assert.equal(revived.run.tally?.act ?? 0, walked, '再開で数えが失われた');

  play(revived, 20, 3);
  const after = revived.run.tally?.act ?? 0;
  assert.ok(after > walked, '再開後に数えが伸びていない');

  finishRun(revived, town, 'escape', 'テスト');
  assert.equal(town.tally?.act, after, `村に ${town.tally?.act} 入った（期待 ${after}）`);
  // 歩数は中断を挟んでも p.steps が持ち続けるので、合流しても食い違わない
  assert.equal(town.tally?.walk, revived.player.steps, '中断を挟むと歩数がずれる');
});

test('同じ冒険の精算を二度しても、二度は数えない', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 13 });
  play(world, 40, 4);
  const first = finishRun(world, town, 'escape', 'テスト');
  const once = town.tally?.walk ?? 0;
  const runs = town.totalRuns;
  const stones = town.stones ?? 0;
  const history = town.history.length;

  const second = finishRun(world, town, 'escape', 'テスト');
  assert.equal(town.tally?.walk ?? 0, once, '二度目の精算で歩数が増えた');
  assert.equal(town.totalRuns, runs, '二度目の精算で回数が増えた');
  assert.equal(town.stones ?? 0, stones, '二度目の精算で石が増えた');
  assert.equal(town.history.length, history, '二度目の精算で記録が増えた');
  assert.deepEqual(second, first, '二度目の精算が違う結果を返した');
});

test('古い中断データに数えが無くても壊れない', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 14 });
  play(world, 20, 5);
  const snapshot = JSON.parse(JSON.stringify(world.syncForSave())) as Partial<RunState>;
  delete snapshot.tally;
  delete snapshot.pendingRejoin;

  const revived = new World(snapshot as RunState, getDungeon('d2'));
  attachFactories(revived);
  play(revived, 20, 6);
  assert.ok((revived.run.tally?.act ?? 0) > 0, '数え直せていない');
  finishRun(revived, town, 'escape', 'テスト');
  assert.ok((town.tally?.walk ?? 0) > 0);
});

test('倒した敵は種類ごとに数える', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 15 });
  const before = { ...(world.run.tally ?? {}) };
  // 敵を 1 体、実際に倒す
  const target = world.run.monsters.find((m) => m.alive);
  assert.ok(target, '敵がいない');
  killActor(world, world.player, target!);
  world.drainEvents();
  assert.equal((world.run.tally?.kill ?? 0) - (before.kill ?? 0), 1, '総数が増えていない');
  assert.equal(world.run.tally?.[`kill:${target!.defId}`], 1, '種類ごとに数えていない');
});

test('内訳を数えると総数も自動で足りる', () => {
  const t: Record<string, number> = {};
  addTally(t, 'kill:ratField');
  addTally(t, 'kill:batCave', 3);
  assert.equal(t['kill:ratField'], 1);
  assert.equal(t['kill:batCave'], 3);
  assert.equal(t.kill, 4, '総数が自動で足りていない');
});

test('壊れた数えは読み込み時に捨てる', () => {
  const dirty = {
    kill: 5,
    bad1: Number.NaN,
    bad2: Number.POSITIVE_INFINITY,
    bad3: -3,
    bad4: 'ten',
    bad5: null,
    huge: 1e308,
    '': 9,
  };
  const clean = sanitizeTally(dirty);
  assert.equal(clean.kill, 5, '正しい値まで消えた');
  for (const k of ['bad1', 'bad2', 'bad3', 'bad4', 'bad5', '']) {
    assert.equal(clean[k], undefined, `${k} が残っている`);
  }
  assert.equal(clean.huge, TALLY_CAP, '上限で止まっていない');
  // 配列や null を渡しても空で返る
  assert.deepEqual(sanitizeTally([1, 2, 3]), {});
  assert.deepEqual(sanitizeTally(null), {});
  assert.deepEqual(sanitizeTally('x'), {});
});

test('呪いを解くと、どの手段でも数える', () => {
  const town = newTown();

  // 巻物
  {
    const world = startRun('d2', town, { seed: 21 });
    const rng = new Rng(21);
    const cursed = makeItem('woodStick', rng, { cursed: true }, () => world.run.nextUid++);
    world.player.inventory.push(cursed);
    ITEM_EFFECTS.uncurse!({ world, user: world.player, item: cursed });
    assert.equal(world.run.tally?.['cure:curse'], 1, '巻物で数えていない');
    assert.equal(cursed.cursed, false, '解けていない');
  }

  // 壺（purifyPot）
  {
    const world = startRun('d2', town, { seed: 22 });
    const rng = new Rng(22);
    const cursed = makeItem('woodShield', rng, { cursed: true }, () => world.run.nextUid++);
    const pot = makeItem('purifyPot', rng, {}, () => world.run.nextUid++);
    ITEM_EFFECTS.purifyPot!({ world, user: world.player, item: pot, target: cursed });
    assert.equal(world.run.tally?.['cure:curse'], 1, '壺で数えていない');
  }

  // 村の鍛冶
  {
    const t2 = newTown();
    const rng = new Rng(23);
    const cursed = makeItem('woodStick', rng, { cursed: true }, () => t2.nextUid++);
    t2.storage.push(cursed);
    t2.gitan = 10000;
    assert.ok(smithUncurse(t2, cursed.uid), '鍛冶が失敗した');
    assert.equal(t2.tally?.['cure:curse'], 1, '鍛冶で数えていない');
  }
});

test('ターンを使った操作は種類ごとに数える', () => {
  const town = newTown();
  const world = startRun('d2', town, { seed: 24 });
  play(world, 30, 7);
  assert.ok((world.run.tally?.['act:move'] ?? 0) > 0, '移動を数えていない');
  assert.equal(world.run.tally?.act, world.run.tally?.['act:move'], '総数と内訳が食い違う');

  // ターンを消費しなかった操作は数えない
  const before = world.run.tally?.act ?? 0;
  stepTurn(world, { type: 'none' });
  assert.equal(world.run.tally?.act ?? 0, before, 'ターンを使わない操作を数えた');
});
