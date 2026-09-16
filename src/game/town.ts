/**
 * 風の村。冒険の前後の処理をまとめる。
 *
 *   倉庫   … 持ち物を預ける。死んでも失われない
 *   道具屋 … 買う／売る
 *   鍛冶屋 … 合成・強化・呪い解き
 *   食事処 … 満腹度の最大値を上げる弁当
 *   入口   … ダンジョンを選んで潜る
 */

import { Rng } from '../core/rng.js';
import type {
  AdventureRecord, DungeonDef, IdentifyState, ItemInstance, PlayerActor, TownState,
} from '../core/types.js';
import { ALL_ITEMS, allMonsters, getItem, getDungeon } from '../data/registry.js';
import { DUNGEON_ORDER } from '../data/dungeons.js';
import { keptItems, makeItem } from './inventory.js';
import { mergeInto } from './itemEffects.js';
import { losesItemsOnDeath } from './death.js';
import { BASE_KEEP_SLOTS, MAX_KEEP_SLOTS, SELL_RATE, stonesForRun } from './rules.js';
import type { World } from './world.js';

/** 倉庫に預けられる数 */
export const STORAGE_LIMIT = 80;

/** 鍛冶屋の料金 */
export const SMITH_PRICE = {
  /** 合成 1 回（素材 1 つにつき加算） */
  synthesisBase: 1000,
  synthesisPerMaterial: 500,
  /** 修正値 +1 あたり（今の修正値が高いほど高くなる） */
  temper: (plus: number): number => 1500 * Math.max(1, plus + 1),
  /** 呪い解き */
  uncurse: 500,
} as const;

/** 食事処の弁当 */
export const BENTOU_PRICE = 900;

/** ダンジョンに挑めるか */
export function canEnterDungeon(town: TownState, d: DungeonDef): boolean {
  if (!town.unlocked.includes(d.id)) return false;
  if (d.requires && !town.cleared.includes(d.requires)) return false;
  return true;
}

/** 村の一覧に出すダンジョン（未解放も「？？？」として並べる） */
export function dungeonList(town: TownState): Array<{
  def: DungeonDef; unlocked: boolean; cleared: boolean; best: number;
}> {
  return DUNGEON_ORDER.map((id) => {
    const def = getDungeon(id);
    return {
      def,
      unlocked: canEnterDungeon(town, def),
      cleared: town.cleared.includes(id),
      best: town.bestDepth[id] ?? 0,
    };
  });
}

/** ダンジョンをクリアしたときに次を解放する */
export function unlockNext(town: TownState, clearedId: string): string | null {
  const idx = DUNGEON_ORDER.indexOf(clearedId);
  if (idx < 0 || idx + 1 >= DUNGEON_ORDER.length) return null;
  const nextId = DUNGEON_ORDER[idx + 1];
  if (town.unlocked.includes(nextId)) return null;
  town.unlocked.push(nextId);
  return nextId;
}

// ---------------------------------------------------------------------------
// 倉庫
// ---------------------------------------------------------------------------

export const storageFull = (town: TownState): boolean => town.storage.length >= STORAGE_LIMIT;

/**
 * そのダンジョンで使える保持枠の数。
 *
 * 保持枠そのものが村の加護なので、加護の通じないダンジョン
 * （真・もっと不思議）では 0。何ひとつ守れない。
 *
 * 画面と帰還処理が別々に数えると「保持したはずなのに失う」が起きるので、
 * 数えるのはここ 1 箇所だけにする。
 */
export function keepSlotsFor(town: TownState, d: DungeonDef): number {
  if (d.allowBoosts === false) return 0;
  const n = town.keepSlots ?? BASE_KEEP_SLOTS;
  return Math.max(BASE_KEEP_SLOTS, Math.min(MAX_KEEP_SLOTS, n));
}

/**
 * 倉庫へ預ける。
 *
 * 冒険中の uid は startRun のたびに 1 から振り直されるので、持ち帰った物を
 * そのまま積むと村の uid とぶつかる（2 回目の冒険から必ず起きる）。
 * 倉庫の操作はすべて uid の先頭一致で対象を探すため、重複したまま置くと
 * 「売ったのに別の物が消える」「鍛えたのに別の物が強くなる」が起きる。
 * ここで村の採番に付け替えて、倉庫の中では必ず一意になるようにする。
 */
export function depositItem(town: TownState, item: ItemInstance): boolean {
  const def = getItem(item.defId);
  if (def.stackable) {
    const stack = town.storage.find((i) => i.defId === item.defId);
    if (stack) {
      stack.count += item.count;
      return true;
    }
  }
  if (storageFull(town)) return false;
  item.uid = town.nextUid++;
  for (const c of item.contents) c.uid = town.nextUid++;
  town.storage.push(item);
  return true;
}

/** 倉庫から出す */
export function withdrawItem(town: TownState, uid: number): ItemInstance | null {
  const i = town.storage.findIndex((it) => it.uid === uid);
  if (i < 0) return null;
  return town.storage.splice(i, 1)[0];
}

/** 倉庫のアイテムの並べ替え */
export function sortStorage(town: TownState): void {
  town.storage.sort((a, b) => {
    const ka = getItem(a.defId).kind;
    const kb = getItem(b.defId).kind;
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (a.defId !== b.defId) return a.defId < b.defId ? -1 : 1;
    return b.plus - a.plus;
  });
}

// ---------------------------------------------------------------------------
// 道具屋
// ---------------------------------------------------------------------------

/**
 * 村の道具屋の品揃え。
 *
 * 毎回同じ顔ぶれだと「今日は何が来ているか」という楽しみが無いので、
 * 覗くたびに引き直す。冒険の進み具合で良い品も混ざるようにしてある。
 */
export function shopStock(town: TownState): ItemInstance[] {
  const rng = new Rng(`town-shop:${town.totalRuns}:${town.nextUid}:${town.gitan}`);
  const pool = [
    'healHerb', 'healHerb', 'greatHerb', 'antidoteHerb', 'cureConfuse',
    'riceBall', 'riceBall', 'bigRiceBall',
    'identifyScroll', 'lightScroll', 'uncurseScroll', 'mapScroll',
    'woodStick', 'oakClub', 'bronzeSword', 'woodShield', 'leatherShield', 'bronzeShield',
    'storagePot', 'woodArrow', 'woodArrow', 'ironArrow', 'stone',
    'sleepHerb', 'strHerb', 'bigRiceBall', 'sleepScroll', 'confuseScroll',
    'smokeBall', 'shockStone', 'warpScroll', 'bindStaff', 'knockbackStaff',
  ].filter((id) => {
    try {
      getItem(id);
      return true;
    } catch {
      return false;
    }
  });
  // クリアが進むと良い品も並ぶ
  if (town.cleared.length >= 1) pool.push('ironSword', 'ironShield', 'sleepStaff');
  if (town.cleared.length >= 2) pool.push('steelSword', 'steelShield', 'greatIdentify');
  if (town.cleared.length >= 3) pool.push('synthesisPot', 'blessWeapon', 'blessShield');
  if (town.cleared.length >= 4) pool.push('tenrinSword', 'tenrinShield');

  const picks = rng.sample(pool, Math.min(10, pool.length));
  return picks.map((id) => {
    const item = makeItem(id, rng, {}, () => town.nextUid++);
    item.plusKnown = true;
    // 村で買うものは識別済みで呪われていない
    item.cursed = false;
    item.shopPrice = getItem(id).price;
    return item;
  });
}

export function buyFromTown(town: TownState, item: ItemInstance): boolean {
  const price = item.shopPrice > 0 ? item.shopPrice : getItem(item.defId).price;
  if (town.gitan < price) return false;
  if (storageFull(town)) return false;
  town.gitan -= price;
  item.shopPrice = 0;
  // 名前を見て買ったのだから、ダンジョンでも名前のまま持ち込める
  learnItem(town, item.defId);
  return depositItem(town, item);
}

/** 村がその品目の名前を覚える */
export function learnItem(town: TownState, defId: string): void {
  if (!town.knownItems) town.knownItems = {};
  town.knownItems[defId] = true;
}

/**
 * 村の表示に使う識別状態。
 *
 * 仮名（alias）は持たないので、知らない物は「草？」のように
 * 種類だけが出る。村が勝手に本名を出すと、ダンジョンで未識別に
 * 戻った時に「さっきまで名前が出ていたのに」となる。
 */
export const townIdentify = (town: TownState): IdentifyState => ({
  alias: {},
  known: { ...(town.knownItems ?? {}) },
  nicknames: { ...(town.nicknames ?? {}) },
});

/**
 * 銀行。
 *
 * 持ち歩いているギタンは冒険に持ち込まれ、倒れれば失う。
 * 預けたぶんは残るので、「いくら持っていくか」が選べるようになる。
 * これが無いと、一度死んだだけで貯めた全額が消えて道具屋が意味を失う。
 */
export function depositGitan(town: TownState, amount: number): number {
  const n = Math.max(0, Math.min(Math.floor(amount), town.gitan));
  town.gitan -= n;
  town.bankGitan += n;
  return n;
}

export function withdrawGitan(town: TownState, amount: number): number {
  const n = Math.max(0, Math.min(Math.floor(amount), town.bankGitan));
  town.bankGitan -= n;
  town.gitan += n;
  return n;
}

export function sellToTown(town: TownState, uid: number): number {
  const item = withdrawItem(town, uid);
  if (!item) return 0;
  const price = Math.max(1, Math.floor(getItem(item.defId).price * SELL_RATE * (item.count || 1)));
  town.gitan += price;
  return price;
}

// ---------------------------------------------------------------------------
// 鍛冶屋
// ---------------------------------------------------------------------------

export function synthesisCost(materialCount: number): number {
  return SMITH_PRICE.synthesisBase + SMITH_PRICE.synthesisPerMaterial * materialCount;
}

/** 倉庫のアイテムを合成する */
export function smithSynthesize(
  world: World, town: TownState, baseUid: number, materialUids: number[],
): boolean {
  const cost = synthesisCost(materialUids.length);
  if (town.gitan < cost) return false;
  const base = town.storage.find((i) => i.uid === baseUid);
  if (!base) return false;
  const baseKind = getItem(base.defId).kind;
  if (baseKind !== 'weapon' && baseKind !== 'shield') return false;
  const materials: ItemInstance[] = [];
  for (const uid of materialUids) {
    const m = town.storage.find((i) => i.uid === uid);
    if (!m) return false;
    if (getItem(m.defId).kind !== baseKind) return false;
    materials.push(m);
  }
  town.gitan -= cost;
  for (const m of materials) {
    mergeInto(world, base, m);
    withdrawItem(town, m.uid);
  }
  return true;
}

/** 修正値を +1 する */
export function smithTemper(town: TownState, uid: number): boolean {
  const item = town.storage.find((i) => i.uid === uid);
  if (!item) return false;
  const cost = SMITH_PRICE.temper(item.plus);
  if (town.gitan < cost) return false;
  town.gitan -= cost;
  item.plus++;
  item.plusKnown = true;
  return true;
}

/** 呪いを解く */
export function smithUncurse(town: TownState, uid: number): boolean {
  const item = town.storage.find((i) => i.uid === uid);
  if (!item || !item.cursed) return false;
  if (town.gitan < SMITH_PRICE.uncurse) return false;
  town.gitan -= SMITH_PRICE.uncurse;
  item.cursed = false;
  return true;
}

// ---------------------------------------------------------------------------
// 冒険の終わり
// ---------------------------------------------------------------------------

export interface ReturnResult {
  record: AdventureRecord;
  /** 失った持ち物の数 */
  lost: number;
  /** 新しく解放されたダンジョン */
  unlocked: string | null;
  /** クリア報酬のメッセージ */
  rewardMessage: string | null;
  /** この冒険で手に入った石 */
  stones: number;
}

/**
 * 冒険が終わったときの精算。
 *
 * - クリア: 持ち帰ったものを倉庫へ入れ、報酬を受け取り、次のダンジョンを解放する
 * - 死亡  : 持ち物をすべて失う（始まりの洞窟だけは例外）
 * - 脱出  : 持ち帰ったものは残る
 */
export function finishRun(
  world: World, town: TownState, kind: 'clear' | 'death' | 'escape', cause: string,
): ReturnResult {
  const p = world.player;
  const d = world.dungeon;
  const keepItems = kind !== 'death' || !losesItemsOnDeath(d.id);

  let lost = 0;
  if (keepItems) {
    for (const item of collectCarried(p)) {
      item.shopPrice = 0;
      // 正体を知ったまま持ち帰った物は、村が名前を覚える。
      // 途中で倒れて失えば覚えないので、持ち帰る価値になる
      if (world.run.identify.known[item.defId]) learnItem(town, item.defId);
      if (!depositItem(town, item)) lost++;
    }
    town.gitan += p.gitan;
  } else {
    // 倒れて持ち物を失う時でも、保持枠に入れておいた物だけは届く。
    // 「何を守るか」を選ばせるための枠なので、ここが要
    const saved = keptItems(p).slice(0, keepSlotsFor(town, d));
    for (const item of saved) {
      item.shopPrice = 0;
      if (world.run.identify.known[item.defId]) learnItem(town, item.defId);
      if (!depositItem(town, item)) lost++;
    }
    lost += p.inventory.length - saved.length;
  }
  // 持ち込んだギタンは startRun で村から冒険へ「移した」ので、
  // ここで足し戻したあとは冒険側を空にしておく。
  // そうしないと finishRun を経るたびに所持ギタンが倍になる
  p.gitan = 0;

  // 倉庫の壺に入れた物は、死んでも届く
  for (const item of world.pendingWarehouse) {
    if (world.run.identify.known[item.defId]) learnItem(town, item.defId);
    if (!depositItem(town, item)) lost++;
  }
  world.pendingWarehouse = [];

  // 自分でつけた名前（「まちがえた」など）は、次の冒険にも持ち越す
  town.nicknames = { ...(town.nicknames ?? {}), ...world.run.identify.nicknames };

  // 石は倒れても貰える。ただし、初めて踏んだ階を満額にしてあるので、
  // 同じ階を往復するより 1 階でも深く潜る方が得になる
  const prevBest = town.bestDepth[d.id] ?? 0;
  const stones = stonesForRun({
    depth: world.run.stats.maxDepth,
    prevBest,
    dungeonDepth: d.depth,
    cleared: kind === 'clear',
    firstClear: kind === 'clear' && !town.cleared.includes(d.id),
  });
  town.stones = (town.stones ?? 0) + stones;

  town.bestDepth[d.id] = Math.max(prevBest, world.run.stats.maxDepth);
  town.totalRuns++;

  // 図鑑。出会った敵と、手にした／識別したアイテムを記録する
  recordSeen(
    town,
    [...world.run.encountered.items, ...Object.keys(world.run.identify.known)],
    world.run.encountered.monsters,
  );

  let unlocked: string | null = null;
  let rewardMessage: string | null = null;
  if (kind === 'clear') {
    if (!town.cleared.includes(d.id)) town.cleared.push(d.id);
    unlocked = unlockNext(town, d.id);
    if (d.reward.gitan) town.gitan += d.reward.gitan;
    if (d.reward.itemId) {
      const rng = new Rng(`reward:${d.id}:${town.totalRuns}`);
      const item = makeItem(d.reward.itemId, rng, { plusKnown: true }, () => town.nextUid++);
      depositItem(town, item);
    }
    rewardMessage = d.reward.message;
  }

  const record: AdventureRecord = {
    dungeonId: d.id,
    dungeonName: d.name,
    depth: world.run.stats.maxDepth,
    level: p.level,
    turns: world.run.totalTurn,
    gitan: p.gitan,
    cause: kind === 'clear' ? null : cause,
    cleared: kind === 'clear',
    at: 0,
  };
  town.history.push(record);
  if (town.history.length > 50) town.history.shift();

  return { record, lost, unlocked, rewardMessage, stones };
}

/** 持ち物と壺の中身をひとまとめにする */
function collectCarried(p: PlayerActor): ItemInstance[] {
  const out: ItemInstance[] = [];
  for (const item of p.inventory) {
    out.push(item);
    // 壺の中身も一緒に持ち帰る
    if (item.contents.length > 0) {
      out.push(...item.contents);
      item.contents = [];
    }
  }
  return out;
}

/** 村へ入るときに引き継ぐ強さ（持ち込み可ダンジョン用） */
export function carryOverOf(town: TownState): {
  level: number; exp: number; maxHp: number; maxStr: number;
} | null {
  // この作品では「レベルは毎回 1 から」。永続的に伸びるのは倉庫の装備だけ。
  // 引き継ぎを入れたくなった時のために口だけ用意しておく。
  void town;
  return null;
}

/** 図鑑に記録する */
export function recordSeen(town: TownState, itemIds: string[], monsterIds: string[]): void {
  for (const id of itemIds) town.seenItems[id] = true;
  for (const id of monsterIds) town.seenMonsters[id] = true;
}

/** 図鑑の達成率 */
export function collectionRate(town: TownState): {
  items: number; itemsTotal: number; monsters: number; monstersTotal: number;
} {
  return {
    items: Object.keys(town.seenItems).length,
    itemsTotal: ALL_ITEMS.filter((d) => d.kind !== 'gitan').length,
    monsters: Object.keys(town.seenMonsters).length,
    monstersTotal: allMonsters().filter((m) => m.family !== 'shop').length,
  };
}
