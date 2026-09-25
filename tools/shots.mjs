#!/usr/bin/env node
/**
 * 検証用の場面を撮る（開発専用。ゲームには含まれない）。
 *
 *   node tools/shots.mjs --out <dir> --scenes "art:lineup,dungeon:d1:1&seed=101,town"
 *
 * オプション
 *   --out <dir>        保存先（無ければ作る）
 *   --scenes <list>    カンマ区切りの場面。各場面の & 以降は URL の引数になる
 *   --port <n>         サーバーの番号（既定 8150。並べて動かすときは変える）
 *   --wait <ms>        開いてから撮るまで待つ時間（既定 1200）
 *   --scale <n>        画面の拡大（既定 1 = 1280×720）
 *   --q <0|1|2>        画質（dungeon の場面に付ける）
 *
 * このファイルのある場所の 1 つ上（リポジトリ）をサーバーの根にする。
 * git worktree の中から動かしても、その作業場の dist/ を撮る。
 *
 * Playwright と Chromium は環境に入っているものを使う。場所は環境変数で変えられる。
 *   PLAYWRIGHT_PATH   既定 /opt/node22/lib/node_modules/playwright
 *   CHROMIUM_PATH     既定 /opt/pw-browsers/chromium-1194/chrome-linux/chrome
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const out = resolve(opt('out', join(root, 'shots')));
const scenes = opt('scenes', 'title').split(',').map((s) => s.trim()).filter(Boolean);
const port = Number(opt('port', '8150'));
const wait = Number(opt('wait', '1200'));
const scale = Number(opt('scale', '1'));
const quality = opt('q', null);

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(pwPath);
const chromePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

mkdirSync(out, { recursive: true });

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

const fileName = (scene) => scene.replace(/[^a-zA-Z0-9_\-=.]+/g, '_').slice(0, 120) + '.png';

let failed = 0;
try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: chromePath });
  const page = await browser.newPage({
    viewport: { width: Math.round(1280 * scale), height: Math.round(720 * scale) },
  });
  for (const scene of scenes) {
    const errors = [];
    const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text()); };
    const onError = (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`);
    page.on('console', onConsole);
    page.on('pageerror', onError);
    const [name, ...rest] = scene.split('&');
    const extra = rest.length ? `&${rest.join('&')}` : '';
    const q = quality !== null && !/[?&]q=/.test(extra) ? `&q=${quality}` : '';
    const url = `http://127.0.0.1:${port}/index.html?scene=${encodeURIComponent(name)}${extra}${q}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(wait);
    const path = join(out, fileName(scene));
    // 見本帳は画面より大きいことがあるので、キャンバスの中身をそのまま書き出す
    const data = await page.evaluate(() => {
      const c = document.getElementById('sheet');
      return c instanceof HTMLCanvasElement ? c.toDataURL('image/png') : null;
    });
    if (data) writeFileSync(path, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    else await page.screenshot({ path });
    page.off('console', onConsole);
    page.off('pageerror', onError);
    if (errors.length) {
      failed++;
      console.log(`✗ ${scene} → ${path}\n  ${errors.join('\n  ')}`);
    } else {
      console.log(`✓ ${scene} → ${path}`);
    }
  }
  await browser.close();
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
