import { startRun, enterFloor } from './src/game/run.js';
import { triggerMonsterHouse } from './src/dungeon/spawn.js';
import { roomCells } from './src/dungeon/tilemap.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d1','d2','d3','d4'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  encountered: { monsters: [], items: [] },
};

let worst = 0, worstInfo = null, houses = 0;
const buckets = {};
for (const id of ['d2','d3','d4','ex']) {
  let maxMon = 0;
  for (let s = 0; s < 25; s++) {
    const w = startRun(id, town, { seed: 50000 + s });
    maxMon = w.dungeon.gen.maxMonsters;
    const maxD = Math.min(w.dungeon.depth, 30);
    for (let depth = 1; depth <= maxD; depth++) {
      enterFloor(w, depth); w.drainEvents();
      const room = w.map.rooms.find((r) => r.monsterHouse && !r.houseTriggered);
      if (!room) continue;
      houses++;
      const before = w.run.monsters.length;
      triggerMonsterHouse(w, room);
      w.drainEvents();
      const added = w.run.monsters.length - before;
      const b = Math.floor(added / 20) * 20;
      buckets[b] = (buckets[b] ?? 0) + 1;
      if (added > worst) {
        worst = added;
        worstInfo = { id, depth, kind: room.monsterHouse, cells: roomCells(room).length,
                      bigRoom: w.map.bigRoom, total: w.run.monsters.length, maxMonsters: maxMon };
      }
    }
  }
}
console.log('houses triggered:', houses);
console.log('added-monsters histogram (bucket of 20):', buckets);
console.log('worst case:', worst, JSON.stringify(worstInfo));
