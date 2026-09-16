/**
 * ワナの効果。TrapDef.effect → ハンドラの表。
 */

import { type Dir, type Point, chebyshev } from '../core/geom.js';
import type { Actor, ItemInstance } from '../core/types.js';
import { getItem, getTrap } from '../data/registry.js';
import { at, neighbors8 } from '../dungeon/tilemap.js';
import { dealDamage, loseStr } from './combat.js';
import { loseFood } from './hunger.js';
import { equippedShield, losableItems, removeFromInventory } from './inventory.js';
import { itemName } from './naming.js';
import { equipRuneLevel } from './runes.js';
import { applyStatus } from './status.js';
import type { World } from './world.js';

type TrapHandler = (world: World, a: Actor) => void;

const isPlayer = (a: Actor): a is Extract<Actor, { kind: 'player' }> => a.kind === 'player';

/** ワナで飛ばす先を探す */
function randomWarpSpot(world: World): { x: number; y: number } | null {
  return world.randomSpawnTile(6) ?? world.randomOpenTile((p) => {
    const t = at(world.map, p.x, p.y);
    return !!t && t.kind === 'floor' && !world.actorAt(p);
  });
}

const TRAP_EFFECTS: Record<string, TrapHandler> = {
  trapArrow: (world, a) => {
    const dmg = Math.max(1, 5 + Math.floor(world.run.depth / 3));
    world.log('矢が 飛んできた！', 'bad');
    dealDamage(world, null, a, dmg, 'physical');
  },

  trapPoisonArrow: (world, a) => {
    const dmg = Math.max(1, 4 + Math.floor(world.run.depth / 4));
    world.log('毒矢が 飛んできた！', 'bad');
    dealDamage(world, null, a, dmg, 'physical');
    if (isPlayer(a)) loseStr(world, a, 1);
    applyStatus(world, a, 'poisoned');
  },

  trapPitfall: (world, a) => {
    if (isPlayer(a)) {
      world.log('下の階へ 落ちた！', 'bad');
      world.sfx('warp');
      world.pendingDescend = true;
    } else {
      world.log(`${world.nameOf(a)}は 落とし穴に 落ちた。`);
      a.alive = false;
      world.removeActor(a);
    }
  },

  trapSleep: (world, a) => {
    world.log('眠りガスが 噴き出した！', 'bad');
    world.sfx('sleep');
    applyStatus(world, a, 'asleep');
  },

  trapConfuse: (world, a) => {
    world.log('怪しいガスが 噴き出した！', 'bad');
    world.sfx('confuse');
    applyStatus(world, a, 'confused');
  },

  trapBlind: (world, a) => {
    world.log('目の前が 真っ暗になった！', 'bad');
    applyStatus(world, a, 'blind');
  },

  trapBear: (world, a) => {
    world.log('トラばさみに 挟まれた！', 'bad');
    applyStatus(world, a, 'trapped');
    dealDamage(world, null, a, Math.max(1, Math.floor(a.maxHp * 0.05)), 'physical');
  },

  trapRust: (world, a) => {
    if (!isPlayer(a)) return;
    const w = a.weaponUid !== null ? a.inventory.find((i) => i.uid === a.weaponUid) : null;
    if (!w) {
      world.log('しかし 錆びる物が 無かった。');
      return;
    }
    if (equipRuneLevel(equippedShield(a), 'antiRust') > 0 || w.runes.includes('antiRust')) {
      world.log('錆びよけの 印が 守った！', 'good');
      return;
    }
    w.plus--;
    w.plusKnown = true;
    world.log(`${itemName(w, world.run.identify)}が 錆びついた！`, 'bad');
  },

  trapRot: (world, a) => {
    if (!isPlayer(a)) return;
    const foods = a.inventory.filter((i) => getItem(i.defId).kind === 'food');
    if (foods.length === 0) {
      world.log('しかし 腐る物が 無かった。');
      return;
    }
    for (const f of foods) f.defId = 'rottenRiceBall';
    world.log('食料が 腐ってしまった！', 'bad');
  },

  trapAlarm: (world) => {
    world.log('けたたましい 音が 響いた！', 'bad');
    world.sfx('monsterHouse');
    for (const m of world.run.monsters) {
      m.asleep = false;
      m.lastSeen = { ...world.player.pos };
    }
  },

  trapSummon: (world, a) => {
    world.log('モンスターが 現れた！', 'bad');
    const factory = world.monsterFactory;
    if (!factory) return;
    // 真隣に 3 体まとめて湧かせると、逃げ道も殴り返す先も無くなる。
    // 少し離して 2 体までにして、「囲まれる前に動く」余地を残す
    let n = 0;
    const max = 2;
    for (let r = 2; r <= 4 && n < max; r++) {
      const ring: Point[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const q = { x: a.pos.x + dx, y: a.pos.y + dy };
          if (world.actorAt(q)) continue;
          if (at(world.map, q.x, q.y)?.kind !== 'floor') continue;
          ring.push(q);
        }
      }
      for (const q of world.rng.shuffled(ring)) {
        if (n >= max) break;
        if (factory(q)) n++;
      }
    }
    // どうしても離れた場所が無ければ、隣に 1 体だけ
    if (n === 0) {
      for (const q of neighbors8(world.map, a.pos)) {
        if (world.actorAt(q)) continue;
        if (at(world.map, q.x, q.y)?.kind !== 'floor') continue;
        if (factory(q)) break;
      }
    }
  },

  trapWarp: (world, a) => {
    const spot = randomWarpSpot(world);
    if (!spot) return;
    const from = { ...a.pos };
    a.pos = spot;
    world.log(`${world.nameOf(a)}は どこかへ 飛ばされた！`, 'bad');
    world.emit({ t: 'warp', actorId: a.id, from, to: { ...spot } });
    world.sfx('warp');
  },

  trapSpin: (world, a) => {
    a.dir = world.rng.int(8) as Dir;
    world.log('回転板だ！ ぐるぐる 回った。', 'bad');
    if (!isPlayer(a)) return;
    const pool = losableItems(a);
    if (pool.length === 0) return;
    const n = Math.min(pool.length, world.rng.range(1, 3));
    // 足元に落とすと、拾いに戻るたびにまた作動して一生回収できない。
    // 通路のように迂回できない場所だと完全に詰むので、周りへ散らす
    const around = world.rng.shuffled(
      neighbors8(world.map, a.pos).filter((q) => at(world.map, q.x, q.y)?.kind === 'floor'),
    );
    let k = 0;
    for (const item of world.rng.sample(pool, n)) {
      removeFromInventory(a, item.uid);
      const spot = around[k++ % Math.max(1, around.length)] ?? a.pos;
      world.dropItem(item, spot);
    }
    world.log('持ち物が 散らばった！', 'bad');
  },

  trapMine: (world, a) => {
    world.log('地雷が 爆発した！', 'bad');
    world.emit({ t: 'explosion', pos: { ...a.pos }, radius: 1 });
    world.sfx('explosion');
    if (isPlayer(a)) {
      const dmg = Math.max(1, Math.floor(a.hp / 2));
      dealDamage(world, null, a, dmg, 'fire');
    } else {
      dealDamage(world, null, a, a.maxHp, 'fire');
    }
    for (const p of neighbors8(world.map, a.pos)) {
      const victim = world.actorAt(p);
      if (victim && victim !== a && victim.kind !== 'player') {
        dealDamage(world, null, victim, victim.maxHp, 'fire');
      }
    }
  },

  trapBigMine: (world, a) => {
    world.log('大型地雷が 爆発した！', 'bad');
    world.emit({ t: 'explosion', pos: { ...a.pos }, radius: 2 });
    world.sfx('explosion');
    if (isPlayer(a)) {
      dealDamage(world, null, a, Math.max(1, Math.floor(a.hp / 2)), 'fire');
      // 持ち物がいくつか焼ける
      const pool = losableItems(a);
      const n = Math.min(pool.length, world.rng.range(1, 3));
      for (const item of world.rng.sample(pool, n)) {
        removeFromInventory(a, item.uid);
        world.log(`${itemName(item, world.run.identify)}が 燃えてしまった！`, 'bad');
      }
    }
    for (const victim of world.livingActors()) {
      if (victim === a || victim.kind === 'player') continue;
      if (chebyshev(victim.pos, a.pos) > 2) continue;
      dealDamage(world, null, victim, victim.maxHp, 'fire');
    }
  },

  trapSlow: (world, a) => {
    world.log('体が 重くなった！', 'bad');
    applyStatus(world, a, 'slow');
  },

  trapWeaken: (world, a) => {
    if (!isPlayer(a)) return;
    world.log('石像から ビームが 放たれた！', 'bad');
    if (a.maxStr > 1) {
      a.maxStr--;
      a.str = Math.min(a.str, a.maxStr);
      world.log('ちからの 最大値が 下がった！', 'bad');
      world.sfx('statDown');
    }
  },

  trapCurse: (world, a) => {
    if (!isPlayer(a)) return;
    const pool = a.inventory.filter((i) => !i.cursed);
    if (pool.length === 0) {
      world.log('しかし 何も 起こらなかった。');
      return;
    }
    const item = world.rng.pick(pool);
    item.cursed = true;
    world.log(`${itemName(item, world.run.identify)}が 呪われた！`, 'bad');
    world.sfx('curse');
  },

  trapHunger: (world, a) => {
    if (!isPlayer(a)) return;
    loseFood(world, a, 300);
    applyStatus(world, a, 'hungryFast');
  },

  trapSeal: (world, a) => {
    world.log('力が 封じられた！', 'bad');
    applyStatus(world, a, 'sealed');
    world.sfx('curse');
  },

  trapMonsterHouse: (world, a) => {
    if (!isPlayer(a)) return;
    const tile = at(world.map, a.pos.x, a.pos.y);
    if (!tile || tile.roomId < 0) return;
    const room = world.map.rooms.find((r) => r.id === tile.roomId);
    if (!room) return;
    room.monsterHouse = room.monsterHouse ?? 'normal';
    room.houseTriggered = false;
    world.pendingMonsterHouse = room;
  },

  trapItemLoss: (world, a) => {
    if (!isPlayer(a)) return;
    const pool = losableItems(a);
    if (pool.length === 0) {
      world.log('しかし 落とす物が 無かった。');
      return;
    }
    const n = Math.min(pool.length, world.rng.range(2, 4));
    const lost: ItemInstance[] = world.rng.sample(pool, n);
    for (const item of lost) {
      removeFromInventory(a, item.uid);
      world.dropItem(item, a.pos);
    }
    world.log('持ち物を 落としてしまった！', 'bad');
  },

  trapLava: (world, a) => {
    world.log('足元から 火が 噴き出した！', 'bad');
    world.sfx('explosion');
    dealDamage(world, null, a, Math.max(3, Math.floor(a.maxHp * 0.12)), 'fire');
    applyStatus(world, a, 'burning');
  },

  trapWater: (world, a) => {
    world.log('水を 浴びてしまった！', 'bad');
    world.sfx('splash');
    applyStatus(world, a, 'wet');
  },
};

/** ワナの効果を適用する。未知の effect は黙って無視する */
export function applyTrapEffect(world: World, a: Actor, trapId: string): void {
  const handler = TRAP_EFFECTS[getTrap(trapId).effect];
  if (handler) handler(world, a);
}
