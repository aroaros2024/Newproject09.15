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
import { ART_SCALE, CROP_X, CROP_Y } from './view.js';
/** 世界のドット x → 論理座標 x（paintHD 用） */
export const worldToLogicalX = (wx, camX) => (wx - camX) * ART_SCALE - CROP_X;
/** 世界のドット y → 論理座標 y（paintHD 用） */
export const worldToLogicalY = (wy, camY) => (wy - camY) * ART_SCALE - CROP_Y;
//# sourceMappingURL=types.js.map