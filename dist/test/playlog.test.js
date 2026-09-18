import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { DIRS } from '../src/core/geom.js';
import { MAX_ACTIONS, Recorder, decodeAction, decodeActions, encodeAction, encodeActions, replayRun, } from '../src/game/recorder.js';
import { buildPlayLog, decodeReplay, encodeReplay, parsePlayLog } from '../src/game/playlog.js';
import { startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { makeItem } from '../src/game/inventory.js';
import { finishRun } from '../src/game/town.js';
/**
 * プレイログの検査。
 *
 * この機能が価値を持つのは「記録したものが本当に再生できる」ときだけ。
 * 再生が 1 手でもずれると、渡された側は存在しない場面を調べることになる。
 * だから一番大事なのは「再生した結果が元と 1 バイト違わない」1 本。
 */
function newTown(over = {}) {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
        knownItems: {}, nicknames: {}, stones: 0, tally: {}, claimed: [],
        gachaOwned: {}, gachaPulls: 0, partners: {}, activePartner: null,
        charms: [], activeCharm: null,
        ...over,
    };
}
/** ランダムに遊んで、押した行動を全部返す */
function playAndRecord(dungeonId, town, turns, seed) {
    const world = startRun(dungeonId, town, { seed });
    const rng = new Rng(seed * 131 + 7);
    const actions = [];
    for (let i = 0; i < turns; i++) {
        if (world.finished)
            break;
        const r = rng.float();
        const a = r < 0.70 ? { type: 'move', dir: rng.pick(DIRS) }
            : r < 0.85 ? { type: 'attack', dir: rng.pick(DIRS) }
                : r < 0.92 ? { type: 'wait' }
                    : r < 0.97 ? { type: 'pickup' }
                        : { type: 'stairs' };
        actions.push(a);
        stepTurn(world, a);
        world.drainEvents();
    }
    return { actions, final: JSON.stringify(world.syncForSave()) };
}
// ---------------------------------------------------------------------------
// 行動の書き出しと読み戻し
// ---------------------------------------------------------------------------
test('行動 18 種がすべて往復する', () => {
    const all = [
        { type: 'move', dir: 3 },
        { type: 'move', dir: 7, dash: true },
        { type: 'attack', dir: 1 },
        { type: 'turn', dir: 5 },
        { type: 'wait' },
        { type: 'pickup' },
        { type: 'place', uid: 12 },
        { type: 'swap', uid: 34 },
        { type: 'use', uid: 5 },
        { type: 'use', uid: 5, targetUid: 9 },
        { type: 'use', uid: 5, dir: 2 },
        { type: 'use', uid: 5, targetUid: 9, dir: 2 },
        { type: 'equip', uid: 7 },
        { type: 'unequip', uid: 7 },
        { type: 'throw', uid: 8, dir: 6 },
        { type: 'putIn', potUid: 2, uid: 3 },
        { type: 'takeOut', potUid: 2, index: 1 },
        { type: 'stairs' },
        { type: 'buy' },
        { type: 'sell', uid: 4 },
        { type: 'setTactic', tactic: 'avoid' },
        { type: 'none' },
    ];
    for (const a of all) {
        assert.deepEqual(decodeAction(encodeAction(a)), a, `${encodeAction(a)} が往復しない`);
    }
    // まとめても往復する
    assert.deepEqual(decodeActions(encodeActions(all)), all);
    assert.deepEqual(decodeActions(encodeActions([])), []);
});
test('Action の型がすべて書き出せる（型を足したら落ちる）', () => {
    const types = [
        'move', 'attack', 'turn', 'wait', 'pickup', 'place', 'swap', 'use', 'equip',
        'unequip', 'throw', 'putIn', 'takeOut', 'stairs', 'buy', 'sell', 'setTactic', 'none',
    ];
    assert.equal(types.length, 18);
    const tags = new Set(types.map((t) => encodeAction({ type: t }).slice(0, 1)));
    assert.equal(tags.size, 18, '印がぶつかっている');
});
test('読めない行動が来ても落ちない', () => {
    assert.deepEqual(decodeAction(''), { type: 'none' });
    assert.deepEqual(decodeAction('？？'), { type: 'none' });
    assert.deepEqual(decodeAction('m'), { type: 'move', dir: 0 });
});
// ---------------------------------------------------------------------------
// 再生できること（この機能の芯）
// ---------------------------------------------------------------------------
test('記録した冒険を再生すると、最後の状態が完全に一致する', () => {
    for (const dungeonId of ['d1', 'd3', 'ex']) {
        const town = newTown({ cleared: ['d1', 'd2', 'd3', 'd4', 'dl', 'exBring'] });
        const seed = 4242;
        const { actions, final } = playAndRecord(dungeonId, town, 500, seed);
        assert.ok(actions.length > 100, `${dungeonId}: 手数が足りない`);
        const replay = {
            version: 1, dungeonId, seed, town: newTown({
                cleared: ['d1', 'd2', 'd3', 'd4', 'dl', 'exBring'],
            }), bring: [], actions, lines: [], truncated: false,
        };
        const out = replayRun(replay);
        assert.equal(out.applied, actions.length, `${dungeonId}: 全部流れていない`);
        assert.equal(JSON.stringify(out.world.syncForSave()), final, `${dungeonId}: 再生した結果が元とずれた`);
    }
});
test('持ち込んだ道具も込みで再生できる', () => {
    const rng = new Rng('bring');
    const town = newTown({ gitan: 500 });
    const sword = makeItem('ironSword', rng, { plus: 2 }, () => town.nextUid++);
    const herb = makeItem('healHerb', rng, {}, () => town.nextUid++);
    const bring = [sword, herb];
    const snapshot = JSON.parse(JSON.stringify(town));
    const bringCopy = JSON.parse(JSON.stringify(bring));
    const world = startRun('d1', town, { bring, seed: 99 });
    const r2 = new Rng(31);
    const actions = [];
    for (let i = 0; i < 120; i++) {
        if (world.finished)
            break;
        const a = { type: 'move', dir: r2.pick(DIRS) };
        actions.push(a);
        stepTurn(world, a);
        world.drainEvents();
    }
    const final = JSON.stringify(world.syncForSave());
    const out = replayRun({
        version: 1, dungeonId: 'd1', seed: 99, town: snapshot, bring: bringCopy,
        actions, lines: [], truncated: false,
    });
    assert.equal(JSON.stringify(out.world.syncForSave()), final, '持ち込みが再現できていない');
});
test('途中で止められる', () => {
    const town = newTown();
    const { actions } = playAndRecord('d1', town, 200, 7);
    const replay = {
        version: 1, dungeonId: 'd1', seed: 7, town: newTown(), bring: [],
        actions, lines: [], truncated: false,
    };
    const out = replayRun(replay, { untilAction: 50 });
    assert.equal(out.applied, 50);
});
test('再生でも同じできごとが出る', () => {
    const town = newTown();
    const { actions } = playAndRecord('d1', town, 200, 21);
    const a = replayRun({
        version: 1, dungeonId: 'd1', seed: 21, town: newTown(), bring: [],
        actions, lines: [], truncated: false,
    });
    const b = replayRun({
        version: 1, dungeonId: 'd1', seed: 21, town: newTown(), bring: [],
        actions, lines: [], truncated: false,
    });
    assert.ok(a.lines.length > 0, 'できごとが 1 行も出ていない');
    assert.deepEqual(a.lines, b.lines, '再生のたびに結果が変わる');
});
// ---------------------------------------------------------------------------
// 記録の器
// ---------------------------------------------------------------------------
test('写し取る前に始めたら、記録しない', () => {
    const rec = new Recorder();
    rec.begin('d1', 1);
    assert.equal(rec.current, null, '出発点が無いのに記録が始まった');
});
test('出発時の村は複製される（あとで村が変わっても影響しない）', () => {
    const rec = new Recorder();
    const town = newTown({ gitan: 1000 });
    rec.snapshot(town, []);
    rec.begin('d1', 1);
    town.gitan = 0;
    assert.equal(rec.current?.town.gitan, 1000, '村の写しが後から書き換わった');
});
test('上限を超えたら記録をやめる', () => {
    const rec = new Recorder();
    rec.snapshot(newTown(), []);
    rec.begin('d1', 1);
    for (let i = 0; i < MAX_ACTIONS + 10; i++)
        rec.action({ type: 'wait' });
    assert.equal(rec.current?.truncated, true, '止まっていない');
    assert.equal(rec.current?.actions.length, MAX_ACTIONS, '上限を超えて溜まった');
    assert.equal(rec.recording, false);
});
test('できごとにターン番号と階が付く', () => {
    const rec = new Recorder();
    rec.snapshot(newTown(), []);
    rec.begin('d1', 1);
    rec.line(42, 3, 'のらネズミ に 5 の ダメージ', 'normal');
    assert.deepEqual(rec.current?.lines[0], {
        turn: 42, depth: 3, text: 'のらネズミ に 5 の ダメージ', style: 'normal',
    });
});
// ---------------------------------------------------------------------------
// 書き出した 1 枚
// ---------------------------------------------------------------------------
function sampleReplay(actions) {
    return {
        version: 1, dungeonId: 'd2', seed: 12345, town: newTown({ gitan: 700 }), bring: [],
        actions,
        lines: [
            { turn: 1, depth: 1, text: 'せせらぎの森 1F', style: 'system' },
            { turn: 8, depth: 1, text: 'のらネズミ に 5 の ダメージ', style: 'normal' },
        ],
        truncated: false,
    };
}
test('再現データが往復する', async () => {
    const replay = sampleReplay([
        { type: 'move', dir: 1 }, { type: 'attack', dir: 2 }, { type: 'wait' },
    ]);
    const text = await encodeReplay(replay);
    const back = await decodeReplay(text);
    assert.ok(back, '読み戻せない');
    assert.deepEqual(back, replay);
});
test('壊れた再現データは null になる（落ちない）', async () => {
    assert.equal(await decodeReplay(''), null);
    assert.equal(await decodeReplay('ただの文章'), null);
    assert.equal(await decodeReplay('r1:これはbase64ではない'), null);
});
test('プレイログ 1 枚から再現データを取り出せる', async () => {
    const replay = sampleReplay([{ type: 'move', dir: 1 }, { type: 'stairs' }]);
    const text = await buildPlayLog(replay, {
        dungeonName: 'せせらぎの森', ending: 'ちからつきた', player: null,
        depth: 4, turn: 120, at: 0,
    });
    assert.ok(text.startsWith('# 風の村と天輪の塔 プレイログ'));
    assert.ok(text.includes('せせらぎの森 4F'), '見出しにダンジョンと階が無い');
    assert.ok(text.includes('終わり方: ちからつきた'));
    assert.ok(text.includes('[8] 1F  のらネズミ に 5 の ダメージ'), 'できごとにターンと階が無い');
    const back = await parsePlayLog(text);
    assert.deepEqual(back, replay);
});
test('長い冒険でも貼り付けられる大きさに収まる', async () => {
    const town = newTown();
    const { actions } = playAndRecord('d1', town, 3000, 555);
    const replay = sampleReplay(actions);
    for (let i = 0; i < 3000; i++) {
        replay.lines.push({ turn: i, depth: 1, text: 'のらネズミ に 5 の ダメージ', style: 'normal' });
    }
    const text = await buildPlayLog(replay, {
        dungeonName: '始まりの洞窟', ending: null, player: null, depth: 5, turn: 3000, at: 0,
    });
    // 貼り付けて渡すものなので、桁が変わると使えない
    assert.ok(text.length < 400_000, `1 枚が ${Math.round(text.length / 1024)}KB ある`);
    const back = await parsePlayLog(text);
    assert.equal(back?.actions.length, actions.length, '長いと読み戻せない');
});
// ---------------------------------------------------------------------------
// ついでに直したもの
// ---------------------------------------------------------------------------
test('冒険の記録に、持ち帰ったギタンが残る', () => {
    const town = newTown();
    const world = startRun('d1', town, { seed: 5 });
    world.player.gitan = 777;
    finishRun(world, town, 'escape', '帰還');
    const rec = town.history[town.history.length - 1];
    assert.equal(rec.gitan, 777, '持ち帰ったギタンが記録されていない');
});
test('持ち物を失うダンジョンで倒れたら、持ち帰ったギタンは 0', () => {
    // d1 は初心者向けで倒れても失わない（death.ts の losesItemsOnDeath）
    const town = newTown({ cleared: ['d1'], unlocked: ['d1', 'd2'] });
    const world = startRun('d2', town, { seed: 5 });
    world.player.gitan = 777;
    finishRun(world, town, 'death', 'ちからつきた');
    const rec = town.history[town.history.length - 1];
    assert.equal(rec.gitan, 0);
});
test('倒れても失わないダンジョンなら、ギタンは持ち帰れる', () => {
    const town = newTown();
    const world = startRun('d1', town, { seed: 5 });
    world.player.gitan = 777;
    finishRun(world, town, 'death', 'ちからつきた');
    assert.equal(town.history[town.history.length - 1].gitan, 777);
});
//# sourceMappingURL=playlog.test.js.map