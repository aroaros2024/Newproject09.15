/**
 * 冒険の開始とフロア移動。
 */
import { Rng, hashSeed } from '../core/rng.js';
import { ALIAS_POOLS, DEFAULT_PLAYER_NAME } from '../data/names.js';
import { LOANER_GEAR } from '../data/dungeons.js';
import { UNIDENTIFIED_KINDS, getDungeon, getItem, itemsOfKind } from '../data/registry.js';
import { computeFov } from '../dungeon/fov.js';
import { generateFloor } from '../dungeon/generator.js';
import { makeMonster, makeSpecificItem, naturalSpawn, pickMonsterId, placePlayer, populateFloor, } from '../dungeon/spawn.js';
import { canEnter, createMap } from '../dungeon/tilemap.js';
import { makeItem } from './inventory.js';
import { START_FOOD_X10, START_HP, START_LEVEL, START_STR, WIND_DEFAULT_TURNS, } from './rules.js';
import { World } from './world.js';
import { activeBraceletEffect } from './bracelets.js';
import { onMonsterDefeated } from './deathHooks.js';
/**
 * World に「アイテム／モンスターを作る関数」を注入する。
 *
 * combat.ts や monsterSkills.ts が spawn.ts を直接 import すると
 * 循環参照になるので、生成だけを関数として渡す形にしている。
 */
export function attachFactories(world) {
    world.itemFactory = (defId) => makeSpecificItem(world, defId, world.run.depth);
    world.braceletEffectLookup = (p) => activeBraceletEffect(world, p);
    world.onMonsterDefeated = (m) => onMonsterDefeated(world, m);
    world.spawnAt = (defId, pos) => {
        if (world.actorAt(pos))
            return null;
        return world.addMonster(makeMonster(world, defId, pos));
    };
    world.monsterFactory = (pos) => {
        const id = pickMonsterId(world.dungeon, world.run.depth, world.rng);
        if (!id)
            return null;
        if (world.actorAt(pos))
            return null;
        return world.addMonster(makeMonster(world, id, pos));
    };
}
/** 未識別アイテムの対応表をシャッフルして作る */
export function makeIdentifyState(rng) {
    const alias = {};
    const known = {};
    for (const kind of UNIDENTIFIED_KINDS) {
        const pool = rng.shuffled(ALIAS_POOLS[kind] ?? []);
        const items = itemsOfKind(kind);
        items.forEach((def, i) => {
            alias[def.id] = pool[i] ?? `なぞの${i}`;
        });
    }
    return { alias, known, nicknames: {} };
}
/** 素の（まだフロアを持たない）プレイヤーを作る */
function makePlayer(name) {
    return {
        id: 0,
        kind: 'player',
        name,
        pos: { x: 0, y: 0 },
        dir: 4,
        hp: START_HP,
        maxHp: START_HP,
        level: START_LEVEL,
        exp: 0,
        str: START_STR,
        maxStr: START_STR,
        foodX10: START_FOOD_X10,
        maxFoodX10: START_FOOD_X10,
        foodDrainAcc: 0,
        gitan: 0,
        inventory: [],
        weaponUid: null,
        shieldUid: null,
        braceletUid: null,
        braceletHpBonus: 0,
        steps: 0,
        statuses: [],
        alive: true,
        actedThisTurn: 0,
        regenAcc: 0,
    };
}
/**
 * 新しい冒険を始める。
 * 持ち込み不可のダンジョンでは、レベル 1・持ち物なしで始まる。
 */
export function startRun(dungeonId, town, opts = {}) {
    const dungeon = getDungeon(dungeonId);
    const seed = opts.seed ?? hashSeed(`${dungeonId}:${town.totalRuns}:${town.playerName}`);
    const rng = new Rng(seed);
    const player = makePlayer(town.playerName || DEFAULT_PLAYER_NAME);
    if (!dungeon.resetLevel && opts.carryOver) {
        player.level = opts.carryOver.level;
        player.exp = opts.carryOver.exp;
        player.maxHp = opts.carryOver.maxHp;
        player.hp = opts.carryOver.maxHp;
        player.maxStr = opts.carryOver.maxStr;
        player.str = opts.carryOver.maxStr;
    }
    const run = {
        dungeonId,
        depth: 1,
        floorTurn: 0,
        totalTurn: 0,
        map: createMap(dungeon.gen.width, dungeon.gen.height),
        player,
        monsters: [],
        floorItems: [],
        allies: [],
        identify: makeIdentifyState(rng),
        rng: rng.serialize(),
        seed,
        nextUid: 1,
        nextActorId: 1,
        windLeft: dungeon.windTurns > 0 ? dungeon.windTurns : WIND_DEFAULT_TURNS,
        playerActAgain: false,
        pendingWarehouse: [],
        defeatedBosses: [],
        encountered: { monsters: [], items: [] },
        stats: {
            kills: 0, maxDepth: 1, itemsFound: 0, gitanEarned: 0,
            damageTaken: 0, damageDealt: 0, startedAt: 0,
        },
    };
    const world = new World(run, dungeon);
    attachFactories(world);
    // 持ち込み
    if (dungeon.allowBring && opts.bring) {
        for (const item of opts.bring.slice(0, 20)) {
            // uid を振り直して倉庫の実体と切り離す
            const copy = {
                ...item,
                uid: world.nextUid(),
                runes: [...item.runes],
                contents: item.contents.map((c) => ({ ...c, uid: world.nextUid(), runes: [...c.runes] })),
            };
            player.inventory.push(copy);
        }
        // ギタンは村から冒険へ「移す」。ここで村側を空にしないと、
        // 帰還時の town.gitan += p.gitan で毎回倍になる
        player.gitan = town.gitan;
        town.gitan = 0;
    }
    if (dungeon.allowBring) {
        // 丸腰で出発させない。武器も盾も無ければ村が貸してくれる
        lendStartingGear(world);
    }
    else {
        // 何も持ち込めないダンジョンでも、最初の数歩が詰まないよう食料だけは配る
        const riceBall = makeItem('riceBall', world.rng, {}, () => world.nextUid());
        player.inventory.push(riceBall);
    }
    enterFloor(world, 1);
    return world;
}
/**
 * 武器・盾を持っていなければ、村の貸し出し装備を持たせて装備させる。
 *
 * 丸腰（攻撃力 8 / 防御力 0）で 1F の敵に当たると、3 発で倒れてしまう。
 * チュートリアルで理不尽に死なせないための保険。
 */
function lendStartingGear(world) {
    const p = world.player;
    const has = (kind) => p.inventory.some((i) => getItem(i.defId).kind === kind);
    const gear = LOANER_GEAR[world.dungeon.id];
    if (!gear)
        return;
    if (!has('weapon')) {
        const weapon = makeItem(gear.weapon, world.rng, { plusKnown: true }, () => world.nextUid());
        p.inventory.push(weapon);
        p.weaponUid = weapon.uid;
    }
    if (!has('shield')) {
        const shield = makeItem(gear.shield, world.rng, { plusKnown: true }, () => world.nextUid());
        p.inventory.push(shield);
        p.shieldUid = shield.uid;
    }
    // 手持ちの装備があるなら、いちばん強いものを自動で装備しておく
    if (p.weaponUid === null)
        equipBest(world, 'weapon');
    if (p.shieldUid === null)
        equipBest(world, 'shield');
    // 最初の冒険では、薬草とおにぎりも持たせる
    if (p.inventory.filter((i) => getItem(i.defId).kind !== 'weapon'
        && getItem(i.defId).kind !== 'shield').length === 0) {
        p.inventory.push(makeItem('healHerb', world.rng, {}, () => world.nextUid()));
        p.inventory.push(makeItem('riceBall', world.rng, {}, () => world.nextUid()));
    }
}
function equipBest(world, kind) {
    const p = world.player;
    let best = null;
    let bestPower = -Infinity;
    for (const item of p.inventory) {
        const def = getItem(item.defId);
        if (def.kind !== kind)
            continue;
        if (item.cursed)
            continue;
        const power = (def.kind === 'weapon' ? def.atk : def.kind === 'shield' ? def.def : 0) + item.plus;
        if (power > bestPower) {
            bestPower = power;
            best = item;
        }
    }
    if (!best)
        return;
    if (kind === 'weapon')
        p.weaponUid = best.uid;
    else
        p.shieldUid = best.uid;
}
/**
 * 指定の階へ入る。地形を作り直し、中身を配置してプレイヤーを置く。
 */
export function enterFloor(world, depth) {
    const d = world.dungeon;
    world.run.depth = depth;
    world.run.floorTurn = 0;
    world.run.stats.maxDepth = Math.max(world.run.stats.maxDepth, depth);
    world.run.monsters = [];
    world.run.floorItems = [];
    const floorSeed = world.rng.derive(`floor:${d.id}:${depth}`).next();
    const bigRoom = world.rng.percent(d.bigRoomRate);
    const round = !bigRoom && world.rng.percent(8);
    const maze = !bigRoom && !round && world.rng.percent(6);
    world.run.map = generateFloor(d.gen, floorSeed, { bigRoom, round, maze });
    // 仲間は連れて降りる
    const survivors = world.run.allies.filter((a) => a.alive);
    world.run.allies = survivors;
    // 敵を撒く前に立ち位置を決める。randomSpawnTile は
    // 「プレイヤーから何マス離れているか」で場所を選ぶので、
    // あとから置くと前の階の座標を基準にしてしまい、
    // 降りた目の前に敵が湧く
    world.run.player.pos = placePlayer(world);
    // 階の切り替えは、この階で起きることより先に知らせる。
    // floorChange は演出をリセットするので、ボスの登場や
    // モンスターハウスの通知より後に流すと、それらが消えてしまう
    world.emit({ t: 'floorChange', depth });
    world.log(`${d.name} ${depth}F`, 'system');
    world.emit({ t: 'bgm', track: depth === d.depth && d.bosses.length > 0 ? 'boss' : d.bgm });
    populateFloor(world);
    placeAllies(world, survivors);
    // 前の階に置いた聖域と、身代わりの指定は持ち越さない
    world.sanctuaries = [];
    world.decoyId = null;
    world.run.windLeft = d.windTurns > 0 ? d.windTurns : 0;
    refreshFov(world);
    // 入った瞬間のモンスターハウス（プレイヤーがその部屋にいる場合）
    checkMonsterHouseAt(world);
    showFloorGuide(world, depth);
}
/**
 * 仲間を階段のまわりに並べる。
 *
 * findDropSpot はアイテムを置ける場所しか見ないので、それで決めると
 * 仲間が全員プレイヤーと同じマスに重なる（見た目も当たり判定も壊れる）。
 * ここでは「誰もいない・入れるマス」を近い順に 1 体ずつ割り当てる。
 */
function placeAllies(world, allies) {
    const origin = world.run.player.pos;
    const taken = new Set([origin.y * world.map.width + origin.x]);
    for (const m of world.run.monsters)
        taken.add(m.pos.y * world.map.width + m.pos.x);
    for (const ally of allies) {
        const spot = nearestFreeTile(world, origin, taken, world.defOf(ally).moveType);
        ally.pos = spot ?? { ...origin };
        if (spot)
            taken.add(spot.y * world.map.width + spot.x);
    }
}
/** origin から近い順に、まだ誰も立っていない入れるマスを探す */
function nearestFreeTile(world, origin, taken, moveType) {
    for (let r = 1; r <= 6; r++) {
        const ring = [];
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r)
                    continue;
                const p = { x: origin.x + dx, y: origin.y + dy };
                if (taken.has(p.y * world.map.width + p.x))
                    continue;
                if (!canEnter(world.map, p.x, p.y, moveType))
                    continue;
                ring.push(p);
            }
        }
        if (ring.length > 0)
            return world.rng.pick(ring);
    }
    return null;
}
/**
 * 始まりの洞窟では、階ごとに操作の案内を出す。
 * 初めて遊ぶ人が「何をすればいいか分からない」まま死ぬのを防ぐ。
 */
function showFloorGuide(world, depth) {
    if (world.dungeon.id !== 'd1')
        return;
    const guides = {
        1: [
            '矢印キーか WASD で 歩ける。2 つ同時に押すと 斜めへ 進む。',
            '敵に 向かって 歩けば 攻撃になる。緑の階段を 探して 降りよう。',
        ],
        2: [
            'アイテムは 踏むだけで 拾える。E キーで メニューが 開く。',
            '拾った草や巻物は 使ってみるまで 正体が 分からない。',
        ],
        3: [
            'おなかが 減ると HP が 減り始める。食料は 大事に。',
            'Shift を 押しながら 歩くと ダッシュできる。',
        ],
        4: [
            'HP が 減ったら、敵のいない所で「.」を 押して 休むと 回復する。',
            '武器と盾は 装備しないと 効かない。E →「道具」で 確かめよう。',
        ],
        5: [
            'この階の 階段を 降りれば 踏破。持ち帰った物は 倉庫に 入る。',
            '困ったら H キーで 操作の ヘルプが 見られる。',
        ],
    };
    for (const line of guides[depth] ?? [])
        world.log(line, 'system');
}
/**
 * 次の階へ降りる。階段でも落とし穴でも、下へ行く経路はすべてここを通る。
 *
 * ボスの関門はここに置く。階段側だけで見ていると、落とし穴で
 * 最下層を抜けてボス未撃破のままクリアできてしまう。
 */
export function descend(world) {
    const d = world.dungeon;
    if (!world.bossesCleared()) {
        world.log('強い 気配に 阻まれて 先へ 進めない！', 'bad');
        return;
    }
    if (world.run.depth >= d.depth) {
        world.finished = { kind: 'clear', reason: 'クリア' };
        world.emit({ t: 'dungeonClear' });
        return;
    }
    enterFloor(world, world.run.depth + 1);
}
/** 視界を計算し直し、見えた敵を図鑑に記録する */
export function refreshFov(world) {
    const p = world.player;
    computeFov(world.map, p.pos, {
        blind: world.hasStatus(p, 'blind'),
    });
    recordVisible(world);
}
/** 見えている敵と足元のアイテムを、この冒険の「出会ったもの」に足す */
function recordVisible(world) {
    const seen = world.run.encountered;
    for (const m of world.run.monsters) {
        if (!m.alive)
            continue;
        const tile = world.map.tiles[m.pos.y * world.map.width + m.pos.x];
        if (!tile?.visible)
            continue;
        if (!seen.monsters.includes(m.defId))
            seen.monsters.push(m.defId);
    }
    for (const f of world.run.floorItems) {
        const tile = world.map.tiles[f.pos.y * world.map.width + f.pos.x];
        if (!tile?.visible)
            continue;
        if (!seen.items.includes(f.item.defId))
            seen.items.push(f.item.defId);
    }
    for (const it of world.player.inventory) {
        if (!seen.items.includes(it.defId))
            seen.items.push(it.defId);
    }
}
/** プレイヤーのいる部屋がモンスターハウスなら発動させる */
export function checkMonsterHouseAt(world) {
    const tile = world.map.tiles[world.player.pos.y * world.map.width + world.player.pos.x];
    if (!tile || tile.roomId < 0)
        return;
    const room = world.map.rooms.find((r) => r.id === tile.roomId);
    if (!room || !room.monsterHouse || room.houseTriggered)
        return;
    // 発動は turn 側で行う（spawn を import すると循環するため関数を渡す）
    world.pendingMonsterHouse = room;
}
export { naturalSpawn };
//# sourceMappingURL=run.js.map