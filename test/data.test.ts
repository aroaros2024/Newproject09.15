import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_ITEMS, validateData, getDungeon, allDungeons, allMonsters,
  itemsOfKind, UNIDENTIFIED_KINDS, getItem, getMonster,
} from '../src/data/registry.js';
import { DUNGEON_ORDER } from '../src/data/dungeons.js';
import { ALIAS_POOLS } from '../src/data/names.js';
import { EXCLUSIVE_RUNE_PAIRS, RUNES } from '../src/data/runes.js';

test('データ整合性の検査がすべて通る', () => {
  const errors = validateData();
  assert.deepEqual(errors, [], `データ不整合:\n${errors.join('\n')}`);
});

test('依頼された構成（4 ダンジョン + ラスト + もっと不思議）になっている', () => {
  // 終盤は 3 本。持ち込み可(exBring)／持ち込み不可(ex)／加護なし(exPure)
  assert.deepEqual(
    [...DUNGEON_ORDER],
    ['d1', 'd2', 'd3', 'd4', 'dl', 'exBring', 'ex', 'exPure'],
  );
  assert.equal(allDungeons().length, 8);
  assert.equal(getDungeon('d1').depth, 5);
  assert.equal(getDungeon('d2').depth, 10);
  assert.equal(getDungeon('d3').depth, 15);
  assert.equal(getDungeon('d4').depth, 20);
  assert.equal(getDungeon('dl').depth, 30, 'ラストダンジョンは 30F');
  assert.equal(getDungeon('ex').depth, 99, 'もっと不思議は 99F');
  assert.equal(getDungeon('exPure').depth, 99, '真・もっと不思議も 99F');
});

test('もっと不思議のダンジョンは持ち込み不可・Lv1 スタート', () => {
  for (const id of ['ex', 'exPure']) {
    const ex = getDungeon(id);
    assert.equal(ex.allowBring, false, `${id}: 道具は持ち込めない`);
    assert.equal(ex.resetLevel, true, `${id}: Lv1 から`);
  }
  assert.equal(getDungeon('exBring').requires, 'dl', 'ラストをクリアしてから解放される');
  assert.equal(getDungeon('ex').requires, 'exBring', '不思議のあとに解放される');
  assert.equal(getDungeon('exPure').requires, 'ex', 'もっと不思議のあとに解放される');
});

test('「もっと」が付くものだけ 持ち込み不可・Lv1 スタート', () => {
  // シリーズの約束事。「もっと不思議」という名前自体が
  // 「持ち込み不可・Lv1 から」を意味するので、名前と中身を食い違わせない
  const bring = getDungeon('exBring');
  assert.equal(bring.allowBring, true, '不思議のダンジョンは持ち込み可');
  assert.equal(bring.resetLevel, false, 'レベルは持ち越す');
  assert.equal(bring.depth, 40);
  assert.equal(bring.bosses.length, 0, '最深部の階段を降りれば踏破');
  for (const id of ['ex', 'exPure']) {
    assert.equal(getDungeon(id).allowBring, false, `${id} は持ち込み不可`);
    assert.equal(getDungeon(id).resetLevel, true, `${id} は Lv1 から`);
  }
});

test('加護が効くかどうかだけが 2 つの違い', () => {
  // 加護あり／なしの違いは、この 2 つのフラグだけ
  assert.notEqual(getDungeon('ex').allowBoosts, false, 'ex は加護あり');
  assert.equal(getDungeon('exPure').allowBoosts, false, 'exPure は加護なし');
  assert.equal(getDungeon('exPure').allowAlly, false, 'exPure は相棒も連れて行けない');
  // 中身（敵・アイテム・階数）は同じでなければ「同じダンジョンの別ルール」にならない
  assert.equal(getDungeon('exPure').monsters.length, getDungeon('ex').monsters.length);
  assert.equal(getDungeon('exPure').items.length, getDungeon('ex').items.length);
});

test('ストーリーダンジョンは前提が鎖になっている', () => {
  assert.equal(getDungeon('d1').requires, null);
  assert.equal(getDungeon('d2').requires, 'd1');
  assert.equal(getDungeon('d3').requires, 'd2');
  assert.equal(getDungeon('d4').requires, 'd3');
  assert.equal(getDungeon('dl').requires, 'd4');
});

test('d1 はチュートリアルとして十分やさしい', () => {
  const d1 = getDungeon('d1');
  assert.equal(d1.monsterHouseRate, 0, 'チュートリアルにモンスターハウスは出さない');
  assert.equal(d1.windTurns, 0, 'チュートリアルに風は吹かない');
  assert.equal(d1.bosses.length, 0);
  const ids = new Set(d1.traps.map((t) => t.id));
  for (const dangerous of ['mine', 'bigMine', 'monsterHouseTrap', 'curseTrap']) {
    assert.ok(!ids.has(dangerous), `d1 に ${dangerous} を出してはいけない`);
  }
});

test('各ダンジョンに十分な種類のモンスターとアイテムが出る', () => {
  for (const d of allDungeons()) {
    assert.ok(d.monsters.length >= 5, `${d.id}: モンスターの種類が少ない`);
    assert.ok(d.items.length >= 15, `${d.id}: アイテムの種類が少ない`);
    assert.ok(d.traps.length >= 5, `${d.id}: ワナの種類が少ない`);
  }
});

test('すべての階層に出現できるモンスターが存在する', () => {
  for (const d of allDungeons()) {
    for (let depth = 1; depth <= d.depth; depth++) {
      const avail = d.monsters.filter((e) => depth >= e.from && depth <= e.to);
      assert.ok(avail.length >= 2, `${d.id} ${depth}F: 出現できるモンスターが ${avail.length} 種`);
    }
  }
});

test('すべての階層に出現できるアイテムが存在する', () => {
  for (const d of allDungeons()) {
    for (let depth = 1; depth <= d.depth; depth++) {
      const avail = d.items.filter((e) => depth >= e.from && depth <= e.to);
      assert.ok(avail.length >= 5, `${d.id} ${depth}F: 出現できるアイテムが ${avail.length} 種`);
    }
  }
});

test('もっと不思議の 1F でも生き延びる道具が出る', () => {
  const ex = getDungeon('ex');
  const first = new Set(ex.items.filter((e) => e.from === 1).map((e) => e.id));
  for (const need of ['healHerb', 'riceBall', 'woodStick', 'woodShield']) {
    assert.ok(first.has(need), `ex 1F に ${need} が出ない`);
  }
});

test('もっと不思議は深層ほど強い敵が出る', () => {
  const ex = getDungeon('ex');
  const at = (depth: number): number => {
    const avail = ex.monsters.filter((e) => depth >= e.from && depth <= e.to);
    const levels = avail.map((e) => getMonster(e.id).level);
    return levels.reduce((a, b) => a + b, 0) / levels.length;
  };
  const shallow = at(5);
  const mid = at(50);
  const deep = at(95);
  assert.ok(mid > shallow, `50F(${mid.toFixed(1)}) が 5F(${shallow.toFixed(1)}) より強くない`);
  assert.ok(deep > mid, `95F(${deep.toFixed(1)}) が 50F(${mid.toFixed(1)}) より強くない`);
});

test('ボスは最深部に配置されている', () => {
  for (const d of allDungeons()) {
    for (const b of d.bosses) {
      assert.equal(b.depth, d.depth, `${d.id}: ボスが最深部にいない`);
      assert.equal(getMonster(b.monsterId).isBoss, true);
    }
  }
  assert.equal(getDungeon('dl').bosses.length, 2, 'ラストボスは 2 形態');
});

test('アイテムが各カテゴリに十分な数ある', () => {
  const want: Record<string, number> = {
    weapon: 25, shield: 20, herb: 20, scroll: 25, staff: 15,
    pot: 15, bracelet: 20, food: 8, misc: 5,
  };
  for (const [kind, n] of Object.entries(want)) {
    const got = itemsOfKind(kind as never).length;
    assert.ok(got >= n, `${kind} が ${got} 種しかない（${n} 種以上必要）`);
  }
});

test('モンスターが 60 種以上いる', () => {
  assert.ok(allMonsters().length >= 60, `モンスターが ${allMonsters().length} 種しかいない`);
});

test('モンスターの系統が tier 順に繋がっている', () => {
  for (const m of allMonsters()) {
    if (!m.evolveTo) continue;
    const next = getMonster(m.evolveTo);
    assert.equal(next.family, m.family, `${m.id} の進化先が別系統`);
    assert.ok(next.tier > m.tier, `${m.id} の進化先の tier が上がっていない`);
    assert.ok(next.hp > m.hp, `${m.id} → ${next.id} で HP が上がっていない`);
    assert.ok(next.exp > m.exp, `${m.id} → ${next.id} で経験値が上がっていない`);
  }
});

test('ボスと店主は成長の鎖に乗らない', () => {
  for (const m of allMonsters()) {
    if (m.isBoss || m.family === 'shop') {
      assert.equal(m.evolveTo, null, `${m.id} が成長してしまう`);
    }
  }
});

test('未識別カテゴリの仮名プールが足りている', () => {
  for (const kind of UNIDENTIFIED_KINDS) {
    const pool = ALIAS_POOLS[kind];
    const count = itemsOfKind(kind).length;
    assert.ok(pool.length >= count, `${kind}: プール ${pool.length} < アイテム ${count}`);
  }
});

test('排他の印は双方向に定義されている', () => {
  const ids = new Set(RUNES.map((r) => r.id));
  for (const [a, b] of EXCLUSIVE_RUNE_PAIRS) {
    assert.ok(ids.has(a), `排他ペアの ${a} が存在しない`);
    assert.ok(ids.has(b), `排他ペアの ${b} が存在しない`);
  }
});

test('値段と出現重みに極端な値がない', () => {
  for (const d of ALL_ITEMS) {
    assert.ok(d.price >= 0, `${d.id}: 値段が負`);
    assert.ok(d.weight >= 0, `${d.id}: 重みが負`);
    assert.ok(d.name.length > 0 && d.desc.length > 0, `${d.id}: 名前か説明が空`);
  }
});

test('装備の初期印がスロット数に収まっている', () => {
  for (const d of ALL_ITEMS) {
    if (d.kind !== 'weapon' && d.kind !== 'shield') continue;
    assert.ok(d.innate.length <= d.slots, `${d.id}: 初期印がスロットを超えている`);
  }
});

test('クリア報酬のアイテムが存在する', () => {
  for (const d of allDungeons()) {
    if (d.reward.itemId) assert.doesNotThrow(() => getItem(d.reward.itemId as string));
    assert.ok(d.reward.message.length > 0, `${d.id}: 報酬メッセージが空`);
  }
});

/**
 * どのダンジョンでも Lv1・HP15 から始まるので、序盤の階で
 * 「2 発で沈む」敵が出てはいけない。ここを緩めると、
 * ラストダンジョンの 1F で即死するようなことが起きる。
 */
test('序盤の階は、想定装備で 3 発は耐えられる強さに収まっている', async () => {
  const { expectedDamage } = await import('../src/game/rules.js');
  const { START_HP } = await import('../src/game/rules.js');
  // そのダンジョンへ潜るとき、倉庫から持ってくるであろう盾の防御力
  const EXPECTED_SHIELD: Record<string, number> = {
    d1: 2, d2: 4, d3: 8, d4: 11, dl: 15, ex: 0,
  };
  // 潜るにつれてレベルが上がるので、想定 HP も階層で伸ばす
  const expectedHp = (depth: number): number => START_HP + (depth - 1) * 4;
  const problems: string[] = [];
  for (const d of allDungeons()) {
    const shield = EXPECTED_SHIELD[d.id] ?? 0;
    for (const depth of [1, 2, 3]) {
      if (depth > d.depth) break;
      const hp = expectedHp(depth);
      for (const e of d.monsters) {
        if (depth < e.from || depth > e.to) continue;
        const m = getMonster(e.id);
        const dmg = expectedDamage(m.atk, shield);
        const hits = Math.ceil(hp / dmg);
        if (hits < 3) {
          problems.push(
            `${d.id} ${depth}F: ${m.name}（攻撃${m.atk}）が ${dmg} ダメージ`
            + `＝HP${hp} を ${hits}発で削り切る`,
          );
        }
      }
    }
  }
  assert.deepEqual(problems, [], `序盤が厳しすぎる:\n${[...new Set(problems)].join('\n')}`);
});

test('ダンジョンの難易度が階層とともに上がっていく', () => {
  for (const d of allDungeons()) {
    const threatAt = (depth: number): number => {
      const avail = d.monsters.filter((e) => depth >= e.from && depth <= e.to);
      if (avail.length === 0) return 0;
      return Math.max(...avail.map((e) => getMonster(e.id).atk));
    };
    const early = threatAt(1);
    const late = threatAt(d.depth);
    assert.ok(
      late > early * 1.5,
      `${d.id}: 最深部(${late}) が序盤(${early}) と比べて強くなっていない`,
    );
  }
});
