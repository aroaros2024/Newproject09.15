/**
 * よく使う動きの曲線。
 *
 * どのリグも同じ曲線を使えば、描き手が違っても間（ま）と重さが揃う。
 * 値は小数のまま返す。整数に丸めるのはリグの build（描く瞬間）。
 *
 * 目安（docs/ART_GUIDE.md と同じ）
 *   待機 4 コマ・4fps、歩き 8（主人公）/ 6（中・大）/ 4（小・跳ねる）、
 *   攻撃 6 コマ・15fps（3 コマ目が当たり）、詠唱 6 コマ・12fps、被弾 2 コマ・12fps、眠り 2 コマ・2fps
 */

import type { AnimDef, Pose } from './rig.js';

// ---------------------------------------------------------------------------
// 緩急
// ---------------------------------------------------------------------------

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const easeIn = (t: number): number => t * t;
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
/** 少し行き過ぎて戻る（着地・打撃の後） */
export const easeOutBack = (t: number): number => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
/** 0 → 1 → 0 */
export const pingpong = (t: number): number => (t < 0.5 ? t * 2 : 2 - t * 2);
/** 一周の正弦（0〜1 の位相） */
export const wave = (phase: number): number => Math.sin(phase * Math.PI * 2);

/** キーフレーム表から値を引く。keys は [時刻(0〜1), 値] の昇順 */
export function keyed(keys: readonly (readonly [number, number])[], t: number,
  ease: (t: number) => number = easeInOut): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return lerp(v0, v1, ease((t - t0) / Math.max(1e-6, t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}

// ---------------------------------------------------------------------------
// 動きの型
// ---------------------------------------------------------------------------

/** 待機：胴と頭だけが 1 ドット上下する。足は動かさない */
export function idleBreath(frames = 4, fps = 4, amp = 1): AnimDef {
  return {
    frames, fps, loop: true,
    pose(i: number, n: number, out: Pose): void {
      const t = i / n;
      out.bob = -amp * (wave(t) > 0.3 ? 1 : 0);
      out.head = out.bob;
      out.sway = wave(t + 0.25) * 1.2;
      out.armF = 0.05 * wave(t);
    },
  };
}

/** 歩き：脚を交互に出し、踏み込みで 1 ドット沈む。腕は脚と逆 */
export function walkCycle(frames = 8, fps = 10): AnimDef {
  return {
    frames, fps, loop: true,
    pose(i: number, n: number, out: Pose): void {
      const t = i / n;
      const s = wave(t);
      out.legL = s;
      out.legR = -s;
      out.bob = -Math.abs(wave(t * 2 + 0.25)) * 1 + 0.5;
      out.armF = 0.35 - s * 0.35;
      out.armB = 0.35 + s * 0.35;
      out.sway = -s * 1.5;
      out.lean = 0.5;
    },
  };
}

/** 跳ねる歩き（小さな敵）：縮む → 伸びて跳ぶ → 頂点 → 着地 */
export function hop(frames = 4, fps = 10, height = 3): AnimDef {
  return {
    frames, fps, loop: true,
    pose(i: number, n: number, out: Pose): void {
      const t = i / n;
      out.bob = -height * Math.max(0, Math.sin(t * Math.PI * 2));
      const land = Math.cos(t * Math.PI * 2);
      out.sqY = land > 0.6 ? -1.5 : land < -0.2 ? 1.5 : 0;
      out.sqX = -out.sqY;
      out.lean = 0.5;
    },
  };
}

/** 羽ばたき（コウモリ・鳥）：fx が翼の角度 -1（下）〜 1（上） */
export function flap(frames = 4, fps = 10, bobAmp = 2): AnimDef {
  return {
    frames, fps, loop: true,
    pose(i: number, n: number, out: Pose): void {
      const t = i / n;
      out.fx = wave(t + 0.25);
      out.bob = -bobAmp * (0.5 + 0.5 * wave(t));
    },
  };
}

/**
 * 武器を振る。振りかぶり → 当たり → 振り抜き → 戻り。
 * weapon は 22.5° 刻み（0 が真上、4 が前）。
 */
export function attackSwing(frames = 6, fps = 15, strike = 2): AnimDef {
  return {
    frames, fps, loop: false, strike,
    pose(i: number, n: number, out: Pose): void {
      const t = i / Math.max(1, n - 1);
      const k = strike / Math.max(1, n - 1);
      if (t < k) {
        // 振りかぶり：後ろへ体重を移し、武器を頭の後ろへ
        const u = easeOut(t / k);
        out.lean = -2 * u;
        out.weapon = lerp(2, 14, u);
        out.armF = lerp(0.5, 2, u);
        out.bob = -u;
      } else {
        const u = (t - k) / Math.max(1e-6, 1 - k);
        out.lean = keyed([[0, 3], [0.4, 2], [1, 0]], u);
        out.weapon = keyed([[0, 5], [0.4, 7], [1, 3]], u);
        out.armF = keyed([[0, 1], [0.4, 0.6], [1, 0.3]], u);
        out.mouth = u < 0.3 ? 1 : 0;
      }
    },
  };
}

/** 体当たり・噛みつき（武器を持たない敵）：縮んで溜める → 前へ伸びる → 戻る */
export function lunge(frames = 5, fps = 15, strike = 2, reach = 4): AnimDef {
  return {
    frames, fps, loop: false, strike,
    pose(i: number, n: number, out: Pose): void {
      const t = i / Math.max(1, n - 1);
      const k = strike / Math.max(1, n - 1);
      if (t < k) {
        const u = easeOut(t / k);
        out.lean = -2 * u;
        out.sqX = -u;
        out.sqY = -u;
      } else {
        const u = (t - k) / Math.max(1e-6, 1 - k);
        out.lean = lerp(reach, 0, easeInOut(u));
        out.sqX = lerp(1.5, 0, u);
        out.mouth = u < 0.5 ? 2 : 0;
        out.eyes = u < 0.3 ? 1 : 0;
      }
    },
  };
}

/** 詠唱：杖を掲げ、宝石が明るくなり、放つ。fx は火花の位相（0〜1） */
export function castRaise(frames = 6, fps = 12, strike = 4): AnimDef {
  return {
    frames, fps, loop: false, strike,
    pose(i: number, n: number, out: Pose): void {
      const t = i / Math.max(1, n - 1);
      const k = strike / Math.max(1, n - 1);
      if (t <= k) {
        const u = easeInOut(t / k);
        out.armF = lerp(0.5, 2, u);
        out.weapon = lerp(2, 0, u);
        out.glow = u;
        out.lean = -u;
        out.head = -u;
        out.fx = u;
      } else {
        const u = (t - k) / Math.max(1e-6, 1 - k);
        out.armF = lerp(2, 1, u);
        out.weapon = lerp(0, 3, u);
        out.glow = 1 - u;
        out.lean = lerp(2, 0, u);
        out.mouth = 1;
        out.fx = 1;
      }
    },
  };
}

/** 被弾：のけぞって目を閉じる */
export function hurt(frames = 2, fps = 12): AnimDef {
  return {
    frames, fps, loop: false,
    pose(i: number, _n: number, out: Pose): void {
      out.lean = i === 0 ? -2 : -1;
      out.eyes = i === 0 ? 2 : 1;
      out.mouth = 1;
      out.sqX = i === 0 ? 1 : 0;
      out.sqY = i === 0 ? -1 : 0;
      out.head = i === 0 ? 1 : 0;
    },
  };
}

/** 眠り：目を閉じ、ゆっくり上下（fx は Z の位相） */
export function sleep(frames = 2, fps = 2): AnimDef {
  return {
    frames, fps, loop: true,
    pose(i: number, _n: number, out: Pose): void {
      out.eyes = 2;
      out.bob = i === 0 ? 0 : 1;
      out.head = i === 0 ? 1 : 2;
      out.sqY = i === 0 ? 0 : -1;
      out.fx = i;
    },
  };
}

/** 道具を使う（主人公）：前へ掲げる */
export function useItem(frames = 4, fps = 12): AnimDef {
  return {
    frames, fps, loop: false, strike: 2,
    pose(i: number, n: number, out: Pose): void {
      const t = i / Math.max(1, n - 1);
      out.armF = keyed([[0, 0.3], [0.5, 1.6], [1, 0.5]], t);
      out.head = t < 0.7 ? -1 : 0;
      out.glow = pingpong(t);
    },
  };
}
