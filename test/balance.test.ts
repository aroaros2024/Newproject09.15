import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allDungeons, allMonsters, getItem, getMonster } from '../src/data/registry.js';
import type { TownState } from '../src/core/types.js';
import { enterFloor, startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}
import { expectedDamage, hpGainForLevel } from '../src/game/rules.js';

/**
 * バランスの回帰テスト。
 *
 * ダメージ式が floor(ATK × (15/16)^DEF × …) なので、DEF を素直に伸ばすと
 * 与ダメージが指数的に潰れて「何百発殴っても倒せない敵」が簡単にできてしまう。
 * 実際、最初に組んだ時はボス 6 体すべてが討伐不可能だった。
 * ここでは「そのダンジョンを普通に攻略してきた人」の装備を仮定して、
 * 必要打数と耐久ターン数が想定内に収まっているかを見張る。
 */

/** そのダンジョンのボス戦に辿り着いた人の、控えめな想定装備 */
interface Build {
  lv: number;
  str: number;
  weapon: [string, number];
  shield: [string, number];
}

const BUILDS: Record<string, Build> = {
  d1: { lv: 5,  str: 8,  weapon: ['woodStick', 0],  shield: ['woodShield', 0] },
  d2: { lv: 12, str: 9,  weapon: ['ironSword', 3],  shield: ['ironShield', 3] },
  d3: { lv: 20, str: 11, weapon: ['warHammer', 5],  shield: ['stoneShield', 5] },
  d4: { lv: 28, str: 13, weapon: ['twinAxe', 7],    shield: ['heavyShield', 6] },
  dl: { lv: 38, str: 15, weapon: ['greatSword', 9], shield: ['dragonScale', 8] },
  ex: { lv: 55, str: 20, weapon: ['tenrinSword', 14], shield: ['tenrinShield', 12] },
  // 真・もっと不思議は中身が ex と同じ（違うのは加護が効かないことだけ）
  exPure: { lv: 55, str: 20, weapon: ['tenrinSword', 14], shield: ['tenrinShield', 12] },
};

function power(id: string, plus: number): number {
  const d = getItem(id);
  if (d.kind === 'weapon') return d.atk + plus;
  if (d.kind === 'shield') return d.def + plus;
  throw new Error(`${id} は武器でも盾でもない`);
}

function maxHpAt(lv: number): number {
  let hp = 15;
  for (let l = 2; l <= lv; l++) hp += hpGainForLevel(l);
  return hp;
}

/** 乱数の期待値でのダメージ */
const typicalDamage = (atk: number, def: number): number => expectedDamage(atk, def);

test('ボスは想定装備で殴り切れる', () => {
  for (const d of allDungeons()) {
    const b = BUILDS[d.id];
    assert.ok(b, `${d.id} の想定装備が無い`);
    const atk = b.str + power(b.weapon[0], b.weapon[1]);
    for (const entry of d.bosses) {
      const m = getMonster(entry.monsterId);
      const dmg = typicalDamage(atk, m.def);
      // 自己回復を持つボスは、その分だけ実質 HP が増える
      const heals = m.skills.includes('healSelf') ? 3 : 0;
      const effectiveHp = m.hp + heals * Math.floor(m.hp * 0.3);
      const hits = Math.ceil(effectiveHp / dmg);
      assert.ok(
        hits <= 40,
        `${d.id} の ${m.name} は想定装備(攻撃力 ${atk})で ${hits} 発必要。硬すぎる`,
      );
      assert.ok(
        hits >= 6,
        `${d.id} の ${m.name} は想定装備(攻撃力 ${atk})で ${hits} 発で沈む。柔らかすぎる`,
      );
    }
  }
});

test('ボスに殴り殺されるまでに、立て直す余地がある', () => {
  for (const d of allDungeons()) {
    const b = BUILDS[d.id];
    const pdef = power(b.shield[0], b.shield[1]);
    const php = maxHpAt(b.lv);
    for (const entry of d.bosses) {
      const m = getMonster(entry.monsterId);
      const acts = m.speed === 'double' ? 2 : 1;
      const perTurn = typicalDamage(m.atk, pdef) * acts;
      const turns = php / perTurn;
      assert.ok(
        turns >= 3,
        `${d.id} の ${m.name} は想定装備(守り ${pdef}/HP ${php})を ${turns.toFixed(1)} ターンで倒す。即死すぎる`,
      );
      assert.ok(
        turns <= 30,
        `${d.id} の ${m.name} は想定装備(守り ${pdef}/HP ${php})相手に ${turns.toFixed(1)} ターンかかる。緊張感が無い`,
      );
    }
  }
});

test('雑魚は想定装備で 10 発以内に倒せる', () => {
  // メタル系は「硬い代わりに経験値が高い」役なので、この検査からは外す
  const METAL = new Set(['metalBug', 'metalKing']);
  const byId = new Map(allMonsters().map((m) => [m.id, m]));
  for (const d of allDungeons()) {
    const b = BUILDS[d.id];
    const atk = b.str + power(b.weapon[0], b.weapon[1]);
    for (const e of d.monsters) {
      const m = byId.get(e.id);
      if (!m || m.isBoss || METAL.has(m.id)) continue;
      const hits = Math.ceil(m.hp / typicalDamage(atk, m.def));
      assert.ok(
        hits <= 10,
        `${d.id} ${e.from}F の ${m.name} は想定装備(攻撃力 ${atk})で ${hits} 発必要`,
      );
    }
  }
});

test('自己回復を持つ敵は、無限に立て直せない', () => {
  // 回数制限が無いと、倍速 + 高確率で回復する敵が事実上の不死身になる
  const src = allMonsters().filter((m) => m.skills.includes('healSelf'));
  assert.ok(src.length > 0, '自己回復を持つ敵がいない');
  for (const m of src) {
    // 上限 3 回 × 最大 HP の 30% ＝ 実質 HP は 1.9 倍まで
    assert.ok(m.hp * 1.9 < 1200, `${m.name} は回復込みで実質 ${Math.floor(m.hp * 1.9)} HP もある`);
  }
});

test('ボスの階は「ボスと戦う階」になっている', () => {
  // モンスターハウスが重なると、勝ち負けが運だけになってボス戦が成立しない
  for (const d of allDungeons()) {
    for (const b of d.bosses) {
      for (let seed = 0; seed < 30; seed++) {
        const world = startRun(d.id, newTown(), { seed: 5000 + seed });
        enterFloor(world, b.depth);
        world.drainEvents();
        assert.equal(
          world.map.rooms.some((r) => r.monsterHouse !== null), false,
          `${d.id} ${b.depth}F seed${seed}: ボスの階にモンスターハウスがある`,
        );
        // 取り巻きは少数。ボスを含めて 6 体を超えない
        assert.ok(
          world.run.monsters.length <= 6,
          `${d.id} ${b.depth}F seed${seed}: ボスの階に ${world.run.monsters.length} 体いる`,
        );
        // 装備を奪う敵は、ボス戦の事故でしかない
        for (const m of world.run.monsters) {
          const def = world.defOf(m);
          if (def.isBoss) continue;
          assert.notEqual(def.ai, 'thief',
            `${d.id} ${b.depth}F seed${seed}: ボスの階に ${def.name}（盗み）がいる`);
        }
      }
    }
  }
});

test('倒せるボスが居なくなったら、階段は開く', () => {
  // 第 2 形態の出現に失敗するなどでボスが消えると、
  // 撃破が記録されないまま階段が永久に閉じて冒険が詰む
  const world = startRun('d2', newTown(), { seed: 4242 });
  enterFloor(world, 10);
  world.drainEvents();
  assert.equal(world.bossesCleared(), false, '最初からクリア扱いになっている');
  for (const m of [...world.run.monsters]) world.removeActor(m);
  stepTurn(world, { type: 'wait' });
  world.drainEvents();
  assert.equal(world.bossesCleared(), true, 'ボスが居なくなったのに階段が開かない');
});
