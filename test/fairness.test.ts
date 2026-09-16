import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TownState } from '../src/core/types.js';
import { chebyshev } from '../src/core/geom.js';
import { at } from '../src/dungeon/tilemap.js';
import { makeMonster } from '../src/dungeon/spawn.js';
import { addToInventory, makeItem } from '../src/game/inventory.js';
import { samePoint } from '../src/core/geom.js';
import { enterFloor, startRun } from '../src/game/run.js';
import { restTurns, stepTurn, whyCannotRest } from '../src/game/turn.js';
import { applyStatus } from '../src/game/status.js';

/**
 * 「プレイヤーが手を打つ機会を与えられないまま損をする」を禁じる検査。
 *
 * 実プレイで次の 3 つが報告された。どれも同じ形をしている。
 *   ・休憩が長いので長押ししていると、止まるべき所で止まらず殴られる
 *   ・モンスターハウスで、自分が動く前に殴られる
 *   ・階段を降りた足元にワナがあり、1 手も打てずに作動する
 */

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1', 'd2', 'd3', 'd4', 'dl', 'ex'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}

test('敵の隣で「休む」を選んでも、1 ターンも献上しない', () => {
  // 以前は「1 ターン進めてから危険を見る」構造だったため、
  // 選ぶたびに必ず 1 発もらっていた
  let rested = 0;
  let damage = 0;
  let cases = 0;
  for (let seed = 0; seed < 40; seed++) {
    const world = startRun('d2', newTown(), { seed: 200 + seed });
    const p = world.player;
    p.hp = Math.floor(p.maxHp / 2);
    const spot = { x: p.pos.x + 1, y: p.pos.y };
    if (at(world.map, spot.x, spot.y)?.kind !== 'floor') continue;
    world.addMonster(makeMonster(world, 'ratField', spot));
    cases++;
    const before = p.hp;
    rested += restTurns(world, 200);
    damage += Math.max(0, before - p.hp);
  }
  assert.ok(cases >= 10, `検査できた場面が ${cases} 件しかない`);
  assert.equal(rested, 0, '敵が隣にいるのに休んでしまった');
  assert.equal(damage, 0, '休もうとしただけで殴られた');
});

test('休めない時は、その理由が分かる', () => {
  const world = startRun('d2', newTown(), { seed: 7 });
  const p = world.player;
  p.hp = 1;
  const spot = { x: p.pos.x + 1, y: p.pos.y };
  if (at(world.map, spot.x, spot.y)?.kind === 'floor') {
    world.addMonster(makeMonster(world, 'ratField', spot));
    assert.equal(whyCannotRest(world), '敵が 近くにいて 休めない。');
  }
  p.hp = p.maxHp;
  assert.equal(whyCannotRest(world), 'HP は 満タンだ。');
});

test('店主の隣でも、無害な状態でも休める', () => {
  // 「敵が近い」「何か状態異常が付いている」で一律に止めると、
  // 店の中や浮遊中に永久に休めなくなる
  const shop = startRun('d2', newTown(), { seed: 11 });
  shop.player.hp = 1;
  const beside = { x: shop.player.pos.x + 1, y: shop.player.pos.y };
  if (at(shop.map, beside.x, beside.y)?.kind === 'floor') {
    shop.addMonster(makeMonster(shop, 'shopkeeper', beside, 'shopkeeper'));
    assert.ok(restTurns(shop, 200) > 0, '店主の隣で休めない');
  }

  const buffed = startRun('d2', newTown(), { seed: 12 });
  buffed.player.hp = 1;
  applyStatus(buffed, buffed.player, 'levitate');
  assert.ok(restTurns(buffed, 200) > 0, '浮遊しているだけで休めない');
});

test('モンスターハウスが発動したターンには殴られない', () => {
  let damage = 0;
  let adjacent = 0;
  let cases = 0;
  for (let seed = 0; seed < 60; seed++) {
    const world = startRun('d2', newTown(), { seed: 400 + seed });
    enterFloor(world, 8);
    world.drainEvents();
    const p = world.player;
    p.maxHp = 200;
    p.hp = 200;
    const tile = at(world.map, p.pos.x, p.pos.y);
    const room = world.map.rooms.find((r) => r.id === tile?.roomId);
    if (!room) continue;
    room.monsterHouse = 'normal';
    room.houseTriggered = false;
    cases++;

    const before = p.hp;
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
    damage += Math.max(0, before - p.hp);
    adjacent += world.run.monsters.filter((m) => chebyshev(m.pos, p.pos) <= 1).length;
  }
  assert.ok(cases >= 30, `検査できた場面が ${cases} 件しかない`);
  assert.equal(damage, 0, 'ハウスが湧いたその場で殴られた');
  assert.equal(adjacent, 0, '真隣に湧いている');
});

test('湧いたばかりの敵は、そのターンには動かない', () => {
  const world = startRun('d2', newTown(), { seed: 3 });
  const p = world.player;
  const spot = { x: p.pos.x + 1, y: p.pos.y };
  if (at(world.map, spot.x, spot.y)?.kind !== 'floor') return;
  const m = world.addMonster(makeMonster(world, 'ratField', spot));
  assert.equal(m.actedThisTurn, 1, '湧いた直後に「行動済み」の印が立っていない');
});

test('階を降りた足元にワナも階段も店も無い', () => {
  let floors = 0;
  let onTrap = 0;
  let onStairs = 0;
  let overlapped = 0;
  for (const id of ['d1', 'd2', 'd3', 'd4']) {
    for (let seed = 0; seed < 25; seed++) {
      const world = startRun(id, newTown(), { seed: 900 + seed });
      for (let depth = 1; depth <= Math.min(6, world.dungeon.depth); depth++) {
        enterFloor(world, depth);
        world.drainEvents();
        floors++;
        const p = world.player.pos;
        const t = at(world.map, p.x, p.y);
        if (t?.trap) onTrap++;
        if (p.x === world.map.stairs.x && p.y === world.map.stairs.y) onStairs++;
        if (world.run.monsters.some((m) => m.pos.x === p.x && m.pos.y === p.y)) overlapped++;
      }
    }
  }
  assert.ok(floors >= 300, `検査できたフロアが ${floors} 件しかない`);
  assert.equal(onTrap, 0, `${onTrap}/${floors} フロアでワナの上から始まった`);
  assert.equal(onStairs, 0, `${onStairs}/${floors} フロアで階段の上から始まった`);
  assert.equal(overlapped, 0, `${overlapped}/${floors} フロアで敵と重なって始まった`);
});

test('置いた道具を、その場で拾い直さない', () => {
  // 足元のマスの処理が「動いたかどうか」に関係なく毎ターン走っていたため、
  // 置いた瞬間に「足元にアイテムがある」と判定して拾い直していた
  let placed = 0;
  let regrabbed = 0;
  for (const id of ['d1', 'd2', 'd3']) {
    for (let seed = 0; seed < 40; seed++) {
      const world = startRun(id, newTown(), { seed: 700 + seed });
      const p = world.player;
      if (world.floorItemAt(p.pos)) continue;
      const item = makeItem('healHerb', world.rng, {}, () => world.nextUid());
      addToInventory(p, item);
      stepTurn(world, { type: 'place', uid: item.uid });
      world.drainEvents();
      placed++;
      if (p.inventory.some((i) => i.uid === item.uid)) regrabbed++;
    }
  }
  assert.ok(placed >= 60, `検査できた場面が ${placed} 件しかない`);
  assert.equal(regrabbed, 0, `${regrabbed}/${placed} 件でその場で拾い直した`);
});

test('置いて、離れて、戻れば拾える', () => {
  const world = startRun('d2', newTown(), { seed: 3 });
  const p = world.player;
  const item = makeItem('healHerb', world.rng, {}, () => world.nextUid());
  addToInventory(p, item);

  const vecs = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];
  let dir = -1;
  for (let d = 0; d < 8; d++) {
    const q = { x: p.pos.x + vecs[d][0], y: p.pos.y + vecs[d][1] };
    if (at(world.map, q.x, q.y)?.kind === 'floor' && !world.actorAt(q)) { dir = d; break; }
  }
  assert.ok(dir >= 0, '隣に歩ける床が無い');

  stepTurn(world, { type: 'place', uid: item.uid });
  world.drainEvents();
  assert.equal(p.inventory.some((i) => i.uid === item.uid), false, '置けていない');

  stepTurn(world, { type: 'move', dir: dir as never });
  world.drainEvents();
  stepTurn(world, { type: 'move', dir: ((dir + 4) % 8) as never });
  world.drainEvents();
  assert.ok(
    p.inventory.some((i) => i.defId === 'healHerb'),
    '置いた場所へ戻っても拾えない',
  );
});

test('ワナは踏んだ時だけ作動する', () => {
  // 歩いて乗れば必ず作動し、同じマスで足踏みしても二度目は作動しない
  let walked = 0;
  let firedOnEntry = 0;
  const vecs = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];
  for (let seed = 0; seed < 80; seed++) {
    const world = startRun('d3', newTown(), { seed: 100 + seed });
    const p = world.player;
    p.maxHp = 500;
    p.hp = 500;
    let dir = -1;
    let spot: { x: number; y: number } | null = null;
    for (let d = 0; d < 8; d++) {
      const q = { x: p.pos.x + vecs[d][0], y: p.pos.y + vecs[d][1] };
      const t = at(world.map, q.x, q.y);
      if (t?.kind === 'floor' && !world.actorAt(q) && !t.trap && !t.shop) {
        dir = d; spot = q; break;
      }
    }
    if (dir < 0 || !spot) continue;
    at(world.map, spot.x, spot.y)!.trap = { defId: 'arrow', revealed: false, used: false };
    stepTurn(world, { type: 'move', dir: dir as never });
    const events = world.drainEvents();
    if (!samePoint(p.pos, spot)) continue;
    walked++;
    if (events.some((e) => e.t === 'trap' && samePoint(e.pos, spot!))) firedOnEntry++;
  }
  assert.ok(walked >= 40, `検査できた場面が ${walked} 件しかない`);
  assert.equal(firedOnEntry, walked, `${walked} 件中 ${firedOnEntry} 件しか作動しなかった`);

  // 足踏みでは再作動しない
  let standing = 0;
  let refired = 0;
  for (let seed = 0; seed < 40; seed++) {
    const world = startRun('d3', newTown(), { seed: 500 + seed });
    const p = world.player;
    p.maxHp = 500;
    p.hp = 500;
    const here = at(world.map, p.pos.x, p.pos.y);
    if (!here || here.kind !== 'floor') continue;
    here.trap = { defId: 'arrow', revealed: true, used: false };
    const home = { ...p.pos };
    standing++;
    for (let i = 0; i < 5; i++) {
      stepTurn(world, { type: 'wait' });
      const events = world.drainEvents();
      if (events.some((e) => e.t === 'trap' && samePoint(e.pos, home))) refired++;
      p.hp = p.maxHp;
    }
  }
  assert.ok(standing >= 20, `検査できた場面が ${standing} 件しかない`);
  assert.equal(refired, 0, `足踏みで ${refired} 回 再作動した`);
});
