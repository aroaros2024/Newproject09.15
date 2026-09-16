import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterFloor, startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { payDebt, shopDebt } from '../src/game/itemActions.js';
import { addToInventory, makeItem } from '../src/game/inventory.js';
import { at } from '../src/dungeon/tilemap.js';
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d4'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    };
}
/** 店が出るフロアを探す */
function findShopFloor() {
    for (let seed = 0; seed < 60; seed++) {
        const world = startRun('d4', newTown(), { seed: 5000 + seed * 131 });
        for (let depth = 1; depth <= 20; depth++) {
            enterFloor(world, depth);
            world.drainEvents();
            const room = world.map.rooms.find((r) => r.shop);
            if (room && world.run.floorItems.some((f) => f.item.shopPrice > 0)) {
                return { world, room };
            }
        }
    }
    return null;
}
test('店には店主と値の付いた商品が並ぶ', () => {
    const found = findShopFloor();
    assert.ok(found, '60 シード試しても店が出なかった');
    const { world, room } = found;
    assert.ok(room.shop);
    const keeper = world.run.monsters.find((m) => m.id === room.shop.ownerId);
    assert.ok(keeper, '店主がいない');
    assert.equal(keeper.kind, 'shopkeeper');
    assert.equal(world.isHostile(world.player, keeper), false, '最初から敵対している');
    const goods = world.run.floorItems.filter((f) => f.item.shopPrice > 0);
    assert.ok(goods.length >= 3, `商品が ${goods.length} 個しかない`);
    for (const g of goods) {
        assert.equal(g.item.cursed, false, '商品が呪われている');
        assert.ok(g.item.plus >= 0, '商品の修正値が負');
        assert.ok(at(world.map, g.pos.x, g.pos.y)?.shop, '商品が店の床の外にある');
    }
});
test('ギタンを払えば商品を買える', () => {
    const found = findShopFloor();
    assert.ok(found);
    const { world } = found;
    const good = world.run.floorItems.find((f) => f.item.shopPrice > 0);
    const price = good.item.shopPrice;
    world.player.gitan = price + 500;
    world.player.pos = { ...good.pos };
    stepTurn(world, { type: 'buy' });
    world.drainEvents();
    assert.equal(world.player.gitan, 500, '代金が引かれていない');
    assert.ok(world.player.inventory.some((i) => i.defId === good.item.defId && i.shopPrice === 0), '買った物が持ち物に入っていない');
    assert.equal(shopDebt(world), 0, '買ったのに借金が残っている');
});
test('ギタンが足りなければ買えない', () => {
    const found = findShopFloor();
    assert.ok(found);
    const { world } = found;
    const good = world.run.floorItems.find((f) => f.item.shopPrice > 0);
    world.player.gitan = 0;
    world.player.pos = { ...good.pos };
    const before = world.player.inventory.length;
    stepTurn(world, { type: 'buy' });
    world.drainEvents();
    assert.equal(world.player.inventory.length, before, '無銭で買えてしまった');
});
test('商品を持ったまま店を出ると泥棒になり、店主が怒る', () => {
    const found = findShopFloor();
    assert.ok(found);
    const { world, room } = found;
    const good = world.run.floorItems.find((f) => f.item.shopPrice > 0);
    // 商品を手に取って、店の外の床へ移る
    world.player.pos = { ...good.pos };
    stepTurn(world, { type: 'pickup' });
    world.drainEvents();
    assert.ok(shopDebt(world) > 0, '商品を手にしても借金にならない');
    const outside = world.randomOpenTile((p) => at(world.map, p.x, p.y)?.shop === false
        && at(world.map, p.x, p.y)?.kind === 'floor'
        && !world.actorAt(p));
    assert.ok(outside);
    world.player.pos = outside;
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
    assert.equal(room.shop.angry, true, '店を出たのに店主が怒らない');
    const keeper = world.run.monsters.find((m) => m.id === room.shop.ownerId);
    if (keeper) {
        assert.equal(keeper.angry, true);
        assert.equal(world.isHostile(world.player, keeper), true, '怒っているのに敵対していない');
    }
});
test('借金を払えば店主は落ち着く', () => {
    const found = findShopFloor();
    assert.ok(found);
    const { world, room } = found;
    const good = world.run.floorItems.find((f) => f.item.shopPrice > 0);
    world.player.pos = { ...good.pos };
    stepTurn(world, { type: 'pickup' });
    world.drainEvents();
    const debt = shopDebt(world);
    assert.ok(debt > 0);
    world.player.gitan = debt;
    const r = payDebt(world);
    world.drainEvents();
    assert.ok(r.tookTurn, '支払いが成立していない');
    assert.equal(shopDebt(world), 0, '借金が残っている');
    assert.equal(world.player.gitan, 0);
    assert.equal(room.shop.angry, false, '払ったのに怒ったまま');
});
test('盗賊の巻物を読むと商品が自分の物になる', async () => {
    const { useItem } = await import('../src/game/itemActions.js');
    const found = findShopFloor();
    assert.ok(found);
    const { world, room } = found;
    const good = world.run.floorItems.find((f) => f.item.shopPrice > 0);
    world.player.pos = { ...good.pos };
    stepTurn(world, { type: 'pickup' });
    world.drainEvents();
    assert.ok(shopDebt(world) > 0);
    const scroll = makeItem('thiefScroll', world.rng, {}, () => world.nextUid());
    addToInventory(world.player, scroll);
    useItem(world, scroll.uid);
    world.drainEvents();
    assert.equal(shopDebt(world), 0, '巻物を読んでも借金が消えない');
    assert.equal(room.shop.angry, false);
});
//# sourceMappingURL=shop.test.js.map