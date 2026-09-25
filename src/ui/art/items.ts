/**
 * 道具の絵（16×16 ドット）。床にも一覧にも同じ絵を使う（床では 3 倍、一覧では 2 倍）。
 *
 * 絵は表（パラメータ）から組み立てる。剣なら「刃の長さ・幅・刃の色・鍔・柄・飾り」、
 * 盾なら「形・縁・面・紋」を 1 行ずつ書けば、34 本の武器と 29 枚の盾が同じ絵柄で揃う。
 *
 * 【正体を漏らさない】草・巻物・杖・腕輪は、種類の絵 1 枚だけにする（道具ごとの絵を作らない）。
 * 壺は正体が分かっているときだけ道具ごとの絵にし、分からないうちは壺の絵にする。
 * どの絵を使うかは iconKeyOf が決める。
 */

import { getItem, tryGetItem } from '../../data/registry.js';
import type { RampName } from './palette.js';
import { WHITE, ci } from './palette.js';
import { PixBuf, disc, ellipse, hline, line, rect, runs, vline } from './pixbuf.js';
import { finalize } from './shade.js';

export const ICON_SIZE = 16;

/** 正体が分からないうちは種類の絵にする種類 */
const CATEGORY_ONLY = new Set(['herb', 'scroll', 'staff', 'bracelet']);

/**
 * 道具の絵の鍵。
 * - 草・巻物・杖・腕輪：必ず種類の絵（'herb' など）
 * - 壺：正体を知っていれば道具ごと、知らなければ 'pot'
 * - それ以外（武器・盾・食料・石・矢・ギタン）：道具ごと（常に正体が分かる種類）
 */
export function iconKeyOf(defId: string, known: boolean): string {
  const def = tryGetItem(defId);
  if (!def) return 'weapon';
  if (CATEGORY_ONLY.has(def.kind)) return def.kind;
  if (def.kind === 'pot') return known && POT_SPEC[defId] ? defId : 'pot';
  if (ICONS.has(defId)) return defId;
  return ICONS.has(def.sprite) ? def.sprite : def.kind;
}

/**
 * 鍵から絵を描く。知らない鍵なら false（何も描かない）。
 * finish = false なら輪郭と縁取りを付ける前の形だけ（形が 1〜14 に収まっているかをテストで見る。
 * 輪郭は外周 0 / 15 まで広がってよい）
 */
export function buildIcon(key: string, out: PixBuf, finish = true): boolean {
  const draw = ICONS.get(key);
  if (!draw) return false;
  out.clear();
  draw(out);
  if (finish) finalize(out);
  return true;
}

export const hasIcon = (key: string): boolean => ICONS.has(key);
export const allIconKeys = (): string[] => [...ICONS.keys()];

// ---------------------------------------------------------------------------
// 描く道具
// ---------------------------------------------------------------------------

type Draw = (b: PixBuf) => void;
const ICONS = new Map<string, Draw>();

/** 左下から右上へ斜めの線（刃・柄） */
function diag(b: PixBuf, x: number, y: number, len: number, c: number): void {
  for (let i = 0; i < len; i++) b.set(x + i, y - i, c);
}

// ---------------------------------------------------------------------------
// 武器
// ---------------------------------------------------------------------------

type WeaponShape = 'sword' | 'dagger' | 'great' | 'katana' | 'axe' | 'hammer' | 'spear'
  | 'staff' | 'pick' | 'boomerang' | 'bow' | 'club' | 'stick' | 'fang' | 'cleaver' | 'twin';

interface WeaponSpec {
  shape: WeaponShape;
  /** 刃・頭の材質 */
  blade: RampName;
  /** 柄の材質 */
  grip: RampName;
  /** 鍔・金具の材質 */
  guard?: RampName;
  /** 光る飾り（宝石・炎・雷） */
  gem?: RampName;
  /** 刃の長さの差（-2〜+2） */
  len?: number;
  /** 刃の模様 */
  motif?: 'flame' | 'bolt' | 'wind' | 'rust' | 'poison' | 'moon' | 'chaos' | 'leaf' | 'fang' | 'coin';
}

const WEAPON_SPEC: Record<string, WeaponSpec> = {
  woodStick: { shape: 'stick', blade: 'earth', grip: 'earth' },
  oakClub: { shape: 'club', blade: 'earth', grip: 'earth' },
  bronzeSword: { shape: 'sword', blade: 'gold', grip: 'earth', guard: 'earth', len: -1 },
  ironSword: { shape: 'sword', blade: 'steel', grip: 'earth', guard: 'stone' },
  steelSword: { shape: 'sword', blade: 'steel', grip: 'indigo', guard: 'gold', len: 1 },
  twinAxe: { shape: 'axe', blade: 'steel', grip: 'earth', guard: 'stone' },
  greatSword: { shape: 'great', blade: 'sky', grip: 'indigo', guard: 'gold', gem: 'sky' },
  rustedSword: { shape: 'sword', blade: 'earth', grip: 'stone', guard: 'stone', motif: 'rust' },
  bambooSpear: { shape: 'spear', blade: 'steel', grip: 'leaf' },
  warHammer: { shape: 'hammer', blade: 'steel', grip: 'earth', guard: 'stone' },
  windBlade: { shape: 'katana', blade: 'sky', grip: 'moss', guard: 'moss', motif: 'wind' },
  flameSword: { shape: 'sword', blade: 'ember', grip: 'crimson', guard: 'gold', gem: 'ember', motif: 'flame' },
  thunderBlade: { shape: 'katana', blade: 'steel', grip: 'indigo', guard: 'gold', gem: 'gold', motif: 'bolt' },
  dragonFang: { shape: 'fang', blade: 'bone', grip: 'crimson', guard: 'leaf' },
  exorcistStaff: { shape: 'staff', blade: 'gold', grip: 'earth', gem: 'gold' },
  metalCleaver: { shape: 'cleaver', blade: 'steel', grip: 'earth', guard: 'stone' },
  vampireFang: { shape: 'dagger', blade: 'crimson', grip: 'ink', guard: 'violet', motif: 'fang' },
  viperDagger: { shape: 'dagger', blade: 'moss', grip: 'ink', guard: 'leaf', motif: 'poison' },
  lullabyBlade: { shape: 'katana', blade: 'indigo', grip: 'violet', guard: 'sky', motif: 'moon' },
  chaosEdge: { shape: 'sword', blade: 'violet', grip: 'ink', guard: 'rose', motif: 'chaos' },
  heavyBlade: { shape: 'great', blade: 'steel', grip: 'earth', guard: 'stone', len: 1 },
  pickaxe: { shape: 'pick', blade: 'steel', grip: 'earth' },
  woodHammer: { shape: 'hammer', blade: 'earth', grip: 'earth' },
  boomerang: { shape: 'boomerang', blade: 'earth', grip: 'crimson' },
  hunterBow: { shape: 'bow', blade: 'earth', grip: 'bone' },
  piercer: { shape: 'sword', blade: 'steel', grip: 'stone', guard: 'steel', len: 2 },
  smithBlade: { shape: 'katana', blade: 'steel', grip: 'crimson', guard: 'gold', len: 1 },
  saplingSword: { shape: 'sword', blade: 'leaf', grip: 'earth', guard: 'leaf', motif: 'leaf', len: -1 },
  miserHammer: { shape: 'hammer', blade: 'gold', grip: 'earth', guard: 'gold', motif: 'coin' },
  flashBlade: { shape: 'katana', blade: 'sky', grip: 'ink', guard: 'steel', len: 2 },
  twinFang: { shape: 'twin', blade: 'steel', grip: 'crimson', guard: 'stone' },
  crusher: { shape: 'hammer', blade: 'stone', grip: 'steel', guard: 'crimson' },
  tenrinSword: { shape: 'great', blade: 'gold', grip: 'indigo', guard: 'sky', gem: 'sky', len: 1 },
  abyssFang: { shape: 'fang', blade: 'violet', grip: 'ink', guard: 'violet', gem: 'violet' },
};

function drawWeapon(b: PixBuf, s: WeaponSpec): void {
  const B = (k: number): number => ci(s.blade, k);
  const H = (k: number): number => ci(s.grip, k);
  const G = (k: number): number => ci(s.guard ?? s.grip, k);
  const len = s.len ?? 0;
  switch (s.shape) {
    case 'sword':
    case 'great':
    case 'katana':
    case 'dagger':
    case 'cleaver':
    case 'fang': {
      // 切っ先が (14, 1) を越えないよう 8 ドットまで（輪郭の分を外周に空ける）
      const blade = Math.min(8, s.shape === 'dagger' ? 5 : s.shape === 'great' ? 8 + len : 7 + len);
      // 柄と柄頭
      diag(b, 2, 13, 3, H(2));
      b.set(2, 13, H(3));
      b.set(1, 14, G(3));
      // 鍔（刃に直角）
      if (s.shape !== 'katana') {
        const gw = s.shape === 'great' ? 2 : 1;
        for (let i = -gw; i <= gw; i++) b.set(5 + i, 10 + i, G(i < 0 ? 4 : 3));
      } else {
        rect(b, 4, 10, 2, 2, G(3));
      }
      // 刃：光の側（左上）を明るく、右下を暗く
      const x0 = 6;
      const y0 = 9;
      const wide = s.shape === 'great' || s.shape === 'cleaver';
      for (let i = 0; i < blade; i++) {
        b.set(x0 + i, y0 - i, B(4));
        b.set(x0 + i + 1, y0 - i, B(3));
        if (wide) b.set(x0 + i + 1, y0 - i + 1, B(2));
      }
      // 切っ先
      b.set(x0 + blade, y0 - blade, B(5));
      if (s.shape === 'katana') {
        // 反り：先の方を 1 ドット上へ
        b.set(x0 + blade - 1, y0 - blade, B(4));
      }
      if (s.shape === 'fang') {
        // 牙：付け根が太く、先が内へ曲がる
        rect(b, 6, 8, 2, 2, B(3));
        b.set(x0 + blade - 1, y0 - blade + 1, B(2));
      }
      if (s.shape === 'cleaver') {
        // 鉈：刃の背を四角く
        for (let i = 2; i < blade; i++) b.set(x0 + i + 2, y0 - i + 1, B(2));
      }
      break;
    }
    case 'twin': {
      // 双刃：2 本の短剣を交差させる
      for (const [x, y, flip] of [[3, 12, false], [12, 12, true]] as const) {
        for (let i = 0; i < 9; i++) {
          const xx = flip ? x - i : x + i;
          const yy = y - i;
          b.set(xx, yy, i < 3 ? H(2) : i === 3 ? G(3) : B(i === 8 ? 5 : 4));
        }
      }
      break;
    }
    case 'axe': {
      diag(b, 3, 13, 10, H(2));
      diag(b, 4, 13, 9, H(1));
      // 両刃の頭
      runs(b, 7, 1, [
        '..aab...',
        '.aabbc..',
        'aabbbcc.',
        '.abbcc..',
        '..bcc...',
      ], { a: B(5), b: B(4), c: B(2) });
      runs(b, 3, 6, [
        '..aa.',
        '.abbc',
        'abbc.',
      ], { a: B(4), b: B(3), c: B(2) });
      break;
    }
    case 'hammer':
    case 'club': {
      diag(b, 3, 13, 8, H(2));
      diag(b, 4, 13, 7, H(1));
      if (s.shape === 'club') {
        ellipse(b, 10, 5, 3, 3, H(3));
        disc(b, 9, 4, 1, H(4));
      } else {
        // 槌の頭：斜めの柄に直角な塊
        runs(b, 7, 1, [
          '...ab...',
          '..abbc..',
          '.abbbcc.',
          'abbbccd.',
          '.bbccd..',
          '..ccd...',
          '...d....',
        ], { a: B(5), b: B(4), c: B(3), d: B(2) });
        if (s.guard) {
          b.set(9, 5, G(4));
          b.set(10, 5, G(3));
        }
      }
      break;
    }
    case 'spear': {
      diag(b, 2, 14, 10, H(3));
      diag(b, 3, 14, 9, H(2));
      runs(b, 11, 1, ['..a', '.ab', 'abc', 'bc.'], { a: B(5), b: B(4), c: B(2) });
      b.set(10, 5, ci('stone', 3));
      break;
    }
    case 'staff': {
      diag(b, 2, 14, 10, H(2));
      diag(b, 3, 14, 9, H(1));
      // 錫杖の輪
      ellipse(b, 11, 4, 3, 3, B(3), false);
      b.set(9, 4, B(4));
      b.set(13, 4, B(4));
      break;
    }
    case 'pick': {
      diag(b, 3, 13, 9, H(2));
      diag(b, 4, 13, 8, H(1));
      // つるはしの頭：斜めに長い爪
      line(b, 5, 2, 13, 10, B(3));
      line(b, 6, 2, 13, 9, B(4));
      b.set(5, 2, B(5));
      b.set(13, 10, B(2));
      break;
    }
    case 'boomerang': {
      runs(b, 2, 3, [
        'abb.........',
        'abbc........',
        '.abbc.......',
        '..abbc......',
        '...abbc.....',
        '....abbccccd',
        '.....abbbbbd',
        '......cccdd.',
      ], { a: B(4), b: B(3), c: B(2), d: B(1) });
      b.set(3, 4, H(3));
      b.set(12, 9, H(3));
      break;
    }
    case 'bow': {
      // 弓の弧と弦
      for (let y = 2; y <= 13; y++) {
        const t = (y - 7.5) / 5.5;
        const x = Math.round(4 + 4 * (1 - t * t));
        b.set(x, y, B(3));
        b.set(x + 1, y, B(2));
      }
      vline(b, 4, 2, 12, ci(s.grip, 4));
      b.set(8, 7, ci('stone', 4));
      b.set(8, 8, ci('stone', 3));
      break;
    }
    case 'stick': {
      diag(b, 3, 13, 10, B(3));
      diag(b, 4, 13, 9, B(2));
      b.set(7, 8, B(4));
      break;
    }
  }
  // 飾り
  switch (s.motif) {
    case 'flame':
      runs(b, 9, 2, ['.a..', 'aba.', '.bca'], { a: ci('ember', 5), b: ci('ember', 4), c: ci('ember', 3) });
      break;
    case 'bolt':
      runs(b, 11, 1, ['.a', 'a.', '.a'], { a: ci('gold', 5) });
      break;
    case 'wind':
      hline(b, 10, 2, 3, ci('sky', 5));
      hline(b, 12, 4, 2, ci('sky', 5));
      break;
    case 'rust':
      b.set(9, 6, ci('crimson', 2));
      b.set(11, 4, ci('earth', 2));
      b.set(12, 3, ci('crimson', 2));
      break;
    case 'poison':
      b.set(10, 5, ci('leaf', 5));
      b.set(11, 3, ci('leaf', 4));
      break;
    case 'moon':
      runs(b, 11, 1, ['.aa', 'a..', 'a..', '.aa'], { a: ci('gold', 5) });
      break;
    case 'chaos':
      b.set(9, 5, ci('rose', 5));
      b.set(11, 3, ci('sky', 5));
      break;
    case 'leaf':
      runs(b, 11, 2, ['.ab', 'abb', 'b..'], { a: ci('leaf', 5), b: ci('leaf', 3) });
      break;
    case 'fang':
      b.set(12, 2, ci('bone', 5));
      break;
    case 'coin':
      disc(b, 12, 11, 2, ci('gold', 4));
      b.set(12, 11, ci('gold', 2));
      break;
    default:
      break;
  }
  if (s.gem) b.set(6, 9, ci(s.gem, 5));
}

// ---------------------------------------------------------------------------
// 盾
// ---------------------------------------------------------------------------

type ShieldShape = 'round' | 'heater' | 'tower' | 'buckler' | 'kite' | 'shell';
type Emblem = 'none' | 'boss' | 'cross' | 'diamond' | 'scales' | 'hex' | 'eye' | 'wave' | 'leaf'
  | 'wing' | 'sun' | 'drop' | 'rune' | 'spiral' | 'bar' | 'star' | 'mouth';

interface ShieldSpec {
  shape: ShieldShape;
  face: RampName;
  rim: RampName;
  emblem: Emblem;
  emblemRamp?: RampName;
}

const SHIELD_SPEC: Record<string, ShieldSpec> = {
  woodShield: { shape: 'round', face: 'earth', rim: 'earth', emblem: 'bar' },
  leatherShield: { shape: 'heater', face: 'earth', rim: 'crimson', emblem: 'none' },
  bronzeShield: { shape: 'round', face: 'gold', rim: 'earth', emblem: 'boss' },
  ironShield: { shape: 'heater', face: 'steel', rim: 'stone', emblem: 'cross', emblemRamp: 'stone' },
  steelShield: { shape: 'heater', face: 'steel', rim: 'gold', emblem: 'diamond', emblemRamp: 'indigo' },
  heavyShield: { shape: 'tower', face: 'steel', rim: 'stone', emblem: 'bar', emblemRamp: 'stone' },
  stoneShield: { shape: 'tower', face: 'stone', rim: 'stone', emblem: 'none' },
  silverShield: { shape: 'heater', face: 'sky', rim: 'steel', emblem: 'star', emblemRamp: 'sky' },
  dragonScale: { shape: 'kite', face: 'leaf', rim: 'gold', emblem: 'scales', emblemRamp: 'moss' },
  turtleShield: { shape: 'shell', face: 'moss', rim: 'earth', emblem: 'hex', emblemRamp: 'moss' },
  evadeShield: { shape: 'buckler', face: 'sky', rim: 'steel', emblem: 'wing', emblemRamp: 'bone' },
  reflectShield: { shape: 'round', face: 'steel', rim: 'gold', emblem: 'spiral', emblemRamp: 'sky' },
  satietyShield: { shape: 'round', face: 'bone', rim: 'earth', emblem: 'mouth', emblemRamp: 'crimson' },
  rustproofShield: { shape: 'heater', face: 'moss', rim: 'steel', emblem: 'drop', emblemRamp: 'water' },
  guardShield: { shape: 'kite', face: 'indigo', rim: 'gold', emblem: 'cross', emblemRamp: 'gold' },
  holyShield: { shape: 'heater', face: 'bone', rim: 'gold', emblem: 'sun', emblemRamp: 'gold' },
  waterShield: { shape: 'round', face: 'water', rim: 'sky', emblem: 'wave', emblemRamp: 'sky' },
  trapShield: { shape: 'heater', face: 'stone', rim: 'earth', emblem: 'diamond', emblemRamp: 'ember' },
  healShield: { shape: 'heater', face: 'leaf', rim: 'bone', emblem: 'cross', emblemRamp: 'bone' },
  steadfastShield: { shape: 'tower', face: 'crimson', rim: 'gold', emblem: 'bar', emblemRamp: 'gold' },
  immovableShield: { shape: 'tower', face: 'stone', rim: 'steel', emblem: 'rune', emblemRamp: 'steel' },
  damperShield: { shape: 'tower', face: 'indigo', rim: 'steel', emblem: 'wave', emblemRamp: 'steel' },
  smithShield: { shape: 'heater', face: 'steel', rim: 'crimson', emblem: 'rune', emblemRamp: 'ember' },
  windShield: { shape: 'kite', face: 'sky', rim: 'moss', emblem: 'wing', emblemRamp: 'bone' },
  phantomShield: { shape: 'kite', face: 'violet', rim: 'indigo', emblem: 'eye', emblemRamp: 'sky' },
  sproutShield: { shape: 'round', face: 'leaf', rim: 'earth', emblem: 'leaf', emblemRamp: 'leaf' },
  bluntShield: { shape: 'round', face: 'stone', rim: 'stone', emblem: 'boss' },
  tenrinShield: { shape: 'kite', face: 'bone', rim: 'gold', emblem: 'sun', emblemRamp: 'sky' },
  abyssShell: { shape: 'shell', face: 'violet', rim: 'ink', emblem: 'eye', emblemRamp: 'violet' },
};

/** 盾の輪郭（行ごとの左右の端）。中心は x=8 */
function shieldRows(shape: ShieldShape): Array<[number, number, number]> {
  const rows: Array<[number, number, number]> = [];
  for (let y = 1; y <= 14; y++) {
    let hw = -1;
    switch (shape) {
      case 'round':
      case 'shell': {
        const dy = y - 8;
        const t = 1 - (dy * dy) / 42;
        hw = t > 0 ? Math.round(6.2 * Math.sqrt(t)) : -1;
        if (shape === 'shell' && y > 12) hw = -1;
        break;
      }
      case 'buckler': {
        const dy = y - 8;
        const t = 1 - (dy * dy) / 26;
        hw = t > 0 ? Math.round(5.2 * Math.sqrt(t)) : -1;
        break;
      }
      case 'heater':
        hw = y < 2 ? -1 : y <= 8 ? 5 : Math.max(0, 5 - Math.round((y - 8) * 0.9));
        if (y === 14) hw = -1;
        break;
      case 'kite':
        hw = y < 2 ? -1 : y <= 5 ? 3 + (y - 2) : Math.max(0, 6 - Math.round((y - 5) * 0.75));
        break;
      case 'tower':
        hw = y < 2 || y > 14 ? -1 : y === 2 ? 4 : 5;
        break;
    }
    if (hw >= 0) rows.push([y, 8 - hw, 8 + hw - 1]);
  }
  return rows;
}

function drawShield(b: PixBuf, s: ShieldSpec): void {
  const rows = shieldRows(s.shape);
  // 縁（外側 1 ドット）と面
  for (const [y, x0, x1] of rows) hline(b, x0, y, x1 - x0 + 1, ci(s.rim, 3));
  for (let i = 1; i < rows.length - 1; i++) {
    const [y, x0, x1] = rows[i];
    if (x1 - x0 >= 2) hline(b, x0 + 1, y, x1 - x0 - 1, ci(s.face, 3));
  }
  // 面の明暗：左上を明るく、右下を暗く
  for (let i = 1; i < rows.length - 1; i++) {
    const [y, x0, x1] = rows[i];
    if (x1 - x0 < 3) continue;
    b.set(x0 + 1, y, ci(s.face, 4));
    b.set(x1 - 1, y, ci(s.face, 2));
    if (i === 1) hline(b, x0 + 1, y, x1 - x0 - 2, ci(s.face, 4));
  }
  const E = (k: number): number => ci(s.emblemRamp ?? s.rim, k);
  const cy = s.shape === 'heater' || s.shape === 'kite' ? 7 : 8;
  switch (s.emblem) {
    case 'boss':
      disc(b, 8, cy, 1, E(4));
      b.set(7, cy - 1, E(5));
      break;
    case 'cross':
      vline(b, 8, cy - 3, 7, E(4));
      hline(b, 6, cy - 1, 5, E(4));
      vline(b, 9, cy - 3, 7, E(2));
      break;
    case 'diamond':
      runs(b, 6, cy - 2, ['..a..', '.aab.', 'aabbc', '.bbc.', '..c..'], { a: E(5), b: E(4), c: E(2) });
      break;
    case 'scales':
      for (let y = 4; y <= 11; y += 2) {
        for (let x = 5 + ((y / 2) % 2); x <= 10; x += 2) b.set(x, y, E(4));
      }
      break;
    case 'hex':
      runs(b, 5, 4, ['.aaaa.', 'a....a', 'a.bb.a', 'a....a', '.aaaa.'], { a: E(4), b: E(5) });
      break;
    case 'eye':
      runs(b, 5, cy - 1, ['.aaaa.', 'abccba', '.aaaa.'], { a: E(4), b: E(5), c: ci('ink', 1) });
      break;
    case 'wave':
      runs(b, 5, cy - 1, ['.a..a.', 'a.aa.a', '......'], { a: E(5) });
      runs(b, 5, cy + 2, ['.a..a.', 'a.aa.a'], { a: E(4) });
      break;
    case 'leaf':
      runs(b, 6, cy - 2, ['...a', '.aab', 'aabb', 'abb.', 'b...'], { a: E(5), b: E(3) });
      break;
    case 'wing':
      runs(b, 5, cy - 2, ['a.....', 'aa....', 'aab...', '.aabb.', '..bbbb'], { a: E(5), b: E(4) });
      break;
    case 'sun':
      disc(b, 8, cy, 2, E(5));
      b.set(8, cy - 4, E(4));
      b.set(8, cy + 4, E(4));
      b.set(4, cy, E(4));
      b.set(11, cy, E(4));
      break;
    case 'drop':
      runs(b, 7, cy - 2, ['.a.', '.a.', 'aba', 'abb', '.b.'], { a: E(4), b: E(3) });
      break;
    case 'rune':
      runs(b, 6, cy - 2, ['aaaa', 'a..a', '.aa.', 'a..a', 'aaaa'], { a: E(4) });
      break;
    case 'spiral':
      runs(b, 6, cy - 2, ['aaaa.', '....a', '.aa.a', '.a..a', '.aaa.'], { a: E(4) });
      break;
    case 'bar':
      hline(b, 4, cy - 2, 8, E(2));
      hline(b, 4, cy + 2, 8, E(2));
      break;
    case 'star':
      runs(b, 6, cy - 2, ['..a..', '.aaa.', 'aaaaa', '.a.a.', 'a...a'], { a: E(5) });
      break;
    case 'mouth':
      runs(b, 5, cy - 1, ['aaaaaa', 'abbbba', '.aaaa.'], { a: E(3), b: ci('bone', 5) });
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 食料・投げ物・ギタン
// ---------------------------------------------------------------------------

/**
 * おにぎり。size 0 = 普通、1 = 大きい、2 = 巨大、-1 = しなびた。
 * 角の丸い三角に、下の真ん中へ海苔を巻く（海苔が高すぎると戸口に見える）。
 */
function riceBall(b: PixBuf, size: number, rice: RampName, specks: RampName | null): void {
  // 上を丸く、2 段ごとに 1 ドットずつ広がる（45° より緩い三角で、屋根に見えないように）
  const maxW = Math.min(14, 12 + size * 2);
  const h = 11 + size;
  const bottom = 13;
  const top = bottom - h + 1;
  for (let r = 0; r < h; r++) {
    const w = r === h - 1 ? maxW - 2 : Math.min(maxW, 4 + 2 * Math.floor(r / 2));
    const x0 = 8 - w / 2;
    for (let i = 0; i < w; i++) {
      // 左上が明るく、右下が暗い
      const t = i / w + r / (h * 2);
      b.set(x0 + i, top + r, ci(rice, t < 0.4 ? 5 : t < 0.95 ? 4 : 3));
    }
  }
  // 海苔（下の真ん中に巻く）
  const nw = Math.floor(maxW / 4);
  const nh = size > 1 ? 5 : 4;
  const ny = bottom - nh + 1;
  rect(b, 8 - nw, ny, nw * 2, nh, ci('moss', 0));
  hline(b, 8 - nw, ny, nw * 2, ci('moss', 2));
  vline(b, 8 - nw, ny + 1, nh - 1, ci('moss', 1));
  if (specks) {
    b.set(6, top + 4, ci(specks, 3));
    b.set(9, top + 3, ci(specks, 4));
    b.set(10, top + 6, ci(specks, 3));
    b.set(5, top + 7, ci(specks, 2));
  }
}

const FOOD: Record<string, Draw> = {
  food: (b) => riceBall(b, 0, 'bone', null),
  riceBall: (b) => riceBall(b, 0, 'bone', null),
  bigRiceBall: (b) => riceBall(b, 1, 'bone', null),
  hugeRiceBall: (b) => riceBall(b, 2, 'bone', null),
  grilledRiceBall: (b) => riceBall(b, 0, 'earth', 'ember'),
  herbRiceBall: (b) => riceBall(b, 0, 'bone', 'leaf'),
  rottenRiceBall: (b) => riceBall(b, 0, 'stone', 'violet'),
  driedRiceBall: (b) => riceBall(b, -1, 'stone', null),
  driedMeat: (b) => {
    runs(b, 3, 4, [
      '...aab....',
      '..aabbc...',
      '.aabbbcc..',
      'aabbbbccd.',
      '.bbbbcccd.',
      '..bcccdd..',
      '...ccdd...',
    ], { a: ci('crimson', 5), b: ci('crimson', 4), c: ci('crimson', 3), d: ci('crimson', 2) });
    line(b, 10, 10, 13, 13, ci('bone', 5));
  },
  nut: (b) => {
    ellipse(b, 8, 9, 4, 4, ci('earth', 4));
    rect(b, 4, 4, 9, 3, ci('earth', 2));
    hline(b, 5, 3, 7, ci('earth', 3));
    b.set(8, 2, ci('earth', 1));
    b.set(6, 8, ci('earth', 5));
  },
  bentou: (b) => {
    rect(b, 2, 5, 12, 8, ci('crimson', 3));
    rect(b, 2, 4, 12, 2, ci('crimson', 4));
    hline(b, 2, 9, 12, ci('gold', 4));
    vline(b, 8, 4, 9, ci('gold', 4));
    b.set(8, 3, ci('gold', 5));
  },
};

const MISC: Record<string, Draw> = {
  stone: (b) => {
    ellipse(b, 8, 9, 5, 4, ci('stone', 3));
    ellipse(b, 7, 8, 3, 2, ci('stone', 4));
    b.set(10, 11, ci('stone', 2));
  },
  bombStone: (b) => {
    disc(b, 8, 9, 5, ci('ink', 2));
    disc(b, 6, 7, 1, ci('ink', 4));
    vline(b, 10, 2, 3, ci('earth', 3));
    b.set(11, 1, ci('ember', 5));
    b.set(12, 2, ci('ember', 4));
  },
  shockStone: (b) => {
    ellipse(b, 8, 9, 5, 4, ci('gold', 3));
    ellipse(b, 7, 8, 3, 2, ci('gold', 4));
    runs(b, 7, 6, ['a.', '.a', 'a.', '.a'], { a: ci('gold', 5) });
    b.set(13, 5, ci('gold', 5));
    b.set(3, 5, ci('gold', 5));
  },
  smokeBall: (b) => {
    disc(b, 8, 10, 4, ci('ink', 4));
    disc(b, 7, 9, 2, ci('ink', 5));
    disc(b, 11, 5, 2, ci('stone', 4));
    b.set(12, 3, ci('stone', 5));
  },
  woodArrow: (b) => arrow(b, 'earth', 'stone'),
  ironArrow: (b) => arrow(b, 'earth', 'steel'),
  silverArrow: (b) => arrow(b, 'bone', 'sky'),
  arrow: (b) => arrow(b, 'earth', 'stone'),
  gitan: (b) => {
    // 積んだ小判
    for (const [x, y] of [[4, 11], [9, 11], [6, 8], [11, 8], [8, 5]] as const) {
      ellipse(b, x, y, 2, 1, ci('gold', 3));
      hline(b, x - 1, y - 1, 3, ci('gold', 5));
      b.set(x + 1, y + 1, ci('gold', 2));
    }
  },
};

function arrow(b: PixBuf, shaft: RampName, tip: RampName): void {
  diag(b, 3, 13, 9, ci(shaft, 3));
  runs(b, 10, 2, ['.aa', 'abb', '.b.'], { a: ci(tip, 5), b: ci(tip, 3) });
  runs(b, 2, 11, ['a..', 'ab.', '.b.'], { a: ci('bone', 5), b: ci('bone', 3) });
}

// ---------------------------------------------------------------------------
// 種類の絵（正体が分からない物は必ずこれ）
// ---------------------------------------------------------------------------

const CATEGORY: Record<string, Draw> = {
  weapon: (b) => drawWeapon(b, WEAPON_SPEC.ironSword),
  shield: (b) => drawShield(b, SHIELD_SPEC.ironShield),
  herb: (b) => {
    // 3 枚葉の草
    vline(b, 8, 7, 7, ci('leaf', 2));
    runs(b, 3, 2, [
      '....aa....',
      '...abba...',
      '...abbc...',
      'aa..bc..aa',
      'abb.c..bba',
      '.bbc..cbc.',
      '..cc..cc..',
    ], { a: ci('leaf', 5), b: ci('leaf', 4), c: ci('leaf', 3) });
    b.set(8, 13, ci('earth', 3));
  },
  scroll: (b) => {
    // 上下を巻いた紙。両端に赤い軸
    rect(b, 4, 4, 8, 8, ci('bone', 4));
    vline(b, 4, 4, 8, ci('bone', 5));
    vline(b, 11, 4, 8, ci('bone', 3));
    for (const y of [6, 8, 10]) hline(b, 6, y, y === 10 ? 3 : 4, ci('stone', 2));
    for (const y of [2, 12]) {
      hline(b, 3, y, 10, ci('bone', 5));
      hline(b, 3, y + 1, 10, ci('bone', 3));
      b.set(2, y, ci('crimson', 4));
      b.set(2, y + 1, ci('crimson', 2));
      b.set(13, y, ci('crimson', 4));
      b.set(13, y + 1, ci('crimson', 2));
    }
  },
  staff: (b) => {
    diag(b, 2, 14, 10, ci('earth', 3));
    diag(b, 3, 14, 9, ci('earth', 2));
    disc(b, 12, 3, 2, ci('violet', 3));
    b.set(11, 2, ci('violet', 5));
    b.set(12, 3, ci('violet', 4));
  },
  pot: (b) => potShape(b, 'earth', null),
  bracelet: (b) => {
    ellipse(b, 8, 9, 6, 4, ci('gold', 3), false);
    ellipse(b, 8, 9, 5, 3, ci('gold', 2), false);
    hline(b, 5, 5, 6, ci('gold', 5));
    disc(b, 8, 5, 1, ci('sky', 4));
    b.set(8, 5, WHITE);
  },
  food: FOOD.food,
  charm: (b) => {
    // 護石：金の紐に下げた翡翠
    line(b, 4, 2, 7, 6, ci('gold', 3));
    line(b, 12, 2, 9, 6, ci('gold', 2));
    ellipse(b, 8, 10, 4, 4, ci('gold', 3));
    ellipse(b, 8, 10, 3, 3, ci('moss', 3));
    ellipse(b, 7, 9, 2, 2, ci('moss', 4));
    b.set(6, 8, ci('moss', 5));
    b.set(6, 7, WHITE);
    rect(b, 7, 5, 3, 2, ci('gold', 4));
  },
  gitan: MISC.gitan,
  arrow: MISC.arrow,
  stone: MISC.stone,
};

// ---------------------------------------------------------------------------
// 壺（正体を知っているときだけ道具ごとの絵）
// ---------------------------------------------------------------------------

type PotMark = 'none' | 'swirl' | 'eye' | 'spiral' | 'strap' | 'hole' | 'ripple' | 'rivet'
  | 'seal' | 'coin' | 'star' | 'up' | 'sparkle' | 'down' | 'eyes' | 'box' | 'leaf';

const POT_SPEC: Record<string, { body: RampName; mark: PotMark; markRamp?: RampName }> = {
  storagePot: { body: 'earth', mark: 'none' },
  synthesisPot: { body: 'violet', mark: 'swirl', markRamp: 'gold' },
  identifyPot: { body: 'sky', mark: 'eye', markRamp: 'indigo' },
  changePot: { body: 'rose', mark: 'spiral', markRamp: 'bone' },
  backpackPot: { body: 'leaf', mark: 'strap', markRamp: 'earth' },
  holePot: { body: 'stone', mark: 'hole' },
  waterPot: { body: 'water', mark: 'ripple', markRamp: 'sky' },
  evadePot: { body: 'moss', mark: 'leaf', markRamp: 'leaf' },
  unbreakablePot: { body: 'steel', mark: 'rivet', markRamp: 'steel' },
  sealPot: { body: 'indigo', mark: 'seal', markRamp: 'crimson' },
  cashPot: { body: 'gold', mark: 'coin', markRamp: 'gold' },
  blessPot: { body: 'bone', mark: 'star', markRamp: 'gold' },
  strengthenPot: { body: 'crimson', mark: 'up', markRamp: 'gold' },
  purifyPot: { body: 'bone', mark: 'sparkle', markRamp: 'sky' },
  weakenPot: { body: 'stone', mark: 'down', markRamp: 'violet' },
  monsterPot: { body: 'crimson', mark: 'eyes', markRamp: 'gold' },
  warehousePot: { body: 'earth', mark: 'box', markRamp: 'gold' },
};

function potShape(b: PixBuf, body: RampName, mark: PotMark | null, markRamp?: RampName): void {
  // 胴
  ellipse(b, 8, 9, 5, 5, ci(body, 3));
  // 肩と口
  rect(b, 5, 3, 6, 2, ci(body, 3));
  hline(b, 4, 2, 8, ci(body, 4));
  hline(b, 5, 3, 6, ci(body, 1));
  // 明暗
  ellipse(b, 6, 8, 1, 3, ci(body, 4));
  b.set(6, 7, ci(body, 5));
  for (let y = 8; y <= 12; y++) b.set(12, y, ci(body, 2));
  hline(b, 5, 13, 6, ci(body, 2));
  const M = (k: number): number => ci(markRamp ?? body, k);
  switch (mark) {
    case 'swirl':
      runs(b, 7, 7, ['aaa', '..a', 'aaa'], { a: M(4) });
      break;
    case 'eye':
      runs(b, 6, 8, ['.aaa.', 'abbba', '.aaa.'], { a: M(3), b: ci('ink', 1) });
      b.set(8, 9, WHITE);
      break;
    case 'spiral':
      runs(b, 7, 7, ['aaa', 'a.a', 'a..'], { a: M(5) });
      break;
    case 'strap':
      line(b, 4, 6, 11, 12, M(3));
      break;
    case 'hole':
      ellipse(b, 8, 3, 2, 0, ci('ink', 1));
      disc(b, 9, 10, 1, ci('ink', 1));
      break;
    case 'ripple':
      runs(b, 6, 8, ['.a.a.', 'a.a.a'], { a: M(5) });
      break;
    case 'rivet':
      for (const x of [5, 8, 11]) b.set(x, 9, M(5));
      hline(b, 4, 6, 8, M(2));
      break;
    case 'seal':
      runs(b, 7, 7, ['aaa', 'a.a', 'aaa'], { a: M(4) });
      break;
    case 'coin':
      disc(b, 8, 9, 2, M(5));
      b.set(8, 9, M(2));
      break;
    case 'star':
      runs(b, 6, 7, ['..a..', 'aaaaa', '.aaa.', '.a.a.'], { a: M(5) });
      break;
    case 'up':
      runs(b, 6, 7, ['..a..', '.aaa.', 'a.a.a', '..a..'], { a: M(5) });
      break;
    case 'sparkle':
      runs(b, 6, 7, ['..a..', '.a.a.', 'a...a'], { a: M(5) });
      b.set(10, 11, M(4));
      break;
    case 'down':
      runs(b, 6, 7, ['..a..', 'a.a.a', '.aaa.', '..a..'], { a: M(4) });
      break;
    case 'eyes':
      b.set(6, 8, M(5));
      b.set(10, 8, M(5));
      hline(b, 6, 11, 5, ci('ink', 1));
      break;
    case 'box':
      rect(b, 6, 8, 5, 4, M(3));
      hline(b, 6, 8, 5, M(5));
      break;
    case 'leaf':
      runs(b, 7, 7, ['.aa', 'aab', 'ab.'], { a: M(5), b: M(3) });
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 登録
// ---------------------------------------------------------------------------

for (const [id, spec] of Object.entries(WEAPON_SPEC)) ICONS.set(id, (b) => drawWeapon(b, spec));
for (const [id, spec] of Object.entries(SHIELD_SPEC)) ICONS.set(id, (b) => drawShield(b, spec));
for (const [id, draw] of Object.entries(FOOD)) ICONS.set(id, draw);
for (const [id, draw] of Object.entries(MISC)) ICONS.set(id, draw);
for (const [id, spec] of Object.entries(POT_SPEC)) {
  ICONS.set(id, (b) => potShape(b, spec.body, spec.mark, spec.markRamp));
}
for (const [id, draw] of Object.entries(CATEGORY)) ICONS.set(id, draw);

/** 図鑑などで道具の種類を問わず絵を出したいとき（正体が分かっている前提） */
export function iconKeyForCatalog(defId: string): string {
  const def = getItem(defId);
  return CATEGORY_ONLY.has(def.kind) ? def.kind : iconKeyOf(defId, true);
}
