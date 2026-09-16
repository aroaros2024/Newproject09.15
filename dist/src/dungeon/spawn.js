/**
 * フロアへの配置。階段・アイテム・ワナ・モンスター・店・モンスターハウス。
 */
import { chebyshev, samePoint } from '../core/geom.js';
import { getItem, getMonster } from '../data/registry.js';
import { makeGitan, makeItem } from '../game/inventory.js';
import { gitanAmount, monsterHouseRate } from '../game/rules.js';
import { at, allRoomFloors, roomCells } from './tilemap.js';
// ---------------------------------------------------------------------------
// 抽選
// ---------------------------------------------------------------------------
/** その階で出現できるものだけに絞る */
export const availableAt = (table, depth) => table.filter((e) => depth >= e.from && depth <= e.to && e.weight > 0);
export function pickFrom(table, depth, rng) {
    const pool = availableAt(table, depth);
    if (pool.length === 0)
        return null;
    const picked = rng.weightedPick(pool, (e) => e.weight);
    return picked ? picked.id : null;
}
/** その階のモンスターを 1 種選ぶ */
export const pickMonsterId = (d, depth, rng) => pickFrom(d.monsters, depth, rng);
/** その階のアイテムを 1 種選ぶ */
export const pickItemId = (d, depth, rng) => pickFrom(d.items, depth, rng);
/** その階のワナを 1 種選ぶ */
export const pickTrapId = (d, depth, rng) => pickFrom(d.traps, depth, rng);
// ---------------------------------------------------------------------------
// 実体の生成
// ---------------------------------------------------------------------------
/** 抽選した階層相応のアイテムを 1 個作る */
export function rollFloorItem(world, depth) {
    // 10% はギタン
    if (world.rng.percent(12)) {
        return makeGitan(gitanAmount(depth, world.rng), world.rng, () => world.nextUid());
    }
    const id = pickItemId(world.dungeon, depth, world.rng);
    if (!id)
        return null;
    return makeSpecificItem(world, id, depth);
}
export function makeSpecificItem(world, defId, depth) {
    const def = getItem(defId);
    const count = def.stackable && def.kind === 'misc' ? world.rng.range(2, 6) : 1;
    return makeItem(defId, world.rng, { rolled: true, depth, count }, () => world.nextUid());
}
/** モンスターの実体を作る */
export function makeMonster(world, defId, pos, kind = 'monster') {
    const def = getMonster(defId);
    const m = {
        id: world.nextActorId(),
        kind,
        defId,
        pos: { ...pos },
        dir: world.rng.pick([0, 2, 4, 6]),
        hp: def.hp,
        maxHp: def.hp,
        level: def.level,
        atk: def.atk,
        def: def.def,
        exp: def.exp,
        statuses: [],
        alive: true,
        actedThisTurn: 0,
        regenAcc: 0,
        asleep: false,
        heldItems: [],
        heldGitan: 0,
        disguise: null,
        tactic: 'follow',
        bossPhase: 0,
        lastSeen: null,
        angry: false,
        nameOverride: null,
    };
    if (def.sleepRate !== undefined && world.rng.percent(def.sleepRate))
        m.asleep = true;
    if (def.ai === 'mimic') {
        // 化けるアイテムを用意する
        const id = pickItemId(world.dungeon, world.run.depth, world.rng);
        if (id)
            m.disguise = makeItem(id, world.rng, {}, () => world.nextUid());
    }
    return m;
}
/**
 * フロアに中身を詰める。
 * 地形生成（generator.ts）が終わったあとに 1 度だけ呼ぶ。
 */
export function populateFloor(world) {
    const { map } = world;
    const d = world.dungeon;
    const depth = world.run.depth;
    const rng = world.rng;
    // --- 階段 ---
    placeStairs(world);
    // --- 店 ---
    let shopRoom = null;
    if (map.rooms.length >= 2 && rng.percent(d.gen.shopRate)) {
        shopRoom = makeShop(world);
    }
    // --- モンスターハウス ---
    let houseKind = null;
    const houseRate = monsterHouseRate(d.monsterHouseRate, depth, d.depth);
    const houseCandidates = map.rooms.filter((r) => !r.shop && roomCells(r).length >= 20);
    if (houseCandidates.length > 0 && rng.percent(houseRate)) {
        const room = rng.pick(houseCandidates);
        houseKind = rng.weightedPick([
            { k: 'normal', w: 50 },
            { k: 'item', w: 15 },
            { k: 'trap', w: 12 },
            { k: 'ghost', w: 10 },
            { k: 'gitan', w: 8 },
            { k: 'big', w: 5 },
        ], (e) => e.w)?.k ?? 'normal';
        room.monsterHouse = houseKind;
    }
    // --- アイテム ---
    const itemCount = rng.range(d.gen.items[0], d.gen.items[1]);
    for (let i = 0; i < itemCount; i++) {
        const item = rollFloorItem(world, depth);
        if (!item)
            continue;
        const spot = randomItemSpot(world);
        if (spot)
            world.run.floorItems.push({ item, pos: spot });
    }
    // --- ワナ ---
    const trapCount = rng.range(d.gen.traps[0], d.gen.traps[1]);
    for (let i = 0; i < trapCount; i++) {
        const trapId = pickTrapId(d, depth, rng);
        if (!trapId)
            continue;
        const spot = randomTrapSpot(world);
        if (!spot)
            continue;
        const tile = at(map, spot.x, spot.y);
        if (tile)
            tile.trap = { defId: trapId, revealed: false, used: false };
    }
    // --- モンスター ---
    const monsterCount = rng.range(d.gen.monsters[0], d.gen.monsters[1]);
    for (let i = 0; i < monsterCount; i++) {
        const id = pickMonsterId(d, depth, rng);
        if (!id)
            continue;
        const spot = world.randomSpawnTile(8) ?? world.randomSpawnTile(4);
        if (!spot)
            continue;
        world.addMonster(makeMonster(world, id, spot));
    }
    // --- ボス ---
    for (const b of d.bosses) {
        if (b.depth !== depth)
            continue;
        // 2 形態のボスは 1 体目だけ置く
        if (d.bosses.filter((x) => x.depth === depth).indexOf(b) > 0)
            continue;
        const spot = bossSpot(world);
        if (spot) {
            const boss = makeMonster(world, b.monsterId, spot);
            world.addMonster(boss);
            world.emit({ t: 'bossAppear', actorId: boss.id });
        }
    }
    return { monsterHouse: houseKind, shopRoom };
}
/** プレイヤーの初期位置（階段から離れた部屋の床） */
export function placePlayer(world) {
    const floors = allRoomFloors(world.map).filter((p) => !samePoint(p, world.map.stairs)
        && !world.floorItemAt(p)
        && !at(world.map, p.x, p.y)?.shop
        && !world.actorAt(p));
    if (floors.length === 0) {
        return world.map.stairs;
    }
    // 階段から遠い場所を優先する（降りてすぐ次の階段、を避ける）
    floors.sort((a, b) => chebyshev(b, world.map.stairs) - chebyshev(a, world.map.stairs));
    const top = floors.slice(0, Math.max(1, Math.floor(floors.length / 3)));
    return world.rng.pick(top);
}
function placeStairs(world) {
    const floors = allRoomFloors(world.map);
    if (floors.length === 0)
        return;
    const p = world.rng.pick(floors);
    world.map.stairs = p;
    const tile = at(world.map, p.x, p.y);
    if (tile)
        tile.kind = 'stairs';
}
function randomItemSpot(world) {
    return world.randomOpenTile((p) => {
        const t = at(world.map, p.x, p.y);
        if (!t || t.kind !== 'floor' || t.roomId < 0)
            return false;
        if (t.shop)
            return false;
        if (world.floorItemAt(p))
            return false;
        return true;
    });
}
function randomTrapSpot(world) {
    return world.randomOpenTile((p) => {
        const t = at(world.map, p.x, p.y);
        if (!t || t.kind !== 'floor')
            return false;
        if (t.shop || t.trap)
            return false;
        if (world.floorItemAt(p))
            return false;
        // 部屋の出入口には置かない（避けられなくなるため）
        if (t.isDoor)
            return false;
        return true;
    });
}
function bossSpot(world) {
    // 一番広い部屋の中央付近
    const rooms = [...world.map.rooms].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
    for (const room of rooms) {
        const cells = roomCells(room).filter((p) => at(world.map, p.x, p.y)?.kind === 'floor' && !world.actorAt(p));
        if (cells.length > 0)
            return world.rng.pick(cells);
    }
    return world.randomSpawnTile(3);
}
// ---------------------------------------------------------------------------
// 店
// ---------------------------------------------------------------------------
function makeShop(world) {
    const candidates = world.map.rooms.filter((r) => r.doors.length === 1 && roomCells(r).length >= 12 && roomCells(r).length <= 60);
    if (candidates.length === 0)
        return null;
    const room = world.rng.pick(candidates);
    const cells = roomCells(room).filter((p) => at(world.map, p.x, p.y)?.kind === 'floor' && !samePoint(p, world.map.stairs));
    if (cells.length < 6)
        return null;
    for (const p of cells) {
        const t = at(world.map, p.x, p.y);
        if (t)
            t.shop = true;
    }
    // 店主は出入口の内側に立つ
    const door = room.doors[0];
    const inside = cells
        .slice()
        .sort((a, b) => chebyshev(a, door) - chebyshev(b, door))[0];
    const keeper = makeMonster(world, 'shopkeeper', inside, 'shopkeeper');
    world.addMonster(keeper);
    // 商品を並べる
    const goods = world.rng.range(4, Math.min(8, cells.length - 1));
    const spots = world.rng.shuffled(cells.filter((p) => !samePoint(p, inside))).slice(0, goods);
    for (const p of spots) {
        const item = rollFloorItem(world, world.run.depth);
        if (!item)
            continue;
        // 商品は呪われていない、修正値は非負、杖は満タン
        item.cursed = false;
        if (item.plus < 0)
            item.plus = 0;
        item.shopPrice = shopPriceOf(item);
        world.run.floorItems.push({ item, pos: p });
    }
    room.shop = { ownerId: keeper.id, entrance: door, angry: false };
    return room;
}
/** 店での売値（プレイヤーが買う値段） */
export function shopPriceOf(item) {
    const def = getItem(item.defId);
    let price = def.price;
    if (def.kind === 'gitan')
        return item.count;
    if (def.kind === 'weapon' || def.kind === 'shield') {
        price += item.plus * Math.floor(def.price * 0.15 + 100);
        price += item.runes.length * 300;
    }
    if (def.kind === 'staff')
        price = Math.floor(price * (0.5 + 0.125 * item.charges));
    if (def.stackable)
        price *= item.count;
    return Math.max(1, Math.floor(price));
}
// ---------------------------------------------------------------------------
// モンスターハウスと自然湧き
// ---------------------------------------------------------------------------
/** モンスターハウスを発動させる */
export function triggerMonsterHouse(world, room) {
    const kind = room.monsterHouse;
    if (!kind || room.houseTriggered)
        return;
    room.houseTriggered = true;
    const cells = roomCells(room).filter((p) => at(world.map, p.x, p.y)?.kind === 'floor'
        && !world.actorAt(p)
        && !samePoint(p, world.player.pos));
    world.rng.shuffle(cells);
    const density = kind === 'big' ? 0.55 : 0.4;
    const count = Math.max(4, Math.floor(cells.length * density));
    const depth = world.run.depth;
    if (kind === 'item' || kind === 'gitan') {
        // アイテム／ギタンで埋め尽くす。敵は少なめ
        for (const p of cells.slice(0, Math.floor(cells.length * 0.6))) {
            if (world.floorItemAt(p))
                continue;
            const item = kind === 'gitan'
                ? makeGitan(gitanAmount(depth, world.rng), world.rng, () => world.nextUid())
                : rollFloorItem(world, depth);
            if (item)
                world.run.floorItems.push({ item, pos: p });
        }
        for (const p of cells.slice(0, Math.max(3, Math.floor(count / 3)))) {
            const id = pickMonsterId(world.dungeon, depth, world.rng);
            if (id && !world.actorAt(p))
                world.addMonster(makeMonster(world, id, p));
        }
    }
    else if (kind === 'trap') {
        for (const p of cells) {
            const t = at(world.map, p.x, p.y);
            const trapId = pickTrapId(world.dungeon, depth, world.rng);
            if (t && !t.trap && trapId)
                t.trap = { defId: trapId, revealed: true, used: false };
        }
        for (const p of cells.slice(0, Math.max(3, Math.floor(count / 2)))) {
            const id = pickMonsterId(world.dungeon, depth, world.rng);
            if (id && !world.actorAt(p))
                world.addMonster(makeMonster(world, id, p));
        }
    }
    else {
        const ghostOnly = kind === 'ghost';
        for (const p of cells.slice(0, count)) {
            let id = pickMonsterId(world.dungeon, depth, world.rng);
            if (ghostOnly) {
                const ghosts = availableAt(world.dungeon.monsters, depth)
                    .filter((e) => getMonster(e.id).moveType === 'phase');
                if (ghosts.length > 0)
                    id = world.rng.pick(ghosts).id;
            }
            if (id && !world.actorAt(p))
                world.addMonster(makeMonster(world, id, p));
        }
    }
    const label = {
        normal: 'モンスターハウスだ！',
        big: '大部屋モンスターハウスだ！',
        item: 'アイテムだらけの モンスターハウスだ！',
        trap: 'ワナだらけの モンスターハウスだ！',
        ghost: 'ゴーストハウスだ！',
        gitan: 'ギタンだらけの モンスターハウスだ！',
    };
    world.log(label[kind], 'bad');
    world.emit({ t: 'monsterHouse', kind });
    world.sfx('monsterHouse');
    // モンスターハウスの敵は全員起きている
    for (const m of world.run.monsters)
        m.asleep = false;
}
/** 一定ターンごとの自然湧き */
export function naturalSpawn(world) {
    const interval = world.dungeon.gen.spawnInterval;
    if (interval <= 0)
        return;
    if (world.run.floorTurn % interval !== 0)
        return;
    if (world.run.monsters.length >= world.dungeon.gen.maxMonsters)
        return;
    const id = pickMonsterId(world.dungeon, world.run.depth, world.rng);
    if (!id)
        return;
    const spot = world.randomSpawnTile(10);
    if (!spot)
        return;
    world.addMonster(makeMonster(world, id, spot));
}
//# sourceMappingURL=spawn.js.map