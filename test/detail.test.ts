/**
 * 説明欄に出す文と、壺の容量の数え方。
 *
 * 攻撃力も付いている印も、画面を 1 つ余計に開かないと読めなかった。
 * 壺は「中身が残らない壺」が容量をまったく消費せず、実質無限に使えていた。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IdentifyState, TownState } from '../src/core/types.js';
import { ALL_ITEMS } from '../src/data/items/all.js';
import { getItem, potHoldsItems } from '../src/data/registry.js';
import { itemDetail } from '../src/game/naming.js';
import { makeItem, sortInventory } from '../src/game/inventory.js';
import { sortStorage } from '../src/game/town.js';
import { useItem } from '../src/game/itemActions.js';
import { startRun } from '../src/game/run.js';
import { Rng } from '../src/core/rng.js';

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}

const knownAll = (): IdentifyState => {
  const known: Record<string, boolean> = {};
  for (const d of ALL_ITEMS) known[d.id] = true;
  return { alias: {}, known, nicknames: {} };
};

// ---------------------------------------------------------------- 説明欄

test('説明欄は修正値を足した攻撃力を出す', () => {
  let uid = 1;
  const sword = makeItem('ironSword', new Rng('d'), {}, () => uid++);
  sword.plus = 3;
  sword.plusKnown = true;
  const text = itemDetail(sword, knownAll());
  assert.match(text, /攻撃力 9\+3 = 12/, text);
});

test('修正値が分かっていなければ伏せる', () => {
  let uid = 1;
  const sword = makeItem('ironSword', new Rng('d2'), {}, () => uid++);
  sword.plus = 3;
  sword.plusKnown = false;
  assert.match(itemDetail(sword, knownAll()), /修正値 不明/);
});

test('説明欄は 3 行を超えない', () => {
  let uid = 1;
  const st = knownAll();
  for (const def of ALL_ITEMS) {
    for (const runes of [[], ['crit', 'crit', 'flame']]) {
      const item = makeItem(def.id, new Rng(def.id), {}, () => uid++);
      if (def.kind === 'weapon' || def.kind === 'shield') item.runes = [...runes];
      item.plus = 3;
      item.plusKnown = true;
      const lines = itemDetail(item, st).split('\n');
      assert.ok(lines.length <= 3, `${def.id}: ${lines.length} 行になっている`);
      for (const line of lines) {
        assert.ok(line.length <= 48, `${def.id}: 1 行が長すぎる（${line.length} 文字）`);
      }
    }
  }
});

test('正体を知らない物は数字を出さない', () => {
  let uid = 1;
  const staff = makeItem('sleepStaff', new Rng('d3'), {}, () => uid++);
  const text = itemDetail(staff, { alias: {}, known: {}, nicknames: {} });
  assert.ok(!text.includes('あと'), text);
});

// ---------------------------------------------------------------- 並べ替え

test('倉庫の並びは持ち物の整理と同じ順番になる', () => {
  const town = newTown();
  const ids = ['riceBall', 'healHerb', 'ironShield', 'storagePot',
    'identifyScroll', 'ironSword', 'sleepStaff', 'stone'];
  const rng = new Rng('sort');
  for (const id of ids) town.storage.push(makeItem(id, rng, {}, () => town.nextUid++));
  const player = { inventory: ids.map((id) => makeItem(id, rng, {}, () => town.nextUid++)) };

  sortStorage(town);
  sortInventory(player as never);
  assert.deepEqual(
    town.storage.map((i) => i.defId),
    player.inventory.map((i) => i.defId),
    '倉庫と持ち物で順番が違う',
  );
});

test('並べ替えても倉庫の中身は増減しない', () => {
  const town = newTown();
  const rng = new Rng('sort2');
  for (const id of ['stone', 'ironSword', 'healHerb', 'storagePot']) {
    town.storage.push(makeItem(id, rng, {}, () => town.nextUid++));
  }
  const before = new Set(town.storage.map((i) => i.uid));
  sortStorage(town);
  assert.deepEqual(new Set(town.storage.map((i) => i.uid)), before);
});

// ---------------------------------------------------------------- 壺の容量

/** 壺 1 つと、入れる物を n 個持った状態を作る */
function withPot(potId: string, n: number) {
  const world = startRun('d1', newTown(), { seed: 20, bring: [] });
  const pot = makeItem(potId, world.rng, {}, () => world.nextUid());
  world.player.inventory.push(pot);
  world.run.identify.known[potId] = true;
  const food = [];
  for (let i = 0; i < n; i++) {
    const it = makeItem('riceBall', world.rng, {}, () => world.nextUid());
    world.player.inventory.push(it);
    food.push(it);
  }
  return { world, pot, food };
}

test('換金の壺は容量の回数しか使えず、使い切ると割れる', () => {
  const cap = getItem('cashPot').kind === 'pot' ? (getItem('cashPot') as { capacity: number }).capacity : 0;
  const { world, pot, food } = withPot('cashPot', cap + 1);
  for (let i = 0; i < cap; i++) {
    assert.equal(useItem(world, pot.uid, food[i].uid).tookTurn, true, `${i + 1} 回目`);
  }
  assert.ok(!world.player.inventory.some((i) => i.uid === pot.uid), '使い切っても割れていない');
});

test('穴の壺・倉庫の壺も同じ回数で止まる', () => {
  for (const id of ['holePot', 'warehousePot']) {
    const cap = (getItem(id) as { capacity: number }).capacity;
    const { world, pot, food } = withPot(id, cap);
    for (let i = 0; i < cap; i++) useItem(world, pot.uid, food[i].uid);
    assert.ok(!world.player.inventory.some((i) => i.uid === pot.uid), `${id} が割れていない`);
  }
});

test('しまっておく壺は、今までどおり中身の数で止まる', () => {
  const cap = (getItem('storagePot') as { capacity: number }).capacity;
  const { world, pot, food } = withPot('storagePot', cap + 1);
  for (let i = 0; i < cap; i++) useItem(world, pot.uid, food[i].uid);
  const held = world.player.inventory.find((i) => i.uid === pot.uid);
  assert.ok(held, 'しまう壺が割れてしまった');
  assert.equal(held!.contents.length, cap);
  assert.equal(useItem(world, pot.uid, food[cap].uid).tookTurn, false, 'いっぱいなのに入った');
});

test('中身が残る壺と残らない壺の区別は 1 箇所だけ', () => {
  for (const id of ['storagePot', 'synthesisPot', 'unbreakablePot']) {
    assert.equal(potHoldsItems(getItem(id)), true, id);
  }
  for (const id of ['cashPot', 'holePot', 'warehousePot', 'identifyPot']) {
    assert.equal(potHoldsItems(getItem(id)), false, id);
  }
});
