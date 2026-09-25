/**
 * 道具の絵（16×16 ドット）。
 *
 * 一番大事なのは「絵から正体が漏れない」こと。草・巻物・杖・腕輪は種類の絵 1 枚だけ、
 * 壺は正体を知るまで壺の絵。絵の出来の最低線（塗った量・色数・余白・決まった絵）もここで守る。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ITEMS, UNIDENTIFIED_KINDS, tryGetItem } from '../src/data/registry.js';
import {
  ICON_SIZE, allIconKeys, buildIcon, hasIcon, iconKeyForCatalog, iconKeyOf,
} from '../src/ui/art/items.js';
import { PixBuf, countPainted, distinctColors } from '../src/ui/art/pixbuf.js';
import { allTraps } from '../src/data/registry.js';
import { TRAP_ICON_SIZE, buildTrapIcon } from '../src/ui/art/traps.js';

const CATEGORY_ONLY = ['herb', 'scroll', 'staff', 'bracelet'];

function render(key: string): PixBuf {
  const b = new PixBuf(ICON_SIZE, ICON_SIZE);
  assert.ok(buildIcon(key, b), `${key} の絵が描けない`);
  return b;
}

test('全部の道具に絵がある（知っていても知らなくても）', () => {
  for (const d of ALL_ITEMS) {
    for (const known of [true, false]) {
      const key = iconKeyOf(d.id, known);
      assert.ok(hasIcon(key), `${d.id}（known=${known}）→ ${key} の絵が無い`);
    }
    assert.ok(hasIcon(iconKeyForCatalog(d.id)), `${d.id} の図鑑の絵が無い`);
  }
});

test('草・巻物・杖・腕輪は種類の絵だけ（道具ごとの絵を 1 つも持たない）', () => {
  for (const d of ALL_ITEMS) {
    if (!CATEGORY_ONLY.includes(d.kind)) continue;
    assert.equal(iconKeyOf(d.id, false), d.kind, d.id);
    assert.equal(iconKeyOf(d.id, true), d.kind, `${d.id} は知っていても種類の絵`);
    assert.equal(iconKeyForCatalog(d.id), d.kind, d.id);
    assert.ok(!hasIcon(d.id), `${d.id} に個別の絵がある（正体が漏れる）`);
  }
  // 絵の鍵の側からも確かめる：種類だけの道具の id を鍵に持たない
  for (const key of allIconKeys()) {
    const def = tryGetItem(key);
    if (def) assert.ok(!CATEGORY_ONLY.includes(def.kind), `${key} は種類だけのはず`);
  }
});

test('壺は知らないうちは必ず壺の絵、知っていれば壺ごとの絵', () => {
  const pots = ALL_ITEMS.filter((d) => d.kind === 'pot');
  assert.ok(pots.length > 0);
  for (const d of pots) {
    assert.equal(iconKeyOf(d.id, false), 'pot', d.id);
    assert.ok(hasIcon(iconKeyOf(d.id, true)), d.id);
  }
});

test('未識別の種類はどれも、知らない状態では種類の絵になる', () => {
  for (const d of ALL_ITEMS) {
    if (!UNIDENTIFIED_KINDS.includes(d.kind)) continue;
    assert.equal(iconKeyOf(d.id, false), d.kind, d.id);
  }
});

test('絵の出来の最低線：塗った量・色数・縁の余白', () => {
  for (const key of allIconKeys()) {
    const b = render(key);
    const n = countPainted(b);
    assert.ok(n >= 30, `${key} の塗りが少ない（${n}）`);
    assert.ok(n <= 200, `${key} の塗りが多すぎる（${n}）`);
    const colors = distinctColors(b);
    assert.ok(colors <= 16, `${key} の色が多い（${colors}）`);
    assert.ok(colors >= 3, `${key} の色が少ない（${colors}）`);
    // 形は外周 1 ドットを空けておく（輪郭がそこへ乗る。形がはみ出すと輪郭が切れる）
    const raw = new PixBuf(ICON_SIZE, ICON_SIZE);
    buildIcon(key, raw, false);
    for (let i = 0; i < ICON_SIZE; i++) {
      for (const [x, y] of [[i, 0], [i, ICON_SIZE - 1], [0, i], [ICON_SIZE - 1, i]]) {
        assert.equal(raw.get(x, y), 0, `${key} の形が縁 (${x},${y}) に掛かっている`);
      }
    }
  }
});

test('同じ鍵は何度描いても同じ絵', () => {
  for (const key of allIconKeys()) {
    assert.deepEqual(render(key).px, render(key).px, key);
  }
});

test('武器・盾・壺はそれぞれ見分けが付く（同じ絵が 2 つ無い）', () => {
  for (const kind of ['weapon', 'shield', 'pot', 'food']) {
    const seen = new Map<string, string>();
    for (const d of ALL_ITEMS) {
      if (d.kind !== kind) continue;
      const key = iconKeyOf(d.id, true);
      const sig = render(key).px.join(',');
      const other = seen.get(sig);
      assert.ok(other === undefined || other === d.id, `${d.id} と ${other} が同じ絵`);
      seen.set(sig, d.id);
    }
  }
});

test('知らない鍵は何も描かない', () => {
  const b = new PixBuf(ICON_SIZE, ICON_SIZE);
  assert.equal(buildIcon('no-such-icon', b), false);
});

test('全部のワナに絵があり、ワナごとに違う絵', () => {
  const seen = new Map<string, string>();
  for (const t of allTraps()) {
    const b = new PixBuf(TRAP_ICON_SIZE, TRAP_ICON_SIZE);
    assert.ok(buildTrapIcon(t.id, b), `${t.id} の絵が無い`);
    const n = countPainted(b);
    assert.ok(n >= 60, `${t.id} の塗りが少ない（${n}）`);
    assert.ok(distinctColors(b) <= 16, `${t.id} の色が多い`);
    const sig = b.px.join(',');
    assert.ok(!seen.has(sig), `${t.id} と ${seen.get(sig)} が同じ絵`);
    seen.set(sig, t.id);
    const again = new PixBuf(TRAP_ICON_SIZE, TRAP_ICON_SIZE);
    buildTrapIcon(t.id, again);
    assert.deepEqual(again.px, b.px, `${t.id} が決まった絵にならない`);
    const raw = new PixBuf(TRAP_ICON_SIZE, TRAP_ICON_SIZE);
    buildTrapIcon(t.id, raw, false);
    for (let i = 0; i < TRAP_ICON_SIZE; i++) {
      for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]]) {
        assert.equal(raw.get(x, y), 0, `${t.id} の形が縁 (${x},${y}) に掛かっている`);
      }
    }
  }
});
