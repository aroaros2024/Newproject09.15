/**
 * 描画エンジン（compositor.ts）と、それに絵を渡す場面（ダンジョン・村・タイトル）の約束。
 *
 * 1 フレームの流れ（計画 4 章）：
 *   場面は「画用紙」（428×240 ドット）の 3 枚に描くだけでよい。
 *     A  地形（paintTerrain）  … 被写界深度でぼかすのはこれだけ
 *     A2 床の物（paintGround） … 階段・ワナ・道具。光の乗算より下なので、見えないマスでは暗くなる
 *     B  キャラ（paintActors） … 光の乗算より上。1 体ずつ足元の明るさで色を付けて描く（ActorLighter）
 *   ほかに光源の一覧（collectLights）、光る物だけの層（paintEmissive → ブルーム）、
 *   ドットでない HD の層（paintHD → 粒子・光線・数字）を渡す。
 *   光・ぼかし・ブルーム・霧・色調・周辺減光・暗転は描画エンジンが受け持つ。
 *
 * 【情報を漏らさない決まり】
 *   - 未探索マスは描画エンジンが地形の紙の上で真っ黒に塗る（ぼかしより前）。光も通さない
 *   - 見えていないマスの敵は paintActors / paintEmissive / paintHD で一切描かない（場面の責任）
 *   - 溶岩・水晶の発光は、マスの状態で自動的に消える（未探索 0・探索済み 0.35）
 *
 * 座標
 *   世界のドット：地図の左上が (0, 0)。マス (tx, ty) は x = 16tx 〜 16tx+16、足元は (16tx+8, 16ty+13)。
 *   paintTerrain / paintGround / paintActors / paintEmissive の紙は、描画エンジンが
 *   カメラの分だけずらしてから渡すので、場面は **世界のドット座標のまま** 描けばよい（整数で描く）。
 *   paintHD の紙は論理座標（1280×720）。世界のドット wx は (wx - camX) × 3 - 2 に当たる（worldToLogicalX）。
 */

import type { ThemeLook } from '../art/terrain/types.js';
import type { LightList } from '../gfx-core/lightModel.js';
import type { QualityPreset } from './quality.js';
import type { Ctx2D } from './canvas.js';
import { ART_SCALE, CROP_X, CROP_Y } from './view.js';

export type { Ctx2D } from './canvas.js';

/**
 * 焼いたコマ 1 枚の置き場所（sheets.ts が返す）。
 * 返す側が 1 つの入れ物を使い回すので、次に frame() を呼ぶまでに使い切ること（取っておかない）。
 */
export interface FrameRef {
  /** 絵の元（焼いた頁のキャンバス） */
  src: CanvasImageSource;
  /** 頁の中の位置と大きさ（ドット） */
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** 足元の点（コマの左上からのドット）。ここをマスの足元に合わせる */
  ax: number;
  ay: number;
}

/**
 * キャラを「足元の明るさで色を付けて」B に描く道具。paintActors に渡される。
 * 光の紙は乗算で画面全体に掛かるが、キャラはその上に描くので、ここで 1 体ずつ同じ明るさを付ける
 * （キャラまで光の紙で塗ると、2 マスの高さの絵の上半分が壁の暗さに引きずられて読めなくなる）。
 */
export interface ActorLighter {
  /**
   * コマを描く。(footX, footY) は足元の世界のドット（整数）。
   * alpha は透明度（消える途中・透明の状態）。lit = false なら色を付けずにそのまま（白い閃きのコマ）
   */
  drawFrame(f: Readonly<FrameRef>, footX: number, footY: number, alpha?: number, lit?: boolean): void;
  /**
   * 任意の絵を描く（コマ以外。影や旧来の絵など）。
   * (dx, dy) は絵の左上の世界のドット、(footX, footY) は明るさを測る点
   */
  drawImage(src: CanvasImageSource, sx: number, sy: number, w: number, h: number,
    dx: number, dy: number, footX: number, footY: number, alpha?: number, lit?: boolean): void;
  /** 点 (wx, wy) の明るさ（0〜1、16 段）を out[0..2] に書く */
  sample(wx: number, wy: number, out: Float32Array | number[]): void;
}

/**
 * 1 フレームの情報。描画エンジンが 1 つを使い回して場面の関数に渡す（取っておかない）。
 */
export interface FrameInfo {
  /** requestAnimationFrame の時刻（ミリ秒） */
  now: number;
  /** 秒（揺らぎ・コマ送りの位相に使う） */
  time: number;
  /** 今の画質の段 */
  quality: QualityPreset;
  /** このフレームのカメラ（世界のドット。整数） */
  camX: number;
  camY: number;
  /** 画用紙の大きさ（ドット） */
  viewW: number;
  viewH: number;
}

/**
 * 描画エンジンに絵を渡す場面。ダンジョンの画面（統合のときに書く）や検証の場面が実装する。
 * 描画エンジンは毎フレーム、上から順に呼ぶ：
 *   1. tileVersion が変わっていれば writeTileStates
 *   2. collectLights → paintTerrain → paintGround → paintActors → paintEmissive → paintHD
 * どの関数も毎フレーム呼ばれるので、中で配列・関数・文字列を作らないこと（割り当てゼロ）。
 */
export interface WorldScene {
  /** 画用紙の左上に来る世界の位置（ドット）。整数にしておく（小数は切り捨てる）。ドットが揺れないため */
  readonly camX: number;
  readonly camY: number;
  /**
   * テーマの空気（環境光・記憶の色・霧・光の筋・色調・周辺減光）。
   * 描画エンジンは参照が変わった時だけ色を読み直す。中身を書き換えたら新しい物を渡すこと
   */
  readonly look: ThemeLook;
  /** 地図の大きさ（マス） */
  readonly mapW: number;
  readonly mapH: number;
  /**
   * マスの状態が変わるたびに増やす番号（1 手ごと・階が変わった時・掘った時）。
   * 描画エンジンはこれが変わったフレームだけ writeTileStates を呼び、1 マス 1 画素の紙を作り直す
   */
  readonly tileVersion: number;
  /**
   * マスの状態を out（y * mapW + x、長さ mapW × mapH）に書く（lightModel.ts の TILE_*）：
   *   0 未探索 / 1 探索済みで今は見えない / 2 見えている通路・暗い部屋 / 3 見えている明るい部屋
   * 視界の規則（fov.ts）の visible / explored / room.dark をそのまま写すだけでよい
   */
  writeTileStates(out: Uint8Array): void;
  /**
   * 光源を out に足す（out は空にしてから渡す。上限 16、あふれたら弱い光から捨てる）。
   * 座標と半径は世界のドット。主人公のランタン（look.lantern）もここで足す。
   * 見えていない敵の光は足さない。揺らぐ光（松明）は seed に flickerSeed(tx, ty) を渡す
   */
  collectLights(out: LightList, f: Readonly<FrameInfo>): void;
  /**
   * A：地形（焼いた地形の絵・水と溶岩のコマ・松明などの飾り）。紙は真っ黒に消してから渡す。
   * 描いたあとで描画エンジンが未探索マスを真っ黒に塗る
   */
  paintTerrain(a: Ctx2D, f: Readonly<FrameInfo>): void;
  /** A2：階段・ワナ・道具（探索済みのマスだけ）。紙は透明に消してから渡す */
  paintGround(a2: Ctx2D, f: Readonly<FrameInfo>): void;
  /**
   * B：キャラ（足元の y の順に）。影は自分で描く。絵は lighter で描くと足元の明るさで色が付く。
   * 見えていないマスの敵は描かない。紙は透明に消してから渡す
   */
  paintActors(b: Ctx2D, lighter: ActorLighter, f: Readonly<FrameInfo>): void;
  /**
   * 光る物だけ（溶岩の光る画素・松明の炎・光る敵の目・魔法）。ブルームの元になる。
   * 紙は黒く塗ってから、世界のドット座標で描けるよう縮めて渡す（紙は 320×180、滑らかに縮む）。
   * 見えているキャラは足元の順に sheets.ts の FX_OCCLUDER（光る所以外は黒）で描くこと。
   * 手前のキャラの体が奥の光を隠す（描かないと、奥の光がキャラを透けてにじむ）。
   * ブルームを使わない画質では呼ばれない
   */
  paintEmissive(e: Ctx2D, f: Readonly<FrameInfo>): void;
  /** HD の層（粒子・光線・ダメージの数字）。論理座標（1280×720）、画面の揺れ込みで渡す */
  paintHD(g: Ctx2D, f: Readonly<FrameInfo>): void;
  /** 画面の揺れ（論理 px）。無ければ 0 */
  readonly shakeX?: number;
  readonly shakeY?: number;
  /** 暗転（0 = 無し、1 = 真っ黒）。階の移動・倒れた時 */
  readonly fade?: number;
  /** 画面全体の閃き（0〜1）と色（'#rrggbb'。場面の側で作って使い回す） */
  readonly flashAlpha?: number;
  readonly flashColor?: string;
}

/** 世界のドット x → 論理座標 x（paintHD 用） */
export const worldToLogicalX = (wx: number, camX: number): number => (wx - camX) * ART_SCALE - CROP_X;
/** 世界のドット y → 論理座標 y（paintHD 用） */
export const worldToLogicalY = (wy: number, camY: number): number => (wy - camY) * ART_SCALE - CROP_Y;
