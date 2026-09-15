/**
 * ゲーム全体で共有する型定義。
 *
 * ここは「契約」なので、ロジック（関数の実装）は置かない。
 * 定数テーブルは src/data/ 以下、振る舞いは src/game/ 以下に置く。
 *
 * セーブデータに載る型は JSON 化できる形（Map / Set / class を使わない）に
 * 限定している。Map を使いたくなったら Record に落とすこと。
 */
/** 完全に行動できなくなる状態 */
export const INCAPACITATING = [
    'asleep', 'deepAsleep', 'paralyzed', 'fainted',
];
// ===========================================================================
// 保存形式
// ===========================================================================
export const SAVE_VERSION = 1;
//# sourceMappingURL=types.js.map