import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun } from '../src/game/run.js';
import { buyFromTown, finishRun, shopStock, townIdentify, withdrawItem, } from '../src/game/town.js';
import { addToInventory, makeItem } from '../src/game/inventory.js';
import { isUnidentifiableKind, itemName } from '../src/game/naming.js';
import { getItem } from '../src/data/registry.js';
/**
 * 「村では名前が出ていた物が、ダンジョンで未識別に戻る」を防ぐ検査。
 *
 * 村の画面が常に本名を出し、冒険は毎回まっさらな識別表を作っていたため、
 * 名前を見て買った巻物が持ち込んだ途端に「ピヨリン巻物」になっていた。
 * 一方で、床で拾った未知の品は未識別のままでなければ、
 * 不思議のダンジョンとして成立しない。両立していることを見る。
 */
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 20000,
        cleared: [], unlocked: ['d1', 'd2'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
        knownItems: {}, nicknames: {},
    };
}
/** 倉庫の中身をすべて取り出す（map しながら splice しないよう、先に控える） */
function takeAll(town) {
    const uids = town.storage.map((i) => i.uid);
    return uids.map((uid) => withdrawItem(town, uid)).filter((i) => i !== null);
}
test('村で名前を見て買った物は、ダンジョンでも名前のまま', () => {
    const town = newTown();
    // 品揃えは覗くたびに変わるので、id を決め打ちにしない。
    // 「正体が分かるかどうかが意味を持つ」カテゴリの物を買う
    const bought = [];
    for (const item of shopStock(town)) {
        if (!isUnidentifiableKind(getItem(item.defId)))
            continue;
        if (buyFromTown(town, item))
            bought.push(item.defId);
    }
    assert.ok(bought.length >= 1, `買えたのが ${bought.length} 個しかない`);
    // 村の表示
    const tid = townIdentify(town);
    for (const item of town.storage) {
        assert.ok(town.knownItems?.[item.defId], `${item.defId} を村が覚えていない`);
        assert.ok(!itemName(item, tid).includes('？'), `村で ${itemName(item, tid)} と出ている`);
    }
    // 持ち込んだ後
    const world = startRun('d2', town, { seed: 5, bring: takeAll(town) });
    for (const defId of bought) {
        const carried = world.player.inventory.find((i) => i.defId === defId);
        assert.ok(carried, `${defId} が持ち込めていない`);
        assert.equal(world.run.identify.known[defId], true, `${defId} がダンジョンで未識別に戻っている（${itemName(carried, world.run.identify)}）`);
    }
});
test('床で拾った未知の品は、未識別のまま', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 5 });
    const found = makeItem('sleepHerb', world.rng, {}, () => world.nextUid());
    addToInventory(world.player, found);
    assert.notEqual(world.run.identify.known.sleepHerb, true, '拾っただけで正体が割れている');
    assert.notEqual(itemName(found, world.run.identify), '睡眠草', '本名が出てしまっている');
});
test('正体を知ったまま持ち帰ると、村が名前を覚える', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 5 });
    const herb = makeItem('sleepHerb', world.rng, {}, () => world.nextUid());
    addToInventory(world.player, herb);
    world.run.identify.known.sleepHerb = true;
    world.run.identify.nicknames.confuseHerb = 'あぶない';
    finishRun(world, town, 'escape', 'テスト');
    assert.equal(town.knownItems?.sleepHerb, true, '持ち帰ったのに覚えていない');
    assert.equal(town.nicknames?.confuseHerb, 'あぶない', 'つけた名前が消えた');
    // 次の冒険に引き継がれる
    const next = startRun('d2', town, { seed: 6 });
    assert.equal(next.run.identify.known.sleepHerb, true, '次の冒険で忘れている');
    assert.equal(next.run.identify.nicknames.confuseHerb, 'あぶない', 'つけた名前が消えた');
});
test('知らない品目の仮名は、冒険ごとに変わる', () => {
    // 覚えていない物の正体当ては毎回まっさらでないと、
    // 「名前を暗記するだけ」のゲームになる
    const town = newTown();
    const a = startRun('d2', town, { seed: 5 });
    const b = startRun('d2', town, { seed: 6 });
    const ids = Object.keys(a.run.identify.alias);
    assert.ok(ids.length > 50, `仮名の表が ${ids.length} 件しかない`);
    const changed = ids.filter((id) => a.run.identify.alias[id] !== b.run.identify.alias[id]);
    assert.ok(changed.length > ids.length / 2, `仮名が ${changed.length}/${ids.length} しか変わっていない`);
});
test('死んで失った物の正体は、村に残らない', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 5 });
    const herb = makeItem('sleepHerb', world.rng, {}, () => world.nextUid());
    addToInventory(world.player, herb);
    world.run.identify.known.sleepHerb = true;
    // d2 は死ぬと持ち物を失う
    finishRun(world, town, 'death', 'テスト');
    assert.notEqual(town.knownItems?.sleepHerb, true, '失ったのに覚えている');
});
//# sourceMappingURL=identify.test.js.map