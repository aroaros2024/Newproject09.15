/**
 * 見た目の層（src/ui/anim/）と描画（src/ui/gfx/・src/ui/world/）の境目の約束。
 *
 * anim/ は「いつ・どこで・何が起きるか」だけを決め、絵は描かない。
 * 描く側は VfxSink を実装し、anim/ が決めた瞬間に呼ばれたものを粒子・光・文字にする。
 * 引数は値（数・文字列・使い回しの小さな物）だけにして、関数やクラスは渡さない。
 * こうしておくと anim/ は DOM 無しで node のテストから丸ごと検査できる。
 *
 * 座標の決まり
 *   - tileX / tileY はマス座標。整数がマスの左上（ゲームの Point と同じ）。
 *     見た目の途中の位置を渡すことがあるので小数もある。マスの中心は +0.5
 *   - artX / artY は世界の画用紙のドット座標（1 マス = 16 ドット）。カメラは引いていない
 *   - 時間はミリ秒。アニメ速度の倍率は anim/ の側で掛け終えてから渡す
 */

import type { ActorKind, StatusId } from '../../core/types.js';
import type { AnimId } from '../art/rig.js';

// ---------------------------------------------------------------------------
// 演出の種類
// ---------------------------------------------------------------------------

/**
 * 粒の吹き出しの種類。描く側はこの名前から粒子の組（数・色の階調・速さ・流れへの乗り方）を引く。
 * ここは名前だけ。中身（どう散るか）は描く側の表が持つ。
 */
export const VFX_PRESET_IDS = [
  /** 物理の打撃：白 → 橙 → 暗の火花 */
  'hitPhysical',
  /** 炎の打撃：火の粉と光 */
  'hitFire',
  /** 魔法の打撃：紫の粒 */
  'hitMagic',
  /** 会心：斬撃の弧と白い閃き */
  'crit',
  /** 回復：緑の粒が昇る */
  'heal',
  /** 撃破：絵の粒が散る（opts.tag に種の id） */
  'death',
  /** レベルアップ：金の光の柱と輪 */
  'levelUp',
  /** 爆発：火の玉・火の粉・渦を巻く煙（opts.power に半径） */
  'explosion',
  /** ワープ：渦の粒 */
  'warp',
  /** 土煙（ダッシュ・湧き・消える・落とし穴） */
  'dust',
  /** 水しぶき・波紋 */
  'splash',
  /** ワナのガス（opts.color にガスの色） */
  'trapGas',
  /** 状態異常が掛かった瞬間の色の粒（opts.tag に状態の id） */
  'statusApplied',
  /** 道具を拾った */
  'itemGet',
  /** 壁を掘った：土と石のかけら */
  'dig',
] as const;

export type VfxPresetId = typeof VFX_PRESET_IDS[number];

/** 浮かぶ数字・文字の種類。色と大きさは描く側が決める */
export const POPUP_KINDS = [
  /** 敵へのダメージ（白） */
  'damage',
  /** 自分へのダメージ（赤） */
  'damageToPlayer',
  /** 会心（橙で大きく） */
  'crit',
  /** 回復（緑） */
  'heal',
  /** 空振り（明朝・灰色の MISS） */
  'miss',
  /** 経験値 */
  'exp',
  /** レベルアップ */
  'levelUp',
  /** その他の短い知らせ */
  'info',
] as const;

export type PopupKind = typeof POPUP_KINDS[number];

/** ビームの属性。描く側は粒の階調（火・氷・雷・水・魔法・毒・光）を選ぶのに使う */
export type VfxElement = 'physical' | 'fire' | 'ice' | 'thunder' | 'water' | 'magic' | 'poison' | 'light';

/** 飛び道具の種類（GameEvent の projectile と同じ） */
export type ProjectileKind = 'item' | 'magic' | 'gitan';

/** 階移動の暗転。floorOut で今の画面を写し取って暗くし、floorIn で次の階を明ける */
export type TransitionKind = 'floorOut' | 'floorIn';

/** 告知の帯の種類（色と飾りを選ぶ） */
export type BannerKind = 'floor' | 'house' | 'boss' | 'gameOver' | 'clear' | 'info';

/** マス座標。sink へ渡す物は使い回すので、持っておくなら写すこと */
export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * 吹き出しの補助の値。sink へ渡す物は使い回すので、持っておくなら写すこと。
 * 使わない項目は既定値（dir8 = -1・power = 1・color = ''・tag = ''）のまま渡る。
 */
export interface BurstOpts {
  /** 向き（8 方向。0 = 北から時計回り。-1 は向き無し）。火花・斬撃の弧が飛ぶ向き */
  dir8: number;
  /** 強さの倍率（1 が基準。会心 1.6。爆発は半径のマス数） */
  power: number;
  /** 色（'#rrggbb'）。空文字なら種類の既定の色 */
  color: string;
  /** 種類の中の細かい区別（状態異常の id・撃破した種の id・ワナの id など） */
  tag: string;
}

// ---------------------------------------------------------------------------
// 描く側が実装するもの
// ---------------------------------------------------------------------------

/**
 * 演出の受け口。描く側（合成・粒子・音）が実装し、VisualWorld に渡す。
 *
 * 呼ばれるのは「その瞬間」だけ。攻撃の当たり・飛び道具の着弾・ビームの終端に
 * 合わせた時刻は anim/timeline.ts が決め終えている。描く側は待たずにすぐ出せばよい。
 * 見えないマスの吹き出し・数字・光は anim/ の側で止めてあるので、ここで判定し直さなくてよい。
 */
export interface VfxSink {
  /** 粒の吹き出し。tileX/tileY はマス座標（小数あり、整数がマスの左上） */
  burst(preset: VfxPresetId, tileX: number, tileY: number, opts: Readonly<BurstOpts>): void;
  /**
   * ビーム（杖・息・魔法）。ms かけて from から to へ光が走り、走り切った瞬間に
   * 当たりの演出（数字・火花）が来る。ms は anim/ の側で決めた長さなので守ること
   */
  beam(from: TilePoint, to: TilePoint, color: string, element: VfxElement, ms: number): void;
  /**
   * 飛び道具。ms かけて from から to へ飛ぶ。着いた瞬間に当たりの演出が来るので、
   * 飛ぶ時間は ms に合わせること。spriteKey は道具の絵の鍵（無ければ null）
   */
  projectile(from: TilePoint, to: TilePoint, spriteKey: string | null, kind: ProjectileKind, ms: number): void;
  /** 一瞬の光（回復・爆発・魔法）。radius はマス数、intensity は 0〜1 */
  light(tileX: number, tileY: number, color: string, radius: number, intensity: number, durationMs: number): void;
  /** 画面の揺れ。px は画面（1280×720）の画素 */
  shake(px: number, ms: number): void;
  /** 画面全体のフラッシュ */
  flash(color: string, alpha: number, ms: number): void;
  /** 画面全体を止める（会心の手応え）。anim/ の側もこの間は進まない */
  hitstop(ms: number): void;
  /** 浮かぶ数字・文字。tileX/tileY は当たった者の見た目の位置（マス座標） */
  popup(text: string, kind: PopupKind, tileX: number, tileY: number): void;
  /** 告知の帯（階の札・モンスターハウス・ボス・倒れた・踏破） */
  banner(text: string, sub?: string, kind?: BannerKind): void;
  /** 階移動の暗転 */
  transition(kind: TransitionKind): void;
  /** 効果音。当たりの音は当たりの瞬間に来る */
  sfx(id: string): void;
}

// ---------------------------------------------------------------------------
// 描く側が読むもの（キャラ 1 体）
// ---------------------------------------------------------------------------

/** キャラの見た目の状態。死亡（death）は光ってから 4 段で崩れる */
export type AnimState = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'sleep' | 'use' | 'death';

/**
 * キャラ 1 体ぶんの「描くための値」。VisualWorld が毎刻み（60Hz）作り直し、
 * 描く側はこれを読むだけ。物は使い回しなので、持っておかずにその場で読むこと。
 *
 * 位置は 60Hz で滑らかに動く。姿勢（frame）は 8〜12fps でしか変わらない。
 */
export interface ActorDrawable {
  /** アクターの id（ゲームと同じ） */
  readonly id: number;
  readonly kind: ActorKind;
  /** 種の id。主人公は 'player'、敵・仲間・店主は defId。リグ（art/rig.ts）と旧絵の鍵 */
  readonly species: string;
  /**
   * 化けているミミックの見せかけの道具（defId）。null でなければ、
   * キャラの層ではなく床の道具と同じ経路・同じ揺れ・同じ影で描くこと（正体を漏らさない）
   */
  readonly disguise: string | null;
  /** ボス（大きな段で描く） */
  readonly boss: boolean;
  /** 描く動き（リグの AnimId）。死亡中は 'hurt' */
  readonly anim: AnimId;
  /** 向き（8 方向。0 = 北から時計回り） */
  readonly dir8: number;
  /** 動きの中のコマ番号 */
  readonly frame: number;
  /** 足元の位置（世界の画用紙のドット、整数）。マスの (8, 13) が足元 */
  readonly artX: number;
  readonly artY: number;
  /** 足元から浮かせる量（ドット）。影は artY に残す（飛ぶ敵・跳ねる） */
  readonly lift: number;
  /** 水に沈める深さ（ドット）。0 なら沈めない */
  readonly submerge: number;
  /** 不透明度 0〜1（透明・湧き・消える） */
  readonly alpha: number;
  /** 白く光る量 0〜1（被弾・撃破の直前） */
  readonly flash: number;
  /** 倒れて崩れている最中 */
  readonly dying: boolean;
  /** 崩れの段。0 = まだ形がある（光っている）、1〜4 = 崩れていく段 */
  readonly dissolve: number;
  /** ワープで縦に縮んだ量 0〜1（1 で見えない） */
  readonly warp: number;
  /** 灰色に落とす量 0〜1（主人公が倒れたとき） */
  readonly grey: number;
  /** 掛かっている状態異常（STATUS_BIT の論理和）。常時の飾りに使う */
  readonly statusMask: number;
  /** 眠っている */
  readonly asleep: boolean;
  /** 論理上のマス */
  readonly tileX: number;
  readonly tileY: number;
  /** 見た目のマス座標（小数） */
  readonly fx: number;
  readonly fy: number;
}

// ---------------------------------------------------------------------------
// 状態異常のビット
// ---------------------------------------------------------------------------

/** 状態異常 → ビット。ActorDrawable.statusMask を配列を作らずに持つため */
export const STATUS_BIT: Readonly<Record<StatusId, number>> = {
  confused: 1 << 0,
  blind: 1 << 1,
  asleep: 1 << 2,
  deepAsleep: 1 << 3,
  bound: 1 << 4,
  paralyzed: 1 << 5,
  fainted: 1 << 6,
  poisoned: 1 << 7,
  deadlyPoisoned: 1 << 8,
  burning: 1 << 9,
  wet: 1 << 10,
  slow: 1 << 11,
  quick: 1 << 12,
  invisible: 1 << 13,
  sealed: 1 << 14,
  hungryFast: 1 << 15,
  strUp: 1 << 16,
  trapped: 1 << 17,
  levitate: 1 << 18,
  terrified: 1 << 19,
  invincible: 1 << 20,
};

/** statusMask にその状態異常が入っているか */
export const hasStatusBit = (mask: number, id: StatusId): boolean => (mask & STATUS_BIT[id]) !== 0;
