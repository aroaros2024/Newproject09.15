/**
 * 店の番犬 のリグ。
 *
 * 村の店の犬なので「野良の敵」には見せない：立ち耳・巻き尾・頬と胸の白い毛（柴犬のような
 * 里の犬）に、店の印の赤い前掛け（首の三角の布）と金の鈴。怒ると歯をむいて唸る。
 * 胴・頭・脚・尾・前掛けを手描きの点の並びで作り、姿勢でずらして組み立てる。
 */

import {
  type AnimDef, type DrawDir, type Pose, type Rig, type Variant, mat, registerRig, registerSpecies,
} from '../rig.js';
import { walkCycle } from '../anim.js';
import { type PixBuf, runs } from '../pixbuf.js';
import { WHITE, ci } from '../palette.js';
import { type Tmpl, clamp, heighten, rnd, shades } from './rat.js';

// ---------------------------------------------------------------------------
// 色
// ---------------------------------------------------------------------------

function palOf(v: Readonly<Variant>): Record<string, number> {
  // 毛は 1 段明るくずらす（地が earth の 4 段目＝黄土色の柴）
  const fs = v.params?.furShift ?? 0;
  return {
    c: mat(v, 'fur', 1 + fs),
    b: mat(v, 'fur', 2 + fs),
    a: mat(v, 'fur', 3 + fs),
    h: mat(v, 'fur', 4 + fs),
    ...shades(v, 'cream', '_uvwW'),
    ...shades(v, 'scarf', 'FDCI_'),
    ...shades(v, 'bell', '_gGk_'),
    ...shades(v, 'pink', '__qpP'),
    e: mat(v, 'eye', 0),
    E: WHITE,
    n: mat(v, 'eye', 1),
    t: ci('bone', 5),
    m: ci('crimson', 1),
    M: ci('rose', 3),
  };
}

// ---------------------------------------------------------------------------
// 部品
// ---------------------------------------------------------------------------

interface Part {
  t: Tmpl;
  x: number;
  y: number;
}

/** 横向き（右向き）。座標は足元の点 (16, 37) からのずれ */
const E_BODY: Part = {
  x: -9, y: -15,
  t: [
    '..aaaaaaaaaaa..',
    '.ahhhhhhaaaaaa.',
    'ahhhaaaaaaaaaaa',
    'ahaaaaaaaaaaaaa',
    'aaaaaaaaaaaaaab',
    'aaaaaaaaaaaaabb',
    'baaabbvvvaaabbb',
    '.bbb...vvwwbbb.',
    '..bb....vwbbb..',
  ],
};
/** 頭（耳を含む）。x, y は胴の左上から */
const E_HEAD: Part = {
  x: 10, y: -10,
  t: [
    '..a..a.....',
    '.aa.ah.....',
    '.apaaph....',
    '.aaaaaaa...',
    'aaaaaaaaa..',
    'aaaaaaaaa..',
    'aaaaaaaawwn',
    'bwwwwwwwww.',
    '.bwwwwwww..',
    '..vvvvv....',
  ],
};
const E_HEAD_OPEN: Tmpl = [
  '..a..a.....',
  '.aa.ah.....',
  '.apaaph....',
  '.aaaaaaa...',
  'aaaaaaaaa..',
  'aaaaaaaaa..',
  'aaaaaaaawwn',
  'bwwwwwmtttt',
  '.bwwwmmmm..',
  '..vvvwtt...',
  '...vvv.....',
];
/** 唸り：口は閉じたまま唇をめくって歯を見せる */
const E_HEAD_SNARL: Tmpl = [
  '..a..a.....',
  '.aa.ah.....',
  '.apaaph....',
  '.aaaaaaa...',
  'aaaaaaaaa..',
  'aaaaaaaaa..',
  'aaaaaaaawwn',
  'bwwwwmttttt',
  '.bwwwwwww..',
  '..vvvvv....',
];
/** 目（頭の左上から） */
const E_EYE: readonly [number, number] = [5, 4];
/** 前掛け（胴の左上から） */
const E_SCARF: Part = {
  x: 10, y: -2,
  t: [
    'CCCCC..',
    'ICCCCD.',
    '.CCCCD.',
    '..CCD..',
    '...D...',
  ],
};
const E_BELL: Part = { x: 13, y: 0, t: ['k', 'G'] };
/** 巻き尾（胴の左上から） */
const E_TAIL: Part = {
  x: -1, y: -5,
  t: [
    '.aaaa.',
    'ahhhaa',
    'hawwab',
    'awaaab',
    '.wwbb.',
    '..bb..',
  ],
};
/** 脚：[奥の後ろ, 奥の前, 手前の後ろ, 手前の前]。x は胴の左上から */
const E_LEGS: readonly Part[] = [
  { x: 3, y: 0, t: ['cb', 'cb', 'cb', 'cb', 'cb', 'cv', 'vu'] },
  { x: 12, y: 0, t: ['cb', 'cb', 'cb', 'cb', 'cb', 'cv', 'vu'] },
  { x: 1, y: 0, t: ['aab', 'aab', '.ab', '.ab', '.ab', '.ww', '.www'] },
  { x: 10, y: 0, t: ['aab', 'aab', 'aab', 'aab', 'aab', 'www', 'wwww'] },
];

/** 手前向き。頭・胸・前脚・後ろ脚・前掛け */
const S_HEAD: Part = {
  x: -5, y: -24,
  t: [
    '.a.......a.',
    '.ha.....aa.',
    'hpa.....apb',
    'hppaaaaappb',
    'haaahhhaaab',
    'haaaaaaaaab',
    'aaaaaaaaaab',
    'wwaaaaaaaww',
    'wwwwwnwwwww',
    '.wwwwwwwvv.',
    '..vwwwvvv..',
  ],
};
const S_HEAD_OPEN: Tmpl = [
  '.a.......a.',
  '.ha.....aa.',
  'hpa.....apb',
  'hppaaaaappb',
  'haaahhhaaab',
  'haaaaaaaaab',
  'aaaaaaaaaab',
  'wwaaaaaaaww',
  'wwwwwnwwwww',
  '.wtmmmmmtv.',
  '..tmmmmmt..',
  '...vtttv...',
];
const S_HEAD_SNARL: Tmpl = [
  '.a.......a.',
  '.ha.....aa.',
  'hpa.....apb',
  'hppaaaaappb',
  'haaahhhaaab',
  'haaaaaaaaab',
  'aaaaaaaaaab',
  'wwaaaaaaaww',
  'wwwwwnwwwww',
  '.wmtttttmv.',
  '..vwwwvvv..',
];
const S_EYES: readonly (readonly [number, number])[] = [[2, 5], [7, 5]];
const S_CHEST: Part = {
  x: -5, y: -14,
  t: [
    '..hwwwwwv..',
    '.hwwwwwwvv.',
    'ahwwwwwwvvb',
    'ahwwwwwwvvb',
    'aawwwwwwvbb',
    'aaawwwwvbbb',
    'aaaavvvbbbb',
    '.aaa...bbb.',
  ],
};
const S_SCARF: Part = {
  x: -5, y: -14,
  t: [
    'CCCCCCCCCCD',
    '.ICCCCCCCD.',
    '..ICCCCCD..',
    '...CCCCD...',
    '....CCD....',
    '.....D.....',
  ],
};
const S_BELL: Part = { x: 0, y: -13, t: ['k', 'G'] };
/** 前脚（左右）と奥に見える後ろ脚 */
const S_LEGS_FRONT: readonly Part[] = [
  { x: -4, y: 0, t: ['aab', 'aab', 'aab', 'aab', 'aab', 'wwv', 'wwv'] },
  { x: 2, y: 0, t: ['aab', 'aab', 'abb', 'abb', 'abb', 'wvv', 'wvv'] },
];
const S_LEGS_BACK: readonly Part[] = [
  { x: -7, y: 0, t: ['ab', 'ab', 'bb', 'bb', 'bb', 'vv'] },
  { x: 5, y: 0, t: ['bb', 'bb', 'bc', 'bc', 'bc', 'vu'] },
];
/** 奥に見える背中と、右肩の上に出る巻き尾 */
const S_BACK: Part = {
  x: -7, y: -17,
  t: [
    '..aaaaaaaaa..',
    '.ahhhaaaaaab.',
    'ahhaaaaaaaabb',
    'ahaaaaaaaaabb',
    'aaaaaaaaaabbb',
    'baaaaaaaaabbb',
    '.bbbbbbbbbbb.',
  ],
};
const S_TAIL: Part = {
  x: 4, y: -21,
  t: [
    '.aaa.',
    'ahhaa',
    'awwab',
    '.bbb.',
  ],
};

/** 奥向き。後頭部・背中・尻・巻き尾・後ろ脚 */
const N_HEAD: Part = {
  x: -5, y: -25,
  t: [
    '.a.......a.',
    '.ha.....aa.',
    'haa.....aab',
    'haaaaaaaaab',
    'hahhhaaaaab',
    'haaaaaaaaab',
    'aaaaaaaaabb',
    '.aaaaaaabb.',
  ],
};
const N_BODY: Part = {
  x: -7, y: -18,
  t: [
    '...CCCCCCC...',
    '..aDCCCCCDa..',
    '..ahhaaaaab..',
    '.ahhaaaaaabb.',
    '.ahaaaaaaabb.',
    'ahhaaaaaaaabb',
    'ahaaaaaaaaabb',
    'aaaaaaaaaaabb',
    'aaaaaabaaaabb',
    'baaaabbbaaabb',
    'bbaawwwwwabb.',
    '.bbwwwwwwbb..',
  ],
};
const N_TAIL: Part = {
  x: -3, y: -14,
  t: [
    '..aaa..',
    '.ahhhb.',
    'ahwwhab',
    'awhawab',
    '.awwab.',
    '..bbb..',
  ],
};
const N_LEGS: readonly Part[] = [
  { x: -6, y: 0, t: ['aab', 'aab', 'abb', 'abb', 'abb', 'wvv', 'wvv'] },
  { x: 3, y: 0, t: ['abb', 'abb', 'bbb', 'bbb', 'bbc', 'vvu', 'vvu'] },
];

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

const AX = 16;
const AY = 37;

function put(b: PixBuf, x: number, y: number, t: Tmpl, map: Record<string, number>): void {
  runs(b, x, y, t, map);
}

function eye(b: PixBuf, x: number, y: number, eyes: number, map: Record<string, number>): void {
  const e = rnd(eyes);
  if (e <= 0) runs(b, x, y, ['Ee', 'ee'], map);
  else if (e === 1) runs(b, x, y + 1, ['Ee'], map);
  else runs(b, x, y, ['hh', 'ee'], map);
}

/**
 * 脚を 1 本置く。足の裏が足元の行に来る。lift で持ち上げ、dx で前後に振る。
 * reach は胴が上がった分（息を吸う・伸び上がる）：脚の付け根を伸ばして胴と離れないようにする
 */
function leg(b: PixBuf, x: number, t: Tmpl, dx: number, lift: number, reach: number,
  map: Record<string, number>): void {
  let rows = lift > 0 ? heighten(t, 2, -lift) : t;
  if (reach > 0) rows = heighten(rows, 0, reach);
  runs(b, x + dx, AY - rows.length + 1 - lift, rows, map);
}

function buildDog(b: PixBuf, p: Readonly<Pose>, dir: DrawDir, v: Readonly<Variant>): void {
  const map = palOf(v);
  const bob = rnd(p.bob);
  const head = rnd(p.head);
  const lean = rnd(p.lean);
  const sw = rnd(p.sway);
  const mouth = rnd(p.mouth);
  const lie = p.fx > 0.5;
  // 脚の振り：legL は（手前の前・奥の後ろ）、legR は（手前の後ろ・奥の前）
  const sL = p.legL;
  const sR = p.legR;
  const swing = (s: number): number => clamp(rnd(s * 1.5), -2, 2);
  const lift = (s: number): number => (s > 0.5 ? 1 : 0);
  const drop = lie ? 8 : 0;
  const up = Math.max(0, -bob);

  if (dir === 'E') {
    const dx = clamp(lean, -2, 2);
    const bx = AX + E_BODY.x + dx;
    const by = AY + E_BODY.y + bob + drop;
    // 奥の脚
    if (!lie) {
      leg(b, bx + E_LEGS[0].x, E_LEGS[0].t, swing(sL), lift(sL), up, map);
      leg(b, bx + E_LEGS[1].x, E_LEGS[1].t, swing(sR), lift(sR), up, map);
    }
    // 尾（胴の奥）
    put(b, bx + E_TAIL.x, by + E_TAIL.y - Math.max(0, sw), E_TAIL.t, map);
    put(b, bx, by, lie ? heighten(E_BODY.t, 7, -2) : E_BODY.t, map);
    // 手前の脚
    if (!lie) {
      leg(b, bx + E_LEGS[2].x, E_LEGS[2].t, swing(sR), lift(sR), up, map);
      leg(b, bx + E_LEGS[3].x, E_LEGS[3].t, swing(sL), lift(sL), up, map);
    } else {
      // 伏せ：前脚を前へ投げ出す
      put(b, bx + 12, AY - 1, ['aaaab', 'wwwww'], map);
    }
    // 頭・前掛け
    const hx = bx + E_HEAD.x;
    const hy = by + E_HEAD.y + head + (lie ? 3 : 0);
    put(b, hx, hy, mouth >= 2 ? E_HEAD_OPEN : mouth === 1 ? E_HEAD_SNARL : E_HEAD.t, map);
    eye(b, hx + E_EYE[0], hy + E_EYE[1], p.eyes, map);
    put(b, bx + E_SCARF.x, by + E_SCARF.y + head + (lie ? 3 : 0), E_SCARF.t, map);
    put(b, bx + E_BELL.x, by + E_BELL.y + head + (lie ? 3 : 0), E_BELL.t, map);
    return;
  }

  if (dir === 'S') {
    const dy = clamp(lean, -2, 1);
    const cx = AX;
    if (lie) {
      // 伏せ：背中の山の手前に頭を低く置き、前脚の上にあごを載せる
      put(b, cx + S_TAIL.x + 1, AY - 15 + bob, S_TAIL.t, map);
      put(b, cx + S_BACK.x, AY - 13 + bob, S_BACK.t, map);
      const hy = AY - 12 + bob;
      put(b, cx + S_HEAD.x, hy, S_HEAD.t, map);
      for (const [ex, ey] of S_EYES) eye(b, cx + S_HEAD.x + ex, hy + ey, p.eyes, map);
      put(b, cx - 5, AY - 1, ['aawwv.aawwv', 'awwvv.awwvv'], map);
      return;
    }
    // 背中と尾（奥）
    put(b, cx + S_TAIL.x + Math.max(0, sw), AY + S_TAIL.y + bob, S_TAIL.t, map);
    put(b, cx + S_BACK.x, AY + S_BACK.y + bob, S_BACK.t, map);
    leg(b, cx + S_LEGS_BACK[0].x, S_LEGS_BACK[0].t, 0, lift(sR), up, map);
    leg(b, cx + S_LEGS_BACK[1].x, S_LEGS_BACK[1].t, 0, lift(sL), up, map);
    // 胸と前脚
    put(b, cx + S_CHEST.x, AY + S_CHEST.y + bob + Math.max(0, dy), S_CHEST.t, map);
    leg(b, cx + S_LEGS_FRONT[0].x, S_LEGS_FRONT[0].t, 0, lift(sL), up, map);
    leg(b, cx + S_LEGS_FRONT[1].x, S_LEGS_FRONT[1].t, 0, lift(sR), up, map);
    put(b, cx + S_SCARF.x, AY + S_SCARF.y + bob + Math.max(0, dy), S_SCARF.t, map);
    put(b, cx + S_BELL.x, AY + S_BELL.y + bob + Math.max(0, dy), S_BELL.t, map);
    // 頭
    const hy = AY + S_HEAD.y + bob + head + dy;
    put(b, cx + S_HEAD.x, hy, mouth >= 2 ? S_HEAD_OPEN : mouth === 1 ? S_HEAD_SNARL : S_HEAD.t, map);
    for (const [ex, ey] of S_EYES) eye(b, cx + S_HEAD.x + ex, hy + ey, p.eyes, map);
    return;
  }

  // 奥向き
  const dy = -clamp(lean, -1, 2);
  const cx = AX;
  put(b, cx + N_HEAD.x, AY + N_HEAD.y + bob + head + dy + drop + (lie ? 2 : 0), N_HEAD.t, map);
  if (!lie) {
    leg(b, cx + N_LEGS[0].x, N_LEGS[0].t, 0, lift(sL), up, map);
    leg(b, cx + N_LEGS[1].x, N_LEGS[1].t, 0, lift(sR), up, map);
  }
  put(b, cx + N_BODY.x, AY + N_BODY.y + bob + drop, lie ? heighten(N_BODY.t, 6, -2) : N_BODY.t, map);
  put(b, cx + N_TAIL.x + sw, AY + N_TAIL.y + bob + drop, N_TAIL.t, map);
}

// ---------------------------------------------------------------------------
// 動き
// ---------------------------------------------------------------------------

/** 待機：息で胴が 1 ドット上下し、尾が左右に揺れる（番犬なので構えは崩さない） */
const dogIdle: AnimDef = {
  frames: 4, fps: 4, loop: true,
  pose(i: number, _n: number, out: Pose): void {
    out.bob = i === 1 || i === 2 ? -1 : 0;
    out.head = 0;
    out.sway = [0, 1, 0, -1][i];
  },
};

/** 唸って飛びかかる：身を低くして歯をむく（溜め）→ 前へ跳んで噛む（当たり）→ 戻る */
const dogBite: AnimDef = {
  frames: 5, fps: 15, loop: false, strike: 2,
  pose(i: number, _n: number, out: Pose): void {
    out.lean = [0, -2, 2, 1, 0][i];
    out.bob = [0, 1, -1, 0, 0][i];
    out.head = [0, 1, 0, 0, 0][i];
    out.mouth = [0, 1, 2, 1, 0][i];
    out.eyes = [0, 1, 0, 0, 0][i];
    out.legL = [0, 0, 1, 0.3, 0][i];
    out.legR = [0, 0, -1, -0.3, 0][i];
  },
};

/** 被弾：のけぞって目をつぶる（口は閉じたまま。歯をむくのは攻撃のときだけ） */
const dogHurt: AnimDef = {
  frames: 2, fps: 12, loop: false,
  pose(i: number, _n: number, out: Pose): void {
    out.lean = i === 0 ? -2 : -1;
    out.head = i === 0 ? -1 : 0;
    out.eyes = i === 0 ? 2 : 1;
    out.bob = i === 0 ? -1 : 0;
  },
};

/** 眠り：伏せて頭を前脚に載せる */
const dogSleep: AnimDef = {
  frames: 2, fps: 2, loop: true,
  pose(i: number, _n: number, out: Pose): void {
    out.fx = 1;
    out.eyes = 2;
    out.bob = i === 0 ? 0 : -1;
  },
};

const dog: Rig = {
  id: 'dog', tier: 'M', dirs: 3,
  anims: { idle: dogIdle, walk: walkCycle(6, 10), attack: dogBite, hurt: dogHurt, sleep: dogSleep },
  build: buildDog,
};

registerRig(dog);

registerSpecies({
  shopGuard: {
    rig: 'dog',
    variant: {
      ramps: { fur: 'earth', cream: 'bone', scarf: 'crimson', bell: 'gold', pink: 'rose', eye: 'ink' },
      params: { furShift: 1 },
    },
  },
});
