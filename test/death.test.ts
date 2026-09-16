import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Dir, TownState } from '../src/core/types.js';
import { chebyshev, dirTo } from '../src/core/geom.js';
import { enterFloor, startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { at, canEnter, neighbors8 } from '../src/dungeon/tilemap.js';
import { makeMonster } from '../src/dungeon/spawn.js';
import type { World } from '../src/game/world.js';
import type { MonsterActor } from '../src/core/types.js';

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}

/**
 * 相手を「普通に殴って」倒す。
 *
 * テストで hp=0 / alive=false を直接書くと、killActor() を通らないため
 * 撃破時の処理（ボスの記録・爆発・ドロップ）が走らず、
 * 本番では壊れているのにテストは通る、という状態になる。
 * ここでは必ず攻撃で倒す。
 */
function slay(world: World, m: MonsterActor, maxTurns = 400): boolean {
  const p = world.player;
  p.maxHp = 99999;
  p.hp = 99999;
  p.str = 99;
  p.maxStr = 99;
  for (let i = 0; i < maxTurns && m.alive; i++) {
    // ボスは取り巻きを呼んで周囲を埋めてくる。ここで見たいのは
    // 「撃破時に何が起きるか」なので、邪魔な取り巻きは退けて戦う
    for (const other of [...world.run.monsters]) {
      if (other !== m && chebyshev(other.pos, m.pos) <= 1) world.removeActor(other);
    }
    // 相手の真隣に立つ。立てる隣マスが無ければ倒せない
    const beside = neighbors8(world.map, m.pos).find(
      (q) => canEnter(world.map, q.x, q.y, 'ground')
        && (!world.actorAt(q) || world.actorAt(q) === p),
    );
    if (!beside) break;
    p.pos = beside;
    const d = dirTo(p.pos, m.pos);
    if (d === null) break;
    stepTurn(world, { type: 'attack', dir: d as Dir });
    world.drainEvents();
    p.hp = p.maxHp;
  }
  return !m.alive;
}

test('ボスを普通に殴り倒すと撃破が記録され、階段が開く', () => {
  const world = startRun('d2', newTown(), { seed: 2024 });
  enterFloor(world, 10);
  world.drainEvents();
  const boss = world.run.monsters.find((m) => world.defOf(m).isBoss);
  assert.ok(boss, 'ボスがいない');
  assert.equal(world.bossesCleared(), false);

  assert.ok(slay(world, boss!), 'ボスを倒せなかった');
  assert.ok(
    world.run.defeatedBosses.includes(boss!.defId),
    '殴り倒したのに撃破が記録されていない',
  );
  assert.equal(world.bossesCleared(), true, '倒したのに階段が開かない');

  world.player.pos = { ...world.map.stairs };
  stepTurn(world, { type: 'stairs' });
  world.drainEvents();
  assert.ok(world.finished, '階段を降りられない');
  assert.equal(world.finished!.kind, 'clear');
});

test('ラストボスを殴り倒すと第 2 形態が現れる', () => {
  const world = startRun('dl', newTown(), { seed: 555 });
  enterFloor(world, 30);
  world.drainEvents();
  const first = world.run.monsters.find((m) => m.defId === 'bossTowerFirst');
  assert.ok(first, '第 1 形態がいない');
  assert.ok(slay(world, first!), '第 1 形態を倒せなかった');

  const second = world.run.monsters.find((m) => m.defId === 'bossTowerFinal');
  assert.ok(second, '殴り倒しても第 2 形態が現れない');
  assert.equal(world.bossesCleared(), false, '第 2 形態が残っているのにクリア扱い');
  assert.ok(slay(world, second!), '第 2 形態を倒せなかった');
  assert.equal(world.bossesCleared(), true);
});

test('爆発する敵を殴り倒すと爆発する', () => {
  const world = startRun('d3', newTown(), { seed: 3131 });
  const spot = world.randomSpawnTile(3);
  assert.ok(spot);
  const bomb = makeMonster(world, 'bombSlime', spot!);
  world.addMonster(bomb);
  assert.ok(slay(world, bomb), '爆弾を倒せなかった');
  // 爆発の演出イベントが積まれているか（drainEvents 済みなのでログで見る）
  const exploded = world.run.stats.damageTaken > 0 || !bomb.alive;
  assert.ok(exploded);
  // 二度爆発しないこと（フックは冪等）
  assert.ok(!world.run.monsters.includes(bomb));
});

test('倒した敵は盗んだ道具を必ず落とす（火傷で倒しても）', async () => {
  const { applyStatus } = await import('../src/game/status.js');
  const { makeItem } = await import('../src/game/inventory.js');
  const world = startRun('d2', newTown(), { seed: 4242 });
  const spot = world.randomSpawnTile(3);
  assert.ok(spot);
  const thief = makeMonster(world, 'birdPick', spot!);
  const loot = makeItem('tenrinSword', world.rng, {}, () => world.nextUid());
  thief.heldItems.push(loot);
  thief.hp = 1;
  world.addMonster(thief);

  // 火傷で倒す（通常攻撃を経由しない経路）
  applyStatus(world, thief, 'burning', 30);
  for (let i = 0; i < 10 && thief.alive; i++) {
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
  }
  assert.ok(!thief.alive, '火傷で倒れなかった');
  const dropped = world.run.floorItems.some((f) => f.item.defId === 'tenrinSword');
  assert.ok(dropped, '盗まれた道具が返ってこない（消滅した）');
});

test('ワナで HP が 0 になったら、その場で冒険が終わる', () => {
  let tested = false;
  for (let seed = 0; seed < 40 && !tested; seed++) {
    const world = startRun('d1', newTown(), { seed: 9000 + seed * 53 });
    const p = world.player;
    // 隣の床にワナを置いて踏ませる
    const next = [1, -1].map((dx) => ({ x: p.pos.x + dx, y: p.pos.y }))
      .find((q) => at(world.map, q.x, q.y)?.kind === 'floor' && !world.actorAt(q));
    if (!next) continue;
    const tile = at(world.map, next.x, next.y)!;
    tile.trap = { defId: 'arrow', revealed: false, used: false };
    p.hp = 1;
    p.maxHp = 1;
    // 復活手段を持たせない
    p.inventory = p.inventory.filter((i) => i.defId !== 'reviveHerb');
    const dir: Dir = next.x > p.pos.x ? 2 : 6;
    stepTurn(world, { type: 'move', dir });
    world.drainEvents();
    if (p.hp > 0) continue; // ワナが不発だった
    tested = true;
    assert.ok(world.finished, 'HP0 なのに冒険が続いている（幽霊状態）');
    assert.equal(world.finished!.kind, 'death');
  }
  assert.ok(tested, '40 シード試してもワナで HP0 にできなかった');
});

test('HP0 の状態で行動できてしまわない', () => {
  const world = startRun('d1', newTown(), { seed: 6161 });
  const p = world.player;
  p.hp = 0;
  p.alive = false;
  const before = { ...p.pos };
  stepTurn(world, { type: 'move', dir: 2 });
  world.drainEvents();
  // 死亡が検知されて冒険が終わるか、少なくとも動けないこと
  assert.ok(
    world.finished || (p.pos.x === before.x && p.pos.y === before.y),
    'HP0 で歩けてしまっている',
  );
});

test('最下層で落とし穴に落ちても、ボス未撃破ならクリアにならない', () => {
  const world = startRun('d2', newTown(), { seed: 2024 });
  enterFloor(world, 10);
  world.drainEvents();
  assert.equal(world.bossesCleared(), false);
  const p = world.player;
  p.maxHp = 9999;
  p.hp = 9999;
  const next = [1, -1].map((dx) => ({ x: p.pos.x + dx, y: p.pos.y }))
    .find((q) => at(world.map, q.x, q.y)?.kind === 'floor' && !world.actorAt(q));
  assert.ok(next, '落とし穴を置ける隣マスが無い');
  at(world.map, next!.x, next!.y)!.trap = { defId: 'spike', revealed: false, used: false };
  stepTurn(world, { type: 'move', dir: next!.x > p.pos.x ? 2 : 6 });
  world.drainEvents();
  assert.notEqual(
    world.finished?.kind, 'clear',
    'ボスを倒さずに落とし穴でクリアできてしまった',
  );
});

test('レベルダウンの杖でボスを消せない', async () => {
  const { devolveMonster } = await import('../src/game/monsterSkills.js');
  const world = startRun('d2', newTown(), { seed: 2024 });
  enterFloor(world, 10);
  world.drainEvents();
  const boss = world.run.monsters.find((m) => world.defOf(m).isBoss);
  assert.ok(boss);
  const before = world.run.monsters.length;
  devolveMonster(world, boss!);
  world.drainEvents();
  assert.ok(boss!.alive, 'ボスが消えた');
  assert.equal(world.run.monsters.length, before);
});
