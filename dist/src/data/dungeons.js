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
    wall: '#3a2f26', wallTop: '#584639', floor: '#2b2620', floorAlt: '#332d25',
    corridor: '#221e19', liquid: '#2a4a5c', liquidAlt: '#356a80',
    gloom: '#0a0908', accent: '#c8a05a',
};
const THEME_FOREST = {
    wall: '#24402a', wallTop: '#3a6340', floor: '#1e2b20', floorAlt: '#253327',
    corridor: '#18211a', liquid: '#1f5a70', liquidAlt: '#2f86a4',
    gloom: '#060b07', accent: '#7fc47a',
};
const THEME_VOLCANO = {
    wall: '#43231c', wallTop: '#6d392a', floor: '#2e1d17', floorAlt: '#38241c',
    corridor: '#241512', liquid: '#8c2c10', liquidAlt: '#e0641a',
    gloom: '#0d0503', accent: '#e8843c',
};
const THEME_WATERWAY = {
    wall: '#1d2438', wallTop: '#2e3a58', floor: '#171c2a', floorAlt: '#1d2333',
    corridor: '#12161f', liquid: '#16324f', liquidAlt: '#245078',
    gloom: '#03040a', accent: '#6f8ed0',
};
const THEME_TOWER = {
    wall: '#3b3a46', wallTop: '#5e5c6e', floor: '#2b2b33', floorAlt: '#33333d',
    corridor: '#212027', liquid: '#3a4a70', liquidAlt: '#5a74a8',
    gloom: '#08080c', accent: '#e4d189',
};
const THEME_ABYSS = {
    wall: '#2a1c33', wallTop: '#452e52', floor: '#1d1524', floorAlt: '#241a2c',
    corridor: '#150f1a', liquid: '#2c1a45', liquidAlt: '#4a2a72',
    gloom: '#040206', accent: '#b57fe0',
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
        '持ち込みも持ち帰りも自由。倒れても持ち物は失わない。',
    depth: 5,
    allowBring: true,
    resetLevel: false,
    allowAlly: true,
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
        mob('ratMud', 2, 8, 120),
        mob('slimeBlue', 1, 4, 90),
        mob('slimeGreen', 4, 10, 110),
        mob('batCave', 1, 6, 110),
        mob('batBlood', 5, 10, 100),
        mob('plantDoze', 1, 6, 90),
        mob('plantPoison', 6, 10, 80),
        mob('mushSpore', 3, 10, 90),
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
        mob('slimeGreen', 1, 4, 70),
        mob('slimeBlack', 8, 15, 90),
        mob('ratGiant', 3, 12, 90),
        mob('batBlood', 1, 6, 90),
        mob('batMad', 6, 15, 90),
        mob('plantPoison', 1, 8, 80),
        mob('mushMad', 4, 15, 85),
        mob('birdRob', 6, 15, 65),
        mob('coinBig', 5, 15, 60),
        mob('archerRock', 4, 15, 80),
        mob('mageAdept', 6, 15, 70),
        mob('lizardFire', 1, 12, 100),
        mob('dragonFlame', 10, 15, 60),
        mob('rustBug', 3, 15, 70),
        mob('armorIron', 6, 15, 70),
        mob('ogreRed', 8, 15, 70),
        mob('bombSlime', 5, 15, 55),
        mob('metalBug', 7, 15, 25),
        mob('tripStick', 2, 12, 60),
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
        mob('slimeBlack', 1, 8, 80),
        mob('ratGiant', 1, 5, 70),
        mob('ratKing', 12, 20, 60),
        mob('batMad', 1, 8, 80),
        mob('batAbyss', 14, 20, 60),
        mob('plantDeadly', 4, 20, 70),
        mob('mushDeadly', 10, 20, 70),
        mob('birdRob', 1, 10, 60),
        mob('birdGrand', 12, 20, 50),
        mob('coinBig', 1, 10, 55),
        mob('coinKing', 12, 20, 45),
        mob('archerBoulder', 10, 20, 60),
        mob('mageAdept', 1, 10, 60),
        mob('mageArch', 12, 20, 55),
        mob('sealerSmall', 4, 20, 55),
        mob('ghostPale', 1, 12, 90),
        mob('ghostGrudge', 8, 20, 85),
        mob('drainLesser', 5, 20, 65),
        mob('rustWyrm', 14, 20, 45),
        mob('cursedMask', 6, 20, 60),
        mob('mimicPot', 5, 20, 50),
        mob('shadowClone', 8, 20, 55),
        mob('armorIron', 1, 10, 60),
        mob('armorBlack', 12, 20, 55),
        mob('eelGiant', 3, 20, 70),
        mob('waterDragon', 15, 20, 45),
        mob('frogGiant', 4, 20, 60),
        mob('eyeGaze', 7, 20, 55),
        mob('tripPole', 6, 20, 50),
        mob('metalBug', 1, 20, 22),
        mob('bombGiant', 12, 20, 40),
        mob('polterPot', 15, 20, 40),
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
        mob('slimeBlack', 1, 6, 60),
        mob('slimeKing', 18, 30, 50),
        mob('ratKing', 5, 16, 50),
        mob('batAbyss', 8, 24, 70),
        mob('plantDeadly', 1, 14, 55),
        mob('mushDeadly', 4, 20, 60),
        mob('birdGrand', 6, 26, 50),
        mob('coinKing', 8, 28, 45),
        mob('archerBoulder', 1, 20, 60),
        mob('mageArch', 4, 30, 60),
        mob('sealerSmall', 1, 12, 50),
        mob('sealerGreat', 14, 30, 50),
        mob('ghostGrudge', 1, 14, 60),
        mob('ghostReaper', 12, 30, 60),
        mob('drainLesser', 1, 12, 50),
        mob('drainGreater', 14, 30, 50),
        mob('rustWyrm', 6, 30, 45),
        mob('cursedMaskGreat', 12, 30, 50),
        mob('mimicScroll', 10, 30, 45),
        mob('shadowLord', 14, 30, 50),
        mob('armorBlack', 1, 18, 60),
        mob('armorTenrin', 16, 30, 55),
        mob('ogreBlue', 6, 24, 60),
        mob('ogreKing', 20, 30, 50),
        mob('dragonFlame', 4, 20, 55),
        mob('dragonInferno', 18, 30, 50),
        mob('waterDragon', 6, 26, 45),
        mob('eyeAbyss', 14, 30, 45),
        mob('metalKing', 10, 30, 12),
        mob('bombGiant', 5, 24, 40),
        mob('polterLord', 18, 30, 40),
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
    subtitle: '何も持ち込めず、何も持ち帰れない 99 階',
    desc: 'レベル 1 から始まり、道具は何ひとつ持ち込めない。倉庫も使えない。\n' +
        'すべてを拾い集め、99 階を目指す。風来人の本当の腕試し。',
    depth: 99,
    allowBring: false,
    resetLevel: true,
    allowAlly: false,
    requires: 'dl',
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
        mob('plantDoze', 1, 8, 70),
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
export const DUNGEONS = [D1, D2, D3, D4, DL, EX];
/** 物語の順路（村のダンジョン選択に出る順） */
export const DUNGEON_ORDER = ['d1', 'd2', 'd3', 'd4', 'dl', 'ex'];
/** 最初から入れるダンジョン */
export const INITIAL_UNLOCKED = ['d1'];
//# sourceMappingURL=dungeons.js.map