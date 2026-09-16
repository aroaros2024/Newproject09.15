import { startRun } from './src/game/run.js';
import { makeMonster } from './src/dungeon/spawn.js';
import { takeMonsterTurn, AiContext } from './src/game/monsterAI.js';
import { makeItem } from './src/game/inventory.js';

const town = {
  playerName: 'テスト', storage: [], bankGitan: 0, gitan: 0,
  cleared: [], unlocked: ['d2'], bestDepth: {},
  seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  encountered: { monsters: [], items: [] },
};

// --- ミミック: 化けたまま特技を使う（正体が割れない）
{
  const w = startRun('d2', town, { seed: 21 });
  w.drainEvents();
  for (let i = 0; i < 6; i++) w.player.inventory.push(makeItem('healHerb', w.rng, {}, () => w.nextUid()));
  const mimic = makeMonster(w, 'mimicScroll', { x: w.player.pos.x + 3, y: w.player.pos.y });
  mimic.asleep = false;
  w.addMonster(mimic);
  console.log('[mimic] disguise:', mimic.disguise?.defId, 'uid', mimic.disguise?.uid);
  const ctx = new AiContext(w);
  for (let i = 0; i < 6; i++) takeMonsterTurn(w, mimic, ctx);
  console.log('[mimic] messages:', w.drainEvents().filter(e=>e.t==='message').map(e=>e.text));
  console.log('[mimic] still disguised as an item?', mimic.disguise !== null, '/ pos', JSON.stringify(mimic.pos), 'player', JSON.stringify(w.player.pos));
}

// --- ミミックを化けたまま倒すと、化けていたアイテムはどこへも出ない
{
  const w = startRun('d2', town, { seed: 22 });
  w.drainEvents();
  const mimic = makeMonster(w, 'mimicPot', { x: w.player.pos.x + 2, y: w.player.pos.y });
  w.addMonster(mimic);
  const uid = mimic.disguise?.uid;
  const floorBefore = w.run.floorItems.length;
  const { dealDamage } = await import('./src/game/combat.js');
  dealDamage(w, w.player, mimic, 9999, 'physical');
  w.drainEvents();
  console.log('[mimic-kill] disguise uid', uid, '-> floorItems', floorBefore, '->', w.run.floorItems.length,
    '/ contains disguise:', w.run.floorItems.some((f) => f.item.uid === uid));
}

// --- 盗む敵は、逃げずに毎ターン盗み続ける
{
  const w = startRun('d2', town, { seed: 23 });
  w.drainEvents();
  for (let i = 0; i < 8; i++) w.player.inventory.push(makeItem('healHerb', w.rng, {}, () => w.nextUid()));
  const thief = makeMonster(w, 'batThief', { x: w.player.pos.x + 1, y: w.player.pos.y });
  thief.asleep = false;
  w.addMonster(thief);
  const ctx = new AiContext(w);
  const start = { ...thief.pos };
  for (let i = 0; i < 6; i++) takeMonsterTurn(w, thief, ctx);
  console.log('[thief] held', thief.heldItems.length, 'moved?', JSON.stringify(start), '->', JSON.stringify(thief.pos));
  console.log('[thief] msgs:', w.drainEvents().filter(e=>e.t==='message').map(e=>e.text));
}
