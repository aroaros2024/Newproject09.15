/**
 * 印（ルーン）の定義。
 *
 * 武器・盾に埋め込まれる効果。合成の壺で移し替えられる。
 * 効果の実体は game/runeEffects.ts が id を見て処理する。
 */

import type { RuneDef } from '../core/types.js';

export const RUNES: readonly RuneDef[] = [
  // ------------------------------------------------------------- 武器の印
  {
    id: 'crit', symbol: '会', name: '会心の印', target: 'weapon', stackable: true, maxLevel: 7,
    desc: '会心の一撃が出やすくなる。Lv1 ごとに確率が 1/16 ずつ上がる。',
  },
  {
    id: 'sure', symbol: '必', name: '必中の印', target: 'weapon', stackable: false, maxLevel: 1,
    desc: '攻撃が必ず当たる。ただし会心の一撃は出なくなる。',
  },
  {
    id: 'combo', symbol: '連', name: '連撃の印', target: 'weapon', stackable: true, maxLevel: 4,
    desc: 'Lv×25% の確率でもう一度攻撃する。追撃の威力は 3/4。',
  },
  {
    id: 'flame', symbol: '炎', name: '火炎の印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: '攻撃力の Lv×30% を炎ダメージとして上乗せする。水中の敵には倍。',
  },
  {
    id: 'thunder', symbol: '雷', name: '雷光の印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: '攻撃力の Lv×30% を雷ダメージとして上乗せする。濡れた敵には倍。',
  },
  {
    id: 'crush', symbol: '砕', name: '砕きの印', target: 'weapon', stackable: false, maxLevel: 1,
    desc: '相手の防御力を半分として計算する。',
  },
  {
    id: 'drain', symbol: '吸', name: '吸血の印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: '与えたダメージの Lv×10% だけ HP を回復する。',
  },
  {
    id: 'sleepHit', symbol: '眠', name: '眠りの印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: 'Lv×8% の確率で相手を眠らせる。',
  },
  {
    id: 'confuseHit', symbol: '乱', name: '混乱の印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: 'Lv×8% の確率で相手を混乱させる。',
  },
  {
    id: 'poisonHit', symbol: '毒', name: '毒針の印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: 'Lv×10% の確率で相手に毒を与える。',
  },
  {
    id: 'slayDragon', symbol: '竜', name: '竜殺しの印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: 'ドラゴン系に与えるダメージが Lv×50% 増える。',
  },
  {
    id: 'slayGhost', symbol: '霊', name: '退魔の印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: 'ゴースト系に与えるダメージが Lv×50% 増える。',
  },
  {
    id: 'slayMetal', symbol: '鋼', name: '鋼断ちの印', target: 'weapon', stackable: false, maxLevel: 1,
    desc: 'メタル系の硬さを無視して攻撃できる。',
  },
  {
    id: 'reach', symbol: '遠', name: '遠投の印', target: 'weapon', stackable: false, maxLevel: 1,
    desc: '投げた物が敵を貫通して飛ぶようになる。',
  },
  {
    id: 'heavy', symbol: '重', name: '剛腕の印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: '攻撃力が Lv×2 上がるが、満腹度が余分に減る。「疾」とは同時に付かない。',
  },
  {
    id: 'swift', symbol: '疾', name: '疾風の印', target: 'weapon', stackable: false, maxLevel: 1,
    desc: '満腹度の減りが半分になる。「重」とは同時に付かない。',
  },
  {
    id: 'gitanHit', symbol: '金', name: '守銭の印', target: 'weapon', stackable: true, maxLevel: 3,
    desc: '敵を倒した時に Lv×20 ギタンを余分に得る。',
  },
  {
    id: 'smith', symbol: '匠', name: '匠の印', target: 'both', stackable: true, maxLevel: 3,
    desc: '印を埋められる数が Lv だけ増える。',
  },
  {
    id: 'growth', symbol: '成', name: '成長の印', target: 'both', stackable: false, maxLevel: 1,
    desc: '敵を 20 体倒すごとに修正値が +1 される。',
  },

  // ------------------------------------------------------------- 盾の印
  {
    id: 'reduce', symbol: '減', name: '減衰の印', target: 'shield', stackable: true, maxLevel: 5,
    desc: '受けるダメージが Lv×2 減る。',
  },
  {
    id: 'evade', symbol: '避', name: '見切りの印', target: 'shield', stackable: true, maxLevel: 4,
    desc: 'Lv×12% の確率で攻撃を完全に避ける。',
  },
  {
    id: 'reflect', symbol: '反', name: '返しの印', target: 'shield', stackable: true, maxLevel: 3,
    desc: '受けたダメージの Lv×25%（上限 90%）を相手に返す。',
  },
  {
    id: 'satiety', symbol: '満', name: '腹持ちの印', target: 'shield', stackable: true, maxLevel: 3,
    desc: '満腹度の減りが 1/(1+Lv) になる。「鈍」とは同時に付かない。',
  },
  {
    id: 'antiRust', symbol: '錆', name: '錆よけの印', target: 'shield', stackable: false, maxLevel: 1,
    desc: '装備が錆びなくなる。',
  },
  {
    id: 'antiSteal', symbol: '盗', name: '護りの印', target: 'shield', stackable: false, maxLevel: 1,
    desc: 'アイテムとギタンを盗まれなくなる。',
  },
  {
    id: 'holy', symbol: '聖', name: '聖なる印', target: 'shield', stackable: true, maxLevel: 3,
    desc: '状態異常の持続ターンが Lv に応じて短くなる。',
  },
  {
    id: 'antiFire', symbol: '水', name: '水流の印', target: 'shield', stackable: true, maxLevel: 3,
    desc: '炎のダメージを Lv×30% 軽減する。',
  },
  {
    id: 'antiTrap', symbol: '罠', name: 'ワナ師の印', target: 'shield', stackable: false, maxLevel: 1,
    desc: 'ワナを踏んでも発動しなくなる。',
  },
  {
    id: 'regenRune', symbol: '癒', name: '治癒の印', target: 'shield', stackable: true, maxLevel: 3,
    desc: 'HP の自然回復が Lv×50% 速くなる。',
  },
  {
    id: 'guardStr', symbol: '力', name: '不屈の印', target: 'shield', stackable: false, maxLevel: 1,
    desc: 'ちからを下げられなくなる。',
  },
  {
    id: 'guardLevel', symbol: '護', name: '不動の印', target: 'shield', stackable: false, maxLevel: 1,
    desc: 'レベルを下げられなくなる。',
  },
  {
    id: 'blunt', symbol: '鈍', name: '鈍足の印', target: 'shield', stackable: false, maxLevel: 1,
    desc: '呪われた盾に付く。満腹度の減りが 2 倍になる。「満」とは同時に付かない。',
  },
];

/** 同時に付けられない印の組。どちらかを合成すると他方が消える */
export const EXCLUSIVE_RUNE_PAIRS: readonly [string, string][] = [
  ['heavy', 'swift'],
  ['satiety', 'blunt'],
  ['sure', 'crit'],
];

/** 印 1 つが装備の値段に与える影響 */
export const RUNE_PRICE = 300;
