/**
 * 壺・腕輪・食料・その他（石や矢）・ギタンの定義。
 */

import type {
  BraceletDef, FoodDef, GitanDef, MiscDef, PotDef,
} from '../../core/types.js';

const pot = (
  id: string, name: string, effect: string, capacity: number,
  price: number, weight: number, desc: string,
): PotDef => ({
  id, kind: 'pot', name, desc, price, weight, sprite: 'pot',
  capacity, effect, throwPower: 4,
});

const br = (
  id: string, name: string, effect: string, price: number, weight: number, desc: string,
): BraceletDef => ({
  id, kind: 'bracelet', name, desc, price, weight, sprite: 'bracelet',
  effect, throwPower: 3,
});

const food = (
  id: string, name: string, nutrition: number, price: number, weight: number,
  desc: string, maxUp = 0, effect?: string,
): FoodDef => ({
  id, kind: 'food', name, desc, price, weight, sprite: 'food',
  nutrition, maxNutritionUp: maxUp, effect, alwaysIdentified: true, throwPower: 3,
});

export const POTS: readonly PotDef[] = [
  pot('storagePot', '保存の壺', 'storage', 4, 1600, 100, 'アイテムを入れておける。中身は持ち物の数に入らない。'),
  pot('synthesisPot', '合成の壺', 'synthesis', 3, 6000, 18, '武器や盾を入れると、満杯になった時に 1 つに合成される。'),
  pot('identifyPot', '識別の壺', 'identifyPot', 3, 2400, 34, '入れたアイテムが識別される。'),
  pot('changePot', '変化の壺', 'changePot', 3, 1800, 34, '入れたアイテムが別のアイテムに変わる。'),
  pot('backpackPot', '背中の壺', 'backpack', 5, 3000, 20, '中身を持ち物として直接使える大きな壺。'),
  pot('holePot', '底抜けの壺', 'holePot', 3, 300, 26, '入れたアイテムは下の階へ落ちてしまう。'),
  pot('waterPot', '水がめ', 'waterPot', 3, 900, 34, '水を汲める。かけると火を消し、敵を濡らす。'),
  pot('evadePot', 'やりすごしの壺', 'evadePot', 1, 2000, 26, '中に隠れて 10 ターンやり過ごせる。'),
  pot('unbreakablePot', '割れない壺', 'unbreakable', 4, 3200, 14, '投げても割れない頑丈な壺。'),
  pot('sealPot', '手封じの壺', 'sealPot', 1, 400, 20, '手が抜けなくなる。他の道具が使えない。'),
  pot('cashPot', '換金の壺', 'cashPot', 3, 1400, 26, '入れたアイテムがギタンに変わる。'),
  pot('blessPot', '祝福の壺', 'blessPot', 3, 3600, 12, '入れたアイテムが祝福される。'),
  pot('strengthenPot', '強化の壺', 'strengthenPot', 3, 4000, 12, '入れた装備の修正値が上がる。'),
  pot('purifyPot', 'おはらいの壺', 'purifyPot', 4, 1800, 22, '入れたアイテムの呪いが解ける。'),
  pot('weakenPot', '弱化の壺', 'weakenPot', 3, 200, 16, '入れた装備の修正値が下がる。'),
  pot('monsterPot', '魔物の壺', 'monsterPot', 1, 200, 14, '開けるとモンスターが飛び出す。'),
  pot('warehousePot', '倉庫の壺', 'warehousePot', 4, 5000, 8, '中身が村の倉庫に送られる。'),
];

export const BRACELETS: readonly BraceletDef[] = [
  br('strBracelet', 'ちからの腕輪', 'strBonus', 3000, 60, 'ちからが 3 上がる。'),
  br('guardBracelet', '皮甲の腕輪', 'defBonus', 2800, 55, '防御力が 3 上がる。'),
  br('regenBracelet', '回復の腕輪', 'regen', 3200, 40, 'HP の回復が速くなるが、腹が減りやすい。'),
  br('noHungerBracelet', 'ハラヘラズの腕輪', 'noHunger', 5000, 22, '満腹度が減らなくなる。'),
  br('trapBracelet', 'ワナ師の腕輪', 'trapMaster', 3400, 30, 'ワナを踏んでも作動せず、部屋のワナが見える。'),
  br('throwBracelet', '遠投の腕輪', 'farThrow', 2400, 34, '投げた物が敵を貫通して飛ぶ。'),
  br('sightBracelet', '透視の腕輪', 'seeMonsters', 4000, 26, 'フロアの敵の位置が分かる。'),
  br('detectBracelet', 'よくみえの腕輪', 'seeTraps', 2600, 30, 'フロアのワナとアイテムの位置が分かる。'),
  br('identifyBracelet', '識別の腕輪', 'autoIdentify', 4600, 18, '拾ったアイテムが自動で識別される。'),
  br('calmBracelet', '混乱よけの腕輪', 'wardConfuse', 1800, 34, '混乱しなくなる。'),
  br('awakeBracelet', '眠らずの腕輪', 'wardSleep', 1800, 34, '眠らなくなる。'),
  br('antidoteBracelet', '毒よけの腕輪', 'wardPoison', 1800, 34, '毒を受けなくなる。'),
  br('wardBracelet', '呪いよけの腕輪', 'wardCurse', 2200, 26, '持ち物が呪われなくなる。'),
  br('thiefWardBracelet', '盗賊よけの腕輪', 'wardSteal', 2400, 26, 'アイテムとギタンを盗まれなくなる。'),
  br('critBracelet', '会心の腕輪', 'critUp', 3600, 20, '会心の一撃が出やすくなる。'),
  br('sureBracelet', '必中の腕輪', 'sureHit', 3200, 22, '攻撃が必ず当たる。'),
  br('waterBracelet', '水グモの腕輪', 'waterWalk', 3000, 22, '水の上を歩けるようになる。'),
  br('floatBracelet', '浮遊の腕輪', 'levitate', 3800, 18, '宙に浮いて、ワナも溶岩も越えられる。'),
  br('blastWardBracelet', '爆発よけの腕輪', 'wardBlast', 2600, 20, '爆発のダメージを受けなくなる。'),
  br('healthBracelet', '竜脈の腕輪', 'maxHpUp', 4200, 16, '最大 HP が 30 増える。'),
  br('reviveBracelet', '復活の腕輪', 'revive', 6000, 8, '力尽きた時、一度だけ砕けて身代わりになる。'),
  // --- 呪い専用（拾った時点で必ず呪われている） ---
  br('painBracelet', '痛恨の腕輪', 'painCurse', 100, 16, '敵の痛恨の一撃を受けやすくなる。'),
  br('starveBracelet', 'ハラペコの腕輪', 'starveCurse', 100, 16, '満腹度が一気に減っていく。'),
  br('crookedBracelet', 'まがりの腕輪', 'crookedCurse', 100, 16, 'まっすぐ歩けなくなる。'),
  br('rustBracelet', '錆びの腕輪', 'rustCurse', 100, 16, '装備がだんだん錆びていく。'),
];

/** 呪い専用の腕輪。拾った時点で必ず呪われている */
export const ALWAYS_CURSED_BRACELETS: readonly string[] = [
  'painBracelet', 'starveBracelet', 'crookedBracelet', 'rustBracelet',
];

export const FOODS: readonly FoodDef[] = [
  food('riceBall', 'おにぎり', 500, 200, 100, '満腹度が 50 回復する。'),
  food('bigRiceBall', '大きなおにぎり', 1000, 400, 55, '満腹度が 100 回復する。満腹の時は最大値が 5 増える。', 50),
  food('hugeRiceBall', '巨大なおにぎり', 1500, 800, 20, '満腹になり、最大値が 10 増える。', 100),
  food('grilledRiceBall', '焼きおにぎり', 700, 320, 40, '満腹度が 70 回復し、火傷が治る。', 0, 'cureBurn'),
  food('herbRiceBall', '山菜おにぎり', 600, 600, 22, '満腹度が 60 回復し、持ち物が 1 つ識別される。', 0, 'identifyOne'),
  food('rottenRiceBall', 'くさったおにぎり', 300, 40, 30, '満腹度は回復するが、体を壊す。', 0, 'rotten'),
  food('driedRiceBall', 'しなびたおにぎり', 400, 120, 45, '少し乾いたおにぎり。'),
  food('driedMeat', '干し肉', 350, 180, 50, 'ちからが 1 回復する。', 0, 'strUp'),
  food('nut', '木の実', 200, 100, 55, '小さな木の実。少しだけ腹の足しになる。'),
  food('bentou', '風の村の弁当', 1200, 900, 0, '村で作られる弁当。満腹になり、最大値が 2 増える。', 20),
];

export const MISC_ITEMS: readonly MiscDef[] = [
  {
    id: 'stone', kind: 'misc', name: '石', desc: '投げて当てる。ダメージは小さい。',
    price: 30, weight: 80, sprite: 'stone', stackable: true, alwaysIdentified: true,
    throwPower: 5,
  },
  {
    id: 'bombStone', kind: 'misc', name: '爆弾石', desc: '当たると爆発して周囲を巻き込む。',
    price: 400, weight: 24, sprite: 'stone', stackable: true, alwaysIdentified: true,
    throwPower: 10, throwEffect: 'explodeOnHit',
  },
  {
    id: 'shockStone', kind: 'misc', name: 'しびれ石', desc: '当たった敵をかなしばりにする。',
    price: 300, weight: 26, sprite: 'stone', stackable: true, alwaysIdentified: true,
    throwPower: 3, throwEffect: 'bindOnHit',
  },
  {
    id: 'smokeBall', kind: 'misc', name: 'けむり玉', desc: '割ると周囲の敵の目をくらませる。',
    price: 350, weight: 26, sprite: 'stone', stackable: true, alwaysIdentified: true,
    throwPower: 2, throwEffect: 'blindOnHit',
  },
  {
    id: 'woodArrow', kind: 'misc', name: '木の矢', desc: '直線上を飛んで敵を射抜く。',
    price: 30, weight: 70, sprite: 'arrow', stackable: true, alwaysIdentified: true,
    throwPower: 5, throwEffect: 'arrowFlight',
  },
  {
    id: 'ironArrow', kind: 'misc', name: '鉄の矢', desc: '木の矢より重く、よく効く。',
    price: 60, weight: 45, sprite: 'arrow', stackable: true, alwaysIdentified: true,
    throwPower: 8, throwEffect: 'arrowFlight',
  },
  {
    id: 'silverArrow', kind: 'misc', name: '銀の矢', desc: '敵を貫通して飛ぶ矢。',
    price: 120, weight: 22, sprite: 'arrow', stackable: true, alwaysIdentified: true,
    throwPower: 12, throwEffect: 'arrowPierce',
  },
];

export const GITAN: GitanDef = {
  id: 'gitan', kind: 'gitan', name: 'ギタン', desc: 'この世界のお金。投げると当たった敵にダメージを与える。',
  price: 1, weight: 0, sprite: 'gitan', alwaysIdentified: true, stackable: true,
};
