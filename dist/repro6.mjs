import { startRun, enterFloor } from './src/game/run.js';
import { at } from './src/dungeon/tilemap.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d1','d2','d3','d4'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  encountered: { monsters: [], items: [] },
};

let onTrap = 0, floors = 0;
const kinds = {};
for (const id of ['d2','d3','d4']) {
  for (let s = 0; s < 40; s++) {
    const w = startRun(id, town, { seed: 7000 + s });
    const maxD = w.dungeon.depth;
    for (let depth = 1; depth <= maxD; depth++) {
      enterFloor(w, depth); w.drainEvents();
      floors++;
      const t = at(w.map, w.player.pos.x, w.player.pos.y);
      if (t?.trap) { onTrap++; kinds[t.trap.defId] = (kinds[t.trap.defId] ?? 0) + 1; }
    }
  }
}
console.log(`floors=${floors} player started ON a trap tile: ${onTrap} (${(onTrap/floors*100).toFixed(2)}%)`);
console.log(kinds);
