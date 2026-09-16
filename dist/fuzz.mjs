import { Rng } from './src/core/rng.js';
import { startRun } from './src/game/run.js';
import { stepTurn } from './src/game/turn.js';
import { DIRS } from './src/core/geom.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d1','d2','d3','d4','dl','ex'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  encountered: { monsters: [], items: [] },
};

let errors = 0;
const seen = new Set();
for (const id of ['d1','d2','d3','d4','dl','ex']) {
  for (let s = 0; s < 40; s++) {
    let w;
    try { w = startRun(id, town, { seed: 900000 + s * 13 }); } catch (e) { console.log('start', id, e.message); errors++; continue; }
    w.player.maxHp = 5000; w.player.hp = 5000;
    const rng = new Rng(s + 1);
    for (let i = 0; i < 1500 && !w.finished; i++) {
      const r = rng.int(100);
      let act;
      if (r < 50) act = { type: 'move', dir: rng.pick(DIRS) };
      else if (r < 60) act = { type: 'attack', dir: rng.pick(DIRS) };
      else if (r < 66) act = { type: 'wait' };
      else if (r < 72) act = { type: 'pickup' };
      else if (r < 78) act = { type: 'stairs' };
      else if (r < 90) {
        const inv = w.player.inventory;
        if (inv.length === 0) act = { type: 'wait' };
        else act = { type: 'use', uid: rng.pick(inv).uid, dir: rng.pick(DIRS) };
      } else {
        const inv = w.player.inventory;
        if (inv.length === 0) act = { type: 'wait' };
        else act = { type: 'throw', uid: rng.pick(inv).uid, dir: rng.pick(DIRS) };
      }
      try {
        stepTurn(w, act);
        w.drainEvents();
        if (w.player.hp > 0) w.player.hp = Math.max(w.player.hp, 2000);
        w.player.foodX10 = 5000;
      } catch (e) {
        const key = e.stack.split('\n').slice(0, 3).join('|');
        if (!seen.has(key)) { seen.add(key); console.log('=== ', id, 'seed', 900000 + s*13, 'turn', i, '\n', e.stack.split('\n').slice(0,6).join('\n')); }
        errors++;
        break;
      }
    }
  }
}
console.log('errors:', errors, 'distinct:', seen.size);
