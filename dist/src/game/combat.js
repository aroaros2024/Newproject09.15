/**
 * 戦闘。攻撃力・防御力の算出、命中/会心判定、ダメージ適用、撃破、成長。
 *
 * ダメージ式は rules.ts に置いてある（純粋な計算）。
 * ここは「誰が誰を殴ると何が起きるか」を書く場所。
 */
import { step } from '../core/geom.js';
import { getItem } from '../data/registry.js';
import { BASE_HIT, BLIND_ACC_PENALTY, CRIT_RATE_CAP, CRIT_RUNE_STEP, EXP_TABLE, FAINT_DAMAGE_MUL, INVISIBLE_EVADE_BONUS, MAX_EXP, MAX_HP_CAP, MAX_LEVEL, METAL_DAMAGE_REDUCTION, MONSTER_CRIT_RATE, PLAYER_CRIT_RATE, calcDamage, hitRate, hpGainForLevel, } from './rules.js';
import { equipRuneLevel } from './runes.js';
import { equippedBracelet, equippedShield, equippedWeapon } from './inventory.js';
import { applyStatus, removeStatus, wakeOnDamage } from './status.js';
// ---------------------------------------------------------------------------
// 攻撃力・防御力
// ---------------------------------------------------------------------------
/** 腕輪の効果 id（封印・呪いを考慮） */
export function braceletEffect(world, p) {
    if (world.hasStatus(p, 'sealed'))
        return null;
    const b = equippedBracelet(p);
    if (!b)
        return null;
    const def = getItem(b.defId);
    if (def.kind !== 'bracelet')
        return null;
    return def.effect;
}
/** プレイヤーの攻撃力 = ちから + 武器の攻撃力 + 修正値 + 印 */
export function attackPower(world, a) {
    if (a.kind !== 'player') {
        const m = a;
        let atk = m.atk;
        if (world.hasStatus(m, 'strUp'))
            atk += world.getStatus(m, 'strUp')?.power ?? 0;
        return Math.max(0, Math.floor(atk));
    }
    const p = a;
    const weapon = equippedWeapon(p);
    const wp = weapon ? weaponPower(weapon) : 0;
    let str = p.str;
    const buff = world.getStatus(p, 'strUp');
    if (buff)
        str += buff.power;
    if (braceletEffect(world, p) === 'strBonus') {
        const b = equippedBracelet(p);
        str += b && b.cursed ? -3 : 3;
    }
    let atk = str + wp;
    atk += equipRuneLevel(weapon, 'heavy') * 2;
    return Math.max(0, Math.floor(atk));
}
/** 武器の攻撃力（基本値 + 修正値） */
export function weaponPower(item) {
    const def = getItem(item.defId);
    return def.kind === 'weapon' ? def.atk + item.plus : 0;
}
/** 盾の防御力（基本値 + 修正値） */
export function shieldPower(item) {
    const def = getItem(item.defId);
    return def.kind === 'shield' ? def.def + item.plus : 0;
}
/** 防御力 */
export function defensePower(world, a) {
    if (a.kind !== 'player')
        return Math.max(0, Math.floor(a.def));
    const p = a;
    const shield = equippedShield(p);
    let def = shield ? shieldPower(shield) : 0;
    if (braceletEffect(world, p) === 'defBonus') {
        const b = equippedBracelet(p);
        def += b && b.cursed ? -3 : 3;
    }
    return Math.max(0, Math.floor(def));
}
/** 回避率 */
function evadeRate(world, a) {
    let evade = a.kind === 'player' ? 0 : (world.defOf(a).evade ?? 0);
    if (world.hasStatus(a, 'invisible'))
        evade += INVISIBLE_EVADE_BONUS;
    if (a.kind === 'player') {
        const shield = equippedShield(world.player);
        evade += equipRuneLevel(shield, 'evade') * 0.12;
    }
    return Math.min(0.95, evade);
}
/** 命中補正 */
function accuracyBonus(world, a) {
    let bonus = 0;
    if (world.hasStatus(a, 'blind'))
        bonus += BLIND_ACC_PENALTY;
    if (a.kind === 'player') {
        const weapon = equippedWeapon(world.player);
        if (equipRuneLevel(weapon, 'sure') > 0)
            bonus += 1;
        if (braceletEffect(world, world.player) === 'sureHit')
            bonus += 1;
        if (weapon && weapon.cursed)
            bonus -= 0.05;
    }
    return bonus;
}
/** 会心（痛恨）率 */
function critRate(world, a) {
    if (a.kind !== 'player') {
        let r = world.defOf(a).critRate ?? MONSTER_CRIT_RATE;
        // 呪われた痛恨の腕輪を着けていると、相手の痛恨が出やすくなる
        if (braceletEffect(world, world.player) === 'painCurse')
            r *= 3;
        return r;
    }
    const weapon = equippedWeapon(world.player);
    if (equipRuneLevel(weapon, 'sure') > 0)
        return 0; // 必中の印は会心が出ない
    let r = PLAYER_CRIT_RATE + equipRuneLevel(weapon, 'crit') * CRIT_RUNE_STEP;
    if (braceletEffect(world, world.player) === 'critUp')
        r += CRIT_RUNE_STEP * 2;
    return Math.min(CRIT_RATE_CAP, r);
}
/** 通常攻撃。dir 方向の相手を殴る */
export function attackInDirection(world, a, dir) {
    a.dir = dir;
    const target = world.actorAt(step(a.pos, dir));
    world.emit({ t: 'attack', actorId: a.id, targetId: target?.id ?? -1, critical: false });
    if (!target || !target.alive || !world.isHostile(a, target)) {
        world.log(`${world.nameOf(a)}の こうげき！ 空振りだ。`);
        world.sfx('hitMiss');
        return { hit: false, critical: false, damage: 0, killed: false };
    }
    return resolveAttack(world, a, target);
}
/** 攻撃の解決（命中 → 会心 → ダメージ → 印の追加効果） */
export function resolveAttack(world, a, target, powerMul = 1) {
    const miss = { hit: false, critical: false, damage: 0, killed: false };
    // 透明な相手には半分の確率でしか攻撃が向かない
    if (world.hasStatus(target, 'invisible') && a.kind !== 'player' && world.rng.chance(0.5)) {
        world.log(`${world.nameOf(a)}は 見当違いの方を 攻撃した。`);
        return miss;
    }
    const rate = hitRate(BASE_HIT, accuracyBonus(world, a), evadeRate(world, target));
    if (!world.rng.chance(rate)) {
        world.log(`${world.nameOf(a)}の こうげき！ しかし はずれた！`);
        world.emit({ t: 'miss', actorId: a.id, targetId: target.id });
        world.sfx('hitMiss');
        return miss;
    }
    // 攻撃すると透明が解ける
    if (world.hasStatus(a, 'invisible'))
        removeStatus(world, a, 'invisible');
    const critical = world.rng.chance(critRate(world, a));
    const atk = Math.floor(attackPower(world, a) * powerMul);
    let def = critical ? 0 : defensePower(world, target);
    // 砕きの印は相手の防御力を半分にする
    if (a.kind === 'player' && equipRuneLevel(equippedWeapon(world.player), 'crush') > 0) {
        def = Math.floor(def / 2);
    }
    let dmg = calcDamage(atk, def, world.rng);
    dmg = applyAttackRunes(world, a, target, dmg);
    dmg = applyDefenseRunes(world, a, target, dmg);
    // メタル系は固定で減算する
    if (target.kind !== 'player' && world.defOf(target).metal) {
        const pierce = a.kind === 'player'
            && equipRuneLevel(equippedWeapon(world.player), 'slayMetal') > 0;
        if (!pierce)
            dmg = Math.max(0, dmg - METAL_DAMAGE_REDUCTION);
    }
    if (critical) {
        world.log(a.kind === 'player' ? '会心の一撃！' : `${world.nameOf(a)}の 痛恨の一撃！`, 'critical');
        world.sfx('hitCritical');
    }
    else {
        world.sfx('hit');
    }
    world.emit({ t: 'attack', actorId: a.id, targetId: target.id, critical });
    const killed = dealDamage(world, a, target, dmg, 'physical');
    if (!killed)
        applyOnHitEffects(world, a, target, dmg);
    return { hit: true, critical, damage: dmg, killed };
}
/** 武器の印による与ダメージ補正 */
function applyAttackRunes(world, a, target, dmg) {
    if (a.kind !== 'player')
        return dmg;
    const weapon = equippedWeapon(world.player);
    if (!weapon)
        return dmg;
    const atk = attackPower(world, a);
    let out = dmg;
    const flame = equipRuneLevel(weapon, 'flame');
    if (flame > 0) {
        let bonus = Math.floor(atk * 0.3 * flame);
        if (world.hasStatus(target, 'wet'))
            bonus = Math.floor(bonus / 2);
        out += bonus;
    }
    const thunder = equipRuneLevel(weapon, 'thunder');
    if (thunder > 0) {
        let bonus = Math.floor(atk * 0.3 * thunder);
        if (world.hasStatus(target, 'wet'))
            bonus *= 2;
        out += bonus;
    }
    if (target.kind !== 'player') {
        const def = world.defOf(target);
        const dragon = equipRuneLevel(weapon, 'slayDragon');
        if (dragon > 0 && def.family === 'dragon')
            out = Math.floor(out * (1 + dragon * 0.5));
        const ghost = equipRuneLevel(weapon, 'slayGhost');
        if (ghost > 0 && def.family === 'ghost')
            out = Math.floor(out * (1 + ghost * 0.5));
    }
    return out;
}
/** 盾の印による被ダメージ軽減 */
function applyDefenseRunes(world, a, target, dmg) {
    if (target.kind !== 'player')
        return dmg;
    const shield = equippedShield(world.player);
    let out = dmg;
    const reduce = equipRuneLevel(shield, 'reduce');
    if (reduce > 0)
        out -= reduce * 2;
    if (world.hasStatus(target, 'fainted'))
        out = Math.floor(out * FAINT_DAMAGE_MUL);
    out = Math.max(shield && equipRuneLevel(shield, 'evade') > 0 ? 0 : 1, out);
    // 返しの印
    const reflect = equipRuneLevel(shield, 'reflect');
    if (reflect > 0 && a.alive && a !== target) {
        const back = Math.floor(out * Math.min(0.9, reflect * 0.25));
        if (back > 0) {
            world.log(`${world.nameOf(a)}に ${back}の ダメージを 返した！`, 'good');
            dealDamage(world, target, a, back, 'magic');
        }
    }
    return out;
}
/** 攻撃に付随する効果（印や特技による状態異常） */
function applyOnHitEffects(world, a, target, dmg) {
    if (a.kind !== 'player')
        return;
    const weapon = equippedWeapon(world.player);
    if (!weapon)
        return;
    const drain = equipRuneLevel(weapon, 'drain');
    if (drain > 0) {
        const heal = Math.max(1, Math.floor(dmg * drain * 0.1));
        healActor(world, a, heal);
    }
    const sleepRune = equipRuneLevel(weapon, 'sleepHit');
    if (sleepRune > 0 && world.rng.percent(sleepRune * 8)) {
        applyStatus(world, target, 'asleep');
        world.log(`${world.nameOf(target)}は 眠ってしまった！`, 'good');
    }
    const confuseRune = equipRuneLevel(weapon, 'confuseHit');
    if (confuseRune > 0 && world.rng.percent(confuseRune * 8)) {
        applyStatus(world, target, 'confused');
        world.log(`${world.nameOf(target)}は 混乱した！`, 'good');
    }
    const poisonRune = equipRuneLevel(weapon, 'poisonHit');
    if (poisonRune > 0 && world.rng.percent(poisonRune * 10)) {
        applyStatus(world, target, 'poisoned');
        world.log(`${world.nameOf(target)}に 毒が 回った！`, 'good');
    }
}
// ---------------------------------------------------------------------------
// ダメージと撃破
// ---------------------------------------------------------------------------
/** ダメージを与える。戻り値は「倒したか」 */
export function dealDamage(world, src, target, amount, kind = 'physical') {
    if (!target.alive)
        return false;
    let dmg = Math.max(0, Math.floor(amount));
    if (world.hasStatus(target, 'invincible')) {
        world.log(`${world.nameOf(target)}は 無敵だ！ ダメージを 受けない。`, 'good');
        return false;
    }
    if (kind === 'fire' && target.kind === 'player'
        && world.braceletEffectOf(target) === 'wardBlast') {
        world.log('腕輪が 爆風を 防いだ！', 'good');
        return false;
    }
    if (kind === 'fire' && target.kind === 'player') {
        const water = equipRuneLevel(equippedShield(world.player), 'antiFire');
        if (water > 0)
            dmg = Math.floor(dmg * (1 - Math.min(0.9, water * 0.3)));
        if (world.hasStatus(target, 'wet'))
            dmg = Math.floor(dmg / 2);
    }
    if (dmg <= 0) {
        world.log(`${world.nameOf(target)}に ダメージはない。`);
        return false;
    }
    target.hp = Math.max(0, target.hp - dmg);
    world.emit({ t: 'damage', actorId: target.id, amount: dmg, kind });
    world.log(`${world.nameOf(target)}に ${dmg}の ダメージ！`, target.kind === 'player' ? 'bad' : 'normal');
    if (target.kind === 'player') {
        world.run.stats.damageTaken += dmg;
        world.sfx('damage');
    }
    else if (src && src.kind === 'player') {
        world.run.stats.damageDealt += dmg;
    }
    wakeOnDamage(world, target);
    if (target.hp <= 0) {
        killActor(world, src, target);
        return true;
    }
    return false;
}
/** 回復。あふれた分は捨てる */
export function healActor(world, a, amount) {
    const before = a.hp;
    a.hp = Math.min(a.maxHp, a.hp + Math.max(0, Math.floor(amount)));
    const healed = a.hp - before;
    if (healed > 0)
        world.emit({ t: 'heal', actorId: a.id, amount: healed });
    return healed;
}
/** アクターを倒す */
export function killActor(world, src, target) {
    if (target.kind === 'player') {
        target.alive = false;
        return; // プレイヤーの死亡処理は turn.ts が拾う（復活判定があるため）
    }
    target.alive = false;
    world.log(`${world.nameOf(target)}を たおした！`, 'good');
    world.emit({ t: 'defeat', actorId: target.id });
    world.sfx('defeat');
    dropOnDeath(world, target);
    if (src && (src.kind === 'player' || src.kind === 'ally')) {
        world.run.stats.kills++;
        gainExp(world, world.player, target.exp);
        // 守銭の印
        const gitanRune = equipRuneLevel(equippedWeapon(world.player), 'gitanHit');
        if (gitanRune > 0) {
            const gain = gitanRune * 20;
            world.player.gitan += gain;
            world.run.stats.gitanEarned += gain;
            world.log(`${gain}ギタンを 拾った。`, 'item');
        }
        // 成長の印
        growEquipment(world);
    }
    // 爆発やボスの撃破記録は、フロアから取り除く前にここで済ませる。
    // 取り除いたあとに turn.ts がまとめて面倒を見る作りだと、
    // もう走査対象に居ないので永久に呼ばれない。
    world.onMonsterDefeated?.(target);
    world.removeActor(target);
}
/** 倒した時のドロップ */
function dropOnDeath(world, m) {
    // 化けていたアイテムは床に残す（見えていた物が消えると不条理になる）
    if (m.disguise) {
        world.dropItem(m.disguise, m.pos);
        m.disguise = null;
    }
    // 盗んだ物は必ず落とす
    for (const it of m.heldItems)
        world.dropItem(it, m.pos);
    m.heldItems = [];
    if (m.heldGitan > 0) {
        world.player.gitan += m.heldGitan;
        world.log(`${m.heldGitan}ギタンを 取り返した！`, 'good');
        m.heldGitan = 0;
    }
    const def = world.defOf(m);
    if (def.gitan > 0) {
        const amount = Math.max(1, Math.floor(def.gitan * world.rng.range(70, 130) / 100));
        world.player.gitan += amount;
        world.run.stats.gitanEarned += amount;
        world.log(`${amount}ギタンを 手に入れた。`, 'item');
    }
    if (def.drop && world.rng.percent(def.drop.rate)) {
        // 生成は spawn 側の makeItem を使う（循環参照を避けるため遅延で渡される）
        const maker = world.itemFactory;
        if (maker) {
            const item = maker(def.drop.itemId);
            if (item)
                world.dropItem(item, m.pos);
        }
    }
}
/** 成長の印つき装備を育てる */
function growEquipment(world) {
    const p = world.player;
    for (const item of [equippedWeapon(p), equippedShield(p)]) {
        if (!item || equipRuneLevel(item, 'growth') === 0)
            continue;
        item.growthCount = (item.growthCount ?? 0) + 1;
        if (item.growthCount >= 20) {
            item.growthCount = 0;
            item.plus++;
            world.log('装備が 一回り 育った！', 'good');
            world.sfx('statUp');
        }
    }
}
// ---------------------------------------------------------------------------
// 成長
// ---------------------------------------------------------------------------
export function gainExp(world, p, amount) {
    if (amount <= 0)
        return;
    p.exp = Math.min(MAX_EXP, p.exp + amount);
    while (p.level < MAX_LEVEL && p.exp >= EXP_TABLE[p.level + 1])
        levelUp(world, p);
}
export function levelUp(world, p) {
    const gain = hpGainForLevel(p.level);
    p.level++;
    p.maxHp = Math.min(MAX_HP_CAP, p.maxHp + gain);
    p.hp = Math.min(p.maxHp, p.hp + gain);
    p.str = p.maxStr; // レベルアップでちからが全回復する
    world.log(`${p.name}は レベル ${p.level}に 上がった！`, 'good');
    world.emit({ t: 'levelUp', actorId: p.id });
    world.sfx('levelUp');
}
/** レベルを下げる（ドレイン攻撃） */
export function levelDown(world, p) {
    if (p.level <= 1) {
        world.log('しかし 何も 起こらなかった。');
        return false;
    }
    const shield = equippedShield(p);
    if (equipRuneLevel(shield, 'guardLevel') > 0) {
        world.log('盾が レベルダウンを 防いだ！', 'good');
        return false;
    }
    p.level--;
    p.exp = EXP_TABLE[p.level];
    p.maxHp = Math.max(1, p.maxHp - hpGainForLevel(p.level));
    p.hp = Math.min(p.hp, p.maxHp);
    world.log(`${p.name}の レベルが 下がった！`, 'bad');
    world.sfx('statDown');
    return true;
}
/** ちからを下げる */
export function loseStr(world, p, amount = 1) {
    const shield = equippedShield(p);
    if (equipRuneLevel(shield, 'guardStr') > 0) {
        world.log('盾が ちからの低下を 防いだ！', 'good');
        return false;
    }
    const before = p.str;
    p.str = Math.max(0, p.str - amount);
    if (p.str === before)
        return false;
    world.log(`${p.name}の ちからが ${before - p.str} 下がった！`, 'bad');
    world.sfx('statDown');
    return true;
}
/** ちからを回復する。最大の時は最大値を上げる */
export function gainStr(world, p, amount = 1) {
    if (p.str >= p.maxStr) {
        p.maxStr = Math.min(99, p.maxStr + amount);
        p.str = p.maxStr;
        world.log(`${p.name}の ちからの最大値が 上がった！`, 'good');
    }
    else {
        p.str = Math.min(p.maxStr, p.str + amount);
        world.log(`${p.name}の ちからが 回復した。`, 'good');
    }
    world.sfx('statUp');
}
//# sourceMappingURL=combat.js.map