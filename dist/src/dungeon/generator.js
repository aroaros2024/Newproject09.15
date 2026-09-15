/**
 * フロア生成。不思議のダンジョン式の「区画分割」方式。
 *
 *  1. マップを gridCols x gridRows の区画に切る（切れ目は少し揺らす）
 *  2. 各区画に部屋を置く。一部の区画は部屋を持たず「合流点」だけにする
 *  3. 隣り合う区画の組から全域木を作って必ず全連結にし、さらに数本の
 *     余分な通路を足してループを作る
 *  4. 区画の境界線に沿って通路を掘る（コの字 / L 字）
 *  5. 部屋の中にだけ水路・溶岩を置く（通路を塞がないので連結性が壊れない）
 *  6. 最後に連結性を検査し、壊れていたら別のシードで作り直す
 *
 * 生成は Rng だけに依存し、Math.random() は使わない（同じシード＝同じ地形）。
 */
import { Rng } from '../core/rng.js';
import { clamp, rectCenter } from '../core/geom.js';
import { at, connectivityReport, createMap, fillRect, inBounds, isOpen, setKind, } from './tilemap.js';
/** 生成の失敗が続いた時に何回まで作り直すか */
const MAX_ATTEMPTS = 12;
/** 部屋 1 つの最大サイズ。区画がこれより広くても部屋は大きくしない */
const ROOM_MAX_W = 11;
const ROOM_MAX_H = 8;
/**
 * フロアを 1 つ生成する。
 * 連結でないフロアは決して返さない（内部で作り直す）。
 */
export function generateFloor(params, seed, opts = {}) {
    let lastMap = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const rng = new Rng(seed + attempt * 7919);
        const map = opts.bigRoom
            ? buildBigRoomFloor(params, rng, opts)
            : buildPartitionedFloor(params, rng, opts);
        map.seed = seed;
        map.bigRoom = !!opts.bigRoom;
        const report = connectivityReport(map);
        if (report.connected && map.rooms.length > 0)
            return map;
        lastMap = map;
    }
    // ここに来るのは設計上の異常。最後の手段として不通部分を埋めて返す
    const map = lastMap ?? createMap(params.width, params.height);
    sealUnreachable(map);
    return map;
}
// ---------------------------------------------------------------------------
// 区画分割によるフロア
// ---------------------------------------------------------------------------
function buildPartitionedFloor(params, rng, opts) {
    const map = createMap(params.width, params.height);
    const cols = opts.maze
        ? clamp(params.gridCols[1] + 1, 2, 6)
        : rng.range(params.gridCols[0], params.gridCols[1]);
    const rows = opts.maze
        ? clamp(params.gridRows[1] + 1, 2, 5)
        : rng.range(params.gridRows[0], params.gridRows[1]);
    const xs = splitAxis(params.width, cols, rng);
    const ys = splitAxis(params.height, rows, rng);
    // --- 1. 区画を作る -------------------------------------------------------
    const cells = [];
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const bounds = {
                x: xs[cx],
                y: ys[cy],
                w: xs[cx + 1] - xs[cx],
                h: ys[cy + 1] - ys[cy],
            };
            cells.push({
                cx, cy, bounds, room: null, degree: 0,
                junction: {
                    x: rng.range(bounds.x + 1, bounds.x + bounds.w - 2),
                    y: rng.range(bounds.y + 1, bounds.y + bounds.h - 2),
                },
            });
        }
    }
    // --- 2. 部屋を置く -------------------------------------------------------
    // 全区画が合流点になってしまわないよう、最低でも 3 部屋は確保する
    const minRooms = Math.min(3, cells.length);
    const order = rng.shuffled(cells.map((_, i) => i));
    let placed = 0;
    for (let i = 0; i < order.length; i++) {
        const cell = cells[order[i]];
        // 残りの区画を全部使っても最低数に届かないなら、もう空き区画にはしない
        const remaining = order.length - i - 1;
        const mustPlace = placed + remaining < minRooms;
        if (!mustPlace && rng.percent(params.emptyCellRate))
            continue;
        const room = placeRoom(map, cell, params, rng, placed, opts);
        if (room) {
            cell.room = room;
            map.rooms.push(room);
            placed++;
        }
    }
    if (map.rooms.length === 0) {
        // 区画が小さすぎて 1 つも置けなかった場合は大部屋に切り替える
        return buildBigRoomFloor(params, rng, opts);
    }
    // --- 3. 接続する区画の組を決める -----------------------------------------
    const edges = buildSpanningEdges(cells, cols, rows, rng);
    // 部屋の無い区画の行き止まりは見栄えが悪いので刈る
    pruneDeadEnds(cells, edges);
    // --- 4. 通路を掘る -------------------------------------------------------
    // 合流点は先に掘っておく（部屋の無い区画の中継点）
    for (const cell of cells) {
        if (!cell.room && cell.degree > 0)
            setKind(map, cell.junction.x, cell.junction.y, 'floor');
    }
    for (const e of edges) {
        carveConnection(map, cells[e.a], cells[e.b], e.axis, xs, ys, rng);
    }
    // 使われなかった合流点（刈られた区画）を壁に戻す
    for (const cell of cells) {
        if (!cell.room && cell.degree === 0) {
            const t = at(map, cell.junction.x, cell.junction.y);
            if (t && !t.hard)
                t.kind = 'wall';
        }
    }
    // --- 5. 水路・溶岩 -------------------------------------------------------
    addLiquid(map, params, rng);
    // --- 6. 暗い部屋 ---------------------------------------------------------
    for (const room of map.rooms) {
        room.dark = rng.percent(params.darkRoomRate);
    }
    return map;
}
/**
 * 軸を n 分割する切れ目を返す（長さ n+1）。
 * 均等割りに揺らぎを足して、毎回同じ構図にならないようにする。
 */
function splitAxis(total, n, rng) {
    const cuts = [0];
    const base = total / n;
    for (let i = 1; i < n; i++) {
        const ideal = Math.round(base * i);
        const jitter = Math.max(0, Math.floor(base * 0.18));
        const v = ideal + (jitter > 0 ? rng.range(-jitter, jitter) : 0);
        // 直前の切れ目から最低 6 マスは空ける（部屋が入る余地を残す）
        cuts.push(clamp(v, cuts[i - 1] + 6, total - 6 * (n - i)));
    }
    cuts.push(total);
    return cuts;
}
/** 区画の中に部屋を置く。狭すぎて置けなければ null */
function placeRoom(map, cell, params, rng, id, opts) {
    const b = cell.bounds;
    // 区画の縁から 1 マス空けて、通路が走る余地を残す
    const availW = b.w - 2;
    const availH = b.h - 2;
    const minW = Math.max(3, params.minRoomW);
    const minH = Math.max(3, params.minRoomH);
    if (availW < minW || availH < minH)
        return null;
    // 部屋が区画を埋め尽くすと「4 分割された画面」に見えてしまうので上限を設ける。
    // 区画が広くても部屋はほどほどの大きさに留め、残りを通路の余地にする。
    const capW = opts.maze ? minW + 2 : Math.min(availW, ROOM_MAX_W);
    const capH = opts.maze ? minH + 2 : Math.min(availH, ROOM_MAX_H);
    const w = rng.range(minW, Math.max(minW, capW));
    const h = rng.range(minH, Math.max(minH, capH));
    const x = rng.range(b.x + 1, b.x + b.w - 1 - w);
    const y = rng.range(b.y + 1, b.y + b.h - 1 - h);
    const rect = { x, y, w, h };
    const room = {
        id, rect, doors: [], dark: false,
        shop: null, monsterHouse: null, houseTriggered: false,
    };
    fillRect(map, rect, 'floor', id);
    // 円形の部屋（角を壁に戻す）
    if (opts.round && w >= 5 && h >= 5) {
        const c = rectCenter(rect);
        const rx = w / 2;
        const ry = h / 2;
        for (let yy = rect.y; yy < rect.y + h; yy++) {
            for (let xx = rect.x; xx < rect.x + w; xx++) {
                const nx = (xx - c.x) / rx;
                const ny = (yy - c.y) / ry;
                if (nx * nx + ny * ny > 1.05) {
                    const t = at(map, xx, yy);
                    if (t && !t.hard) {
                        t.kind = 'wall';
                        t.roomId = -1;
                    }
                }
            }
        }
    }
    return room;
}
/**
 * 全域木 + 余分な辺。全区画が必ず 1 つに繋がる。
 * 辺をシャッフルして Union-Find で採用するだけの randomized Kruskal。
 */
function buildSpanningEdges(cells, cols, rows, rng) {
    const candidates = [];
    const idx = (cx, cy) => cy * cols + cx;
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            if (cx + 1 < cols)
                candidates.push({ a: idx(cx, cy), b: idx(cx + 1, cy), axis: 'h' });
            if (cy + 1 < rows)
                candidates.push({ a: idx(cx, cy), b: idx(cx, cy + 1), axis: 'v' });
        }
    }
    rng.shuffle(candidates);
    const parent = cells.map((_, i) => i);
    const find = (i) => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb)
            return false;
        parent[ra] = rb;
        return true;
    };
    const chosen = [];
    const extras = [];
    for (const e of candidates) {
        if (union(e.a, e.b))
            chosen.push(e);
        else
            extras.push(e);
    }
    // ループを作る余分な通路。多すぎると迷路感が消えるので 25% 程度
    for (const e of extras) {
        if (rng.percent(25))
            chosen.push(e);
    }
    for (const e of chosen) {
        cells[e.a].degree++;
        cells[e.b].degree++;
    }
    return chosen;
}
/**
 * 部屋の無い区画が行き止まりになっている接続を取り除く。
 * 取り除いた結果また行き止まりが生まれるので、変化が無くなるまで繰り返す。
 */
function pruneDeadEnds(cells, edges) {
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = edges.length - 1; i >= 0; i--) {
            const e = edges[i];
            for (const side of [e.a, e.b]) {
                const cell = cells[side];
                if (cell.room === null && cell.degree === 1) {
                    cells[e.a].degree--;
                    cells[e.b].degree--;
                    edges.splice(i, 1);
                    changed = true;
                    break;
                }
            }
        }
    }
}
/** 区画 A と B を通路で繋ぐ */
function carveConnection(map, a, b, axis, xs, ys, rng) {
    if (axis === 'h') {
        const from = connectorOf(map, a, 'east', rng);
        const to = connectorOf(map, b, 'west', rng);
        const boundary = xs[a.cx + 1]; // 区画 B の左端
        const midX = clamp(boundary - 1, Math.min(from.x, to.x), Math.max(from.x, to.x));
        carveH(map, from.x, midX, from.y);
        carveV(map, from.y, to.y, midX);
        carveH(map, midX, to.x, to.y);
    }
    else {
        const from = connectorOf(map, a, 'south', rng);
        const to = connectorOf(map, b, 'north', rng);
        const boundary = ys[a.cy + 1];
        const midY = clamp(boundary - 1, Math.min(from.y, to.y), Math.max(from.y, to.y));
        carveV(map, from.y, midY, from.x);
        carveH(map, from.x, to.x, midY);
        carveV(map, midY, to.y, to.x);
    }
}
/**
 * 区画の接続点を返す。
 * 部屋がある区画では部屋の壁に出入口を開け、無い区画では合流点を返す。
 */
function connectorOf(map, cell, side, rng) {
    if (!cell.room)
        return cell.junction;
    const r = cell.room.rect;
    let p;
    switch (side) {
        case 'north':
            p = { x: rng.range(r.x, r.x + r.w - 1), y: r.y - 1 };
            break;
        case 'south':
            p = { x: rng.range(r.x, r.x + r.w - 1), y: r.y + r.h };
            break;
        case 'west':
            p = { x: r.x - 1, y: rng.range(r.y, r.y + r.h - 1) };
            break;
        case 'east':
            p = { x: r.x + r.w, y: rng.range(r.y, r.y + r.h - 1) };
            break;
    }
    // 円形の部屋では出入口の真横が壁になっていることがあるので、床まで掘り進める
    const inward = side === 'north' ? { x: 0, y: 1 } :
        side === 'south' ? { x: 0, y: -1 } :
            side === 'west' ? { x: 1, y: 0 } : { x: -1, y: 0 };
    let q = { x: p.x + inward.x, y: p.y + inward.y };
    let guard = 0;
    while (inBounds(map, q.x, q.y) && !isOpen(at(map, q.x, q.y)) && guard++ < 8) {
        setKind(map, q.x, q.y, 'floor');
        const t = at(map, q.x, q.y);
        if (t)
            t.roomId = cell.room.id;
        q = { x: q.x + inward.x, y: q.y + inward.y };
    }
    const tile = at(map, p.x, p.y);
    if (tile && !tile.hard) {
        tile.kind = 'floor';
        tile.roomId = -1;
        tile.isDoor = true;
        if (!cell.room.doors.some((d) => d.x === p.x && d.y === p.y))
            cell.room.doors.push(p);
    }
    return p;
}
/** 水平に掘る（両端を含む）。部屋の中は塗り替えない */
function carveH(map, x1, x2, y) {
    const [lo, hi] = x1 <= x2 ? [x1, x2] : [x2, x1];
    for (let x = lo; x <= hi; x++)
        carveCorridorTile(map, x, y);
}
function carveV(map, y1, y2, x) {
    const [lo, hi] = y1 <= y2 ? [y1, y2] : [y2, y1];
    for (let y = lo; y <= hi; y++)
        carveCorridorTile(map, x, y);
}
function carveCorridorTile(map, x, y) {
    const t = at(map, x, y);
    if (!t || t.hard)
        return;
    if (t.kind === 'wall') {
        t.kind = 'floor';
        t.roomId = -1;
    }
    // すでに部屋の床ならそのまま（通路が部屋を貫かないよう roomId は保つ）
}
// ---------------------------------------------------------------------------
// 大部屋フロア
// ---------------------------------------------------------------------------
function buildBigRoomFloor(params, rng, opts) {
    const map = createMap(params.width, params.height);
    const margin = 2;
    const rect = {
        x: margin,
        y: margin,
        w: params.width - margin * 2,
        h: params.height - margin * 2,
    };
    const room = {
        id: 0, rect, doors: [], dark: false,
        shop: null, monsterHouse: null, houseTriggered: false,
    };
    fillRect(map, rect, 'floor', 0);
    if (opts.round) {
        const c = rectCenter(rect);
        const rx = rect.w / 2;
        const ry = rect.h / 2;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            for (let x = rect.x; x < rect.x + rect.w; x++) {
                const nx = (x - c.x) / rx;
                const ny = (y - c.y) / ry;
                if (nx * nx + ny * ny > 1.02) {
                    const t = at(map, x, y);
                    if (t && !t.hard) {
                        t.kind = 'wall';
                        t.roomId = -1;
                    }
                }
            }
        }
    }
    map.rooms.push(room);
    addLiquid(map, params, rng);
    return map;
}
// ---------------------------------------------------------------------------
// 水路・溶岩
// ---------------------------------------------------------------------------
/**
 * 部屋の内側にだけ液体の塊を置く。
 * 部屋の外周 1 マスは必ず床のまま残すので、部屋を横断できなくなることはない。
 */
function addLiquid(map, params, rng) {
    if (params.liquid === 'none' || params.waterRate <= 0)
        return;
    const kind = params.liquid;
    for (const room of map.rooms) {
        if (!rng.percent(params.waterRate))
            continue;
        const r = room.rect;
        if (r.w < 5 || r.h < 5)
            continue;
        // 内側の矩形（外周 1 マスを残す）
        const inner = { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 };
        // ランダムな塊を 1〜3 個
        const blobs = rng.range(1, 3);
        for (let i = 0; i < blobs; i++) {
            const cx = rng.range(inner.x, inner.x + inner.w - 1);
            const cy = rng.range(inner.y, inner.y + inner.h - 1);
            const rx = rng.range(1, Math.max(1, Math.floor(inner.w / 3)));
            const ry = rng.range(1, Math.max(1, Math.floor(inner.h / 3)));
            for (let y = cy - ry; y <= cy + ry; y++) {
                for (let x = cx - rx; x <= cx + rx; x++) {
                    if (x < inner.x || y < inner.y)
                        continue;
                    if (x >= inner.x + inner.w || y >= inner.y + inner.h)
                        continue;
                    // 楕円の内側だけ、しかも縁は確率で欠けさせて自然な形にする
                    const nx = (x - cx) / (rx + 0.5);
                    const ny = (y - cy) / (ry + 0.5);
                    const d = nx * nx + ny * ny;
                    if (d > 1)
                        continue;
                    if (d > 0.6 && rng.percent(40))
                        continue;
                    const t = at(map, x, y);
                    if (t && t.kind === 'floor' && t.roomId === room.id)
                        t.kind = kind;
                }
            }
        }
    }
}
// ---------------------------------------------------------------------------
// 保険
// ---------------------------------------------------------------------------
/**
 * 万一連結でないフロアができた時に、主要でない孤立領域を壁で埋める。
 * 生成が全滅した場合のみ呼ばれる。
 */
function sealUnreachable(map) {
    const report = connectivityReport(map);
    if (report.connected)
        return;
    for (const p of report.unreachable) {
        const t = at(map, p.x, p.y);
        if (t && !t.hard) {
            t.kind = 'wall';
            t.roomId = -1;
            t.isDoor = false;
        }
    }
    // 部屋がまるごと埋まったら一覧からも消す
    map.rooms = map.rooms.filter((room) => {
        for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
            for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
                if (isOpen(at(map, x, y)))
                    return true;
            }
        }
        return false;
    });
}
//# sourceMappingURL=generator.js.map