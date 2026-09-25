/**
 * プルン系（あおプルン・みどりプルン・くろプルン・プルンの王）と
 * ボムプルン系（ボムプルン・だいばくはつプルン）のリグ。
 *
 * どれも同じ「ゼリーの丸屋根」を描く関数から作る。
 *   slime  (S) … 先の尖った雫の形。あお → みどり（毒の泡）→ くろ（暗い体・鋭い赤い目）
 *   slimeL (L) … 王。同じ形を大きくし、裾を厚く、映り込みと泡を増やし、金の冠
 *   bomb   (S) … 丸い玉に口金と導火線。火花だけが光る
 *   bombM  (M) … 大きな玉にひび。攻撃で膨らむと、ひびが火の色に光る
 *
 * 光は左上から。形は左右対称なので向きは S だけ（西向きは反転）。
 * ゼリーらしさ：左上の大きな映り込み、右下の縁の 1 ドット内側に光が透ける三日月、
 * 床に触れる底が一番暗い。
 */

import {
  type AnimDef, type DrawDir, type Pose, type Rig, type Variant, mat, registerRig, registerSpecies,
} from '../rig.js';
import { type PixBuf, runs } from '../pixbuf.js';
import { PAL_HEX, ci } from '../palette.js';

// ---------------------------------------------------------------------------
// 飾りのビット（Variant.flags）
// ---------------------------------------------------------------------------

/** 体の中に毒の泡 */
const F_BUBBLE = 1;
/** 鋭い目（くろプルン） */
const F_MEAN = 2;
/** 冠（王） */
const F_CROWN = 4;
/** ひび（だいばくはつプルン） */
const F_CRACK = 8;

const R = Math.round;
const clampI = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// 体の形
// ---------------------------------------------------------------------------

/** 行ごとの左右の端（含む）。塗らない行は x0 > x1 */
interface Body {
  cx: number;
  /** 丸みの楕円（陰の計算に使う。小数） */
  cy: number;
  rx: number;
  ry: number;
  /** 一番上の行（尖りを含む）・丸屋根の一番上の行・一番下の行（足元） */
  top: number;
  dome: number;
  base: number;
  x0: Int16Array;
  x1: Int16Array;
}

const makeBody = (): Body => ({
  cx: 0, cy: 0, rx: 0, ry: 0, top: 0, dome: 0, base: 0,
  x0: new Int16Array(128), x1: new Int16Array(128),
});

const inside = (o: Body, x: number, y: number): boolean =>
  y >= o.top && y <= o.base && x >= o.x0[y] && x <= o.x1[y];

interface ShapeSpec {
  cx: number;
  base: number;
  /** 横の半径（中心の列から端まで） */
  rx: number;
  /** 丸屋根の行数（足元の行を含む）。1 増やすと上端が 1 ドット上がる */
  h: number;
  /** 楕円の下を何行ぶん切るか（大きいほど裾が広く平ら） */
  cut: number;
  /** 上端の横ずれ（ゼリーの揺れ）。足元は動かない */
  lean: number;
  /** 一番下の行を左右に何ドット広げるか（負で角を丸める） */
  foot: number;
  /** 下から 2 行目・3 行目も広げる（王の厚い裾） */
  foot2: number;
  foot3: number;
  /** 先の尖り（行数 0〜3）と、その曲がり（-1・0・1） */
  tip: number;
  curl: number;
}

function shapeBody(o: Body, s: ShapeSpec): void {
  o.x0.fill(1);
  o.x1.fill(0);
  const domeTop = s.base - s.h + 1;
  const ry = (s.h + s.cut) / 2;
  const cy = domeTop - 0.5 + ry;
  const rx = s.rx + 0.5;
  o.cx = s.cx;
  o.cy = cy;
  o.rx = rx;
  o.ry = ry;
  o.base = s.base;
  o.dome = domeTop;
  const span = Math.max(1, s.base - domeTop);
  const shear = (y: number): number => R((s.lean * (s.base - y)) / span);
  for (let y = domeTop; y <= s.base; y++) {
    const dy = y - cy;
    const t = 1 - (dy * dy) / (ry * ry);
    let hw = Math.floor(rx * Math.sqrt(Math.max(0, t)));
    if (y === s.base) hw += s.foot;
    if (y === s.base - 1) hw += s.foot2;
    if (y === s.base - 2) hw += s.foot3;
    const sh = shear(y);
    o.x0[y] = s.cx - hw + sh;
    o.x1[y] = s.cx + hw + sh;
  }
  // 先の尖り：上ほど細く、一番上が少し曲がる
  let top = domeTop;
  for (let k = 1; k <= s.tip; k++) {
    const y = domeTop - k;
    const hw = s.tip - k;
    const bend = (k === s.tip ? s.curl : 0) + shear(domeTop);
    o.x0[y] = s.cx - hw + bend;
    o.x1[y] = s.cx + hw + bend;
    top = y;
  }
  o.top = top;
}

// ---------------------------------------------------------------------------
// 塗り
// ---------------------------------------------------------------------------

/** 左上・手前からの光（おおよそ正規化） */
const LX = -0.5;
const LY = -0.62;
const LZ = 0.6;

interface ShadeSpec {
  /** 光の段の閾値（明 → 地 → 影） */
  hi: number;
  mid: number;
  lo: number;
  /** 体の段を下げる（Variant.params.dark。暗い体の種を作るとき） */
  dark: number;
  /** 大きな面は段の境を市松でぼかす */
  ditherEdge: boolean;
  /** 透ける光の三日月の段（縁に沿う所と、いちばん奥） */
  innerStep: number;
  innerHi: number;
}

function shadeBody(b: PixBuf, o: Body, v: Readonly<Variant>, s: ShadeSpec): void {
  const body = (step: number): number => mat(v, 'body', Math.max(1, step - s.dark));
  for (let y = o.top; y <= o.base; y++) {
    const x0 = o.x0[y];
    const x1 = o.x1[y];
    if (x0 > x1) continue;
    const mid = (x0 + x1) / 2;
    for (let x = x0; x <= x1; x++) {
      const nx = (x - mid) / o.rx;
      const ny = Math.max(-1, (y - o.cy) / o.ry);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const d = LX * nx + LY * ny + LZ * nz;
      let step = d > s.hi ? 4 : d > s.mid ? 3 : d > s.lo ? 2 : 1;
      if (s.ditherEdge && ((x + y) & 1) === 0) {
        if (step === 3 && d < s.mid + 0.05) step = 2;
        else if (step === 4 && d < s.hi + 0.04) step = 3;
      }
      b.set(x, y, body(step));
    }
  }
  // 底：床に触れる行は一番暗い
  for (let x = o.x0[o.base]; x <= o.x1[o.base]; x++) b.set(x, o.base, body(1));
  // 透ける光：右下の縁の 1 ドット内側に三日月
  for (let y = o.dome + 1; y < o.base - 1; y++) {
    const x0 = o.x0[y];
    const x1 = o.x1[y];
    if (x0 > x1) continue;
    const mid = (x0 + x1) / 2;
    for (let x = x0 + 1; x < x1; x++) {
      const nx = (x - mid) / o.rx;
      const ny = (y - o.cy) / o.ry;
      if (nx < 0.1 || ny < -0.2) continue;
      const edge = !inside(o, x + 2, y) || !inside(o, x + 1, y + 2) || !inside(o, x, y + 2);
      const deep = !inside(o, x + 1, y) || !inside(o, x, y + 1) || !inside(o, x + 1, y + 1);
      if (edge && !deep) b.set(x, y, mat(v, 'inner', nx + ny > 0.95 ? s.innerHi : s.innerStep));
    }
  }
}

// ---------------------------------------------------------------------------
// 顔（目と口）。左目の形を描き、右目は反転して置く
//   e = 目の暗い色、f = 目の下の少し明るい色、g = 光、r = 鋭い目の瞳
// ---------------------------------------------------------------------------

type Face = Readonly<Record<string, readonly string[]>>;

const EYES_S: Face = {
  open: ['ge', 'ee', 'ff'],
  squint: ['..', 'ee', '..'],
  sleep: ['..', '..', 'ee'],
  hurt: ['e.', '.e', 'e.'],
};

const EYES_S_MEAN: Face = {
  open: ['e..', '.ee', '.rg'],
  squint: ['e..', '.ee', '...'],
  sleep: ['...', '...', 'ee.'],
  hurt: ['e.', '.e', 'e.'],
};

const EYES_L: Face = {
  open: ['.eee.', 'ggeee', 'ggeee', 'eeeee', 'eeeee', '.fff.'],
  squint: ['.....', '.....', '.....', 'eeeee', '.eee.', '.....'],
  sleep: ['.....', '.....', '.....', 'e...e', '.eee.', '.....'],
  hurt: ['ee...', '..ee.', '....e', '..ee.', 'ee...', '.....'],
};

const MOUTH_S: Face = {
  shut: ['m...m', '.mmm.'],
  mean: ['mmmmm', '.w.w.'],
  open: ['.mmm.', '.mtm.'],
  wide: ['.mmm.', 'mmtmm', '.mtm.'],
};

const MOUTH_L: Face = {
  shut: ['m.........m', '.mm.....mm.', '...mmmmm...'],
  open: ['..mmmmmmm..', '.mmttttmmm.', '..mmmmmmm..'],
  wide: ['..mmmmmmm..', '.mmmmmmmmm.', 'mmmmtttmmmm', '.mmtuuutmm.', '..mmmmmmm..'],
};

/**
 * 目と口を置く。丸い目は右目も反転せずに置き、光を両目とも左上にそろえる。
 * 形が左右で違う目（怒り・鋭い目・つぶった目）は右目を反転する
 */
function drawFace(
  b: PixBuf, v: Readonly<Variant>, cx: number, eyeY: number, gap: number,
  eyes: readonly string[], mouth: readonly string[], mouthY: number, mirrorRight = true,
): void {
  const map = {
    e: mat(v, 'eye', 0),
    f: mat(v, 'eye', 1),
    g: mat(v, 'glint', 5),
    r: mat(v, 'pupil', 4),
    m: mat(v, 'eye', 0),
    t: mat(v, 'tongue', 3),
    u: mat(v, 'tongue', 4),
    w: mat(v, 'glint', 4),
  };
  const w = eyes[0].length;
  runs(b, cx - gap - w + 1, eyeY, eyes, map, false);
  runs(b, cx + gap, eyeY, eyes, map, mirrorRight);
  const mw = mouth[0].length;
  runs(b, cx - (mw >> 1), mouthY, mouth, map);
}

const eyeKey = (p: Readonly<Pose>): string =>
  p.eyes >= 1.5 ? (p.mouth > 0.5 ? 'hurt' : 'sleep') : p.eyes >= 0.5 ? 'squint' : 'open';

const mouthKey = (p: Readonly<Pose>, mean: boolean): string =>
  p.mouth >= 1.5 ? 'wide' : p.mouth >= 0.5 ? 'open' : mean ? 'mean' : 'shut';

// ---------------------------------------------------------------------------
// プルン（S・L 共通）
// ---------------------------------------------------------------------------

interface SlimeSize {
  cx: number;
  ay: number;
  rx: number;
  h: number;
  cut: number;
  foot: number;
  foot2: number;
  foot3: number;
  tip: number;
  /** 大きな絵（王）か。姿勢の値を 2 倍にし、顔と映り込みを大きくする */
  large: boolean;
  /** 画用紙の上の余白（これより上へは描かない） */
  ceil: number;
}

const CROWN_H = 12;
const body = makeBody();

function drawSlime(b: PixBuf, p: Readonly<Pose>, v: Readonly<Variant>, z: SlimeSize): void {
  const flags = v.flags ?? 0;
  const grow = v.grow ?? 0;
  const k = z.large ? 2 : 1;
  const rx = clampI(z.rx + (grow >> 1) + R(p.sqX * k), 4, z.cx - 3 - Math.max(0, z.foot));
  const h = Math.max(6, z.h + grow + R(p.sqY * k));
  // 頭（冠）が画用紙の上へ出ないように、跳ぶ高さだけを抑える
  const top = z.ay - h + 1 - z.tip - (flags & F_CROWN ? CROWN_H - 2 : 0);
  const bob = Math.min(0, Math.max(R(p.bob * k), z.ceil - top));
  const base = z.ay + bob;
  const air = bob < 0;
  shapeBody(body, {
    cx: z.cx, base, rx, h, cut: z.cut, lean: R(p.lean * k),
    foot: air ? Math.min(0, z.foot) : z.foot, foot2: air ? 0 : z.foot2, foot3: air ? 0 : z.foot3,
    tip: z.tip, curl: p.sway > 0.4 ? 1 : p.sway < -0.4 ? -1 : 0,
  });
  const innerStep = v.params?.inner ?? 4;
  const innerHi = v.params?.innerHi ?? innerStep + 1;
  shadeBody(b, body, v, {
    hi: 0.8, mid: 0.42, lo: 0.02, dark: v.params?.dark ?? 0, ditherEdge: z.large,
    innerStep, innerHi,
  });
  // 跳んだ瞬間（当たりのコマ）：床に跳ねたしずくが 2 つ
  if (p.fx2 > 0.5 && air) {
    const y = Math.min(z.ay - 1, base + 2);
    const dx = Math.min(rx + (z.large ? 2 : 1), z.cx - 3 - (z.large ? 1 : 0));
    const drop = z.large ? ['.h', 'hh'] : ['h'];
    runs(b, z.cx - dx - (z.large ? 1 : 0), y, drop, { h: mat(v, 'body', 4) });
    runs(b, z.cx + dx, y, drop, { h: mat(v, 'body', 4) }, true);
  }
  const lx = R(p.lean * k * 0.5);
  const cx = z.cx + lx;
  // 泡（毒）：体の中の大小の泡。大きい泡は左上が明るい 2×2
  if (flags & F_BUBBLE) {
    const bx = cx + R(body.rx * 0.35);
    const by = R(body.cy - body.ry * 0.45);
    runs(b, bx, by, ['hn', 'nn'], { h: mat(v, 'inner', innerHi), n: mat(v, 'inner', innerStep) });
    b.set(bx - 2, by + 3, mat(v, 'inner', innerHi));
    if (flags & F_MEAN) b.set(bx + 3, by - 1, mat(v, 'inner', innerHi));
  }
  const hl = { h: mat(v, 'body', 5), w: mat(v, 'spec', 5), i: mat(v, 'body', 4), n: mat(v, 'inner', innerHi) };
  if (z.large) {
    // 王：大きな窓の映り込み、右上の小さな光、中の泡、底に集まる光
    const hx = cx - R(body.rx * 0.66);
    const hy = R(body.cy - body.ry * 0.78);
    runs(b, hx, hy, [
      '....hhhh',
      '..hhwwh.',
      '.hww....',
      'hwh.....',
      'hh......',
      'h.......',
      'h.......',
    ], hl);
    runs(b, hx + 1, hy + 9, ['i', 'i'], hl);
    runs(b, cx + R(body.rx * 0.42), hy + 1, ['hh.', '..i'], hl);
    runs(b, cx + R(body.rx * 0.5), R(body.cy - 1), ['.n.', 'n.n', '.n.'], hl);
    runs(b, cx + R(body.rx * 0.3), R(body.cy + 3), ['in', 'nn'], hl);
  } else {
    const hx = cx - R(body.rx * 0.64);
    const hy = R(body.cy - body.ry * 0.74);
    runs(b, hx, hy, ['.hh', 'hw.', 'h..'], hl);
  }
  // 目と口：体の中に収める
  const mean = (flags & F_MEAN) !== 0;
  if (z.large) {
    const eyeY = clampI(R(body.cy) - 6, body.dome + 5, base - 12);
    const eyes = EYES_L[eyeKey(p)] ?? EYES_L.open;
    const mouth = MOUTH_L[mouthKey(p, false)] ?? MOUTH_L.shut;
    drawFace(b, v, cx, eyeY, 6, eyes, mouth, Math.min(eyeY + 7, base - 1 - mouth.length),
      eyes !== EYES_L.open);
  } else {
    const eyeY = clampI(R(body.cy) - 3, body.dome + 2, base - 6);
    const eyes = (mean ? EYES_S_MEAN : EYES_S)[eyeKey(p)] ?? EYES_S.open;
    const mouth = MOUTH_S[mouthKey(p, mean)] ?? MOUTH_S.shut;
    drawFace(b, v, cx, eyeY, mean ? 1 : 2, eyes, mouth, Math.min(eyeY + 4, base - 1 - mouth.length),
      eyes !== EYES_S.open);
  }
  if (flags & F_CROWN) drawCrown(b, v, z.cx + R(p.lean * k), body.dome, p.glow);
  // 癒やしの詠唱：冠のまわりに光の粒（魔法なので光る色）。glow で数と大きさが増える
  if (p.glow > 0.25 && v.ramps.magic) {
    const star = { a: mat(v, 'magic', 4), W: mat(v, 'magic', 5) };
    const big = ['.a.', 'aWa', '.a.'];
    const dot = ['W'];
    const top = body.dome - (flags & F_CROWN ? CROWN_H : 2);
    const pts: readonly (readonly [number, number, number])[] = [
      [-13, 4, 0.25], [12, 1, 0.5], [-8, -2, 0.75], [15, 9, 0.9], [-16, 12, 0.9],
    ];
    for (const [dx, dy, from] of pts) {
      if (p.glow < from) continue;
      const shape = p.glow - from > 0.2 ? big : dot;
      runs(b, z.cx + dx - (shape === big ? 1 : 0), Math.max(z.ceil, top + dy), shape, star);
    }
  }
}

/** 王の冠。丸屋根の上（dome）に 2 行めり込ませて載せる。glow で宝石が光る */
function drawCrown(b: PixBuf, v: Readonly<Variant>, cx: number, dome: number, glow: number): void {
  const lit = glow > 0.5;
  runs(b, cx - 10, dome - CROWN_H + 2, [
    '..........c..........',
    '.c.......cbc.......c.',
    'cbc.....cbrba.....cba',
    '.ba....cbbqbba....ba.',
    '.bba..cbbbbbbba..bba.',
    '.bbbacbbbbbbbbbacbba.',
    '.bbbbbbbbbbbbbbbbbba.',
    'cddddddddddddddddddda',
    'cbbbsbbbbbrbbbbbsbbba',
    'cbbbqbbbbbqbbbbbqbbba',
    'aaaaaaaaaaaaaaaaaaaaa',
    '.ddddddddddddddddddd.',
  ], {
    a: mat(v, 'crown', 2),
    b: mat(v, 'crown', 3),
    c: mat(v, 'crown', 4),
    d: mat(v, 'crown', 1),
    r: mat(v, 'gem', lit ? 5 : 4),
    s: mat(v, 'gem', lit ? 4 : 3),
    q: mat(v, 'gem', 2),
  });
}

// ---------------------------------------------------------------------------
// 動き（プルン）
// ---------------------------------------------------------------------------

/** 動きの表の 1 コマ（書かないつまみは 0） */
export interface Key {
  bob?: number;
  sqX?: number;
  sqY?: number;
  sway?: number;
  lean?: number;
  eyes?: number;
  mouth?: number;
  glow?: number;
  fx?: number;
  fx2?: number;
  armF?: number;
  legL?: number;
  legR?: number;
  head?: number;
}

/** コマごとの表から姿勢を作る動き（カエル・魚も使う） */
export function table(frames: readonly Key[], fps: number, loop: boolean, strike?: number): AnimDef {
  return {
    frames: frames.length, fps, loop, strike,
    pose(i: number, _n: number, out: Pose): void {
      const t = frames[i] ?? frames[0];
      out.bob = t.bob ?? 0;
      out.sqX = t.sqX ?? 0;
      out.sqY = t.sqY ?? 0;
      out.sway = t.sway ?? 0;
      out.lean = t.lean ?? 0;
      out.eyes = t.eyes ?? 0;
      out.mouth = t.mouth ?? 0;
      out.glow = t.glow ?? 0;
      out.fx = t.fx ?? 0;
      out.fx2 = t.fx2 ?? 0;
      out.armF = t.armF ?? 0;
      out.legL = t.legL ?? 0;
      out.legR = t.legR ?? 0;
      out.head = t.head ?? 0;
    },
  };
}

/** 待機：ゼリーが 1 ドット沈み、横に 1 ドット張って戻る。先がゆれる */
const slimeIdle = table([
  { sway: -1 },
  { sqY: -1 },
  { sqY: -1, sqX: 0.5, sway: 1 },
  {},
], 4, true);

/** 跳ねる：縮む → 伸びて跳ぶ → 頂点 → 落ちる */
const slimeHop = table([
  { sqX: 1.5, sqY: -2 },
  { bob: -3, sqX: -1, sqY: 2, sway: -1 },
  { bob: -5, sqY: 1, sway: -1 },
  { bob: -2, sqX: -0.5, sqY: 1, sway: 1 },
], 10, true);

/** 体当たり：沈む（溜め）→ 深く溜める → 伸び上がって飛びかかる（当たり）→ 潰れる → 戻る */
const slimePounce = table([
  { sqX: 1, sqY: -1, eyes: 1 },
  { sqX: 1.5, sqY: -3, eyes: 1 },
  { bob: -3, sqX: -0.5, sqY: 2, mouth: 2, fx2: 1 },
  { sqX: 1.5, sqY: -2, eyes: 1, mouth: 1 },
  { sqY: 1 },
], 15, false, 2);

/** 被弾：後ろへ傾いて潰れ、目をつぶる */
const slimeHurt = table([
  { lean: -2, sqX: 1, sqY: -2, eyes: 2, mouth: 1 },
  { lean: -1, sqY: -1, eyes: 2, mouth: 1 },
], 12, false);

/** 眠り：目を閉じ、ゆっくり沈む */
const slimeSleep = table([
  { eyes: 2, sqY: -1 },
  { eyes: 2, sqY: -2, sqX: 0.5 },
], 2, true);

/** 詠唱（王の癒やし）：伸び上がり、冠の宝石が光る */
const slimeCast = table([
  {},
  { sqY: -1, sqX: 0.5, glow: 0.3, eyes: 1 },
  { sqY: 1, glow: 0.6, eyes: 1 },
  { sqY: 2, sqX: -0.5, glow: 0.9, eyes: 1 },
  { sqY: 2, sqX: -0.5, glow: 1, mouth: 1 },
  { glow: 0.3 },
], 12, false, 4);

// ---------------------------------------------------------------------------
// リグ：プルン
// ---------------------------------------------------------------------------

const SLIME_S: SlimeSize = {
  cx: 12, ay: 21, rx: 7, h: 11, cut: 2, foot: -1, foot2: 0, foot3: 0, tip: 2, large: false, ceil: 3,
};

const SLIME_L: SlimeSize = {
  cx: 32, ay: 60, rx: 21, h: 29, cut: 4, foot: 2, foot2: 1, foot3: 0, tip: 3, large: true, ceil: 3,
};

const slime: Rig = {
  id: 'slime', tier: 'S', dirs: 1,
  anims: { idle: slimeIdle, walk: slimeHop, attack: slimePounce, hurt: slimeHurt, sleep: slimeSleep },
  build(b: PixBuf, p: Readonly<Pose>, _dir: DrawDir, v: Readonly<Variant>): void {
    drawSlime(b, p, v, SLIME_S);
  },
};

const slimeL: Rig = {
  id: 'slimeL', tier: 'L', dirs: 1,
  // 冠の明るい金は縁の光で 1 段上がると光る色（金の 5 段目）になるので、そのまま残す
  finish: { keep: new Set([ci('gold', 4)]) },
  anims: {
    idle: slimeIdle, walk: slimeHop, attack: slimePounce, hurt: slimeHurt, sleep: slimeSleep,
    cast: slimeCast,
  },
  build(b: PixBuf, p: Readonly<Pose>, _dir: DrawDir, v: Readonly<Variant>): void {
    drawSlime(b, p, v, SLIME_L);
  },
};

// ---------------------------------------------------------------------------
// ボムプルン（S・M 共通）
// ---------------------------------------------------------------------------

interface BombSize {
  cx: number;
  ay: number;
  rx: number;
  h: number;
  large: boolean;
  ceil: number;
}

/** 火花の形。コマごとに入れ替える（W = いちばん明るい、a = 火の粉） */
const SPARKS: readonly (readonly string[])[] = [
  ['.a.', 'aWa', '.a.'],
  ['a.a', '.W.', 'a.a'],
];
const SPARK_BIG: readonly string[] = ['a.a.a', '.aWa.', 'aWWWa', '.aWa.', 'a.a.a'];

/** 導火線（下が口金の上。右へ曲がって上る） */
const FUSE_S: readonly string[] = ['.f', 'f.', 'f.'];
const FUSE_M: readonly string[] = ['..f', '.f.', '.f.', 'f..', 'f..'];

/** 怒った目（左目。右目は反転） */
const BOMB_EYES_S: Face = {
  open: ['e..', '.ee', '.ge'],
  squint: ['e..', '.ee', '...'],
  sleep: ['...', '...', 'ee.'],
  hurt: ['e.', '.e', 'e.'],
};
const BOMB_EYES_M: Face = {
  open: ['ee...', '.eeee', '.egee', '..ee.'],
  squint: ['ee...', '.eeee', '.....', '.....'],
  sleep: ['.....', '.....', 'eeee.', '.....'],
  hurt: ['e....', '.ee..', '...e.', '.ee..'],
};
const BOMB_MOUTH_S: Face = {
  shut: ['.mmm.', 'm...m'],
  open: ['.mm.', 'mttm', '.mm.'],
  wide: ['.mmm.', 'mtttm', '.mmm.'],
};
const BOMB_MOUTH_M: Face = {
  shut: ['..mmm..', '.m...m.', 'm.....m'],
  open: ['.mmm.', 'mtttm', '.mmm.'],
  wide: ['.mmmmm.', 'mmtttmm', 'mtuuutm', '.mmmmm.'],
};

/** ひび（体の中心からの位置と形）。c = 筋、d = 細い先 */
const CRACKS: readonly { x: number; y: number; rows: readonly string[] }[] = [
  { x: 0.05, y: -0.92, rows: ['c...', '.c..', '.cc.', '...c', '..d.'] },
  { x: -0.72, y: -0.15, rows: ['cc..', '..c.', '.c..', '.dc.', '...d'] },
  { x: 0.42, y: 0.12, rows: ['...c', '..c.', '.cc.', 'd...'] },
];

function drawBomb(b: PixBuf, p: Readonly<Pose>, v: Readonly<Variant>, z: BombSize): void {
  const flags = v.flags ?? 0;
  const k = z.large ? 2 : 1;
  const fuse = z.large ? FUSE_M : FUSE_S;
  const rx = clampI(z.rx + R(p.sqX * k), 4, z.cx - 3);
  // 導火線と火花が画用紙に収まるだけ膨らむ
  const room = z.ay - z.ceil + 1 - (fuse.length + 2 + 2);
  const h = clampI(z.h + R(p.sqY * k), 6, room);
  const bob = Math.min(0, R(p.bob * k));
  const base = z.ay + bob;
  shapeBody(body, {
    cx: z.cx, base, rx, h, cut: 1, lean: R(p.lean * k), foot: -1, foot2: 0, foot3: 0, tip: 0, curl: 0,
  });
  shadeBody(b, body, v, {
    hi: 0.78, mid: 0.4, lo: 0.0, dark: 0, ditherEdge: z.large, innerStep: 4, innerHi: 5,
  });
  const cx = z.cx + R(p.lean * k * 0.5);
  // ひび：ふだんは暗い筋、膨らむと火の色に光る
  if (flags & F_CRACK) {
    const hot = p.glow;
    // ふだんも中の火がうっすら見える（光らない段）。膨らむと光る段へ
    const map = {
      c: hot > 0.7 ? mat(v, 'crack', 5) : hot > 0.3 ? mat(v, 'crack', 4) : mat(v, 'crack', 2),
      d: hot > 0.7 ? mat(v, 'crack', 4) : hot > 0.3 ? mat(v, 'crack', 3) : mat(v, 'body', 1),
    };
    for (const c of CRACKS) {
      runs(b, cx + R(c.x * body.rx), R(body.cy + c.y * body.ry), c.rows, map);
    }
  }
  // 映り込み
  const hl = { h: mat(v, 'body', 5), w: mat(v, 'spec', 5) };
  const hx = cx - R(body.rx * 0.64);
  const hy = R(body.cy - body.ry * 0.72);
  if (z.large) runs(b, hx, hy, ['..hhh', '.hww.', 'hw...', 'h....', 'h....'], hl);
  else runs(b, hx, hy, ['.hh', 'hw.', 'h..'], hl);
  // 怒った目と、への字の口
  const key = eyeKey(p);
  const mk = p.mouth >= 1.5 ? 'wide' : p.mouth >= 0.5 ? 'open' : 'shut';
  if (z.large) {
    const eyeY = clampI(R(body.cy) - 5, body.dome + 3, base - 10);
    const mouth = BOMB_MOUTH_M[mk];
    drawFace(b, v, cx, eyeY, 2, BOMB_EYES_M[key], mouth, Math.min(eyeY + 6, base - 1 - mouth.length));
  } else {
    const eyeY = clampI(R(body.cy) - 3, body.dome + 2, base - 6);
    const mouth = BOMB_MOUTH_S[mk];
    drawFace(b, v, cx, eyeY, 1, BOMB_EYES_S[key], mouth, Math.min(eyeY + 4, base - 1 - mouth.length));
  }
  // 口金・導火線・火花
  const capX = z.cx + R(p.lean * k);
  const capTop = body.dome - 2;
  const cap = { a: mat(v, 'cap', 2), b: mat(v, 'cap', 3), c: mat(v, 'cap', 4), d: mat(v, 'cap', 1) };
  if (z.large) runs(b, capX - 3, capTop, ['.cbba.', 'cbbbad', 'dddddd'], cap);
  else runs(b, capX - 2, capTop, ['cbba', 'dddd'], cap);
  const sw = p.sway > 0.4 ? 1 : 0;
  const fx = capX + (z.large ? -1 : 0);
  const fy = capTop - fuse.length;
  runs(b, fx + sw, fy, fuse, { f: mat(v, 'fuse', 3) });
  const tipX = fx + sw + fuse[0].indexOf('f');
  const big = p.glow > 0.7;
  const sp = big ? SPARK_BIG : SPARKS[(R(p.fx2) % 2 + 2) % 2];
  const half = sp.length >> 1;
  runs(b, tipX - half, Math.max(z.ceil, fy - 1 - half), sp, {
    a: mat(v, 'spark', 4), W: mat(v, 'spark', 5),
  });
}

/** 待機：導火線の火花がぱちぱち変わる。体は 1 ドットだけ息をする */
const bombIdle = table([
  { fx2: 0 },
  { fx2: 1, sway: 1 },
  { fx2: 0, sqY: -1, sqX: 0.5 },
  { fx2: 1 },
], 4, true);

/** 跳ねる（重いので低く） */
const bombHop = table([
  { sqX: 1, sqY: -1, fx2: 0 },
  { bob: -2, sqX: -0.5, sqY: 1, fx2: 1, sway: 1 },
  { bob: -3, fx2: 0, sway: 1 },
  { bob: -1, sqY: 1, fx2: 1 },
], 10, true);

/** 膨らむ：縮んで溜める → 膨らむ → いちばん膨らむ（当たり）→ しぼむ → 戻る */
const bombSwell = table([
  { sqX: -1, sqY: -1, eyes: 1, fx2: 0 },
  { sqX: 1, sqY: 1, glow: 0.5, mouth: 1, fx2: 1 },
  { sqX: 2, sqY: 2, glow: 1, eyes: 1, mouth: 2, fx2: 0 },
  { sqX: 1, sqY: 0.5, glow: 0.5, mouth: 1, fx2: 1 },
  { fx2: 0 },
], 15, false, 2);

const bombHurt = table([
  { lean: -2, sqX: 1, sqY: -1, eyes: 2, mouth: 1, fx2: 0 },
  { lean: -1, eyes: 2, mouth: 1, fx2: 1 },
], 12, false);

const bombSleep = table([
  { eyes: 2, fx2: 0 },
  { eyes: 2, sqY: -1, fx2: 1 },
], 2, true);

const BOMB_S: BombSize = { cx: 12, ay: 21, rx: 7, h: 12, large: false, ceil: 2 };
const BOMB_M: BombSize = { cx: 16, ay: 37, rx: 10, h: 20, large: true, ceil: 3 };

const bomb: Rig = {
  id: 'bomb', tier: 'S', dirs: 1,
  anims: { idle: bombIdle, walk: bombHop, attack: bombSwell, hurt: bombHurt, sleep: bombSleep },
  build(b: PixBuf, p: Readonly<Pose>, _dir: DrawDir, v: Readonly<Variant>): void {
    drawBomb(b, p, v, BOMB_S);
  },
};

const bombM: Rig = {
  id: 'bombM', tier: 'M', dirs: 1,
  anims: { idle: bombIdle, walk: bombHop, attack: bombSwell, hurt: bombHurt, sleep: bombSleep },
  build(b: PixBuf, p: Readonly<Pose>, _dir: DrawDir, v: Readonly<Variant>): void {
    drawBomb(b, p, v, BOMB_M);
  },
};

registerRig(slime);
registerRig(slimeL);
registerRig(bomb);
registerRig(bombM);

registerSpecies({
  slimeBlue: {
    rig: 'slime',
    variant: {
      ramps: { body: 'water', inner: 'water', eye: 'water', glint: 'bone', spec: 'steel', tongue: 'rose' },
    },
  },
  slimeGreen: {
    rig: 'slime',
    variant: {
      ramps: { body: 'leaf', inner: 'leaf', eye: 'moss', glint: 'bone', spec: 'bone', tongue: 'rose' },
      flags: F_BUBBLE, grow: 1,
    },
  },
  slimeBlack: {
    rig: 'slime',
    variant: {
      ramps: {
        body: 'ink', inner: 'violet', eye: 'ink', glint: 'bone', pupil: 'crimson', spec: 'steel',
        tongue: 'crimson',
      },
      flags: F_BUBBLE | F_MEAN, grow: 2, params: { inner: 3, innerHi: 3 },
    },
  },
  slimeKing: {
    rig: 'slimeL',
    variant: {
      ramps: {
        body: 'indigo', inner: 'violet', eye: 'indigo', glint: 'bone', spec: 'bone', tongue: 'rose',
        crown: 'gold', gem: 'crimson', magic: 'sky',
      },
      flags: F_CROWN, params: { inner: 3, innerHi: 3 },
    },
  },
  bombSlime: {
    rig: 'bomb',
    variant: {
      ramps: {
        body: 'crimson', inner: 'crimson', eye: 'crimson', glint: 'bone', spec: 'bone',
        tongue: 'ember', cap: 'steel', fuse: 'bone', spark: 'ember',
      },
    },
    light: { color: PAL_HEX[ci('ember', 4)], radius: 1, intensity: 0.35 },
  },
  bombGiant: {
    rig: 'bombM',
    variant: {
      ramps: {
        body: 'crimson', inner: 'crimson', eye: 'crimson', glint: 'bone', spec: 'bone',
        tongue: 'ember', cap: 'steel', fuse: 'bone', spark: 'ember', crack: 'ember',
      },
      flags: F_CRACK,
    },
    light: { color: PAL_HEX[ci('ember', 4)], radius: 1.5, intensity: 0.45 },
  },
});
