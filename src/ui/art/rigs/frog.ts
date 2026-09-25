/**
 * カエル（アマガエル・デカガエル）のリグ。
 *
 *   frog  (S) … アマガエル。若葉色の小さな体、大きな目、白い喉、目を通る焦げ茶の筋
 *   frogM (M) … デカガエル。同じ組み立てで大きく平たく、頭が広い。背にいぼ、金の目。舌を伸ばす
 *
 * 部品（腿・体・頭・目の瘤・喉・手足）を、左上から光の当たった楕円で重ねて組み立てる。
 * 向きは S（手前）・E（右）・N（奥）の 3 つ。西は E の反転。
 */

import { type DrawDir, type Pose, type Rig, type Variant, mat, registerRig, registerSpecies } from '../rig.js';
import { type PixBuf, line, runs } from '../pixbuf.js';
import { table } from './slime.js';

const R = Math.round;

// ---------------------------------------------------------------------------
// 部品を描く道具
// ---------------------------------------------------------------------------

/**
 * 陰の付いた楕円。左上・手前からの光で 4 段（1〜4）に塗る。
 * shift で全体の段をずらす（奥の部品を 1 段暗く）。clipY より下の行は描かない。
 */
function orb(
  b: PixBuf, cx: number, cy: number, rx: number, ry: number, v: Readonly<Variant>, m: string,
  shift = 0, clipY = 999,
): void {
  for (let dy = -ry; dy <= ry; dy++) {
    const y = cy + dy;
    if (y > clipY) break;
    const t = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5));
    if (t <= 0) continue;
    const hw = Math.floor((rx + 0.5) * Math.sqrt(t));
    for (let x = cx - hw; x <= cx + hw; x++) {
      const nx = (x - cx) / (rx + 0.5);
      const ny = dy / (ry + 0.5);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const d = -0.5 * nx - 0.62 * ny + 0.6 * nz;
      const step = d > 0.8 ? 4 : d > 0.42 ? 3 : d > 0.02 ? 2 : 1;
      b.set(x, y, mat(v, m, Math.max(1, step + shift)));
    }
  }
}

/** 太さ 2 の手足。横に寝た線は下の列、立った線は右の列を 1 段暗く */
function limb(b: PixBuf, x0: number, y0: number, x1: number, y1: number, v: Readonly<Variant>, m: string): void {
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) line(b, x0, y0 + 1, x1, y1 + 1, mat(v, m, 2));
  else line(b, x0 + 1, y0, x1 + 1, y1, mat(v, m, 2));
  line(b, x0, y0, x1, y1, mat(v, m, 3));
}

// ---------------------------------------------------------------------------
// 大きさの設定
// ---------------------------------------------------------------------------

interface FrogCfg {
  cx: number;
  ay: number;
  /** 姿勢の値を何倍にするか */
  k: number;
  /** 手前・奥の体（中心は足元から dy 上） */
  bodyRx: number;
  bodyRy: number;
  bodyDy: number;
  /** 目の瘤の半径・左右の間・高さ */
  eyeR: number;
  eyeDx: number;
  eyeDy: number;
  /** 腿の半径と左右の間 */
  thighR: number;
  thighDx: number;
  /** 横向き：背（後ろ）と頭（前）の楕円 */
  backRx: number;
  backRy: number;
  backDx: number;
  backDy: number;
  headRx: number;
  headRy: number;
  headDx: number;
  headDy: number;
  /** 喉の袋 */
  throatRx: number;
  throatRy: number;
  /** いぼ（デカガエル） */
  warts: boolean;
  /** 舌の最長（横向き） */
  tongue: number;
  /** 横向きの体を足元からずらす（舌の伸びる余地を作る） */
  sideDx: number;
}

const FROG_S: FrogCfg = {
  cx: 12, ay: 21, k: 1,
  bodyRx: 6, bodyRy: 4, bodyDy: 5,
  eyeR: 2, eyeDx: 4, eyeDy: 9,
  thighR: 2, thighDx: 6,
  backRx: 6, backRy: 4, backDx: -1, backDy: 4,
  headRx: 4, headRy: 3, headDx: 4, headDy: 7,
  throatRx: 3, throatRy: 1,
  warts: false, tongue: 0, sideDx: -1,
};

const FROG_M: FrogCfg = {
  cx: 16, ay: 37, k: 2,
  bodyRx: 10, bodyRy: 7, bodyDy: 8,
  eyeR: 3, eyeDx: 7, eyeDy: 14,
  thighR: 3, thighDx: 9,
  backRx: 10, backRy: 7, backDx: -1, backDy: 7,
  headRx: 6, headRy: 5, headDx: 5, headDy: 10,
  throatRx: 6, throatRy: 2,
  warts: true, tongue: 9, sideDx: -1,
};

// ---------------------------------------------------------------------------
// 目
// ---------------------------------------------------------------------------

/** 目：e = 瞳、r = 虹彩、g = 光。open / squint / closed */
function eye(
  b: PixBuf, x: number, y: number, v: Readonly<Variant>, big: boolean, state: number, flip: boolean,
): void {
  const map = { e: mat(v, 'eye', 0), r: mat(v, 'iris', 3), s: mat(v, 'iris', 2), g: mat(v, 'glint', 5) };
  if (state >= 1.5) {
    runs(b, x, y + (big ? 1 : 0), big ? ['.....', 'eeee.'] : ['..', 'ee'], map, flip);
    return;
  }
  if (state >= 0.5) {
    runs(b, x, y + (big ? 1 : 0), big ? ['.....', 'reeer', '.sss.'] : ['..', 'ee'], map, flip);
    return;
  }
  runs(b, x, y, big ? ['.rrr.', 'rgeer', 'reeer', '.sss.'] : ['ge', 'ee'], map, flip);
}

// ---------------------------------------------------------------------------
// 向きごとの組み立て
// ---------------------------------------------------------------------------

/** いぼの置き場（体の中心からの比率）。手前・奥の向き */
const WARTS_FRONT: readonly (readonly [number, number])[] = [
  [-0.55, -0.55], [0.35, -0.7], [0.7, -0.2], [-0.8, 0.0], [0.05, -0.85], [-0.2, -0.35],
];
/** 横向き（背の楕円の中心からの比率） */
const WARTS_SIDE: readonly (readonly [number, number])[] = [
  [-0.5, -0.6], [0.1, -0.85], [-0.8, -0.1], [0.5, -0.5], [-0.25, -0.2],
];

function wart(b: PixBuf, x: number, y: number, v: Readonly<Variant>): void {
  b.set(x, y, mat(v, 'wart', 4));
  b.set(x + 1, y, mat(v, 'wart', 3));
  b.set(x, y + 1, mat(v, 'wart', 3));
}

function drawFront(b: PixBuf, p: Readonly<Pose>, v: Readonly<Variant>, c: FrogCfg, back: boolean): void {
  const { cx, ay, k } = c;
  const air = R(p.bob * k);
  const crouch = p.sqY < -0.5 ? 1 : 0;
  const stretch = p.sqY > 0.5 ? 1 : 0;
  // 奥向きで前へ跳ぶときは上（奥）へずれる
  const fy = back ? -Math.max(0, R(p.lean * k * 0.5)) : 0;
  const y0 = ay + air + fy;
  const ext = p.legL > 0.5;
  // 後ろ足：地面の足（跳ぶと下へ伸びる）
  const footY = ext ? Math.min(ay, y0 + 1) : y0;
  const fdx = c.thighDx + (ext ? 1 : 2);
  const foot = c.k > 1 ? ['bbb.', 'b.b.b'] : ['bb', 'b.b'];
  const fmap = { b: mat(v, 'body', 3) };
  runs(b, cx - fdx - (c.k > 1 ? 2 : 1), footY - 1, foot, fmap, false);
  runs(b, cx + fdx - (c.k > 1 ? 2 : 1), footY - 1, foot, fmap, true);
  // 腿
  const thY = y0 - c.thighR - (ext ? c.thighR : 0);
  const tr = c.thighR - (ext ? 1 : 0);
  orb(b, cx - c.thighDx, thY, tr, c.thighR, v, 'body', back ? 0 : -1, y0);
  orb(b, cx + c.thighDx, thY, tr, c.thighR, v, 'body', back ? 0 : -1, y0);
  if (ext) {
    limb(b, cx - c.thighDx, thY, cx - fdx, footY - 1, v, 'body');
    limb(b, cx + c.thighDx, thY, cx + fdx, footY - 1, v, 'body');
  }
  // 体
  const brx = c.bodyRx + crouch - stretch;
  const bry = c.bodyRy - crouch + stretch;
  const bcy = y0 - c.bodyDy + crouch;
  orb(b, cx, bcy, brx, bry + 1, v, 'body', 0, y0 - 1);
  // 目の瘤
  const ey = bcy - (c.eyeDy - c.bodyDy) + crouch;
  orb(b, cx - c.eyeDx, ey, c.eyeR, c.eyeR, v, 'body', 0);
  orb(b, cx + c.eyeDx, ey, c.eyeR, c.eyeR, v, 'body', 0);
  if (c.warts) {
    for (const [wx, wy] of WARTS_FRONT) {
      const x = cx + R(wx * brx);
      const y = bcy + R(wy * bry);
      if (back || wy < -0.3) wart(b, x, y, v);
    }
  }
  if (back) {
    // 背：奥にある目の瘤の外側に目の端が少し見える
    const e = mat(v, 'eye', 0);
    b.set(cx - c.eyeDx - c.eyeR, ey, e);
    b.set(cx + c.eyeDx + c.eyeR, ey, e);
    if (c.k > 1) {
      b.set(cx - c.eyeDx - c.eyeR, ey - 1, e);
      b.set(cx + c.eyeDx + c.eyeR, ey - 1, e);
    }
    // 奥へ伸びる舌（頭の先から上へ）
    if (p.fx > 0.05 && c.tongue > 0) {
      const top = Math.max(4, ey - c.eyeR - R(p.fx * c.tongue * 1.2));
      for (let y = top + 2; y <= ey; y++) {
        b.set(cx, y, mat(v, 'tongue', 4));
        b.set(cx + 1, y, mat(v, 'tongue', 3));
      }
      runs(b, cx - 1, top, ['.ut.', 'uttq', '.tq.'], {
        u: mat(v, 'tongue', 4), t: mat(v, 'tongue', 3), q: mat(v, 'tongue', 2),
      });
    }
    return;
  }
  // 喉・手
  const thr = c.throatRy + (p.fx2 > 0.5 ? 1 : 0);
  orb(b, cx, y0 - 1 - c.throatRy, c.throatRx, thr, v, 'belly', 1, y0 - 1);
  const arm = p.armF > 0.5;
  const hx = c.throatRx + 1 + (arm ? 1 : 0);
  const hand = c.k > 1 ? ['.a.', 'a.a', 'hhh'] : ['a', 'hh'];
  const hmap = { a: mat(v, 'body', 3), h: mat(v, 'body', 4) };
  runs(b, cx - hx - (c.k > 1 ? 2 : 1), y0 - hand.length + 1, hand, hmap, false);
  runs(b, cx + hx, y0 - hand.length + 1, hand, hmap, true);
  // 口
  const my = bcy + (c.k > 1 ? 2 : 1);
  const mw = brx - 1;
  const m = mat(v, 'body', 1);
  if (p.mouth >= 0.5) {
    const open = p.mouth >= 1.5 ? 2 : 1;
    const ox = mw - 1;
    for (let dy = 0; dy <= open * c.k; dy++) {
      const w = dy === 0 || dy === open * c.k ? ox - 1 : ox;
      for (let x = -w; x <= w; x++) b.set(cx + x, my + dy, dy === 0 ? m : mat(v, 'mouth', 1));
    }
    const tw = Math.max(1, (ox >> 1));
    for (let x = -tw; x <= tw; x++) b.set(cx + x, my + open * c.k - (c.k > 1 ? 1 : 0), mat(v, 'tongue', 3));
    if (p.fx > 0.3 && c.tongue > 0) {
      // 手前へ伸びる舌：口から足元の手前まで。先が丸くふくらむ（こちらへ向かってくる）
      const t0 = my + 1;
      const t1 = Math.min(y0 - 1, t0 + R(p.fx * c.tongue * 0.9));
      for (let y = t0; y <= t1 - 2; y++) {
        b.set(cx - 1, y, mat(v, 'tongue', 4));
        b.set(cx, y, mat(v, 'tongue', 3));
        b.set(cx + 1, y, mat(v, 'tongue', 2));
      }
      runs(b, cx - 2, t1 - 2, ['.uut.', 'uuttq', '.tqq.'], {
        u: mat(v, 'tongue', 4), t: mat(v, 'tongue', 3), q: mat(v, 'tongue', 2),
      });
    }
  } else {
    line(b, cx - mw, my - 1, cx - mw + 2, my, m);
    line(b, cx - mw + 2, my, cx + mw - 2, my, m);
    line(b, cx + mw - 2, my, cx + mw, my - 1, m);
  }
  // 目の筋（アマガエル）と目
  const big = c.k > 1;
  if (v.ramps.stripe) {
    const s = mat(v, 'stripe', 2);
    line(b, cx - c.eyeDx - c.eyeR, ey + 1, cx - mw, my - 1, s);
    line(b, cx + c.eyeDx + c.eyeR, ey + 1, cx + mw, my - 1, s);
  }
  const ew = big ? 5 : 2;
  eye(b, cx - c.eyeDx - (big ? 3 : 1), ey - (big ? 2 : 1), v, big, p.eyes, false);
  // 右目も反転しない（光を両目とも左上に）
  eye(b, cx + c.eyeDx + (big ? 3 : 1) - ew + 1, ey - (big ? 2 : 1), v, big, p.eyes, false);
}

function drawSide(b: PixBuf, p: Readonly<Pose>, v: Readonly<Variant>, c: FrogCfg): void {
  const { cx, ay, k } = c;
  const big = k > 1;
  const air = Math.min(0, R(p.bob * k));
  // 前へ出られるのは画用紙に収まるところまで
  const front = cx + c.sideDx + c.headDx + c.headRx + 2;
  const rear = cx + c.sideDx + c.backDx - c.backRx - 1;
  const lean = Math.max(3 - rear, Math.min(R(p.lean * k), b.w - 3 - front));
  const crouch = p.sqY < -0.5 ? 1 : 0;
  const stretch = p.sqY > 0.5 ? 1 : 0;
  const y0 = ay + air;
  const x0 = cx + c.sideDx + lean;
  const ext = p.legL > 0.5;
  const backX = x0 + c.backDx;
  const backY = y0 - c.backDy + crouch - stretch;
  const rearX = backX - c.backRx;
  const thR = c.thighR + 1;
  const thX = rearX + thR - (ext ? 1 : 0);
  const thY = y0 - thR;
  const foot = { b: mat(v, 'body', 3), h: mat(v, 'body', 4) };
  // 1. 伸びた後ろ足（体の後ろ）：腰 → 膝 → 足先が地面の方へ
  if (ext) {
    const kneeX = rearX - (big ? 2 : 1);
    const kneeY = thY + (big ? 3 : 2);
    const footX = Math.max(3, kneeX - (big ? 4 : 2));
    const footY = Math.min(ay, kneeY + (big ? 4 : 2));
    limb(b, thX, thY, kneeX, kneeY, v, 'body');
    limb(b, kneeX, kneeY, footX, footY - 1, v, 'body');
    runs(b, footX - 1, footY - 1, big ? ['h.h', '.bb'] : ['h.', '.b'], foot);
  }
  // 2. 背と頭
  const hx = x0 + c.headDx + (ext ? 1 : 0);
  const hy = y0 - c.headDy + crouch - stretch;
  orb(b, backX, backY, c.backRx + crouch, c.backRy - crouch + stretch, v, 'body', 0, y0 - 1);
  orb(b, hx, hy, c.headRx, c.headRy, v, 'body', 0, y0 - 1);
  // 3. 畳んだ後ろ足：地面に沿った足先と、丸い腿
  if (!ext) {
    const fx0 = thX - (big ? 1 : 0);
    const fx1 = thX + thR + (big ? 4 : 2);
    for (let x = fx0; x <= fx1; x++) b.set(x, y0, mat(v, 'body', 2));
    runs(b, fx1, y0 - 1, big ? ['.h', 'hb'] : ['h', 'b'], foot);
    orb(b, thX, thY, thR, thR, v, 'body', 0, y0 - 1);
  } else {
    orb(b, thX, thY, thR - 1, thR - 1, v, 'body', 0, y0 - 1);
  }
  // 4. 喉（頭の下だけ白い）
  const pulse = p.fx2 > 0.5 ? 1 : 0;
  orb(b, hx + 1, hy + c.headRy, c.headRx - 2, c.throatRy - (big ? 1 : 0) + pulse, v, 'belly', 1, y0 - 1);
  // 5. 前足
  const sx = hx - (big ? 1 : 0);
  const sy = hy + c.headRy;
  const reach = p.armF > 0.5;
  const ax = sx + (reach ? (big ? 4 : 3) : big ? 1 : 0);
  limb(b, sx, sy, ax, y0 - 1, v, 'body');
  runs(b, ax - (big ? 1 : 0), y0, big ? ['hhhh'] : ['hh'], foot);
  // 6. いぼ
  if (c.warts) {
    for (const [wx, wy] of WARTS_SIDE) wart(b, backX + R(wx * c.backRx), backY + R(wy * c.backRy), v);
  }
  // 7. 口と舌
  const mFront = hx + c.headRx;
  const my = hy + 1;
  const mBack = hx - (big ? 2 : 1);
  if (p.mouth >= 0.5) {
    const open = p.mouth >= 1.5 ? (big ? 3 : 2) : big ? 2 : 1;
    for (let i = 0; i <= open; i++) {
      const x1 = mFront - (i === 0 ? 0 : 1);
      line(b, mBack + i, my + i, x1, my + i, mat(v, 'mouth', 1));
    }
    line(b, mBack + open, my + open, mFront - 2, my + open, mat(v, 'tongue', 3));
    if (p.fx > 0.05 && c.tongue > 0) {
      const len = R(p.fx * c.tongue);
      const ty = my + (open >> 1);
      const tx1 = Math.min(b.w - 5, mFront + len);
      line(b, mFront - 2, ty, tx1, ty, mat(v, 'tongue', 4));
      line(b, mFront - 2, ty + 1, tx1, ty + 1, mat(v, 'tongue', 3));
      runs(b, tx1, ty - 1, ['uu.', 'utt', '.tt'], { u: mat(v, 'tongue', 4), t: mat(v, 'tongue', 3) });
    }
  } else {
    line(b, mBack, my, mFront - 1, my, mat(v, 'body', 1));
    b.set(mBack - 1, my - 1, mat(v, 'body', 1));
  }
  // 8. 目の瘤・目・目を通る筋
  const ex = hx + (big ? 1 : 0);
  const ey = hy - c.headRy + crouch;
  orb(b, ex, ey, c.eyeR, c.eyeR, v, 'body', 0);
  if (v.ramps.stripe) {
    const st = mat(v, 'stripe', 2);
    line(b, mFront - 1, my - 1, ex + c.eyeR - 1, ey + 1, st);
  }
  eye(b, ex - (big ? 1 : 0), ey - (big ? 2 : 1), v, big, p.eyes, false);
}

function drawFrog(b: PixBuf, p: Readonly<Pose>, dir: DrawDir, v: Readonly<Variant>, c: FrogCfg): void {
  if (dir === 'E') drawSide(b, p, v, c);
  else drawFront(b, p, v, c, dir === 'N');
}

// ---------------------------------------------------------------------------
// 動き
// ---------------------------------------------------------------------------

/** 待機：喉の袋が 1 ドットふくらみ、体が 1 ドット沈む */
const frogIdle = table([
  {},
  { fx2: 1 },
  { fx2: 1, sqY: -1 },
  {},
], 4, true);

/** 跳ねる：かがむ → 蹴り出す（足が伸びる）→ 空中 → 着地 */
const frogHop = table([
  { sqY: -1 },
  { bob: -2, legL: 1, sqY: 1, lean: 1 },
  { bob: -4, legL: 1, armF: 1, lean: 1 },
  { bob: -1, armF: 1 },
], 10, true);

/** 飛びかかる：かがむ（溜め）→ 跳ぶ → 当たり（体を伸ばし口を開く）→ 着地 → 戻る */
const frogLeap = table([
  { sqY: -1, eyes: 1 },
  { bob: -2, legL: 1, sqY: 1, lean: 1 },
  { bob: -2, legL: 1, armF: 1, lean: 3, mouth: 1 },
  { sqY: -1, lean: 1 },
  {},
], 15, false, 2);

/** 舌：かがんで溜め → 口を開く → 当たり（舌がいちばん伸びる）→ 舌が戻る → 口を閉じる */
const frogTongue = table([
  { sqY: -1, eyes: 1, fx2: 1 },
  { mouth: 1, sqY: 1 },
  { mouth: 2, fx: 1, lean: 1, eyes: 1 },
  { mouth: 1, fx: 0.5 },
  { fx2: 1 },
], 15, false, 2);

/** 大きな跳ね（デカガエル）：6 コマ */
const frogHopM = table([
  { sqY: -1 },
  { bob: -1, legL: 1, sqY: 1, lean: 0.5 },
  { bob: -2, legL: 1, lean: 1 },
  { bob: -2, legL: 1, armF: 1, lean: 1 },
  { bob: -1, armF: 1 },
  { sqY: -1 },
], 10, true);

const frogHurt = table([
  { lean: -2, sqY: -1, eyes: 2, mouth: 1 },
  { lean: -1, eyes: 2 },
], 12, false);

const frogSleep = table([
  { eyes: 2, sqY: -1 },
  { eyes: 2, sqY: -1, fx2: 1 },
], 2, true);

// ---------------------------------------------------------------------------
// 登録
// ---------------------------------------------------------------------------

const frog: Rig = {
  id: 'frog', tier: 'S', dirs: 3,
  anims: { idle: frogIdle, walk: frogHop, attack: frogLeap, hurt: frogHurt, sleep: frogSleep },
  build(b: PixBuf, p: Readonly<Pose>, dir: DrawDir, v: Readonly<Variant>): void {
    drawFrog(b, p, dir, v, FROG_S);
  },
};

const frogM: Rig = {
  id: 'frogM', tier: 'M', dirs: 3,
  anims: { idle: frogIdle, walk: frogHopM, attack: frogTongue, hurt: frogHurt, sleep: frogSleep },
  build(b: PixBuf, p: Readonly<Pose>, dir: DrawDir, v: Readonly<Variant>): void {
    drawFrog(b, p, dir, v, FROG_M);
  },
};

registerRig(frog);
registerRig(frogM);

registerSpecies({
  frogTree: {
    rig: 'frog',
    variant: {
      ramps: {
        body: 'leaf', belly: 'bone', eye: 'ink', iris: 'gold', glint: 'bone', stripe: 'earth',
        mouth: 'crimson', tongue: 'rose',
      },
    },
  },
  frogGiant: {
    rig: 'frogM',
    variant: {
      ramps: {
        body: 'moss', belly: 'bone', eye: 'ink', iris: 'gold', glint: 'bone', wart: 'earth',
        mouth: 'crimson', tongue: 'rose',
      },
    },
  },
});
