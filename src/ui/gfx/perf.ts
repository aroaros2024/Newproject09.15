/**
 * 描画の時間を測る（開発用）。
 *
 * 1 フレームの中の段（地形・光・ブルーム…）ごとの時間を、確保済みの輪の配列に貯める。
 * Canvas 2D の描画は後でまとめて実行されることが多いので、段の時間は「命令を積んだ時間」になる。
 * 本当の時間を見たいときは sync を上げる：
 *   sync 0 … 測るだけ
 *   sync 1 … フレームの最後に 1 画素を読み戻して、積んだ描画をその場で実行させる（合計が正しくなる）
 *   sync 2 … 段ごとに読み戻す（段ごとの内訳が正しくなる。そのぶん合計は少し増える）
 * window.__perf から p50 / p95 を読める（tools の計測スクリプト用）。
 */

import type { Ctx2D } from './canvas.js';

/** 貯めるフレーム数 */
const RING = 600;

export interface PerfStat {
  p50: number;
  p95: number;
  mean: number;
  max: number;
}

export interface PerfSummary {
  frames: number;
  /** 描画の合計（ミリ秒） */
  total: PerfStat;
  /** requestAnimationFrame の間隔（ミリ秒） */
  interval: PerfStat;
  passes: Record<string, PerfStat>;
}

export class PerfMeter {
  readonly names: readonly string[];
  enabled = false;
  sync: 0 | 1 | 2 = 0;
  private readonly np: number;
  private readonly data: Float32Array;
  private readonly totals = new Float32Array(RING);
  private readonly intervals = new Float32Array(RING);
  private readonly cur: Float32Array;
  private readonly scratch = new Float32Array(RING);
  private head = 0;
  private count = 0;
  private t0 = 0;
  private last = 0;
  private prevNow = -1;
  private interval = 0;
  /** 画面に出す文字（30 フレームごとに作り直す） */
  private lines: string[] = [];
  private sinceText = 1e9;

  constructor(names: readonly string[]) {
    this.names = names;
    this.np = names.length;
    this.data = new Float32Array(RING * this.np);
    this.cur = new Float32Array(this.np);
  }

  begin(now: number): void {
    if (!this.enabled) return;
    this.interval = this.prevNow < 0 ? 0 : now - this.prevNow;
    this.prevNow = now;
    this.cur.fill(0);
    this.t0 = performance.now();
    this.last = this.t0;
  }

  /** 段 pass が終わった。flush を渡すと sync 2 のときにそこで描画を実行させる */
  mark(pass: number, flush?: Ctx2D): void {
    if (!this.enabled) return;
    if (this.sync >= 2 && flush) flush.getImageData(0, 0, 1, 1);
    const t = performance.now();
    this.cur[pass] += t - this.last;
    this.last = t;
  }

  end(g?: Ctx2D): void {
    if (!this.enabled) return;
    if (this.sync >= 1 && g) {
      g.getImageData(0, 0, 1, 1);
      const t = performance.now();
      // 読み戻しで実行された分は、最後の段に足す
      if (this.np > 0) this.cur[this.np - 1] += t - this.last;
      this.last = t;
    }
    const h = this.head;
    this.totals[h] = this.last - this.t0;
    this.intervals[h] = this.interval;
    this.data.set(this.cur, h * this.np);
    this.head = (h + 1) % RING;
    if (this.count < RING) this.count++;
    this.sinceText++;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.prevNow = -1;
  }

  private stat(read: (i: number) => number): PerfStat {
    const n = this.count;
    const s = this.scratch;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const v = read(i);
      s[i] = v;
      sum += v;
      if (v > max) max = v;
    }
    const view = s.subarray(0, n);
    view.sort();
    const at = (p: number): number => (n === 0 ? 0 : view[Math.min(n - 1, Math.floor(p * n))]);
    return { p50: at(0.5), p95: at(0.95), mean: n ? sum / n : 0, max };
  }

  /** 統計（呼んだ時だけ割り当てる。毎フレームは呼ばない） */
  summary(): PerfSummary {
    const passes: Record<string, PerfStat> = {};
    for (let p = 0; p < this.np; p++) {
      passes[this.names[p]] = this.stat((i) => this.data[i * this.np + p]);
    }
    return {
      frames: this.count,
      total: this.stat((i) => this.totals[i]),
      interval: this.stat((i) => this.intervals[i]),
      passes,
    };
  }

  /** window.__perf に出す（計測スクリプトが読む） */
  expose(extra?: Record<string, unknown>): void {
    const api = {
      summary: (): PerfSummary => this.summary(),
      reset: (): void => this.reset(),
      setSync: (s: 0 | 1 | 2): void => {
        this.sync = s;
      },
      ...extra,
    };
    (globalThis as unknown as { __perf?: unknown }).__perf = api;
  }

  /** 左上に数字を出す（論理座標の向きで呼ぶ）。文字は 30 フレームごとに作り直す */
  drawOverlay(g: Ctx2D, title: string): void {
    if (!this.enabled) return;
    if (this.sinceText >= 30) {
      this.sinceText = 0;
      const s = this.summary();
      const f = (v: number): string => v.toFixed(2).padStart(6);
      const lines = [
        `${title}  frames ${s.frames}  sync ${this.sync}`,
        `total   p50 ${f(s.total.p50)}  p95 ${f(s.total.p95)} ms`,
        `interval p50 ${f(s.interval.p50)}  p95 ${f(s.interval.p95)} ms`,
      ];
      for (const name of this.names) {
        const p = s.passes[name];
        if (p.mean < 0.005) continue;
        lines.push(`${name.padEnd(10)} ${f(p.mean)}  p95 ${f(p.p95)}`);
      }
      this.lines = lines;
    }
    const lines = this.lines;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.78;
    g.fillStyle = '#05060c';
    g.fillRect(8, 8, 330, 12 + lines.length * 17);
    g.globalAlpha = 1;
    g.font = '13px monospace';
    g.textBaseline = 'top';
    g.fillStyle = '#e8e4d0';
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], 16, 14 + i * 17);
  }
}
