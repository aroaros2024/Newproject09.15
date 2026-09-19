import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { CHARM_BOX_LIMIT, CHARM_MAX_SLOTS, CHARM_RUNES, CHARM_RUNE_IDS, validateCharmRunes, } from '../src/data/charms.js';
import { RUNES } from '../src/data/runes.js';
import { addCharmRune, charmName, charmRuneLevel, charmRuneList, meltValue, reforgeCharm, rollCharm, } from '../src/game/charm.js';
import { activeBoosts, charmRoom, drawable, prizeTotal, pull } from '../src/game/gacha.js';
import { GACHA_COST, GACHA_COST_10 } from '../src/game/rules.js';
import { startRun } from '../src/game/run.js';
import { SMITH_PRICE, meltCharm, smithEmbed, smithReforge, wearCharm } from '../src/game/town.js';
import { makeItem } from '../src/game/inventory.js';
import { shieldRune, weaponRune } from '../src/game/runes.js';
import { loadTown, saveTown } from '../src/core/save.js';
/**
 * 護石の検査。
 *
 * 護石は「村で 1 つだけ着ける、印を持った恒久の加護」で、
 * ガチャがその場で作る。表の景品と違って在庫が尽きないので、
 * 「尽きる前提のコードを壊していないか」と
 * 「恒久で持つと壊れる印が混ざっていないか」を重点的に見る。
 */
/**
 * セーブは localStorage を通る。node には無いので、最小の物を置く。
 * ここを飛ばして sanitize を直接呼ぶと、実際の保存経路を検査したことにならない。
 */
function installStorage() {
    const map = new Map();
    const local = {
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => { map.set(k, v); },
        removeItem: (k) => { map.delete(k); },
        clear: () => { map.clear(); },
        key: (i) => [...map.keys()][i] ?? null,
        get length() { return map.size; },
    };
    globalThis.window = { localStorage: local };
}
installStorage();
function newTown(over = {}) {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
        knownItems: {}, nicknames: {}, stones: 0, tally: {}, claimed: [],
        gachaOwned: {}, gachaPulls: 0, partners: {}, activePartner: null,
        charms: [], activeCharm: null,
        ...over,
    };
}
const charm = (runes, slots = 0, uid = 1) => ({ uid, runes, slots });
// ---------------------------------------------------------------------------
// 表そのもの
// ---------------------------------------------------------------------------
test('護石の表に書いた印はすべて実在し、装備の上限を超えない', () => {
    assert.deepEqual(validateCharmRunes(), []);
    assert.ok(CHARM_RUNE_IDS.length > 0);
});
test('恒久で持つと壊れる印は護石に出ない', () => {
    // 必中は命中 100%、成長は plus が無限に伸びる、鋼断ちはメタルの関門を消す、
    // 鈍足は呪い専用、見切りは Lv1 で最低 1 ダメージの床を消す。
    // 匠は「装備に埋められる印の数」なので系統がねじれる
    for (const id of ['sure', 'growth', 'slayMetal', 'blunt', 'smith', 'evade']) {
        assert.equal(CHARM_RUNES[id], undefined, `${id} が護石に乗っている`);
    }
});
test('護石での上限は装備での上限以下', () => {
    for (const id of CHARM_RUNE_IDS) {
        const def = RUNES.find((r) => r.id === id);
        assert.ok(CHARM_RUNES[id].maxLevel <= def.maxLevel, `${id} の上限が装備より高い`);
    }
});
// ---------------------------------------------------------------------------
// 作る
// ---------------------------------------------------------------------------
test('1 万個作っても、載せない印は出ず、上限も超えない', () => {
    const rng = new Rng('charm-roll');
    const seenLevel = new Map();
    for (let i = 0; i < 10_000; i++) {
        const c = rollCharm(rng, i % 2 === 0 ? 'n' : 'r', i + 1);
        assert.ok(c.runes.length > 0, '印が 1 つも無い護石ができた');
        assert.ok(c.slots >= 0 && c.slots <= CHARM_MAX_SLOTS, `空きスロットが ${c.slots}`);
        for (const { id, level } of charmRuneList(c)) {
            const rule = CHARM_RUNES[id];
            assert.ok(rule, `表に無い印が出た: ${id}`);
            assert.ok(level <= rule.maxLevel, `${id} が Lv${level}（上限 ${rule.maxLevel}）`);
            seenLevel.set(id, Math.max(seenLevel.get(id) ?? 0, level));
        }
    }
    // 表に載せた印は 1 万個のうちに一度は出る（重みが 0 の印が紛れていない）
    for (const id of CHARM_RUNE_IDS) {
        assert.ok(seenLevel.has(id), `${id} が 1 万個引いても出なかった`);
    }
});
test('同時に付けられない印は同居しない', () => {
    const rng = new Rng('charm-exclusive');
    for (let i = 0; i < 5_000; i++) {
        const c = rollCharm(rng, 'r', i + 1);
        const has = (id) => charmRuneLevel(c, id) > 0;
        assert.ok(!(has('heavy') && has('swift')), '剛腕と疾風が同居した');
        assert.ok(!(has('satiety') && has('blunt')), '腹持ちと鈍足が同居した');
        assert.ok(!(has('sure') && has('crit')), '必中と会心が同居した');
    }
});
test('N より R のほうが中身が濃い', () => {
    const rng = new Rng('charm-quality');
    let nSum = 0;
    let rSum = 0;
    for (let i = 0; i < 2_000; i++) {
        nSum += rollCharm(rng, 'n', i + 1).runes.length;
        rSum += rollCharm(rng, 'r', i + 1).runes.length;
    }
    assert.ok(rSum > nSum * 1.5, `R が濃くない（N ${nSum} / R ${rSum}）`);
});
test('名前に印の記号と空きスロットが出る', () => {
    assert.equal(charmName(charm(['crit', 'crit', 'drain'], 2)), '護石 [会2吸] 空き2');
    assert.equal(charmName(charm(['flame'])), '護石 [炎]');
});
// ---------------------------------------------------------------------------
// 引く
// ---------------------------------------------------------------------------
test('1 回 10 石、10 連 100 石でちょうど減る', () => {
    assert.equal(GACHA_COST, 10);
    assert.equal(GACHA_COST_10, GACHA_COST * 10, '今の 1 回分の石で 10 連できない');
    const town = newTown({ stones: 1000 });
    pull(town, 1);
    assert.equal(town.stones, 990);
    pull(town, 10);
    assert.equal(town.stones, 890);
});
test('護石は gachaOwned に入らない（セーブが無限に膨らまない）', () => {
    const town = newTown({ stones: 100_000 });
    let charms = 0;
    for (let i = 0; i < 300; i++) {
        for (const r of pull(town, 1))
            if (r.charm)
                charms++;
    }
    assert.ok(charms > 0, '護石が 1 つも出なかった');
    assert.ok(Object.keys(town.gachaOwned ?? {}).length <= prizeTotal(), 'gachaOwned に護石が混ざっている');
});
test('護石の箱が満杯なら護石は出ない', () => {
    const town = newTown({ stones: 100_000 });
    town.charms = [];
    for (let i = 0; i < CHARM_BOX_LIMIT; i++)
        town.charms.push(charm(['crit'], 0, i + 1));
    assert.equal(charmRoom(town), 0);
    for (let i = 0; i < 50; i++) {
        for (const r of pull(town, 1)) {
            assert.equal(r.charm, null, '箱が満杯なのに護石が出た');
        }
    }
    assert.equal(town.charms.length, CHARM_BOX_LIMIT, '箱からあふれた');
});
test('引き続けても箱の上限を超えない', () => {
    const town = newTown({ stones: 1_000_000 });
    for (let i = 0; i < 500; i++)
        pull(town, 1);
    assert.ok((town.charms ?? []).length <= CHARM_BOX_LIMIT, '箱が上限を超えた');
});
test('SR 以上の確定枠は護石に食われない', () => {
    // 護石は N と R にしか出ないので、10 連の 10 回目は相棒か加護のまま
    for (let i = 0; i < 20; i++) {
        const town = newTown({ stones: 10_000, playerName: `ナギ${i}` });
        const got = pull(town, 10);
        assert.ok(got.some((r) => r.rarity === 'ssr' || r.rarity === 'sr'), 'SR 以上が出ていない');
        for (const r of got) {
            if (r.charm)
                assert.ok(r.rarity === 'n' || r.rarity === 'r', '護石が SR 以上に出た');
        }
    }
});
// ---------------------------------------------------------------------------
// 効く
// ---------------------------------------------------------------------------
test('護石の印が冒険で効く', () => {
    const town = newTown({ charms: [charm(['crit', 'crit', 'reduce'], 1)], activeCharm: 1 });
    const world = startRun('d2', town, { seed: 7 });
    assert.equal(weaponRune(world, world.player, 'crit'), 2, '会心が乗っていない');
    assert.equal(shieldRune(world, world.player, 'reduce'), 1, '減衰が乗っていない');
});
test('武器の印は盾からは読めない（対象を取り違えない）', () => {
    const town = newTown({ charms: [charm(['crit'])], activeCharm: 1 });
    const world = startRun('d2', town, { seed: 7 });
    assert.equal(shieldRune(world, world.player, 'crit'), 0, '武器の印が盾側に出た');
});
test('真・もっと不思議では護石が効かない', () => {
    const town = newTown({ charms: [charm(['crit', 'crit'])], activeCharm: 1 });
    assert.equal(activeBoosts(town, true).charm?.uid, 1);
    assert.equal(activeBoosts(town, false).charm, null, '加護なしなのに護石が残った');
    const pure = startRun('exPure', town, { seed: 5 });
    assert.equal(pure.charm, null, 'exPure に護石が持ち込まれた');
    assert.equal(weaponRune(pure, pure.player, 'crit'), 0);
});
test('持ち込み不可の もっと不思議では護石が効く', () => {
    // ここが神器型との決定的な差。護石は道具ではないので持ち込み制限にかからない
    const town = newTown({ charms: [charm(['flame', 'flame'])], activeCharm: 1 });
    const ex = startRun('ex', town, { seed: 5 });
    assert.equal(ex.charm?.uid, 1);
    assert.equal(weaponRune(ex, ex.player, 'flame'), 2);
});
test('着けていない護石は効かない', () => {
    const town = newTown({ charms: [charm(['crit', 'crit'])], activeCharm: null });
    const world = startRun('d2', town, { seed: 7 });
    assert.equal(weaponRune(world, world.player, 'crit'), 0);
});
test('直読みしていた 5 箇所も護石で効く', () => {
    // 連撃・ワナ師の印・遠投・錆よけ（特技とワナ）は runes を直に見ていて、
    // 護石を足しても効かない場所だった
    const town = newTown({
        charms: [charm(['combo', 'antiTrap', 'reach', 'antiRust'], 0)],
        activeCharm: 1,
    });
    const world = startRun('d2', town, { seed: 7 });
    assert.equal(weaponRune(world, world.player, 'combo'), 1, '連撃が効かない');
    assert.equal(shieldRune(world, world.player, 'antiTrap'), 1, 'ワナ師の印が効かない');
    assert.equal(weaponRune(world, world.player, 'reach'), 1, '遠投が効かない');
    assert.equal(shieldRune(world, world.player, 'antiRust'), 1, '錆よけが効かない');
});
// ---------------------------------------------------------------------------
// 溶かす・打ち直す
// ---------------------------------------------------------------------------
test('溶かすとギタンが増え、護石は箱から消える', () => {
    const town = newTown({ charms: [charm(['crit', 'crit'], 2)], activeCharm: null, gitan: 0 });
    const want = meltValue(town.charms[0]);
    assert.ok(want > 0);
    assert.equal(meltCharm(town, 1), want);
    assert.equal(town.gitan, want);
    assert.equal(town.charms.length, 0);
});
test('着けている護石は溶かせない', () => {
    const town = newTown({ charms: [charm(['crit'])], activeCharm: 1, gitan: 0 });
    assert.equal(meltCharm(town, 1), 0, '着けている護石が溶けた');
    assert.equal(town.charms.length, 1);
    assert.equal(town.gitan, 0);
});
test('打ち直すと、残した印だけがそのまま残る', () => {
    const rng = new Rng('reforge-keep');
    const before = charm(['crit', 'crit', 'gitanHit'], 3);
    for (let i = 0; i < 200; i++) {
        const after = reforgeCharm(rng, before, 'crit');
        assert.equal(after.uid, before.uid, '番号が変わった');
        assert.equal(charmRuneLevel(after, 'crit'), 2, '残した印のレベルが変わった');
    }
});
test('打ち直しはギタンを取り、足りなければ何もしない', () => {
    const town = newTown({ charms: [charm(['crit'])], gitan: 0 });
    const rng = new Rng('reforge-town');
    assert.equal(smithReforge(town, rng, 1, 'crit'), false, 'ギタン 0 で打ち直せた');
    assert.deepEqual(town.charms[0].runes, ['crit']);
    town.gitan = 100_000;
    assert.equal(smithReforge(town, rng, 1, 'crit'), true);
    assert.ok(town.gitan < 100_000, 'ギタンが減っていない');
    assert.ok(charmRuneLevel(town.charms[0], 'crit') > 0, '残した印が消えた');
});
test('着けるのは持っている護石だけ', () => {
    const town = newTown({ charms: [charm(['crit'])] });
    assert.equal(wearCharm(town, 99), false, '持っていない護石を着けられた');
    assert.equal(town.activeCharm, null);
    assert.equal(wearCharm(town, 1), true);
    assert.equal(town.activeCharm, 1);
    assert.equal(wearCharm(town, null), true);
    assert.equal(town.activeCharm, null);
});
// ---------------------------------------------------------------------------
// セーブ
// ---------------------------------------------------------------------------
test('護石の無い古いセーブを読んでも壊れない', () => {
    const old = newTown({ stones: 50 });
    delete old.charms;
    delete old.activeCharm;
    saveTown(old);
    const back = loadTown();
    assert.deepEqual(back.charms, []);
    assert.equal(back.activeCharm, null);
});
test('壊れた護石はセーブの読み込みで切り詰められる', () => {
    const town = newTown();
    town.charms = [
        // 上限を超えた会心、表に無い印、実在しない印、あり得ない空きスロット
        { uid: 1, runes: ['crit', 'crit', 'crit', 'crit', 'sure', 'nonsense'], slots: 99 },
        // 印が 1 つも残らないものは捨てる
        { uid: 2, runes: ['sure'], slots: 1 },
    ];
    town.activeCharm = 2;
    saveTown(town);
    const back = loadTown();
    assert.equal(back.charms.length, 1, '中身が空の護石が残った');
    const c = back.charms[0];
    assert.equal(charmRuneLevel(c, 'crit'), CHARM_RUNES.crit.maxLevel, '会心が上限を超えて残った');
    assert.equal(charmRuneLevel(c, 'sure'), 0, '護石に乗らない印が残った');
    assert.equal(charmRuneLevel(c, 'nonsense'), 0, '実在しない印が残った');
    assert.equal(c.slots, CHARM_MAX_SLOTS, '空きスロットが上限を超えた');
    assert.equal(back.activeCharm, null, '消えた護石を指したまま');
});
test('箱の上限を超えたセーブは読み込みで切られる', () => {
    const town = newTown();
    town.charms = [];
    for (let i = 0; i < CHARM_BOX_LIMIT + 20; i++)
        town.charms.push(charm(['crit'], 0, i + 1));
    saveTown(town);
    assert.equal(loadTown().charms.length, CHARM_BOX_LIMIT);
});
// ---------------------------------------------------------------------------
// 表の景品を壊していないこと
// ---------------------------------------------------------------------------
test('護石を入れても表の景品は二度と出ない', () => {
    const town = newTown({ stones: 1_000_000 });
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
        for (const r of pull(town, 1)) {
            if (!r.prize)
                continue;
            assert.ok(!seen.has(r.prize.id), `${r.prize.name}が 二度 出た`);
            seen.add(r.prize.id);
        }
    }
    assert.equal(drawable(town, 'n').length + drawable(town, 'r').length
        + drawable(town, 'sr').length + drawable(town, 'ssr').length, prizeTotal() - seen.size, '在庫の数が合わない');
});
// ---------------------------------------------------------------------------
// 空きスロットに印を入れる
// ---------------------------------------------------------------------------
test('空きスロットに印を入れると、スロットが 1 つ減る', () => {
    const c = charm(['crit'], 2);
    assert.equal(addCharmRune(c, 'gitanHit'), true);
    assert.equal(charmRuneLevel(c, 'gitanHit'), 1);
    assert.equal(c.slots, 1);
    // レベル上げも空きスロットを使う（「空き n ＝ あと n 回」で言い切れるように）
    assert.equal(addCharmRune(c, 'gitanHit'), true);
    assert.equal(charmRuneLevel(c, 'gitanHit'), 2);
    assert.equal(c.slots, 0);
    assert.equal(addCharmRune(c, 'thunder'), false, '空きが無いのに入った');
});
test('護石に入らない印・上限を超える印は入らない', () => {
    const c = charm(['crit', 'crit'], 3);
    assert.equal(addCharmRune(c, 'sure'), false, '必中が入った');
    assert.equal(addCharmRune(c, 'growth'), false, '成長が入った');
    assert.equal(addCharmRune(c, 'crit'), false, '会心が上限を超えた');
    assert.equal(c.slots, 3, '失敗したのにスロットが減った');
});
test('印の種類は 3 つまで', () => {
    const c = charm(['crit', 'gitanHit', 'reduce'], 3);
    assert.equal(addCharmRune(c, 'thunder'), false, '4 種類目が入った');
    assert.equal(addCharmRune(c, 'gitanHit'), true, '既にある印は入る');
});
test('排他の印を入れると、相手が外れる', () => {
    const c = charm(['heavy'], 2);
    assert.equal(addCharmRune(c, 'swift'), true);
    assert.equal(charmRuneLevel(c, 'heavy'), 0, '剛腕が残った');
    assert.equal(charmRuneLevel(c, 'swift'), 1);
});
test('鍛冶屋で印を入れると、ギタンだけが減って素材は要らない', () => {
    const town = newTown({ charms: [charm(['crit'], 1)], gitan: 10_000 });
    const rng = new Rng('embed');
    const sword = makeItem('ironSword', rng, { runes: ['flame'] }, () => town.nextUid++);
    town.storage.push(sword);
    const got = smithEmbed(town, new Rng('embed:1'), 1);
    assert.ok(got, '印が入らなかった');
    assert.equal(charmRuneLevel(town.charms[0], got), 1);
    assert.equal(town.charms[0].slots, 0, '空きスロットが減っていない');
    assert.equal(town.storage.length, 1, '素材を消してはいけない');
    assert.equal(town.gitan, 10_000 - SMITH_PRICE.embed);
});
test('入る印が無ければ何も起きない', () => {
    // 空きスロット 0 の護石には入らない
    const town = newTown({ charms: [charm(['crit'], 0)], gitan: 10_000 });
    assert.equal(smithEmbed(town, new Rng('embed:2'), 1), null);
    assert.equal(town.gitan, 10_000, '失敗したのにギタンが減った');
});
test('ギタンが足りなければ印は入らない', () => {
    const town = newTown({ charms: [charm(['crit'], 1)], gitan: SMITH_PRICE.embed - 1 });
    assert.equal(smithEmbed(town, new Rng('embed:3'), 1), null);
    assert.equal(town.charms[0].slots, 1, '失敗したのに空きが減った');
});
test('入れられる印だけが選ばれる（上限・種類数・排他）', () => {
    // 会心は上限 2。Lv2 まで入っていれば、もう会心は選ばれない
    for (let i = 0; i < 40; i++) {
        const town = newTown({ charms: [charm(['crit', 'crit'], 1)], gitan: 10_000 });
        const got = smithEmbed(town, new Rng(`embed:cap:${i}`), 1);
        assert.ok(got, '印が入らなかった');
        assert.notEqual(got, 'crit', '上限に達した印が入った');
    }
});
//# sourceMappingURL=charm.test.js.map