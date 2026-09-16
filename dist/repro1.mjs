import { startRun } from './src/game/run.js';
import { stepTurn } from './src/game/turn.js';
import { makeMonster } from './src/dungeon/spawn.js';
import { dealDamage } from './src/game/combat.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d2'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
};

// d5 = 天輪の塔? find dungeon with two-form boss
import { getDungeon } from './src/data/registry.js';
const d = ['d1','d2','d3','d4','d5','ex'].map((id)=>{try{return getDungeon(id);}catch(e){return null;}}).filter(Boolean);
for (const dd of d) console.log(dd.id, dd.name, dd.depth, JSON.stringify(dd.bosses));
