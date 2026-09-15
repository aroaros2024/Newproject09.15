/**
 * 武器と盾の定義。
 *
 * atk / def は基本値。修正値（+N）と印で伸びる。
 * slots は印を埋められる数、innate は最初から付いている印。
 * weight は自然出現の重み（0 なら宝箱やボス報酬でしか出ない）。
 */
const w = (id, name, atk, slots, price, weight, desc, innate = [], sprite = 'weapon') => ({
    id, kind: 'weapon', name, desc, price, weight, sprite,
    atk, slots, innate, throwPower: Math.floor(atk * 0.6),
});
const s = (id, name, def, slots, price, weight, desc, innate = [], sprite = 'shield') => ({
    id, kind: 'shield', name, desc, price, weight, sprite,
    def, slots, innate, throwPower: Math.floor(def * 0.6),
});
export const WEAPONS = [
    // --- 素の武器（攻撃力だけが取り柄。印を埋める土台になる） ---
    w('woodStick', '木の棒', 2, 1, 240, 100, 'どこにでも落ちている棒きれ。'),
    w('oakClub', '樫の棍棒', 4, 2, 600, 95, '硬い樫でできた棍棒。素直に強い。'),
    w('bronzeSword', '銅の剣', 6, 2, 1000, 85, '銅を鍛えた剣。切れ味はほどほど。'),
    w('ironSword', '鉄の剣', 9, 3, 1800, 70, 'standard な鉄の剣。印を 3 つ埋められる。'),
    w('steelSword', '鋼の剣', 12, 3, 3200, 45, 'よく鍛えられた鋼の剣。'),
    w('twinAxe', '両刃の斧', 16, 2, 5000, 25, '重い斧。振りは鈍いが一撃が重い。'),
    w('greatSword', '蒼天の大剣', 19, 4, 9000, 12, '空の色をした大剣。持つだけで腕が鳴る。'),
    w('rustedSword', '錆びた剣', 5, 2, 400, 40, '赤く錆びた剣。見た目ほど悪くはない。'),
    w('bambooSpear', '竹の槍', 7, 2, 1400, 60, '間合いは長いが、脆い。'),
    w('warHammer', '戦鎚', 14, 2, 4200, 28, 'ずしりと重い鎚。'),
    // --- 印つきの武器 ---
    w('windBlade', '風斬りの刃', 10, 4, 5000, 30, '振ると風が鳴る。腹が減りにくい。', ['swift']),
    w('flameSword', '炎髪の剣', 11, 3, 5600, 26, '刃が常に赤熱している。', ['flame']),
    w('thunderBlade', '雷鳴刀', 11, 3, 5600, 26, '抜くと遠くで雷が鳴る。', ['thunder']),
    w('dragonFang', '竜牙の剣', 13, 3, 7000, 16, '竜の牙を削り出した剣。', ['slayDragon']),
    w('exorcistStaff', '退魔の錫杖', 9, 4, 6000, 18, '霊を祓うために作られた杖。', ['slayGhost']),
    w('metalCleaver', '鋼断ちの鉈', 10, 2, 5000, 16, '硬い物ほどよく斬れる。', ['slayMetal']),
    w('vampireFang', '吸血鬼の牙', 8, 3, 5200, 18, '斬るたびに傷が塞がっていく。', ['drain']),
    w('viperDagger', '毒蛇の短剣', 7, 3, 4000, 24, '刃に毒が塗られている。', ['poisonHit']),
    w('lullabyBlade', '眠り月の刀', 8, 3, 4400, 22, '斬られると眠くなる。', ['sleepHit']),
    w('chaosEdge', '惑いの刃', 8, 3, 4400, 22, '斬られた者は自分を見失う。', ['confuseHit']),
    w('heavyBlade', '重打ちの大剣', 15, 4, 7600, 14, '重すぎて腹が減る。', ['heavy']),
    w('pickaxe', '掘削のつるはし', 3, 2, 2600, 26, '壁を掘り進める。振ると壁が崩れる。'),
    w('woodHammer', '木づち', 5, 2, 1800, 34, '殴った相手を吹き飛ばす。'),
    w('boomerang', '回帰のブーメラン', 6, 2, 2800, 24, '投げると戻ってくる。'),
    w('hunterBow', '狩人の弓', 5, 3, 3000, 22, '離れた敵を射抜ける。'),
    w('piercer', '射抜きの剣', 9, 2, 4800, 18, '必ず当たるが、会心は出ない。', ['sure']),
    w('smithBlade', '匠の刀', 10, 3, 6400, 12, '印をもう 1 つ埋められる。', ['smith']),
    w('saplingSword', '若木の剣', 5, 3, 3600, 18, '敵を倒すたびに育っていく。', ['growth']),
    w('miserHammer', '守銭鎚', 8, 3, 4000, 18, '倒した敵からギタンをかき集める。', ['gitanHit']),
    w('flashBlade', '一閃', 10, 3, 6000, 14, '会心の一撃が出やすい。', ['crit']),
    w('twinFang', '連撃の双刃', 8, 3, 5400, 16, '一度の攻撃で二度斬ることがある。', ['combo']),
    w('crusher', '砕きの戦鎚', 14, 2, 6600, 12, '鎧ごと叩き潰す。', ['crush']),
    // --- 最強クラス（天輪の塔・もっと不思議でのみ） ---
    w('tenrinSword', '天輪の剣', 25, 6, 30000, 0, '塔の頂に眠る剣。印を 6 つ埋められる。'),
    w('abyssFang', '深淵の牙', 22, 5, 26000, 0, '99 階の底で見つかるという牙。', ['drain']),
];
export const SHIELDS = [
    s('woodShield', '木の盾', 2, 1, 240, 100, '板きれを縛っただけの盾。'),
    s('leatherShield', '皮の盾', 4, 2, 600, 92, 'なめし革を張った軽い盾。'),
    s('bronzeShield', '青銅の盾', 6, 2, 1100, 80, '青銅でできた頑丈な盾。'),
    s('ironShield', '鉄の盾', 8, 2, 1900, 65, '重いが確かな守り。'),
    s('steelShield', '鋼の盾', 11, 3, 3400, 42, '鋼を重ねた盾。'),
    s('heavyShield', '重装の盾', 15, 2, 5200, 22, '非常に重い。動きが鈍る気さえする。'),
    s('stoneShield', '石の盾', 13, 1, 4000, 26, '岩を削り出した盾。印は埋めにくい。'),
    s('silverShield', '銀の盾', 10, 3, 3800, 30, '磨かれた銀の盾。錆びにくい。'),
    s('dragonScale', '龍鱗の盾', 17, 3, 8000, 10, '竜の鱗を並べた盾。炎に強い。', ['antiFire']),
    s('turtleShield', '亀甲の盾', 12, 3, 4600, 24, '亀の甲羅。じっくり守る。'),
    s('evadeShield', '見切りの盾', 5, 3, 4200, 24, '攻撃をひらりと避ける。', ['evade']),
    s('reflectShield', '返しの盾', 6, 3, 4600, 22, '受けた痛みを相手に返す。', ['reflect']),
    s('satietyShield', '腹持ちの盾', 5, 3, 4400, 24, '不思議と腹が減らない。', ['satiety']),
    s('rustproofShield', '錆よけの盾', 6, 3, 4000, 26, '装備が錆びなくなる。', ['antiRust']),
    s('guardShield', '護りの盾', 7, 2, 4400, 22, '盗賊を寄せ付けない。', ['antiSteal']),
    s('holyShield', '聖なる盾', 7, 3, 5200, 18, '状態異常から早く立ち直れる。', ['holy']),
    s('waterShield', '水流の盾', 8, 3, 5000, 18, '炎を受け流す。', ['antiFire']),
    s('trapShield', 'ワナ師の盾', 5, 3, 4600, 18, 'ワナを踏んでも作動しない。', ['antiTrap']),
    s('healShield', '治癒の盾', 6, 3, 4800, 18, '傷の治りが早くなる。', ['regenRune']),
    s('steadfastShield', '不屈の盾', 8, 2, 4800, 16, 'ちからを下げられなくなる。', ['guardStr']),
    s('immovableShield', '不動の盾', 8, 2, 4800, 16, 'レベルを下げられなくなる。', ['guardLevel']),
    s('damperShield', '減衰の大盾', 10, 3, 6000, 14, '受けるダメージを一定量減らす。', ['reduce']),
    s('smithShield', '匠の盾', 8, 3, 6400, 12, '印をもう 1 つ埋められる。', ['smith']),
    s('windShield', '風の盾', 7, 3, 4400, 20, '軽い。風をはらんで身を守る。'),
    s('phantomShield', '幽玄の盾', 9, 3, 5400, 14, 'ゴーストの攻撃を弱める。', ['holy']),
    s('sproutShield', '若葉の盾', 4, 3, 3400, 18, '守るほどに育っていく。', ['growth']),
    s('bluntShield', '鈍の盾', 9, 2, 1200, 14, '呪いの気配がする重い盾。', ['blunt']),
    s('tenrinShield', '天輪の盾', 22, 6, 30000, 0, '塔の頂に眠る盾。印を 6 つ埋められる。'),
    s('abyssShell', '深淵の殻', 20, 5, 26000, 0, '99 階の底で見つかるという殻。', ['reduce']),
];
//# sourceMappingURL=equipment.js.map