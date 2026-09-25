/**
 * 地形の絵の約束。テーマごとの描き手（terrain/<テーマ>.ts）はこの形で描く。
 *
 * 地形の絵は **階全体を一度に** 描いて焼き込む（1 マス 16 ドット）。毎フレームは描かない。
 * 掘って地形が変わったときは、変わったマスの周り 3×3 だけ描き直す（paintCells）。
 *
 * 【情報を漏らさない決まり】地形の絵は次のものだけで決める。
 *   マスの種類（kind）・掘れない壁（hard）・部屋番号（roomId）・出入口（isDoor）・店（shop）・
 *   階の種（seed）・座標
 * ワナ（trap）・探索済み（explored）・見えている（visible）・暗い部屋（room.dark）・
 * モンスターハウスは **読まない**。読むと、見ていない所の様子が絵に出てしまう。
 * 乱数はゲームの乱数を使わず、座標のハッシュ（hash2）で決める。
 */

import type { ArtTheme } from '../../../core/types.js';
import type { PixBuf } from '../pixbuf.js';
import type { RampName } from '../palette.js';

/** 地形の描き手が読んでよいマスの情報 */
export interface TerrainTile {
  kind: 'wall' | 'floor' | 'water' | 'lava' | 'stairs' | 'pit';
  hard: boolean;
  roomId: number;
  isDoor: boolean;
  shop: boolean;
}

/** 地形の描き手が読んでよい階の情報 */
export interface TerrainMap {
  width: number;
  height: number;
  tiles: readonly TerrainTile[];
  seed: number;
}

/** 飾りの光源（松明・水晶・溶岩だまり）。マス座標と、マスの中の位置（ドット） */
export interface DecorLight {
  /** マス */
  tx: number;
  ty: number;
  /** マスの左上からのドット位置（光の中心） */
  ox: number;
  oy: number;
  kind: 'torch' | 'brazier' | 'crystal' | 'lava' | 'glow' | 'window';
  /** '#rrggbb' */
  color: string;
  /** 半径（マス） */
  radius: number;
  /** 強さ 0〜1 */
  intensity: number;
  /**
   * 暗い部屋では灯らない（壁の燭台は描くが火は無い）。
   * 描き手は部屋が暗いかを知らないので、灯るかどうかは描く側が room.dark を見て決める。
   */
  roomId: number;
}

/** 焼き込んだ地形 */
export interface TerrainArt {
  /** 階全体の絵（width×16 × height×16）。液体のマスは下地まで描く */
  base: PixBuf;
  /** 水・溶岩の揺らぎのコマ（base と同じ大きさ。液体以外は透明）。4 コマ */
  liquid: PixBuf[];
  /** 自分で光る画素（溶岩・水晶・光る苔）。ブルームに使う。光らない所は透明 */
  emissive: PixBuf;
  /** 飾りの光源 */
  lights: DecorLight[];
  /** 松明・水晶など、コマで動く飾り（地形とは別に毎フレーム描く） */
  decor: DecorSprite[];
}

/** 地形の上に置く動く飾り */
export interface DecorSprite {
  tx: number;
  ty: number;
  /** マスの左上からのドット位置（絵の左上） */
  ox: number;
  oy: number;
  /** 飾りの種類（terrain/decor.ts が絵を持つ） */
  kind: 'torch' | 'brazier' | 'crystal' | 'firefly' | 'bubble' | 'flame';
  /** コマの位相をずらす値（座標のハッシュ） */
  phase: number;
  roomId: number;
}

export interface TerrainStyle {
  theme: ArtTheme;
  /** 階全体を描く。out の base / liquid / emissive は呼ぶ側が大きさを合わせて渡す */
  paint(map: TerrainMap, out: TerrainArt): void;
  /**
   * 変わったマスの周りだけ描き直す（掘ったとき）。
   * cells はマスの番号（y*width+x）。結果は paint で全部描き直したときと同じでなければならない。
   */
  paintCells(map: TerrainMap, out: TerrainArt, cells: readonly number[]): void;
}

// ---------------------------------------------------------------------------
// テーマの空気（光・霧・色調・環境の粒）
// ---------------------------------------------------------------------------

/** 環境の粒の出どころ */
export type AmbientRegion =
  /** 画面全体（見えている床の上） */
  | 'view'
  /** 松明・かがり火の近く */
  | 'torch'
  /** 溶岩の上 */
  | 'lava'
  /** 水の上 */
  | 'water'
  /** 光の筋の中 */
  | 'shaft';

export interface AmbientSpec {
  /** 名前（見本帳と計測の表示用） */
  name: string;
  region: AmbientRegion;
  /** 同時に出ている数の上限（画質「高」のとき。中は 0.55 倍、低は 0.25 倍） */
  cap: number;
  /** 1 秒あたりに生まれる数 */
  rate: number;
  /** 寿命（秒）の範囲 */
  life: [number, number];
  /** ドットの粒の色の進み方（palette.ts の RAMP_*）。HD の粒なら null */
  ramp: readonly number[] | null;
  /** HD の粒の色（'#rrggbb'）。ドットの粒なら null */
  glow: string | null;
  /** 大きさ（ドット） */
  size: number;
  /** 流れ場に乗る強さ（1 = 普通の塵、2 以上は強く渦を巻く） */
  flow: number;
  /** 重力（ドット/秒²。負で上へ昇る） */
  gravity: number;
  /** 明滅する（蛍） */
  blink?: boolean;
  /** 光る（ブルームに乗る） */
  emissive?: boolean;
}

/** テーマの空気 */
export interface ThemeLook {
  theme: ArtTheme;
  /** 環境光の色（光の層の地の色） */
  ambient: string;
  /** 見えている明るい部屋の明るさ（0.85〜0.92） */
  litLevel: number;
  /** 見えている暗い部屋・通路の明るさ（読める下限 0.45） */
  darkLevel: number;
  /** 探索済みで今は見えない所の色 */
  memoryColor: string;
  /** 主人公のランタン */
  lantern: { color: string; radius: number };
  /** 奥（画面の上）の霧 */
  fog: { color: string; alpha: number };
  /** 色調：彩度を落とす量・重ねる色味 */
  grade: { desaturate: number; tint: string; tintAlpha: number };
  /** 周辺減光の端の濃さ */
  vignette: number;
  /** 光の筋の本数と色 */
  shafts: { count: number; color: string; alpha: number };
  /** 環境の粒 */
  ambientParticles: readonly AmbientSpec[];
  /** 地形の主な材質（見本帳の背景などに使う） */
  palette: { floor: RampName; wall: RampName; accent: RampName };
}
