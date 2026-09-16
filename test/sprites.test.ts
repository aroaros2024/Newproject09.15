import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PixelSprite } from '../src/ui/sprites.js';
import { validateSprite } from '../src/ui/sprites.js';
import { MONSTER_SPRITES_A } from '../src/ui/sprites/monstersA.js';
import { MONSTER_SPRITES_B } from '../src/ui/sprites/monstersB.js';
import { ITEM_SPRITES } from '../src/ui/sprites/items.js';
import { WORLD_SPRITES } from '../src/ui/sprites/world.js';
import { allMonsters, ALL_ITEMS, allTraps } from '../src/data/registry.js';
import { DIRS } from '../src/core/geom.js';

const ALL: Record<string, PixelSprite> = {
  ...MONSTER_SPRITES_A, ...MONSTER_SPRITES_B, ...ITEM_SPRITES, ...WORLD_SPRITES,
};

test('すべてのドット絵が 16x16 で、パレットに無い文字を使っていない', () => {
  const errors: string[] = [];
  for (const [id, sprite] of Object.entries(ALL)) {
    errors.push(...validateSprite(id, sprite));
    if (sprite.rows.length !== 16) errors.push(`${id}: 行数が ${sprite.rows.length}（16 が必要）`);
    for (const [i, row] of sprite.rows.entries()) {
      if (row.length !== 16) errors.push(`${id}: 行 ${i} の長さが ${row.length}（16 が必要）`);
    }
  }
  assert.deepEqual(errors.slice(0, 20), [], `ドット絵の不備:\n${errors.slice(0, 20).join('\n')}`);
});

test('パレットの色がすべて #rrggbb 形式', () => {
  const bad: string[] = [];
  for (const [id, sprite] of Object.entries(ALL)) {
    for (const [ch, color] of Object.entries(sprite.palette)) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) bad.push(`${id}: '${ch}' = ${color}`);
    }
  }
  assert.deepEqual(bad, [], `色の形式が不正:\n${bad.join('\n')}`);
});

test('スカスカのドット絵が無い（形が見える程度に塗られている）', () => {
  const thin: string[] = [];
  for (const [id, sprite] of Object.entries(ALL)) {
    let painted = 0;
    for (const row of sprite.rows) {
      for (const ch of row) if (ch !== '.' && ch !== ' ') painted++;
    }
    if (painted < 20) thin.push(`${id}: ${painted} ドット`);
  }
  assert.deepEqual(thin, [], `塗りが少なすぎる:\n${thin.join('\n')}`);
});

test('すべてのモンスターに絵がある', () => {
  const missing = allMonsters().filter((m) => !ALL[m.id]).map((m) => `${m.id}（${m.name}）`);
  assert.deepEqual(missing, [], `絵の無いモンスター:\n${missing.join('\n')}`);
});

test('すべてのアイテムに、少なくともカテゴリ共通の絵がある', () => {
  const missing: string[] = [];
  for (const def of ALL_ITEMS) {
    if (!ALL[def.id] && !ALL[def.sprite]) missing.push(`${def.id}（${def.name}）→ ${def.sprite}`);
  }
  assert.deepEqual(missing, [], `絵の無いアイテム:\n${missing.join('\n')}`);
});

test('すべてのワナに絵がある', () => {
  const missing = allTraps().filter((t) => !ALL[t.sprite]).map((t) => `${t.id} → ${t.sprite}`);
  assert.deepEqual(missing, [], `絵の無いワナ:\n${missing.join('\n')}`);
});

test('プレイヤーの絵が 8 方向そろっている', () => {
  for (const d of DIRS) {
    assert.ok(ALL[`player${d}`], `player${d} の絵が無い`);
  }
});

test('階段とエフェクトの絵がある', () => {
  for (const id of ['stairsDown', 'fxHit', 'fxSlash', 'fxMagic', 'fxFire']) {
    assert.ok(ALL[id], `${id} の絵が無い`);
  }
});

test('未識別のカテゴリは、種類ごとに絵を変えていない', () => {
  // 見た目で中身が分かってしまうと、識別の駆け引きが成立しない
  const leaked: string[] = [];
  for (const def of ALL_ITEMS) {
    if (!['herb', 'scroll', 'staff', 'bracelet'].includes(def.kind)) continue;
    if (ALL[def.id]) leaked.push(`${def.id}（${def.name}）に個別の絵がある`);
  }
  assert.deepEqual(leaked, [], `未識別なのに見た目が違う:\n${leaked.join('\n')}`);
});

test('絵の id が重複していない', () => {
  const counts = new Map<string, number>();
  for (const table of [MONSTER_SPRITES_A, MONSTER_SPRITES_B, ITEM_SPRITES, WORLD_SPRITES]) {
    for (const id of Object.keys(table)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const dup = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  assert.deepEqual(dup, [], `id が重複している絵:\n${dup.join('\n')}`);
});
