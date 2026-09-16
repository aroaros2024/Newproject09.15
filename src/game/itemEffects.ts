/**
 * アイテムの効果。EffectId → ハンドラの表。
 *
 * ハンドラは EffectContext を受け取り、「効果が起きたか」を返す。
 * false を返すと「何も起こらなかった」と表示され、識別もされない。
 */

import { type Dir, type Point, chebyshev, dirTo, rayPoints, step } from '../core/geom.js';
import type { Actor, ItemInstance, MonsterActor, PlayerActor } from '../core/types.js';
import { getItem, itemsOfKind, tryGetItem } from '../data/registry.js';
import { revealWholeFloor } from '../dungeon/fov.js';
import {
  at, canEnter, canMoveDiagonally, neighbors8, roomOf, roomCells,
} from '../dungeon/tilemap.js';
import { dealDamage, gainStr, healActor, levelDown, levelUp, loseStr } from './combat.js';
import { eat, loseFood } from './hunger.js';
import {
  addToInventory, allCarriedItems, equippedShield, equippedWeapon,
  findItem, isEquipped, isInventoryFull, losableItems, makeItem, removeFromInventory,
} from './inventory.js';
import { devolveMonster, evolveMonster } from './monsterSkills.js';
import { itemName } from './naming.js';
import { addRune, runeList } from './runes.js';
import { PLUS_MAX, PLUS_MIN } from './rules.js';
import { applyStatus, cureAilments, removeStatus } from './status.js';
import type { World } from './world.js';

export interface EffectContext {
  world: World;
  /** 使った道具（投げた場合も同じ） */
  item: ItemInstance;
  /** 使った人 */
  user: Actor;
  /** 対象に選んだ道具（識別の巻物など） */
  target?: ItemInstance | null;
  /** 向き（杖・炎など） */
  dir?: Dir;
  /** 投げて当たった相手 */
  victim?: Actor | null;
  /** 投げて使ったか */
  thrown?: boolean;
}

export type EffectHandler = (ctx: EffectContext) => boolean;

const P = (ctx: EffectContext): PlayerActor => ctx.world.player;

/**
 * 斜めに進めるよう、角のどちらかを開ける。
 * 開けられた（もともと通れた場合も含む）なら true。
 */
function openDiagonalCorner(world: World, from: Point, to: Point): boolean {
  if (canMoveDiagonally(world.map, from, to.x - from.x, to.y - from.y, 'ground')) return true;
  for (const c of [{ x: to.x, y: from.y }, { x: from.x, y: to.y }]) {
    const t = at(world.map, c.x, c.y);
    if (!t || t.hard || t.kind !== 'wall') continue;
    t.kind = 'floor';
    t.roomId = -1;
    return true;
  }
  return false;
}

/** 部屋の中の敵を集める。通路なら周囲 2 マス */
function enemiesInRoom(world: World, from: Point): MonsterActor[] {
  const room = roomOf(world.map, from);
  if (room) {
    return world.run.monsters.filter(
      (m) => m.alive && roomCells(room).some((c) => c.x === m.pos.x && c.y === m.pos.y),
    );
  }
  return world.run.monsters.filter((m) => m.alive && chebyshev(m.pos, from) <= 2);
}

/** 杖の弾道に沿って最初に当たる相手を探す */
export function staffTarget(world: World, from: Point, dir: Dir, range = 10): Actor | null {
  let cur = { ...from };
  for (let i = 0; i < range; i++) {
    const next = step(cur, dir);
    if (!at(world.map, next.x, next.y) || at(world.map, next.x, next.y)!.kind === 'wall') return null;
    cur = next;
    const a = world.actorAt(cur);
    if (a && a.alive) return a;
  }
  return null;
}

/** 状態異常を与えるだけの効果 */
const inflictSelf = (id: Parameters<typeof applyStatus>[2], msg: string, good: boolean): EffectHandler =>
  ({ world, user, victim }) => {
    const t = victim ?? user;
    applyStatus(world, t, id);
    world.log(msg.replace('{name}', world.nameOf(t)), good ? 'good' : 'bad');
    return true;
  };

export const ITEM_EFFECTS: Record<string, EffectHandler> = {
  // ======================================================== 草
  heal25: ({ world, user }) => {
    if (user.hp >= user.maxHp && user.kind === 'player') {
      user.maxHp = Math.min(999, user.maxHp + 1);
      world.log('最大 HP が 1 増えた！', 'good');
    }
    healActor(world, user, 25);
    world.log(`${world.nameOf(user)}の HP が 回復した。`, 'good');
    world.sfx('heal');
    return true;
  },

  heal100: ({ world, user }) => {
    if (user.hp >= user.maxHp && user.kind === 'player') {
      user.maxHp = Math.min(999, user.maxHp + 3);
      world.log('最大 HP が 3 増えた！', 'good');
    }
    healActor(world, user, 100);
    world.log(`${world.nameOf(user)}の HP が 大きく 回復した。`, 'good');
    world.sfx('heal');
    return true;
  },

  lifeUp: ({ world, user }) => {
    user.maxHp = Math.min(999, user.maxHp + 5);
    user.hp = user.maxHp;
    world.log('最大 HP が 5 増え、HP が 全快した！', 'good');
    world.sfx('levelUp');
    return true;
  },

  strUp: ({ world, user }) => {
    if (user.kind !== 'player') return false;
    gainStr(world, user, 1);
    return true;
  },

  curePoison: ({ world, user }) => {
    const had = removeStatus(world, user, 'poisoned')
      || removeStatus(world, user, 'deadlyPoisoned');
    if (user.kind === 'player' && user.str < user.maxStr) {
      user.str = user.maxStr;
      world.log('ちからが 元に 戻った。', 'good');
      return true;
    }
    if (had) world.log('毒が 消えた。', 'good');
    return had;
  },

  cureBlind: ({ world, user }) => {
    removeStatus(world, user, 'blind');
    for (const t of world.map.tiles) if (t.trap) t.trap.revealed = true;
    world.log('目の前が 晴れ、ワナが 見えるようになった。', 'good');
    return true;
  },

  cureConfuse: ({ world, user }) => {
    const a = removeStatus(world, user, 'confused');
    const b = removeStatus(world, user, 'asleep');
    if (a || b) world.log('頭が すっきりした。', 'good');
    return a || b;
  },

  cureAll: ({ world, user }) => {
    const n = cureAilments(world, user);
    if (n > 0) world.log('体の 異常が すべて 治った。', 'good');
    return n > 0;
  },

  revive: ({ world }) => {
    world.log('体が ほのかに 温かくなった。', 'good');
    return true; // 実際の効果は death.ts が持ち物を見て判定する
  },

  sleep: inflictSelf('asleep', '{name}は 眠ってしまった！', false),
  confuse: inflictSelf('confused', '{name}は 混乱した！', false),
  paralyze: inflictSelf('bound', '{name}は 体が 動かなくなった！', false),
  haste: inflictSelf('quick', '{name}の 動きが 速くなった！', true),
  slowSelf: inflictSelf('slow', '{name}の 動きが 鈍くなった。', false),
  invisible: inflictSelf('invisible', '{name}の 姿が 消えた！', true),
  invincible: inflictSelf('invincible', '{name}は 無敵になった！', true),
  freeze: ({ world, user, dir, victim }) => {
    const t = victim ?? (dir !== undefined ? staffTarget(world, user.pos, dir, 5) : null);
    if (!t) {
      world.log('冷気が 広がったが、誰にも 当たらなかった。');
      return true;
    }
    applyStatus(world, t, 'bound');
    world.log(`${world.nameOf(t)}は 凍りついた！`, 'good');
    return true;
  },

  poison: ({ world, user, victim }) => {
    const t = victim ?? user;
    applyStatus(world, t, 'poisoned');
    if (t.kind === 'player') loseStr(world, t, 1);
    world.log(`${world.nameOf(t)}に 毒が 回った！`, 'bad');
    return true;
  },

  warp: ({ world, user }) => {
    const spot = world.randomSpawnTile(6) ?? world.randomOpenTile(
      (p) => at(world.map, p.x, p.y)?.kind === 'floor' && !world.actorAt(p),
    );
    if (!spot) return false;
    const from = { ...user.pos };
    user.pos = spot;
    world.emit({ t: 'warp', actorId: user.id, from, to: { ...spot } });
    world.log(`${world.nameOf(user)}は 飛ばされた！`);
    world.sfx('warp');
    return true;
  },

  levelUp: ({ world, user }) => {
    if (user.kind !== 'player') {
      if (user.kind === 'monster') return evolveMonster(world, user);
      return false;
    }
    if (user.level >= 99) {
      world.log('これ以上 強くなれない。');
      return false;
    }
    levelUp(world, user);
    return true;
  },

  levelDown: ({ world, user }) => {
    if (user.kind !== 'player') return false;
    return levelDown(world, user);
  },

  breatheFire: ({ world, user, dir }) => {
    const d = dir ?? user.dir;
    world.log('口から 炎が 吹き出した！', 'good');
    world.sfx('explosion');
    const end = step(user.pos, d, 5);
    for (const p of rayPoints(user.pos, end)) {
      const tile = at(world.map, p.x, p.y);
      if (!tile || tile.kind === 'wall') break;
      world.emit({ t: 'zap', from: { ...user.pos }, to: p, color: '#ff8030' });
      const victim = world.actorAt(p);
      if (victim && victim !== user) {
        dealDamage(world, user, victim, 25 + world.run.depth * 2, 'fire');
        applyStatus(world, victim, 'burning');
      }
    }
    return true;
  },

  // ======================================================== 巻物
  identify: ({ world, target }) => {
    if (!target) return false;
    world.run.identify.known[target.defId] = true;
    target.plusKnown = true;
    world.log(`${itemName(target, world.run.identify)}だった！`, 'good');
    world.sfx('identify');
    return true;
  },

  identifyAll: ({ world }) => {
    const p = world.player;
    for (const it of allCarriedItems(p)) {
      world.run.identify.known[it.defId] = true;
      it.plusKnown = true;
    }
    world.log('持ち物が すべて 識別された！', 'good');
    world.sfx('identify');
    return true;
  },

  identifyOne: ({ world }) => {
    const p = world.player;
    const unknown = p.inventory.filter(
      (i) => !world.run.identify.known[i.defId] || !i.plusKnown,
    );
    if (unknown.length === 0) return false;
    const it = world.rng.pick(unknown);
    world.run.identify.known[it.defId] = true;
    it.plusKnown = true;
    world.log(`${itemName(it, world.run.identify)}だと 分かった。`, 'good');
    return true;
  },

  light: ({ world }) => {
    revealWholeFloor(world.map, false);
    for (const t of world.map.tiles) t.visible = true;
    for (const room of world.map.rooms) room.dark = false;
    world.log('フロア全体が 明るくなった！', 'good');
    return true;
  },

  mapFloor: ({ world }) => {
    revealWholeFloor(world.map, true);
    world.log('フロアの 地形と ワナが 分かった。', 'good');
    return true;
  },

  blessWeapon: ({ world }) => bless(world, equippedWeapon(world.player), 3, '武器'),
  blessShield: ({ world }) => bless(world, equippedShield(world.player), 3, '盾'),

  temper: ({ world, target }) => {
    const item = target ?? equippedWeapon(world.player);
    if (!item) return false;
    item.plus = Math.min(PLUS_MAX, item.plus + 1);
    item.cursed = false;
    item.plusKnown = true;
    world.log(`${itemName(item, world.run.identify)}が 鍛えられた！`, 'good');
    world.sfx('synthesis');
    return true;
  },

  sleepRoom: ({ world, user }) => {
    const targets = enemiesInRoom(world, user.pos);
    if (targets.length === 0) {
      world.log('しかし 眠らせる相手が いなかった。');
      return true;
    }
    for (const m of targets) applyStatus(world, m, 'deepAsleep');
    world.log('あたりの モンスターが ぐっすり 眠った！', 'good');
    world.sfx('sleep');
    return true;
  },

  confuseRoom: ({ world, user }) => {
    const targets = enemiesInRoom(world, user.pos);
    for (const m of targets) applyStatus(world, m, 'confused');
    world.log('あたりの モンスターが 混乱した！', 'good');
    return true;
  },

  bindRoom: ({ world, user }) => {
    const targets = enemiesInRoom(world, user.pos);
    for (const m of targets) applyStatus(world, m, 'bound');
    world.log('あたりの モンスターが 動けなくなった！', 'good');
    return true;
  },

  vacuum: ({ world, user }) => {
    const targets = enemiesInRoom(world, user.pos);
    const dmg = 20 + world.run.depth * 3;
    world.log('真空の刃が 走った！', 'good');
    world.sfx('zap');
    for (const m of targets) dealDamage(world, user, m, dmg, 'magic');
    return true;
  },

  blast: ({ world, user }) => {
    world.log('爆発した！', 'bad');
    world.emit({ t: 'explosion', pos: { ...user.pos }, radius: 2 });
    world.sfx('explosion');
    for (const a of world.livingActors()) {
      if (chebyshev(a.pos, user.pos) > 2) continue;
      const dmg = a === user ? Math.floor(a.hp / 2) : a.maxHp;
      dealDamage(world, user, a, Math.max(1, dmg), 'fire');
    }
    return true;
  },

  fireLine: ({ world, user, dir }) => ITEM_EFFECTS.breatheFire({
    world, user, dir: dir ?? user.dir, item: {} as ItemInstance,
  }),

  sanctuary: ({ world, user }) => {
    if (at(world.map, user.pos.x, user.pos.y)?.kind !== 'floor') return false;
    world.sanctuaries.push({ ...user.pos });
    world.log('床に 巻物を 敷いた。モンスターは 乗って来られない。', 'good');
    return true;
  },

  clone: ({ world, user }) => {
    if (user.kind !== 'player') return false;
    const factory = world.monsterFactory;
    if (!factory) return false;
    let n = 0;
    for (const p of neighbors8(world.map, user.pos)) {
      if (n >= 2) break;
      if (world.actorAt(p) || at(world.map, p.x, p.y)?.kind !== 'floor') continue;
      const m = factory(p);
      if (m) {
        // 分身は味方として振る舞う
        world.removeActor(m);
        m.kind = 'ally';
        m.tactic = 'follow';
        m.nameOverride = `${user.name}の分身`;
        world.addMonster(m);
        n++;
      }
    }
    if (n === 0) return false;
    world.log('分身が 現れた！', 'good');
    return true;
  },

  purge: ({ world }) => {
    const n = world.run.monsters.filter((m) => m.alive && !world.defOf(m).isBoss).length;
    for (const m of [...world.run.monsters]) {
      if (world.defOf(m).isBoss) continue;
      m.alive = false;
      world.emit({ t: 'defeat', actorId: m.id });
      world.removeActor(m);
    }
    world.log(`フロアの モンスターが ${n}体 消え去った！`, 'good');
    world.sfx('fanfare');
    return true;
  },

  shelter: ({ world, user }) => {
    const targets = enemiesInRoom(world, user.pos);
    for (const m of targets) {
      const spot = world.findDropSpot(world.map.stairs, 4);
      if (spot) m.pos = spot;
    }
    world.log('モンスターが 階段の方へ 飛ばされた！', 'good');
    return true;
  },

  blank: ({ world }) => {
    // 好きな巻物として使える。ここではランダムな巻物になる
    const scrolls = itemsOfKind('scroll').filter((d) => d.id !== 'blankScroll' && d.weight > 0);
    const pick = world.rng.pick(scrolls);
    world.log(`白紙に 文字が 浮かび上がった…… ${pick.name}だ！`, 'good');
    const handler = ITEM_EFFECTS[(pick as { effect: string }).effect];
    if (!handler) return true;
    return handler({
      world, user: world.player, item: {} as ItemInstance, target: null,
    });
  },

  synthesize: ({ world }) => {
    const p = world.player;
    const weapons = p.inventory.filter((i) => getItem(i.defId).kind === 'weapon');
    if (weapons.length < 2) {
      world.log('合成できる 装備が 足りない。');
      return false;
    }
    const [base, mat] = weapons;
    mergeInto(world, base, mat);
    removeFromInventory(p, mat.uid);
    world.log(`${itemName(base, world.run.identify)}に なった！`, 'good');
    world.sfx('synthesis');
    return true;
  },

  recharge: ({ world, target }) => {
    const p = world.player;
    const staff = target ?? p.inventory.find((i) => getItem(i.defId).kind === 'staff');
    if (!staff) return false;
    staff.charges += 3;
    world.log(`${itemName(staff, world.run.identify)}の 力が 戻った。`, 'good');
    return true;
  },

  uncurse: ({ world }) => {
    const p = world.player;
    let n = 0;
    for (const it of allCarriedItems(p)) {
      if (it.cursed) {
        it.cursed = false;
        n++;
      }
    }
    world.log(n > 0 ? `${n}個の 呪いが 解けた！` : '呪われた物は 無かった。', 'good');
    return true;
  },

  sealItem: ({ world, target }) => {
    if (!target) return false;
    target.sealed = true;
    world.log(`${itemName(target, world.run.identify)}の 印が 封じられた。`, 'bad');
    return true;
  },

  escapeShop: ({ world }) => {
    const room = world.map.rooms.find((r) => r.shop);
    if (!room || !room.shop) {
      world.log('しかし 何も 起こらなかった。');
      return false;
    }
    room.shop.angry = false;
    const keeper = world.run.monsters.find((m) => m.id === room.shop!.ownerId);
    if (keeper) keeper.angry = false;
    for (const it of world.player.inventory) it.shopPrice = 0;
    world.log('店の 気配が 消えた。商品は 自分の物に なった！', 'good');
    return true;
  },

  escapeDungeon: ({ world }) => {
    world.log('体が 風に 包まれた……', 'good');
    world.sfx('warp');
    world.emit({ t: 'flash', color: '#cdbb7a', ms: 500 });
    world.finished = { kind: 'escape', reason: '脱出の巻物で 村へ 戻った' };
    return true;
  },

  releaseStatus: ({ world, user }) => {
    const n = cureAilments(world, user);
    if (n === 0) {
      world.log('体に 異常は 無かった。');
      return true;
    }
    world.log('体の 異常が すべて 解けた！', 'good');
    world.sfx('heal');
    return true;
  },

  makeTrap: ({ world, user }) => {
    const tile = at(world.map, user.pos.x, user.pos.y);
    if (!tile || tile.kind !== 'floor' || tile.trap) return false;
    const trapId = world.rng.pick([
      'arrow', 'sleepGas', 'confuseGas', 'spike', 'warp', 'summon',
    ]);
    tile.trap = { defId: trapId, revealed: true, used: false };
    world.log('足元に ワナが できた。', 'normal');
    return true;
  },

  curseItems: ({ world }) => {
    const p = world.player;
    const pool = p.inventory.filter((i) => !i.cursed);
    if (pool.length === 0) return false;
    const n = Math.min(pool.length, world.rng.range(1, 3));
    for (const it of world.rng.sample(pool, n)) it.cursed = true;
    world.log('持ち物が 呪われた！', 'bad');
    world.sfx('curse');
    return true;
  },

  summonMonsters: ({ world, user }) => {
    const factory = world.monsterFactory;
    if (!factory) return false;
    let n = 0;
    for (const p of neighbors8(world.map, user.pos)) {
      if (n >= 3) break;
      if (world.actorAt(p) || at(world.map, p.x, p.y)?.kind !== 'floor') continue;
      if (factory(p)) n++;
    }
    world.log('モンスターが 現れた！', 'bad');
    return true;
  },

  summonHouse: ({ world, user }) => {
    const tile = at(world.map, user.pos.x, user.pos.y);
    if (!tile || tile.roomId < 0) return false;
    const room = world.map.rooms.find((r) => r.id === tile.roomId);
    if (!room) return false;
    room.monsterHouse = 'normal';
    room.houseTriggered = false;
    world.pendingMonsterHouse = room;
    return true;
  },

  // ======================================================== 杖
  knockback: ({ world, user, dir }) => staffHit(world, user, dir, (t) => {
    const d = dirTo(user.pos, t.pos);
    if (d === null) return false;
    for (let i = 0; i < 10; i++) {
      const next = step(t.pos, d);
      if (!canEnter(world.map, next.x, next.y, 'ground') || world.actorAt(next)) {
        // 壁にぶつかるとダメージ
        dealDamage(world, user, t, 10, 'physical');
        break;
      }
      t.pos = next;
    }
    world.log(`${world.nameOf(t)}は 吹き飛んだ！`, 'good');
    return true;
  }),

  pull: ({ world, user, dir }) => staffHit(world, user, dir, (t) => {
    const d = dirTo(t.pos, user.pos);
    if (d === null) return false;
    for (let i = 0; i < 10; i++) {
      const next = step(t.pos, d);
      if (chebyshev(next, user.pos) < 1) break;
      if (!canEnter(world.map, next.x, next.y, 'ground') || world.actorAt(next)) break;
      t.pos = next;
    }
    world.log(`${world.nameOf(t)}を 引き寄せた。`, 'good');
    return true;
  }),

  sleepTarget: ({ world, user, dir }) => staffStatus(world, user, dir, 'asleep', '眠り込んだ'),
  confuseTarget: ({ world, user, dir }) => staffStatus(world, user, dir, 'confused', '混乱した'),
  bindTarget: ({ world, user, dir }) => staffStatus(world, user, dir, 'bound', '動けなくなった'),
  slowTarget: ({ world, user, dir }) => staffStatus(world, user, dir, 'slow', '鈍くなった'),
  hasteTarget: ({ world, user, dir }) => staffStatus(world, user, dir, 'quick', '速くなった'),
  sealTarget: ({ world, user, dir }) => staffStatus(world, user, dir, 'sealed', '力を 封じられた'),
  invisibleTarget: ({ world, user, dir }) =>
    staffStatus(world, user, dir, 'invisible', '透明になった'),

  swap: ({ world, user, dir }) => staffHit(world, user, dir, (t) => {
    const tmp = { ...user.pos };
    user.pos = { ...t.pos };
    t.pos = tmp;
    world.log(`${world.nameOf(t)}と 場所が 入れ替わった。`, 'good');
    world.sfx('warp');
    return true;
  }),

  shelterTarget: ({ world, user, dir }) => staffHit(world, user, dir, (t) => {
    const spot = world.findDropSpot(world.map.stairs, 4);
    if (!spot) return false;
    t.pos = spot;
    world.log(`${world.nameOf(t)}は 階段へ 飛ばされた。`, 'good');
    return true;
  }),

  transform: ({ world, user, dir }) => staffHit(world, user, dir, (t) => {
    if (t.kind === 'player') return false;
    const pool = world.dungeon.monsters.filter(
      (e) => world.run.depth >= e.from && world.run.depth <= e.to,
    );
    if (pool.length === 0) return false;
    const picked = world.rng.pick(pool).id;
    const def = world.defOfId(picked);
    t.defId = picked;
    t.level = def.level;
    t.maxHp = def.hp;
    t.hp = def.hp;
    t.atk = def.atk;
    t.def = def.def;
    t.exp = def.exp;
    world.log(`${def.name}に 変わった！`);
    return true;
  }),

  growTarget: ({ world, user, dir }) => staffHit(world, user, dir, (t) => {
    if (t.kind === 'player') return false;
    return evolveMonster(world, t);
  }),

  weakenTarget: ({ world, user, dir }) => staffHit(world, user, dir, (t) => {
    if (t.kind === 'player') return false;
    return devolveMonster(world, t);
  }),

  decoy: ({ world, user, dir }) => staffHit(world, user, dir, (t) => {
    if (t.kind === 'player') return false;
    world.decoyId = t.id;
    world.log(`${world.nameOf(t)}が 狙われるように なった。`, 'good');
    return true;
  }),

  dig: ({ world, user, dir }) => {
    const d = dir ?? user.dir;
    let dug = 0;
    let cur = { ...user.pos };
    for (let i = 0; i < 12; i++) {
      const next = step(cur, d);
      const tile = at(world.map, next.x, next.y);
      if (!tile || tile.hard) break;
      // 壁でない所は通り抜けるが、歩いて渡れない地形（水路・溶岩・谷底）で
      // 止める。ここを越えて掘ると、向こう側に「歩いては行けない床」ができる
      if (tile.kind !== 'wall' && !canEnter(world.map, next.x, next.y, 'ground')) break;
      if (tile.kind === 'wall') {
        tile.kind = 'floor';
        tile.roomId = -1;
        dug++;
      }
      // 斜めに掘る時は角も開ける。斜め移動は両隣が開いていないと通れないので、
      // 角を残したままだと「床なのに歩いて行けない」階段状の穴ができる
      if (d % 2 === 1 && !openDiagonalCorner(world, cur, next)) break;
      cur = next;
    }
    world.log(dug > 0 ? '壁が 崩れ、道が できた！' : '掘れる壁が 無かった。', 'good');
    world.sfx('break');
    return dug > 0;
  },

  thunderBolt: ({ world, user, dir }) => {
    const d = dir ?? user.dir;
    const end = step(user.pos, d, 10);
    let hit = 0;
    world.sfx('zap');
    for (const p of rayPoints(user.pos, end)) {
      const tile = at(world.map, p.x, p.y);
      if (!tile || tile.kind === 'wall') break;
      world.emit({ t: 'zap', from: { ...user.pos }, to: p, color: '#ffe060' });
      const t = world.actorAt(p);
      if (t && t !== user) {
        let dmg = 20 + world.run.depth * 2;
        if (world.hasStatus(t, 'wet')) dmg *= 2;
        dealDamage(world, user, t, dmg, 'magic');
        hit++;
      }
    }
    world.log(hit > 0 ? '雷が 落ちた！' : '雷は 空を 切った。', 'good');
    return true;
  },

  suction: ({ world, user, dir }) => {
    const d = dir ?? user.dir;
    const end = step(user.pos, d, 10);
    let n = 0;
    for (const p of rayPoints(user.pos, end).reverse()) {
      const t = world.actorAt(p);
      if (!t || t === user) continue;
      const back = dirTo(t.pos, user.pos);
      if (back === null) continue;
      for (let i = 0; i < 10; i++) {
        const next = step(t.pos, back);
        if (chebyshev(next, user.pos) < 1) break;
        if (!canEnter(world.map, next.x, next.y, 'ground') || world.actorAt(next)) break;
        t.pos = next;
      }
      n++;
    }
    world.log(n > 0 ? '敵を 引き寄せた！' : '何も 起こらなかった。', 'good');
    return n > 0;
  },

  echo: ({ world, user, dir }) => {
    // 壁で跳ね返る魔法。3 回まで反射する
    let d = dir ?? user.dir;
    let cur = { ...user.pos };
    let bounces = 0;
    let hit = false;
    for (let i = 0; i < 40 && bounces <= 3; i++) {
      const next = step(cur, d);
      const tile = at(world.map, next.x, next.y);
      if (!tile || tile.kind === 'wall') {
        d = ((d + 4) % 8) as Dir;
        bounces++;
        continue;
      }
      cur = next;
      world.emit({ t: 'zap', from: { ...user.pos }, to: { ...cur }, color: '#a0e0ff' });
      const t = world.actorAt(cur);
      if (t && t !== user) {
        dealDamage(world, user, t, 18 + world.run.depth * 2, 'magic');
        hit = true;
      }
    }
    world.log(hit ? '魔法が 跳ね返りながら 敵を 貫いた！' : '魔法は 消えた。', 'good');
    return true;
  },

  lossGitan: ({ world, user }) => {
    if (user.kind !== 'player') return false;
    const loss = Math.floor(user.gitan * 0.5);
    user.gitan -= loss;
    world.log(`${loss}ギタンを 落としてしまった！`, 'bad');
    return true;
  },

  // ======================================================== 壺・食料
  storage: () => true,
  backpack: () => true,
  unbreakable: () => true,

  synthesis: ({ world, item }) => {
    const equips = item.contents.filter((i) => {
      const k = getItem(i.defId).kind;
      return k === 'weapon' || k === 'shield';
    });
    if (equips.length < 2) return false;
    const base = equips[0];
    for (let i = 1; i < equips.length; i++) mergeInto(world, base, equips[i]);
    item.contents = [base];
    world.run.identify.known[base.defId] = true;
    base.plusKnown = true;
    world.log(`${itemName(base, world.run.identify)}が できあがった！`, 'good');
    world.sfx('synthesis');
    return true;
  },

  identifyPot: ({ world, target }) => {
    if (!target) return false;
    world.run.identify.known[target.defId] = true;
    target.plusKnown = true;
    world.log(`${itemName(target, world.run.identify)}だった！`, 'good');
    return true;
  },

  changePot: ({ world, target }) => {
    if (!target) return false;
    const pool = world.dungeon.items.filter(
      (e) => world.run.depth >= e.from && world.run.depth <= e.to,
    );
    if (pool.length === 0) return false;
    const newId = world.rng.pick(pool).id;
    target.defId = newId;
    target.plus = 0;
    target.runes = [];
    target.plusKnown = false;
    const def = tryGetItem(newId);
    if (def && def.kind === 'staff') target.charges = world.rng.range(def.charges[0], def.charges[1]);
    world.log('中身が 別の物に 変わった。', 'normal');
    return true;
  },

  holePot: ({ world, target }) => {
    if (!target) return false;
    world.log(`${itemName(target, world.run.identify)}は 下の階へ 落ちていった。`, 'bad');
    return true;
  },

  cashPot: ({ world, target }) => {
    if (!target) return false;
    const gain = Math.max(1, Math.floor(getItem(target.defId).price * 0.5));
    world.player.gitan += gain;
    world.log(`${gain}ギタンに なった！`, 'item');
    world.sfx('gitan');
    return true;
  },

  blessPot: ({ world, target }) => {
    if (!target) return false;
    target.cursed = false;
    target.plus = Math.min(PLUS_MAX, target.plus + 1);
    world.log(`${itemName(target, world.run.identify)}が 祝福された。`, 'good');
    return true;
  },

  strengthenPot: ({ world, target }) => {
    if (!target) return false;
    target.plus = Math.min(PLUS_MAX, target.plus + 2);
    target.plusKnown = true;
    world.log(`${itemName(target, world.run.identify)}が 強くなった！`, 'good');
    return true;
  },

  weakenPot: ({ world, target }) => {
    if (!target) return false;
    target.plus = Math.max(PLUS_MIN, target.plus - 2);
    target.plusKnown = true;
    world.log(`${itemName(target, world.run.identify)}が 弱くなった……`, 'bad');
    return true;
  },

  purifyPot: ({ world, target }) => {
    if (!target) return false;
    if (!target.cursed) return false;
    target.cursed = false;
    world.log(`${itemName(target, world.run.identify)}の 呪いが 解けた。`, 'good');
    return true;
  },

  waterPot: ({ world, user, dir }) => {
    const d = dir ?? user.dir;
    const target = world.actorAt(step(user.pos, d));
    if (target) {
      applyStatus(world, target, 'wet');
      removeStatus(world, target, 'burning');
      world.log(`${world.nameOf(target)}は 水を 浴びた。`, 'good');
      return true;
    }
    world.log('水を まいた。');
    return true;
  },

  evadePot: ({ world, user }) => {
    applyStatus(world, user, 'invisible', 10);
    world.log('壺に 隠れて やり過ごした。', 'good');
    return true;
  },

  sealPot: ({ world, user }) => {
    applyStatus(world, user, 'sealed');
    world.log('手が 壺から 抜けなくなった！', 'bad');
    return true;
  },

  monsterPot: ({ world, user }) => {
    const factory = world.monsterFactory;
    if (!factory) return false;
    for (const p of neighbors8(world.map, user.pos)) {
      if (world.actorAt(p) || at(world.map, p.x, p.y)?.kind !== 'floor') continue;
      factory(p);
      break;
    }
    world.log('中から モンスターが 飛び出した！', 'bad');
    return true;
  },

  warehousePot: ({ world }) => {
    world.log('中身が 村の倉庫へ 送られた。', 'good');
    return true;
  },

  cureBurn: ({ world, user }) => {
    removeStatus(world, user, 'burning');
    world.log('火傷が 癒えた。', 'good');
    return true;
  },

  rotten: ({ world, user }) => {
    if (user.kind !== 'player') return false;
    applyStatus(world, user, 'confused', 10);
    loseStr(world, user, 1);
    dealDamage(world, null, user, 10, 'magic');
    world.log('ひどい 味だ……', 'bad');
    return true;
  },

  // ======================================================== 投げた時の特殊効果
  explodeOnHit: ({ world, user, victim, item }) => {
    const center = victim ? victim.pos : user.pos;
    world.emit({ t: 'explosion', pos: { ...center }, radius: 1 });
    world.sfx('explosion');
    for (const a of world.livingActors()) {
      if (chebyshev(a.pos, center) > 1) continue;
      dealDamage(world, user, a, a.kind === 'player' ? 20 : a.maxHp, 'fire');
    }
    void item;
    return true;
  },

  bindOnHit: ({ world, victim }) => {
    if (!victim) return false;
    applyStatus(world, victim, 'bound');
    world.log(`${world.nameOf(victim)}は 動けなくなった！`, 'good');
    return true;
  },

  blindOnHit: ({ world, victim, user }) => {
    const center = victim ? victim.pos : user.pos;
    for (const m of world.run.monsters) {
      if (chebyshev(m.pos, center) <= 2) applyStatus(world, m, 'blind');
    }
    world.log('けむりが 広がった！', 'good');
    return true;
  },

  arrowFlight: () => true,
  arrowPierce: () => true,
};

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

function bless(world: World, item: ItemInstance | null, amount: number, label: string): boolean {
  if (!item) {
    world.log(`${label}を 装備していない。`);
    return false;
  }
  item.plus = Math.min(PLUS_MAX, item.plus + amount);
  item.plusKnown = true;
  world.log(`${itemName(item, world.run.identify)}が 強くなった！`, 'good');
  world.sfx('statUp');
  return true;
}

/** 杖の弾で当たった相手に処理を適用する */
function staffHit(
  world: World, user: Actor, dir: Dir | undefined,
  fn: (t: Actor) => boolean,
): boolean {
  const d = dir ?? user.dir;
  const target = staffTarget(world, user.pos, d, 10);
  world.emit({
    t: 'zap', from: { ...user.pos },
    to: target ? { ...target.pos } : step(user.pos, d, 6),
    color: '#c0a0ff',
  });
  world.sfx('zap');
  if (!target) {
    world.log('魔法は 空を 切った。');
    return true; // 空振りでも杖は消費する
  }
  return fn(target) || true;
}

function staffStatus(
  world: World, user: Actor, dir: Dir | undefined,
  status: Parameters<typeof applyStatus>[2], verb: string,
): boolean {
  return staffHit(world, user, dir, (t) => {
    applyStatus(world, t, status);
    world.log(`${world.nameOf(t)}は ${verb}！`, t === user ? 'bad' : 'good');
    return true;
  });
}

/**
 * 装備を合成する。修正値を足し、印を移す。
 * 素材の印は入る順に試し、スロットが足りなければ捨てる。
 */
export function mergeInto(world: World, base: ItemInstance, material: ItemInstance): void {
  base.plus = Math.max(PLUS_MIN, Math.min(PLUS_MAX, base.plus + material.plus));
  // 匠の印は先に入れておくとスロットが広がる
  const runes = runeList(material).sort((a, b) => (a.id === 'smith' ? -1 : b.id === 'smith' ? 1 : 0));
  for (const { id, level } of runes) {
    for (let i = 0; i < level; i++) addRune(base, id);
  }
  if (material.cursed) base.cursed = true;
  base.plusKnown = true;
  world.run.identify.known[base.defId] = true;
}

/** 投げたアイテムの基本ダメージ */
export function throwDamage(world: World, item: ItemInstance, thrower: Actor): number {
  const def = getItem(item.defId);
  const base = def.throwPower ?? 3;
  if (def.kind === 'weapon') return def.atk + item.plus;
  if (def.kind === 'shield') return def.def + item.plus;
  if (def.kind === 'misc' && thrower.kind === 'player') {
    return base + Math.floor(thrower.str / 4) + item.plus;
  }
  void world;
  return base;
}

export { P, isEquipped, isInventoryFull, addToInventory, findItem, losableItems, makeItem, eat, loseFood };
