/**
 * 増える特技と、増えたぶんの攻撃力。
 *
 * 始まりの洞窟では、1 体ぶんの攻撃力が増えた数だけ複製されていたので、
 * Lv1・HP15 が 4 体に囲まれた時点で 1 ターンで死んでいた。
 * 数が増えること自体は残し、力のほうを分ける。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TownState } from '../src/core/types.js';
import { startRun } from '../src/game/run.js';
import { MONSTER_SKILLS } from '../src/game/monsterSkills.js';
import { makeMonster } from '../src/dungeon/spawn.js';
import { getDungeon } from '../src/data/registry.js';
import type { World } from '../src/game/world.js';

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1', 'd2'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}

/** プレイヤーの隣に 1 体置いて、その特技を使わせる */
function useSkill(world: World, defId: string, skill: string): {
  parent: number; child: number;
} {
  const p = world.player;
  const spot = { x: p.pos.x + 1, y: p.pos.y };
  const m = makeMonster(world, defId, spot);
  world.addMonster(m);
  const before = world.run.monsters.length;
  const ok = MONSTER_SKILLS[skill](world, m, p);
  assert.ok(ok, `${skill} が使えなかった`);
  assert.equal(world.run.monsters.length, before + 1, '増えていない');
  const child = world.run.monsters[world.run.monsters.length - 1];
  return { parent: m.atk, child: child.atk };
}

test('始まりの洞窟では、分裂すると親子の攻撃力が半分になる', () => {
  const world = startRun('d1', newTown(), { seed: 1, bring: [] });
  const base = world.defOf(makeMonster(world, 'slimeBlue', world.player.pos)).atk;
  const { parent, child } = useSkill(world, 'slimeBlue', 'split');
  assert.equal(parent, Math.floor(base / 2), '親の攻撃力が減っていない');
  assert.equal(child, Math.floor(base / 2), '子の攻撃力が減っていない');
});

test('増殖も同じように分かれる', () => {
  const world = startRun('d1', newTown(), { seed: 2, bring: [] });
  const base = world.defOf(makeMonster(world, 'mushSpore', world.player.pos)).atk;
  const { parent, child } = useSkill(world, 'mushSpore', 'multiply');
  assert.equal(parent, Math.floor(base / 2));
  assert.equal(child, Math.floor(base / 2));
});

test('せせらぎの森から先は、攻撃力が据え置き', () => {
  const world = startRun('d2', newTown(), { seed: 3, bring: [] });
  const base = world.defOf(makeMonster(world, 'slimeBlue', world.player.pos)).atk;
  const { parent, child } = useSkill(world, 'slimeBlue', 'split');
  assert.equal(parent, base, '止めすぎている');
  assert.equal(child, base, '止めすぎている');
});

test('何度分裂しても攻撃力は 1 を下回らない', () => {
  const world = startRun('d1', newTown(), { seed: 4, bring: [] });
  const p = world.player;
  const m = makeMonster(world, 'slimeBlue', { x: p.pos.x + 1, y: p.pos.y });
  world.addMonster(m);
  for (let i = 0; i < 10; i++) MONSTER_SKILLS.split(world, m, p);
  for (const x of world.run.monsters) {
    assert.ok(x.atk >= 1, `攻撃力が ${x.atk} になっている`);
  }
});

test('分裂で増えても、攻撃力の合計はほとんど増えない', () => {
  const world = startRun('d1', newTown(), { seed: 5, bring: [] });
  const p = world.player;
  const m = makeMonster(world, 'slimeBlue', { x: p.pos.x + 1, y: p.pos.y });
  world.addMonster(m);
  // フロアには自然に湧いた敵も居るので、合計はその全部で見る
  const total = (): number => world.run.monsters.reduce((a, x) => a + x.atk, 0);
  const before = total();
  const countBefore = world.run.monsters.length;
  for (let i = 0; i < 20; i++) {
    const target = world.rng.pick(world.run.monsters);
    MONSTER_SKILLS.split(world, target, p);
  }
  const added = world.run.monsters.length - countBefore;
  assert.ok(added > 0, '1 体も増えていない');
  // 力は分かれるだけなので、増えるのは「1 未満に落とせない」ぶんだけ。
  // 直す前は 1 体 6 が 14 体ぶん（84）まで膨らんでいた
  assert.ok(total() <= before + added,
    `合計が ${before} から ${total()} に増えている（増えた敵 ${added} 体）`);
});

test('始まりの洞窟だけが攻撃力を分ける', () => {
  assert.equal(getDungeon('d1').splitWeakens, true);
  for (const id of ['d2', 'd3', 'd4', 'dl', 'ex', 'exBring', 'exPure']) {
    assert.ok(!getDungeon(id).splitWeakens, `${id} まで止めている`);
  }
});
