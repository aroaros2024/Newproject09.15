#!/usr/bin/env node
/**
 * プレイログを再生する。
 *
 * ゲームの中身は全部シード付きの Rng を通っているので、記録した行動を
 * 同じ順で流せば、そのときと 1 手ずつ同じことが起きる。
 * 「こういうことが起きた」を推測で探さずに済ませるための道具。
 *
 *   node tools/replay.mjs log.txt              最後まで再生して、できごとを出す
 *   node tools/replay.mjs log.txt --turn 1832  そのターンまでで止めて、その場を出す
 *   node tools/replay.mjs log.txt --diff       記録と再生のできごとを突き合わせる
 *   node tools/replay.mjs log.txt --tail 40    末尾 40 行だけ出す
 *   cat log.txt | node tools/replay.mjs -      標準入力からも読める
 *
 * dist/ を読むので、先に npm run build しておくこと。
 */

import { readFileSync } from 'node:fs';
import { parsePlayLog } from '../dist/src/game/playlog.js';
import { replayRun } from '../dist/src/game/recorder.js';

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(`使い方:
  node tools/replay.mjs <ログのファイル|-> [--turn N] [--diff] [--tail N] [--quiet]

  --turn N   N ターン目まで再生して止める
  --diff     記録されたできごとと、再生で出たできごとを突き合わせる
  --tail N   できごとの末尾 N 行だけ出す（既定 60、0 で全部）
  --quiet    できごとを出さず、最後の状態だけ出す`);
  process.exit(argv.length === 0 ? 1 : 0);
}

const file = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : fallback;
};
const untilTurn = flag('--turn', Infinity);
const tail = flag('--tail', 60);
const wantDiff = argv.includes('--diff');
const quiet = argv.includes('--quiet');

const text = file === '-'
  ? readFileSync(0, 'utf8')
  : readFileSync(file, 'utf8');

const replay = await parsePlayLog(text);
if (!replay) {
  console.error('再現データが見つかりません。プレイログ 1 枚をそのまま渡してください。');
  process.exit(1);
}
if (replay.truncated) {
  console.error('※ この記録は長すぎて途中で打ち切られています。再現はできません。');
  process.exit(1);
}

console.log(`ダンジョン ${replay.dungeonId} / 種 ${replay.seed} / 行動 ${replay.actions.length} 手`
  + ` / 持ち込み ${replay.bring.length} 個 / 記録されたできごと ${replay.lines.length} 行`);

// --turn が指定されていたら、そのターンに届いた時点で止める
let untilAction;
if (Number.isFinite(untilTurn)) {
  const probe = replayRun(replay);
  const hit = probe.lines.findIndex((l) => l.turn >= untilTurn);
  untilAction = hit >= 0 ? Math.min(replay.actions.length, hit + 1) : undefined;
}

const out = replayRun(replay, untilAction === undefined ? {} : { untilAction });
const p = out.world.player;

if (!quiet) {
  const rows = tail > 0 ? out.lines.slice(-tail) : out.lines;
  console.log(`\n--- 再生したできごと（${rows.length} / ${out.lines.length} 行）---`);
  for (const l of rows) console.log(`[${l.turn}] ${l.depth}F  ${l.text}`);
}

console.log(`\n--- 止まったところ（${out.applied} 手目）---`);
console.log(`${replay.dungeonId} ${out.world.run.depth}F　${out.world.run.totalTurn} ターン`);
console.log(`HP ${p.hp}/${p.maxHp}　Lv ${p.level}　ちから ${p.str}/${p.maxStr}`
  + `　満腹 ${Math.floor(p.foodX10 / 10)}/${Math.floor(p.maxFoodX10 / 10)}　ギタン ${p.gitan}`);
console.log(`持ち物 ${p.inventory.length} 個　敵 ${out.world.run.monsters.length} 体`
  + `　仲間 ${out.world.run.allies.length} 体　決着 ${out.world.finished ? 'あり' : 'まだ'}`);

if (wantDiff) {
  // 記録と再生がずれていたら、それ自体が不具合の証拠になる
  const a = replay.lines;
  const b = out.lines;
  let bad = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    const sx = x ? `[${x.turn}] ${x.depth}F ${x.text}` : '（記録なし）';
    const sy = y ? `[${y.turn}] ${y.depth}F ${y.text}` : '（再生なし）';
    if (sx !== sy) {
      if (bad < 20) console.log(`\n食い違い ${i} 行目\n  記録: ${sx}\n  再生: ${sy}`);
      bad++;
    }
  }
  console.log(`\n--- 突き合わせ ---`);
  console.log(bad === 0
    ? `食い違い 0 件（${a.length} 行）。記録どおりに再生できています。`
    : `食い違い ${bad} 件 / ${n} 行。記録と再生がずれています。`);
  process.exitCode = bad === 0 ? 0 : 2;
}
