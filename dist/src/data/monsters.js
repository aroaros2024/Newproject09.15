/**
 * モンスター定義。
 *
 * 系統（family）ごとに tier 0 から並べ、evolveTo で次の段階へ繋ぐ。
 * 「成長の杖」や経験値による成長はこの鎖をたどる。
 *
 * ai は有限個の AiKind、特技は SkillId（game/monsterSkills.ts のハンドラ表のキー）。
 * 個別のクラスは作らず、この表の組み合わせだけで挙動を表現する。
 */
let chain = [];
const m = (id, name, family, tier, level, hp, atk, def, exp, desc, o = {}) => {
    chain.push(id);
    return {
        id, name, family, tier, evolveTo: null,
        level, hp, atk, def, exp,
        moveType: o.move ?? 'ground',
        speed: o.speed ?? 'normal',
        ai: o.ai ?? 'chase',
        skills: o.skills ?? [],
        skillRate: o.rate ?? 0,
        drop: o.drop ?? null,
        gitan: o.gitan ?? 0,
        sprite: o.sprite ?? family,
        keenSense: o.keen,
        sleepRate: o.sleep,
        isBoss: o.boss,
        recruitable: o.recruit,
        evade: o.evade,
        critRate: o.crit,
        metal: o.metal,
        desc,
    };
};
const RAW = [
    // ===================================================== 序盤の基本系統
    // プルン系: 分裂して数を増やす
    m('slimeBlue', 'あおプルン', 'slime', 0, 1, 12, 6, 1, 4, 'ぷるぷるした生き物。叩くと分裂することがある。', { skills: ['split'], rate: 15, drop: { itemId: 'healHerb', rate: 4 } }),
    m('slimeGreen', 'みどりプルン', 'slime', 1, 2, 30, 12, 2, 22, '毒を含んだプルン。触れるとちからが下がる。', { skills: ['split', 'poisonTouch'], rate: 22, drop: { itemId: 'poisonHerb', rate: 6 } }),
    m('slimeBlack', 'くろプルン', 'slime', 2, 3, 62, 26, 6, 150, '猛毒を持つプルン。分裂も早い。', { skills: ['split', 'deadlyPoisonTouch'], rate: 25, drop: { itemId: 'antidoteHerb', rate: 6 } }),
    m('slimeKing', 'プルンの王', 'slime', 3, 4, 140, 52, 11, 900, 'プルンたちの王。傷を癒やしながら分かれていく。', { skills: ['split', 'healSelf'], rate: 28, drop: { itemId: 'greatHerb', rate: 10 } }),
    // ネズミ系: 素直な追尾。強さの基準
    m('ratField', 'のらネズミ', 'rat', 0, 1, 9, 5, 0, 3, 'どこにでもいるネズミ。まっすぐ向かってくる。', { drop: { itemId: 'riceBall', rate: 4 } }),
    m('ratMud', 'どろネズミ', 'rat', 1, 2, 20, 11, 2, 18, '泥にまみれたネズミ。二度続けて噛みつく。', { skills: ['doubleAttack'], rate: 20, drop: { itemId: 'riceBall', rate: 5 } }),
    m('ratGiant', 'オオネズミ', 'rat', 2, 3, 35, 16, 4, 130, '人ほどもあるネズミ。素早く、食料を食い荒らす。', { speed: 'double', skills: ['eatFood'], rate: 20, drop: { itemId: 'bigRiceBall', rate: 6 } }),
    m('ratKing', 'ネズミの長', 'rat', 3, 4, 74, 31, 8, 810, '群れを率いる老ネズミ。仲間を呼ぶ。', { speed: 'double', skills: ['summonAlly', 'eatFood'], rate: 25, drop: { itemId: 'hugeRiceBall', rate: 8 } }),
    // コウモリ系: ふらふら飛ぶので狙いにくい
    m('batCave', 'どうくつコウモリ', 'bat', 0, 1, 10, 6, 1, 6, '洞窟に住むコウモリ。気まぐれに飛び回る。', { move: 'fly', ai: 'wander', evade: 0.1 }),
    m('batBlood', 'きゅうけつコウモリ', 'bat', 1, 2, 26, 13, 3, 48, '血を吸って自分の傷を治す。', { move: 'fly', ai: 'wander', evade: 0.1, skills: ['drainHp'], rate: 35,
        drop: { itemId: 'healHerb', rate: 5 } }),
    m('batMad', 'げんわくコウモリ', 'bat', 2, 3, 45, 22, 5, 200, '羽ばたきの音を聞くと頭がくらくらする。', { move: 'fly', ai: 'wander', evade: 0.15, skills: ['confuseTouch'], rate: 30,
        drop: { itemId: 'confuseHerb', rate: 6 } }),
    m('batAbyss', 'やみのコウモリ', 'bat', 3, 4, 100, 45, 10, 1400, '闇そのもののようなコウモリ。目を潰しにくる。', { move: 'fly', ai: 'wander', speed: 'double', evade: 0.2,
        skills: ['blindTouch', 'drainHp'], rate: 35, drop: { itemId: 'eyeHerb', rate: 7 } }),
    // 草系: 置物。近づかなければ無害
    m('plantDoze', 'ねむりそう', 'plant', 0, 1, 16, 8, 1, 10, '部屋の隅に生えている草。近づくと眠りの胞子を飛ばす。', { ai: 'ambush', skills: ['gazeSleep'], rate: 20, drop: { itemId: 'sleepHerb', rate: 8 } }),
    m('plantPoison', 'どくそう', 'plant', 1, 2, 30, 12, 3, 66, '毒の胞子を飛ばす草。動かない。', { ai: 'ambush', skills: ['gazePoison'], rate: 25, drop: { itemId: 'poisonHerb', rate: 8 } }),
    m('plantDeadly', 'もうどくそう', 'plant', 2, 3, 62, 24, 7, 430, '触れずとも猛毒を浴びせてくる。', { ai: 'ambush', skills: ['gazeDeadlyPoison'], rate: 25, drop: { itemId: 'poisonHerb', rate: 10 } }),
    // キノコ系: 増殖する
    m('mushSpore', 'ほうしタケ', 'mush', 0, 1, 16, 10, 2, 12, '胞子を飛ばして仲間を増やす。', { ai: 'wander', skills: ['multiply'], rate: 12, drop: { itemId: 'healHerb', rate: 5 } }),
    m('mushMad', 'まどわしタケ', 'mush', 1, 2, 32, 19, 5, 62, '見ていると頭がぼんやりしてくるキノコ。', { ai: 'wander', skills: ['multiply', 'confuseTouch'], rate: 25,
        drop: { itemId: 'confuseHerb', rate: 6 } }),
    m('mushDeadly', 'もうどくタケ', 'mush', 2, 3, 62, 36, 8, 330, '猛毒の胞子をまき散らしながら増えていく。', { ai: 'wander', skills: ['multiply', 'deadlyPoisonTouch'], rate: 25,
        drop: { itemId: 'poisonHerb', rate: 8 } }),
    // ===================================================== 盗む系統
    m('birdPick', 'ぬすっとドリ', 'thiefbird', 0, 1, 15, 7, 2, 53, '持ち物をかすめ取って逃げていく鳥。', { move: 'fly', ai: 'thief', evade: 0.15, skills: ['stealItem'], rate: 100 }),
    m('birdRob', 'かっぱらいドリ', 'thiefbird', 1, 2, 31, 13, 5, 300, '盗んだ瞬間に倍の速さで飛び去る。', { move: 'fly', ai: 'thief', speed: 'double', evade: 0.2, skills: ['stealItem'], rate: 100 }),
    m('birdGrand', 'だいとうぞくドリ', 'thiefbird', 2, 3, 59, 24, 9, 1390, '装備さえも奪っていく大盗賊。', { move: 'fly', ai: 'thief', speed: 'double', evade: 0.25,
        skills: ['stealEquip', 'stealItem'], rate: 100 }),
    m('coinSmall', 'ゼニドロ', 'coin', 0, 1, 14, 6, 3, 30, 'ギタンを盗んで逃げる小鬼。', { ai: 'thief', skills: ['stealGitan'], rate: 100, gitan: 120 }),
    m('coinBig', 'オオゼニドロ', 'coin', 1, 2, 30, 14, 6, 190, '大金をくわえて走り去る。', { ai: 'thief', speed: 'double', skills: ['stealGitan'], rate: 100, gitan: 400 }),
    m('coinKing', 'ゼニの王', 'coin', 2, 3, 58, 26, 10, 980, '全身がギタンでできているという鬼。', { ai: 'thief', speed: 'double', skills: ['stealGitan'], rate: 100, gitan: 1500 }),
    // ===================================================== 遠距離系統
    m('archerPebble', 'つぶて鬼', 'archer', 0, 2, 22, 9, 3, 26, '離れた所から石を投げてくる。', { ai: 'ranged', skills: ['throwStone'], rate: 60, drop: { itemId: 'stone', rate: 20 } }),
    m('archerRock', 'いし投げ鬼', 'archer', 1, 3, 42, 18, 6, 170, '大きな石を的確に投げつけてくる。', { ai: 'ranged', skills: ['throwStone'], rate: 70, drop: { itemId: 'stone', rate: 25 } }),
    m('archerBoulder', 'がんせき鬼', 'archer', 2, 4, 84, 38, 12, 1020, '岩を放って部屋の端から端まで届かせる。', { ai: 'ranged', skills: ['throwBoulder'], rate: 75, drop: { itemId: 'bombStone', rate: 12 } }),
    m('mageNovice', '見習い術士', 'mage', 0, 2, 20, 8, 3, 34, 'おぼつかない手つきで魔法を撃ってくる。', { ai: 'ranged', skills: ['magicSleep'], rate: 45, drop: { itemId: 'sleepStaff', rate: 5 } }),
    m('mageAdept', '術士', 'mage', 1, 3, 40, 17, 6, 210, '混乱の魔法を操る術士。', { ai: 'ranged', skills: ['magicConfuse', 'magicSleep'], rate: 55,
        drop: { itemId: 'confuseStaff', rate: 6 } }),
    m('mageArch', '大術士', 'mage', 2, 4, 78, 35, 11, 1150, 'かなしばりと鈍足を自在に使う。', { ai: 'ranged', skills: ['magicBind', 'magicSlow'], rate: 60,
        drop: { itemId: 'bindStaff', rate: 7 } }),
    m('sealerSmall', 'ふうじ', 'sealer', 0, 3, 38, 16, 7, 190, '印と腕輪の力を封じてしまう。', { skills: ['sealPlayer'], rate: 35, drop: { itemId: 'sealScroll', rate: 8 } }),
    m('sealerGreat', 'だいふうじ', 'sealer', 1, 4, 76, 34, 12, 1080, 'あらゆる力を封じ込める。', { speed: 'double', skills: ['sealPlayer'], rate: 45, drop: { itemId: 'sealScroll', rate: 10 } }),
    // ===================================================== 妨害系統
    m('ghostPale', 'おばけ', 'ghost', 0, 2, 24, 11, 4, 40, '壁をすり抜けて近づいてくる。', { move: 'phase', evade: 0.1, drop: { itemId: 'warpScroll', rate: 5 } }),
    m('ghostGrudge', 'うらみおばけ', 'ghost', 1, 3, 48, 22, 8, 250, '恨みの念で相手を縛りつける。', { move: 'phase', evade: 0.15, skills: ['bindTouch'], rate: 30,
        drop: { itemId: 'paralyzeHerb', rate: 6 } }),
    m('ghostReaper', 'しにがみ', 'ghost', 2, 4, 96, 44, 14, 1560, '触れられると気が遠くなる。', { move: 'phase', evade: 0.2, speed: 'double', skills: ['faintTouch', 'bindTouch'],
        rate: 35, drop: { itemId: 'holyShield', rate: 3 } }),
    m('drainLesser', 'すいとり', 'drain', 0, 3, 36, 15, 6, 210, '経験を吸い取ってレベルを下げる。', { skills: ['levelDrain'], rate: 25, drop: { itemId: 'blessHerb', rate: 4 } }),
    m('drainGreater', 'だいすいとり', 'drain', 1, 4, 72, 33, 11, 1240, '一度に大きく経験を奪う。', { speed: 'double', skills: ['levelDrain'], rate: 30, drop: { itemId: 'blessHerb', rate: 6 } }),
    m('rustBug', 'サビ虫', 'rust', 0, 2, 26, 10, 5, 60, '金属を錆びさせる虫。武器が弱っていく。', { skills: ['rustWeapon'], rate: 35, drop: { itemId: 'rustproofShield', rate: 3 } }),
    m('rustWyrm', 'サビ竜', 'rust', 1, 4, 80, 34, 12, 1180, '吐く息で装備が一気に錆びつく。', { skills: ['rustWeapon', 'rustShield'], rate: 45, drop: { itemId: 'rustproofShield', rate: 5 } }),
    m('cursedMask', 'のろい面', 'curse', 0, 3, 40, 18, 8, 260, '持ち物を呪ってくる面。', { skills: ['curseItem'], rate: 30, drop: { itemId: 'uncurseScroll', rate: 8 } }),
    m('cursedMaskGreat', 'だいのろい面', 'curse', 1, 4, 86, 40, 13, 1420, '装備ごと呪って外せなくする。', { speed: 'double', skills: ['curseEquip', 'curseItem'], rate: 40,
        drop: { itemId: 'uncurseScroll', rate: 10 } }),
    m('mimicPot', 'ばけつぼ', 'mimic', 0, 3, 44, 20, 8, 240, '壺に化けて待ち伏せている。', { ai: 'mimic', skills: ['swallowItem'], rate: 40, drop: { itemId: 'storagePot', rate: 15 } }),
    m('mimicScroll', 'ばけまきもの', 'mimic', 1, 4, 88, 42, 13, 1480, '巻物に化けて、拾おうとした相手を襲う。', { ai: 'mimic', skills: ['swallowItem', 'sealPlayer'], rate: 45,
        drop: { itemId: 'blankScroll', rate: 12 } }),
    m('shadowClone', 'かげぼうし', 'shadow', 0, 3, 38, 20, 7, 280, '自分の分身を作り出す。', { skills: ['cloneSelf'], rate: 25, evade: 0.1 }),
    m('shadowLord', 'かげのぬし', 'shadow', 1, 4, 82, 42, 12, 1520, '見分けのつかない分身を次々に生む。', { speed: 'double', skills: ['cloneSelf'], rate: 30, evade: 0.15 }),
    m('tripStick', 'ころばし棒', 'trip', 0, 2, 24, 9, 4, 55, '足元をすくって持ち物をばらまかせる。', { skills: ['tripPlayer'], rate: 35 }),
    m('tripPole', 'おおころばし', 'trip', 1, 3, 50, 20, 8, 340, '大きく足を払って装備まで落とさせる。', { skills: ['tripPlayer'], rate: 45 }),
    // ===================================================== 戦士系統
    m('armorWood', '木偶武者', 'armor', 0, 2, 30, 14, 6, 50, '木でできた人形の武者。硬い。', { drop: { itemId: 'woodShield', rate: 6 } }),
    m('armorIron', '鉄武者', 'armor', 1, 3, 58, 26, 12, 300, '鉄の鎧をまとった武者。守りが堅い。', { drop: { itemId: 'ironShield', rate: 6 } }),
    m('armorBlack', '黒武者', 'armor', 2, 4, 90, 44, 14, 1680, '黒塗りの鎧を着た手練れ。二度斬りかかってくる。', { speed: 'doubleAttack', skills: ['doubleAttack'], rate: 30,
        drop: { itemId: 'steelShield', rate: 6 } }),
    m('armorTenrin', '天輪の衛士', 'armor', 3, 5, 110, 76, 16, 4800, '塔を守る衛士。隙がない。', { speed: 'doubleAttack', skills: ['doubleAttack', 'healSelf'], rate: 35,
        drop: { itemId: 'steelSword', rate: 8 } }),
    m('ogreRed', 'あかおに', 'ogre', 0, 3, 54, 28, 8, 290, '力任せに殴りつけてくる鬼。', { crit: 1 / 16, drop: { itemId: 'oakClub', rate: 6 } }),
    m('ogreBlue', 'あおおに', 'ogre', 1, 4, 104, 48, 14, 1600, '一撃が重い。痛恨の一撃に注意。', { crit: 1 / 12, skills: ['knockbackHit'], rate: 25, drop: { itemId: 'warHammer', rate: 5 } }),
    m('ogreKing', 'おにの大将', 'ogre', 2, 5, 110, 72, 14, 4400, '鬼たちを従える大将。', { crit: 1 / 10, skills: ['knockbackHit', 'summonAlly'], rate: 30,
        drop: { itemId: 'twinAxe', rate: 6 } }),
    // ===================================================== 属性系統
    m('lizardFire', 'ひとかげトカゲ', 'dragon', 0, 3, 48, 24, 9, 270, '小さな火を吐くトカゲ。', { move: 'lava', skills: ['breatheFire'], rate: 30, drop: { itemId: 'flameHerb', rate: 6 } }),
    m('dragonFlame', 'ほのおドラゴン', 'dragon', 1, 4, 90, 46, 12, 1740, '広い範囲を焼き払う炎を吐く。', { move: 'lava', skills: ['breatheFire'], rate: 35, drop: { itemId: 'flameSword', rate: 4 } }),
    m('dragonInferno', 'しゃくねつドラゴン', 'dragon', 2, 5, 120, 78, 15, 5200, '灼熱の息で一直線に焼き尽くす。', { move: 'lava', speed: 'double', skills: ['breatheInferno'], rate: 40,
        drop: { itemId: 'dragonScale', rate: 5 } }),
    m('fishSmall', 'こざかな', 'fish', 0, 1, 14, 7, 2, 14, '水の中を泳ぐ魚。陸には上がれない。', { move: 'water', drop: { itemId: 'riceBall', rate: 4 } }),
    m('eelGiant', 'おおうなぎ', 'fish', 1, 3, 46, 22, 7, 260, '水中から急に噛みついてくる。', { move: 'water', skills: ['dragIntoWater'], rate: 30 }),
    m('waterDragon', 'みずりゅう', 'fish', 2, 4, 108, 48, 14, 1660, '水を操る竜。水流で押し流してくる。', { move: 'water', skills: ['waterJet'], rate: 35, drop: { itemId: 'waterShield', rate: 5 } }),
    m('frogTree', 'アマガエル', 'frog', 0, 2, 22, 10, 4, 32, '跳ねて近づいてくるカエル。', { move: 'water', skills: ['leapAttack'], rate: 25 }),
    m('frogGiant', 'デカガエル', 'frog', 1, 3, 48, 22, 8, 300, '丸呑みにして持ち物を奪う。', { move: 'water', skills: ['swallowItem'], rate: 30 }),
    // ===================================================== 特殊系統
    m('metalBug', 'はがねムシ', 'metal', 0, 3, 8, 14, 30, 700, '鋼のように硬い虫。ほとんどダメージが通らない。', { metal: true, ai: 'coward', evade: 0.2, drop: { itemId: 'ironShield', rate: 8 } }),
    m('metalKing', 'メタルムシの王', 'metal', 1, 5, 12, 30, 50, 8000, '倒せれば莫大な経験値になるが、まず当たらない。', { metal: true, ai: 'flee', speed: 'double', evade: 0.35,
        drop: { itemId: 'steelShield', rate: 10 } }),
    m('bombSlime', 'ボムプルン', 'bomb', 0, 3, 30, 5, 5, 160, '倒すと爆発する。近くで倒さないこと。', { skills: ['explodeOnDeath'], rate: 100, drop: { itemId: 'bombStone', rate: 10 } }),
    m('bombGiant', 'だいばくはつプルン', 'bomb', 1, 4, 60, 8, 9, 900, '爆発の範囲が広い。', { skills: ['explodeOnDeath'], rate: 100, drop: { itemId: 'bombStone', rate: 15 } }),
    m('eyeGaze', 'にらみ玉', 'eye', 0, 3, 34, 16, 6, 230, '目が合うと動けなくなる。', { ai: 'ambush', skills: ['gazeBind'], rate: 35, drop: { itemId: 'sightBracelet', rate: 3 } }),
    m('eyeAbyss', 'しんえんの目', 'eye', 1, 5, 96, 46, 16, 3400, '見つめられると意識が遠のく。', { ai: 'ambush', skills: ['gazeFaint', 'gazeBind'], rate: 40,
        drop: { itemId: 'awakeBracelet', rate: 4 } }),
    m('polterPot', 'おどりつぼ', 'poltergeist', 0, 4, 70, 30, 12, 980, '持ち物を勝手に使ってくる。', { skills: ['useItemOnPlayer'], rate: 35, drop: { itemId: 'storagePot', rate: 10 } }),
    m('polterLord', 'おどりのぬし', 'poltergeist', 1, 5, 115, 60, 13, 3800, '持ち物を投げつけ、壺を割っていく。', { speed: 'double', skills: ['useItemOnPlayer'], rate: 45,
        drop: { itemId: 'unbreakablePot', rate: 8 } }),
    m('abyssWatcher', 'ふちのみはり', 'abyss', 0, 6, 100, 66, 14, 5600, 'もっと不思議のダンジョンの深層を徘徊する者。', { speed: 'double', skills: ['sealPlayer', 'levelDrain'], rate: 40 }),
    m('abyssDevourer', 'ふちのくらうもの', 'abyss', 1, 7, 125, 88, 16, 12000, '装備も持ち物も飲み込んでいく。', { speed: 'double', skills: ['swallowItem', 'curseEquip'], rate: 45 }),
    m('abyssSovereign', 'ふちのあるじ', 'abyss', 2, 8, 150, 110, 18, 26000, '底の底に棲むという存在。出会ったら逃げるほかない。', { speed: 'double', skills: ['breatheInferno', 'levelDrain', 'summonAlly'], rate: 50 }),
    // ===================================================== 店主・番犬
    m('shopkeeper', '店主', 'shop', 0, 10, 220, 80, 20, 0, '店を営む商人。怒らせると恐ろしい。', { ai: 'guard', speed: 'double', crit: 1 / 8, sprite: 'shopkeeper' }),
    m('shopGuard', '店の番犬', 'shop', 1, 8, 130, 64, 16, 0, '泥棒を追いかけてくる番犬。', { speed: 'double', sprite: 'shopGuard' }),
    // ===================================================== ボス
    m('bossForest', '森の主 オオヤマネコ', 'boss', 0, 6, 150, 18, 8, 2000, 'せせらぎの森の奥に棲む大山猫。素早い爪さばきで襲いかかる。', { ai: 'boss', speed: 'double', boss: true, skills: ['doubleAttack', 'leapAttack'],
        rate: 40, sprite: 'bossForest' }),
    m('bossVolcano', '火口の番人 イワオニ', 'boss', 1, 9, 230, 60, 9, 6000, '灼熱の火山の火口を守る岩の鬼。溶岩を投げつけてくる。', { ai: 'boss', move: 'lava', boss: true, skills: ['breatheFire', 'throwBoulder', 'summonAlly'],
        rate: 45, sprite: 'bossVolcano' }),
    m('bossWaterway', '水路の淀み ヌシ', 'boss', 2, 12, 230, 48, 10, 14000, '常闇の地下水路に沈む巨大な影。水と闇を操る。', { ai: 'boss', move: 'water', boss: true, speed: 'double',
        skills: ['waterJet', 'blindTouch', 'summonAlly'], rate: 50, sprite: 'bossWaterway' }),
    m('bossTowerFirst', '天輪の守り手', 'boss', 3, 15, 140, 42, 10, 30000, '天輪の塔の頂で待つ者。まだ本気ではない。', { ai: 'boss', boss: true, speed: 'double',
        skills: ['doubleAttack', 'magicBind', 'summonAlly'], rate: 50, sprite: 'bossTower' }),
    m('bossTowerFinal', '天輪の主 カゼノヌシ', 'boss', 4, 20, 170, 48, 11, 80000, '風そのものが形をとった姿。すべての風来人の行き着く先。', { ai: 'boss', boss: true, speed: 'double',
        skills: ['breatheInferno', 'levelDrain', 'magicBind', 'summonAlly'],
        rate: 60, sprite: 'bossTowerFinal' }),
    m('bossAbyss', 'もっと不思議の果て', 'boss', 5, 25, 300, 120, 13, 200000, '99 階の最奥に在るもの。名前を持たない。', { ai: 'boss', boss: true, speed: 'double',
        skills: ['breatheInferno', 'levelDrain', 'curseEquip', 'summonAlly'],
        rate: 65, sprite: 'bossAbyss' }),
];
// 系統ごとに tier 昇順で evolveTo を繋ぐ
const byFamily = new Map();
for (const d of RAW) {
    const list = byFamily.get(d.family);
    if (list)
        list.push(d);
    else
        byFamily.set(d.family, [d]);
}
for (const list of byFamily.values()) {
    list.sort((a, b) => a.tier - b.tier);
    for (let i = 0; i < list.length; i++) {
        // ボス・店主は成長の鎖に乗せない
        list[i].evolveTo = list[i].isBoss || list[i].family === 'shop'
            ? null
            : (list[i + 1]?.id ?? null);
    }
}
chain = [];
export const MONSTERS = RAW;
/** 系統の 1 つ下の段階を返す（レベルダウンの杖用） */
export function devolveOf(id) {
    const def = MONSTERS.find((m2) => m2.id === id);
    if (!def)
        return null;
    const list = byFamily.get(def.family) ?? [];
    const idx = list.findIndex((m2) => m2.id === id);
    return idx > 0 ? list[idx - 1].id : null;
}
//# sourceMappingURL=monsters.js.map