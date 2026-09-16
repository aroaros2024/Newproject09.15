/**
 * 冒険の開始とフロア移動。
 */

import { Rng, hashSeed } from '../core/rng.js';
import type {
  IdentifyState, ItemInstance, PlayerActor, RunState, TownState,
} from '../core/types.js';
import { ALIAS_POOLS, DEFAULT_PLAYER_NAME } from '../data/names.js';
import { LOANER_GEAR } from '../data/dungeons.js';
import { UNIDENTIFIED_KINDS, getDungeon, getItem, itemsOfKind } from '../data/registry.js';
import { computeFov } from '../dungeon/fov.js';
import { generateFloor } from '../dungeon/generator.js';
import {
  makeMonster, makeSpecificItem, naturalSpawn, pickMonsterId, placePlayer, populateFloor,
} from '../dungeon/spawn.js';
import { createMap } from '../dungeon/tilemap.js';
import { makeItem } from './inventory.js';
import {
  START_FOOD_X10, START_HP, START_LEVEL, START_STR, WIND_DEFAULT_TURNS,
} from './rules.js';
import { World } from './world.js';
import { activeBraceletEffect } from './bracelets.js';

/**
 * World に「アイテム／モンスターを作る関数」を注入する。
 *
 * combat.ts や monsterSkills.ts が spawn.ts を直接 import すると
 * 循環参照になるので、生成だけを関数として渡す形にしている。
 */
export function attachFactories(world: World): void {
  world.itemFactory = (defId) => makeSpecificItem(world, defId, world.run.depth);
  world.braceletEffectLookup = (p) => activeBraceletEffect(world, p);
  world.spawnAt = (defId, pos) => {
    if (world.actorAt(pos)) return null;
    return world.addMonster(makeMonster(world, defId, pos));
  };
  world.monsterFactory = (pos) => {
    const id = pickMonsterId(world.dungeon, world.run.depth, world.rng);
    if (!id) return null;
    if (world.actorAt(pos)) return null;
    return world.addMonster(makeMonster(world, id, pos));
  };
}

/** 未識別アイテムの対応表をシャッフルして作る */
export function makeIdentifyState(rng: Rng): IdentifyState {
  const alias: Record<string, string> = {};
  const known: Record<string, boolean> = {};
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
function makePlayer(name: string): PlayerActor {
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
    gitan: 0,
    inventory: [],
    weaponUid: null,
    shieldUid: null,
    braceletUid: null,
    steps: 0,
    statuses: [],
    alive: true,
    actedThisTurn: 0,
    regenAcc: 0,
  };
}

export interface StartRunOptions {
  /** 持ち込むアイテム（倉庫から選んだもの）。持ち込み不可なら無視される */
  bring?: ItemInstance[];
  /** 再現用のシード。省略時は時刻から作る */
  seed?: number;
  /** レベルと装備を引き継ぐ（持ち込み可ダンジョン用）。町のセーブから */
  carryOver?: { level: number; exp: number; maxHp: number; maxStr: number } | null;
}

/**
 * 新しい冒険を始める。
 * 持ち込み不可のダンジョンでは、レベル 1・持ち物なしで始まる。
 */
export function startRun(
  dungeonId: string, town: TownState, opts: StartRunOptions = {},
): World {
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

  const run: RunState = {
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
    defeatedBosses: [],
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
      const copy: ItemInstance = {
        ...item,
        uid: world.nextUid(),
        runes: [...item.runes],
        contents: item.contents.map((c) => ({ ...c, uid: world.nextUid(), runes: [...c.runes] })),
      };
      player.inventory.push(copy);
    }
    player.gitan = town.gitan;
  }

  if (dungeon.allowBring) {
    // 丸腰で出発させない。武器も盾も無ければ村が貸してくれる
    lendStartingGear(world);
  } else {
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
function lendStartingGear(world: World): void {
  const p = world.player;
  const has = (kind: 'weapon' | 'shield'): boolean =>
    p.inventory.some((i) => getItem(i.defId).kind === kind);

  const gear = LOANER_GEAR[world.dungeon.id];
  if (!gear) return;

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
  if (p.weaponUid === null) equipBest(world, 'weapon');
  if (p.shieldUid === null) equipBest(world, 'shield');

  // 最初の冒険では、薬草とおにぎりも持たせる
  if (p.inventory.filter((i) => getItem(i.defId).kind !== 'weapon'
    && getItem(i.defId).kind !== 'shield').length === 0) {
    p.inventory.push(makeItem('healHerb', world.rng, {}, () => world.nextUid()));
    p.inventory.push(makeItem('riceBall', world.rng, {}, () => world.nextUid()));
  }
}

function equipBest(world: World, kind: 'weapon' | 'shield'): void {
  const p = world.player;
  let best: ItemInstance | null = null;
  let bestPower = -Infinity;
  for (const item of p.inventory) {
    const def = getItem(item.defId);
    if (def.kind !== kind) continue;
    if (item.cursed) continue;
    const power = (def.kind === 'weapon' ? def.atk : def.kind === 'shield' ? def.def : 0) + item.plus;
    if (power > bestPower) {
      bestPower = power;
      best = item;
    }
  }
  if (!best) return;
  if (kind === 'weapon') p.weaponUid = best.uid;
  else p.shieldUid = best.uid;
}

/**
 * 指定の階へ入る。地形を作り直し、中身を配置してプレイヤーを置く。
 */
export function enterFloor(world: World, depth: number): void {
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
  populateFloor(world);

  // 仲間は連れて降りる
  const survivors = world.run.allies.filter((a) => a.alive);
  world.run.allies = survivors;

  world.run.player.pos = placePlayer(world);
  for (const ally of survivors) {
    const spot = world.findDropSpot(world.run.player.pos, 3);
    ally.pos = spot ?? world.run.player.pos;
  }

  // 前の階に置いた聖域と、身代わりの指定は持ち越さない
  world.sanctuaries = [];
  world.decoyId = null;

  world.run.windLeft = d.windTurns > 0 ? d.windTurns : 0;
  refreshFov(world);

  world.emit({ t: 'floorChange', depth });
  world.log(`${d.name} ${depth}F`, 'system');
  world.emit({ t: 'bgm', track: depth === d.depth && d.bosses.length > 0 ? 'boss' : d.bgm });

  // 入った瞬間のモンスターハウス（プレイヤーがその部屋にいる場合）
  checkMonsterHouseAt(world);
}

/** 階段を降りる */
export function descend(world: World): void {
  const d = world.dungeon;
  if (world.run.depth >= d.depth) {
    world.finished = { kind: 'clear', reason: 'クリア' };
    world.emit({ t: 'dungeonClear' });
    return;
  }
  enterFloor(world, world.run.depth + 1);
}

/** 視界を計算し直す */
export function refreshFov(world: World): void {
  const p = world.player;
  computeFov(world.map, p.pos, {
    blind: world.hasStatus(p, 'blind'),
  });
}

/** プレイヤーのいる部屋がモンスターハウスなら発動させる */
export function checkMonsterHouseAt(world: World): void {
  const tile = world.map.tiles[world.player.pos.y * world.map.width + world.player.pos.x];
  if (!tile || tile.roomId < 0) return;
  const room = world.map.rooms.find((r) => r.id === tile.roomId);
  if (!room || !room.monsterHouse || room.houseTriggered) return;
  // 発動は turn 側で行う（spawn を import すると循環するため関数を渡す）
  world.pendingMonsterHouse = room;
}

export { naturalSpawn };
