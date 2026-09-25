/**
 * コウモリ（どうくつ・きゅうけつ・げんわく・やみ） のリグ。
 *
 * 小さいコウモリ（S：bat）と大きいコウモリ（M：batM）は同じ組み立てで、部品の絵（BatKit）だけが違う。
 *   手前・奥向き：左右の翼 → 胴と頭（顔を翼で隠さない）。眠りだけは翼で体を包むので翼が手前
 *   横向き：奥の翼（暗い）→ 胴と頭 → 手前の翼
 * 翼は「上・中・下・たたむ」の 4 枚を手で描き、pose.fx（-1 下〜1 上）で選ぶ。
 * 右の翼は左の翼の反転で、光が左上から当たるように 1 段暗くする。
 * 横向きの翼は手前向きの左の翼をそのまま使う（後ろへ広げた翼に見える）。
 * 飛ぶので hover（6 ドット）浮かせて描き、影は描画側が地面に残す。
 *
 * 段階の差：どうくつ（茶の体・墨色の膜）→ きゅうけつ（赤・牙）→ げんわく（紫とばら色・
 * 左右で色の違う渦巻きの目）→ やみ（M。暗い体・裂けた紫の翼・光る紫の目）。
 */

import {
  type AnimDef, type DrawDir, type Pose, type Rig, type Variant, mat, registerRig, registerSpecies,
} from '../rig.js';
import { type PixBuf, runs } from '../pixbuf.js';
import { PAL_HEX, WHITE, ci } from '../palette.js';
import { type Tmpl, clamp, flipT, over, rnd, shades } from './rat.js';

// ---------------------------------------------------------------------------
// 色
// ---------------------------------------------------------------------------

/** 飾りのビット */
const F_FANG = 1;
const F_SPIRAL = 2;
const F_GLOW = 4;

function palOf(v: Readonly<Variant>): Record<string, number> {
  const glow = ((v.flags ?? 0) & F_GLOW) !== 0;
  const ws = v.params?.wingShift ?? 0;
  const fs = v.params?.furShift ?? 0;
  return {
    c: mat(v, 'fur', 1 + fs),
    b: mat(v, 'fur', 2 + fs),
    a: mat(v, 'fur', 3 + fs),
    h: mat(v, 'fur', 4 + fs),
    // 翼の膜：u 深い影 v 影 w 地 W 骨（前の縁）。胴と同じ階調の種は wingShift で暗くする
    u: mat(v, 'wing', 1 - ws),
    v: mat(v, 'wing', 2 - ws),
    w: mat(v, 'wing', 3 - ws),
    W: mat(v, 'wing', 4 - ws),
    ...shades(v, 'pink', 'rqpP_'),
    // 目：o が明るい地、e が黒目。光る目（やみ）は明るい段がそのまま光る
    o: mat(v, 'eye', glow ? 5 : 4),
    O: mat(v, 'eye', glow ? 4 : 3),
    i: mat(v, v.ramps.eye2 ? 'eye2' : 'eye', glow ? 5 : 4),
    I: mat(v, v.ramps.eye2 ? 'eye2' : 'eye', glow ? 4 : 3),
    e: mat(v, 'pupil', 0),
    E: WHITE,
    t: ci('bone', 5),
    m: ci('crimson', 1),
  };
}

/** 右の翼：光の当たらない側なので 1 段暗くする */
const DARKER: Readonly<Record<string, string>> = { W: 'w', w: 'v', v: 'u', u: 'u', h: 'a', a: 'b', b: 'c', c: 'c' };
function shadeRight(t: Tmpl): string[] {
  return flipT(t).map((row) => [...row].map((ch) => DARKER[ch] ?? ch).join(''));
}

// ---------------------------------------------------------------------------
// 部品の組
// ---------------------------------------------------------------------------

interface Part {
  t: Tmpl;
  x: number;
  y: number;
}

/** 翼の 4 枚（上・中・下・たたむ）。x, y は胴の左上から翼の左上まで */
interface WingSet {
  up: Part;
  mid: Part;
  down: Part;
  fold: Part;
}

interface BatView {
  /** 胴と頭（顔を含む）。x, y は「浮いた足元」から左上まで */
  body: Part;
  /** 口を開けた顔（噛みつく・被弾） */
  bodyOpen: Tmpl;
  /** 目の位置（胴の左上から）。1 つの目は 2×1（光る目・渦巻きの目は 2×2） */
  eyes: readonly (readonly [number, number])[];
  /** 牙（きゅうけつ）。胴の左上から */
  fangs: Part;
  /** 左の翼（手前向き・奥向き）か手前の翼（横向き） */
  wing: WingSet;
  /** 手前・奥向きの左右対称の軸（胴の左上から数えた、右端の列）。右の翼はこの軸で反転して置く */
  mirrorAt: number;
  /** 横向きの奥の翼のずれ（x, y） */
  farDx: number;
  farDy: number;
}

interface BatKit {
  /** 横向きで後ろへ引ける量（翼が画用紙の端に掛からないように） */
  leanMin: number;
  ax: number;
  ay: number;
  hover: number;
  E: BatView;
  S: BatView;
  N: BatView;
}

const EMPTY: Part = { t: [], x: 0, y: 0 };

// ---------------------------------------------------------------------------
// S の大きさ
// ---------------------------------------------------------------------------

const WINGS_S_FRONT: WingSet = {
  up: {
    x: -5, y: -1,
    t: [
      'W.......',
      'WW......',
      'wWW.....',
      'vwwW....',
      '.vwwW...',
      '.v.vwW..',
      '....vwWW',
      '......vw',
    ],
  },
  mid: {
    x: -5, y: 3,
    t: [
      '..WW.....',
      '.WwwWW...',
      'WwwwwwWWW',
      'wwwwwwwww',
      'vwwwvwwvw',
      'v.vv..vv.',
      'v..v...v.',
    ],
  },
  down: {
    x: -4, y: 6,
    t: [
      '......WW',
      '....WWww',
      '..WWwwww',
      '.Wwwwwvw',
      'Wwwwvv..',
      'v.vv.v..',
      'v.......',
    ],
  },
  fold: {
    x: -1, y: 5,
    t: [
      '..WWW',
      '.Wwww',
      'Wwwww',
      'wwwwv',
      '.wwvv',
      '..vv.',
    ],
  },
};

/** 翼の組を丸ごとずらす（横向きは手前向きの左の翼を、そのまま後ろへ広げた翼として使う） */
function shiftWings(w: WingSet, dx: number, dy: number): WingSet {
  const sh = (p: Part): Part => ({ t: p.t, x: p.x + dx, y: p.y + dy });
  return { up: sh(w.up), mid: sh(w.mid), down: sh(w.down), fold: { t: w.fold.t, x: w.fold.x + 1, y: w.fold.y - 1 } };
}

const KIT_S: BatKit = {
  ax: 12, ay: 21, hover: 6, leanMin: -1,
  S: {
    body: {
      x: -4, y: -9,
      t: [
        'h.......b',
        'hh.....bb',
        '.hpa.apb.',
        '.aahhaab.',
        '.aaaaaab.',
        '..aaaab..',
        '..hhaab..',
        '..haabb..',
        '...abb...',
        '...c.c...',
      ],
    },
    bodyOpen: [
      'h.......b',
      'hh.....bb',
      '.hpa.apb.',
      '.aahhaab.',
      '.aaaaaab.',
      '..tmmt...',
      '..hmmab..',
      '..haabb..',
      '...abb...',
      '...c.c...',
    ],
    eyes: [[2, 4], [5, 4]],
    fangs: { x: 3, y: 5, t: ['t.t'] },
    wing: WINGS_S_FRONT,
    mirrorAt: 8,
    farDx: 0, farDy: 0,
  },
  N: {
    body: {
      x: -4, y: -9,
      t: [
        'h.......b',
        'hh.....bb',
        '.haa.aab.',
        '.ahhaaab.',
        '.aaaaaab.',
        '..aaaab..',
        '..hhaab..',
        '..haabb..',
        '...abb...',
        '...c.c...',
      ],
    },
    bodyOpen: [],
    eyes: [],
    fangs: EMPTY,
    wing: WINGS_S_FRONT,
    mirrorAt: 8,
    farDx: 0, farDy: 0,
  },
  E: {
    body: {
      x: -3, y: -9,
      t: [
        '...a....',
        '..aaa...',
        '..apa...',
        '.hapaa..',
        'hhaaaaa.',
        'haaaaaaq',
        '.aaaab..',
        '..abb...',
        '..c.c...',
      ],
    },
    bodyOpen: [
      '...a....',
      '..aaa...',
      '..apa...',
      '.hapaa..',
      'hhaaaaa.',
      'haaaaamq',
      '.aaaamt.',
      '..abbt..',
      '..c.c...',
    ],
    eyes: [[5, 4]],
    fangs: { x: 6, y: 6, t: ['t'] },
    wing: shiftWings(WINGS_S_FRONT, -1, -1),
    mirrorAt: 0,
    farDx: 2, farDy: -1,
  },
};

// ---------------------------------------------------------------------------
// M の大きさ（やみのコウモリ）。翼は裂けて、縁がぼろぼろ（絵に描き込んである）
// ---------------------------------------------------------------------------

const WINGS_M_FRONT: WingSet = {
  up: {
    x: -7, y: -1,
    t: [
      'W..........',
      'WW.........',
      'wWW........',
      'wwWW.......',
      'vwwwW......',
      'vwwwwW.....',
      '.vw.wwW....',
      '.vwwwwwW...',
      '..v.vwwwW..',
      '....vwwwwW.',
      '.....v.vwwW',
      '........vwW',
      '..........W',
    ],
  },
  mid: {
    x: -7, y: 8,
    t: [
      '...WW......',
      '..WwwWW....',
      '.WwwwwwWW..',
      'WwwwwwwwwWW',
      'wwwwwwwwwww',
      'wwvwwwwvwww',
      'vwv.wwvvwwv',
      'v.v..wv..vv',
      'v....v....v',
      '.....v.....',
    ],
  },
  down: {
    x: -6, y: 11,
    t: [
      '........WW',
      '......WWww',
      '....WWwwww',
      '...Wwwwwww',
      '..Wwwwwwvw',
      '.Wwwwvwv..',
      'Wwwvwvv...',
      'wv.vv.....',
      'v..v......',
      'v.........',
    ],
  },
  fold: {
    x: -1, y: 9,
    t: [
      '....WWW',
      '..WWwww',
      '.Wwwwww',
      'Wwwwwww',
      'wwwwwww',
      'wwwwwvv',
      'wwwwvvv',
      '.wwvvvv',
      '..vvvv.',
      '...vv..',
    ],
  },
};

const KIT_M: BatKit = {
  ax: 16, ay: 37, hover: 6, leanMin: 0,
  S: {
    body: {
      x: -6, y: -16,
      t: [
        'h...........b',
        'hh.........bb',
        'hha.......abb',
        '.hpa.....apb.',
        '.hppa...appb.',
        '.hapahhhapab.',
        '..ahhhhaaaab.',
        '..aaaaaaaaab.',
        '..aaaaaaaaab.',
        '...aaaaaaab..',
        '....aaaab....',
        '...hhhaaab...',
        '..hhhaaaabb..',
        '..hhaaaaabb..',
        '...aaaaabb...',
        '....aabbb....',
        '....c...c....',
      ],
    },
    bodyOpen: [
      'h...........b',
      'hh.........bb',
      'hha.......abb',
      '.hpa.....apb.',
      '.hppa...appb.',
      '.hapahhhapab.',
      '..ahhhhaaaab.',
      '..aaaaaaaaab.',
      '..aaaaaaaaab.',
      '...atmmmtab..',
      '....tmmmt....',
      '...hhmmmab...',
      '..hhhaaaabb..',
      '..hhaaaaabb..',
      '...aaaaabb...',
      '....aabbb....',
      '....c...c....',
    ],
    eyes: [[3, 7], [8, 7]],
    fangs: { x: 5, y: 10, t: ['t.t'] },
    wing: WINGS_M_FRONT,
    mirrorAt: 12,
    farDx: 0, farDy: 0,
  },
  N: {
    body: {
      x: -6, y: -16,
      t: [
        'h...........b',
        'hh.........bb',
        'hha.......abb',
        '.haa.....aab.',
        '.haaa...aaab.',
        '.hahahhhaaab.',
        '..ahhhhaaaab.',
        '..ahhaaaaaab.',
        '..aaaaaaaaab.',
        '...aaaaaaab..',
        '....aaaab....',
        '...hhhaaab...',
        '..hhhaaaabb..',
        '..hhaaaaabb..',
        '...aaaaabb...',
        '....aabbb....',
        '....c...c....',
      ],
    },
    bodyOpen: [],
    eyes: [],
    fangs: EMPTY,
    wing: WINGS_M_FRONT,
    mirrorAt: 12,
    farDx: 0, farDy: 0,
  },
  E: {
    body: {
      x: -6, y: -15,
      t: [
        '......a.....',
        '.....aaa....',
        '.....apaa...',
        '....aappa...',
        '...hhappa...',
        '..hhhaaaaa..',
        '.hhaaaaaaaa.',
        '.haaaaaaaaa.',
        '.haaaaaaaaaq',
        '.aaaaaaaab..',
        '..aaaaaabb..',
        '..haaaabb...',
        '...aaabb....',
        '....abb.....',
        '....c.c.....',
      ],
    },
    bodyOpen: [
      '......a.....',
      '.....aaa....',
      '.....apaa...',
      '....aappa...',
      '...hhappa...',
      '..hhhaaaaa..',
      '.hhaaaaaaaa.',
      '.haaaaaaaaa.',
      '.haaaaaammaq',
      '.aaaaaamtt..',
      '..aaaaaamt..',
      '..haaaabb...',
      '...aaabb....',
      '....abb.....',
      '....c.c.....',
    ],
    eyes: [[7, 6]],
    fangs: { x: 8, y: 9, t: ['t.t'] },
    wing: shiftWings(WINGS_M_FRONT, -1, -2),
    mirrorAt: 0,
    farDx: 3, farDy: -2,
  },
};

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

function wingOf(set: WingSet, fx: number, fold: boolean): Part {
  if (fold) return set.fold;
  if (fx > 0.33) return set.up;
  if (fx < -0.33) return set.down;
  return set.mid;
}

function buildBat(K: BatKit, b: PixBuf, p: Readonly<Pose>, dir: DrawDir, v: Readonly<Variant>): void {
  const map = palOf(v);
  const flags = v.flags ?? 0;
  const V = K[dir === 'N' ? 'N' : dir === 'S' ? 'S' : 'E'];
  const fold = p.fx2 > 0.5;
  const bob = rnd(p.bob);
  const lean = rnd(p.lean);
  const dx = dir === 'E' ? clamp(lean, K.leanMin, 2) : 0;
  const dy = dir === 'S' ? clamp(lean, -2, 2) : dir === 'N' ? -clamp(lean, -2, 2) : 0;
  const bx = K.ax + V.body.x + dx;
  const by = K.ay - K.hover + V.body.y + bob + dy;
  const w = wingOf(V.wing, p.fx, fold);
  const open = rnd(p.mouth) >= 1 && V.bodyOpen.length > 0;

  const width = w.t.reduce((m, r) => Math.max(m, r.length), 0);
  const pair = (): void => {
    runs(b, bx + w.x, by + w.y, w.t, map);
    runs(b, bx + V.mirrorAt - w.x - width + 1, by + w.y, shadeRight(w.t), map);
  };
  if (dir === 'E') {
    // 奥の翼（暗い）→ 胴 → 手前の翼
    runs(b, bx + w.x + V.farDx, by + w.y + V.farDy, shadeRight(flipT(w.t)), map);
  } else if (!fold) {
    // 手前・奥向き：広げた翼は胴の奥（顔を隠さない）
    pair();
  }
  runs(b, bx, by, open ? V.bodyOpen : V.body.t, map);
  // 目
  const eyes = rnd(p.eyes);
  V.eyes.forEach(([ex, ey], i) => {
    const second = i === 1;
    const pat = eyes >= 1 ? ['ee']
      : (flags & F_SPIRAL) ? (second ? ['ie', 'ei'] : ['oe', 'eo'])
        : (flags & F_GLOW) ? ['oo', 'OO']
          : second ? ['iI'] : ['oO'];
    runs(b, bx + ex, by + ey + (eyes >= 1 ? 1 : 0), pat, map);
  });
  if ((flags & F_FANG) && !open) over(b, bx + V.fangs.x, by + V.fangs.y, V.fangs.t, map);
  // 手前の翼（横向き）・体を包んだ翼（眠り）
  if (dir === 'E') runs(b, bx + w.x, by + w.y, w.t, map);
  else if (fold) pair();
}

// ---------------------------------------------------------------------------
// 動き
// ---------------------------------------------------------------------------

/** 待機：ゆっくり羽ばたき、体は 1 ドットだけ上下 */
const batIdle: AnimDef = {
  frames: 4, fps: 6, loop: true,
  pose(i: number, _n: number, out: Pose): void {
    out.fx = [1, 0, -1, 0][i];
    out.bob = [0, -1, -1, 0][i];
  },
};

/** 移動：速く羽ばたき、打ち下ろしで体が持ち上がる */
const batFly: AnimDef = {
  frames: 4, fps: 12, loop: true,
  pose(i: number, _n: number, out: Pose): void {
    out.fx = [1, 0, -1, 0][i];
    out.bob = [1, 0, -1, 0][i];
  },
};

/** 噛みつき：翼を振り上げて溜める → 翼を打ち下ろして前へ飛び込む（当たり）→ 戻る */
const batBite: AnimDef = {
  frames: 5, fps: 15, loop: false, strike: 2,
  pose(i: number, _n: number, out: Pose): void {
    out.fx = [0, 1, 0, -1, 0][i];
    out.bob = [0, -1, 1, 0, 0][i];
    out.lean = [0, -1, 2, 1, 0][i];
    out.mouth = i === 2 ? 1 : 0;
    out.eyes = i === 2 ? 0 : 0;
  },
};

/** 被弾：翼が縮こまり、目を閉じてのけぞる */
const batHurt: AnimDef = {
  frames: 2, fps: 12, loop: false,
  pose(i: number, _n: number, out: Pose): void {
    out.fx = -1;
    out.lean = i === 0 ? -2 : -1;
    out.bob = i === 0 ? -1 : 0;
    out.eyes = 2;
    out.mouth = 1;
  },
};

/** 眠り：翼で体を包み、ゆっくり上下 */
const batSleep: AnimDef = {
  frames: 2, fps: 2, loop: true,
  pose(i: number, _n: number, out: Pose): void {
    out.fx2 = 1;
    out.eyes = 2;
    out.bob = i === 0 ? 0 : 1;
  },
};

const ANIMS = { idle: batIdle, walk: batFly, attack: batBite, hurt: batHurt, sleep: batSleep };

const batS: Rig = {
  id: 'bat', tier: 'S', dirs: 3, hover: 6, anims: ANIMS,
  build: (b, p, dir, v) => buildBat(KIT_S, b, p, dir, v),
};

const batM: Rig = {
  id: 'batM', tier: 'M', dirs: 3, hover: 6, anims: ANIMS,
  build: (b, p, dir, v) => buildBat(KIT_M, b, p, dir, v),
};

registerRig(batS);
registerRig(batM);

registerSpecies({
  batCave: {
    rig: 'bat',
    variant: {
      ramps: { fur: 'earth', wing: 'ink', pink: 'rose', eye: 'gold', pupil: 'ink' },
      params: { furShift: 1 },
    },
  },
  batBlood: {
    rig: 'bat',
    variant: {
      ramps: { fur: 'crimson', wing: 'crimson', pink: 'rose', eye: 'gold', pupil: 'ink' },
      flags: F_FANG,
      params: { wingShift: 1 },
    },
  },
  batMad: {
    rig: 'bat',
    variant: {
      ramps: { fur: 'violet', wing: 'rose', pink: 'rose', eye: 'gold', eye2: 'moss', pupil: 'violet' },
      flags: F_SPIRAL,
    },
  },
  batAbyss: {
    rig: 'batM',
    variant: {
      ramps: { fur: 'ink', wing: 'violet', pink: 'violet', eye: 'violet', pupil: 'ink' },
      flags: F_GLOW | F_FANG,
      params: { wingShift: 1 },
    },
    light: { color: PAL_HEX[ci('violet', 4)], radius: 1.5, intensity: 0.45 },
  },
});
