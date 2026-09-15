/**
 * ゲーム全体で共有する型定義。
 *
 * ここは「契約」なので、ロジック（関数の実装）は置かない。
 * 定数テーブルは src/data/ 以下、振る舞いは src/game/ 以下に置く。
 *
 * セーブデータに載る型は JSON 化できる形（Map / Set / class を使わない）に
 * 限定している。Map を使いたくなったら Record に落とすこと。
 */

import type { Dir, Point, Rect } from './geom.js';
import type { RngState } from './rng.js';

export type { Dir, Point, Rect, RngState };

// ===========================================================================
// 地形
// ===========================================================================

/** 地形の種類 */
export type TileKind =
  /** 壁。掘れる壁と掘れない壁は `hard` で区別する */
  | 'wall'
  /** 通常の床 */
  | 'floor'
  /** 水路。水棲以外は入れない（アイテムは流される） */
  | 'water'
  /** 溶岩。入るとダメージ。飛行以外は入れない */
  | 'lava'
  /** next floor へ降りる階段 */
  | 'stairs'
  /** 谷底・奈落。落ちると次の階へ強制移動しつつダメージ */
  | 'pit';

/** 1 マスの状態 */
export interface Tile {
  kind: TileKind;
  /** 掘れない壁（外周やボス部屋の壁） */
  hard: boolean;
  /** 所属する部屋 ID。通路は -1 */
  roomId: number;
  /** 部屋の出入口か（通路と部屋の境目） */
  isDoor: boolean;
  /** 一度でもプレイヤーが見たか（マップに残る） */
  explored: boolean;
  /** 今このマスが見えているか（毎ターン再計算） */
  visible: boolean;
  /** 設置されているワナの ID。無ければ null */
  trap: TrapPlacement | null;
  /** 店の床か */
  shop: boolean;
}

export interface TrapPlacement {
  defId: TrapId;
  /** プレイヤーに見つかっているか */
  revealed: boolean;
  /** 一度発動して消える種類のワナ用 */
  used: boolean;
}

/** 部屋 */
export interface Room {
  id: number;
  rect: Rect;
  /** 部屋の出入口（通路へ抜ける位置） */
  doors: Point[];
  /** 明かりの無い部屋（入っても全体が見えない） */
  dark: boolean;
  /** 店になっている部屋 */
  shop: ShopInfo | null;
  /** モンスターハウスの種別。null なら通常の部屋 */
  monsterHouse: MonsterHouseKind | null;
  /** モンスターハウスが既に発動したか */
  houseTriggered: boolean;
}

export type MonsterHouseKind = 'normal' | 'item' | 'trap' | 'ghost' | 'big' | 'gitan';

export interface ShopInfo {
  /** 店主のアクター ID */
  ownerId: number;
  /** 出入口（泥棒を検知する位置） */
  entrance: Point;
  /** 泥棒が発生したか */
  angry: boolean;
}

/** 1 フロアの地形 */
export interface FloorMap {
  width: number;
  height: number;
  /** 長さ width*height。index = y*width + x */
  tiles: Tile[];
  rooms: Room[];
  /** 降り階段の位置 */
  stairs: Point;
  /** このフロアの生成に使ったシード（再現用） */
  seed: number;
  /** 大部屋フロアか */
  bigRoom: boolean;
}

// ===========================================================================
// アイテム
// ===========================================================================

export type ItemKind =
  | 'weapon' | 'shield' | 'herb' | 'scroll' | 'staff'
  | 'pot' | 'bracelet' | 'food' | 'gitan' | 'misc';

/** 印（ルーン）の ID。data/runes.ts で定義する */
export type RuneId = string;

/** 効果 ID。game/itemEffects.ts のハンドラ表のキー */
export type EffectId = string;

export interface ItemDefBase {
  id: string;
  kind: ItemKind;
  /** 識別後に表示される正式名 */
  name: string;
  /** 説明文（道具の「説明」コマンドで表示） */
  desc: string;
  /** 買値。売値は floor(price * SELL_RATE) */
  price: number;
  /** 出現しやすさ。大きいほど出やすい（0 は自然出現しない） */
  weight: number;
  /** スプライト ID */
  sprite: string;
  /** 同じ種類をまとめて持てるか（草・巻物などは false、石やおにぎりは true） */
  stackable?: boolean;
  /** 最初から識別済みとして扱う（おにぎり、ギタンなど） */
  alwaysIdentified?: boolean;
  /** 投げた時の効果。省略時は「当たって小ダメージ」 */
  throwEffect?: EffectId;
  /** 投げた時のダメージ（通常アイテム） */
  throwPower?: number;
}

export interface WeaponDef extends ItemDefBase {
  kind: 'weapon';
  /** 基本攻撃力 */
  atk: number;
  /** 印を埋められる数 */
  slots: number;
  /** 最初から付いている印 */
  innate: RuneId[];
  /** 両手持ち（盾を装備できない） */
  twoHanded?: boolean;
}

export interface ShieldDef extends ItemDefBase {
  kind: 'shield';
  /** 基本防御力 */
  def: number;
  slots: number;
  innate: RuneId[];
}

export interface HerbDef extends ItemDefBase {
  kind: 'herb';
  effect: EffectId;
}

export interface ScrollDef extends ItemDefBase {
  kind: 'scroll';
  effect: EffectId;
}

/** 杖の弾道 */
export type StaffBallistics =
  /** 最初に当たった相手で止まる */
  | 'hit'
  /** 相手を貫通して飛ぶ */
  | 'pierce'
  /** 壁に当たると跳ね返る */
  | 'bounce'
  /** 自分を対象にする（振っても飛ばない） */
  | 'self';

export interface StaffDef extends ItemDefBase {
  kind: 'staff';
  effect: EffectId;
  /** 拾った時の回数の範囲 [min, max] */
  charges: [number, number];
  ballistics: StaffBallistics;
}

export interface PotDef extends ItemDefBase {
  kind: 'pot';
  /** 入れられる数 */
  capacity: number;
  /** 壺に入れた時／使った時の挙動 */
  effect: EffectId;
}

export interface BraceletDef extends ItemDefBase {
  kind: 'bracelet';
  effect: EffectId;
  /** 腕輪が壊れるまでのターン数。0 なら壊れない */
  durability?: number;
}

export interface FoodDef extends ItemDefBase {
  kind: 'food';
  /** 回復する満腹度 */
  nutrition: number;
  /** 満腹度の最大値を上げる量 */
  maxNutritionUp?: number;
  effect?: EffectId;
}

export interface GitanDef extends ItemDefBase {
  kind: 'gitan';
}

export interface MiscDef extends ItemDefBase {
  kind: 'misc';
  effect?: EffectId;
}

export type ItemDef =
  | WeaponDef | ShieldDef | HerbDef | ScrollDef | StaffDef
  | PotDef | BraceletDef | FoodDef | GitanDef | MiscDef;

/** 実際に存在するアイテム 1 個 */
export interface ItemInstance {
  /** 実行中に一意な番号 */
  uid: number;
  defId: string;
  /** まとめて持てるアイテムの個数。それ以外は 1 */
  count: number;
  /** 修正値（+3 など）。武器・盾・腕輪で使う */
  plus: number;
  /** 埋まっている印 */
  runes: RuneId[];
  /** 杖の残り回数 */
  charges: number;
  /** 壺の中身 */
  contents: ItemInstance[];
  /** 呪われている（装備を外せない、壺に入れると失敗する） */
  cursed: boolean;
  /** 修正値が判明しているか */
  plusKnown: boolean;
  /** 店の商品ならその値段（0 なら商品ではない） */
  shopPrice: number;
  /** 印を封じられている（封印の巻物など） */
  sealed: boolean;
}

/** 床に落ちているアイテム */
export interface FloorItem {
  item: ItemInstance;
  pos: Point;
}

/** 未識別アイテムの管理 */
export interface IdentifyState {
  /** defId → 仮の名前（「あやしい草」など）。識別前の表示に使う */
  alias: Record<string, string>;
  /** 識別済みの defId */
  known: Record<string, boolean>;
  /** プレイヤーが手でつけた名前（「まちがえた」など） */
  nicknames: Record<string, string>;
}

// ===========================================================================
// 印（ルーン）
// ===========================================================================

export interface RuneDef {
  id: RuneId;
  /** 一覧に出る 1 文字の記号 */
  symbol: string;
  name: string;
  desc: string;
  /** 武器に付くか盾に付くか */
  target: 'weapon' | 'shield' | 'both';
  /** 同じ印を重ねて強化できるか（できる場合は印数を 1 つしか使わない） */
  stackable: boolean;
  /** stackable な印の上限レベル */
  maxLevel: number;
  /** 合成の壺で他の印に上書きされる（下位互換の印） */
  supersededBy?: RuneId;
}

// ===========================================================================
// 状態異常
// ===========================================================================

export type StatusId =
  /** 混乱: 5/8 の確率で移動・攻撃の方向がランダムになる */
  | 'confused'
  /** めつぶし: 隣接 8 マスしか見えない。命中率 -0.25 */
  | 'blind'
  /** 睡眠: 行動不能。ダメージを受けると即解除 */
  | 'asleep'
  /** バクスイ: 行動不能。ダメージでも解除されない */
  | 'deepAsleep'
  /** かなしばり: 移動と通常攻撃だけ不可。道具は使える */
  | 'bound'
  /** まひ: 完全に行動不能 */
  | 'paralyzed'
  /** 気絶: 完全に行動不能。受けるダメージ 1.5 倍 */
  | 'fainted'
  /** 毒: 付与時にちから -1。HP 自然回復が止まる */
  | 'poisoned'
  /** 猛毒: 付与時にちから -2。毎ターン HP -2（HP1 で止まる） */
  | 'deadlyPoisoned'
  /** 火傷: 毎ターン HP -3。水に入ると解除 */
  | 'burning'
  /** 濡れ: 炎ダメージ半減、雷ダメージ 2 倍。火傷を打ち消す */
  | 'wet'
  /** 鈍足: 2 ターンに 1 回しか行動できない */
  | 'slow'
  /** 倍速: 1 ターンに 2 回行動できる */
  | 'quick'
  /** 透明: 敵から見えない。攻撃すると解除 */
  | 'invisible'
  /** 封印: 印・腕輪・特技が無効になる */
  | 'sealed'
  /** 消化不良: 満腹度の減りが 2 倍 */
  | 'hungryFast'
  /** ちから増加: power の分だけ攻撃力計算上のちからが増える */
  | 'strUp'
  /** トラばさみ: 移動不可。毎ターン 1/3 で自力脱出 */
  | 'trapped'
  /** 浮遊: ワナを踏まず、水路・溶岩の上を移動できる */
  | 'levitate'
  /** おびえ: プレイヤーから逃げる */
  | 'terrified';

/** 状態異常 1 つ分。turns が 0 以下になったら解除 */
export interface StatusEffect {
  id: StatusId;
  /** 残りターン。-1 は「解除されるまで永続」 */
  turns: number;
  /** 効果の強さ（ちから増加の量、毒の段階など）。使わないなら 0 */
  power: number;
}

/** 完全に行動できなくなる状態 */
export const INCAPACITATING: readonly StatusId[] = [
  'asleep', 'deepAsleep', 'paralyzed', 'fainted',
];

// ===========================================================================
// ワナ
// ===========================================================================

export type TrapId = string;

export interface TrapDef {
  id: TrapId;
  name: string;
  desc: string;
  /** 踏んだ時に発動する確率(%) */
  rate: number;
  /** 発動したら消えるか */
  oneShot: boolean;
  /** モンスターが踏んでも発動するか */
  affectsMonsters: boolean;
  effect: EffectId;
  sprite: string;
  /** 出現しやすさ */
  weight: number;
}

// ===========================================================================
// モンスター
// ===========================================================================

/** どこを移動できるか */
export type MoveType =
  | 'ground' // 通常
  | 'water' // 水路も歩ける
  | 'lava' // 溶岩も歩ける
  | 'fly' // 水路・溶岩の上を飛べる。ワナを踏まない
  | 'phase'; // 壁の中を移動できる

/** 行動速度 */
export type SpeedType =
  | 'slow' // 2 ターンに 1 回
  | 'normal'
  | 'double' // 1 ターンに 2 回移動・攻撃
  | 'doubleAttack'; // 移動は 1 回、攻撃だけ 2 回

/** AI の基本方針 */
export type AiKind =
  | 'chase' // 見つけたら追いかける（標準）
  | 'wander' // ランダムに歩く。隣接したら攻撃
  | 'flee' // 常にプレイヤーから逃げる
  | 'coward' // HP が減ると逃げる
  | 'ranged' // 射線が通る位置を取って遠距離攻撃
  | 'ambush' // 部屋の中では動かず、隣に来たら攻撃
  | 'mimic' // アイテムに化けて待ち伏せる
  | 'thief' // アイテム／ギタンを盗んで階段へ逃げる
  | 'guard' // 決まった場所を動かない（店主・番犬）
  | 'boss'; // ボス専用（スクリプト行動）

/** 特技 ID。game/monsterSkills.ts のハンドラ表のキー */
export type SkillId = string;

export interface MonsterDef {
  id: string;
  name: string;
  /** 系統。成長の杖などで 1 段階上へ変化する */
  family: string;
  /** 系統内での段階（0 から） */
  tier: number;
  /** 同系統の次の段階の ID。無ければ null */
  evolveTo: string | null;
  level: number;
  hp: number;
  atk: number;
  def: number;
  /** 倒した時の経験値 */
  exp: number;
  moveType: MoveType;
  speed: SpeedType;
  ai: AiKind;
  /** 使う特技 */
  skills: SkillId[];
  /** 特技を使う確率(%) */
  skillRate: number;
  /** 倒した時に落とすアイテム */
  drop: { itemId: string; rate: number } | null;
  /** 持っているギタン（倒すと落とす） */
  gitan: number;
  sprite: string;
  /** 部屋の外（通路）からでもプレイヤーを察知する */
  keenSense?: boolean;
  /** 最初から寝ている確率(%) */
  sleepRate?: number;
  /** ボス。倒すとフロアクリア扱い */
  isBoss?: boolean;
  /** 仲間にできるか */
  recruitable?: boolean;
  /** 回避率 0.00〜0.50。既定 0 */
  evade?: number;
  /** 会心（痛恨の一撃）率。既定 1/32 */
  critRate?: number;
  /** メタル系: 最終ダメージから 20 を引く */
  metal?: boolean;
  /** 図鑑の説明 */
  desc: string;
}

// ===========================================================================
// アクター（プレイヤー・モンスター・仲間）
// ===========================================================================

export type ActorKind = 'player' | 'monster' | 'ally' | 'shopkeeper';

export interface ActorBase {
  id: number;
  kind: ActorKind;
  pos: Point;
  dir: Dir;
  hp: number;
  maxHp: number;
  /** 掛かっている状態異常 */
  statuses: StatusEffect[];
  /** 生きているか（死亡演出の間だけ false で残る） */
  alive: boolean;
  /** このターン既に行動した回数（ターンエンジンが使う） */
  actedThisTurn: number;
  /**
   * HP 自然回復のアキュムレータ（1/1000 単位）。
   * 浮動小数を貯め込むと誤差が出るので整数で持つ。
   */
  regenAcc: number;
}

export interface PlayerActor extends ActorBase {
  kind: 'player';
  name: string;
  level: number;
  exp: number;
  /** ちから（現在値） */
  str: number;
  /** ちからの最大値 */
  maxStr: number;
  /** 満腹度（1/10 単位。1000 = 満腹度 100.0） */
  foodX10: number;
  /** 満腹度の最大値（1/10 単位。上限 1500） */
  maxFoodX10: number;
  gitan: number;
  /** 持ち物 */
  inventory: ItemInstance[];
  /** 装備中の武器の uid。無ければ null */
  weaponUid: number | null;
  shieldUid: number | null;
  braceletUid: number | null;
  /** 累計歩数（風の判定などに使う） */
  steps: number;
}

export interface MonsterActor extends ActorBase {
  kind: 'monster' | 'ally' | 'shopkeeper';
  defId: string;
  /** 成長でレベルが上がる敵用 */
  level: number;
  atk: number;
  def: number;
  exp: number;
  /** 眠っている（起きるまで行動しない） */
  asleep: boolean;
  /** 盗んだアイテム／連れているもの */
  heldItems: ItemInstance[];
  /** 盗んだギタン */
  heldGitan: number;
  /** 化けている時の見せかけのアイテム */
  disguise: ItemInstance | null;
  /** 仲間の作戦 */
  tactic: AllyTactic;
  /** ボスの行動フェーズ */
  bossPhase: number;
  /** 追跡のために最後にプレイヤーを見た位置 */
  lastSeen: Point | null;
  /** 店主が怒っているか */
  angry: boolean;
  /** 生成時に指定された固有名（ボス用）。無ければ def の名前 */
  nameOverride: string | null;
}

export type Actor = PlayerActor | MonsterActor;

/** 仲間への指示（作戦メニュー） */
export type AllyTactic = 'follow' | 'free' | 'stay' | 'avoid';

// ===========================================================================
// ダンジョン定義
// ===========================================================================

/** 階層帯ごとの出現テーブル */
export interface SpawnEntry {
  /** 対象 ID（モンスター/アイテム/ワナ） */
  id: string;
  /** この階層帯での重み */
  weight: number;
  /** 出現する最小階（含む） */
  from: number;
  /** 出現する最大階（含む） */
  to: number;
}

export interface DungeonTheme {
  /** 壁の色 */
  wall: string;
  wallTop: string;
  /** 床の色 */
  floor: string;
  floorAlt: string;
  /** 通路の色 */
  corridor: string;
  /** 水／溶岩の色 */
  liquid: string;
  liquidAlt: string;
  /** 暗がりの色 */
  gloom: string;
  /** ミニマップの基調色 */
  accent: string;
}

export interface DungeonDef {
  id: string;
  name: string;
  /** 1 行の紹介文 */
  subtitle: string;
  /** 村のダンジョン選択で出る説明 */
  desc: string;
  /** 最深部（この階の階段を降りるとクリア） */
  depth: number;
  /** アイテムを持ち込めるか */
  allowBring: boolean;
  /** 入る時にレベルを 1 に戻すか */
  resetLevel: boolean;
  /** 仲間を連れて入れるか */
  allowAlly: boolean;
  /** クリアしないと解放されない前提ダンジョン */
  requires: string | null;
  theme: DungeonTheme;
  bgm: string;
  /** フロア生成のパラメータ */
  gen: FloorGenParams;
  monsters: SpawnEntry[];
  items: SpawnEntry[];
  traps: SpawnEntry[];
  /** ボスが出る階と、そのモンスター ID */
  bosses: { depth: number; monsterId: string }[];
  /** クリア時に得られるもの */
  reward: { gitan?: number; itemId?: string; message: string };
  /** モンスターハウスの発生率(%)。階層に応じて増える */
  monsterHouseRate: number;
  /** 大部屋フロアの発生率(%) */
  bigRoomRate: number;
  /** 不定の風が吹くまでのターン数（0 なら吹かない） */
  windTurns: number;
}

export interface FloorGenParams {
  width: number;
  height: number;
  /** 区画分割の数の範囲 */
  gridCols: [number, number];
  gridRows: [number, number];
  /** 部屋を置かない区画の割合(%) */
  emptyCellRate: number;
  /** 部屋の最小サイズ */
  minRoomW: number;
  minRoomH: number;
  /** 明かりの無い部屋の割合(%) */
  darkRoomRate: number;
  /** 水路を作る割合(%) */
  waterRate: number;
  /** 水路の種類（水 or 溶岩） */
  liquid: 'water' | 'lava' | 'none';
  /** 1 フロアあたりのアイテム数 */
  items: [number, number];
  /** 1 フロアあたりのワナ数 */
  traps: [number, number];
  /** 初期配置のモンスター数 */
  monsters: [number, number];
  /** 何ターンに 1 体湧くか（0 なら湧かない） */
  spawnInterval: number;
  /** フロア上のモンスター数の上限 */
  maxMonsters: number;
  /** 店が出る確率(%) */
  shopRate: number;
}

// ===========================================================================
// 行動
// ===========================================================================

export type Action =
  | { type: 'move'; dir: Dir; dash?: boolean }
  | { type: 'attack'; dir: Dir }
  | { type: 'turn'; dir: Dir }
  | { type: 'wait' }
  | { type: 'pickup' }
  | { type: 'place'; uid: number }
  | { type: 'use'; uid: number }
  | { type: 'equip'; uid: number }
  | { type: 'unequip'; uid: number }
  | { type: 'throw'; uid: number; dir: Dir }
  | { type: 'putIn'; potUid: number; uid: number }
  | { type: 'takeOut'; potUid: number; index: number }
  | { type: 'stairs' }
  | { type: 'buy'; uid: number }
  | { type: 'sell'; uid: number }
  | { type: 'setTactic'; tactic: AllyTactic }
  /** 何もしない（ターンを消費しない）。メニューを閉じた時など */
  | { type: 'none' };

/** 行動の結果。ターンを消費したかどうかがターンエンジンの分岐になる */
export interface ActionResult {
  /** ターンを消費したか */
  tookTurn: boolean;
  /** 失敗した理由（メッセージ表示用） */
  reason?: string;
}

// ===========================================================================
// 演出イベント
// ===========================================================================

/** ログメッセージの種類（色分けに使う） */
export type LogStyle =
  | 'normal' | 'good' | 'bad' | 'critical' | 'item' | 'system' | 'warning';

/** ロジックが積み、描画側がアニメーションで消化するイベント */
export type GameEvent =
  | { t: 'message'; text: string; style?: LogStyle }
  | { t: 'move'; actorId: number; from: Point; to: Point }
  | { t: 'bump'; actorId: number; dir: Dir }
  | { t: 'attack'; actorId: number; targetId: number; critical: boolean }
  | { t: 'miss'; actorId: number; targetId: number }
  | { t: 'damage'; actorId: number; amount: number; kind?: 'physical' | 'fire' | 'magic' }
  | { t: 'heal'; actorId: number; amount: number }
  | { t: 'defeat'; actorId: number }
  | { t: 'levelUp'; actorId: number }
  | { t: 'status'; actorId: number; status: StatusId; applied: boolean }
  | { t: 'projectile'; from: Point; to: Point; sprite: string; kind: 'item' | 'magic' | 'gitan' }
  | { t: 'zap'; from: Point; to: Point; color: string }
  | { t: 'itemGet'; uid: number }
  | { t: 'itemDrop'; uid: number; pos: Point }
  | { t: 'explosion'; pos: Point; radius: number }
  | { t: 'warp'; actorId: number; from: Point; to: Point }
  | { t: 'trap'; pos: Point; trapId: TrapId }
  | { t: 'floorChange'; depth: number }
  | { t: 'monsterHouse'; kind: MonsterHouseKind }
  | { t: 'bossAppear'; actorId: number }
  | { t: 'sfx'; name: string }
  | { t: 'bgm'; track: string | null }
  | { t: 'flash'; color: string; ms: number }
  | { t: 'shake'; power: number; ms: number }
  | { t: 'pause'; ms: number }
  | { t: 'gameOver'; reason: string }
  | { t: 'dungeonClear' };

// ===========================================================================
// 進行状態
// ===========================================================================

/** 冒険 1 回分の状態（中断セーブの中身） */
export interface RunState {
  dungeonId: string;
  /** 現在の階（1 始まり） */
  depth: number;
  /** このフロアに来てからの経過ターン */
  floorTurn: number;
  /** ダンジョンに入ってからの総ターン */
  totalTurn: number;
  map: FloorMap;
  player: PlayerActor;
  monsters: MonsterActor[];
  floorItems: FloorItem[];
  allies: MonsterActor[];
  /** 未識別の対応表 */
  identify: IdentifyState;
  /** 乱数の状態 */
  rng: RngState;
  /** ダンジョン全体のシード */
  seed: number;
  /** 次に配る uid */
  nextUid: number;
  nextActorId: number;
  /** 風が吹くまでの残りターン（0 以下で強制移動） */
  windLeft: number;
  /** すでに倒したボス */
  defeatedBosses: string[];
  /** 統計（結果画面用） */
  stats: RunStats;
}

export interface RunStats {
  kills: number;
  maxDepth: number;
  itemsFound: number;
  gitanEarned: number;
  damageTaken: number;
  damageDealt: number;
  startedAt: number;
}

/** 村（永続データ） */
export interface TownState {
  playerName: string;
  /** 倉庫 */
  storage: ItemInstance[];
  /** 預けているギタン */
  bankGitan: number;
  /** 手持ちギタン（村での買い物用） */
  gitan: number;
  /** クリア済みのダンジョン ID */
  cleared: string[];
  /** 解放済みのダンジョン ID */
  unlocked: string[];
  /** ダンジョンごとの最高到達階 */
  bestDepth: Record<string, number>;
  /** 識別済みの知識は村に持ち帰らない（毎回シャッフル）が、図鑑には残る */
  seenItems: Record<string, boolean>;
  seenMonsters: Record<string, boolean>;
  /** 冒険の記録 */
  history: AdventureRecord[];
  /** 累計 */
  totalRuns: number;
  nextUid: number;
}

export interface AdventureRecord {
  dungeonId: string;
  dungeonName: string;
  depth: number;
  level: number;
  turns: number;
  gitan: number;
  /** 死因。クリアした場合は null */
  cause: string | null;
  cleared: boolean;
  at: number;
}

/** 設定 */
export interface Settings {
  /** メッセージ送りの速さ 0=速い 1=普通 2=ゆっくり */
  messageSpeed: number;
  /** アニメーション速度 0=瞬間 1=速い 2=普通 */
  animSpeed: number;
  /** 斜め移動を常に許可するか */
  diagonalFree: boolean;
  /** ダッシュ時に曲がり角で止まるか */
  dashStopAtCorner: boolean;
  /** 未識別アイテムを拾った時に確認を出す */
  confirmUnknown: boolean;
  /** 階段を降りる時に確認を出す */
  confirmStairs: boolean;
  masterVolume: number;
  sfxVolume: number;
  bgmVolume: number;
  muted: boolean;
  /** 色覚に配慮した配色を使う */
  colorAssist: boolean;
  /** 画面のゆれを無効にする */
  reduceMotion: boolean;
}

/** 画面 */
export type ScreenId = 'title' | 'town' | 'dungeon' | 'result';

// ===========================================================================
// 保存形式
// ===========================================================================

export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;
  town: TownState;
  settings: Settings;
  /** 中断データ。無ければ null */
  run: RunState | null;
  savedAt: number;
}
