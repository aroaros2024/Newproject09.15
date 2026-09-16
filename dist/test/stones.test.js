import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthValue, stonesForRun } from '../src/game/rules.js';
import { startRun } from '../src/game/run.js';
import { finishRun } from '../src/game/town.js';
/**
 * 石の配り方の検査。
 *
 * 「倒れても貰える」だけだと、浅い階を何度も往復するのが
 * 最も効率の良い稼ぎ方になってしまい、深く潜る理由が無くなる。
 * 単純な比例にしない、というのがここで守りたいこと。
 */
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1', 'd2', 'd3', 'd4', 'dl', 'ex', 'exPure'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
        knownItems: {}, nicknames: {}, stones: 0,
    };
}
const award = (o) => stonesForRun({
    depth: 1, prevBest: 0, dungeonDepth: 99, cleared: false, firstClear: false, ...o,
});
test('深い階ほど 1 階あたりの価値が重い', () => {
    // 単純な比例なら depthValue(40) は depthValue(20) のちょうど 2 倍になる
    const shallow = depthValue(20) - depthValue(10);
    const deep = depthValue(40) - depthValue(30);
    assert.ok(deep > shallow, `深い 10 階(${deep})が 浅い 10 階(${shallow})より軽い`);
    assert.ok(depthValue(40) > depthValue(20) * 2, '比例のままになっている');
    assert.equal(depthValue(0), 0);
});
test('初めて踏んだ階は満額、踏み直した階は目減りする', () => {
    const firstTime = award({ depth: 20, prevBest: 0 });
    const again = award({ depth: 20, prevBest: 20 });
    assert.ok(firstTime > again * 2, `初回 ${firstTime} と再訪 ${again} の差が小さすぎる`);
    assert.ok(again >= 1, '踏み直しでも 0 にはしない（負けても前に進むため）');
});
test('同じ階を往復するより、1 階でも深く潜る方が得', () => {
    // 自己最高 20F の人が、20F まで潜って死ぬ vs 25F まで潜って死ぬ
    const stay = award({ depth: 20, prevBest: 20 });
    const push = award({ depth: 25, prevBest: 20 });
    assert.ok(push > stay, `深く潜った方(${push})が 往復(${stay})より少ない`);
    // 浅い階の往復を 3 回しても、深く潜る 1 回に及ばない
    const shallowFarm = award({ depth: 10, prevBest: 30 }) * 3;
    const oneDeepRun = award({ depth: 35, prevBest: 30 });
    assert.ok(oneDeepRun > shallowFarm, `浅い階の往復 3 回(${shallowFarm})が 深潜り 1 回(${oneDeepRun})を上回る`);
});
test('クリアと初クリアには上乗せがある', () => {
    const died = award({ depth: 10, prevBest: 0, dungeonDepth: 10 });
    const cleared = award({ depth: 10, prevBest: 0, dungeonDepth: 10, cleared: true });
    const first = award({
        depth: 10, prevBest: 0, dungeonDepth: 10, cleared: true, firstClear: true,
    });
    assert.ok(cleared > died, 'クリアしても増えない');
    assert.ok(first > cleared, '初クリアの重みが無い');
});
test('倒れても石は貰える', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 5 });
    world.run.stats.maxDepth = 6;
    const res = finishRun(world, town, 'death', 'テスト');
    assert.ok(res.stones > 0, '倒れると石が貰えない');
    assert.equal(town.stones, res.stones, '村に石が入っていない');
});
test('2 回目の冒険は、同じ深さなら取り分が減る', () => {
    const town = newTown();
    const a = startRun('d2', town, { seed: 5 });
    a.run.stats.maxDepth = 8;
    const first = finishRun(a, town, 'escape', 'テスト').stones;
    const b = startRun('d2', town, { seed: 6 });
    b.run.stats.maxDepth = 8;
    const second = finishRun(b, town, 'escape', 'テスト').stones;
    assert.ok(first > second, `1 回目 ${first} と 2 回目 ${second} が同じ`);
    assert.equal(town.stones, first + second, '石が積み上がっていない');
});
//# sourceMappingURL=stones.test.js.map