import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { DIRS } from '../src/core/geom.js';
import { getDungeon } from '../src/data/registry.js';
import { attachFactories, startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { finishRun } from '../src/game/town.js';
import { World } from '../src/game/world.js';
import { killActor } from '../src/game/combat.js';
/**
 * ミッション用カウンタの検査。
 *
 * 数える口は World.tally 1 本だけ。冒険中は RunState に溜め、
 * finishRun で村へ一度だけ移す。村へ直接書くと、中断セーブから
 * 再開したときに同じぶんを二度数えてしまう。
 */
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1', 'd2', 'd3'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
        knownItems: {}, nicknames: {}, stones: 0, tally: {}, claimed: [],
    };
}
/** ランダムに動かす。歩数は必ず増える */
function play(world, turns, seed) {
    const rng = new Rng(seed);
    for (let i = 0; i < turns && !world.finished; i++) {
        stepTurn(world, { type: 'move', dir: rng.pick(DIRS) });
        world.drainEvents();
        world.player.hp = world.player.maxHp;
    }
}
test('冒険中の数えは、帰るまで村に入らない', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 11 });
    play(world, 60, 1);
    assert.ok((world.run.tally?.walk ?? 0) > 0, '冒険側で数えていない');
    assert.equal(town.tally?.walk ?? 0, 0, '帰る前に村へ入っている');
    finishRun(world, town, 'escape', 'テスト');
    assert.ok((town.tally?.walk ?? 0) > 0, '帰っても村へ入らない');
    assert.equal(world.run.tally?.walk ?? 0, 0, '移したのに冒険側に残っている');
});
test('中断して再開しても、二重に数えない', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 12 });
    play(world, 40, 2);
    const walked = world.run.tally?.walk ?? 0;
    assert.ok(walked > 0);
    // 中断（JSON を往復）して再開する
    const snapshot = JSON.parse(JSON.stringify(world.syncForSave()));
    const revived = new World(snapshot, getDungeon(snapshot.dungeonId));
    attachFactories(revived);
    assert.equal(revived.run.tally?.walk ?? 0, walked, '再開で数えが失われた');
    play(revived, 20, 3);
    const after = revived.run.tally?.walk ?? 0;
    assert.ok(after > walked, '再開後に数えが伸びていない');
    finishRun(revived, town, 'escape', 'テスト');
    assert.equal(town.tally?.walk, after, `村に ${town.tally?.walk} 入った（期待 ${after}）`);
});
test('同じ冒険の精算を二度しても、二度は数えない', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 13 });
    play(world, 40, 4);
    finishRun(world, town, 'escape', 'テスト');
    const once = town.tally?.walk ?? 0;
    finishRun(world, town, 'escape', 'テスト');
    assert.equal(town.tally?.walk ?? 0, once, '二度目の精算で増えた');
});
test('古い中断データに数えが無くても壊れない', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 14 });
    play(world, 20, 5);
    const snapshot = JSON.parse(JSON.stringify(world.syncForSave()));
    delete snapshot.tally;
    delete snapshot.pendingRejoin;
    const revived = new World(snapshot, getDungeon('d2'));
    attachFactories(revived);
    play(revived, 20, 6);
    assert.ok((revived.run.tally?.walk ?? 0) > 0, '数え直せていない');
    finishRun(revived, town, 'escape', 'テスト');
    assert.ok((town.tally?.walk ?? 0) > 0);
});
test('倒した敵は種類ごとに数える', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 15 });
    const before = { ...(world.run.tally ?? {}) };
    // 敵を 1 体、実際に倒す
    const target = world.run.monsters.find((m) => m.alive);
    assert.ok(target, '敵がいない');
    killActor(world, world.player, target);
    world.drainEvents();
    assert.equal((world.run.tally?.kill ?? 0) - (before.kill ?? 0), 1, '総数が増えていない');
    assert.equal(world.run.tally?.[`kill:${target.defId}`], 1, '種類ごとに数えていない');
});
//# sourceMappingURL=tally.test.js.map