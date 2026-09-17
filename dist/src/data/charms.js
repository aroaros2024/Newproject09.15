/**
 * 護石に乗る印の表と、質ごとの作り方。
 *
 * 護石は「村で 1 つだけ着ける、印を持った恒久の加護」。
 * 倒れても失わないので、装備なら許される強さがそのままだと
 * ダンジョンの関門が最初から消える。ここで印を選び直し、上限を下げてある。
 *
 * 軸は 3 本だけにしてある。どの印か・レベル・空きスロット。
 * 軸を増やすと「何が当たりなのか」をプレイヤーが言葉にできなくなる。
 *
 * この表に書いていない印は護石に出ない。印を足したときに
 * 黙って護石へ流れ込まないよう、既定を「出ない」にしてある。
 */
import { RUNES } from './runes.js';
/** 護石の箱の大きさ。溢れているあいだ護石は出ない（ギタンや他の景品に回る） */
export const CHARM_BOX_LIMIT = 30;
/** 護石に埋められる空きスロットの上限 */
export const CHARM_MAX_SLOTS = 3;
/** 1 つの護石に乗る印の種類数の上限 */
export const CHARM_MAX_RUNES = 3;
/**
 * 護石に乗る印 26 種。
 *
 * 【載せない 6 種】
 *   必中 sure     命中が 0.92 + 1 − 回避。敵の回避はほぼ 0 なので常に 100% になる
 *                 （game/combat.ts の accuracyBonus と rules.ts の hitRate）
 *   成長 growth   plus++ に上限チェックが無い（game/combat.ts の growEquipment）。
 *                 恒久だと無限に育つ
 *   鋼断ち slayMetal  メタル系は「装備を整えた者だけが倒せる高経験値の敵」という関門。
 *                 最初から無効化すると経験値カーブが崩れる
 *   鈍足 blunt    呪い専用（満腹の減りが 2 倍）。景品にする意味が無い
 *   見切り evade  Lv1 でも「最低 1 ダメージ」の床が消える（combat.ts の applyDefenseRunes）。
 *                 実測で のらネズミ の攻撃が被ダメージ 0 になった。
 *                 段階を刻めない、全か無かの印なので護石には置けない
 *   匠 smith      効き目が「装備に埋められる印の数」なので、護石に乗せると
 *                 護石が鍛冶屋の腕を上げていることになる。系統がねじれる
 *
 * 【上限を下げた印】
 *   会心 crit  7→2   プレイヤーの会心は相手の防御力を 0 にする（combat.ts の resolveAttack）。
 *                    Lv7 は CRIT_RATE_CAP ちょうどで、2 回に 1 回 素の攻撃力が通る
 *   連撃 combo 4→1   Lv4 は確率 100% で確定 2 回攻撃になる
 *   火炎・雷光 3→1   Lv3 は攻撃力の 0.9 倍を上乗せする。実測で与ダメージ +108%
 *   吸血 drain 3→1   与ダメージの 3 割を毎回回復。上限が無い
 *   減衰 reduce 5→1  被ダメージの引き算なので、弱い敵ほど効きが大きい
 *   水流 antiFire 3→1  Lv3 は炎ダメージを 9 割消す。属性ひとつを丸ごと無効化する
 *   眠り・混乱 3→1   当てるだけで行動を奪う印は、恒久で持つと関門が消える
 *
 * 【weight の考え方】
 * 地味な印ほど大きい。「会心が出なかった」引きにも別の当たり筋を作るため。
 * 守銭・腹持ち・疾風のような印を高レベルまで出すのはそのため。
 */
export const CHARM_RUNES = {
    // --- 武器の印
    crit: { weight: 2, maxLevel: 2 },
    combo: { weight: 1, maxLevel: 1 },
    flame: { weight: 4, maxLevel: 1 },
    thunder: { weight: 4, maxLevel: 1 },
    crush: { weight: 2, maxLevel: 1 },
    drain: { weight: 2, maxLevel: 1 },
    sleepHit: { weight: 3, maxLevel: 1 },
    confuseHit: { weight: 3, maxLevel: 1 },
    poisonHit: { weight: 4, maxLevel: 2 },
    slayDragon: { weight: 4, maxLevel: 2 },
    slayGhost: { weight: 4, maxLevel: 2 },
    reach: { weight: 3, maxLevel: 1 },
    heavy: { weight: 3, maxLevel: 2 },
    swift: { weight: 5, maxLevel: 1 },
    gitanHit: { weight: 6, maxLevel: 3 },
    // --- 盾の印
    reduce: { weight: 3, maxLevel: 1 },
    reflect: { weight: 2, maxLevel: 1 },
    satiety: { weight: 5, maxLevel: 2 },
    antiRust: { weight: 2, maxLevel: 1 },
    antiSteal: { weight: 2, maxLevel: 1 },
    holy: { weight: 2, maxLevel: 1 },
    antiFire: { weight: 4, maxLevel: 1 },
    antiTrap: { weight: 1, maxLevel: 1 },
    regenRune: { weight: 3, maxLevel: 2 },
    guardStr: { weight: 1, maxLevel: 1 },
    guardLevel: { weight: 2, maxLevel: 1 },
};
/** 護石に乗りうる印の一覧（表の順） */
export const CHARM_RUNE_IDS = Object.keys(CHARM_RUNES);
/** その印が護石に乗るか */
export const charmRuneRule = (id) => CHARM_RUNES[id];
export const CHARM_QUALITY = {
    n: { runes: [1, 1], slots: [0, 1], levelUp: 0.15 },
    r: { runes: [1, 3], slots: [0, 3], levelUp: 0.4 },
};
/** 表の印がすべて実在することを起動時に確かめる */
export function validateCharmRunes() {
    const known = new Set(RUNES.map((r) => r.id));
    const bad = [];
    for (const id of CHARM_RUNE_IDS) {
        if (!known.has(id))
            bad.push(`${id}: そんな印は無い`);
        const rule = CHARM_RUNES[id];
        if (rule.maxLevel < 1)
            bad.push(`${id}: maxLevel が ${rule.maxLevel}`);
        if (rule.weight <= 0)
            bad.push(`${id}: weight が ${rule.weight}`);
        const def = RUNES.find((r) => r.id === id);
        if (def && rule.maxLevel > def.maxLevel) {
            bad.push(`${id}: 護石の上限 ${rule.maxLevel} が装備の上限 ${def.maxLevel} を超えている`);
        }
    }
    return bad;
}
//# sourceMappingURL=charms.js.map