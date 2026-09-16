/**
 * モンスターの特技。SkillId → ハンドラの表。
 *
 * ハンドラは「使えたか」を返す。false を返した場合、AI は通常行動に落ちる。
 * 射程や射線の条件もハンドラ側で判定する（AI を単純に保つため）。
 */

import { chebyshev, dirTo, isOnRay, rayPoints, step } from '../core/geom.js';
import type { Actor, MonsterActor, StatusId } from '../core/types.js';
import { getItem } from '../data/registry.js';
import { devolveOf } from '../data/monsters.js';
import { at, canEnter } from '../dungeon/tilemap.js';
import { hasLineOfFire } from '../dungeon/fov.js';
import { dealDamage, healActor, levelDown, resolveAttack } from './combat.js';
import { equippedShield, equippedWeapon, losableItems, removeFromInventory } from './inventory.js';
import { itemName } from './naming.js';
import { equipRuneLevel } from './runes.js';
import { applyStatus } from './status.js';
import { loseFood } from './hunger.js';
import type { World } from './world.js';

export type SkillHandler = (world: World, m: MonsterActor, target: Actor) => boolean;

const adjacent = (m: MonsterActor, t: Actor): boolean => chebyshev(m.pos, t.pos) === 1;

/** 自己回復の特技を使える回数の上限 */
const MAX_SELF_HEALS = 3;

/** 盾の「盗」印・盗賊よけの腕輪で盗みを防げるか */
function blocksTheft(world: World, t: Actor): boolean {
  if (t.kind !== 'player') return false;
  const shield = equippedShield(world.player);
  if (equipRuneLevel(shield, 'antiSteal') > 0) return true;
  const b = world.player.braceletUid !== null
    ? world.player.inventory.find((i) => i.uid === world.player.braceletUid) : null;
  if (b && !b.cursed && !world.hasStatus(t, 'sealed')) {
    const def = getItem(b.defId);
    if (def.kind === 'bracelet' && def.effect === 'wardSteal') return true;
  }
  return false;
}

/** 状態異常を与える特技の共通処理 */
const inflict = (id: StatusId, message: string, needAdjacent = true): SkillHandler =>
  (world, m, t) => {
    if (needAdjacent && !adjacent(m, t)) return false;
    if (world.hasStatus(t, id)) return false;
    world.log(`${world.nameOf(m)}の ${message}`, 'bad');
    applyStatus(world, t, id);
    return true;
  };

/** 視線が通っていれば離れていても効く特技 */
const gaze = (id: StatusId, message: string): SkillHandler =>
  (world, m, t) => {
    if (chebyshev(m.pos, t.pos) > 5) return false;
    if (!isOnRay(m.pos, t.pos) || !hasLineOfFire(world.map, m.pos, t.pos)) return false;
    if (world.hasStatus(t, id)) return false;
    const d = dirTo(m.pos, t.pos);
    if (d !== null) m.dir = d;
    world.log(`${world.nameOf(m)}の ${message}`, 'bad');
    world.emit({ t: 'zap', from: { ...m.pos }, to: { ...t.pos }, color: '#b07fd8' });
    applyStatus(world, t, id);
    return true;
  };

/** 直線上に飛ぶ魔法弾 */
const magicBolt = (id: StatusId, message: string, color: string): SkillHandler =>
  (world, m, t) => {
    const dist = chebyshev(m.pos, t.pos);
    if (dist < 2 || dist > 10) return false;
    if (!isOnRay(m.pos, t.pos) || !hasLineOfFire(world.map, m.pos, t.pos)) return false;
    if (world.hasStatus(t, id)) return false;
    const d = dirTo(m.pos, t.pos);
    if (d !== null) m.dir = d;
    world.log(`${world.nameOf(m)}は ${message}`, 'bad');
    world.emit({ t: 'zap', from: { ...m.pos }, to: { ...t.pos }, color });
    world.sfx('zap');
    applyStatus(world, t, id);
    return true;
  };

/** 空いている隣接マスを探す */
function freeNeighbor(world: World, from: { x: number; y: number }): { x: number; y: number } | null {
  const spots: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const p = { x: from.x + dx, y: from.y + dy };
      if (!canEnter(world.map, p.x, p.y, 'ground')) continue;
      if (world.actorAt(p)) continue;
      spots.push(p);
    }
  }
  return spots.length > 0 ? world.rng.pick(spots) : null;
}

export const MONSTER_SKILLS: Record<string, SkillHandler> = {
  // ------------------------------------------------------------ 増える
  split: (world, m, t) => {
    if (!adjacent(m, t)) return false;
    // 身代わりに向かって無限に分裂されると、フロアが敵で埋まる
    if (t.id === world.decoyId) return false;
    if (world.run.monsters.length >= world.dungeon.gen.maxMonsters + 6) return false;
    const spot = freeNeighbor(world, m.pos);
    if (!spot) return false;
    const clone: MonsterActor = {
      ...m,
      id: world.nextActorId(),
      pos: spot,
      hp: Math.max(1, Math.floor(m.hp / 2)),
      statuses: [],
      heldItems: [],
      heldGitan: 0,
      actedThisTurn: 1,
    };
    m.hp = Math.max(1, Math.ceil(m.hp / 2));
    world.addMonster(clone);
    world.log(`${world.nameOf(m)}は 分裂した！`, 'bad');
    return true;
  },

  multiply: (world, m) => {
    const same = world.run.monsters.filter((x) => x.defId === m.defId).length;
    if (same >= 12) return false;
    const spot = freeNeighbor(world, m.pos);
    if (!spot) return false;
    const def = world.defOf(m);
    const child: MonsterActor = {
      ...m,
      id: world.nextActorId(),
      pos: spot,
      hp: def.hp,
      maxHp: def.hp,
      statuses: [],
      heldItems: [],
      heldGitan: 0,
      actedThisTurn: 1,
    };
    world.addMonster(child);
    world.log(`${world.nameOf(m)}は 増殖した！`, 'bad');
    return true;
  },

  cloneSelf: (world, m) => {
    if (world.run.monsters.length >= world.dungeon.gen.maxMonsters + 4) return false;
    const spot = freeNeighbor(world, m.pos);
    if (!spot) return false;
    const clone: MonsterActor = {
      ...m, id: world.nextActorId(), pos: spot, statuses: [],
      heldItems: [], heldGitan: 0, actedThisTurn: 1,
    };
    world.addMonster(clone);
    world.log(`${world.nameOf(m)}は 分身を 作り出した！`, 'bad');
    return true;
  },

  summonAlly: (world, m) => {
    if (world.run.monsters.length >= world.dungeon.gen.maxMonsters + 4) return false;
    const factory = world.monsterFactory;
    if (!factory) return false;
    let summoned = 0;
    for (let i = 0; i < 2; i++) {
      const spot = freeNeighbor(world, m.pos);
      if (!spot) break;
      if (factory(spot)) summoned++;
    }
    if (summoned === 0) return false;
    world.log(`${world.nameOf(m)}は 仲間を 呼んだ！`, 'bad');
    return true;
  },

  // ------------------------------------------------------------ 攻撃
  doubleAttack: (world, m, t) => {
    if (!adjacent(m, t)) return false;
    world.log(`${world.nameOf(m)}の 連続攻撃！`, 'bad');
    resolveAttack(world, m, t, 0.8);
    if (t.alive) resolveAttack(world, m, t, 0.8);
    return true;
  },

  drainHp: (world, m, t) => {
    if (!adjacent(m, t)) return false;
    const r = resolveAttack(world, m, t, 0.8);
    if (r.hit && r.damage > 0) {
      const heal = healActor(world, m, Math.floor(r.damage / 2));
      if (heal > 0) world.log(`${world.nameOf(m)}は 血を 吸った！`, 'bad');
    }
    return true;
  },

  healSelf: (world, m) => {
    // 回数制限が無いと、倍速で回復を撃ち続ける敵が不死身になってしまう。
    // 回復できる総量を「最大 HP の 90%」までに抑える。
    if (m.healsUsed >= MAX_SELF_HEALS) return false;
    if (m.hp >= m.maxHp * 0.6) return false;
    const heal = healActor(world, m, Math.floor(m.maxHp * 0.3));
    if (heal <= 0) return false;
    m.healsUsed++;
    world.log(`${world.nameOf(m)}は 傷を 癒やした。`, 'bad');
    return true;
  },

  knockbackHit: (world, m, t) => {
    if (!adjacent(m, t)) return false;
    const r = resolveAttack(world, m, t);
    if (!r.hit || !t.alive) return r.hit;
    const d = dirTo(m.pos, t.pos);
    if (d === null) return true;
    for (let i = 0; i < 4; i++) {
      const next = step(t.pos, d);
      if (!canEnter(world.map, next.x, next.y, 'ground') || world.actorAt(next)) break;
      t.pos = next;
    }
    world.log(`${world.nameOf(t)}は 吹き飛ばされた！`, 'bad');
    return true;
  },

  leapAttack: (world, m, t) => {
    const dist = chebyshev(m.pos, t.pos);
    if (dist < 2 || dist > 4) return false;
    const spot = freeNeighbor(world, t.pos);
    if (!spot) return false;
    const from = { ...m.pos };
    m.pos = spot;
    world.emit({ t: 'move', actorId: m.id, from, to: spot });
    world.log(`${world.nameOf(m)}が 跳びかかってきた！`, 'bad');
    resolveAttack(world, m, t);
    return true;
  },

  breatheFire: (world, m, t) => {
    const dist = chebyshev(m.pos, t.pos);
    if (dist < 2 || dist > 6) return false;
    if (!isOnRay(m.pos, t.pos) || !hasLineOfFire(world.map, m.pos, t.pos)) return false;
    const d = dirTo(m.pos, t.pos);
    if (d !== null) m.dir = d;
    world.log(`${world.nameOf(m)}は 炎を 吐いた！`, 'bad');
    world.emit({ t: 'zap', from: { ...m.pos }, to: { ...t.pos }, color: '#ff8030' });
    world.sfx('explosion');
    dealDamage(world, m, t, Math.floor(m.atk * 0.9), 'fire');
    return true;
  },

  breatheInferno: (world, m, t) => {
    const dist = chebyshev(m.pos, t.pos);
    if (dist > 9) return false;
    if (!isOnRay(m.pos, t.pos) || !hasLineOfFire(world.map, m.pos, t.pos)) return false;
    const d = dirTo(m.pos, t.pos);
    if (d !== null) m.dir = d;
    world.log(`${world.nameOf(m)}は 灼熱の息を 放った！`, 'bad');
    world.emit({ t: 'zap', from: { ...m.pos }, to: { ...t.pos }, color: '#ffd040' });
    world.sfx('explosion');
    for (const p of rayPoints(m.pos, t.pos)) {
      const victim = world.actorAt(p);
      if (victim && victim !== m) dealDamage(world, m, victim, Math.floor(m.atk * 1.1), 'fire');
    }
    applyStatus(world, t, 'burning');
    return true;
  },

  waterJet: (world, m, t) => {
    const dist = chebyshev(m.pos, t.pos);
    if (dist < 2 || dist > 8) return false;
    if (!isOnRay(m.pos, t.pos) || !hasLineOfFire(world.map, m.pos, t.pos)) return false;
    world.log(`${world.nameOf(m)}は 水流を 放った！`, 'bad');
    world.emit({ t: 'zap', from: { ...m.pos }, to: { ...t.pos }, color: '#50a0e0' });
    world.sfx('splash');
    dealDamage(world, m, t, Math.floor(m.atk * 0.8), 'magic');
    applyStatus(world, t, 'wet');
    return true;
  },

  throwStone: (world, m, t) => {
    const dist = chebyshev(m.pos, t.pos);
    if (dist < 2 || dist > 10) return false;
    if (!isOnRay(m.pos, t.pos) || !hasLineOfFire(world.map, m.pos, t.pos)) return false;
    const d = dirTo(m.pos, t.pos);
    if (d !== null) m.dir = d;
    world.log(`${world.nameOf(m)}は 石を 投げた！`, 'bad');
    world.emit({
      t: 'projectile', from: { ...m.pos }, to: { ...t.pos }, sprite: 'stone', kind: 'item',
    });
    world.sfx('throw');
    dealDamage(world, m, t, Math.max(1, Math.floor(m.atk * 0.6)), 'physical');
    return true;
  },

  throwBoulder: (world, m, t) => {
    const dist = chebyshev(m.pos, t.pos);
    if (dist < 2 || dist > 12) return false;
    if (!isOnRay(m.pos, t.pos) || !hasLineOfFire(world.map, m.pos, t.pos)) return false;
    world.log(`${world.nameOf(m)}は 岩を 投げつけた！`, 'bad');
    world.emit({
      t: 'projectile', from: { ...m.pos }, to: { ...t.pos }, sprite: 'stone', kind: 'item',
    });
    world.sfx('throw');
    dealDamage(world, m, t, Math.max(2, Math.floor(m.atk * 0.9)), 'physical');
    return true;
  },

  explodeOnDeath: () => false, // 死亡時に turn.ts が処理する

  // ------------------------------------------------------------ 状態異常
  poisonTouch: inflict('poisoned', '毒の 体当たり！'),
  deadlyPoisonTouch: inflict('deadlyPoisoned', '猛毒の 体当たり！'),
  confuseTouch: inflict('confused', '怪しい 羽ばたき！'),
  blindTouch: inflict('blind', '闇の つばさ！'),
  bindTouch: inflict('bound', '恨みの 手！'),
  faintTouch: inflict('fainted', '冷たい 一撃！'),

  gazeSleep: gaze('asleep', '眠りの 胞子！'),
  gazePoison: gaze('poisoned', '毒の 胞子！'),
  gazeDeadlyPoison: gaze('deadlyPoisoned', '猛毒の 胞子！'),
  gazeBind: gaze('bound', 'にらみつけ！'),
  gazeFaint: gaze('fainted', '深淵の まなざし！'),

  magicSleep: magicBolt('asleep', '眠りの魔法を 唱えた！', '#7080e0'),
  magicConfuse: magicBolt('confused', '混乱の魔法を 唱えた！', '#e070d0'),
  magicBind: magicBolt('bound', 'かなしばりの魔法を 唱えた！', '#e0c040'),
  magicSlow: magicBolt('slow', '鈍足の魔法を 唱えた！', '#60c0a0'),

  sealPlayer: (world, m, t) => {
    if (chebyshev(m.pos, t.pos) > 3) return false;
    if (world.hasStatus(t, 'sealed')) return false;
    world.log(`${world.nameOf(m)}は 力を 封じた！`, 'bad');
    applyStatus(world, t, 'sealed');
    world.sfx('curse');
    return true;
  },

  levelDrain: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    world.log(`${world.nameOf(m)}は 経験を 吸い取った！`, 'bad');
    world.sfx('curse');
    levelDown(world, t);
    return true;
  },

  // ------------------------------------------------------------ 持ち物への干渉
  stealItem: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    if (blocksTheft(world, t)) {
      world.log(`${world.nameOf(m)}は 盗もうとしたが 弾かれた！`, 'good');
      return true;
    }
    const pool = losableItems(t);
    if (pool.length === 0) return false;
    const item = world.rng.pick(pool);
    removeFromInventory(t, item.uid);
    m.heldItems.push(item);
    world.log(`${world.nameOf(m)}に ${itemName(item, world.run.identify)}を 盗まれた！`, 'bad');
    world.sfx('steal');
    m.lastSeen = null;
    return true;
  },

  stealEquip: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    if (blocksTheft(world, t)) return false;
    const p = t;
    const equips = [equippedWeapon(p), equippedShield(p)].filter(
      (e): e is NonNullable<typeof e> => !!e && !e.cursed,
    );
    if (equips.length === 0) return false;
    const item = world.rng.pick(equips);
    removeFromInventory(p, item.uid);
    m.heldItems.push(item);
    world.log(`${world.nameOf(m)}に ${itemName(item, world.run.identify)}を 奪われた！`, 'bad');
    world.sfx('steal');
    return true;
  },

  stealGitan: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    if (blocksTheft(world, t)) {
      world.log(`${world.nameOf(m)}は 盗もうとしたが 弾かれた！`, 'good');
      return true;
    }
    if (t.gitan <= 0) return false;
    const amount = Math.max(1, Math.floor(t.gitan * world.rng.range(30, 80) / 100));
    t.gitan -= amount;
    m.heldGitan += amount;
    world.log(`${world.nameOf(m)}に ${amount}ギタン 盗まれた！`, 'bad');
    world.sfx('steal');
    return true;
  },

  swallowItem: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    const pool = losableItems(t);
    if (pool.length === 0) return false;
    const item = world.rng.pick(pool);
    removeFromInventory(t, item.uid);
    m.heldItems.push(item);
    world.log(`${world.nameOf(m)}は ${itemName(item, world.run.identify)}を 飲み込んだ！`, 'bad');
    return true;
  },

  eatFood: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    const loss = 50 + world.rng.int(100);
    loseFood(world, t, loss);
    world.log(`${world.nameOf(m)}に 食料を かじられた！`, 'bad');
    return true;
  },

  rustWeapon: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    const w = equippedWeapon(t);
    if (!w) return false;
    if (equipRuneLevel(equippedShield(t), 'antiRust') > 0 || w.runes.includes('antiRust')) {
      world.log('錆びよけの 印が 守った！', 'good');
      return true;
    }
    if (w.plus <= -99) return false;
    w.plus--;
    w.plusKnown = true;
    world.log(`${itemName(w, world.run.identify)}が 錆びついた！`, 'bad');
    world.sfx('curse');
    return true;
  },

  rustShield: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    const s = equippedShield(t);
    if (!s) return false;
    if (equipRuneLevel(s, 'antiRust') > 0) {
      world.log('錆びよけの 印が 守った！', 'good');
      return true;
    }
    if (s.plus <= -99) return false;
    s.plus--;
    s.plusKnown = true;
    world.log(`${itemName(s, world.run.identify)}が 錆びついた！`, 'bad');
    return true;
  },

  curseItem: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    const pool = t.inventory.filter((i) => !i.cursed);
    if (pool.length === 0) return false;
    const item = world.rng.pick(pool);
    item.cursed = true;
    world.log(`${itemName(item, world.run.identify)}が 呪われた！`, 'bad');
    world.sfx('curse');
    return true;
  },

  curseEquip: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    const equips = [equippedWeapon(t), equippedShield(t)].filter(
      (e): e is NonNullable<typeof e> => !!e && !e.cursed,
    );
    if (equips.length === 0) return false;
    const item = world.rng.pick(equips);
    item.cursed = true;
    world.log(`${itemName(item, world.run.identify)}が 呪われて 外せなくなった！`, 'bad');
    world.sfx('curse');
    return true;
  },

  tripPlayer: (world, m, t) => {
    if (!adjacent(m, t) || t.kind !== 'player') return false;
    const pool = losableItems(t);
    if (pool.length === 0) return false;
    const n = Math.min(pool.length, world.rng.range(1, 3));
    const dropped = world.rng.sample(pool, n);
    for (const item of dropped) {
      removeFromInventory(t, item.uid);
      world.dropItem(item, t.pos);
    }
    world.log(`${world.nameOf(m)}に 足を すくわれた！ 持ち物を 落とした。`, 'bad');
    return true;
  },

  useItemOnPlayer: (world, m, t) => {
    if (chebyshev(m.pos, t.pos) > 6 || t.kind !== 'player') return false;
    const pool = losableItems(t);
    if (pool.length === 0) return false;
    const item = world.rng.pick(pool);
    removeFromInventory(t, item.uid);
    world.log(`${world.nameOf(m)}は ${itemName(item, world.run.identify)}を 投げつけた！`, 'bad');
    world.emit({
      t: 'projectile', from: { ...m.pos }, to: { ...t.pos }, sprite: 'item', kind: 'item',
    });
    dealDamage(world, m, t, getItem(item.defId).throwPower ?? 3, 'physical');
    return true;
  },

  dragIntoWater: (world, m, t) => {
    if (!adjacent(m, t)) return false;
    const tile = at(world.map, m.pos.x, m.pos.y);
    if (!tile || tile.kind !== 'water') return false;
    world.log(`${world.nameOf(m)}に 水中へ 引きずり込まれた！`, 'bad');
    dealDamage(world, m, t, Math.floor(m.atk * 1.2), 'physical');
    applyStatus(world, t, 'wet');
    return true;
  },
};

/** 特技を 1 つ選んで使う。使えたら true */
export function useSkill(world: World, m: MonsterActor, target: Actor): boolean {
  const def = world.defOf(m);
  if (def.skills.length === 0) return false;
  if (world.hasStatus(m, 'sealed')) return false;
  if (!world.rng.percent(def.skillRate)) return false;
  for (const id of world.rng.shuffled(def.skills)) {
    const handler = MONSTER_SKILLS[id];
    if (handler && handler(world, m, target)) return true;
  }
  return false;
}

/** 爆発する敵が倒れた時の処理 */
export function explodeOnDeath(world: World, m: MonsterActor): void {
  const radius = m.defId === 'bombGiant' ? 2 : 1;
  world.log(`${world.nameOf(m)}は 爆発した！`, 'bad');
  world.emit({ t: 'explosion', pos: { ...m.pos }, radius });
  world.sfx('explosion');
  for (const a of world.livingActors()) {
    if (a === m) continue;
    if (chebyshev(a.pos, m.pos) > radius) continue;
    const dmg = a.kind === 'player'
      ? Math.max(1, Math.floor(a.hp / 2))
      : Math.max(1, Math.floor(a.maxHp * 0.7));
    dealDamage(world, m, a, dmg, 'fire');
  }
}

/** レベルダウンの杖などで 1 段階下げる */
export function devolveMonster(world: World, m: MonsterActor): boolean {
  // ボスを消すと、その階の階段が永久に開かなくなって詰む
  if (world.defOf(m).isBoss) {
    world.log(`${world.nameOf(m)}には 効かなかった。`);
    return false;
  }
  const prev = devolveOf(m.defId);
  if (!prev) {
    // これ以上下げられない敵は消える
    world.log(`${world.nameOf(m)}は 消え去った。`, 'good');
    m.alive = false;
    world.removeActor(m);
    return true;
  }
  const newDef = world.defOfId(prev);
  m.defId = prev;
  m.level = newDef.level;
  m.maxHp = newDef.hp;
  m.hp = Math.min(m.hp, newDef.hp);
  m.atk = newDef.atk;
  m.def = newDef.def;
  m.exp = newDef.exp;
  world.log(`${world.nameOf(m)}に 変わった。`, 'good');
  return true;
}

/** 成長の杖などで 1 段階上げる */
export function evolveMonster(world: World, m: MonsterActor): boolean {
  if (world.defOf(m).isBoss) {
    world.log(`${world.nameOf(m)}には 効かなかった。`);
    return false;
  }
  const next = world.defOf(m).evolveTo;
  if (!next) return false;
  const newDef = world.defOfId(next);
  m.defId = next;
  m.level = newDef.level;
  m.maxHp = newDef.hp;
  m.hp = newDef.hp;
  m.atk = newDef.atk;
  m.def = newDef.def;
  m.exp = newDef.exp;
  world.log(`${world.nameOf(m)}に 変わった！`, 'bad');
  return true;
}
