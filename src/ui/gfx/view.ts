/**
 * 画面とドットの寸法。ここの数字を変えると絵の大きさが全部変わる。
 *
 * 世界は「画用紙」（ART_W × ART_H ドット）に描き、ART_SCALE 倍で画面へ拡大する。
 * 1280 / 3 は割り切れないので、画用紙は 428 ドット（= 1284px）にして左右 2px を切る。
 * UI はこの拡大に乗らず、1280×720 の座標で画面の実画素にそのまま描く。
 */

import { SCREEN_H, SCREEN_W } from '../theme.js';

/** 1 ドット = 画面 3px（整数倍。カメラが動いてもドットが揺れない） */
export const ART_SCALE = 3;
/** 床 1 マスのドット数 */
export const TILE_ART = 16;
/** 床 1 マスの画面上の大きさ（px） */
export const TILE_PX = TILE_ART * ART_SCALE;
/** 世界の画用紙 */
export const ART_W = 428;
export const ART_H = 240;
/** 画用紙を画面へ置くときに左へずらす量（px）。1284 - 1280 = 4 の半分 */
export const CROP_X = (ART_W * ART_SCALE - SCREEN_W) / 2;
/** 画面の縦は割り切れる（720 / 3 = 240） */
export const CROP_Y = (ART_H * ART_SCALE - SCREEN_H) / 2;

/** 画用紙の x（ドット）→ 画面の x（px） */
export const artToScreenX = (ax: number): number => ax * ART_SCALE - CROP_X;
export const artToScreenY = (ay: number): number => ay * ART_SCALE - CROP_Y;
