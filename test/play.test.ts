import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import type { Action, Dir, TownState } from '../src/core/types.js';
import { DIRS, chebyshev } from '../src/core/geom.js';
import { startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { connectivityReport, at } from '../src/dungeon/tilemap.js';
import { getDungeon, getItem } from '../src/data/registry.js';
import { attackPower, defensePower, gainExp } from '../src/game/combat.js';
import { EXP_TABLE, calcDamage, expectedDamage } from '../src/game/rules.js';
import type { World } from '../src/game/world.js';

function newTown(name = 'ナギ'): TownState {
  return {
    playerName: name, storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}

/** ランダムに操作して n ターン遊ぶ。落ちないことと不変条件を確認する */
function playRandomly(world: World, turns: number, rng: Rng): number {
  let taken = 0;
  for (let i = 0; i < turns && !world.finished; i++) {
    const roll = rng.int(100);
    let action: Action;
    if (roll < 62) action = { type: 'move', dir: rng.pick(DIRS) as Dir };
    else if (roll < 74) action = { type: 'attack', dir: rng.pick(DIRS) as Dir };
    else if (roll < 82) action = { type: 'wait' };
    else if (roll < 90) action = { type: 'pickup' };
    else action = { type: 'stairs' };
    stepTurn(world, action);
    world.drainEvents();
    taken++;
    assertInvariants(world);
  }
  return taken;
}

function assertInvariants(world: World): void {
  const p = world.player;
  const map = world.map;
  assert.ok(p.hp >= 0 && p.hp <= p.maxHp, `HP が範囲外: ${p.hp}/${p.maxHp}`);
  assert.ok(p.foodX10 >= 0 && p.foodX10 <= p.maxFoodX10, `満腹度が範囲外: ${p.foodX10}`);
  assert.ok(p.level >= 1 && p.level <= 99, `レベルが範囲外: ${p.level}`);
  assert.ok(p.str >= 0 && p.str <= p.maxStr, `ちからが範囲外: ${p.str}/${p.maxStr}`);
  assert.ok(p.gitan >= 0, 'ギタンが負');
  assert.ok(p.inventory.length <= 20, `持ち物が上限を超えた: ${p.inventory.length}`);
  assert.ok(
    p.pos.x >= 0 && p.pos.y >= 0 && p.pos.x < map.width && p.pos.y < map.height,
    `プレイヤーがマップ外: ${p.pos.x},${p.pos.y}`,
  );
  const tile = at(map, p.pos.x, p.pos.y);
  assert.ok(tile && tile.kind !== 'wall', 'プレイヤーが壁の中にいる');

  // アクターが重なっていない
  const seen = new Set<string>();
  for (const a of world.livingActors()) {
    const key = `${a.pos.x},${a.pos.y}`;
    assert.ok(!seen.has(key), `アクターが重なっている: ${key}`);
    seen.add(key);
    const t = at(map, a.pos.x, a.pos.y);
    assert.ok(t, 'アクターがマップ外');
  }
  // 床アイテムが重なっていない
  const itemSpots = new Set<string>();
  for (const f of world.run.floorItems) {
    const key = `${f.pos.x},${f.pos.y}`;
    assert.ok(!itemSpots.has(key), `床アイテムが重なっている: ${key}`);
    itemSpots.add(key);
  }
}

test('冒険を始めるとフロアが作られ、プレイヤーが床に立つ', () => {
  const world = startRun('d1', newTown(), { seed: 12345 });
  assert.equal(world.run.depth, 1);
  assert.equal(world.dungeon.id, 'd1');
  assert.ok(connectivityReport(world.map).connected);
  const tile = at(world.map, world.player.pos.x, world.player.pos.y);
  assert.ok(tile && tile.kind !== 'wall');
  assert.ok(world.run.monsters.length >= 2);
  assertInvariants(world);
});

test('同じシードからは同じ冒険が再現される', () => {
  const a = startRun('d2', newTown(), { seed: 999 });
  const b = startRun('d2', newTown(), { seed: 999 });
  const rngA = new Rng(7);
  const rngB = new Rng(7);
  playRandomly(a, 200, rngA);
  playRandomly(b, 200, rngB);
  assert.equal(a.run.depth, b.run.depth);
  assert.equal(a.player.hp, b.player.hp);
  assert.equal(a.player.exp, b.player.exp);
  assert.equal(a.run.totalTurn, b.run.totalTurn);
});

test('6 ダンジョンすべてをランダム操作で回しても落ちない', () => {
  for (const id of ['d1', 'd2', 'd3', 'd4', 'dl', 'ex']) {
    for (let trial = 0; trial < 3; trial++) {
      const world = startRun(id, newTown(), { seed: 1000 + trial * 31 });
      const rng = new Rng(500 + trial);
      playRandomly(world, 400, rng);
    }
  }
});

test('階段を降り続けるとダンジョンをクリアできる', () => {
  const world = startRun('d1', newTown(), { seed: 424242 });
  const rng = new Rng(3);
  let guard = 0;
  while (!world.finished && guard++ < 6000) {
    if (world.player.pos.x === world.map.stairs.x
      && world.player.pos.y === world.map.stairs.y) {
      stepTurn(world, { type: 'stairs' });
    } else {
      // 階段へ向かって歩く
      const dx = Math.sign(world.map.stairs.x - world.player.pos.x);
      const dy = Math.sign(world.map.stairs.y - world.player.pos.y);
      const dir = dirFromVec(dx, dy) ?? (rng.pick(DIRS) as Dir);
      stepTurn(world, { type: 'move', dir });
      if (rng.percent(25)) stepTurn(world, { type: 'move', dir: rng.pick(DIRS) as Dir });
    }
    world.drainEvents();
  }
  assert.ok(world.finished, `${guard} ターンでも決着しなかった`);
  // 死ぬこともあるが、クリアか死亡のどちらかには必ず到達する
  assert.ok(['clear', 'death', 'escape'].includes(world.finished!.kind));
});

function dirFromVec(dx: number, dy: number): Dir | null {
  for (const d of DIRS) {
    const v = [
      [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ][d];
    if (v[0] === dx && v[1] === dy) return d as Dir;
  }
  return null;
}

test('もっと不思議のダンジョンは Lv1・持ち物ほぼ無しで始まる', () => {
  const town = newTown();
  town.gitan = 5000;
  const world = startRun('ex', town, { seed: 77, carryOver: { level: 40, exp: 60000, maxHp: 300, maxStr: 20 } });
  assert.equal(world.player.level, 1, 'Lv1 にリセットされていない');
  assert.equal(world.player.maxHp, 15);
  assert.equal(world.player.gitan, 0, 'ギタンを持ち込めてしまっている');
  assert.ok(world.player.inventory.length <= 1, '持ち込めてしまっている');
});

test('持ち込み可のダンジョンではレベルと道具を引き継げる', () => {
  const town = newTown();
  town.gitan = 3000;
  const bring = [{
    uid: 1, defId: 'ironSword', count: 1, plus: 3, runes: ['crit'], charges: 0,
    contents: [], cursed: false, plusKnown: true, shopPrice: 0, sealed: false,
  }];
  const world = startRun('dl', town, {
    seed: 5, bring, carryOver: { level: 30, exp: EXP_TABLE[30], maxHp: 200, maxStr: 15 },
  });
  assert.equal(world.player.level, 30);
  assert.equal(world.player.maxHp, 200);
  assert.equal(world.player.gitan, 3000);
  // 持ち込んだ武器に加えて、盾が無いので貸し出しの木の盾が付く
  assert.ok(world.player.inventory.some((i) => i.defId === 'ironSword'));
  // 倉庫の実体をそのまま持ち込まない（片方を壊してももう片方に響かない）
  const brought = world.player.inventory.find((i) => i.defId === 'ironSword')!;
  assert.notEqual(brought, bring[0], '倉庫の実体を共有している');
  brought.plus = 99;
  assert.equal(bring[0].plus, 3, '倉庫側まで書き換わっている');
  brought.runes.push('flame');
  assert.deepEqual(bring[0].runes, ['crit'], '印の配列を共有している');
});

test('ダメージ式がシレン準拠の減衰になっている', () => {
  const rng = new Rng('dmg');
  // 防御 0 なら攻撃力どおり、防御が上がるほど (15/16)^DEF で減る
  assert.equal(expectedDamage(10, 0), 10);
  assert.equal(expectedDamage(20, 5), 14);
  assert.equal(expectedDamage(40, 10), 20); // 40 * 0.9375^10 = 20.98
  assert.ok(expectedDamage(150, 50) < 12);
  // 最低 1 は保証される
  for (let i = 0; i < 2000; i++) {
    assert.ok(calcDamage(1, 200, rng) >= 1);
  }
  // 乱数の幅は 0.875〜1.117 に収まる
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < 20000; i++) {
    const d = calcDamage(1000, 0, rng);
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  assert.ok(min >= 875 && min <= 880, `下限がずれている: ${min}`);
  assert.ok(max >= 1110 && max <= 1118, `上限がずれている: ${max}`);
});

test('経験値表からレベルが正しく上がる', () => {
  const world = startRun('d1', newTown(), { seed: 1 });
  const p = world.player;
  assert.equal(p.level, 1);
  gainExp(world, p, EXP_TABLE[2]);
  assert.equal(p.level, 2);
  gainExp(world, p, EXP_TABLE[10] - p.exp);
  assert.equal(p.level, 10);
  assert.equal(p.maxHp, 51, 'Lv10 の最大 HP が仕様と違う');
  gainExp(world, p, 99_999_999);
  assert.equal(p.level, 99);
  assert.equal(p.maxHp, 848, 'Lv99 の最大 HP が仕様と違う');
});

test('素手の攻撃力はちからと等しい', () => {
  const world = startRun('d1', newTown(), { seed: 2 });
  // 村の貸し出し装備を外して素手にする
  world.player.weaponUid = null;
  world.player.shieldUid = null;
  assert.equal(attackPower(world, world.player), 8);
  assert.equal(defensePower(world, world.player), 0);
});

test('貸し出し装備はダンジョンが深いほど良くなる', () => {
  const defOf = (id: string): number => {
    const world = startRun(id, newTown(), { seed: 900 });
    const shield = world.player.inventory.find(
      (i) => i.uid === world.player.shieldUid,
    );
    if (!shield) return 0;
    const d = getItem(shield.defId);
    return d.kind === 'shield' ? d.def : 0;
  };
  const d1 = defOf('d1');
  const d2 = defOf('d2');
  const d4 = defOf('d4');
  const dl = defOf('dl');
  assert.ok(d1 < d2, `d1(${d1}) < d2(${d2}) になっていない`);
  assert.ok(d2 < d4, `d2(${d2}) < d4(${d4}) になっていない`);
  assert.ok(d4 < dl, `d4(${d4}) < dl(${dl}) になっていない`);
});

test('丸腰では出発させない（村が装備を貸してくれる）', () => {
  const world = startRun('d1', newTown(), { seed: 3 });
  const p = world.player;
  assert.notEqual(p.weaponUid, null, '武器を持たずに出発している');
  assert.notEqual(p.shieldUid, null, '盾を持たずに出発している');
  // 1F の敵の攻撃を 3 発で倒されない程度の守りはある
  assert.ok(attackPower(world, p) > 8, '攻撃力が素手のまま');
  assert.ok(defensePower(world, p) > 0, '防御力が 0 のまま');
  assert.ok(p.inventory.some((i) => i.defId === 'healHerb'), '薬草が渡されていない');
  assert.ok(p.inventory.some((i) => i.defId === 'riceBall'), 'おにぎりが渡されていない');
});

test('持ち込んだ装備があれば貸し出し装備は付かない', () => {
  const town = newTown();
  const bring = [{
    uid: 1, defId: 'steelSword', count: 1, plus: 0, runes: [], charges: 0,
    contents: [], cursed: false, plusKnown: true, shopPrice: 0, sealed: false,
  }];
  const world = startRun('d2', town, { seed: 4, bring });
  const ids = world.player.inventory.map((i) => i.defId);
  assert.ok(ids.includes('steelSword'));
  // 武器は持っているので貸し出されない
  const weapons = world.player.inventory.filter((i) => getItem(i.defId).kind === 'weapon');
  assert.equal(weapons.length, 1, '武器を持っているのに貸し出し装備が付いている');
  // 盾は持っていないので、そのダンジョン相応の盾を貸してもらえる
  const shields = world.player.inventory.filter((i) => getItem(i.defId).kind === 'shield');
  assert.equal(shields.length, 1, '盾が貸し出されていない');
  // 持ち込んだ武器が自動で装備される
  const weapon = world.player.inventory.find((i) => i.defId === 'steelSword');
  assert.equal(world.player.weaponUid, weapon!.uid, '持ち込んだ武器が装備されていない');
});

test('もっと不思議のダンジョンでは貸し出し装備も無い', () => {
  const world = startRun('ex', newTown(), { seed: 5 });
  assert.equal(world.player.weaponUid, null, 'ex で武器を持たされている');
  assert.equal(world.player.shieldUid, null, 'ex で盾を持たされている');
});

test('風が吹くダンジョンでは長居すると次の階へ飛ばされる', () => {
  const world = startRun('d2', newTown(), { seed: 31 });
  const d = getDungeon('d2');
  assert.ok(d.windTurns > 0);
  const startDepth = world.run.depth;
  let guard = 0;
  while (!world.finished && world.run.depth === startDepth && guard++ < d.windTurns + 200) {
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
  }
  // 風で飛ばされたか、その前に力尽きたか
  assert.ok(world.run.depth > startDepth || world.finished, '風が吹かなかった');
});

test('空腹が続くと力尽きる', () => {
  const world = startRun('d1', newTown(), { seed: 8 });
  world.player.foodX10 = 1;
  world.player.maxHp = 20;
  world.player.hp = 20;
  let guard = 0;
  while (!world.finished && guard++ < 2000) {
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
  }
  assert.ok(world.finished, '空腹で終わらなかった');
});

test('モンスターはプレイヤーへ近づいてくる', () => {
  const world = startRun('d1', newTown(), { seed: 606 });
  // プレイヤーの近くに敵を置いて、寄ってくるか見る
  const m = world.run.monsters[0];
  assert.ok(m);
  const spot = world.findDropSpot(world.player.pos, 5);
  assert.ok(spot);
  m.pos = spot!;
  m.asleep = false;
  const before = chebyshev(m.pos, world.player.pos);
  for (let i = 0; i < 10 && m.alive; i++) {
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
  }
  if (m.alive) {
    const after = chebyshev(m.pos, world.player.pos);
    assert.ok(after < before || after <= 1, `敵が近づいてこない: ${before} → ${after}`);
  }
});

test('ボスを倒すまで階段を降りられない', async () => {
  const world = startRun('d2', newTown(), { seed: 2024 });
  // ボスの階まで一気に降ろす
  const { enterFloor } = await import('../src/game/run.js');
  enterFloor(world, 10);
  world.drainEvents();
  assert.equal(world.bossesHere().length, 1, 'd2 の 10F にボスがいない');
  assert.equal(world.bossesCleared(), false);

  // 階段の上に立って降りようとしても進めない
  world.player.pos = { ...world.map.stairs };
  const before = world.run.depth;
  stepTurn(world, { type: 'stairs' });
  world.drainEvents();
  assert.equal(world.run.depth, before, 'ボスを倒す前に降りられてしまった');
  assert.equal(world.finished, null);

  // ボスを倒すと通れるようになる
  const boss = world.run.monsters.find((m) => world.defOf(m).isBoss);
  assert.ok(boss, 'ボスが配置されていない');
  boss!.hp = 0;
  boss!.alive = false;
  stepTurn(world, { type: 'wait' });
  world.drainEvents();
  assert.equal(world.bossesCleared(), true, 'ボス撃破が記録されていない');
});

test('ラストダンジョンのボスは倒すと第 2 形態が現れる', async () => {
  const world = startRun('dl', newTown(), { seed: 555 });
  const { enterFloor } = await import('../src/game/run.js');
  enterFloor(world, 30);
  world.drainEvents();
  const here = world.bossesHere();
  assert.equal(here.length, 2, 'ラストボスが 2 形態になっていない');

  const first = world.run.monsters.find((m) => m.defId === here[0].monsterId);
  assert.ok(first, '第 1 形態が配置されていない');
  first!.hp = 0;
  first!.alive = false;
  stepTurn(world, { type: 'wait' });
  world.drainEvents();

  const second = world.run.monsters.find((m) => m.defId === here[1].monsterId);
  assert.ok(second, '第 2 形態が現れていない');
  assert.equal(world.bossesCleared(), false, '第 2 形態が残っているのにクリア扱い');
});

test('脱出の巻物で村へ戻れる', async () => {
  const world = startRun('d3', newTown(), { seed: 606060 });
  const { makeItem, addToInventory } = await import('../src/game/inventory.js');
  const { useItem } = await import('../src/game/itemActions.js');
  const scroll = makeItem('escapeScroll', world.rng, {}, () => world.nextUid());
  addToInventory(world.player, scroll);
  useItem(world, scroll.uid);
  world.drainEvents();
  assert.ok(world.finished, '脱出できていない');
  assert.equal(world.finished!.kind, 'escape');
});

test('休憩は危ないことが起きたら必ず止まる', async () => {
  const { restTurns } = await import('../src/game/turn.js');
  // 全快していれば 1 ターンも休まない
  {
    const world = startRun('d1', newTown(), { seed: 1212 });
    assert.equal(restTurns(world, 100), 0, '全快なのに休んでいる');
  }
  // 階が変わったら止まる
  {
    const world = startRun('d2', newTown(), { seed: 1213 });
    world.player.hp = 1;
    const startDepth = world.run.depth;
    restTurns(world, 5000);
    world.drainEvents();
    assert.ok(
      world.run.depth === startDepth || world.finished,
      '階をまたいで休み続けている',
    );
  }
  // 状態異常になったら止まる
  {
    const { applyStatus } = await import('../src/game/status.js');
    const world = startRun('d1', newTown(), { seed: 1214 });
    world.player.hp = 1;
    world.player.maxHp = 500;
    applyStatus(world, world.player, 'poisoned', 50);
    assert.equal(restTurns(world, 100), 0, '状態異常なのに休んでいる');
  }
  // 空腹なら止まる
  {
    const world = startRun('d1', newTown(), { seed: 1215 });
    world.player.hp = 1;
    world.player.maxHp = 500;
    world.player.foodX10 = 0;
    assert.ok(restTurns(world, 100) <= 1, '空腹なのに休み続けている');
  }
});
