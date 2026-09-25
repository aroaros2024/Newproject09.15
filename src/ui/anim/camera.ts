/**
 * カメラ（世界の画用紙のドット単位）。
 *
 * 追う位置は小数で滑らかに動かし、描くときは整数に丸めた camX / camY を使う。
 * 画用紙を整数の位置で貼れば、拡大したドットの幅が揺れない（HD-2D の「ドットの揺れ」対策）。
 *
 * 追い方は指数の追従（時定数 tau）。旧 renderer.ts の Camera は「1 フレームで 18% 寄る」
 * だったので、同じ手触りになる時定数（約 80ms）にしてある。固定 60Hz でなくても同じ速さで寄る。
 *
 * 毎刻み呼ぶ follow() / tick() は、小数を関数の引数や戻り値で受け渡さない（V8 が小数の箱
 * HeapNumber を作ることがあり、毎刻みの割り当てをゼロにできないため）。中身はフィールドで渡す。
 */

import { ART_H, ART_W, TILE_ART } from '../gfx/view.js';

export class Camera {
  /** 左上の位置（ドット、小数） */
  x = 0;
  y = 0;
  /** 描くときに使う左上の位置（ドット、整数） */
  camX = 0;
  camY = 0;
  /** 画面に映る大きさ（ドット） */
  readonly viewW: number;
  readonly viewH: number;
  /** 追従の時定数（ミリ秒）。小さいほど速く寄る */
  tau = 80;
  /** 固定刻みの長さ（ミリ秒）。tick() はこれだけ寄る */
  tickMs = 1000 / 60;

  private tx = 0;
  private ty = 0;
  /** 中央に置きたい点（ドット）。目標を決める途中の値 */
  private cx = 0;
  private cy = 0;
  /** 今回寄る時間（ミリ秒） */
  private stepMs = 0;

  /**
   * カメラの行き過ぎを許す量（画面の大きさに対する割合）。
   *
   * 0 にするとマップの端でカメラが止まり、主人公が画面の隅に寄ってしまう。
   * マップの外は探索前の闇と同じ黒なので、少しはみ出してでも主人公を中央付近に置く。
   * 旧 renderer.ts と同じ値。
   */
  static readonly OVERSCROLL = 0.22;

  /** 寄り切ったとみなす距離（ドット）。これより近ければ目標に揃える */
  static readonly SETTLE = 0.2;

  constructor(viewW = ART_W, viewH = ART_H) {
    this.viewW = viewW;
    this.viewH = viewH;
  }

  get targetX(): number {
    return this.tx;
  }

  get targetY(): number {
    return this.ty;
  }

  /**
   * 画面の中央に置きたい点（ドット）と、マップの大きさ（マス）から目標を決める。
   * マップの外へは OVERSCROLL までしかはみ出さない。
   */
  setTarget(centerX: number, centerY: number, mapTilesW: number, mapTilesH: number): void {
    this.cx = centerX;
    this.cy = centerY;
    this.clampTarget(mapTilesW, mapTilesH);
  }

  /** マス（小数あり）の中心を画面の中央に置く目標にする */
  centerOnTile(tileX: number, tileY: number, mapTilesW: number, mapTilesH: number): void {
    this.cx = tileX * TILE_ART + TILE_ART / 2;
    this.cy = tileY * TILE_ART + TILE_ART / 2;
    this.clampTarget(mapTilesW, mapTilesH);
  }

  /**
   * 見た目の位置（fx, fy はマス座標の小数）を持つ物を中央に置く目標にする。毎刻みはこちら。
   * 物ごと渡すのは、小数を引数で渡すと箱が作られることがあるため
   */
  follow(t: { readonly fx: number; readonly fy: number }, mapTilesW: number, mapTilesH: number): void {
    this.cx = t.fx * TILE_ART + TILE_ART / 2;
    this.cy = t.fy * TILE_ART + TILE_ART / 2;
    this.clampTarget(mapTilesW, mapTilesH);
  }

  /** 目標へ飛ぶ（階に入った直後・ワープ） */
  snap(): void {
    this.x = this.tx;
    this.y = this.ty;
    this.round();
  }

  /** 固定刻み（tickMs）ぶん目標へ寄る。毎刻みはこちら */
  tick(): void {
    this.stepMs = this.tickMs;
    this.approach();
  }

  /** ms ぶん目標へ寄る */
  update(ms: number): void {
    this.stepMs = ms;
    this.approach();
  }

  /** 世界のドット座標 → 画用紙の上の位置（整数のカメラで引く） */
  toViewX(artX: number): number {
    return artX - this.camX;
  }

  toViewY(artY: number): number {
    return artY - this.camY;
  }

  /** cx, cy を中央に置く左上を、マップの外へ出過ぎないように決める。lo > hi（マップが画面より小さい）なら中央 */
  private clampTarget(mapTilesW: number, mapTilesH: number): void {
    const marginX = this.viewW * Camera.OVERSCROLL;
    const marginY = this.viewH * Camera.OVERSCROLL;
    const loX = -marginX;
    const hiX = mapTilesW * TILE_ART - this.viewW + marginX;
    const loY = -marginY;
    const hiY = mapTilesH * TILE_ART - this.viewH + marginY;
    const vx = this.cx - this.viewW / 2;
    const vy = this.cy - this.viewH / 2;
    this.tx = loX > hiX ? (loX + hiX) / 2 : vx < loX ? loX : vx > hiX ? hiX : vx;
    this.ty = loY > hiY ? (loY + hiY) / 2 : vy < loY ? loY : vy > hiY ? hiY : vy;
  }

  private approach(): void {
    const k = this.tau <= 0 ? 1 : 1 - Math.exp(-this.stepMs / this.tau);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    if (Math.abs(this.tx - this.x) < Camera.SETTLE) this.x = this.tx;
    if (Math.abs(this.ty - this.y) < Camera.SETTLE) this.y = this.ty;
    this.round();
  }

  private round(): void {
    this.camX = Math.round(this.x);
    this.camY = Math.round(this.y);
  }
}
