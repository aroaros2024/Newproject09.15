import { startRun, enterFloor } from './src/game/run.js';
import { stepTurn } from './src/game/turn.js';
import { makeMonster } from './src/dungeon/spawn.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d2'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
};

// --- 1) boss floor: stairs blocked after the boss dies
const world = startRun('d2', town, { seed: 12345 });
enterFloor(world, 10);
world.drainEvents();
const boss = world.run.monsters.find((m) => m.defId === 'bossForest');
world.player.hp = 9999; world.player.maxHp = 9999;
for (let i = 0; i < 60 && boss.alive; i++) {
  boss.pos = { x: world.player.pos.x + 1, y: world.player.pos.y };
  boss.asleep = false; boss.hp = 1;
  stepTurn(world, { type: 'attack', dir: 2 });
  world.drainEvents();
}
world.player.pos = { ...world.map.stairs };
const r = stepTurn(world, { type: 'stairs' });
console.log('after killing the boss -> stairs:', JSON.stringify(r), 'depth still', world.run.depth, 'finished', world.finished);
console.log(world.drainEvents().filter(e=>e.t==='message').map(e=>e.text));

// --- 2) explodeOnDeath never fires when killed by a normal attack
const w2 = startRun('d2', town, { seed: 999 });
w2.drainEvents();
w2.player.hp = 9999; w2.player.maxHp = 9999;
const bomb = makeMonster(w2, 'bombSlime', { x: w2.player.pos.x + 1, y: w2.player.pos.y });
console.log('bomb def skills:', JSON.stringify(w2.defOf(bomb).skills));
w2.addMonster(bomb);
bomb.asleep = false;
for (let i = 0; i < 80 && bomb.alive; i++) {
  bomb.pos = { x: w2.player.pos.x + 1, y: w2.player.pos.y };
  bomb.hp = 1;
  stepTurn(w2, { type: 'attack', dir: 2 });
  const msgs = w2.drainEvents().filter((e) => e.t === 'message').map((e) => e.text);
  if (!bomb.alive) console.log('death turn messages:', msgs);
}
console.log('bomb alive:', bomb.alive);
