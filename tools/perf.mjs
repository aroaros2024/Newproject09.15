#!/usr/bin/env node
/**
 * 描画の重さを測る（開発専用。ゲームには含まれない）。
 *
 *   node tools/perf.mjs --scenes "title,town,dungeon:d1:3&seed=5" --seconds 8 --q 2
 *
 * 場面を開いて数秒待ってから、決めた秒数のあいだフレームの間隔を集め、p50 / p95 / 最大と
 * 50ms を超えたフレームの数を出す。ダンジョンの場面は &perf=1 を付けると描画エンジンが
 * window.__perf（gfx/perf.ts）を出すので、1 フレームの描画時間（p50 / p95）も並べる。
 *
 * headless の Chromium はソフトウェアで描くので、実機より重く出る。
 * 数字そのものより「変更の前と後」「画質の段の差」を比べるのに使う。
 *
 * オプション
 *   --scenes <list>   カンマ区切りの場面（& 以降は URL の引数）
 *   --seconds <n>     測る秒数（既定 8）
 *   --warm <ms>       測り始めるまで待つ時間（既定 2000）
 *   --q <0|1|2>       画質（場面に &q= を付ける）
 *   --port <n>        サーバーの番号（既定 8152）
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const scenes = opt('scenes', 'title').split(',').map((s) => s.trim()).filter(Boolean);
const seconds = Number(opt('seconds', '8'));
const warm = Number(opt('warm', '2000'));
const quality = opt('q', null);
const port = Number(opt('port', '8152'));

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright');
const chromePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: root, stdio: 'ignore',
});

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (r.ok) return;
    } catch { /* まだ立ち上がっていない */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`サーバーが ${port} で立ち上がらない`);
}

const pct = (sorted, p) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  console.log('場面\tフレーム間隔 p50/p95/最大 (ms)\t50ms超\t描画 p50/p95 (ms)');
  for (const scene of scenes) {
    const [name, ...rest] = scene.split('&');
    const extra = rest.length ? `&${rest.join('&')}` : '';
    const q = quality !== null && !/[?&]q=/.test(extra) ? `&q=${quality}` : '';
    await page.goto(`http://127.0.0.1:${port}/index.html?scene=${encodeURIComponent(name)}${extra}${q}`,
      { waitUntil: 'networkidle' });
    await page.waitForTimeout(warm);
    const r = await page.evaluate(async (ms) => {
      const gaps = [];
      let last = performance.now();
      const end = last + ms;
      await new Promise((done) => {
        const step = (t) => {
          gaps.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      const perf = globalThis.__perf;
      let draw = null;
      if (perf && typeof perf.summary === 'function') {
        const s = perf.summary();
        draw = s && s.total ? { p50: s.total.p50, p95: s.total.p95 } : null;
      }
      return { gaps, draw };
    }, seconds * 1000);
    const gaps = r.gaps.slice(1).sort((a, b) => a - b);
    const long = gaps.filter((g) => g > 50).length;
    const drawCol = r.draw && Number.isFinite(r.draw.p50) ? `${f1(r.draw.p50)} / ${f1(r.draw.p95)}` : '-';
    console.log(`${scene}\t${f1(pct(gaps, 0.5))} / ${f1(pct(gaps, 0.95))} / ${f1(gaps[gaps.length - 1] ?? 0)}\t${long}\t${drawCol}`);
  }
  await browser.close();
} finally {
  server.kill();
}
