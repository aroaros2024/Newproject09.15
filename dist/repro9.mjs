import { startRun, enterFloor } from './src/game/run.js';
import { triggerMonsterHouse } from './src/dungeon/spawn.js';
import { stepTurn } from './src/game/turn.js';
import { roomCells } from './src/dungeon/tilemap.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['ex'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  encountered: { monsters: [], items: [] },
};
outer:
for (let s = 0; s < 40; s++) {
  const w = startRun('ex', town, { seed: 50000 + s });
  for (let depth = 1; depth <= 30; depth++) {
    enterFloor(w, depth); w.drainEvents();
    const room = w.map.rooms.find((r) => r.monsterHouse && !r.houseTriggered);
    if (!room || roomCells(room).length < 400) continue;
    console.log(`seed=${50000+s} ${depth}F bigRoom=${w.map.bigRoom} kind=${room.monsterHouse} cells=${roomCells(room).length}`);
    const before = w.run.monsters.length;
    triggerMonsterHouse(w, room); w.drainEvents();
    console.log('monsters on floor:', w.run.monsters.length, '(before', before, ', gen.maxMonsters =', w.dungeon.gen.maxMonsters, ')');
    w.player.hp = 1e9; w.player.maxHp = 1e9;
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) { stepTurn(w, { type: 'wait' }); w.drainEvents(); }
    const dt = Date.now() - t0;
    console.log('3 turns took', dt, 'ms ->', (dt / 3).toFixed(0), 'ms/turn');
    break outer;
  }
}
