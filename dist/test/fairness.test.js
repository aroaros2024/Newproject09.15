import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chebyshev } from '../src/core/geom.js';
import { at } from '../src/dungeon/tilemap.js';
import { makeMonster } from '../src/dungeon/spawn.js';
import { addKept, addToInventory, keptItems, makeItem } from '../src/game/inventory.js';
import { BASE_KEEP_SLOTS, MAX_KEEP_SLOTS } from '../src/game/rules.js';
import { finishRun, keepSlotsFor } from '../src/game/town.js';
import { getDungeon } from '../src/data/registry.js';
import { samePoint } from '../src/core/geom.js';
import { enterFloor, startRun } from '../src/game/run.js';
import { restTurns, stepTurn, whyCannotRest } from '../src/game/turn.js';
import { applyStatus } from '../src/game/status.js';
/**
 * 「プレイヤーが手を打つ機会を与えられないまま損をする」を禁じる検査。
 *
 * 実プレイで次の 3 つが報告された。どれも同じ形をしている。
 *   ・休憩が長いので長押ししていると、止まるべき所で止まらず殴られる
 *   ・モンスターハウスで、自分が動く前に殴られる
 *   ・階段を降りた足元にワナがあり、1 手も打てずに作動する
 */
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1', 'd2', 'd3', 'd4', 'dl', 'ex', 'exPure'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    };
}
test('敵の隣で「休む」を選んでも、1 ターンも献上しない', () => {
    // 以前は「1 ターン進めてから危険を見る」構造だったため、
    // 選ぶたびに必ず 1 発もらっていた
    let rested = 0;
    let damage = 0;
    let cases = 0;
    for (let seed = 0; seed < 40; seed++) {
        const world = startRun('d2', newTown(), { seed: 200 + seed });
        const p = world.player;
        p.hp = Math.floor(p.maxHp / 2);
        const spot = { x: p.pos.x + 1, y: p.pos.y };
        if (at(world.map, spot.x, spot.y)?.kind !== 'floor')
            continue;
        world.addMonster(makeMonster(world, 'ratField', spot));
        cases++;
        const before = p.hp;
        rested += restTurns(world, 200);
        damage += Math.max(0, before - p.hp);
    }
    assert.ok(cases >= 10, `検査できた場面が ${cases} 件しかない`);
    assert.equal(rested, 0, '敵が隣にいるのに休んでしまった');
    assert.equal(damage, 0, '休もうとしただけで殴られた');
});
test('休めない時は、その理由が分かる', () => {
    const world = startRun('d2', newTown(), { seed: 7 });
    const p = world.player;
    p.hp = 1;
    const spot = { x: p.pos.x + 1, y: p.pos.y };
    if (at(world.map, spot.x, spot.y)?.kind === 'floor') {
        world.addMonster(makeMonster(world, 'ratField', spot));
        assert.equal(whyCannotRest(world), '敵が 近くにいて 休めない。');
    }
    p.hp = p.maxHp;
    assert.equal(whyCannotRest(world), 'HP は 満タンだ。');
});
test('店主の隣でも、無害な状態でも休める', () => {
    // 「敵が近い」「何か状態異常が付いている」で一律に止めると、
    // 店の中や浮遊中に永久に休めなくなる
    const shop = startRun('d2', newTown(), { seed: 11 });
    shop.player.hp = 1;
    const beside = { x: shop.player.pos.x + 1, y: shop.player.pos.y };
    if (at(shop.map, beside.x, beside.y)?.kind === 'floor') {
        shop.addMonster(makeMonster(shop, 'shopkeeper', beside, 'shopkeeper'));
        assert.ok(restTurns(shop, 200) > 0, '店主の隣で休めない');
    }
    const buffed = startRun('d2', newTown(), { seed: 12 });
    buffed.player.hp = 1;
    applyStatus(buffed, buffed.player, 'levitate');
    assert.ok(restTurns(buffed, 200) > 0, '浮遊しているだけで休めない');
});
test('モンスターハウスが発動したターンには殴られない', () => {
    let damage = 0;
    let adjacent = 0;
    let cases = 0;
    for (let seed = 0; seed < 60; seed++) {
        const world = startRun('d2', newTown(), { seed: 400 + seed });
        enterFloor(world, 8);
        world.drainEvents();
        const p = world.player;
        p.maxHp = 200;
        p.hp = 200;
        const tile = at(world.map, p.pos.x, p.pos.y);
        const room = world.map.rooms.find((r) => r.id === tile?.roomId);
        if (!room)
            continue;
        room.monsterHouse = 'normal';
        room.houseTriggered = false;
        cases++;
        const before = p.hp;
        stepTurn(world, { type: 'wait' });
        world.drainEvents();
        damage += Math.max(0, before - p.hp);
        adjacent += world.run.monsters.filter((m) => chebyshev(m.pos, p.pos) <= 1).length;
    }
    assert.ok(cases >= 30, `検査できた場面が ${cases} 件しかない`);
    assert.equal(damage, 0, 'ハウスが湧いたその場で殴られた');
    assert.equal(adjacent, 0, '真隣に湧いている');
});
test('湧いたばかりの敵は、そのターンには動かない', () => {
    const world = startRun('d2', newTown(), { seed: 3 });
    const p = world.player;
    const spot = { x: p.pos.x + 1, y: p.pos.y };
    if (at(world.map, spot.x, spot.y)?.kind !== 'floor')
        return;
    const m = world.addMonster(makeMonster(world, 'ratField', spot));
    assert.equal(m.actedThisTurn, 1, '湧いた直後に「行動済み」の印が立っていない');
});
test('階を降りた足元にワナも階段も店も無い', () => {
    let floors = 0;
    let onTrap = 0;
    let onStairs = 0;
    let overlapped = 0;
    for (const id of ['d1', 'd2', 'd3', 'd4']) {
        for (let seed = 0; seed < 25; seed++) {
            const world = startRun(id, newTown(), { seed: 900 + seed });
            for (let depth = 1; depth <= Math.min(6, world.dungeon.depth); depth++) {
                enterFloor(world, depth);
                world.drainEvents();
                floors++;
                const p = world.player.pos;
                const t = at(world.map, p.x, p.y);
                if (t?.trap)
                    onTrap++;
                if (p.x === world.map.stairs.x && p.y === world.map.stairs.y)
                    onStairs++;
                if (world.run.monsters.some((m) => m.pos.x === p.x && m.pos.y === p.y))
                    overlapped++;
            }
        }
    }
    assert.ok(floors >= 300, `検査できたフロアが ${floors} 件しかない`);
    assert.equal(onTrap, 0, `${onTrap}/${floors} フロアでワナの上から始まった`);
    assert.equal(onStairs, 0, `${onStairs}/${floors} フロアで階段の上から始まった`);
    assert.equal(overlapped, 0, `${overlapped}/${floors} フロアで敵と重なって始まった`);
});
test('置いた道具を、その場で拾い直さない', () => {
    // 足元のマスの処理が「動いたかどうか」に関係なく毎ターン走っていたため、
    // 置いた瞬間に「足元にアイテムがある」と判定して拾い直していた
    let placed = 0;
    let regrabbed = 0;
    for (const id of ['d1', 'd2', 'd3']) {
        for (let seed = 0; seed < 40; seed++) {
            const world = startRun(id, newTown(), { seed: 700 + seed });
            const p = world.player;
            if (world.floorItemAt(p.pos))
                continue;
            const item = makeItem('healHerb', world.rng, {}, () => world.nextUid());
            addToInventory(p, item);
            stepTurn(world, { type: 'place', uid: item.uid });
            world.drainEvents();
            placed++;
            if (p.inventory.some((i) => i.uid === item.uid))
                regrabbed++;
        }
    }
    assert.ok(placed >= 60, `検査できた場面が ${placed} 件しかない`);
    assert.equal(regrabbed, 0, `${regrabbed}/${placed} 件でその場で拾い直した`);
});
test('置いて、離れて、戻れば拾える', () => {
    const world = startRun('d2', newTown(), { seed: 3 });
    const p = world.player;
    const item = makeItem('healHerb', world.rng, {}, () => world.nextUid());
    addToInventory(p, item);
    const vecs = [
        [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    let dir = -1;
    for (let d = 0; d < 8; d++) {
        const q = { x: p.pos.x + vecs[d][0], y: p.pos.y + vecs[d][1] };
        if (at(world.map, q.x, q.y)?.kind === 'floor' && !world.actorAt(q)) {
            dir = d;
            break;
        }
    }
    assert.ok(dir >= 0, '隣に歩ける床が無い');
    stepTurn(world, { type: 'place', uid: item.uid });
    world.drainEvents();
    assert.equal(p.inventory.some((i) => i.uid === item.uid), false, '置けていない');
    stepTurn(world, { type: 'move', dir: dir });
    world.drainEvents();
    stepTurn(world, { type: 'move', dir: ((dir + 4) % 8) });
    world.drainEvents();
    assert.ok(p.inventory.some((i) => i.defId === 'healHerb'), '置いた場所へ戻っても拾えない');
});
test('ワナは踏んだ時だけ作動する', () => {
    // 歩いて乗れば必ず作動し、同じマスで足踏みしても二度目は作動しない
    let walked = 0;
    let firedOnEntry = 0;
    const vecs = [
        [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    for (let seed = 0; seed < 80; seed++) {
        const world = startRun('d3', newTown(), { seed: 100 + seed });
        const p = world.player;
        p.maxHp = 500;
        p.hp = 500;
        let dir = -1;
        let spot = null;
        for (let d = 0; d < 8; d++) {
            const q = { x: p.pos.x + vecs[d][0], y: p.pos.y + vecs[d][1] };
            const t = at(world.map, q.x, q.y);
            if (t?.kind === 'floor' && !world.actorAt(q) && !t.trap && !t.shop) {
                dir = d;
                spot = q;
                break;
            }
        }
        if (dir < 0 || !spot)
            continue;
        at(world.map, spot.x, spot.y).trap = { defId: 'arrow', revealed: false, used: false };
        stepTurn(world, { type: 'move', dir: dir });
        const events = world.drainEvents();
        if (!samePoint(p.pos, spot))
            continue;
        walked++;
        if (events.some((e) => e.t === 'trap' && samePoint(e.pos, spot)))
            firedOnEntry++;
    }
    assert.ok(walked >= 40, `検査できた場面が ${walked} 件しかない`);
    assert.equal(firedOnEntry, walked, `${walked} 件中 ${firedOnEntry} 件しか作動しなかった`);
    // 足踏みでは再作動しない
    let standing = 0;
    let refired = 0;
    for (let seed = 0; seed < 40; seed++) {
        const world = startRun('d3', newTown(), { seed: 500 + seed });
        const p = world.player;
        p.maxHp = 500;
        p.hp = 500;
        const here = at(world.map, p.pos.x, p.pos.y);
        if (!here || here.kind !== 'floor')
            continue;
        here.trap = { defId: 'arrow', revealed: true, used: false };
        const home = { ...p.pos };
        standing++;
        for (let i = 0; i < 5; i++) {
            stepTurn(world, { type: 'wait' });
            const events = world.drainEvents();
            if (events.some((e) => e.t === 'trap' && samePoint(e.pos, home)))
                refired++;
            p.hp = p.maxHp;
        }
    }
    assert.ok(standing >= 20, `検査できた場面が ${standing} 件しかない`);
    assert.equal(refired, 0, `足踏みで ${refired} 回 再作動した`);
});
test('店の出入口は 店主に塞がれない', () => {
    let shops = 0;
    let blocked = 0;
    for (const id of ['d2', 'd3', 'd4']) {
        for (let seed = 0; seed < 60; seed++) {
            const world = startRun(id, newTown(), { seed: 8000 + seed });
            for (let depth = 2; depth <= 8; depth++) {
                enterFloor(world, depth);
                world.drainEvents();
                const room = world.map.rooms.find((r) => r.shop);
                if (!room)
                    continue;
                const keeper = world.run.monsters.find((m) => m.kind === 'shopkeeper');
                if (!keeper)
                    continue;
                shops++;
                for (const d of room.doors) {
                    const dist = Math.abs(keeper.pos.x - d.x) + Math.abs(keeper.pos.y - d.y);
                    if (dist <= 1) {
                        blocked++;
                        break;
                    }
                }
            }
        }
    }
    assert.ok(shops >= 20, `検査できた店が ${shops} 件しかない`);
    assert.equal(blocked, 0, `${blocked}/${shops} 件で 店主が 出入口を 塞いでいた`);
});
test('怒っていない店主とは 位置を入れ替えられる', () => {
    // 入口に立たれた時の逃げ道。攻撃対象でも素通りでもないので、
    // 入れ替えられないと店に入れないまま詰む
    const world = startRun('d2', newTown(), { seed: 21 });
    const p = world.player;
    const vecs = [
        [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    let dir = -1;
    let spot = null;
    for (let d = 0; d < 8; d++) {
        const q = { x: p.pos.x + vecs[d][0], y: p.pos.y + vecs[d][1] };
        if (at(world.map, q.x, q.y)?.kind === 'floor' && !world.actorAt(q)) {
            dir = d;
            spot = q;
            break;
        }
    }
    assert.ok(dir >= 0 && spot, '隣に歩ける床が無い');
    const keeper = makeMonster(world, 'shopkeeper', spot, 'shopkeeper');
    world.addMonster(keeper);
    const before = { ...p.pos };
    stepTurn(world, { type: 'move', dir: dir });
    world.drainEvents();
    assert.deepEqual(p.pos, spot, '店主と入れ替われない');
    assert.deepEqual(keeper.pos, before, '店主が元の位置に来ていない');
});
test('保持枠に入れた道具は、倒れても持ち帰れる', () => {
    const town = newTown();
    const world = startRun('d2', town, { seed: 77 });
    const p = world.player;
    p.inventory.length = 0;
    p.weaponUid = null;
    p.shieldUid = null;
    const saved = makeItem('greatHerb', world.rng, {}, () => world.nextUid());
    const lost1 = makeItem('healHerb', world.rng, {}, () => world.nextUid());
    const lost2 = makeItem('riceBall', world.rng, {}, () => world.nextUid());
    for (const it of [saved, lost1, lost2])
        addToInventory(p, it);
    assert.equal(addKept(p, saved.uid, BASE_KEEP_SLOTS), true, '保持枠に入らない');
    // d2 は倒れると持ち物を失う
    finishRun(world, town, 'death', 'テスト');
    const names = town.storage.map((i) => i.defId);
    assert.ok(names.includes('greatHerb'), '保持したのに失われた');
    assert.equal(names.includes('healHerb'), false, '保持していない物が残った');
    assert.equal(names.includes('riceBall'), false, '保持していない物が残った');
});
test('保持枠は数に限りがあり、持てる数は増えない', () => {
    const world = startRun('d2', newTown(), { seed: 78 });
    const p = world.player;
    p.inventory.length = 0;
    // 山にまとまらない道具で数える（石や矢は 1 つの山になってしまう）
    const kinds = ['greatHerb', 'healHerb', 'riceBall', 'identifyScroll', 'lightScroll'];
    const made = kinds.slice(0, BASE_KEEP_SLOTS + 2).map((id) => {
        const it = makeItem(id, world.rng, {}, () => world.nextUid());
        addToInventory(p, it);
        return it;
    });
    for (let i = 0; i < BASE_KEEP_SLOTS; i++) {
        assert.equal(addKept(p, made[i].uid, BASE_KEEP_SLOTS), true, `${i} 個目が入らない`);
    }
    assert.equal(addKept(p, made[BASE_KEEP_SLOTS].uid, BASE_KEEP_SLOTS), false, '枠を超えて入ってしまう');
    assert.equal(keptItems(p).length, BASE_KEEP_SLOTS);
    // 持ち物の上限は変わらない
    assert.equal(p.inventory.length, BASE_KEEP_SLOTS + 2, '持てる数が変わってしまった');
});
test('保持した道具を手放すと、枠も空く', () => {
    const world = startRun('d2', newTown(), { seed: 79 });
    const p = world.player;
    p.inventory.length = 0;
    const item = makeItem('greatHerb', world.rng, {}, () => world.nextUid());
    addToInventory(p, item);
    addKept(p, item.uid, BASE_KEEP_SLOTS);
    assert.equal(keptItems(p).length, 1);
    stepTurn(world, { type: 'place', uid: item.uid });
    world.drainEvents();
    assert.equal(keptItems(p).length, 0, '置いたのに枠を占めたまま');
});
test('真・もっと不思議では、保持枠が 0 になる', () => {
    // 「何の加護も無い 99 階」なので、保持枠そのものが通じない
    const town = newTown();
    // 枠は村の数値ではなく、ガチャで引いた加護の枚数から出る。
    // 数値を別に持つと「引いた枚数」と「いまの枠」が必ずズレる
    assert.equal(keepSlotsFor(town, getDungeon('d2')), BASE_KEEP_SLOTS, '最初から増えている');
    town.gachaOwned = { 'b:keep': 2 };
    assert.equal(keepSlotsFor(town, getDungeon('exPure')), 0, '加護なしなのに枠がある');
    assert.equal(keepSlotsFor(town, getDungeon('ex')), 5, '加護ありなのに枠が増えていない');
    assert.equal(keepSlotsFor(town, getDungeon('d2')), 5);
    // 上限を超えて引いても、枠は 5 で止まる
    town.gachaOwned = { 'b:keep': 9 };
    assert.equal(keepSlotsFor(town, getDungeon('d2')), MAX_KEEP_SLOTS, '上限を超えた');
    // 枠が 0 のダンジョンでは、倒れたら何も残らない
    const world = startRun('exPure', town, { seed: 91 });
    const p = world.player;
    p.inventory.length = 0;
    const herb = makeItem('greatHerb', world.rng, {}, () => world.nextUid());
    addToInventory(p, herb);
    // 何かの拍子に保持枠へ入っていたとしても、帰還時に数え直して切り捨てる
    p.keptUids = [herb.uid];
    finishRun(world, town, 'death', 'テスト');
    assert.equal(town.storage.some((i) => i.defId === 'greatHerb'), false, '加護の無いダンジョンなのに 持ち帰れてしまった');
});
//# sourceMappingURL=fairness.test.js.map