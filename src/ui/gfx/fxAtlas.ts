/**
 * 小さなドット絵をキャンバスに焼いて覚えておく（床の道具・ワナ・状態異常の飾り・矢・魔法の玉・
 * 当たりの火花・爆発）。どれも初めて要った時に 1 度だけ焼き、あとは貼るだけ。
 *
 * 画用紙（428×240 ドット）へ等倍で貼る前提なので、焼くのも等倍（1 ドット = 1 画素）。
 */

import { ICON_SIZE, buildIcon } from '../art/items.js';
import { buildTrapIcon } from '../art/traps.js';
import {
  ARROW_SIZE, BLAST_FRAMES, BLAST_SIZE, ORB_SIZE, ORN_SIZE, SPARK_FRAMES, SPARK_SIZE, buildArrow,
  buildExplosion, buildHitSpark, buildOrb, buildOrnament, ornamentOf,
} from '../art/fxSprites.js';
import type { RampName } from '../art/palette.js';
import { PixBuf } from '../art/pixbuf.js';
import type { StatusId } from '../../core/types.js';
import { type Canvas2D, pixBufToCanvas } from './canvas.js';

const cache = new Map<string, Canvas2D | null>();

function baked(key: string, make: () => PixBuf | null): Canvas2D | null {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const b = make();
  const c = b ? pixBufToCanvas(b) : null;
  cache.set(key, c);
  return c;
}

/** 道具の絵（16×16）。鍵は iconKeyOf の結果 */
export function itemCanvas(key: string): Canvas2D | null {
  return baked(`i:${key}`, () => {
    const b = new PixBuf(ICON_SIZE, ICON_SIZE);
    return buildIcon(key, b) ? b : null;
  });
}

/** ワナの絵（16×16） */
export function trapCanvas(trapId: string): Canvas2D | null {
  return baked(`t:${trapId}`, () => {
    const b = new PixBuf(16, 16);
    return buildTrapIcon(trapId, b) ? b : null;
  });
}

/** 状態異常の飾りの 1 コマ（14×14）。飾りの無い状態なら null */
export function ornamentCanvas(id: StatusId, frame: number): Canvas2D | null {
  const spec = ornamentOf(id);
  if (!spec) return null;
  const f = ((frame % spec.frames) + spec.frames) % spec.frames;
  return baked(`o:${id}:${f}`, () => {
    const b = new PixBuf(ORN_SIZE, ORN_SIZE);
    return buildOrnament(id, f, b) ? b : null;
  });
}

/** 矢（16×16、8 方向） */
export function arrowCanvas(dir8: number, tip: RampName = 'steel'): Canvas2D {
  const d = dir8 & 7;
  return baked(`a:${d}:${tip}`, () => {
    const b = new PixBuf(ARROW_SIZE, ARROW_SIZE);
    buildArrow(d, tip, b);
    return b;
  }) as Canvas2D;
}

/** 魔法の玉（12×12、4 コマ） */
export function orbCanvas(frame: number, ramp: RampName): Canvas2D {
  const f = frame & 3;
  return baked(`b:${f}:${ramp}`, () => {
    const b = new PixBuf(ORB_SIZE, ORB_SIZE);
    buildOrb(f, ramp, b);
    return b;
  }) as Canvas2D;
}

/** 当たりの火花（16×16、4 コマ） */
export function sparkCanvas(frame: number): Canvas2D {
  const f = Math.max(0, Math.min(SPARK_FRAMES - 1, frame | 0));
  return baked(`s:${f}`, () => {
    const b = new PixBuf(SPARK_SIZE, SPARK_SIZE);
    buildHitSpark(f, b);
    return b;
  }) as Canvas2D;
}

/** 爆発（32×32、6 コマ） */
export function blastCanvas(frame: number): Canvas2D {
  const f = Math.max(0, Math.min(BLAST_FRAMES - 1, frame | 0));
  return baked(`x:${f}`, () => {
    const b = new PixBuf(BLAST_SIZE, BLAST_SIZE);
    buildExplosion(f, b);
    return b;
  }) as Canvas2D;
}

export { BLAST_FRAMES, BLAST_SIZE, ORB_SIZE, ORN_SIZE, SPARK_FRAMES, SPARK_SIZE, ARROW_SIZE };
