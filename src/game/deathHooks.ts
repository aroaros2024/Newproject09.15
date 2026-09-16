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
  // 取り巻きは主と一緒に消える。
  // 第 1 形態で削られ切ったところへ、取り巻きごと第 2 形態が重なると、
  // 「立て直す」という選択肢そのものが無くなってしまう
  for (const other of [...world.run.monsters]) {
    if (other === m || world.defOf(other).isBoss) continue;
    world.emit({ t: 'warp', actorId: other.id, from: { ...other.pos }, to: { ...other.pos } });
    world.removeActor(other);
  }

  const spot = world.findDropSpot(m.pos, 4) ?? m.pos;
  const boss = world.spawnAt?.(next.monsterId, spot);
  if (!boss) return;
  world.log('取り巻きが 霧のように 消えていく。', 'system');
  world.log('しかし 相手は まだ 倒れていなかった！', 'bad');
  world.emit({ t: 'bossAppear', actorId: boss.id });
  world.sfx('bossAppear');
}
