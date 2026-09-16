/**
 * 草・巻物・杖の定義。
 * effect は game/itemEffects.ts のハンドラ表のキー。
 */

import type { HerbDef, ScrollDef, StaffDef, StaffBallistics } from '../../core/types.js';

const h = (
  id: string, name: string, effect: string, price: number, weight: number, desc: string,
): HerbDef => ({
  id, kind: 'herb', name, desc, price, weight, sprite: 'herb', effect, throwPower: 3,
});

const sc = (
  id: string, name: string, effect: string, price: number, weight: number, desc: string,
): ScrollDef => ({
  id, kind: 'scroll', name, desc, price, weight, sprite: 'scroll', effect, throwPower: 3,
});

const st = (
  id: string, name: string, effect: string, price: number, weight: number,
  ballistics: StaffBallistics, desc: string, charges: [number, number] = [3, 6],
): StaffDef => ({
  id, kind: 'staff', name, desc, price, weight, sprite: 'staff',
  effect, charges, ballistics, throwPower: 3,
});

export const HERBS: readonly HerbDef[] = [
  h('healHerb', '薬草', 'heal25', 150, 100, 'HP が 25 回復する。最大の時は最大 HP が 1 増える。'),
  h('greatHerb', '上薬草', 'heal100', 500, 55, 'HP が 100 回復する。最大の時は最大 HP が 3 増える。'),
  h('lifeHerb', '命の草', 'lifeUp', 2000, 14, '最大 HP が 5 増え、HP が全快する。'),
  h('strHerb', 'ちからの草', 'strUp', 1500, 18, 'ちからが 1 回復する。最大の時は最大値が 1 増える。'),
  h('antidoteHerb', '毒消し草', 'curePoison', 200, 60, '毒を消し、下がったちからを回復する。'),
  h('eyeHerb', 'めぐすり草', 'cureBlind', 300, 45, 'めつぶしが治り、フロアのワナが見えるようになる。'),
  h('calmHerb', '混乱なおしの草', 'cureConfuse', 250, 45, '混乱と眠りが治る。'),
  h('reviveHerb', '復活の草', 'revive', 5000, 8, '持っていると、力尽きた時に一度だけ生き返る。'),
  h('sleepHerb', '睡眠草', 'sleep', 200, 45, '眠ってしまう。投げて使うもの。'),
  h('confuseHerb', '混乱草', 'confuse', 200, 45, '混乱してしまう。投げて使うもの。'),
  h('poisonHerb', '毒草', 'poison', 120, 45, 'ちからが下がる。投げて使うもの。'),
  h('paralyzeHerb', 'しびれ草', 'paralyze', 300, 35, 'かなしばりにかかる。投げて使うもの。'),
  h('leapHerb', '高とび草', 'warp', 400, 35, 'フロアのどこかへ飛ばされる。'),
  h('invincibleHerb', '無敵草', 'invincible', 4000, 6, '30 ターンの間、ダメージを受けなくなる。'),
  h('flameHerb', '火炎草', 'breatheFire', 600, 26, '前方に炎を吐く。'),
  h('frostHerb', '雪華草', 'freeze', 600, 26, '前方の敵をかなしばりにする。'),
  h('blessHerb', 'しあわせ草', 'levelUp', 6000, 6, 'レベルが 1 上がる。'),
  h('curseHerb', 'ふしあわせ草', 'levelDown', 500, 16, 'レベルが 1 下がる。'),
  h('swiftHerb', '疾風草', 'haste', 1200, 16, '30 ターンの間、倍速になる。'),
  h('slowHerb', '鈍足草', 'slowSelf', 300, 24, '30 ターンの間、動きが鈍くなる。'),
  h('wakeHerb', '気付け草', 'cureAll', 800, 22, '眠り・気絶・まひ・かなしばりが治る。'),
  h('mistHerb', '霧隠れの草', 'invisible', 1500, 12, '20 ターンの間、姿が見えなくなる。'),
];

export const SCROLLS: readonly ScrollDef[] = [
  sc('identifyScroll', '識別の巻物', 'identify', 500, 100, '持ち物を 1 つ選んで識別する。'),
  sc('greatIdentify', '大識別の巻物', 'identifyAll', 2500, 16, '持ち物すべてを識別する。'),
  sc('lightScroll', 'あかりの巻物', 'light', 600, 55, 'フロア全体が見えるようになる。'),
  sc('mapScroll', '地図の巻物', 'mapFloor', 400, 45, 'フロアの地形とワナが分かる。'),
  sc('blessWeapon', '天の恵みの巻物', 'blessWeapon', 3000, 22, '武器の修正値が 3 上がる。'),
  sc('blessShield', '地の恵みの巻物', 'blessShield', 3000, 22, '盾の修正値が 3 上がる。'),
  sc('temperScroll', '鍛えの巻物', 'temper', 4000, 12, '装備の修正値が 1 上がり、呪いが解ける。'),
  sc('sleepScroll', 'バクスイの巻物', 'sleepRoom', 800, 34, '部屋にいる敵をぐっすり眠らせる。'),
  sc('vacuumScroll', '真空斬りの巻物', 'vacuum', 900, 30, '周囲の敵にまとめてダメージを与える。'),
  sc('sanctuaryScroll', '聖域の巻物', 'sanctuary', 2000, 16, '床に置くと、敵が乗れなくなる。'),
  sc('cloneScroll', '分身の巻物', 'clone', 2600, 10, '自分の分身を 2 体作る。'),
  sc('warpScroll', '転送の巻物', 'warp', 500, 34, 'フロアのどこかへ飛ばされる。'),
  sc('purgeScroll', '壊滅の巻物', 'purge', 5000, 6, 'フロアの敵をすべて消し去る。'),
  sc('shelterScroll', '一時しのぎの巻物', 'shelter', 800, 22, '部屋の敵を階段の上へ飛ばす。'),
  sc('confuseScroll', '混乱の巻物', 'confuseRoom', 700, 30, '部屋にいる敵を混乱させる。'),
  sc('bindScroll', 'かなしばりの巻物', 'bindRoom', 900, 26, '部屋にいる敵をかなしばりにする。'),
  sc('blankScroll', '白紙の巻物', 'blank', 1200, 16, '好きな巻物として使える。'),
  sc('synthesisScroll', '合成の巻物', 'synthesize', 3500, 8, 'その場で 2 つの装備を合成する。'),
  sc('prayerScroll', '祈りの巻物', 'recharge', 1500, 18, '杖の残り回数が 3 増える。'),
  sc('uncurseScroll', '解呪の巻物', 'uncurse', 800, 30, '持ち物の呪いをすべて解く。'),
  sc('sealScroll', '封印の巻物', 'sealItem', 600, 22, '選んだ装備の印を封じる。'),
  sc('thiefScroll', '盗賊の巻物', 'escapeShop', 2000, 8, '店から無事に脱出できる。'),
  sc('escapeScroll', '脱出の巻物', 'escapeDungeon', 2500, 20,
    '読むと ダンジョンから 脱出して 村へ 戻る。持ち物は そのまま持ち帰れる。'),
  sc('releaseScroll', '解除の巻物', 'releaseStatus', 700, 28,
    'かなしばり・まひ・封印など、体にかかった異常を すべて 解く。'),
  sc('monsterScroll', '魔物部屋の巻物', 'summonHouse', 300, 14, '部屋がモンスターで埋まる。'),
  sc('blastScroll', '爆発の巻物', 'blast', 1200, 20, '周囲を爆発させる。自分も巻き込まれる。'),
  sc('fireScroll', '火炎の巻物', 'fireLine', 900, 24, '向いている方向へ炎を放つ。'),
  sc('trapScroll', 'ワナの巻物', 'makeTrap', 400, 18, '足元にワナを作る。'),
  sc('curseScroll', 'たたりの巻物', 'curseItems', 200, 18, '持ち物がいくつか呪われる。'),
  sc('summonScroll', '召喚の巻物', 'summonMonsters', 300, 16, '周囲にモンスターが現れる。'),
];

export const STAVES: readonly StaffDef[] = [
  st('knockbackStaff', 'ふきとばしの杖', 'knockback', 800, 100, 'hit', '当たった敵を吹き飛ばす。'),
  st('pullStaff', '引きよせの杖', 'pull', 800, 60, 'hit', '当たった敵を手前に引き寄せる。'),
  st('sleepStaff', '眠りの杖', 'sleepTarget', 1000, 70, 'hit', '当たった敵を眠らせる。'),
  st('confuseStaff', '混乱の杖', 'confuseTarget', 1000, 70, 'hit', '当たった敵を混乱させる。'),
  st('bindStaff', 'かなしばりの杖', 'bindTarget', 1200, 60, 'hit', '当たった敵を動けなくする。'),
  st('swapStaff', '場所がえの杖', 'swap', 1400, 50, 'hit', '当たった敵と位置を入れ替える。'),
  st('slowStaff', '鈍足の杖', 'slowTarget', 1100, 50, 'hit', '当たった敵の動きを鈍くする。'),
  st('hasteStaff', '倍速の杖', 'hasteTarget', 900, 26, 'hit', '当たった敵が倍速になる。'),
  st('shelterStaff', '一時しのぎの杖', 'shelterTarget', 1200, 36, 'hit', '当たった敵を階段へ飛ばす。'),
  st('sealStaff', '封印の杖', 'sealTarget', 1000, 40, 'hit', '当たった敵の特技を封じる。'),
  st('changeStaff', '変化の杖', 'transform', 1300, 34, 'hit', '当たった敵が別の敵に変わる。'),
  st('growthStaff', '成長の杖', 'growTarget', 800, 24, 'hit', '当たった敵のレベルが 1 上がる。'),
  st('levelDownStaff', 'レベルダウンの杖', 'weakenTarget', 1400, 34, 'hit', '当たった敵のレベルを 1 下げる。'),
  st('invisibleStaff', 'とうめいの杖', 'invisibleTarget', 700, 24, 'hit', '当たった敵が透明になる。'),
  st('decoyStaff', '身代わりの杖', 'decoy', 1600, 26, 'hit', '当たった敵に、他の敵の攻撃が集まる。'),
  st('digStaff', '掘り進みの杖', 'dig', 1500, 30, 'pierce', '壁を掘り進んで通路を作る。'),
  st('thunderStaff', '雷の杖', 'thunderBolt', 1800, 30, 'pierce', '直線上の敵すべてに雷を落とす。'),
  st('echoStaff', 'こだまの杖', 'echo', 1600, 20, 'bounce', '壁で 3 回まで跳ね返る魔法を放つ。'),
  st('suctionStaff', '吸引の杖', 'suction', 1400, 22, 'pierce', '直線上の敵を手前に引き寄せる。'),
  st('lossStaff', '大損の杖', 'lossGitan', 300, 14, 'self', '振るとギタンを落としてしまう。'),
];
