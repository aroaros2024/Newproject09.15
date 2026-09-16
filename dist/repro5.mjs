import { startRun, enterFloor } from './src/game/run.js';
import { stepTurn } from './src/game/turn.js';
import { devolveMonster } from './src/game/monsterSkills.js';
import { makeMonster } from './src/dungeon/spawn.js';
import { takeMonsterTurn, AiContext } from './src/game/monsterAI.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d2','d4'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  encountered: { monsters: [], items: [] },
};

// --- A) レベルダウンの杖 を ボス に当てると ボスが消える → 階段が永久に開かない
{
  const w = startRun('d2', town, { seed: 4242 });
  enterFloor(w, 10); w.drainEvents();
  const boss = w.run.monsters.find((m) => w.defOf(m).isBoss);
  console.log('[A] boss before:', boss.defId, 'alive', boss.alive);
  devolveMonster(w, boss);
  console.log('[A] log:', w.drainEvents().filter(e=>e.t==='message').map(e=>e.text));
  console.log('[A] boss alive:', boss.alive, '/ bosses on floor:', w.run.monsters.filter(m=>w.defOf(m).isBoss).length);
  console.log('[A] defeatedBosses:', JSON.stringify(w.run.defeatedBosses), 'bossesCleared:', w.bossesCleared());
  w.player.pos = { ...w.map.stairs };
  console.log('[A] stairs:', JSON.stringify(stepTurn(w, { type: 'stairs' })));
}

// --- B) 身代わりの杖: 他の敵は decoy を殴れない（空振りログだけ）
{
  const w = startRun('d2', town, { seed: 777 });
  w.drainEvents();
  w.player.hp = 9999; w.player.maxHp = 9999;
  const decoy = makeMonster(w, 'slimeBlue', { x: w.player.pos.x + 3, y: w.player.pos.y });
  const attacker = makeMonster(w, 'slimeBlue', { x: w.player.pos.x + 4, y: w.player.pos.y });
  decoy.asleep = false; attacker.asleep = false;
  w.addMonster(decoy); w.addMonster(attacker);
  w.decoyId = decoy.id;
  const hp0 = decoy.hp;
  const ctx = new AiContext(w);
  for (let i = 0; i < 10; i++) takeMonsterTurn(w, attacker, ctx);
  console.log('[B] decoy hp', hp0, '->', decoy.hp);
  console.log('[B] messages:', w.drainEvents().filter(e=>e.t==='message').map(e=>e.text).slice(0,4));
}
