/**
 * 検証用：ガチャの演出を決まった時刻で止めて見る。
 *
 *   ?scene=gacha:ssr&at=600        1 回引き（ssr / sr / r / n）。開いてから at ミリ秒の姿
 *   ?scene=gacha:ten&at=3000       10 連（一覧まで）
 *
 * 時刻は 60Hz の刻みで進めてから止めるので、何度撮っても同じ絵になる。
 * 背景は村のジオラマ（本番と同じく村の画面の上に重なる）。
 */

import { PRIZES, type Rarity } from '../../data/gacha.js';
import type { PullResult } from '../../game/gacha.js';
import { buildTownDiorama } from '../art/scenes/town.js';
import { GachaAnim } from '../gachaAnim.js';
import { loadAllSprites } from '../spriteData.js';
import { SCREEN_H, SCREEN_W } from '../theme.js';
import { DioramaView } from '../world/diorama.js';

function pull(rarity: Rarity): PullResult {
  const prize = PRIZES.find((p) => p.rarity === rarity) ?? null;
  return { prize, charm: null, rarity, gitan: 0 };
}

export function open(spec: string, params: URLSearchParams, canvas: HTMLCanvasElement): void {
  loadAllSprites();
  const kind = spec.split(':')[1] ?? 'ssr';
  const results: PullResult[] = kind === 'ten'
    ? (['n', 'r', 'n', 'sr', 'n', 'r', 'n', 'n', 'ssr', 'r'] as Rarity[]).map(pull)
    : [pull((['ssr', 'sr', 'r', 'n'].includes(kind) ? kind : 'ssr') as Rarity)];
  const anim = new GachaAnim(results, () => {});
  const view = new DioramaView(buildTownDiorama());
  const at = Number(params.get('at') ?? 800);
  const step = 1000 / 60;
  for (let t = 0; t < at; t += step) {
    anim.update(step);
    anim.tick(step);
    view.tick(step / 1000);
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = SCREEN_W * dpr;
  canvas.height = SCREEN_H * dpr;
  canvas.style.width = `${SCREEN_W}px`;
  canvas.style.height = `${SCREEN_H}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.draw(g, at);
  anim.draw(g, at);
}
