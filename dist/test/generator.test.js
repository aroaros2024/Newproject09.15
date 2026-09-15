import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor } from '../src/dungeon/generator.js';
import { at, connectivityReport, isOpen, allRoomFloors, walkDistance, renderAscii, } from '../src/dungeon/tilemap.js';
const BASE = {
    width: 48, height: 32,
    gridCols: [2, 4], gridRows: [2, 3],
    emptyCellRate: 25,
    minRoomW: 4, minRoomH: 4,
    darkRoomRate: 0,
    waterRate: 0, liquid: 'none',
    items: [3, 5], traps: [2, 4], monsters: [4, 6],
    spawnInterval: 20, maxMonsters: 16, shopRate: 0,
};
const SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i * 37);
test('300 シードすべてで全マスが連結している', () => {
    const broken = [];
    for (const seed of SEEDS) {
        const map = generateFloor(BASE, seed);
        if (!connectivityReport(map).connected)
            broken.push(seed);
    }
    assert.deepEqual(broken, [], `不通のフロアが生成された: ${broken.join(', ')}`);
});
test('必ず 1 つ以上の部屋ができ、部屋の床が十分ある', () => {
    for (const seed of SEEDS) {
        const map = generateFloor(BASE, seed);
        assert.ok(map.rooms.length >= 1, `seed ${seed}: 部屋が無い`);
        const floors = allRoomFloors(map);
        assert.ok(floors.length >= 12, `seed ${seed}: 部屋の床が少なすぎる (${floors.length})`);
    }
});
test('外周は必ず掘れない壁のまま', () => {
    for (const seed of SEEDS.slice(0, 60)) {
        const map = generateFloor(BASE, seed);
        for (let x = 0; x < map.width; x++) {
            assert.equal(at(map, x, 0).kind, 'wall');
            assert.equal(at(map, x, map.height - 1).kind, 'wall');
        }
        for (let y = 0; y < map.height; y++) {
            assert.equal(at(map, 0, y).kind, 'wall');
            assert.equal(at(map, map.width - 1, y).kind, 'wall');
        }
    }
});
test('部屋どうしが互いに歩いて行き来できる', () => {
    for (const seed of SEEDS.slice(0, 80)) {
        const map = generateFloor(BASE, seed);
        if (map.rooms.length < 2)
            continue;
        const centers = map.rooms.map((r) => {
            // 部屋の中で確実に床のマスを選ぶ（円形部屋対策）
            for (let y = r.rect.y; y < r.rect.y + r.rect.h; y++) {
                for (let x = r.rect.x; x < r.rect.x + r.rect.w; x++) {
                    if (at(map, x, y)?.kind === 'floor')
                        return { x, y };
                }
            }
            return null;
        }).filter((p) => p !== null);
        for (let i = 1; i < centers.length; i++) {
            const d = walkDistance(map, centers[0], centers[i]);
            assert.ok(d >= 0, `seed ${seed}: 部屋 0 と ${i} が行き来できない\n${renderAscii(map)}`);
        }
    }
});
test('すべての部屋に出入口がある', () => {
    for (const seed of SEEDS.slice(0, 80)) {
        const map = generateFloor(BASE, seed);
        for (const room of map.rooms) {
            assert.ok(room.doors.length >= 1, `seed ${seed}: 部屋 ${room.id} に出入口が無い\n${renderAscii(map)}`);
        }
    }
});
test('同じシードからは完全に同じフロアができる', () => {
    for (const seed of [42, 777, 123456]) {
        const a = renderAscii(generateFloor(BASE, seed));
        const b = renderAscii(generateFloor(BASE, seed));
        assert.equal(a, b);
    }
});
test('違うシードでは違うフロアになる', () => {
    const shapes = new Set(SEEDS.slice(0, 50).map((s) => renderAscii(generateFloor(BASE, s))));
    assert.ok(shapes.size >= 48, `地形の重複が多すぎる: ${shapes.size}/50`);
});
test('水路を入れても連結が壊れない', () => {
    const params = { ...BASE, waterRate: 70, liquid: 'water' };
    let withWater = 0;
    for (const seed of SEEDS.slice(0, 120)) {
        const map = generateFloor(params, seed);
        assert.ok(connectivityReport(map).connected, `seed ${seed}: 水路で不通になった`);
        if (map.tiles.some((t) => t.kind === 'water'))
            withWater++;
        // 水に囲まれて渡れない床が無いこと（部屋の外周は床のまま残る仕様）
        for (const room of map.rooms) {
            const r = room.rect;
            let dryEdge = 0;
            for (let x = r.x; x < r.x + r.w; x++) {
                if (at(map, x, r.y)?.kind === 'floor')
                    dryEdge++;
                if (at(map, x, r.y + r.h - 1)?.kind === 'floor')
                    dryEdge++;
            }
            assert.ok(dryEdge > 0 || r.w < 5, `seed ${seed}: 部屋 ${room.id} の縁が全部水`);
        }
    }
    assert.ok(withWater > 60, `水路がほとんど出ていない: ${withWater}/120`);
});
test('溶岩でも連結が壊れない', () => {
    const params = { ...BASE, waterRate: 80, liquid: 'lava' };
    for (const seed of SEEDS.slice(0, 60)) {
        const map = generateFloor(params, seed);
        assert.ok(connectivityReport(map).connected, `seed ${seed}: 溶岩で不通になった`);
    }
});
test('大部屋フロアは 1 部屋だけで連結している', () => {
    for (const seed of SEEDS.slice(0, 40)) {
        const map = generateFloor(BASE, seed, { bigRoom: true });
        assert.equal(map.rooms.length, 1);
        assert.equal(map.bigRoom, true);
        assert.ok(connectivityReport(map).connected);
        assert.ok(allRoomFloors(map).length > 400, '大部屋が小さすぎる');
    }
});
test('円形の部屋でも連結が壊れない', () => {
    for (const seed of SEEDS.slice(0, 80)) {
        const map = generateFloor(BASE, seed, { round: true });
        assert.ok(connectivityReport(map).connected, `seed ${seed}: 円形部屋で不通になった`);
        for (const room of map.rooms) {
            assert.ok(room.doors.length >= 1, `seed ${seed}: 円形部屋 ${room.id} に出入口が無い`);
        }
    }
});
test('迷路フロアでも連結が壊れない', () => {
    for (const seed of SEEDS.slice(0, 80)) {
        const map = generateFloor(BASE, seed, { maze: true });
        assert.ok(connectivityReport(map).connected, `seed ${seed}: 迷路で不通になった`);
    }
});
test('狭いマップでも落ちずに生成できる', () => {
    const small = {
        ...BASE, width: 20, height: 14, gridCols: [2, 2], gridRows: [2, 2],
        minRoomW: 3, minRoomH: 3,
    };
    for (const seed of SEEDS.slice(0, 60)) {
        const map = generateFloor(small, seed);
        assert.ok(map.rooms.length >= 1, `seed ${seed}: 狭いマップで部屋ができない`);
        assert.ok(connectivityReport(map).connected);
    }
});
test('極端に部屋を減らしても最低 3 部屋は残る', () => {
    const sparse = { ...BASE, emptyCellRate: 100, gridCols: [4, 4], gridRows: [3, 3] };
    for (const seed of SEEDS.slice(0, 40)) {
        const map = generateFloor(sparse, seed);
        assert.ok(map.rooms.length >= 3, `seed ${seed}: 部屋が ${map.rooms.length} 個しかない`);
        assert.ok(connectivityReport(map).connected);
    }
});
test('通路が部屋を貫通していない（部屋の床の roomId が保たれる）', () => {
    for (const seed of SEEDS.slice(0, 60)) {
        const map = generateFloor(BASE, seed);
        for (const room of map.rooms) {
            for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
                for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
                    const t = at(map, x, y);
                    if (!isOpen(t))
                        continue;
                    assert.equal(t.roomId, room.id, `seed ${seed}: 部屋 ${room.id} の内側 (${x},${y}) が通路になっている`);
                }
            }
        }
    }
});
test('行き止まりの通路が過剰に出ない', () => {
    let totalDeadEnds = 0;
    const n = 60;
    for (const seed of SEEDS.slice(0, n)) {
        const map = generateFloor(BASE, seed);
        for (let y = 1; y < map.height - 1; y++) {
            for (let x = 1; x < map.width - 1; x++) {
                const t = at(map, x, y);
                if (!isOpen(t) || t.roomId >= 0 || t.isDoor)
                    continue;
                const open4 = [[0, -1], [1, 0], [0, 1], [-1, 0]]
                    .filter(([dx, dy]) => isOpen(at(map, x + dx, y + dy))).length;
                if (open4 <= 1)
                    totalDeadEnds++;
            }
        }
    }
    const perFloor = totalDeadEnds / n;
    assert.ok(perFloor < 3, `1 フロアあたりの行き止まりが多すぎる: ${perFloor.toFixed(1)}`);
});
//# sourceMappingURL=generator.test.js.map