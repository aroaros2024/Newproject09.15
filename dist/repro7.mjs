import { startRun } from './src/game/run.js';
import { stepTurn } from './src/game/turn.js';
import { at } from './src/dungeon/tilemap.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d3'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  encountered: { monsters: [], items: [] },
};

let hits = 0, descents = 0;
for (let s = 0; s < 120; s++) {
  const w = startRun('d3', town, { seed: 30000 + s });
  w.drainEvents();
  w.player.hp = 99999; w.player.maxHp = 99999;
  for (let i = 0; i < 14 && !w.finished; i++) {
    w.player.pos = { ...w.map.stairs };
    w.drainEvents();
    const before = w.run.depth;
    stepTurn(w, { type: 'stairs' });
    if (w.run.depth === before) break;
    descents++;
    const msgs = w.drainEvents().filter((e) => e.t === 'message').map((e) => e.text);
    const trapMsg = msgs.find((t) => t.endsWith('のワナだ！') || t.includes('ワナだ！'));
    if (trapMsg) {
      hits++;
      if (hits <= 5) {
        console.log(`seed=${30000 + s} -> ${w.run.depth}F 到着直後: ${trapMsg}`);
        console.log('   ', msgs.slice(0, 8).join(' / '));
      }
    }
  }
}
console.log(`descents=${descents}, 到着した瞬間にワナが作動: ${hits} (${(hits/descents*100).toFixed(2)}%)`);
