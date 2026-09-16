import { startRun, enterFloor } from './src/game/run.js';
import { stepTurn } from './src/game/turn.js';
import { dirTo } from './src/core/geom.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d2'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
};

const world = startRun('d2', town, { seed: 12345 });
enterFloor(world, 10);
world.drainEvents();
const boss = world.run.monsters.find((m) => m.defId === 'bossForest');
console.log('boss found:', !!boss, boss && boss.hp);
// put the boss next to the player
boss.pos = { x: world.player.pos.x + 1, y: world.player.pos.y };
boss.asleep = false;
world.player.hp = 9999; world.player.maxHp = 9999;
for (let i = 0; i < 60; i++) {
  if (!boss.alive) break;
  boss.pos = { x: world.player.pos.x + 1, y: world.player.pos.y };
  boss.hp = 1;
  stepTurn(world, { type: 'attack', dir: 2 });
  world.drainEvents();
}
console.log('boss.alive =', boss.alive);
console.log('defeatedBosses =', JSON.stringify(world.run.defeatedBosses));
console.log('bossesCleared() =', world.bossesCleared());
console.log('still in monsters list =', world.run.monsters.includes(boss));
