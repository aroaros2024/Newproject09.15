/**
 * 満腹度と HP 自然回復。
 *
 * 満腹度は 1/10 単位の整数（foodX10）で持つ。1000 = 満腹度 100.0。
 * 基本は 1 ターンに 1（＝0.1）減るので、100 から 0 まで 1000 ターン。
 */
import { getItem } from '../data/registry.js';
import { FOOD_CAP_X10, HUNGER_CRITICAL_X10, HUNGER_DRAIN_BASE, HUNGER_DRAIN_CAP, HUNGER_WARN_X10, REGEN_BRACELET_MUL, STARVE_DAMAGE, regenPerTurnX1000, } from './rules.js';
import { equipRuneLevel } from './runes.js';
import { equippedBracelet, equippedShield, equippedWeapon } from './inventory.js';
/** 1 ターンに減る満腹度（1/10 単位） */
export function hungerDrain(world, p) {
    const bracelet = equippedBracelet(p);
    const sealed = world.hasStatus(p, 'sealed');
    const braceletEffect = bracelet && !sealed
        ? (() => {
            const def = getItem(bracelet.defId);
            return def.kind === 'bracelet' ? def.effect : '';
        })()
        : '';
    // ハラヘラズの腕輪は、呪われていなければ満腹度が減らない
    if (braceletEffect === 'noHunger')
        return bracelet && bracelet.cursed ? 3 : 0;
    let d = HUNGER_DRAIN_BASE;
    if (braceletEffect === 'regen')
        d *= 2;
    if (braceletEffect === 'starveCurse')
        d *= 4;
    if (world.hasStatus(p, 'hungryFast'))
        d *= 2;
    // 剛腕の印は余分に減り、疾風の印と腹持ちの印は減りを抑える
    const weapon = equippedWeapon(p);
    if (equipRuneLevel(weapon, 'heavy') > 0)
        d *= 2;
    if (equipRuneLevel(weapon, 'swift') > 0)
        d = Math.max(0, Math.floor(d / 2));
    const shield = equippedShield(p);
    const satiety = equipRuneLevel(shield, 'satiety');
    if (satiety > 0)
        d = Math.max(0, Math.floor(d / (1 + satiety)));
    if (equipRuneLevel(shield, 'blunt') > 0)
        d *= 2;
    return Math.min(HUNGER_DRAIN_CAP, d);
}
/**
 * 満腹度を 1 ターンぶん減らす。
 * 戻り値は「空腹で力尽きたか」。
 */
export function tickHunger(world, p) {
    const before = p.foodX10;
    p.foodX10 = Math.max(0, p.foodX10 - hungerDrain(world, p));
    if (before > HUNGER_WARN_X10 && p.foodX10 <= HUNGER_WARN_X10) {
        world.log('おなかが 減ってきた……', 'warning');
        world.sfx('hungry');
    }
    if (before > HUNGER_CRITICAL_X10 && p.foodX10 <= HUNGER_CRITICAL_X10) {
        world.log('おなかが ぺこぺこだ！', 'warning');
        world.sfx('hungry');
    }
    if (before > 0 && p.foodX10 === 0) {
        world.log(`${p.name}は 空腹で 倒れそうだ！`, 'bad');
        world.sfx('starving');
    }
    if (p.foodX10 === 0) {
        p.hp -= STARVE_DAMAGE;
        world.emit({ t: 'damage', actorId: p.id, amount: STARVE_DAMAGE, kind: 'magic' });
        if (p.hp <= 0) {
            p.hp = 0;
            return true;
        }
    }
    return false;
}
/** 食べて満腹度を回復する */
export function eat(world, p, gainX10, maxGainX10 = 0) {
    if (maxGainX10 > 0 && p.foodX10 >= p.maxFoodX10) {
        const before = p.maxFoodX10;
        p.maxFoodX10 = Math.min(FOOD_CAP_X10, p.maxFoodX10 + maxGainX10);
        if (p.maxFoodX10 > before) {
            world.log(`最大満腹度が ${(p.maxFoodX10 - before) / 10} 増えた！`, 'good');
        }
    }
    p.foodX10 = Math.min(p.maxFoodX10, p.foodX10 + gainX10);
    world.sfx('eat');
}
/** 満腹度を減らす（空腹のワナなど） */
export function loseFood(world, p, lossX10) {
    p.foodX10 = Math.max(0, p.foodX10 - lossX10);
    world.log('おなかが 減った！', 'bad');
}
/** 表示用の満腹度（小数第 1 位まで） */
export const foodDisplay = (p) => Math.floor(p.foodX10 / 10);
export const maxFoodDisplay = (p) => Math.floor(p.maxFoodX10 / 10);
/**
 * HP の自然回復。1/1000 単位のアキュムレータに貯めて、
 * 1000 を超えたぶんだけ実際に回復する。
 */
export function tickRegen(world, a) {
    if (!a.alive || a.hp <= 0 || a.hp >= a.maxHp) {
        a.regenAcc = 0;
        return;
    }
    let mul = 1;
    if (a.kind === 'player') {
        const p = a;
        // 空腹・毒の間は回復しない
        if (p.foodX10 <= 0)
            return;
        if (world.hasStatus(p, 'poisoned') || world.hasStatus(p, 'deadlyPoisoned'))
            return;
        const bracelet = equippedBracelet(p);
        if (bracelet && !world.hasStatus(p, 'sealed')) {
            const def = getItem(bracelet.defId);
            if (def.kind === 'bracelet' && def.effect === 'regen') {
                mul = bracelet.cursed ? 0 : REGEN_BRACELET_MUL;
            }
        }
        const heal = equipRuneLevel(equippedShield(p), 'regenRune');
        if (heal > 0)
            mul *= 1 + heal * 0.5;
    }
    else {
        mul = 1;
    }
    if (mul <= 0)
        return;
    const level = a.kind === 'player' ? a.level : a.level;
    a.regenAcc += regenPerTurnX1000(a.maxHp, level, mul);
    if (a.regenAcc >= 1000) {
        const heal = Math.floor(a.regenAcc / 1000);
        a.regenAcc -= heal * 1000;
        a.hp = Math.min(a.maxHp, a.hp + heal);
    }
}
//# sourceMappingURL=hunger.js.map