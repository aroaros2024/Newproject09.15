/**
 * 見た目のコード（src/ui）がゲームの結果を変えないことの検査。
 *
 * 見た目がゲームの乱数（world.rng）を 1 つでも引くと、画面を描いただけでリプレイがずれる。
 * Math.random も使わない（表示専用の fxRng か、座標のハッシュを使う）。
 * コメントの中で名前を挙げるのは構わないので、コメントを除いてから探す。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

/** テストは dist/test/ で動くので、源の src/ui は 2 つ上 */
const ROOT = new URL('../../src/ui/', import.meta.url).pathname;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}${name}`;
    if (statSync(p).isDirectory()) walk(`${p}/`, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 行コメント・ブロックコメント・文字列の中身を消す（ざっくりでよい） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

test('src/ui で Math.random とゲームの乱数を使っていない', () => {
  const files = walk(ROOT, []);
  assert.ok(files.length > 50, `src/ui のファイルが見つからない（${ROOT}）`);
  const bad: string[] = [];
  for (const f of files) {
    const code = stripComments(readFileSync(f, 'utf8'));
    if (/Math\.random\s*\(/.test(code)) bad.push(`${f}: Math.random`);
    if (/\b(world|w|this\.world)\.rng\b/.test(code) || /\brun\.rng\b/.test(code)) bad.push(`${f}: ゲームの乱数`);
  }
  assert.deepEqual(bad, []);
});
