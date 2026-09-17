import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PartnerRecord, RunState, TownState } from '../src/core/types.js';
import { PRIZES, RARITY_RATE, type Rarity, prizesOf } from '../src/data/gacha.js';
import { KNOWABLE_ITEMS } from '../src/data/items/all.js';
import { PARTNERS, tryGetPartner } from '../src/data/partners.js';
import { getDungeon, tryGetItem, tryGetMonster } from '../src/data/registry.js';
import {
  activeBoosts, canPull, drawable, ownedPartners, prizeTotal, pull, stockLeft, townBoosts,
} from '../src/game/gacha.js';
import {
  PARTNER_LEAD, effectivePartnerLevel, mergePartnerExp, partnerExpToNext,
  partnerLevelCap, partnerStats,
} from '../src/game/partner.js';
import {
  BASE_KEEP_SLOTS, GACHA_COST, GACHA_COST_10, GACHA_EMPTY_GITAN,
  INVENTORY_LIMIT, MAX_KEEP_SLOTS,
} from '../src/game/rules.js';
import { attachFactories, startRun } from '../src/game/run.js';
import { STORAGE_LIMIT, finishRun, inventoryLimitFor, storageLimit } from '../src/game/town.js';
import { killActor } from '../src/game/combat.js';
import { World } from '../src/game/world.js';

/**
 * ガチャの検査。
 *
 * 石を払わせるので、払っていないのに引ける／払ったのに何も起きないが
 * 一番まずい。加護は「真・もっと不思議では効かない」が守れているかを見る。
 */

function newTown(over: Partial<TownState> = {}): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    knownItems: {}, nicknames: {}, stones: 0, tally: {}, claimed: [],
    gachaOwned: {}, gachaPulls: 0, partners: {}, activePartner: null,
    ...over,
  };
}

test('景品はすべて実在するものを指す', () => {
  const ids = new Set<string>();
  for (const p of PRIZES) {
    assert.ok(!ids.has(p.id), `景品 id が重複: ${p.id}`);
    ids.add(p.id);
    assert.ok(p.weight > 0, `${p.id}: 重みが 0`);
    if (p.partnerId) assert.ok(tryGetPartner(p.partnerId), `${p.id}: 相棒 ${p.partnerId} が無い`);
    if (p.boost?.t === 'knownItem') {
      assert.ok(tryGetItem(p.boost.itemId), `${p.id}: 道具 ${p.boost.itemId} が無い`);
    }
    // 景品は 1 つの正体しか持たない
    const kinds = [p.partnerId, p.boost].filter(Boolean).length;
    assert.equal(kinds, 1, `${p.id}: 正体が ${kinds} 個`);
  }
});

test('相棒が借りるモンスターは実在する', () => {
  for (const p of PARTNERS) {
    assert.ok(tryGetMonster(p.baseId), `${p.id}: モンスター ${p.baseId} が無い`);
    assert.ok(p.hp > 0 && p.atk > 0, `${p.id}: 能力値が 0`);
  }
});

test('確率は合計 100%、どのレア度にも景品がある', () => {
  const total = (['ssr', 'sr', 'r', 'n'] as Rarity[])
    .reduce((a, r) => a + RARITY_RATE[r], 0);
  assert.equal(total, 100, `合計 ${total}%`);
  for (const r of ['ssr', 'sr', 'r', 'n'] as Rarity[]) {
    assert.ok(prizesOf(r).length > 0, `${r} の景品が無い`);
  }
});

test('石が足りなければ引けない', () => {
  const town = newTown({ stones: GACHA_COST - 1 });
  assert.equal(canPull(town, 1), false);
  assert.deepEqual(pull(town, 1), []);
  assert.equal(town.stones, GACHA_COST - 1, '引けていないのに石が減った');
  assert.equal(town.gachaPulls, 0);
});

test('引くと石がちょうど減り、その回数だけ結果が出る', () => {
  const town = newTown({ stones: 5000 });

  const one = pull(town, 1);
  assert.equal(one.length, 1);
  assert.equal(town.stones, 5000 - GACHA_COST, '石がちょうど減っていない');

  const before = town.stones ?? 0;
  const ten = pull(town, 10);
  assert.equal(ten.length, 10);
  assert.equal(town.stones, before - GACHA_COST_10);
  assert.equal(town.gachaPulls, 11);
});

test('10 連には SR 以上が必ず 1 つ入る', () => {
  for (let i = 0; i < 30; i++) {
    const town = newTown({ stones: GACHA_COST_10, playerName: `村${i}` });
    const r = pull(town, 10);
    assert.ok(
      r.some((x) => x.prize?.rarity === 'sr' || x.prize?.rarity === 'ssr'),
      `${i} 回目の 10 連に SR 以上が無い`,
    );
  }
});

test('出た景品はそのまま記録される', () => {
  const town = newTown({ stones: 100000 });
  let prizes = 0;
  for (let i = 0; i < 50; i++) {
    prizes += pull(town, 10).filter((r) => r.prize !== null).length;
  }
  const owned = Object.values(town.gachaOwned ?? {}).reduce((a, n) => a + n, 0);
  // 同じものは二度と出ないので、出た回数と持っている枚数は必ず一致する
  assert.equal(owned, prizes, `景品が ${prizes} 回 出たのに記録は ${owned} 枚`);
  assert.equal(owned, prizeTotal(), '引き切ったのに全部そろっていない');
});

test('加護は持っているかどうかだけを見る', () => {
  const town = newTown({});
  assert.equal(activeBoosts(town, true).keepSlots, BASE_KEEP_SLOTS, '持っていないのに増えた');

  town.gachaOwned = { 'b:keep': 1 };
  assert.equal(activeBoosts(town, true).keepSlots, MAX_KEEP_SLOTS);

  // 同じものは二度と出ないが、壊れたセーブで枚数が増えていても効き目は変わらない
  town.gachaOwned = { 'b:keep': 50 };
  assert.equal(activeBoosts(town, true).keepSlots, MAX_KEEP_SLOTS);
});

test('加護の効かないダンジョンでは何も乗らない', () => {
  const town = newTown({
    gachaOwned: { 'b:keep': 1, 'k:healHerb': 1, 'b:gitan': 1, 'b:food': 1, 'b:bag': 1 },
    partners: { koro: { id: 'koro', level: 9, exp: 0 } },
    activePartner: 'koro',
  });
  const on = activeBoosts(town, true);
  assert.equal(on.keepSlots, MAX_KEEP_SLOTS);
  assert.deepEqual([...on.knownIds], ['healHerb']);
  assert.equal(on.gitan, 900);
  assert.equal(on.food, 30);
  assert.ok(on.bagLimit > INVENTORY_LIMIT, '袋が効いていない');
  assert.ok(on.partner, '相棒が乗っていない');

  const off = activeBoosts(town, false);
  assert.equal(off.keepSlots, 0);
  assert.deepEqual([...off.knownIds], []);
  assert.equal(off.gitan, 0);
  assert.equal(off.food, 0);
  assert.equal(off.bagLimit, INVENTORY_LIMIT, '加護なしで袋が増えている');
  assert.equal(off.partner, null, '加護なしなのに相棒が居る');
});

test('真・もっと不思議では相棒も加護も出ない', () => {
  const town = newTown({
    gachaOwned: { 'k:healHerb': 1 },
    partners: { koro: { id: 'koro', level: 10, exp: 0 } },
    activePartner: 'koro',
  });
  const pure = startRun('exPure', town, { seed: 5 });
  assert.equal(pure.run.allies.length, 0, '相棒が付いてきている');
  assert.equal(pure.run.partner, undefined);
  // 草の知識も効かない
  const herbKnown = Object.keys(pure.run.identify.known).length;
  assert.equal(herbKnown, 0, `${herbKnown} 個が識別済みになっている`);

  const ex = startRun('ex', town, { seed: 5 });
  assert.equal(ex.run.allies.length, 1, '加護ありなのに相棒が居ない');
  assert.ok(Object.keys(ex.run.identify.known).length > 0, '草の知識が効いていない');
});

test('持っていない相棒を指していても壊れない', () => {
  const town = newTown({ activePartner: 'そんな相棒は居ない' });
  assert.equal(activeBoosts(town, true).partner, null);
  assert.equal(ownedPartners(town).length, 0);
});

test('相棒のレベル上限は最初から最大', () => {
  // 相棒は 1 体 1 回しか出ないので、引き直して上限を伸ばす仕組みは無い
  assert.equal(partnerLevelCap(), 50);
});

test('相棒はプレイヤーのレベルより先へ行けない', () => {
  const rec: PartnerRecord = { id: 'koro', level: 40, exp: 0 };
  assert.equal(effectivePartnerLevel(rec, 1), 1 + PARTNER_LEAD);
  assert.equal(effectivePartnerLevel(rec, 20), 20 + PARTNER_LEAD);
  // 育っていない相棒は、プレイヤーが強くても育った以上にはならない
  assert.equal(effectivePartnerLevel({ ...rec, level: 5 }, 50), 5);
});

test('経験値は上限まで。上限に着いたら貯めない', () => {
  const rec: PartnerRecord = { id: 'koro', level: 1, exp: 0 };
  const levels = mergePartnerExp(rec, partnerExpToNext(1) + partnerExpToNext(2));
  assert.equal(levels, 2, `上がったのは ${levels} レベル`);
  assert.equal(rec.level, 3);

  // 上限（50）を超えて入れても止まる
  mergePartnerExp(rec, 10_000_000);
  assert.equal(rec.level, partnerLevelCap());
  assert.equal(rec.exp, 0, '上限なのに経験値を貯めている');
});

test('相棒の能力値はレベルとともに単調に増える', () => {
  for (const def of PARTNERS) {
    let prev = partnerStats(def, 1);
    for (let l = 2; l <= 50; l++) {
      const cur = partnerStats(def, l);
      assert.ok(cur.hp >= prev.hp, `${def.id} Lv${l}: HP が下がった`);
      assert.ok(cur.atk >= prev.atk, `${def.id} Lv${l}: 攻撃が下がった`);
      assert.ok(cur.def >= prev.def, `${def.id} Lv${l}: 防御が下がった`);
      prev = cur;
    }
  }
});

test('相棒は倒しても経験値にならない', () => {
  const town = newTown({
    partners: { koro: { id: 'koro', level: 5, exp: 0 } },
    activePartner: 'koro',
  });
  const world = startRun('d2', town, { seed: 7 });
  const ally = world.run.allies[0];
  assert.ok(ally, '相棒が居ない');
  assert.equal(ally.exp, 0, '混乱して斬ると得をしてしまう');
});

test('相棒は味方の列にだけ居る', () => {
  const town = newTown({
    partners: { koro: { id: 'koro', level: 5, exp: 0 } },
    activePartner: 'koro',
  });
  const world = startRun('d2', town, { seed: 7 });
  const ally = world.run.allies[0];
  assert.ok(ally, '相棒が居ない');
  // 両方の列に入ると 1 ターンに 2 回動き、敵としても扱われる
  assert.ok(
    !world.run.monsters.some((m) => m.id === ally.id),
    '相棒が敵の列にも居る',
  );
  assert.equal(world.isHostile(world.player, ally), false, '相棒が敵対している');
});

test('相棒の名前は冒険に持ち込まれる', () => {
  const town = newTown({
    partners: { koro: { id: 'koro', level: 3, exp: 0, nickname: 'ぽち' } },
    activePartner: 'koro',
  });
  const world = startRun('d2', town, { seed: 8 });
  assert.equal(world.run.allies[0]?.nameOverride, 'ぽち');
});

test('実在しない景品 id が混ざっていても無視する', () => {
  const town = newTown({ gachaOwned: { 'b:keep': 1, 'そんな景品は無い': 99 } });
  assert.equal(activeBoosts(town, true).keepSlots, MAX_KEEP_SLOTS);
});

test('相棒を連れて行っても、行けないダンジョンでは湧かない', () => {
  const town = newTown({
    partners: { koro: { id: 'koro', level: 5, exp: 0 } },
    activePartner: 'koro',
    cleared: ['d1', 'd2', 'd3', 'd4', 'dl', 'exBring', 'ex'],
    unlocked: ['d1', 'd2', 'd3', 'd4', 'dl', 'exBring', 'ex', 'exPure'],
  });
  for (const id of ['d1', 'd2', 'ex']) {
    const w = startRun(id, town, { seed: 3 });
    assert.equal(w.run.allies.length, 1, `${getDungeon(id).name}に相棒が居ない`);
  }
  const pure = startRun('exPure', town, { seed: 3 });
  assert.equal(pure.run.allies.length, 0);
});

test('相棒は冒険で育ち、村へ持ち帰ったときに 1 度だけ反映される', () => {
  const town = newTown({
    partners: { koro: { id: 'koro', level: 1, exp: 0 } },
    activePartner: 'koro',
  });
  const world = startRun('d2', town, { seed: 12 });
  const ally = world.run.allies[0];
  assert.ok(ally, '相棒が居ない');

  // 敵を 20 体、プレイヤーが倒す
  let killed = 0;
  for (let i = 0; i < 40 && killed < 20; i++) {
    const target = world.run.monsters.find((m) => m.alive);
    if (!target) break;
    killActor(world, world.player, target);
    world.drainEvents();
    killed++;
  }
  assert.ok(killed > 0, '敵を 1 体も倒していない');
  const gained = world.run.partner?.exp ?? 0;
  assert.ok(gained > 0, '相棒に経験値が入っていない');

  // 村の記録は冒険中には動かない
  assert.equal(town.partners!.koro.level, 1, '冒険中に村の記録が動いた');

  finishRun(world, town, 'escape', 'テスト');
  const after = town.partners!.koro;
  assert.ok(after.level > 1 || after.exp > 0, '持ち帰っても育っていない');

  // 二度精算しても二度は育たない
  const level = after.level;
  const exp = after.exp;
  finishRun(world, town, 'escape', 'テスト');
  assert.equal(after.level, level, '二度目の精算でレベルが上がった');
  assert.equal(after.exp, exp, '二度目の精算で経験値が増えた');
});

test('中断して再開しても、相棒はそのまま付いてくる', () => {
  const town = newTown({
    partners: { koro: { id: 'koro', level: 6, exp: 0, nickname: 'ぽち' } },
    activePartner: 'koro',
  });
  const world = startRun('d2', town, { seed: 13 });
  const before = world.run.allies[0];
  assert.ok(before);

  const snapshot = JSON.parse(JSON.stringify(world.syncForSave())) as RunState;
  const revived = new World(snapshot, getDungeon(snapshot.dungeonId));
  attachFactories(revived);

  assert.equal(revived.run.allies.length, 1, '再開で相棒が消えた');
  assert.equal(revived.run.allies[0].nameOverride, 'ぽち');
  assert.equal(revived.run.partner?.actorId, before.id, '相棒との紐付けが切れた');
  assert.equal(
    revived.run.monsters.some((m) => m.id === before.id), false,
    '再開したら敵の列にも居る',
  );
});

// ---------------------------------------------------------------------------
// 重複しないこと
// ---------------------------------------------------------------------------

test('同じ景品は二度と出ない', () => {
  const town = newTown({ stones: 100_000 });
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    for (const r of pull(town, 1)) {
      if (!r.prize) continue;
      assert.ok(!seen.has(r.prize.id), `${r.prize.name}が 二度 出た`);
      seen.add(r.prize.id);
    }
  }
  // 記録も 1 枚ずつ
  for (const [id, n] of Object.entries(town.gachaOwned ?? {})) {
    assert.equal(n, 1, `${id} が ${n} 枚ある`);
  }
});

test('出るものが尽きたら、1 回につき 3000 ギタン', () => {
  const town = newTown({ stones: 1_000_000 });
  const total = prizeTotal();
  assert.ok(total > 0);

  // 全部出るまで引く
  let pulls = 0;
  while (stockLeft(town) > 0 && pulls < total * 3) {
    pull(town, 1);
    pulls++;
  }
  assert.equal(stockLeft(town), 0, '引き切れなかった');
  assert.equal(pulls, total, `${total} 個を ${pulls} 連で引いた（重複が出ている）`);

  // そこから先はギタン
  const gitanBefore = town.gitan;
  const stonesBefore = town.stones ?? 0;
  const after = pull(town, 1);
  assert.equal(after.length, 1);
  assert.equal(after[0].prize, null, '尽きたのに景品が出た');
  assert.equal(after[0].gitan, GACHA_EMPTY_GITAN);
  assert.equal(town.gitan, gitanBefore + GACHA_EMPTY_GITAN);
  assert.equal(town.stones, stonesBefore - GACHA_COST, '石は普通に減る');

  // 10 連なら 10 回ぶん
  const g2 = town.gitan;
  const ten = pull(town, 10);
  assert.equal(ten.filter((r) => r.prize === null).length, 10);
  assert.equal(town.gitan, g2 + GACHA_EMPTY_GITAN * 10);
});

test('段が尽きても落ちない。確率は残った段へ配り直される', () => {
  const town = newTown({ stones: 1_000_000 });
  // N を全部持っている状態にする
  town.gachaOwned = {};
  for (const p of drawable(town, 'n')) town.gachaOwned[p.id] = 1;
  assert.equal(drawable(town, 'n').length, 0, 'N が空になっていない');

  const got = pull(town, 10);
  assert.equal(got.length, 10);
  for (const r of got) {
    assert.ok(r.prize, '景品が出ていない');
    assert.notEqual(r.prize!.rarity, 'n', '空のはずの N が出た');
  }
});

// ---------------------------------------------------------------------------
// 知識
// ---------------------------------------------------------------------------

test('知識は 1 つの道具だけを識別する', () => {
  const town = newTown({ gachaOwned: { 'k:healHerb': 1 } });
  const world = startRun('d2', town, { seed: 41 });
  const known = world.run.identify.known;
  assert.equal(known.healHerb, true, '引いた草が識別されていない');

  const others = KNOWABLE_ITEMS.filter((d) => d.id !== 'healHerb' && known[d.id]);
  assert.equal(others.length, 0, `他の ${others.length} 種まで識別された`);
});

test('知識の景品は 1 道具につき 1 つだけ', () => {
  const ids = new Set<string>();
  const items = new Set<string>();
  for (const p of PRIZES) {
    if (p.boost?.t !== 'knownItem') continue;
    assert.ok(!ids.has(p.id), `景品 id が重複: ${p.id}`);
    assert.ok(!items.has(p.boost.itemId), `道具が重複: ${p.boost.itemId}`);
    ids.add(p.id);
    items.add(p.boost.itemId);
  }
  assert.equal(items.size, KNOWABLE_ITEMS.length,
    `${KNOWABLE_ITEMS.length} 種に対し 知識は ${items.size} 個`);
});

test('R は N より本当にめずらしい', () => {
  // R を青く塗って演出も長くしているので、実際にめずらしくないと嘘になる
  const r = RARITY_RATE.r / prizesOf('r').length;
  const n = RARITY_RATE.n / prizesOf('n').length;
  assert.ok(n > r * 1.5,
    `R 1 つ ${r.toFixed(2)}% に対し N 1 つ ${n.toFixed(2)}%。差が小さすぎる`);
});

test('引けなくなった景品は、持っている人には効き続ける', () => {
  // 「腕輪の 知識」を持っている古いセーブ
  const town = newTown({ gachaOwned: { 'b:bracelet': 1 } });
  const ids = activeBoosts(town, true).knownIds;
  const bracelets = KNOWABLE_ITEMS.filter((d) => d.kind === 'bracelet');
  assert.ok(bracelets.length > 0);
  for (const d of bracelets) {
    assert.ok(ids.has(d.id), `${d.name}が識別されていない`);
  }
  // ただし、もう抽選には出ない
  assert.equal(prizesOf('sr').some((p) => p.id === 'b:bracelet'), false,
    '引けなくなった景品が抽選に出ている');
});

// ---------------------------------------------------------------------------
// 村の設備と、袋
// ---------------------------------------------------------------------------

test('倉庫と道具屋の加護は、加護なしダンジョンでも消えない', () => {
  // 村の設備であってダンジョンの中の加護ではない
  const town = newTown({ gachaOwned: { 'b:shelf': 1, 'b:trade': 1 } });
  const tb = townBoosts(town);
  assert.ok(tb.storage > 0, '倉庫が増えていない');
  assert.ok(tb.shopSlots > 0, '品揃えが増えていない');
  // townBoosts はダンジョンを引数に取らないので、加護なしで消えようが無い
  assert.equal(storageLimit(town), STORAGE_LIMIT + tb.storage);
});

test('袋は加護。加護なしダンジョンでは増えない', () => {
  const town = newTown({ gachaOwned: { 'b:bag': 1 } });
  assert.ok(inventoryLimitFor(town, getDungeon('d2')) > INVENTORY_LIMIT, '袋が効いていない');
  assert.equal(inventoryLimitFor(town, getDungeon('exPure')), INVENTORY_LIMIT,
    '加護なしダンジョンで袋が増えている');

  const w = startRun('d2', town, { seed: 5 });
  assert.equal(w.player.bagLimit, inventoryLimitFor(town, getDungeon('d2')));
  const pure = startRun('exPure', town, { seed: 5 });
  assert.equal(pure.player.bagLimit, INVENTORY_LIMIT);
});

test('図鑑は知識では埋まらない', () => {
  // 加護で名前を知っているだけの物を「出会った」ことにすると、
  // 1 歩も歩かずに出入りするだけで道具図鑑が埋まってしまう
  const town = newTown({ gachaOwned: { 'b:bracelet': 1 } });
  const world = startRun('d2', town, { seed: 9 });
  world.run.encountered.items = [];
  world.run.encountered.monsters = [];
  finishRun(world, town, 'escape', 'テスト');
  assert.equal(Object.keys(town.seenItems).length, 0,
    `知識だけで図鑑が ${Object.keys(town.seenItems).length} 種 埋まった`);
});

test('知識は村の記録（knownItems）には入らない', () => {
  // knownItems は allowBoosts に関係なく全ダンジョンへ入るので、
  // そちらへ書くと真・もっと不思議にも効いてしまう
  const town = newTown({ stones: 100_000 });
  for (let i = 0; i < 30; i++) pull(town, 10);
  assert.deepEqual(town.knownItems, {}, '村の記録に知識が漏れている');

  const pure = startRun('exPure', town, { seed: 12 });
  assert.equal(Object.keys(pure.run.identify.known).length, 0,
    '加護なしダンジョンに知識が漏れている');
});
