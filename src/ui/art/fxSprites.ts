/**
 * 演出のドット絵（DOM 無し）。粒子や HD の光では出しにくい「形のある」演出だけをここに置く。
 *
 * - 状態異常の飾り（眠りの Z・混乱の星・麻痺の火花・毒の泡…）：14×14、4 コマ
 * - 飛び道具：矢（8 方向）、魔法の玉（4 コマ）
 * - 当たりの火花（16×16、4 コマ）、爆発（32×32、6 コマ）
 *
 * どれも決まった絵（乱数を使わない。形の揺らぎは座標のハッシュ）。
 * 光る色（ember 3–5・gold 5・白…）で描いた所はブルームに乗る。
 */

import type { RampName } from './palette.js';
import { WHITE, ci } from './palette.js';
import { PixBuf, disc, ellipse, hline, line, rect, runs, vline } from './pixbuf.js';
import { finalize } from './shade.js';
import { hash2 } from './hash.js';
import type { StatusId } from '../../core/types.js';

// ---------------------------------------------------------------------------
// 状態異常の飾り
// ---------------------------------------------------------------------------

export const ORN_SIZE = 14;

/** 飾りを置く場所。head = 頭の上、body = 胴の真ん中、feet = 足元 */
export type OrnAnchor = 'head' | 'body' | 'feet';

export interface OrnamentSpec {
  frames: number;
  fps: number;
  anchor: OrnAnchor;
  draw(b: PixBuf, frame: number): void;
}

const Z3 = ['aaa', '.a.', 'a..', 'aaa'];
const Z4 = ['aaaa', '..a.', '.a..', 'aaaa'];
const Z5 = ['aaaaa', '...a.', '..a..', '.a...', 'aaaaa'];
const STAR = ['.a.', 'aba', '.a.'];
const BOLT = ['..a', '.a.', 'aaa', '.a.', 'a..'];

/** 眠りの Z。小・中・大が順に現れて消える（重ならない位置に置く） */
function sleepZ(ramp: RampName) {
  return (b: PixBuf, f: number): void => {
    const show = [[true, false, false], [true, true, false], [true, true, true], [false, true, true]][f];
    const col = { a: ci(ramp, 5) };
    if (show[0]) runs(b, 1, 9, Z3, col);
    if (show[1]) runs(b, 4, 6, Z4, col);
    if (show[2]) runs(b, 8, 1, Z5, col);
  };
}

/** 炎の舌 1 本（下が太く、先が細い。芯は明るい） */
function flameTongue(b: PixBuf, cx: number, base: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const w = t < 0.45 ? 3 : t < 0.8 ? 2 : 1;
    const x0 = cx - (w === 3 ? 1 : 0);
    for (let i = 0; i < w; i++) {
      const core = w === 3 && i === 1 && t > 0.15;
      b.set(x0 + i, base - y, core ? ci('gold', 5) : t < 0.2 ? ci('ember', 3) : t < 0.7 ? ci('ember', 4) : ci('ember', 5));
    }
  }
}

/** 頭の周りを回る星（奥にある間は暗く） */
function orbitStars(ramp: RampName) {
  return (b: PixBuf, f: number): void => {
    for (let k = 0; k < 3; k++) {
      const a = (f / 4) * (Math.PI * 2 / 3) + (k * Math.PI * 2) / 3;
      const x = Math.round(7 + Math.cos(a) * 4.5) - 1;
      const y = Math.round(7 + Math.sin(a) * 2) - 1;
      const back = Math.sin(a) < 0;
      runs(b, x, y, STAR, { a: ci(ramp, back ? 3 : 4), b: back ? ci(ramp, 4) : WHITE });
    }
  };
}

const ORNAMENTS: Partial<Record<StatusId, OrnamentSpec>> = {
  asleep: { frames: 4, fps: 3, anchor: 'head', draw: sleepZ('sky') },
  deepAsleep: { frames: 4, fps: 2, anchor: 'head', draw: sleepZ('indigo') },
  confused: { frames: 4, fps: 8, anchor: 'head', draw: orbitStars('gold') },
  fainted: { frames: 4, fps: 6, anchor: 'head', draw: orbitStars('bone') },
  paralyzed: {
    frames: 4, fps: 10, anchor: 'body',
    draw: (b, f) => {
      // 左右の稲妻が交互に光る
      const left = f % 2 === 0;
      runs(b, left ? 1 : 10, 2 + (f >> 1), BOLT, { a: ci('gold', 5) });
      runs(b, left ? 10 : 2, 6, BOLT.slice(1, 4), { a: ci('sky', 5) });
      b.set(left ? 5 : 8, 11, ci('gold', 5));
    },
  },
  poisoned: { frames: 4, fps: 5, anchor: 'head', draw: bubbles('moss') },
  deadlyPoisoned: { frames: 4, fps: 6, anchor: 'head', draw: bubbles('violet') },
  burning: {
    frames: 4, fps: 10, anchor: 'body',
    draw: (b, f) => {
      // 3 本の炎の舌。コマごとに高さが入れ替わる
      const hts = [[6, 9, 5], [8, 6, 7], [5, 8, 9], [7, 5, 6]][f];
      [3, 7, 10].forEach((x, i) => flameTongue(b, x, 12, hts[i]));
    },
  },
  wet: {
    frames: 4, fps: 6, anchor: 'body',
    draw: (b, f) => {
      for (const [x, y0] of [[3, 1], [9, 4], [6, 7]]) {
        const y = ((y0 + f * 3) % 10) + 1;
        b.set(x, y, ci('sky', 5));
        b.set(x, y + 1, ci('water', 4));
        b.set(x, y + 2, ci('water', 3));
      }
    },
  },
  slow: {
    frames: 4, fps: 3, anchor: 'head',
    draw: (b, f) => {
      // ゆっくり回る渦
      const rows = ['.aaa.', 'a...a', 'a.a.a', 'a..a.', '.a...'];
      const rot = rotate(rows, f);
      runs(b, 4, 4, rot, { a: ci('steel', 4) });
      b.set(6, 6, ci('steel', 5));
    },
  },
  quick: {
    frames: 4, fps: 12, anchor: 'body',
    draw: (b, f) => {
      // 後ろへ流れる速さの筋
      for (const [y, len] of [[3, 5], [6, 7], [9, 4]]) {
        const x = 1 + ((f * 2 + y) % 4);
        hline(b, x, y, len, ci('sky', 4));
        b.set(x + len - 1, y, ci('sky', 5));
      }
    },
  },
  sealed: {
    frames: 4, fps: 4, anchor: 'head',
    draw: (b, f) => {
      const r = f % 2 === 0 ? 4 : 5;
      ellipse(b, 7, 6, r, r - 1, ci('violet', 4), false);
      line(b, 5, 4, 9, 8, ci('violet', 5));
      line(b, 9, 4, 5, 8, ci('violet', 5));
    },
  },
  blind: {
    frames: 4, fps: 4, anchor: 'head',
    draw: (b, f) => {
      // 目の前の暗い靄
      const dx = f % 2;
      disc(b, 4 + dx, 7, 2, ci('ink', 2));
      disc(b, 8 - dx, 6, 3, ci('ink', 3));
      disc(b, 10, 8, 1, ci('ink', 2));
      b.set(7 - dx, 5, ci('stone', 3));
    },
  },
  bound: {
    frames: 4, fps: 4, anchor: 'body',
    draw: (b, f) => {
      // 胴に巻きついた縄（撚りを 1 ドットおきの明暗で見せ、コマごとに撚りがずれる）
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const x = Math.round(7 + Math.cos(a) * 6);
        const y = Math.round(6 + Math.sin(a) * 2);
        b.set(x, y, ((i + f) & 1) === 0 ? ci('earth', 4) : ci('earth', 3));
      }
      // 結び目と垂れた端
      rect(b, 9, 7, 2, 2, ci('earth', 5));
      b.set(9, 9, ci('earth', 4));
      b.set(10, 10 + (f & 1), ci('earth', 3));
      b.set(11, 9, ci('earth', 4));
    },
  },
  terrified: {
    frames: 4, fps: 4, anchor: 'head',
    draw: (b, f) => {
      // 汗のしずくがこめかみを伝う
      const y = 2 + f;
      runs(b, 9, y, ['.a.', 'aab', 'abb', '.b.'], { a: ci('sky', 5), b: ci('sky', 3) });
      if (f >= 2) runs(b, 3, y - 1, ['a', 'b'], { a: ci('sky', 5), b: ci('sky', 3) });
    },
  },
  strUp: {
    frames: 4, fps: 6, anchor: 'head',
    draw: (b, f) => {
      const y = 3 - (f === 1 || f === 2 ? 1 : 0);
      runs(b, 4, y, [
        '..aa..',
        '.abba.',
        'abbbba',
        '..bb..',
        '..bb..',
        '..cc..',
      ], { a: ci('crimson', 5), b: ci('crimson', 4), c: ci('crimson', 3) });
    },
  },
  invincible: {
    frames: 4, fps: 8, anchor: 'body',
    draw: (b, f) => {
      // 金のきらめきが位置を変えて瞬く
      const spots = [[3, 3], [10, 5], [5, 10], [11, 11], [2, 8]];
      spots.forEach(([x, y], i) => {
        if ((i + f) % 2 === 0) {
          runs(b, x - 1, y - 1, STAR, { a: ci('gold', 4), b: WHITE });
        } else {
          b.set(x, y, ci('gold', 5));
        }
      });
    },
  },
};

/** 泡が昇る（毒） */
function bubbles(ramp: RampName) {
  return (b: PixBuf, f: number): void => {
    for (const [x, y0, r] of [[3, 10, 1], [8, 7, 2], [11, 12, 1]]) {
      const y = y0 - ((f * 2) % 8);
      const yy = y < 2 ? y + 9 : y;
      if (r === 2) {
        ellipse(b, x, yy, 2, 2, ci(ramp, 4), false);
        b.set(x - 1, yy - 1, ci(ramp, 5));
      } else {
        rect(b, x, yy, 2, 2, ci(ramp, 4));
        b.set(x, yy, ci(ramp, 5));
      }
    }
  };
}

/** 文字列の絵を 90° ずつ回す（正方形のみ） */
function rotate(rows: readonly string[], quarter: number): string[] {
  let out = rows.slice();
  for (let q = 0; q < (quarter & 3); q++) {
    const n = out.length;
    const next: string[] = [];
    for (let y = 0; y < n; y++) {
      let s = '';
      for (let x = 0; x < n; x++) s += out[n - 1 - x][y];
      next.push(s);
    }
    out = next;
  }
  return out;
}

export const ornamentOf = (id: StatusId): OrnamentSpec | undefined => ORNAMENTS[id];
export const allOrnamentIds = (): StatusId[] => Object.keys(ORNAMENTS) as StatusId[];

/** 飾りの 1 コマを描く（輪郭つき）。飾りの無い状態なら false */
export function buildOrnament(id: StatusId, frame: number, out: PixBuf): boolean {
  const spec = ORNAMENTS[id];
  if (!spec) return false;
  out.clear();
  spec.draw(out, ((frame % spec.frames) + spec.frames) % spec.frames);
  finalize(out);
  return true;
}

// ---------------------------------------------------------------------------
// 飛び道具
// ---------------------------------------------------------------------------

export const ARROW_SIZE = 16;

/** 8 方向の単位（0 = 北から時計回り） */
const DIR8: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

/**
 * 矢（16×16、dir8 の向き）。矢じりは tip の階調、羽は骨色。
 * 斜めは 45° の直線なので二重点が出ない。
 */
export function buildArrow(dir8: number, tip: RampName, out: PixBuf): void {
  out.clear();
  const [dx, dy] = DIR8[dir8 & 7];
  const diag = dx !== 0 && dy !== 0;
  const half = diag ? 4 : 5;
  const cx = 7;
  const cy = 7;
  // 軸
  line(out, cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half, ci('earth', 4));
  // 矢じり（先端と、その根元の左右）
  const tx = cx + dx * (half + 1);
  const ty = cy + dy * (half + 1);
  out.set(tx, ty, ci(tip, 5));
  out.set(cx + dx * half, cy + dy * half, ci(tip, 4));
  const px = -dy;
  const py = dx;
  const bx = cx + dx * (half - 1);
  const by = cy + dy * (half - 1);
  if (diag) {
    out.set(bx + dx, by, ci(tip, 3));
    out.set(bx, by + dy, ci(tip, 3));
  } else {
    out.set(bx + px, by + py, ci(tip, 3));
    out.set(bx - px, by - py, ci(tip, 3));
  }
  // 羽
  const fx = cx - dx * half;
  const fy = cy - dy * half;
  if (diag) {
    out.set(fx - dx, fy, ci('bone', 5));
    out.set(fx, fy - dy, ci('bone', 4));
    out.set(fx - dx, fy + dy, ci('bone', 4));
    out.set(fx + dx, fy - dy, ci('bone', 4));
  } else {
    out.set(fx + px, fy + py, ci('bone', 5));
    out.set(fx - px, fy - py, ci('bone', 4));
    out.set(fx + px - dx, fy + py - dy, ci('bone', 4));
    out.set(fx - px - dx, fy - py - dy, ci('bone', 3));
  }
  finalize(out);
}

export const ORB_SIZE = 12;

/** 魔法の玉（12×12、4 コマで脈打つ）。ramp は属性の色 */
export function buildOrb(frame: number, ramp: RampName, out: PixBuf): void {
  out.clear();
  const f = frame & 3;
  const r = f === 1 || f === 2 ? 4 : 3;
  disc(out, 6, 6, r, ci(ramp, 3));
  disc(out, 6, 6, r - 1, ci(ramp, 4));
  disc(out, 5, 5, 1, ci(ramp, 5));
  out.set(5, 5, WHITE);
  // 回る火花
  const sp = [[1, 6], [6, 1], [11, 6], [6, 11]][f];
  out.set(sp[0], sp[1], ci(ramp, 5));
  finalize(out, { outline: false });
}

// ---------------------------------------------------------------------------
// 当たりの火花・爆発
// ---------------------------------------------------------------------------

export const SPARK_SIZE = 16;
export const SPARK_FRAMES = 4;

/** 当たりの火花（16×16、4 コマ）：白い閃き → 金の星 → 橙の光条 → 散る点 */
export function buildHitSpark(frame: number, out: PixBuf): void {
  out.clear();
  const c = 7;
  switch (frame) {
    case 0:
      disc(out, c, c, 2, WHITE);
      hline(out, c - 4, c, 9, WHITE);
      vline(out, c, c - 4, 9, WHITE);
      break;
    case 1:
      disc(out, c, c, 2, ci('gold', 5));
      out.set(c, c, WHITE);
      hline(out, c - 6, c, 13, ci('gold', 5));
      vline(out, c, c - 6, 13, ci('gold', 5));
      for (let i = 2; i <= 4; i++) {
        for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.set(c + sx * i, c + sy * i, ci('gold', 4));
      }
      break;
    case 2:
      for (let i = 3; i <= 6; i++) {
        const col = i < 5 ? ci('ember', 5) : ci('ember', 4);
        for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.set(c + sx * i, c + sy * i, col);
        if (i <= 5) {
          for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.set(c + sx * (i - 1), c + sy * (i - 1), ci('ember', 3));
        }
      }
      break;
    default:
      for (const [sx, sy] of [[6, 0], [-6, 1], [1, 6], [0, -6], [4, 4], [-4, -5], [5, -4], [-5, 4]]) {
        out.set(c + sx, c + sy, ci('ember', 3));
      }
      break;
  }
}

export const BLAST_SIZE = 32;
export const BLAST_FRAMES = 6;

/**
 * 爆発（32×32、6 コマ）。白い芯 → 金と橙の火の玉 → 赤い輪と煙 → 煙が薄れる。
 * 縁のぎざぎざは座標のハッシュ（毎回同じ形）。
 */
export function buildExplosion(frame: number, out: PixBuf): void {
  out.clear();
  const c = 15.5;
  const radii = [4, 8, 11, 13, 13, 12];
  const R = radii[Math.min(frame, radii.length - 1)];
  for (let y = 0; y < BLAST_SIZE; y++) {
    for (let x = 0; x < BLAST_SIZE; x++) {
      const d = Math.hypot(x - c, y - c);
      const jag = (hash2(x, y, 911 + frame) & 3) - 1.5;
      if (d > R + jag) continue;
      const t = d / R;
      let col = 0;
      switch (frame) {
        case 0: col = t < 0.6 ? WHITE : ci('gold', 5); break;
        case 1: col = t < 0.35 ? WHITE : t < 0.7 ? ci('gold', 5) : ci('ember', 5); break;
        case 2: col = t < 0.25 ? ci('gold', 5) : t < 0.6 ? ci('ember', 5) : t < 0.85 ? ci('ember', 4) : ci('crimson', 4); break;
        case 3:
          col = t < 0.4 ? ci('ember', 4) : t < 0.7 ? ci('ember', 3) : ci('crimson', 3);
          if (t < 0.5 && (hash2(x, y, 3) & 3) === 0) col = ci('ink', 3);
          break;
        case 4:
          // 煙（中が抜けていく）
          if (t < 0.45) continue;
          col = (hash2(x >> 1, y >> 1, 4) & 1) === 0 ? ci('ink', 3) : ci('ink', 2);
          if (t < 0.6 && (hash2(x, y, 5) & 3) === 0) col = ci('ember', 3);
          break;
        default:
          if (t < 0.6 || (hash2(x, y, 6) & 1) === 0) continue;
          col = ci('ink', 2);
          break;
      }
      out.set(x, y, col);
    }
  }
}
