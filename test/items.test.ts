import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import type { Dir, ItemDef, TownState } from '../src/core/types.js';
import { ALL_ITEMS, getItem, itemsOfKind } from '../src/data/registry.js';
import { RUNES } from '../src/data/runes.js';
import { startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { makeItem, addToInventory, findItem } from '../src/game/inventory.js';
import {
  needsDirection, needsItemTarget, equipItem, throwItem, useItem,
} from '../src/game/itemActions.js';
import { mergeInto } from '../src/game/itemEffects.js';
import { addRune, freeSlots, runeLevel, slotCapacity, usedSlots } from '../src/game/runes.js';
import { itemName } from '../src/game/naming.js';
import { isBraceletEffect } from '../src/game/bracelets.js';
import { attackPower, defensePower } from '../src/game/combat.js';
import type { World } from '../src/game/world.js';

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 500,
    cleared: [], unlocked: ['d1'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}

function give(world: World, defId: string): ReturnType<typeof makeItem> {
  const item = makeItem(defId, world.rng, {}, () => world.nextUid());
  addToInventory(world.player, item);
  return item;
}

function checkInvariants(world: World, label: string): void {
  const p = world.player;
  assert.ok(p.hp >= 0 && p.hp <= p.maxHp, `${label}: HP 異常 ${p.hp}/${p.maxHp}`);
  assert.ok(p.foodX10 >= 0 && p.foodX10 <= p.maxFoodX10, `${label}: 満腹度 異常`);
  assert.ok(p.level >= 1 && p.level <= 99, `${label}: レベル 異常 ${p.level}`);
  assert.ok(p.str >= 0, `${label}: ちから 異常`);
  assert.ok(p.gitan >= 0, `${label}: ギタン 異常`);
  assert.ok(p.inventory.length <= 21, `${label}: 持ち物 超過 ${p.inventory.length}`);
  const t = world.map.tiles[p.pos.y * world.map.width + p.pos.x];
  assert.ok(t && t.kind !== 'wall', `${label}: 壁の中にいる`);
  for (const it of p.inventory) {
    assert.ok(it.count >= 1, `${label}: ${it.defId} の個数が 0 以下`);
    assert.ok(it.charges >= 0, `${label}: ${it.defId} の回数が負`);
    assert.ok(usedSlots(it) <= slotCapacity(it) + 1, `${label}: ${it.defId} の印が溢れている`);
  }
}

test('すべてのアイテムを「使う」ことができ、例外も不整合も起きない', () => {
  const rng = new Rng('use-all');
  for (const def of ALL_ITEMS) {
    if (def.kind === 'gitan') continue;
    const world = startRun('d4', newTown(), { seed: 4242 });
    // 対象にできる道具と、方向を決めるための敵を用意しておく
    give(world, 'ironSword');
    give(world, 'ironShield');
    give(world, 'healHerb');
    const item = give(world, def.id);

    const targetUid = needsItemTarget(def)
      ? world.player.inventory.find((i) => i.uid !== item.uid)?.uid
      : undefined;
    const dir = needsDirection(def) ? (rng.int(8) as Dir) : undefined;

    assert.doesNotThrow(
      () => { useItem(world, item.uid, targetUid, dir); },
      `${def.id} (${def.name}) を使うと例外が出た`,
    );
    world.drainEvents();
    checkInvariants(world, `use ${def.id}`);
  }
});

test('すべてのアイテムを「投げる」ことができる', () => {
  const rng = new Rng('throw-all');
  for (const def of ALL_ITEMS) {
    if (def.kind === 'gitan') continue;
    const world = startRun('d3', newTown(), { seed: 777 });
    const item = give(world, def.id);
    assert.doesNotThrow(
      () => { throwItem(world, item.uid, rng.int(8) as Dir); },
      `${def.id} (${def.name}) を投げると例外が出た`,
    );
    world.drainEvents();
    checkInvariants(world, `throw ${def.id}`);
  }
});

test('すべての装備を装備できる', () => {
  const world = startRun('d2', newTown(), { seed: 11 });
  const all = [...itemsOfKind('weapon'), ...itemsOfKind('shield'), ...itemsOfKind('bracelet')];
  for (const def of all) {
    // 持ち物は 20 枠しかないので、毎回まっさらにしてから試す
    world.player.inventory = [];
    world.player.weaponUid = null;
    world.player.shieldUid = null;
    world.player.braceletUid = null;
    const item = give(world, def.id);
    const r = equipItem(world, item.uid);
    assert.ok(r.tookTurn, `${def.id}（${def.name}）を装備できない`);
    const slot = def.kind === 'weapon' ? world.player.weaponUid
      : def.kind === 'shield' ? world.player.shieldUid : world.player.braceletUid;
    assert.equal(slot, item.uid, `${def.id} が装備枠に入っていない`);
    world.drainEvents();
  }
  checkInvariants(world, 'equip-all');
});

test('装備は攻撃力・防御力に反映される', () => {
  const world = startRun('d2', newTown(), { seed: 111 });
  const p = world.player;
  const baseAtk = attackPower(world, p);
  const sword = makeItem('ironSword', world.rng, { plus: 3, runes: [] }, () => world.nextUid());
  addToInventory(p, sword);
  equipItem(world, sword.uid);
  // 鉄の剣 atk9 + 修正値 3
  assert.equal(attackPower(world, p), baseAtk + 12);
  const shield = makeItem('ironShield', world.rng, { plus: 2, runes: [] }, () => world.nextUid());
  addToInventory(p, shield);
  equipItem(world, shield.uid);
  // 鉄の盾 def8 + 修正値 2
  assert.equal(defensePower(world, p), 10);
});

test('腕輪の効果 id はすべて実装済みのものだけ', () => {
  const unknown: string[] = [];
  for (const def of itemsOfKind('bracelet')) {
    const effect = (def as { effect: string }).effect;
    if (!isBraceletEffect(effect)) unknown.push(`${def.id} → ${effect}`);
  }
  assert.deepEqual(unknown, [], `未実装の腕輪効果:\n${unknown.join('\n')}`);
});

test('ちからの腕輪を着けると攻撃力が上がり、外すと戻る', () => {
  const world = startRun('d2', newTown(), { seed: 112 });
  const p = world.player;
  const before = attackPower(world, p);
  const b = makeItem('strBracelet', world.rng, {}, () => world.nextUid());
  addToInventory(p, b);
  equipItem(world, b.uid);
  assert.equal(attackPower(world, p), before + 3);
  stepTurn(world, { type: 'unequip', uid: b.uid });
  assert.equal(attackPower(world, p), before);
});

test('竜脈の腕輪の最大 HP ボーナスは着け外しで釣り合う', () => {
  const world = startRun('d2', newTown(), { seed: 113 });
  const p = world.player;
  const before = p.maxHp;
  const b = makeItem('healthBracelet', world.rng, {}, () => world.nextUid());
  addToInventory(p, b);
  equipItem(world, b.uid);
  assert.equal(p.maxHp, before + 30);
  stepTurn(world, { type: 'unequip', uid: b.uid });
  assert.equal(p.maxHp, before, '外しても最大 HP が戻らない');
});

test('呪われた装備は外せない', () => {
  const world = startRun('d2', newTown(), { seed: 12 });
  const sword = makeItem('ironSword', world.rng, { cursed: true }, () => world.nextUid());
  addToInventory(world.player, sword);
  equipItem(world, sword.uid);
  assert.equal(world.player.weaponUid, sword.uid);
  stepTurn(world, { type: 'unequip', uid: sword.uid });
  assert.equal(world.player.weaponUid, sword.uid, '呪われた武器が外せてしまった');
});

test('使うと種類が識別される', () => {
  const world = startRun('d2', newTown(), { seed: 13 });
  const herb = give(world, 'healHerb');
  assert.ok(!world.run.identify.known.healHerb);
  useItem(world, herb.uid);
  assert.ok(world.run.identify.known.healHerb, '飲んでも識別されない');
});

test('未識別の草は仮の名前で表示される', () => {
  const world = startRun('d2', newTown(), { seed: 14 });
  const herb = give(world, 'healHerb');
  const before = itemName(herb, world.run.identify);
  assert.ok(before.endsWith('草'), `仮名が草で終わっていない: ${before}`);
  assert.notEqual(before, '薬草');
  world.run.identify.known.healHerb = true;
  assert.equal(itemName(herb, world.run.identify), '薬草');
});

test('仮の名前は毎回の冒険でシャッフルされる', () => {
  const names = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const town = newTown();
    town.totalRuns = i;
    const world = startRun('d2', town, { seed: 100 + i });
    names.add(world.run.identify.alias.healHerb);
  }
  assert.ok(names.size >= 5, `仮名が固定されている: ${[...names].join(',')}`);
});

test('印の重ね掛けはスロットを 1 つしか使わない', () => {
  const world = startRun('d2', newTown(), { seed: 15 });
  const sword = makeItem('ironSword', world.rng, { runes: [] }, () => world.nextUid());
  assert.equal(slotCapacity(sword), 3);
  assert.ok(addRune(sword, 'crit'));
  assert.ok(addRune(sword, 'crit'));
  assert.ok(addRune(sword, 'crit'));
  assert.equal(runeLevel(sword, 'crit'), 3, '重ね掛けできていない');
  assert.equal(usedSlots(sword), 1, 'スロットを余分に使っている');
  assert.equal(freeSlots(sword), 2);
});

test('重ねられない印は 1 つまで', () => {
  const world = startRun('d2', newTown(), { seed: 16 });
  const sword = makeItem('ironSword', world.rng, { runes: [] }, () => world.nextUid());
  assert.ok(addRune(sword, 'crush'));
  assert.equal(addRune(sword, 'crush'), false, '重ねられない印が重なった');
  assert.equal(runeLevel(sword, 'crush'), 1);
});

test('排他の印は後から付けた方が残る', () => {
  const world = startRun('d2', newTown(), { seed: 17 });
  const sword = makeItem('ironSword', world.rng, { runes: [] }, () => world.nextUid());
  addRune(sword, 'heavy');
  assert.equal(runeLevel(sword, 'heavy'), 1);
  addRune(sword, 'swift');
  assert.equal(runeLevel(sword, 'heavy'), 0, '排他の印が同居している');
  assert.equal(runeLevel(sword, 'swift'), 1);
});

test('盾の印は武器に付かない', () => {
  const world = startRun('d2', newTown(), { seed: 18 });
  const sword = makeItem('ironSword', world.rng, { runes: [] }, () => world.nextUid());
  assert.equal(addRune(sword, 'reduce'), false, '盾の印が武器に付いた');
  const shield = makeItem('ironShield', world.rng, { runes: [] }, () => world.nextUid());
  assert.equal(addRune(shield, 'crit'), false, '武器の印が盾に付いた');
  assert.ok(addRune(shield, 'reduce'));
});

test('匠の印を付けるとスロットが増える', () => {
  const world = startRun('d2', newTown(), { seed: 19 });
  const sword = makeItem('ironSword', world.rng, { runes: [] }, () => world.nextUid());
  const before = slotCapacity(sword);
  addRune(sword, 'smith');
  assert.equal(slotCapacity(sword), before + 1);
});

test('合成すると修正値が足され、印が移る', () => {
  const world = startRun('d2', newTown(), { seed: 20 });
  const base = makeItem('ironSword', world.rng, { plus: 2, runes: [] }, () => world.nextUid());
  const mat = makeItem('flameSword', world.rng, { plus: 3 }, () => world.nextUid());
  mergeInto(world, base, mat);
  assert.equal(base.plus, 5, '修正値が足されていない');
  assert.ok(runeLevel(base, 'flame') > 0, '印が移っていない');
  assert.ok(base.plusKnown, '合成後は完全に分かるはず');
  assert.ok(world.run.identify.known[base.defId]);
});

test('合成でスロットが足りない印は捨てられる（溢れない）', () => {
  const world = startRun('d2', newTown(), { seed: 21 });
  const base = makeItem('woodStick', world.rng, { runes: [] }, () => world.nextUid());
  assert.equal(slotCapacity(base), 1);
  for (const id of ['crit', 'combo', 'drain', 'crush', 'flame']) {
    const mat = makeItem('ironSword', world.rng, { runes: [id] }, () => world.nextUid());
    mergeInto(world, base, mat);
  }
  assert.ok(usedSlots(base) <= slotCapacity(base), `印が溢れた: ${usedSlots(base)}/${slotCapacity(base)}`);
});

test('印の定義がすべて記号と説明を持つ', () => {
  for (const r of RUNES) {
    assert.equal(r.symbol.length, 1, `${r.id}: 記号は 1 文字にする`);
    assert.ok(r.name.length > 0 && r.desc.length > 0, `${r.id}: 名前か説明が空`);
    assert.ok(r.maxLevel >= 1);
  }
  const symbols = RUNES.map((r) => r.symbol);
  assert.equal(new Set(symbols).size, symbols.length, '印の記号が重複している');
});

test('効果 id を持つアイテムには必ずハンドラがある', async () => {
  const { ITEM_EFFECTS } = await import('../src/game/itemEffects.js');
  const missing: string[] = [];
  for (const def of ALL_ITEMS as ItemDef[]) {
    // 腕輪は「着けている間ずっと効く」ので bracelets.ts 側で検査する
    if (def.kind === 'bracelet') continue;
    const effect = (def as { effect?: string }).effect;
    if (effect && !ITEM_EFFECTS[effect]) missing.push(`${def.id} → ${effect}`);
    const thrown = def.throwEffect;
    if (thrown && !ITEM_EFFECTS[thrown]) missing.push(`${def.id} → throw:${thrown}`);
  }
  assert.deepEqual(missing, [], `ハンドラの無い効果:\n${missing.join('\n')}`);
});

test('特技 id を持つモンスターには必ずハンドラがある', async () => {
  const { MONSTER_SKILLS } = await import('../src/game/monsterSkills.js');
  const { allMonsters } = await import('../src/data/registry.js');
  const missing: string[] = [];
  for (const m of allMonsters()) {
    for (const s of m.skills) {
      if (!MONSTER_SKILLS[s]) missing.push(`${m.id} → ${s}`);
    }
  }
  assert.deepEqual(missing, [], `ハンドラの無い特技:\n${missing.join('\n')}`);
});

test('ワナの効果 id には必ずハンドラがある', async () => {
  const mod = await import('../src/game/trapEffects.js');
  const { allTraps } = await import('../src/data/registry.js');
  // applyTrapEffect が例外を投げないことで確認する
  const world = startRun('d4', newTown(), { seed: 33 });
  for (const t of allTraps()) {
    assert.doesNotThrow(
      () => { mod.applyTrapEffect(world, world.player, t.id); },
      `${t.id} (${t.name}) の効果で例外が出た`,
    );
    world.player.hp = world.player.maxHp;
    world.player.alive = true;
    world.drainEvents();
  }
});

test('壺に入れて取り出せる', () => {
  const world = startRun('d2', newTown(), { seed: 22 });
  const pot = give(world, 'storagePot');
  const herb = give(world, 'healHerb');
  useItem(world, pot.uid, herb.uid);
  assert.equal(pot.contents.length, 1, '壺に入っていない');
  assert.equal(findItem(world.player, herb.uid)?.uid, herb.uid, '壺の中から引けない');
  stepTurn(world, { type: 'takeOut', potUid: pot.uid, index: 0 });
  assert.equal(pot.contents.length, 0, '取り出せていない');
  assert.ok(world.player.inventory.some((i) => i.defId === 'healHerb'));
});

test('壺に壺は入らない', () => {
  const world = startRun('d2', newTown(), { seed: 23 });
  const a = give(world, 'storagePot');
  const b = give(world, 'storagePot');
  useItem(world, a.uid, b.uid);
  assert.equal(a.contents.length, 0, '壺に壺が入ってしまった');
});

test('合成の壺は満杯になると合成される', () => {
  const world = startRun('d2', newTown(), { seed: 24 });
  const pot = give(world, 'synthesisPot');
  const capacity = (getItem('synthesisPot') as { capacity: number }).capacity;
  const base = makeItem('ironSword', world.rng, { plus: 1, runes: [] }, () => world.nextUid());
  addToInventory(world.player, base);
  useItem(world, pot.uid, base.uid);
  for (let i = 1; i < capacity; i++) {
    const mat = makeItem('flameSword', world.rng, { plus: 1 }, () => world.nextUid());
    addToInventory(world.player, mat);
    useItem(world, pot.uid, mat.uid);
  }
  assert.equal(pot.contents.length, 1, '合成されて 1 つになっていない');
  assert.ok(pot.contents[0].plus >= 2, '修正値が足されていない');
});
