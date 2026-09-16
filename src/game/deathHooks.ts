/**
 * モンスターが倒れた瞬間に走る処理。
 *
 * killActor() は倒した相手をその場でフロアから取り除くので、
 * 「あとで turn.ts がまとめて面倒を見る」という作りにすると、
 * 取り除かれた相手には二度と手が届かない。
 * 爆発もボスの撃破記録も、倒れたその瞬間にここで済ませる。
 */

import { explodeOnDeath } from './monsterSkills.js';
import type { MonsterActor } from '../core/types.js';
import type { World } from './world.js';

/**
 * 倒れたモンスター 1 体ぶんの後始末。
 * killActor() から、フロアから取り除く直前に呼ばれる。
 */
export function onMonsterDefeated(world: World, m: MonsterActor): void {
  if (world.defOf(m).skills.includes('explodeOnDeath')) explodeOnDeath(world, m);
  if (world.defOf(m).isBoss) recordBossDefeat(world, m);
}

/**
 * ボスを倒したときの記録と、次の形態の出現。
 * 同じボスを二度数えないよう、何度呼ばれても結果が変わらないようにしてある。
 */
export function recordBossDefeat(world: World, m: MonsterActor): void {
  if (world.run.defeatedBosses.includes(m.defId)) return;
  world.run.defeatedBosses.push(m.defId);

  const here = world.bossesHere();
  const idx = here.findIndex((b) => b.monsterId === m.defId);
  const next = idx >= 0 ? here[idx + 1] : undefined;
  if (!next) {
    if (here.length > 0) {
      world.log('あたりの 気配が 静まった。階段が 開いている。', 'good');
      world.sfx('fanfare');
    }
    return;
  }
  const spot = world.findDropSpot(m.pos, 4) ?? m.pos;
  const boss = world.spawnAt?.(next.monsterId, spot);
  if (!boss) return;
  world.log('しかし 相手は まだ 倒れていなかった！', 'bad');
  world.emit({ t: 'bossAppear', actorId: boss.id });
  world.sfx('bossAppear');
}
