import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allDungeons } from '../src/data/registry.js';
import { enterFloor, startRun } from '../src/game/run.js';
import { at, connectivityReport, renderAscii, walkDistance, } from '../src/dungeon/tilemap.js';
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    };
}
/**
 * 全ダンジョンの全フロアを実際に作って、遊べる形になっているか確かめる。
 * もっと不思議の 99F まで含めて、1 つでも「階段に行けない階」があれば
 * そこで詰むので、ここは必ず通っていないといけない。
 */
test('全ダンジョンの全フロアが生成でき、階段まで歩いて行ける', () => {
    const problems = [];
    for (const d of allDungeons()) {
        const world = startRun(d.id, newTown(), { seed: 20260916 });
        for (let depth = 1; depth <= d.depth; depth++) {
            enterFloor(world, depth);
            world.drainEvents();
            const where = `${d.id} ${depth}F`;
            const report = connectivityReport(world.map);
            if (!report.connected) {
                problems.push(`${where}: フロアが分断されている`);
                continue;
            }
            const stairs = world.map.stairs;
            if (stairs.x < 0 || !at(world.map, stairs.x, stairs.y)) {
                problems.push(`${where}: 階段が置かれていない`);
                continue;
            }
            if (at(world.map, stairs.x, stairs.y).kind !== 'stairs') {
                problems.push(`${where}: 階段のマスが階段になっていない`);
            }
            const dist = walkDistance(world.map, world.player.pos, stairs);
            if (dist < 0) {
                problems.push(`${where}: 階段まで歩いて行けない\n${renderAscii(world.map, [
                    { p: world.player.pos, ch: '@' }, { p: stairs, ch: '>' },
                ])}`);
            }
            // プレイヤーが壁や水の中にいない
            const tile = at(world.map, world.player.pos.x, world.player.pos.y);
            if (tile.kind === 'wall')
                problems.push(`${where}: プレイヤーが壁の中`);
            if (tile.kind === 'water' || tile.kind === 'lava') {
                problems.push(`${where}: プレイヤーが液体の中`);
            }
            // アクターとアイテムが重なっていない
            const spots = new Set();
            for (const a of world.livingActors()) {
                const key = `${a.pos.x},${a.pos.y}`;
                if (spots.has(key))
                    problems.push(`${where}: アクターが重なっている (${key})`);
                spots.add(key);
            }
            const itemSpots = new Set();
            for (const f of world.run.floorItems) {
                const key = `${f.pos.x},${f.pos.y}`;
                if (itemSpots.has(key))
                    problems.push(`${where}: 床アイテムが重なっている (${key})`);
                itemSpots.add(key);
            }
            // モンスターが上限を超えていない
            if (world.run.monsters.length > d.gen.maxMonsters + 8) {
                problems.push(`${where}: モンスターが多すぎる (${world.run.monsters.length})`);
            }
        }
    }
    assert.deepEqual(problems.slice(0, 10), [], `フロアの不備 ${problems.length} 件:\n${problems.slice(0, 10).join('\n')}`);
});
test('どの階でもアイテムとモンスターが必ず湧く', () => {
    const empty = [];
    for (const d of allDungeons()) {
        const world = startRun(d.id, newTown(), { seed: 555 });
        // 階数の多いダンジョンは間引いて見る
        const stepBy = d.depth > 30 ? 7 : 1;
        for (let depth = 1; depth <= d.depth; depth += stepBy) {
            enterFloor(world, depth);
            world.drainEvents();
            if (world.run.monsters.length === 0)
                empty.push(`${d.id} ${depth}F: モンスターが 0`);
            if (world.run.floorItems.length === 0)
                empty.push(`${d.id} ${depth}F: アイテムが 0`);
        }
    }
    assert.deepEqual(empty, [], `中身の無い階:\n${empty.join('\n')}`);
});
test('ボスのいる階には必ずボスが配置される', () => {
    for (const d of allDungeons()) {
        if (d.bosses.length === 0)
            continue;
        const world = startRun(d.id, newTown(), { seed: 909 });
        for (const b of d.bosses) {
            enterFloor(world, b.depth);
            world.drainEvents();
            const here = world.run.monsters.filter((m) => world.defOf(m).isBoss);
            assert.ok(here.length >= 1, `${d.id} ${b.depth}F にボスがいない`);
            // 2 形態のボスは 1 体ずつ出る
            assert.equal(here.length, 1, `${d.id} ${b.depth}F にボスが ${here.length} 体いる`);
            assert.equal(world.bossesCleared(), false, 'ボスがいるのにクリア扱い');
        }
    }
});
test('もっと不思議のダンジョンは 99F まで作れる', () => {
    const world = startRun('ex', newTown(), { seed: 99999 });
    const checks = [1, 10, 25, 50, 75, 90, 99];
    for (const depth of checks) {
        enterFloor(world, depth);
        world.drainEvents();
        assert.ok(connectivityReport(world.map).connected, `ex ${depth}F が分断されている`);
        assert.ok(walkDistance(world.map, world.player.pos, world.map.stairs) >= 0, `ex ${depth}F で階段まで行けない`);
        assert.ok(world.run.monsters.length > 0, `ex ${depth}F にモンスターがいない`);
    }
});
test('ラストダンジョンは、ボスを 2 形態とも倒すとクリアできる', async () => {
    const { stepTurn } = await import('../src/game/turn.js');
    const town = newTown();
    const world = startRun('dl', town, { seed: 777777 });
    enterFloor(world, 30);
    world.drainEvents();
    // ここで見たいのは形態変化の仕組みなので、取り巻きに倒されないようにする
    world.player.maxHp = 9999;
    world.player.hp = 9999;
    // 階段の上に立つ
    world.player.pos = { ...world.map.stairs };
    // 第 1 形態を倒す
    let boss = world.run.monsters.find((m) => world.defOf(m).isBoss);
    assert.ok(boss, '第 1 形態がいない');
    assert.equal(boss.defId, 'bossTowerFirst');
    boss.hp = 0;
    boss.alive = false;
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
    // まだ降りられない
    assert.equal(world.bossesCleared(), false);
    stepTurn(world, { type: 'stairs' });
    world.drainEvents();
    assert.equal(world.finished, null, '第 2 形態が残っているのにクリアした');
    // 第 2 形態を倒す
    boss = world.run.monsters.find((m) => world.defOf(m).isBoss);
    assert.ok(boss, '第 2 形態が現れていない');
    assert.equal(boss.defId, 'bossTowerFinal');
    boss.hp = 0;
    boss.alive = false;
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
    assert.equal(world.bossesCleared(), true, 'ボスを倒したのに階段が開かない');
    // 降りるとクリア
    world.player.pos = { ...world.map.stairs };
    stepTurn(world, { type: 'stairs' });
    world.drainEvents();
    assert.ok(world.finished, '踏破していない');
    assert.equal(world.finished.kind, 'clear');
});
test('もっと不思議のダンジョンは 99F のボスを倒すと踏破になる', async () => {
    const { stepTurn } = await import('../src/game/turn.js');
    const world = startRun('ex', newTown(), { seed: 424242 });
    enterFloor(world, 99);
    world.drainEvents();
    world.player.maxHp = 9999;
    world.player.hp = 9999;
    const boss = world.run.monsters.find((m) => world.defOf(m).isBoss);
    assert.ok(boss, '99F にボスがいない');
    assert.equal(boss.defId, 'bossAbyss');
    // ボスを無視して降りられない
    world.player.pos = { ...world.map.stairs };
    stepTurn(world, { type: 'stairs' });
    world.drainEvents();
    assert.equal(world.finished, null, 'ボスを倒さずに踏破できた');
    boss.hp = 0;
    boss.alive = false;
    stepTurn(world, { type: 'wait' });
    world.drainEvents();
    world.player.pos = { ...world.map.stairs };
    stepTurn(world, { type: 'stairs' });
    world.drainEvents();
    assert.ok(world.finished, '99F を踏破できない');
    assert.equal(world.finished.kind, 'clear');
});
//# sourceMappingURL=floors.test.js.map