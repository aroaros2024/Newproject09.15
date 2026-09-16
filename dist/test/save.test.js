import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { DIRS } from '../src/core/geom.js';
import { getDungeon } from '../src/data/registry.js';
import { attachFactories, startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { World } from '../src/game/world.js';
import { renderAscii } from '../src/dungeon/tilemap.js';
import { makeItem, addToInventory } from '../src/game/inventory.js';
import { finishRun } from '../src/game/town.js';
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    };
}
/** 中断セーブは JSON を通る。Map や class が混ざっていたらここで壊れる */
function roundTrip(run) {
    const json = JSON.stringify(run);
    return JSON.parse(json);
}
test('冒険の状態は JSON を往復しても壊れない', () => {
    const world = startRun('d3', newTown(), { seed: 8080 });
    const rng = new Rng(11);
    for (let i = 0; i < 150; i++) {
        stepTurn(world, { type: 'move', dir: rng.pick(DIRS) });
        world.drainEvents();
    }
    addToInventory(world.player, makeItem('ironSword', world.rng, { plus: 3, runes: ['crit', 'crit'] }, () => world.nextUid()));
    addToInventory(world.player, makeItem('storagePot', world.rng, {}, () => world.nextUid()));
    const saved = world.syncForSave();
    const restored = roundTrip(saved);
    assert.equal(restored.depth, saved.depth);
    assert.equal(restored.totalTurn, saved.totalTurn);
    assert.equal(restored.player.hp, saved.player.hp);
    assert.equal(restored.player.inventory.length, saved.player.inventory.length);
    assert.equal(restored.monsters.length, saved.monsters.length);
    assert.equal(restored.map.tiles.length, saved.map.width * saved.map.height);
    // 印の配列（重ね掛けの表現）が保たれている
    const sword = restored.player.inventory.find((i) => i.defId === 'ironSword');
    assert.deepEqual(sword?.runes, ['crit', 'crit']);
    // 乱数の状態が載っている
    assert.equal(typeof restored.rng.x, 'number');
    assert.equal(typeof restored.rng.w, 'number');
});
test('中断データから再開すると、同じ続きが再現される', () => {
    const world = startRun('d2', newTown(), { seed: 4321 });
    const rng = new Rng(77);
    for (let i = 0; i < 80; i++) {
        stepTurn(world, { type: 'move', dir: rng.pick(DIRS) });
        world.drainEvents();
    }
    const snapshot = roundTrip(world.syncForSave());
    const mapBefore = renderAscii(world.map);
    // 続きをそのまま進めた場合
    const contRng = new Rng(999);
    const moves = Array.from({ length: 60 }, () => contRng.pick(DIRS));
    for (const d of moves) {
        stepTurn(world, { type: 'move', dir: d });
        world.drainEvents();
    }
    // 中断データから復元して、同じ手順を踏んだ場合
    const revived = new World(snapshot, getDungeon(snapshot.dungeonId));
    attachFactories(revived);
    assert.equal(renderAscii(revived.map), mapBefore, 'フロアの地形が復元できていない');
    for (const d of moves) {
        stepTurn(revived, { type: 'move', dir: d });
        revived.drainEvents();
    }
    assert.equal(revived.run.totalTurn, world.run.totalTurn, 'ターン数が一致しない');
    assert.equal(revived.player.hp, world.player.hp, 'HP が一致しない');
    assert.deepEqual(revived.player.pos, world.player.pos, '位置が一致しない');
    assert.equal(revived.player.exp, world.player.exp, '経験値が一致しない');
    assert.equal(revived.run.monsters.length, world.run.monsters.length, '敵の数が一致しない');
});
test('復元した世界でもモンスターとアイテムが作れる', () => {
    const world = startRun('d4', newTown(), { seed: 606 });
    const snapshot = roundTrip(world.syncForSave());
    const revived = new World(snapshot, getDungeon(snapshot.dungeonId));
    attachFactories(revived);
    assert.ok(revived.itemFactory, 'アイテム生成が繋がっていない');
    assert.ok(revived.monsterFactory, 'モンスター生成が繋がっていない');
    assert.ok(revived.spawnAt, 'ボス生成が繋がっていない');
    const spot = revived.randomSpawnTile(4);
    assert.ok(spot);
    const before = revived.run.monsters.length;
    revived.monsterFactory(spot);
    assert.equal(revived.run.monsters.length, before + 1);
});
test('未識別の対応表もセーブに載る', () => {
    const world = startRun('d2', newTown(), { seed: 12 });
    world.run.identify.known.healHerb = true;
    world.run.identify.nicknames.sleepHerb = '危険';
    const restored = roundTrip(world.syncForSave());
    assert.equal(restored.identify.known.healHerb, true);
    assert.equal(restored.identify.nicknames.sleepHerb, '危険');
    assert.ok(Object.keys(restored.identify.alias).length > 0, '仮名の対応表が空');
});
test('クリアすると次のダンジョンが開放され、報酬が倉庫に入る', () => {
    const town = newTown();
    const world = startRun('d1', town, { seed: 31 });
    const result = finishRun(world, town, 'clear', 'クリア');
    assert.ok(town.cleared.includes('d1'));
    assert.equal(result.unlocked, 'd2', '次のダンジョンが開放されていない');
    assert.ok(town.unlocked.includes('d2'));
    assert.ok(town.gitan >= getDungeon('d1').reward.gitan, '報酬のギタンが入っていない');
});
test('死ぬと持ち物を失う（ただし始まりの洞窟は例外）', () => {
    // d2 で死ぬ: 失う
    {
        const town = newTown();
        const world = startRun('d2', town, { seed: 41 });
        addToInventory(world.player, makeItem('steelSword', world.rng, {}, () => world.nextUid()));
        finishRun(world, town, 'death', 'やられた');
        assert.equal(town.storage.length, 0, 'd2 で死んだのに持ち物が残っている');
    }
    // d1 で死ぬ: 失わない
    {
        const town = newTown();
        const world = startRun('d1', town, { seed: 42 });
        addToInventory(world.player, makeItem('steelSword', world.rng, {}, () => world.nextUid()));
        finishRun(world, town, 'death', 'やられた');
        assert.ok(town.storage.some((i) => i.defId === 'steelSword'), 'd1 で死んだのに持ち物を失っている');
    }
});
test('脱出すると持ち物を持ち帰れる', () => {
    const town = newTown();
    const world = startRun('d3', town, { seed: 43 });
    addToInventory(world.player, makeItem('tenrinSword', world.rng, {}, () => world.nextUid()));
    world.player.gitan = 1234;
    finishRun(world, town, 'escape', '脱出');
    assert.ok(town.storage.some((i) => i.defId === 'tenrinSword'), '持ち帰れていない');
    assert.ok(town.gitan >= 1234, 'ギタンを持ち帰れていない');
});
test('倉庫の壺に入れた物は、死んでも村に届く', () => {
    const town = newTown();
    const world = startRun('d3', town, { seed: 44 });
    const treasure = makeItem('tenrinShield', world.rng, {}, () => world.nextUid());
    world.pendingWarehouse.push(treasure);
    finishRun(world, town, 'death', 'やられた');
    assert.ok(town.storage.some((i) => i.defId === 'tenrinShield'), '倉庫の壺に入れた物が届いていない');
});
test('冒険で出会ったモンスターと道具が図鑑に残る', async () => {
    const { refreshFov } = await import('../src/game/run.js');
    const { collectionRate } = await import('../src/game/town.js');
    const town = newTown();
    const world = startRun('d2', town, { seed: 1357 });
    // 目の前に敵を置いて視界に入れる
    const spot = world.findDropSpot(world.player.pos, 2);
    assert.ok(spot);
    const before = collectionRate(town);
    const m = world.run.monsters[0];
    assert.ok(m);
    m.pos = spot;
    refreshFov(world);
    assert.ok(world.run.encountered.monsters.includes(m.defId), '視界に入った敵が記録されていない');
    // 草を持って識別する
    addToInventory(world.player, makeItem('healHerb', world.rng, {}, () => world.nextUid()));
    world.run.identify.known.healHerb = true;
    refreshFov(world);
    finishRun(world, town, 'escape', '脱出');
    assert.ok(town.seenMonsters[m.defId], '図鑑にモンスターが残っていない');
    assert.ok(town.seenItems.healHerb, '図鑑に道具が残っていない');
    const after = collectionRate(town);
    assert.ok(after.monsters > before.monsters, '図鑑のモンスター数が増えていない');
    assert.ok(after.itemsTotal > 100, '道具の総数が数えられていない');
    assert.ok(after.monstersTotal >= 60, 'モンスターの総数が数えられていない');
});
test('図鑑のデータもセーブに載る', () => {
    const world = startRun('d1', newTown(), { seed: 2468 });
    world.run.encountered.monsters.push('ratField');
    world.run.encountered.items.push('healHerb');
    const restored = roundTrip(world.syncForSave());
    // 開始時点で見えている敵も既に記録されているので、含まれることだけ確かめる
    assert.ok(restored.encountered.monsters.includes('ratField'));
    assert.ok(restored.encountered.items.includes('healHerb'));
    assert.equal(new Set(restored.encountered.monsters).size, restored.encountered.monsters.length, '同じ敵が重複して記録されている');
});
//# sourceMappingURL=save.test.js.map