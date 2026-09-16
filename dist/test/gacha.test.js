import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIZES, RARITY_RATE, prizesOf } from '../src/data/gacha.js';
import { PARTNERS, tryGetPartner } from '../src/data/partners.js';
import { getDungeon, tryGetItem, tryGetMonster } from '../src/data/registry.js';
import { activeBoosts, canPull, ownedCount, ownedPartners, pull } from '../src/game/gacha.js';
import { PARTNER_LEAD, effectivePartnerLevel, mergePartnerExp, partnerExpToNext, partnerLevelCap, partnerStats, } from '../src/game/partner.js';
import { BASE_KEEP_SLOTS, GACHA_COST, GACHA_COST_10, MAX_KEEP_SLOTS } from '../src/game/rules.js';
import { attachFactories, startRun } from '../src/game/run.js';
import { finishRun } from '../src/game/town.js';
import { killActor } from '../src/game/combat.js';
import { World } from '../src/game/world.js';
/**
 * ガチャの検査。
 *
 * 石を払わせるので、払っていないのに引ける／払ったのに何も起きないが
 * 一番まずい。加護は「真・もっと不思議では効かない」が守れているかを見る。
 */
function newTown(over = {}) {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
        knownItems: {}, nicknames: {}, stones: 0, tally: {}, claimed: [],
        gachaOwned: {}, gachaPulls: 0, partners: {}, activePartner: null,
        ...over,
    };
}
/** 倉庫の代わり。届いた数だけ数える */
function collector() {
    const got = [];
    return { got, deliver: (id, n) => { for (let i = 0; i < n; i++)
            got.push(id); return true; } };
}
test('景品はすべて実在するものを指す', () => {
    const ids = new Set();
    for (const p of PRIZES) {
        assert.ok(!ids.has(p.id), `景品 id が重複: ${p.id}`);
        ids.add(p.id);
        assert.ok(p.weight > 0, `${p.id}: 重みが 0`);
        if (p.itemId)
            assert.ok(tryGetItem(p.itemId), `${p.id}: 道具 ${p.itemId} が無い`);
        if (p.partnerId)
            assert.ok(tryGetPartner(p.partnerId), `${p.id}: 相棒 ${p.partnerId} が無い`);
        // 景品は 1 つの正体しか持たない
        const kinds = [p.itemId, p.partnerId, p.boost].filter(Boolean).length;
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
    const total = ['ssr', 'sr', 'r', 'n']
        .reduce((a, r) => a + RARITY_RATE[r], 0);
    assert.equal(total, 100, `合計 ${total}%`);
    for (const r of ['ssr', 'sr', 'r', 'n']) {
        assert.ok(prizesOf(r).length > 0, `${r} の景品が無い`);
    }
});
test('石が足りなければ引けない', () => {
    const town = newTown({ stones: GACHA_COST - 1 });
    assert.equal(canPull(town, 1), false);
    const c = collector();
    assert.deepEqual(pull(town, 1, c.deliver), []);
    assert.equal(town.stones, GACHA_COST - 1, '引けていないのに石が減った');
    assert.equal(town.gachaPulls, 0);
});
test('引くと石がちょうど減り、その回数だけ結果が出る', () => {
    const town = newTown({ stones: 5000 });
    const c = collector();
    const one = pull(town, 1, c.deliver);
    assert.equal(one.length, 1);
    // 重複で石が戻ることがあるので、減った額は「値段 - 戻り」
    const refund1 = one.reduce((a, r) => a + r.refund, 0);
    assert.equal(town.stones, 5000 - GACHA_COST + refund1);
    const before = town.stones ?? 0;
    const ten = pull(town, 10, c.deliver);
    assert.equal(ten.length, 10);
    const refund10 = ten.reduce((a, r) => a + r.refund, 0);
    assert.equal(town.stones, before - GACHA_COST_10 + refund10);
    assert.equal(town.gachaPulls, 11);
});
test('10 連には SR 以上が必ず 1 つ入る', () => {
    for (let i = 0; i < 30; i++) {
        const town = newTown({ stones: GACHA_COST_10, playerName: `村${i}` });
        const c = collector();
        const r = pull(town, 10, c.deliver);
        assert.ok(r.some((x) => x.prize.rarity === 'sr' || x.prize.rarity === 'ssr'), `${i} 回目の 10 連に SR 以上が無い`);
    }
});
test('引いた枚数はそのまま記録される', () => {
    const town = newTown({ stones: 100000 });
    const c = collector();
    let pulls = 0;
    for (let i = 0; i < 50; i++) {
        pulls += pull(town, 10, c.deliver).length;
    }
    const owned = Object.values(town.gachaOwned ?? {}).reduce((a, n) => a + n, 0);
    assert.equal(owned, pulls, `引いた ${pulls} 回に対し記録は ${owned} 枚`);
});
test('加護は枚数から計算する。上限を超えたぶんは効かない', () => {
    const town = newTown({ gachaOwned: { 'b:keep': 1 } });
    assert.equal(activeBoosts(town, true).keepSlots, BASE_KEEP_SLOTS + 1);
    town.gachaOwned = { 'b:keep': 2 };
    assert.equal(activeBoosts(town, true).keepSlots, MAX_KEEP_SLOTS);
    // 上限（cap 2）を超えて持っていても 5 のまま
    town.gachaOwned = { 'b:keep': 50 };
    assert.equal(activeBoosts(town, true).keepSlots, MAX_KEEP_SLOTS);
});
test('加護の効かないダンジョンでは何も乗らない', () => {
    const town = newTown({
        gachaOwned: { 'b:keep': 2, 'b:herb': 1, 'b:gitan': 3, 'b:food': 3 },
        partners: { koro: { id: 'koro', level: 9, exp: 0, dupes: 1 } },
        activePartner: 'koro',
    });
    const on = activeBoosts(town, true);
    assert.equal(on.keepSlots, MAX_KEEP_SLOTS);
    assert.deepEqual(on.known, ['herb']);
    assert.equal(on.gitan, 900);
    assert.equal(on.food, 30);
    assert.ok(on.partner, '相棒が乗っていない');
    const off = activeBoosts(town, false);
    assert.equal(off.keepSlots, 0);
    assert.deepEqual(off.known, []);
    assert.equal(off.gitan, 0);
    assert.equal(off.food, 0);
    assert.equal(off.partner, null, '加護なしなのに相棒が居る');
});
test('真・もっと不思議では相棒も加護も出ない', () => {
    const town = newTown({
        gachaOwned: { 'b:herb': 1 },
        partners: { koro: { id: 'koro', level: 10, exp: 0, dupes: 1 } },
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
test('同じ相棒を引き直すと、強さではなく上限が伸びる', () => {
    const rec = { id: 'koro', level: 1, exp: 0, dupes: 0 };
    assert.equal(partnerLevelCap(rec), 10);
    rec.dupes = 1;
    assert.equal(partnerLevelCap(rec), 15);
    rec.dupes = 100;
    assert.equal(partnerLevelCap(rec), 50, '上限の上限を超えた');
});
test('相棒はプレイヤーのレベルより先へ行けない', () => {
    const rec = { id: 'koro', level: 40, exp: 0, dupes: 6 };
    assert.equal(effectivePartnerLevel(rec, 1), 1 + PARTNER_LEAD);
    assert.equal(effectivePartnerLevel(rec, 20), 20 + PARTNER_LEAD);
    // 育っていない相棒は、プレイヤーが強くても育った以上にはならない
    assert.equal(effectivePartnerLevel({ ...rec, level: 5 }, 50), 5);
});
test('経験値は上限まで。上限に着いたら貯めない', () => {
    const rec = { id: 'koro', level: 1, exp: 0, dupes: 0 };
    const levels = mergePartnerExp(rec, partnerExpToNext(1) + partnerExpToNext(2));
    assert.equal(levels, 2, `上がったのは ${levels} レベル`);
    assert.equal(rec.level, 3);
    // 上限（10）を超えて入れても止まる
    mergePartnerExp(rec, 10_000_000);
    assert.equal(rec.level, partnerLevelCap(rec));
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
        partners: { koro: { id: 'koro', level: 5, exp: 0, dupes: 0 } },
        activePartner: 'koro',
    });
    const world = startRun('d2', town, { seed: 7 });
    const ally = world.run.allies[0];
    assert.ok(ally, '相棒が居ない');
    assert.equal(ally.exp, 0, '混乱して斬ると得をしてしまう');
});
test('相棒は味方の列にだけ居る', () => {
    const town = newTown({
        partners: { koro: { id: 'koro', level: 5, exp: 0, dupes: 0 } },
        activePartner: 'koro',
    });
    const world = startRun('d2', town, { seed: 7 });
    const ally = world.run.allies[0];
    assert.ok(ally, '相棒が居ない');
    // 両方の列に入ると 1 ターンに 2 回動き、敵としても扱われる
    assert.ok(!world.run.monsters.some((m) => m.id === ally.id), '相棒が敵の列にも居る');
    assert.equal(world.isHostile(world.player, ally), false, '相棒が敵対している');
});
test('相棒の名前は冒険に持ち込まれる', () => {
    const town = newTown({
        partners: { koro: { id: 'koro', level: 3, exp: 0, dupes: 0, nickname: 'ぽち' } },
        activePartner: 'koro',
    });
    const world = startRun('d2', town, { seed: 8 });
    assert.equal(world.run.allies[0]?.nameOverride, 'ぽち');
});
test('倉庫がいっぱいでも引けるが、入らなかったことは分かる', () => {
    const town = newTown({ stones: 100000 });
    const results = pull(town, 10, () => false);
    const items = results.filter((r) => r.prize.itemId);
    assert.ok(items.length > 0, '道具が 1 つも出ていない');
    assert.ok(items.every((r) => r.lost > 0), '入らなかったのに lost が 0');
});
test('加護の効きめは、持っている枚数だけを見る', () => {
    // 実在しない景品 id が混ざっていても無視する
    const town = newTown({ gachaOwned: { 'b:keep': 1, 'そんな景品は無い': 99 } });
    assert.equal(activeBoosts(town, true).keepSlots, BASE_KEEP_SLOTS + 1);
    assert.equal(ownedCount(town, 'そんな景品は無い'), 99);
});
test('相棒を連れて行っても、行けないダンジョンでは湧かない', () => {
    const town = newTown({
        partners: { koro: { id: 'koro', level: 5, exp: 0, dupes: 0 } },
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
        partners: { koro: { id: 'koro', level: 1, exp: 0, dupes: 2 } },
        activePartner: 'koro',
    });
    const world = startRun('d2', town, { seed: 12 });
    const ally = world.run.allies[0];
    assert.ok(ally, '相棒が居ない');
    // 敵を 20 体、プレイヤーが倒す
    let killed = 0;
    for (let i = 0; i < 40 && killed < 20; i++) {
        const target = world.run.monsters.find((m) => m.alive);
        if (!target)
            break;
        killActor(world, world.player, target);
        world.drainEvents();
        killed++;
    }
    assert.ok(killed > 0, '敵を 1 体も倒していない');
    const gained = world.run.partner?.exp ?? 0;
    assert.ok(gained > 0, '相棒に経験値が入っていない');
    // 村の記録は冒険中には動かない
    assert.equal(town.partners.koro.level, 1, '冒険中に村の記録が動いた');
    finishRun(world, town, 'escape', 'テスト');
    const after = town.partners.koro;
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
        partners: { koro: { id: 'koro', level: 6, exp: 0, dupes: 1, nickname: 'ぽち' } },
        activePartner: 'koro',
    });
    const world = startRun('d2', town, { seed: 13 });
    const before = world.run.allies[0];
    assert.ok(before);
    const snapshot = JSON.parse(JSON.stringify(world.syncForSave()));
    const revived = new World(snapshot, getDungeon(snapshot.dungeonId));
    attachFactories(revived);
    assert.equal(revived.run.allies.length, 1, '再開で相棒が消えた');
    assert.equal(revived.run.allies[0].nameOverride, 'ぽち');
    assert.equal(revived.run.partner?.actorId, before.id, '相棒との紐付けが切れた');
    assert.equal(revived.run.monsters.some((m) => m.id === before.id), false, '再開したら敵の列にも居る');
});
//# sourceMappingURL=gacha.test.js.map