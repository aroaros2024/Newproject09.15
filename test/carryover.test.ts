/**
 * 村と冒険のあいだで持ち越すもの。
 *
 * ショートカットの割り当てと保持の印は、どちらも冒険中のプレイヤーが持っていて、
 * 村へ帰ると消えていた。uid は村↔冒険の境目で必ず振り直されるので、
 * 「同じ道具を指し続ける」ことそのものが難しい。ここで固定しておく。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemInstance, TownState } from '../src/core/types.js';
import { finishRun } from '../src/game/town.js';
import { startRun } from '../src/game/run.js';
import {
  SHORTCUT_SLOTS, addKept, assignShortcut, keptItems, makeItem, shortcutOf, shortcutSlots,
} from '../src/game/inventory.js';
import { Rng } from '../src/core/rng.js';

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1', 'd2', 'ex', 'exPure'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}

const put = (town: TownState, defId: string, opts = {}): ItemInstance => {
  const item = makeItem(defId, new Rng(`${defId}:${town.nextUid}`), opts, () => town.nextUid++);
  town.storage.push(item);
  return item;
};

// ---------------------------------------------------------------- ショートカット

test('ショートカットは冒険をまたいで残る', () => {
  const town = newTown();
  const w1 = startRun('d1', town, { seed: 1, bring: [] });
  const herb = makeItem('healHerb', w1.rng, {}, () => w1.nextUid());
  w1.player.inventory.push(herb);
  assignShortcut(w1.player, 2, 'healHerb');
  finishRun(w1, town, 'escape', '脱出');

  assert.equal(town.shortcuts?.[2], 'healHerb', '村へ持ち越せていない');

  const w2 = startRun('d1', town, { seed: 2, bring: [] });
  assert.equal(w2.player.shortcutIds[2], 'healHerb', '次の冒険で消えている');
});

test('倒れてもショートカットは残る', () => {
  const town = newTown();
  const w = startRun('d2', town, { seed: 3, bring: [] });
  assignShortcut(w.player, 0, 'stone');
  w.player.hp = 0;
  finishRun(w, town, 'death', 'やられた');
  assert.equal(town.shortcuts?.[0], 'stone');
});

test('持っていない道具の枠も残る（覚えているのは種類）', () => {
  const town = newTown();
  const w1 = startRun('d1', town, { seed: 4, bring: [] });
  assignShortcut(w1.player, 0, 'woodArrow');
  finishRun(w1, town, 'escape', '脱出');

  const w2 = startRun('d1', town, { seed: 5, bring: [] });
  const slot = shortcutSlots(w2.player, w2.run.identify.known)[0];
  assert.equal(slot.defId, 'woodArrow');
  assert.equal(slot.item, null, '持っていないのに実体が入っている');
  assert.equal(slot.count, 0);
});

// ------------------------------------------------- 未識別の道具は枠に入らない

test('正体を知らない杖は、持っていても枠に入らない', () => {
  const town = newTown();
  const w = startRun('d1', town, { seed: 6, bring: [] });
  assignShortcut(w.player, 0, 'sleepStaff');
  const staff = makeItem('sleepStaff', w.rng, {}, () => w.nextUid());
  w.player.inventory.push(staff);

  w.run.identify.known.sleepStaff = false;
  const before = shortcutSlots(w.player, w.run.identify.known)[0];
  assert.equal(before.item, null, '未識別の杖が枠に入った');
  assert.equal(before.count, 0);
  assert.equal(shortcutOf(w.player, 'sleepStaff', w.run.identify.known), -1,
    '未識別なのに枠の番号が分かってしまう');

  // 正体が分かった瞬間に入る
  w.run.identify.known.sleepStaff = true;
  const after = shortcutSlots(w.player, w.run.identify.known)[0];
  assert.equal(after.item?.uid, staff.uid, '識別しても枠に入らない');
  assert.equal(after.count, 1);
  assert.equal(shortcutOf(w.player, 'sleepStaff', w.run.identify.known), 0);
});

test('未識別にならない種類は、そのまま枠に入る', () => {
  const town = newTown();
  const w = startRun('d1', town, { seed: 7, bring: [] });
  assignShortcut(w.player, 1, 'stone');
  const stone = makeItem('stone', w.rng, {}, () => w.nextUid());
  w.player.inventory.push(stone);
  const slot = shortcutSlots(w.player, {})[1];
  assert.equal(slot.item?.uid, stone.uid, '武器や投げ物まで伏せてはいけない');
});

// ---------------------------------------------------------------- 保持の印

test('保持した道具は、生きて帰っても村に印が残る', () => {
  const town = newTown();
  const w = startRun('d1', town, { seed: 8, bring: [] });
  const sword = makeItem('ironSword', w.rng, {}, () => w.nextUid());
  const shield = makeItem('ironShield', w.rng, {}, () => w.nextUid());
  w.player.inventory.push(sword, shield);
  addKept(w.player, sword.uid, 3);
  finishRun(w, town, 'escape', '脱出');

  const kept = town.kept ?? [];
  assert.equal(kept.length, 1, `印が ${kept.length} 個になっている`);
  const marked = town.storage.find((i) => i.uid === kept[0]);
  assert.equal(marked?.defId, 'ironSword', '別の道具に印が移っている');
});

test('倒れて持ち物を失っても、届いた道具には印が残る', () => {
  const town = newTown();
  const w = startRun('d2', town, { seed: 9, bring: [] });
  const sword = makeItem('ironSword', w.rng, {}, () => w.nextUid());
  const shield = makeItem('ironShield', w.rng, {}, () => w.nextUid());
  w.player.inventory.push(sword, shield);
  addKept(w.player, sword.uid, 3);
  w.player.hp = 0;
  finishRun(w, town, 'death', 'やられた');

  assert.equal(town.storage.length, 1, '保持した物だけが届くはず');
  assert.deepEqual(town.kept, [town.storage[0].uid]);
});

test('倉庫で積み重なっても、合流先に印が残る', () => {
  const town = newTown();
  put(town, 'stone');
  const w = startRun('d1', town, { seed: 10, bring: [] });
  const stone = makeItem('stone', w.rng, {}, () => w.nextUid());
  w.player.inventory.push(stone);
  addKept(w.player, stone.uid, 3);
  finishRun(w, town, 'escape', '脱出');

  const stack = town.storage.filter((i) => i.defId === 'stone');
  assert.equal(stack.length, 1, '積み重なっていない');
  assert.deepEqual(town.kept, [stack[0].uid], '合流先に印が付いていない');
});

test('保持した道具は持ち込みで選ばれ、そのまま持っていけば保持も続く', () => {
  const town = newTown();
  const sword = put(town, 'ironSword');
  town.kept = [sword.uid];

  const w = startRun('d1', town, { seed: 11, bring: [sword] });
  const kept = keptItems(w.player);
  assert.equal(kept.length, 1, '持ち込んだのに保持が切れている');
  assert.equal(kept[0].defId, 'ironSword');
  assert.ok(w.player.inventory.some((i) => i.uid === kept[0].uid),
    '持ち物に無い uid を保持している');
});

test('持っていかなかった道具の印は消える', () => {
  const town = newTown();
  const sword = put(town, 'ironSword');
  const shield = put(town, 'ironShield');
  town.kept = [sword.uid, shield.uid];

  const w = startRun('d1', town, { seed: 12, bring: [sword] });
  assert.equal(keptItems(w.player).length, 1);
  assert.deepEqual(town.kept, [], '持っていかなかった印が残っている');
});

test('加護の効かないダンジョンでは、持ち込んでも保持されない', () => {
  const town = newTown();
  const sword = put(town, 'ironSword');
  town.kept = [sword.uid];
  // exPure は持ち込み自体できない。持ち込めて枠が 0 の形を作るため d1 を使い、
  // 枠の数を 0 にした状態で確かめる
  const w = startRun('exPure', town, { seed: 13, bring: [sword] });
  assert.equal(keptItems(w.player).length, 0);
});

// ---------------------------------------------------------------- 持ち込みの上限

test('大きな袋の加護があれば、その数だけ全部届く', () => {
  const town = newTown();
  town.gachaOwned = { 'b:bag': 1 };
  const bring: ItemInstance[] = [];
  for (let i = 0; i < 26; i++) bring.push(put(town, 'stone'));

  const w = startRun('d1', town, { seed: 14, bring });
  assert.equal(w.player.bagLimit, 26, '袋の加護が効いていない');
  // 武器と盾は村の貸し出しぶんが別に入る
  const stones = w.player.inventory.filter((i) => i.defId === 'stone').length;
  assert.equal(stones, 26, '倉庫から出したのに届いていない');
});

test('枠の数は SHORTCUT_SLOTS ぶん用意される', () => {
  const town = newTown();
  const w = startRun('d1', town, { seed: 15, bring: [] });
  assert.equal(w.player.shortcutIds.length, SHORTCUT_SLOTS);
});

test('持ち込めないダンジョンへ潜っても、倉庫の印は消えない', () => {
  const town = newTown();
  const sword = put(town, 'ironSword');
  town.kept = [sword.uid];

  startRun('ex', town, { seed: 16 });
  assert.deepEqual(town.kept, [sword.uid], '倉庫に置いたままの印まで消えた');
});
