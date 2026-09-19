/**
 * ダンジョン定義。
 *
 * 構成は「4 ダンジョン ＋ ラストダンジョン ＋ おまけのもっと不思議のダンジョン」。
 *   d1 始まりの洞窟     5F   チュートリアル
 *   d2 せせらぎの森    10F   水路
 *   d3 灼熱の火山      15F   溶岩・炎
 *   d4 常闇の地下水路  20F   暗い部屋・亡霊
 *   dl 天輪の塔        30F   総決算・2 形態のボス
 *   ex もっと不思議    99F   Lv1 スタート・持ち込み不可
 *
 * モンスターの出現表は手で書き、アイテムの出現表は
 * 「値段の高いものほど深い階で出る」規則から自動生成する。
 */
import { ALL_ITEMS } from './items/all.js';
// ---------------------------------------------------------------------------
// 出現表のヘルパ
// ---------------------------------------------------------------------------
/** モンスター 1 行: id / 出現開始階 / 出現終了階 / 重み */
const mob = (id, from, to, weight = 100) => ({ id, from, to, weight });
/**
 * アイテムの出現表を自動生成する。
 * 値段が高いものほど深い階から出るようにして、序盤に強装備が出るのを防ぐ。
 */
function itemTable(o) {
    const exclude = new Set(o.exclude ?? []);
    const early = new Set(o.earlyIds ?? []);
    const kinds = o.kinds ? new Set(o.kinds) : null;
    const out = [];
    for (const d of ALL_ITEMS) {
        if (d.weight <= 0)
            continue;
        if (exclude.has(d.id))
            continue;
        if (kinds && !kinds.has(d.kind))
            continue;
        const boost = o.boost?.[d.id] ?? o.boost?.[d.kind] ?? 1;
        const weight = Math.round(d.weight * boost);
        if (weight <= 0)
            continue;
        const from = early.has(d.id)
            ? 1
            : Math.max(1, Math.min(o.depth, Math.ceil(d.price / o.pricePerFloor)));
        out.push({ id: d.id, weight, from, to: o.depth });
    }
    return out;
}
/** ワナの出現表。deep 以降は危険なワナも出す */
const trapTable = (depth, from = 1, exclude = []) => {
    const dangerous = new Set([
        'mine', 'bigMine', 'monsterHouseTrap', 'curseTrap', 'sealTrap', 'itemLossTrap',
    ]);
    const ids = [
        'arrow', 'poisonArrow', 'spike', 'sleepGas', 'confuseGas', 'blindGas', 'bearTrap',
        'rustTrap', 'rotTrap', 'alarm', 'summon', 'warp', 'spin', 'mine', 'bigMine',
        'slowTrap', 'weakenTrap', 'curseTrap', 'hungerTrap', 'sealTrap',
        'monsterHouseTrap', 'itemLossTrap', 'lavaTrap', 'waterTrap',
    ];
    const ex = new Set(exclude);
    return ids
        .filter((id) => !ex.has(id))
        .map((id) => ({
        id,
        weight: 100,
        from: dangerous.has(id) ? Math.max(from, Math.ceil(depth * 0.3)) : from,
        to: depth,
    }));
};
// ---------------------------------------------------------------------------
// 見た目のテーマ
// ---------------------------------------------------------------------------
const THEME_CAVE = {
    wall: '#4a3b2e',
    wallTop: '#6d5744',
    floor: '#3d362c',
    floorAlt: '#463d31',
    corridor: '#2e2822',
    liquid: '#2a4a5c',
    liquidAlt: '#356a80',
    gloom: '#08070a',
    accent: '#d8b06a',
};
const THEME_FOREST = {
    wall: '#2d5034',
    wallTop: '#47784e',
    floor: '#2c3f30',
    floorAlt: '#344a38',
    corridor: '#212f24',
    liquid: '#1f5a70',
    liquidAlt: '#2f86a4',
    gloom: '#050906',
    accent: '#8fd489',
};
const THEME_VOLCANO = {
    wall: '#573024',
    wallTop: '#84492f',
    floor: '#432a20',
    floorAlt: '#4e3226',
    corridor: '#33201a',
    liquid: '#8c2c10',
    liquidAlt: '#e0641a',
    gloom: '#0c0403',
    accent: '#f0944c',
};
const THEME_WATERWAY = {
    wall: '#2a3350',
    wallTop: '#3f4d72',
    floor: '#28304a',
    floorAlt: '#2f3856',
    corridor: '#1d2337',
    liquid: '#1b3d60',
    liquidAlt: '#2a5f8e',
    gloom: '#03040a',
    accent: '#84a2e4',
};
const THEME_TOWER = {
    wall: '#4e4c5c',
    wallTop: '#706e82',
    floor: '#413f4d',
    floorAlt: '#4a4857',
    corridor: '#312f3b',
    liquid: '#3a4a70',
    liquidAlt: '#5a74a8',
    gloom: '#07070c',
    accent: '#efdc94',
};
const THEME_ABYSS = {
    wall: '#3b2a48',
    wallTop: '#573a68',
    floor: '#2f2440',
    floorAlt: '#372a4a',
    corridor: '#231a30',
    liquid: '#2c1a45',
    liquidAlt: '#4a2a72',
    gloom: '#030206',
    accent: '#c58fef',
};
// ---------------------------------------------------------------------------
// 生成パラメータ
// ---------------------------------------------------------------------------
const gen = (o) => ({
    width: 48, height: 32,
    gridCols: [3, 4], gridRows: [2, 3],
    emptyCellRate: 18,
    minRoomW: 4, minRoomH: 4,
    darkRoomRate: 0,
    waterRate: 0, liquid: 'none',
    items: [3, 5], traps: [1, 3], monsters: [4, 6],
    spawnInterval: 40, maxMonsters: 16, shopRate: 0,
    ...o,
});
// ---------------------------------------------------------------------------
// ダンジョン本体
// ---------------------------------------------------------------------------
/** d1 始まりの洞窟 — 5F。極めて易しいチュートリアル */
const D1 = {
    id: 'd1',
    name: '始まりの洞窟',
    subtitle: '風の村のすぐ裏にある、浅い洞窟',
    desc: '村の子どもでも潜れるという浅い洞窟。ここで風来人の作法を覚えよう。\n' +
        '持ち込みも持ち帰りも自由。倒れても持ち物は失わない。\n' +
        '分裂して増えた敵は、そのぶん攻撃力が下がる。',
    depth: 5,
    allowBring: true,
    resetLevel: false,
    allowAlly: true,
    // 増える特技は残したまま、増えたぶん攻撃力を分ける。
    // ここだけ true。せせらぎの森から先は据え置き
    splitWeakens: true,
    requires: null,
    theme: THEME_CAVE,
    bgm: 'cave',
    gen: gen({
        width: 44, height: 30, gridCols: [3, 3], gridRows: [2, 2],
        emptyCellRate: 8, items: [4, 6], traps: [0, 1], monsters: [2, 3],
        spawnInterval: 60, maxMonsters: 8,
    }),
    monsters: [
        mob('ratField', 1, 5, 150),
        mob('slimeBlue', 1, 5, 120),
        mob('batCave', 2, 5, 110),
        mob('plantDoze', 3, 5, 70),
        mob('mushSpore', 4, 5, 60),
    ],
    items: itemTable({
        depth: 5, pricePerFloor: 400,
        kinds: ['weapon', 'shield', 'herb', 'scroll', 'food', 'misc'],
        earlyIds: ['healHerb', 'riceBall', 'woodStick', 'woodShield', 'identifyScroll'],
        boost: { herb: 1.4, food: 1.6, weapon: 0.8, shield: 0.8 },
        exclude: ['rottenRiceBall', 'curseScroll', 'summonScroll', 'monsterScroll'],
    }),
    traps: trapTable(5, 3, [
        'mine', 'bigMine', 'monsterHouseTrap', 'curseTrap', 'sealTrap',
        'itemLossTrap', 'weakenTrap', 'rotTrap', 'lavaTrap',
    ]),
    bosses: [],
    reward: { gitan: 500, message: '洞窟の奥で 小さな宝を 見つけた！' },
    monsterHouseRate: 0,
    bigRoomRate: 0,
    windTurns: 0,
};
/** d2 せせらぎの森 — 10F。水路が増え、盗む敵が出始める */
const D2 = {
    id: 'd2',
    name: 'せせらぎの森',
    subtitle: '水の音が絶えない、迷いやすい森',
    desc: '水路が入り組んだ森。水の中には入れないので、回り道を強いられる。\n' +
        '持ち物を盗む鳥が出る。奥には森の主が待っているという。',
    depth: 10,
    allowBring: true,
    resetLevel: false,
    allowAlly: true,
    requires: 'd1',
    theme: THEME_FOREST,
    bgm: 'forest',
    gen: gen({
        waterRate: 45, liquid: 'water',
        items: [3, 6], traps: [1, 3], monsters: [4, 6],
        spawnInterval: 45, maxMonsters: 14, shopRate: 8, darkRoomRate: 5,
    }),
    monsters: [
        mob('ratField', 1, 3, 90),
        mob('ratMud', 4, 10, 120),
        mob('slimeBlue', 1, 4, 90),
        mob('slimeGreen', 4, 10, 110),
        mob('batCave', 1, 6, 110),
        mob('batBlood', 5, 10, 100),
        mob('plantDoze', 1, 6, 90),
        mob('plantPoison', 6, 10, 80),
        mob('birdPick', 4, 10, 70),
        mob('coinSmall', 3, 10, 60),
        mob('archerPebble', 4, 10, 70),
        mob('fishSmall', 1, 10, 80),
        mob('frogTree', 3, 10, 70),
        mob('mageNovice', 6, 10, 60),
        mob('armorWood', 7, 10, 60),
    ],
    items: itemTable({
        depth: 10, pricePerFloor: 500,
        exclude: ['bentou'],
        boost: { herb: 1.2, scroll: 1.1, staff: 1.0, pot: 0.9, bracelet: 0.7 },
    }),
    traps: trapTable(10, 1, ['bigMine', 'lavaTrap']),
    bosses: [{ depth: 10, monsterId: 'bossForest' }],
    reward: { gitan: 2000, itemId: 'windBlade', message: '森の主が 遺した刃を 手に入れた！' },
    monsterHouseRate: 4,
    bigRoomRate: 2,
    windTurns: 1000,
};
/** d3 灼熱の火山 — 15F。溶岩と炎。装備が錆びる */
const D3 = {
    id: 'd3',
    name: '灼熱の火山',
    subtitle: '足元から熱が這い上がる火の山',
    desc: '溶岩が流れる火山。炎を吐く敵が多く、装備を錆びさせる虫も出る。\n' +
        '水の備えを持って潜りたい。',
    depth: 15,
    allowBring: true,
    resetLevel: false,
    allowAlly: true,
    requires: 'd2',
    theme: THEME_VOLCANO,
    bgm: 'volcano',
    gen: gen({
        waterRate: 50, liquid: 'lava',
        gridCols: [3, 4], gridRows: [2, 3],
        items: [3, 6], traps: [2, 4], monsters: [5, 7],
        spawnInterval: 40, maxMonsters: 16, shopRate: 8, darkRoomRate: 8,
    }),
    monsters: [
        // 1-3F: どのダンジョンでも Lv1・HP15 から始まるので、序盤は弱い敵だけにする
        mob('ratField', 1, 4, 110),
        mob('slimeBlue', 1, 4, 100),
        mob('batCave', 1, 5, 100),
        mob('mushSpore', 1, 6, 90),
        mob('plantDoze', 1, 5, 70),
        mob('tripStick', 1, 8, 60),
        mob('rustBug', 2, 15, 70),
        // 3F 以降
        mob('slimeGreen', 3, 9, 100),
        mob('batBlood', 3, 9, 95),
        mob('plantPoison', 3, 10, 80),
        mob('ratMud', 3, 8, 90),
        // 5F 以降
        mob('ratGiant', 5, 13, 90),
        mob('archerRock', 5, 15, 80),
        mob('mageAdept', 6, 15, 70),
        mob('coinBig', 5, 15, 60),
        mob('birdRob', 6, 15, 65),
        mob('bombSlime', 5, 15, 55),
        // 7F 以降
        mob('mushMad', 7, 15, 85),
        mob('batMad', 8, 15, 90),
        mob('lizardFire', 7, 15, 100),
        mob('metalBug', 8, 15, 25),
        // 9F 以降
        mob('slimeBlack', 10, 15, 90),
        mob('armorIron', 9, 15, 70),
        mob('ogreRed', 10, 15, 70),
        // 12F 以降
        mob('dragonFlame', 12, 15, 60),
    ],
    items: itemTable({
        depth: 15, pricePerFloor: 450,
        exclude: ['bentou'],
        boost: { scroll: 1.1, staff: 1.1, bracelet: 0.9, grilledRiceBall: 2 },
    }),
    traps: trapTable(15, 1),
    bosses: [{ depth: 15, monsterId: 'bossVolcano' }],
    reward: { gitan: 5000, itemId: 'dragonScale', message: '岩鬼の鱗を 剥ぎ取った！' },
    monsterHouseRate: 6,
    bigRoomRate: 3,
    windTurns: 900,
};
/** d4 常闇の地下水路 — 20F。暗い部屋と亡霊 */
const D4 = {
    id: 'd4',
    name: '常闇の地下水路',
    subtitle: '灯りの届かない、村の地下に広がる水路',
    desc: '明かりの無い部屋が多く、隣のマスしか見えない。\n' +
        '壁をすり抜ける亡霊と、レベルを奪う者が徘徊している。',
    depth: 20,
    allowBring: true,
    resetLevel: false,
    allowAlly: true,
    requires: 'd3',
    theme: THEME_WATERWAY,
    bgm: 'waterway',
    gen: gen({
        waterRate: 55, liquid: 'water',
        gridCols: [3, 4], gridRows: [2, 3],
        darkRoomRate: 35,
        items: [4, 6], traps: [2, 5], monsters: [5, 8],
        spawnInterval: 35, maxMonsters: 18, shopRate: 12,
    }),
    monsters: [
        // 1-3F
        mob('ratMud', 1, 5, 100),
        mob('batCave', 1, 5, 90),
        mob('slimeBlue', 1, 4, 80),
        mob('mushSpore', 1, 6, 80),
        mob('plantDoze', 1, 6, 70),
        mob('ghostPale', 1, 12, 95),
        mob('fishSmall', 1, 8, 70),
        mob('frogTree', 1, 8, 70),
        // 4F 以降
        mob('slimeGreen', 4, 10, 90),
        mob('batBlood', 4, 10, 90),
        mob('plantPoison', 4, 12, 75),
        mob('rustBug', 4, 14, 65),
        mob('tripStick', 3, 10, 55),
        // 6F 以降
        mob('ratGiant', 6, 14, 85),
        mob('archerRock', 6, 15, 75),
        mob('mageAdept', 6, 14, 70),
        mob('coinBig', 6, 15, 55),
        mob('birdRob', 6, 14, 60),
        mob('cursedMask', 7, 20, 60),
        mob('eyeGaze', 7, 20, 55),
        mob('drainLesser', 8, 20, 60),
        mob('sealerSmall', 8, 20, 55),
        // 9F 以降
        mob('slimeBlack', 9, 20, 85),
        mob('batMad', 9, 20, 85),
        mob('mushMad', 9, 18, 75),
        mob('armorIron', 9, 18, 70),
        mob('ghostGrudge', 9, 20, 85),
        mob('eelGiant', 9, 20, 70),
        mob('mimicPot', 10, 20, 50),
        mob('shadowClone', 10, 20, 55),
        mob('frogGiant', 10, 20, 60),
        mob('tripPole', 10, 20, 50),
        mob('metalBug', 10, 20, 22),
        // 13F 以降
        mob('plantDeadly', 13, 20, 70),
        mob('mushDeadly', 14, 20, 70),
        mob('archerBoulder', 13, 20, 65),
        mob('mageArch', 14, 20, 60),
        mob('armorBlack', 15, 20, 60),
        mob('bombGiant', 14, 20, 40),
        // 16F 以降
        mob('ratKing', 16, 20, 60),
        mob('batAbyss', 16, 20, 60),
        mob('birdGrand', 16, 20, 50),
        mob('coinKing', 16, 20, 45),
        mob('rustWyrm', 16, 20, 45),
        mob('waterDragon', 17, 20, 45),
        mob('polterPot', 17, 20, 40),
    ],
    items: itemTable({
        depth: 20, pricePerFloor: 400,
        exclude: ['bentou'],
        boost: { scroll: 1.15, pot: 1.1, bracelet: 1.0, lightScroll: 2.5, mapScroll: 2 },
    }),
    traps: trapTable(20, 1),
    bosses: [{ depth: 20, monsterId: 'bossWaterway' }],
    reward: { gitan: 12000, itemId: 'smithBlade', message: '水底に沈んでいた 匠の刀を 拾い上げた！' },
    monsterHouseRate: 8,
    bigRoomRate: 4,
    windTurns: 800,
};
/** dl 天輪の塔 — 30F。ラストダンジョン。2 形態のボス */
const DL = {
    id: 'dl',
    name: '天輪の塔',
    subtitle: '雲を貫いて立つ、風のはじまりの塔',
    desc: 'これまでのすべてが試される塔。30 階の頂に「天輪の主」が待つ。\n' +
        'ここを越えれば、風来人としての旅は一区切りとなる。',
    depth: 30,
    allowBring: true,
    resetLevel: false,
    allowAlly: true,
    requires: 'd4',
    theme: THEME_TOWER,
    bgm: 'tower',
    gen: gen({
        waterRate: 25, liquid: 'water',
        gridCols: [3, 4], gridRows: [2, 3],
        darkRoomRate: 15,
        items: [4, 7], traps: [3, 6], monsters: [6, 9],
        spawnInterval: 32, maxMonsters: 20, shopRate: 12,
    }),
    monsters: [
        // 1-3F: 塔もふもとは静かに始まる
        mob('ratMud', 1, 5, 100),
        mob('batCave', 1, 5, 90),
        mob('slimeBlue', 1, 4, 80),
        mob('mushSpore', 1, 6, 80),
        mob('plantDoze', 1, 6, 70),
        mob('ghostPale', 1, 8, 90),
        mob('frogTree', 1, 8, 70),
        // 4F 以降
        mob('slimeGreen', 4, 10, 90),
        mob('batBlood', 4, 10, 90),
        mob('plantPoison', 4, 12, 75),
        mob('rustBug', 4, 14, 60),
        mob('ratGiant', 5, 14, 85),
        mob('archerRock', 5, 14, 75),
        mob('mageAdept', 5, 14, 70),
        // 8F 以降
        mob('slimeBlack', 8, 18, 80),
        mob('batMad', 8, 18, 80),
        mob('mushMad', 8, 18, 75),
        mob('armorIron', 8, 18, 70),
        mob('ghostGrudge', 8, 20, 75),
        mob('drainLesser', 8, 18, 60),
        mob('sealerSmall', 8, 18, 55),
        mob('lizardFire', 8, 20, 70),
        mob('ogreRed', 9, 20, 70),
        mob('eelGiant', 8, 20, 60),
        // 12F 以降
        mob('plantDeadly', 12, 24, 60),
        mob('mushDeadly', 12, 26, 65),
        mob('archerBoulder', 12, 30, 65),
        mob('mageArch', 13, 30, 65),
        mob('cursedMask', 12, 22, 55),
        mob('mimicPot', 12, 24, 50),
        mob('shadowClone', 12, 24, 55),
        mob('eyeGaze', 12, 24, 50),
        mob('ratKing', 13, 26, 55),
        mob('coinBig', 12, 24, 45),
        mob('metalBug', 12, 30, 20),
        // 17F 以降
        mob('armorBlack', 17, 30, 65),
        mob('batAbyss', 17, 30, 70),
        mob('birdGrand', 17, 30, 50),
        mob('coinKing', 17, 30, 45),
        mob('rustWyrm', 17, 30, 50),
        mob('waterDragon', 18, 30, 50),
        mob('dragonFlame', 18, 30, 55),
        mob('cursedMaskGreat', 18, 30, 50),
        mob('mimicScroll', 18, 30, 45),
        mob('bombGiant', 17, 30, 40),
        mob('metalKing', 16, 30, 12),
        // 22F 以降: 総決算
        mob('slimeKing', 22, 30, 55),
        mob('ghostReaper', 22, 30, 60),
        mob('drainGreater', 22, 30, 55),
        mob('sealerGreat', 22, 30, 50),
        mob('shadowLord', 22, 30, 50),
        mob('armorTenrin', 24, 30, 55),
        mob('ogreKing', 24, 30, 50),
        mob('dragonInferno', 25, 30, 50),
        mob('eyeAbyss', 24, 30, 45),
        mob('polterLord', 25, 30, 40),
    ],
    items: itemTable({
        depth: 30, pricePerFloor: 350,
        exclude: ['bentou'],
        boost: { pot: 1.1, bracelet: 1.1, staff: 1.05 },
    }),
    traps: trapTable(30, 1),
    bosses: [
        { depth: 30, monsterId: 'bossTowerFirst' },
        { depth: 30, monsterId: 'bossTowerFinal' },
    ],
    reward: {
        gitan: 30000, itemId: 'tenrinSword',
        message: '天輪の剣を 手にした！ 風の村に 平穏が 戻った。',
    },
    monsterHouseRate: 9,
    bigRoomRate: 5,
    windTurns: 1200,
};
/** ex もっと不思議のダンジョン — 99F。持ち込み不可・Lv1 スタート */
const EX = {
    id: 'ex',
    name: 'もっと不思議のダンジョン',
    subtitle: '加護あり・99 階',
    desc: 'レベル 1 から始まり、道具は何ひとつ持ち込めない。\n' +
        'すべてを拾い集めて 99 階を目指す。生きて帰れば、拾った物は持ち帰れる。\n' +
        '風来人の本当の腕試し。',
    depth: 99,
    allowBring: false,
    resetLevel: true,
    // 道具は持ち込めないが、村で授かった加護と相棒は通じる。
    // 加護なしで潜りたい人には exPure（真・もっと不思議）を用意してある
    allowAlly: true,
    allowBoosts: true,
    requires: 'exBring',
    theme: THEME_ABYSS,
    bgm: 'abyss',
    gen: gen({
        width: 48, height: 32,
        waterRate: 35, liquid: 'water',
        gridCols: [3, 4], gridRows: [2, 3],
        darkRoomRate: 20,
        items: [4, 7], traps: [3, 6], monsters: [5, 8],
        spawnInterval: 30, maxMonsters: 22, shopRate: 6,
    }),
    monsters: [
        // 1-10F: 序盤の敵で足場を固める
        mob('ratField', 1, 4, 90),
        mob('slimeBlue', 1, 6, 80),
        mob('batCave', 1, 6, 90),
        mob('plantDoze', 5, 12, 70),
        mob('ratMud', 3, 10, 90),
        mob('mushSpore', 3, 12, 80),
        mob('fishSmall', 1, 12, 60),
        mob('birdPick', 4, 14, 60),
        mob('coinSmall', 3, 14, 55),
        mob('archerPebble', 4, 14, 70),
        // 10-30F
        mob('slimeGreen', 5, 14, 90),
        mob('batBlood', 6, 16, 85),
        mob('plantPoison', 6, 18, 70),
        mob('mushMad', 12, 26, 75),
        mob('ratGiant', 10, 24, 80),
        mob('lizardFire', 8, 24, 70),
        mob('mageNovice', 8, 20, 60),
        mob('archerRock', 12, 30, 70),
        mob('rustBug', 10, 30, 60),
        mob('armorWood', 8, 22, 60),
        mob('frogTree', 6, 22, 55),
        mob('tripStick', 8, 24, 55),
        mob('ghostPale', 10, 28, 70),
        mob('birdRob', 14, 32, 60),
        // 25-55F
        mob('slimeBlack', 14, 30, 80),
        mob('batMad', 14, 30, 80),
        mob('plantDeadly', 18, 40, 65),
        mob('mushDeadly', 24, 50, 70),
        mob('ratKing', 22, 45, 70),
        mob('mageAdept', 20, 40, 65),
        mob('sealerSmall', 18, 40, 55),
        mob('ghostGrudge', 20, 44, 70),
        mob('drainLesser', 22, 46, 60),
        mob('cursedMask', 20, 44, 55),
        mob('armorIron', 18, 40, 65),
        mob('ogreRed', 20, 42, 65),
        mob('eelGiant', 16, 40, 60),
        mob('frogGiant', 18, 40, 55),
        mob('mimicPot', 20, 46, 50),
        mob('shadowClone', 24, 48, 55),
        mob('eyeGaze', 22, 46, 50),
        mob('bombSlime', 18, 44, 45),
        mob('coinBig', 16, 40, 50),
        mob('archerBoulder', 26, 55, 60),
        mob('metalBug', 14, 60, 18),
        // 50-80F
        mob('slimeKing', 44, 80, 60),
        mob('batAbyss', 40, 75, 65),
        mob('birdGrand', 38, 75, 50),
        mob('coinKing', 38, 75, 45),
        mob('mageArch', 42, 80, 60),
        mob('sealerGreat', 44, 85, 55),
        mob('ghostReaper', 46, 85, 60),
        mob('drainGreater', 48, 88, 55),
        mob('rustWyrm', 42, 82, 45),
        mob('cursedMaskGreat', 46, 86, 50),
        mob('mimicScroll', 44, 84, 45),
        mob('shadowLord', 50, 90, 50),
        mob('armorBlack', 40, 78, 60),
        mob('ogreBlue', 42, 80, 55),
        mob('dragonFlame', 44, 82, 50),
        mob('waterDragon', 46, 86, 45),
        mob('tripPole', 36, 70, 45),
        mob('polterPot', 48, 88, 40),
        mob('bombGiant', 44, 84, 40),
        // 75-99F: 深層の強敵
        mob('armorTenrin', 70, 99, 55),
        mob('ogreKing', 72, 99, 50),
        mob('dragonInferno', 74, 99, 50),
        mob('eyeAbyss', 70, 99, 45),
        mob('polterLord', 76, 99, 40),
        mob('metalKing', 60, 99, 10),
        mob('abyssWatcher', 78, 99, 55),
        mob('abyssDevourer', 86, 99, 50),
        mob('abyssSovereign', 92, 99, 35),
    ],
    items: itemTable({
        depth: 99, pricePerFloor: 220,
        exclude: ['bentou', 'tenrinSword', 'tenrinShield'],
        // 何も持ち込めないので、序盤の生存に必要なものを厚くする
        boost: { herb: 1.25, food: 1.5, scroll: 1.1, weapon: 1.1, shield: 1.1 },
        earlyIds: [
            'healHerb', 'riceBall', 'woodStick', 'woodShield', 'oakClub',
            'leatherShield', 'identifyScroll', 'stone', 'woodArrow',
        ],
    }),
    traps: trapTable(99, 1),
    bosses: [{ depth: 99, monsterId: 'bossAbyss' }],
    reward: {
        gitan: 99000, itemId: 'abyssFang',
        message: '99 階を 踏破した！ 深淵の牙が 手の中に 残っていた。',
    },
    monsterHouseRate: 9,
    bigRoomRate: 4,
    windTurns: 800,
};
/**
 * exBring 不思議のダンジョン — 40F。道具を持ち込める。
 *
 * シリーズでは「もっと」が付くと持ち込み不可・Lv1 スタートを意味するので、
 * 持ち込める側は「不思議のダンジョン」として別に置く。
 * 拾った物で何とかする即興の遊び（もっと不思議）と、
 * 何を貯めて何を持ち込むかの準備の遊びは別物なので、片方に寄せない。
 *
 * 中身は ex と同じ表を 40F ぶん使う。倉庫・銀行・保持枠・加護の出口。
 */
const EX_BRING = {
    ...EX,
    id: 'exBring',
    name: '不思議のダンジョン',
    subtitle: '持ち込み可・40 階',
    desc: '道具を持ち込める 40 階。レベルも持ち越す。\n'
        + '倉庫に貯めた物を、どこまで持っていくかを決める場所。\n'
        + '生きて帰れば、拾った物は持ち帰れる。',
    depth: 40,
    allowBring: true,
    resetLevel: false,
    allowAlly: true,
    allowBoosts: true,
    requires: 'dl',
    // ボスは置かない。最深部の階段を降りれば踏破
    bosses: [],
    // 40F までしか無いので、それより深い階の出現表は落とす。
    // 残しておくと「この階には出ないはずの敵」がデータ上は居ることになり、
    // バランスの検査が実態とずれる
    monsters: EX.monsters.filter((e) => e.from <= 40),
    items: EX.items.filter((e) => e.from <= 40),
    traps: EX.traps.filter((e) => e.from <= 40),
};
/**
 * exPure 真・もっと不思議のダンジョン — 99F。村で得た加護が一切効かない。
 *
 * 中身は ex とまったく同じ。違うのは「相棒も加護も連れて行けない」ことだけ。
 * ガチャで強くなった人と、素の腕で潜りたい人の両方に居場所を作る。
 */
const EX_PURE = {
    ...EX,
    id: 'exPure',
    name: '真・もっと不思議のダンジョン',
    subtitle: '加護なし・99 階',
    desc: 'レベル 1 から始まり、道具は持ち込めない。\n'
        + 'ガチャの加護・相棒・保持枠は すべて無効。\n'
        + '拾った物だけで 99 階を目指す。',
    allowAlly: false,
    allowBoosts: false,
    requires: 'ex',
};
export const DUNGEONS = [D1, D2, D3, D4, DL, EX_BRING, EX, EX_PURE];
/**
 * 風の村の貸し出し装備。
 *
 * 武器か盾を持たずに出発しようとしたとき、村が貸してくれるもの。
 * どのダンジョンでも Lv1・HP15 から始まる仕様なので、これが無いと
 * 「一度死んで身ぐるみを失うと、もう深いダンジョンへ戻れない」
 * という詰みが起きる。自前の装備の方が必ず強いので、
 * 倉庫を育てる意味は失われない。
 */
export const LOANER_GEAR = {
    d1: { weapon: 'woodStick', shield: 'woodShield' },
    d2: { weapon: 'oakClub', shield: 'leatherShield' },
    d3: { weapon: 'bronzeSword', shield: 'bronzeShield' },
    d4: { weapon: 'ironSword', shield: 'ironShield' },
    dl: { weapon: 'steelSword', shield: 'steelShield' },
    exBring: { weapon: 'steelSword', shield: 'steelShield' },
    // もっと不思議のダンジョンは何も持ち込めない
    ex: null,
    exPure: null,
};
/** 物語の順路（村のダンジョン選択に出る順） */
export const DUNGEON_ORDER = ['d1', 'd2', 'd3', 'd4', 'dl', 'exBring', 'ex', 'exPure'];
/** 最初から入れるダンジョン */
export const INITIAL_UNLOCKED = ['d1'];
//# sourceMappingURL=dungeons.js.map