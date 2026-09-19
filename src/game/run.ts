/**
 * 冒険の開始とフロア移動。
 */

import { Rng, hashSeed } from '../core/rng.js';
import type {
  IdentifyState, ItemInstance, MonsterActor, MoveType, Point,
  PlayerActor, RunState, TownState,
} from '../core/types.js';
import { ALIAS_POOLS, DEFAULT_PLAYER_NAME } from '../data/names.js';
import { LOANER_GEAR } from '../data/dungeons.js';
import { UNIDENTIFIED_KINDS, getDungeon, getItem, itemsOfKind } from '../data/registry.js';
import { computeFov } from '../dungeon/fov.js';
import { generateFloor } from '../dungeon/generator.js';
import {
  makeMonster, makeSpecificItem, naturalSpawn, pickMonsterId,
  placePlayer, placeStairs, populateFloor,
} from '../dungeon/spawn.js';
import { canEnter, createMap } from '../dungeon/tilemap.js';
import { SHORTCUT_SLOTS, addKept, makeItem } from './inventory.js';
import {
  START_FOOD_X10, START_HP, START_LEVEL, START_STR, WIND_DEFAULT_TURNS,
} from './rules.js';
import { World } from './world.js';
import { activeBraceletEffect } from './bracelets.js';
import { onMonsterDefeated } from './deathHooks.js';
import { activeBoosts } from './gacha.js';
import { spawnPartner } from './partner.js';

/**
 * World に「アイテム／モンスターを作る関数」を注入する。
 *
 * combat.ts や monsterSkills.ts が spawn.ts を直接 import すると
 * 循環参照になるので、生成だけを関数として渡す形にしている。
 */
export function attachFactories(world: World): void {
  world.itemFactory = (defId) => makeSpecificItem(world, defId, world.run.depth);
  world.braceletEffectLookup = (p) => activeBraceletEffect(world, p);
  world.onMonsterDefeated = (m) => onMonsterDefeated(world, m);
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
    foodDrainAcc: 0,
    gitan: 0,
    inventory: [],
    weaponUid: null,
    shieldUid: null,
    braceletUid: null,
    shortcutIds: new Array(SHORTCUT_SLOTS).fill(null),
    keptUids: [],
    braceletHpBonus: 0,
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
  // ショートカットは村に置いてある。defId で覚えているので冒険をまたいでも意味が通る
  if (town.shortcuts) {
    for (let i = 0; i < SHORTCUT_SLOTS; i++) player.shortcutIds[i] = town.shortcuts[i] ?? null;
  }
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
    // 仮名は毎回シャッフルし直す（知らない物の正体当ては毎回まっさら）。
    // 村が名前を知っている品目と、自分でつけた名前だけを引き継ぐ
    identify: {
      ...makeIdentifyState(rng),
      known: { ...(town.knownItems ?? {}) },
      nicknames: { ...(town.nicknames ?? {}) },
    },
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
      damageTaken: 0, damageDealt: 0,
    },
  };

  const world = new World(run, dungeon);
  attachFactories(world);

  // 加護。効かないダンジョン（真・もっと不思議）では全部 0 になる。
  // 持ち込みより先に読む。袋の大きさも保持枠もここから決まるので、
  // あとで読むと「26 個選べたのに 20 個しか届かない」が起きる
  const boosts = activeBoosts(town, dungeon.allowBoosts);

  // 持ち込み
  if (dungeon.allowBring && opts.bring) {
    const kept = town.kept ?? [];
    for (const item of opts.bring.slice(0, boosts.bagLimit)) {
      // uid を振り直して倉庫の実体と切り離す
      const copy: ItemInstance = {
        ...item,
        uid: world.nextUid(),
        runes: [...item.runes],
        contents: item.contents.map((c) => ({ ...c, uid: world.nextUid(), runes: [...c.runes] })),
      };
      player.inventory.push(copy);
      // 村で保持していた物は、外さずに持ってきたのでそのまま保持し直す。
      // 枠が減っていれば addKept が入りきらないぶんを断る
      if (kept.includes(item.uid)) addKept(player, copy.uid, boosts.keepSlots);
      // 倉庫から「持ち出した」のではなく「実際に持ち込んだ」数を数える。
      // 倉庫のメニューで出し入れするだけでは増えない
      world.tally('bring');
    }
    // ギタンは村から冒険へ「移す」。ここで村側を空にしないと、
    // 帰還時の town.gitan += p.gitan で毎回倍になる
    player.gitan = town.gitan;
    town.gitan = 0;
  }
  // 印は一度きり。持っていかなかった物の保持はここで切れる。
  // 帰還時に finishRun が付け直す
  town.kept = [];

  if (dungeon.allowBring) {
    // 丸腰で出発させない。武器も盾も無ければ村が貸してくれる
    lendStartingGear(world);
  } else {
    // 何も持ち込めないダンジョンでも、最初の数歩が詰まないよう食料だけは配る
    const riceBall = makeItem('riceBall', world.rng, {}, () => world.nextUid());
    player.inventory.push(riceBall);
  }

  for (const id of boosts.knownIds) run.identify.known[id] = true;
  // 護石。印を読む weaponRune / shieldRune がここを見る
  world.charm = boosts.charm;
  player.bagLimit = boosts.bagLimit;
  if (boosts.food > 0) {
    player.maxFoodX10 += boosts.food * 10;
    player.foodX10 = player.maxFoodX10;
  }
  if (dungeon.allowBring && boosts.gitan > 0) player.gitan += boosts.gitan;

  enterFloor(world, 1);

  // 相棒は地形ができてから置く
  if (boosts.partner) spawnPartner(world, boosts.partner);

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
  if (depth > world.run.depth) world.tally('descend');
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

  // 仲間は連れて降りる。落とし穴で先に落ちた者もここで合流する
  const survivors = world.run.allies.filter((a) => a.alive);
  for (const a of world.pendingRejoin) {
    if (a.alive) survivors.push(a);
  }
  world.pendingRejoin = [];
  world.run.allies = survivors;

  // 敵を撒く前に立ち位置を決める。randomSpawnTile は
  // 「プレイヤーから何マス離れているか」で場所を選ぶので、
  // あとから置くと前の階の座標を基準にしてしまい、
  // 降りた目の前に敵が湧く
  // 階段を先に置く。あとから置くと placePlayer の「階段から遠い場所を優先」が
  // 未設定の (-1,-1) を基準にしてしまい、狙いどおりに働かない
  placeStairs(world);
  world.run.player.pos = placePlayer(world);

  // 階の切り替えは、この階で起きることより先に知らせる。
  // floorChange は演出をリセットするので、ボスの登場や
  // モンスターハウスの通知より後に流すと、それらが消えてしまう
  world.emit({ t: 'floorChange', depth });
  world.log(`${d.name} ${depth}F`, 'system');
  world.emit({ t: 'bgm', track: depth === d.depth && d.bosses.length > 0 ? 'boss' : d.bgm });

  populateFloor(world);
  placeAllies(world, survivors);
  // フロア生成で置いた顔ぶれは「湧いたばかり」ではない。
  // ここを通さないと、階を降りるたびに全員が 1 ターン棒立ちになる。
  // 降りた先がモンスターハウスだった場合の敵は、この後の
  // resolvePendingEffects で湧くので、ちゃんと印が残る
  for (const a of world.run.monsters) a.actedThisTurn = 0;
  for (const a of world.run.allies) a.actedThisTurn = 0;

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
function placeAllies(world: World, allies: MonsterActor[]): void {
  const origin = world.run.player.pos;
  const taken = new Set<number>([origin.y * world.map.width + origin.x]);
  for (const m of world.run.monsters) taken.add(m.pos.y * world.map.width + m.pos.x);

  for (const ally of allies) {
    const spot = nearestFreeTile(world, origin, taken, world.defOf(ally).moveType);
    ally.pos = spot ?? { ...origin };
    if (spot) taken.add(spot.y * world.map.width + spot.x);
  }
}

/** origin から近い順に、まだ誰も立っていない入れるマスを探す */
function nearestFreeTile(
  world: World, origin: Point, taken: Set<number>, moveType: MoveType,
): Point | null {
  for (let r = 1; r <= 6; r++) {
    const ring: Point[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = { x: origin.x + dx, y: origin.y + dy };
        if (taken.has(p.y * world.map.width + p.x)) continue;
        if (!canEnter(world.map, p.x, p.y, moveType)) continue;
        ring.push(p);
      }
    }
    if (ring.length > 0) return world.rng.pick(ring);
  }
  return null;
}

/**
 * 始まりの洞窟では、階ごとに操作の案内を出す。
 * 初めて遊ぶ人が「何をすればいいか分からない」まま死ぬのを防ぐ。
 */
function showFloorGuide(world: World, depth: number): void {
  if (world.dungeon.id !== 'd1') return;
  const guides: Record<number, string[]> = {
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
      'R を 押しながら 方向で、ターンを 使わずに 向きだけ 変えられる。',
    ],
    4: [
      'HP が 減ったら、敵のいない所で「特殊 →休む」。敵がいると 休めない。',
      'よく使う道具は「道具 →ショートカットに入れる」で 1〜3 に 置ける。',
    ],
    5: [
      'この階の 階段を 降りれば 踏破。持ち帰った物は 倉庫に 入る。',
      '囲まれたら 通路へ 引くと 1 体ずつ 相手にできる。H キーでヘルプ。',
    ],
  };
  for (const line of guides[depth] ?? []) world.log(line, 'system');
}

/**
 * 次の階へ降りる。階段でも落とし穴でも、下へ行く経路はすべてここを通る。
 *
 * ボスの関門はここに置く。階段側だけで見ていると、落とし穴で
 * 最下層を抜けてボス未撃破のままクリアできてしまう。
 */
export function descend(world: World): void {
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
export function refreshFov(world: World): void {
  const p = world.player;
  computeFov(world.map, p.pos, {
    blind: world.hasStatus(p, 'blind'),
  });
  recordVisible(world);
}

/** 見えている敵と足元のアイテムを、この冒険の「出会ったもの」に足す */
function recordVisible(world: World): void {
  const seen = world.run.encountered;
  for (const m of world.run.monsters) {
    if (!m.alive) continue;
    const tile = world.map.tiles[m.pos.y * world.map.width + m.pos.x];
    if (!tile?.visible) continue;
    if (!seen.monsters.includes(m.defId)) seen.monsters.push(m.defId);
  }
  for (const f of world.run.floorItems) {
    const tile = world.map.tiles[f.pos.y * world.map.width + f.pos.x];
    if (!tile?.visible) continue;
    if (!seen.items.includes(f.item.defId)) seen.items.push(f.item.defId);
  }
  for (const it of world.player.inventory) {
    if (!seen.items.includes(it.defId)) seen.items.push(it.defId);
  }
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
