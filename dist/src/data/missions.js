/**
 * ミッション 100 個。
 *
 * 役割は 3 つ。
 *
 * 1. 石の入口。冒険の報酬だけだと、最初のダンジョンを出るまで
 *    ガチャが 1 回も引けない。序盤のミッションはそこを埋める。
 * 2. 操作の案内。ショートカット・保持枠・壺・合成・向き変えは、
 *    説明を読まないと存在に気づかない。「やったら石が出る」形で触らせる。
 * 3. 目標。深さ・撃破数・図鑑・装備の育成。上を見たら終わりが無い形にする。
 *
 * 順番の縛りは無い。100 個が最初から全部見えていて、
 * 達成したものは順番に関係なく受け取れる。
 *
 * 条件は村の状態（TownState）だけを見て判定する。冒険中の状態は見ない。
 * 数えは finishRun で村へ合流するので、判定は村に戻ったときに更新される。
 *
 * 【数の決め方】
 * どの N も「1 周あたりの期待数」の実測から決めてある。目安は 2〜3 周で届く数。
 * ランダムに動かすだけで達成してしまう数は使わない。
 *
 *   d1 の敵: のらネズミ 4.3 / あおプルン 3.4 / どうくつコウモリ 2.5（1 周あたり）
 *   d2 の敵: どろネズミ 4.6 / こざかな 4.3 / みどりプルン 3.9
 *   d3 の敵: サビ虫 5.3 / いし投げ鬼 4.9 / ひとかげトカゲ 4.9
 *   d4 の敵: おばけ 6.6 / うらみおばけ 4.3 / くろプルン 4.1
 *   dl の敵: がんせき鬼 6.5 / 大術士 6.4 / やみのコウモリ 5.7
 *   ワナ   : d1 には 1 個も無い。d2 で 1 種 0.6〜1.3 個、dl で 4〜7 個
 *   床の物 : d1 は 21 個。ただし d1 に 壺・腕輪・杖 は 落ちていない
 *
 * id はセーブ（TownState.claimed）に載る。配布後に改名すると
 * 受け取り済みの記録が外れて、石をもう一度配ることになる。変えないこと。
 */
// --- 条件を短く書くための道具。100 行を読める長さに保つため ------------------
const T = (key, n) => ({ t: 'tally', key, n });
const MAX = (key, n) => ({ t: 'max', key, n });
const CLR = (dungeon) => ({ t: 'cleared', dungeon });
const DEP = (dungeon, n) => ({ t: 'depth', dungeon, n });
const ALL = (...conds) => ({ t: 'every', conds });
const KILL = (id, n) => T(`kill:${id}`, n);
const TRAP = (id, n) => T(`trap:${id}`, n);
const ACT = (type, n) => T(`act:${type}`, n);
const STORE = (n) => ({ t: 'storage', n });
const DEX = (monsters, items) => ({ t: 'dex', monsters, items });
const m = (id, name, cond, stones, group) => ({ id, name, cond, stones, group });
/**
 * 序盤 25 個。始まりの洞窟とせせらぎの森で届く。
 *
 * 「勝手に達成される」ものは 1 つも置かない。
 * ランダムに 1 周しただけで 8 割方 達成してしまう数（1 体倒す・1 個拾う）は
 * 全部やめて、一度は自分で「そうしよう」と思わないと進まない数にしてある。
 * 1 個 1 個は軽いので、最初の 2 本を遊ぶ間に 20 個近く受け取れる。
 */
const TUTORIAL = [
    // --- 基本の操作。数はどれも「2 周ぶん」
    m('firstKill', '敵を 30 体 倒す', T('kill', 30), 40, 'tutorial'),
    m('firstPickup', '道具を 30 個 拾う', T('pickup', 30), 40, 'tutorial'),
    m('firstEquip', '武器と 盾を 装備する', ALL(T('equip:weapon', 1), T('equip:shield', 1)), 50, 'tutorial'),
    m('firstHerb', '草を 5 回 飲む', T('use:herb', 5), 40, 'tutorial'),
    m('firstScroll', '巻物を 5 回 読む', T('use:scroll', 5), 40, 'tutorial'),
    m('firstFood', 'おにぎりを 5 回 食べる', T('use:food', 5), 40, 'tutorial'),
    m('descend20', '階段を 20 回 降りる', T('descend', 20), 50, 'tutorial'),
    m('walk5000', '5000 歩 歩く', T('walk', 5000), 40, 'tutorial'),
    // --- 知らないと損をする操作。どれも自分で選ばないと 1 回も発行されない
    m('firstShortcut', 'ショートカットに 3 個 入れる', T('shortcut', 3), 60, 'tutorial'),
    m('firstBentou', '食事処で 弁当を 買う', T('bentou', 1), 60, 'tutorial'),
    m('firstWait', 'その場で 20 回 足踏みする', ACT('wait', 20), 40, 'tutorial'),
    m('firstThrow', '道具を 20 回 投げる', ACT('throw', 20), 50, 'tutorial'),
    m('firstPlace', '道具を 10 回 置く', ACT('place', 10), 40, 'tutorial'),
    m('firstSwap', '持ち物と 足元の物を 3 回 入れ替える', ACT('swap', 3), 60, 'tutorial'),
    m('firstUnequip', '装備を 5 回 外す', ACT('unequip', 5), 40, 'tutorial'),
    // --- 村の使い方
    m('townBuy', '村の 道具屋で 5 個 買う', T('buy', 5), 50, 'tutorial'),
    m('townSell', '道具を 10 個 売る', ACT('sell', 10), 50, 'tutorial'),
    m('bankSave', '銀行に 5 回 預ける', T('bank', 5), 50, 'tutorial'),
    m('storeItems', '倉庫に 道具を 50 個 貯める', STORE(50), 60, 'tutorial'),
    // --- 始まりの洞窟の顔ぶれ（1 周 1.0〜4.3 体）
    m('killRatField', 'のらネズミを 20 体 倒す', KILL('ratField', 20), 60, 'tutorial'),
    m('killSlimeBlue', 'あおプルンを 20 体 倒す', KILL('slimeBlue', 20), 60, 'tutorial'),
    m('killBatCave', 'どうくつコウモリを 20 体 倒す', KILL('batCave', 20), 60, 'tutorial'),
    m('killPlantDoze', 'ねむりそうを 10 体 倒す', KILL('plantDoze', 10), 60, 'tutorial'),
    // --- 区切り
    m('clearD1', '始まりの洞窟を クリアする', CLR('d1'), 150, 'tutorial'),
    m('clearD2', 'せせらぎの森を クリアする', CLR('d2'), 250, 'tutorial'),
];
/**
 * 中盤 45 個。
 *
 * 石の量より「一通り触らせる」ことを狙った配分。
 * 壺・合成・印・呪い・店・ワナ・仲間を、それぞれ別のミッションで扱う。
 * 敵は d2〜d4 の顔ぶれから、各ダンジョン 5 種ずつ。
 */
const MID = [
    // --- 道具の扱い。壺・腕輪・杖は d1 に落ちていないので、ここから
    m('firstStaff', '杖を 15 回 振る', T('use:staff', 15), 120, 'mid'),
    m('firstPot', '壺を 10 回 使う', T('use:pot', 10), 140, 'mid'),
    m('firstBracelet', '腕輪を 5 回 装備する', T('equip:bracelet', 5), 120, 'mid'),
    m('potPut', '壺に 道具を 15 回 入れる', T('potPut', 15), 140, 'mid'),
    m('potTake', '壺から 道具を 10 回 出す', ACT('takeOut', 10), 120, 'mid'),
    m('keepSlot', '保持枠に 道具を 10 回 入れる', T('keep', 10), 140, 'mid'),
    m('useAllKinds', '草・巻物・杖・壺を すべて 使う', ALL(T('use:herb', 1), T('use:scroll', 1), T('use:staff', 1), T('use:pot', 1)), 200, 'mid'),
    m('equipAll', '武器・盾・腕輪を すべて 装備する', ALL(T('equip:weapon', 1), T('equip:shield', 1), T('equip:bracelet', 1)), 160, 'mid'),
    // --- 鍛える
    m('synthesis', '装備を 3 回 合成する', T('synthesis', 3), 250, 'mid'),
    m('plus5', '装備を +5 まで 鍛える', MAX('plus', 5), 200, 'mid'),
    m('plus10', '装備を +10 まで 鍛える', MAX('plus', 10), 400, 'mid'),
    m('runes3', '1 つの 装備に 印を 3 つ 入れる', MAX('runes', 3), 300, 'mid'),
    m('uncurse5', '呪いを 5 回 解く', T('cure:curse', 5), 160, 'mid'),
    // --- 店
    m('shopBuy', 'ダンジョンの 店で 5 個 買う', T('shopBuy', 5), 180, 'mid'),
    m('steal', '店で 代金を 払わずに 出る', T('steal', 1), 300, 'mid'),
    // --- ワナ（d1 には 1 個も無い。d2 で 1 種 0.6〜1.3 個 / 周、dl で 4〜7 個）
    m('stepTrap', 'ワナを 30 回 踏む', T('trap', 30), 160, 'mid'),
    m('trapWarp', 'ワープのワナを 5 回 踏む', TRAP('warp', 5), 140, 'mid'),
    m('trapSpike', '落とし穴に 5 回 落ちる', TRAP('spike', 5), 140, 'mid'),
    m('trapSummon', '召喚のワナを 5 回 踏む', TRAP('summon', 5), 160, 'mid'),
    m('trapMine', '地雷を 3 回 踏む', TRAP('mine', 3), 180, 'mid'),
    m('trapCurse', '呪いのワナを 3 回 踏む', TRAP('curseTrap', 3), 160, 'mid'),
    m('trapHouse', 'モンスターハウスの ワナを 3 回 踏む', TRAP('monsterHouseTrap', 3), 220, 'mid'),
    m('house5', 'モンスターハウスに 5 回 踏み込む', T('house', 5), 240, 'mid'),
    // --- 仲間
    m('makeAlly', '分身の巻物で 仲間を 作る', T('makeAlly', 1), 250, 'mid'),
    // 倉庫は「持ち帰る」だけでなく「持ち出す」ためにある
    m('withdraw', '倉庫から 道具を 20 個 取り出す', T('withdraw', 20), 160, 'mid'),
    // --- せせらぎの森（1 周 2.2〜4.6 体）
    m('killRatMud', 'どろネズミを 25 体 倒す', KILL('ratMud', 25), 120, 'mid'),
    m('killFishSmall', 'こざかなを 25 体 倒す', KILL('fishSmall', 25), 120, 'mid'),
    m('killSlimeGreen', 'みどりプルンを 25 体 倒す', KILL('slimeGreen', 25), 120, 'mid'),
    m('killBirdPick', 'ぬすっとドリを 10 体 倒す', KILL('birdPick', 10), 160, 'mid'),
    m('killCoinSmall', 'ゼニドロを 10 体 倒す', KILL('coinSmall', 10), 140, 'mid'),
    // --- 灼熱の火山（1 周 3.4〜5.3 体）
    m('killRust', 'サビ虫を 25 体 倒す', KILL('rustBug', 25), 140, 'mid'),
    m('killArcherRock', 'いし投げ鬼を 25 体 倒す', KILL('archerRock', 25), 140, 'mid'),
    m('killLizardFire', 'ひとかげトカゲを 25 体 倒す', KILL('lizardFire', 25), 140, 'mid'),
    m('killRatGiant', 'オオネズミを 25 体 倒す', KILL('ratGiant', 25), 140, 'mid'),
    m('killBombSlime', 'ボムプルンを 15 体 倒す', KILL('bombSlime', 15), 160, 'mid'),
    // --- 常闇の地下水路（1 周 2.9〜6.6 体）
    m('killGhost', 'おばけを 30 体 倒す', KILL('ghostPale', 30), 160, 'mid'),
    m('killGhostGrudge', 'うらみおばけを 20 体 倒す', KILL('ghostGrudge', 20), 180, 'mid'),
    m('killSlimeBlack', 'くろプルンを 20 体 倒す', KILL('slimeBlack', 20), 180, 'mid'),
    m('killCursedMask', 'のろい面を 15 体 倒す', KILL('cursedMask', 15), 180, 'mid'),
    m('killDrainLesser', 'すいとりを 15 体 倒す', KILL('drainLesser', 15), 180, 'mid'),
    // --- 区切りとボス
    m('clearD3', '灼熱の火山を クリアする', CLR('d3'), 350, 'mid'),
    m('clearD4', '常闇の地下水路を クリアする', CLR('d4'), 450, 'mid'),
    m('bossForest', '森の主を 倒す', KILL('bossForest', 1), 200, 'mid'),
    m('bossVolcano', '火口の番人を 倒す', KILL('bossVolcano', 1), 300, 'mid'),
    m('bossWaterway', '水路の淀みを 倒す', KILL('bossWaterway', 1), 400, 'mid'),
];
/**
 * 終盤 30 個。
 *
 * 天輪の塔から先。ここから「狙わないと届かない」ものだけになる。
 * 真・もっと不思議（exPure）は加護も相棒も保持枠も効かないので、
 * そこを指すミッションは「拾った物だけで何とかする力」を試すものになる。
 */
const LATE = [
    // --- 天輪の塔（1 周 4.5〜6.5 体）
    m('clearDl', '天輪の塔を クリアする', CLR('dl'), 600, 'late'),
    m('bossTowerFirst', '天輪の守り手を 倒す', KILL('bossTowerFirst', 1), 450, 'late'),
    m('killArcherBoulder', 'がんせき鬼を 30 体 倒す', KILL('archerBoulder', 30), 250, 'late'),
    m('killMageArch', '大術士を 30 体 倒す', KILL('mageArch', 30), 250, 'late'),
    m('killBatAbyss', 'やみのコウモリを 30 体 倒す', KILL('batAbyss', 30), 250, 'late'),
    m('killArmorBlack', '黒武者を 25 体 倒す', KILL('armorBlack', 25), 250, 'late'),
    // dl では 1 周 0.95 体。ex なら 3.6 体。硬いので数を抑えてある
    m('killMetalKing', 'メタルムシの王を 10 体 倒す', KILL('metalKing', 10), 500, 'late'),
    // --- 育てる
    m('level30', 'レベル 30 に 到達する', MAX('level', 30), 400, 'late'),
    m('level50', 'レベル 50 に 到達する', MAX('level', 50), 600, 'late'),
    m('level80', 'レベル 80 に 到達する', MAX('level', 80), 1000, 'late'),
    m('plus20', '装備を +20 まで 鍛える', MAX('plus', 20), 600, 'late'),
    m('runes6', '1 つの 装備に 印を 6 つ 入れる', MAX('runes', 6), 500, 'late'),
    m('gitan30000', '一度に 30000 ギタン 持つ', MAX('gitan', 30000), 600, 'late'),
    m('kills100', '1 回の 冒険で 100 体 倒す', MAX('killsInRun', 100), 600, 'late'),
    m('kills300', '1 回の 冒険で 300 体 倒す', MAX('killsInRun', 300), 800, 'late'),
    m('killAll3000', '通算 3000 体 倒す', T('kill', 3000), 600, 'late'),
    // --- 不思議のダンジョン（持ち込み可 40F）
    m('clearExBring', '不思議のダンジョンを クリアする', CLR('exBring'), 700, 'late'),
    m('exBring20', '不思議のダンジョンの 20F に 到達する', DEP('exBring', 20), 400, 'late'),
    // --- もっと不思議（持ち込み不可 99F・Lv1 から）
    m('moreEx30', 'もっと不思議の 30F に 到達する', DEP('ex', 30), 600, 'late'),
    m('moreEx50', 'もっと不思議の 50F に 到達する', DEP('ex', 50), 900, 'late'),
    m('moreEx80', 'もっと不思議の 80F に 到達する', DEP('ex', 80), 1400, 'late'),
    m('clearEx', 'もっと不思議を クリアする', CLR('ex'), 1800, 'late'),
    m('bossAbyss', 'もっと不思議の果てを 倒す', KILL('bossAbyss', 1), 700, 'late'),
    m('killAbyssSovereign', 'ふちのあるじを 10 体 倒す', KILL('abyssSovereign', 10), 600, 'late'),
    // --- 真・もっと不思議（加護なし 99F）
    m('purePlunge', '真・もっと不思議の 30F に 到達する', DEP('exPure', 30), 700, 'late'),
    m('pure50', '真・もっと不思議の 50F に 到達する', DEP('exPure', 50), 1100, 'late'),
    m('pure80', '真・もっと不思議の 80F に 到達する', DEP('exPure', 80), 1800, 'late'),
    m('clearPure', '真・もっと不思議を クリアする', CLR('exPure'), 2500, 'late'),
    // --- 集める。図鑑の分母は 敵 79 / 道具 194
    m('dex50', '図鑑を 5 割 埋める', DEX(40, 97), 600, 'late'),
    m('dex70', '図鑑を 7 割 埋める', DEX(56, 136), 900, 'late'),
];
export const MISSIONS = [...TUTORIAL, ...MID, ...LATE];
const missionMap = new Map(MISSIONS.map((x) => [x.id, x]));
export const tryGetMission = (id) => missionMap.get(id);
//# sourceMappingURL=missions.js.map