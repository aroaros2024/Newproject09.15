import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { DIRS, chebyshev } from '../src/core/geom.js';
import { startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { connectivityReport, at } from '../src/dungeon/tilemap.js';
import { getDungeon } from '../src/data/registry.js';
import { attackPower, defensePower, gainExp } from '../src/game/combat.js';
import { EXP_TABLE, calcDamage, expectedDamage } from '../src/game/rules.js';
function newTown(name = 'ナギ') {
    return {
        playerName: name, storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    };
}
/** ランダムに操作して n ターン遊ぶ。落ちないことと不変条件を確認する */
function playRandomly(world, turns, rng) {
    let taken = 0;
    for (let i = 0; i < turns && !world.finished; i++) {
        const roll = rng.int(100);
        let action;
        if (roll < 62)
            action = { type: 'move', dir: rng.pick(DIRS) };
        else if (roll < 74)
            action = { type: 'attack', dir: rng.pick(DIRS) };
        else if (roll < 82)
            action = { type: 'wait' };
        else if (roll < 90)
            action = { type: 'pickup' };
        else
            action = { type: 'stairs' };
        stepTurn(world, action);
        world.drainEvents();
        taken++;
        assertInvariants(world);
    }
    return taken;
}
function assertInvariants(world) {
    const p = world.player;
    const map = world.map;
    assert.ok(p.hp >= 0 && p.hp <= p.maxHp, `HP が範囲外: ${p.hp}/${p.maxHp}`);
    assert.ok(p.foodX10 >= 0 && p.foodX10 <= p.maxFoodX10, `満腹度が範囲外: ${p.foodX10}`);
    assert.ok(p.level >= 1 && p.level <= 99, `レベルが範囲外: ${p.level}`);
    assert.ok(p.str >= 0 && p.str <= p.maxStr, `ちからが範囲外: ${p.str}/${p.maxStr}`);
    assert.ok(p.gitan >= 0, 'ギタンが負');
    assert.ok(p.inventory.length <= 20, `持ち物が上限を超えた: ${p.inventory.length}`);
    assert.ok(p.pos.x >= 0 && p.pos.y >= 0 && p.pos.x < map.width && p.pos.y < map.height, `プレイヤーがマップ外: ${p.pos.x},${p.pos.y}`);
    const tile = at(map, p.pos.x, p.pos.y);
    assert.ok(tile && tile.kind !== 'wall', 'プレイヤーが壁の中にいる');
    // アクターが重なっていない
    const seen = new Set();
    for (const a of world.livingActors()) {
        const key = `${a.pos.x},${a.pos.y}`;
        assert.ok(!seen.has(key), `アクターが重なっている: ${key}`);
        seen.add(key);
        const t = at(map, a.pos.x, a.pos.y);
        assert.ok(t, 'アクターがマップ外');
    }
    // 床アイテムが重なっていない
    const itemSpots = new Set();
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
        }
        else {
            // 階段へ向かって歩く
            const dx = Math.sign(world.map.stairs.x - world.player.pos.x);
            const dy = Math.sign(world.map.stairs.y - world.player.pos.y);
            const dir = dirFromVec(dx, dy) ?? rng.pick(DIRS);
            stepTurn(world, { type: 'move', dir });
            if (rng.percent(25))
                stepTurn(world, { type: 'move', dir: rng.pick(DIRS) });
        }
        world.drainEvents();
    }
    assert.ok(world.finished, `${guard} ターンでも決着しなかった`);
    // 死ぬこともあるが、クリアか死亡のどちらかには必ず到達する
    assert.ok(['clear', 'death', 'escape'].includes(world.finished.kind));
});
function dirFromVec(dx, dy) {
    for (const d of DIRS) {
        const v = [
            [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
        ][d];
        if (v[0] === dx && v[1] === dy)
            return d;
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
    assert.equal(world.player.inventory.length, 1);
    assert.equal(world.player.inventory[0].defId, 'ironSword');
    // 倉庫の実体をそのまま持ち込まない（片方を壊してももう片方に響かない）
    assert.notEqual(world.player.inventory[0], bring[0], '倉庫の実体を共有している');
    world.player.inventory[0].plus = 99;
    assert.equal(bring[0].plus, 3, '倉庫側まで書き換わっている');
    world.player.inventory[0].runes.push('flame');
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
    assert.equal(attackPower(world, world.player), 8);
    assert.equal(defensePower(world, world.player), 0);
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
    m.pos = spot;
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
//# sourceMappingURL=play.test.js.map