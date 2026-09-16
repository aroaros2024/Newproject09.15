import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositItem, finishRun, withdrawItem } from '../src/game/town.js';
import { startRun } from '../src/game/run.js';
import { makeItem } from '../src/game/inventory.js';
import { Rng } from '../src/core/rng.js';
import { exportSave, importSave } from '../src/core/save.js';
// セーブは localStorage を通る。node では存在しないので最小限の代役を置く
const store = new Map();
const shim = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
};
globalThis.window = { localStorage: shim };
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1', 'd2'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    };
}
const uids = (town) => town.storage.flatMap((i) => [i.uid, ...i.contents.map((c) => c.uid)]);
test('倉庫に預けると uid が村の採番に振り直される', () => {
    const town = newTown();
    const rng = new Rng('t');
    // 冒険側の uid（1 から振り直される）をそのまま持ち帰ったつもりで預ける
    const a = makeItem('woodStick', rng, { uid: 1 }, () => 1);
    a.uid = 1;
    const b = makeItem('woodShield', rng, {}, () => 1);
    b.uid = 1;
    assert.ok(depositItem(town, a));
    assert.ok(depositItem(town, b));
    const list = uids(town);
    assert.equal(new Set(list).size, list.length, `倉庫の uid が重複している: ${list}`);
});
test('冒険を 2 回繰り返しても倉庫の uid が重複しない', () => {
    const town = newTown();
    for (let i = 0; i < 3; i++) {
        const world = startRun('d1', town, { seed: 100 + i });
        finishRun(world, town, 'escape', 'テスト');
    }
    const list = uids(town);
    assert.equal(new Set(list).size, list.length, `uid が重複している: ${list}`);
    assert.ok(list.length > 0, '何も持ち帰れていない');
});
test('倉庫から出すとき、狙った道具だけが消える', () => {
    const town = newTown();
    const rng = new Rng('t');
    for (const id of ['woodStick', 'woodShield', 'identifyScroll']) {
        const it = makeItem(id, rng, {}, () => 1);
        it.uid = 1; // わざと全部ぶつける
        depositItem(town, it);
    }
    const target = town.storage.find((i) => i.defId === 'woodShield');
    assert.ok(target);
    const got = withdrawItem(town, target.uid);
    assert.equal(got?.defId, 'woodShield', '別の道具が出てきた');
    assert.equal(town.storage.some((i) => i.defId === 'woodShield'), false, '出したのに残っている');
    assert.equal(town.storage.length, 2);
});
test('ギタンは冒険と村を往復しても増えない', () => {
    const town = newTown();
    town.gitan = 1000;
    for (let i = 0; i < 3; i++) {
        const world = startRun('d2', town, { seed: 7 + i, bring: [] });
        world.player.gitan += 0; // 拾わずに帰る
        finishRun(world, town, 'escape', 'テスト');
    }
    assert.equal(town.gitan, 1000, `ギタンが ${town.gitan} に増減した`);
});
test('古いセーブに混ざった重複 uid は、読み込み時にならされる', () => {
    const town = newTown();
    const rng = new Rng('t');
    for (const id of ['woodStick', 'woodShield', 'healHerb']) {
        const it = makeItem(id, rng, {}, () => 1);
        it.uid = 1;
        town.storage.push(it); // depositItem を通さず、壊れたセーブを再現
    }
    const blob = JSON.stringify({
        version: 2,
        town,
        settings: null,
        run: null,
    });
    assert.ok(importSave(blob), 'セーブを読み込めない');
    const restored = JSON.parse(exportSave()).town;
    const list = uids(restored);
    assert.equal(new Set(list).size, list.length, `読み込み後も重複している: ${list}`);
});
//# sourceMappingURL=town.test.js.map