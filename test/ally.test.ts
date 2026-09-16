import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TownState } from '../src/core/types.js';
import { at } from '../src/dungeon/tilemap.js';
import { makeMonster } from '../src/dungeon/spawn.js';
import { enterFloor, startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { applyTrapEffect } from '../src/game/trapEffects.js';
import { killActor } from '../src/game/combat.js';

/**
 * 仲間の検査。
 *
 * 分身の巻物で仲間を作れるが、連れ歩くと壊れる所が 3 つあった。
 * 相棒（ガチャ）を載せる前に、土台をここで固定する。
 */

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1', 'd2', 'd3', 'd4'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    knownItems: {}, nicknames: {}, stones: 0,
  };
}

/** プレイヤーの隣の、歩ける床 */
function beside(world: ReturnType<typeof startRun>): { x: number; y: number } | null {
  const vecs = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];
  const p = world.player.pos;
  for (const v of vecs) {
    const q = { x: p.x + v[0], y: p.y + v[1] };
    if (at(world.map, q.x, q.y)?.kind === 'floor' && !world.actorAt(q)) return q;
  }
  return null;
}

test('仲間は店主に向かって空振りし続けない', () => {
  // 店主は run.monsters に入っているが敵ではない。除かないと
  // 仲間が最寄りの相手として選び、その場から動かなくなる
  const world = startRun('d2', newTown(), { seed: 12 });
  const spotA = beside(world);
  assert.ok(spotA);
  const keeper = makeMonster(world, 'shopkeeper', spotA!, 'shopkeeper');
  world.addMonster(keeper);
  const spotB = beside(world);
  assert.ok(spotB);
  const ally = makeMonster(world, 'ratField', spotB!, 'ally');
  world.addMonster(ally);

  let whiffs = 0;
  for (let i = 0; i < 20; i++) {
    stepTurn(world, { type: 'wait' });
    for (const e of world.drainEvents()) {
      if (e.t === 'message' && e.text.includes('空振り')) whiffs++;
    }
  }
  assert.ok(whiffs <= 2, `20 ターンで ${whiffs} 回 空振りした`);
  assert.equal(keeper.alive, true, '店主を倒してしまった');
});

test('仲間が倒れたときに「たおした！」と出ない', () => {
  const world = startRun('d2', newTown(), { seed: 13 });
  const spot = beside(world);
  assert.ok(spot);
  const ally = makeMonster(world, 'ratField', spot!, 'ally');
  world.addMonster(ally);
  killActor(world, null, ally);
  const texts = world.drainEvents()
    .filter((e) => e.t === 'message')
    .map((e) => (e as { text: string }).text);
  assert.equal(
    texts.some((t) => t.includes('たおした')), false,
    `仲間の死に「たおした」が出た: ${texts.join(' / ')}`,
  );
  assert.ok(texts.some((t) => t.includes('倒れた')), `想定の文が出ていない: ${texts.join(' / ')}`);
});

test('仲間は落とし穴で消えず、次の階で合流する', () => {
  const world = startRun('d2', newTown(), { seed: 14 });
  const spot = beside(world);
  assert.ok(spot);
  const ally = makeMonster(world, 'ratField', spot!, 'ally');
  world.addMonster(ally);
  assert.equal(world.run.allies.length, 1);

  applyTrapEffect(world, ally, 'spike');
  world.drainEvents();
  assert.equal(world.run.allies.length, 0, 'その階からは消える');
  assert.equal(ally.alive, true, '落とし穴で死んでしまった');
  assert.equal(world.pendingRejoin.length, 1, '合流待ちに入っていない');

  enterFloor(world, 2);
  world.drainEvents();
  assert.equal(world.run.allies.length, 1, '次の階で合流していない');
  assert.equal(world.pendingRejoin.length, 0, '合流待ちが残っている');
});
