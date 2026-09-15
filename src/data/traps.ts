/**
 * ワナの定義。効果の実体は game/trapEffects.ts が id を見て処理する。
 *
 * rate は「見つかっているワナを承知で踏んだ時」の発動率(%)。
 * 未発見のワナは常に 100% 発動する。
 */

import type { TrapDef } from '../core/types.js';

export const TRAPS: readonly TrapDef[] = [
  {
    id: 'arrow', name: '矢のワナ', sprite: 'trapArrow', rate: 50, oneShot: false,
    affectsMonsters: true, effect: 'trapArrow', weight: 100,
    desc: '壁から矢が飛んでくる。',
  },
  {
    id: 'poisonArrow', name: '毒矢のワナ', sprite: 'trapPoison', rate: 50, oneShot: false,
    affectsMonsters: true, effect: 'trapPoisonArrow', weight: 70,
    desc: '毒の矢が飛んでくる。ちからが下がる。',
  },
  {
    id: 'spike', name: '落とし穴', sprite: 'trapPit', rate: 100, oneShot: true,
    affectsMonsters: true, effect: 'trapPitfall', weight: 80,
    desc: '次の階へ落ちる。',
  },
  {
    id: 'sleepGas', name: '眠りガス', sprite: 'trapGas', rate: 60, oneShot: true,
    affectsMonsters: true, effect: 'trapSleep', weight: 70,
    desc: '眠ってしまう。',
  },
  {
    id: 'confuseGas', name: '混乱のワナ', sprite: 'trapGas', rate: 60, oneShot: true,
    affectsMonsters: true, effect: 'trapConfuse', weight: 70,
    desc: '混乱してしまう。',
  },
  {
    id: 'blindGas', name: 'めつぶしのワナ', sprite: 'trapGas', rate: 60, oneShot: true,
    affectsMonsters: true, effect: 'trapBlind', weight: 55,
    desc: '目の前が見えなくなる。',
  },
  {
    id: 'bearTrap', name: 'トラばさみ', sprite: 'trapBear', rate: 80, oneShot: false,
    affectsMonsters: true, effect: 'trapBear', weight: 65,
    desc: '足を挟まれて動けなくなる。',
  },
  {
    id: 'rustTrap', name: '錆びのワナ', sprite: 'trapRust', rate: 70, oneShot: true,
    affectsMonsters: false, effect: 'trapRust', weight: 55,
    desc: '武器が錆びて弱くなる。',
  },
  {
    id: 'rotTrap', name: 'デロデロのワナ', sprite: 'trapRot', rate: 70, oneShot: true,
    affectsMonsters: false, effect: 'trapRot', weight: 45,
    desc: '食料が腐ってしまう。',
  },
  {
    id: 'alarm', name: '警報のワナ', sprite: 'trapAlarm', rate: 100, oneShot: true,
    affectsMonsters: false, effect: 'trapAlarm', weight: 50,
    desc: '大きな音でフロア中の敵が起きる。',
  },
  {
    id: 'summon', name: '召喚のワナ', sprite: 'trapSummon', rate: 100, oneShot: true,
    affectsMonsters: false, effect: 'trapSummon', weight: 45,
    desc: '周囲にモンスターが現れる。',
  },
  {
    id: 'warp', name: 'ワープのワナ', sprite: 'trapWarp', rate: 90, oneShot: false,
    affectsMonsters: true, effect: 'trapWarp', weight: 60,
    desc: 'フロアのどこかへ飛ばされる。',
  },
  {
    id: 'spin', name: '回転板', sprite: 'trapSpin', rate: 100, oneShot: false,
    affectsMonsters: true, effect: 'trapSpin', weight: 40,
    desc: '向きがぐるぐる変わり、持ち物がばらまかれる。',
  },
  {
    id: 'mine', name: '地雷', sprite: 'trapMine', rate: 100, oneShot: true,
    affectsMonsters: true, effect: 'trapMine', weight: 35,
    desc: '爆発して HP が半分になり、周囲の敵を倒す。',
  },
  {
    id: 'bigMine', name: '大型地雷', sprite: 'trapMine', rate: 100, oneShot: true,
    affectsMonsters: true, effect: 'trapBigMine', weight: 15,
    desc: '広範囲に爆発する。持ち物も焼ける。',
  },
  {
    id: 'slowTrap', name: '鈍足のワナ', sprite: 'trapSlow', rate: 70, oneShot: true,
    affectsMonsters: true, effect: 'trapSlow', weight: 40,
    desc: '動きが鈍くなる。',
  },
  {
    id: 'weakenTrap', name: '石像のワナ', sprite: 'trapStatue', rate: 80, oneShot: false,
    affectsMonsters: false, effect: 'trapWeaken', weight: 35,
    desc: '石像がちからを下げるビームを撃ってくる。',
  },
  {
    id: 'curseTrap', name: '呪いのワナ', sprite: 'trapCurse', rate: 70, oneShot: true,
    affectsMonsters: false, effect: 'trapCurse', weight: 35,
    desc: '持ち物の 1 つが呪われる。',
  },
  {
    id: 'hungerTrap', name: '空腹のワナ', sprite: 'trapHunger', rate: 80, oneShot: true,
    affectsMonsters: false, effect: 'trapHunger', weight: 35,
    desc: '急激に空腹になる。',
  },
  {
    id: 'sealTrap', name: '封印のワナ', sprite: 'trapSeal', rate: 70, oneShot: true,
    affectsMonsters: true, effect: 'trapSeal', weight: 30,
    desc: '印と腕輪の効果が消える。',
  },
  {
    id: 'monsterHouseTrap', name: 'モンスターハウスのワナ', sprite: 'trapHouse', rate: 100,
    oneShot: true, affectsMonsters: false, effect: 'trapMonsterHouse', weight: 12,
    desc: '部屋中がモンスターで埋め尽くされる。',
  },
  {
    id: 'itemLossTrap', name: '転落のワナ', sprite: 'trapDrop', rate: 90, oneShot: true,
    affectsMonsters: false, effect: 'trapItemLoss', weight: 25,
    desc: '持ち物をいくつか落としてしまう。',
  },
  {
    id: 'lavaTrap', name: '噴火のワナ', sprite: 'trapLava', rate: 90, oneShot: false,
    affectsMonsters: true, effect: 'trapLava', weight: 30,
    desc: '足元から火が噴き出す。',
  },
  {
    id: 'waterTrap', name: '水没のワナ', sprite: 'trapWater', rate: 90, oneShot: false,
    affectsMonsters: true, effect: 'trapWater', weight: 30,
    desc: '水を浴びて濡れてしまう。巻物が使えなくなる。',
  },
];
