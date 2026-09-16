/**
 * 道具を使う・投げる・装備する・壺に出し入れする・売買する。
 *
 * 「対象を選ぶ必要があるか」は needsTarget() が答える。
 * UI はこれを見てから選択画面を出し、決まった uid を Action に載せて渡す。
 */
import { chebyshev, samePoint, step } from '../core/geom.js';
import { getItem } from '../data/registry.js';
import { at } from '../dungeon/tilemap.js';
import { dealDamage } from './combat.js';
import { eat } from './hunger.js';
import { ITEM_EFFECTS, mergeInto, throwDamage } from './itemEffects.js';
import { addToInventory, allCarriedItems, findItem, isEquipped, isInventoryFull, makeItem, removeFromInventory, splitOne, } from './inventory.js';
import { itemName, shortItemName } from './naming.js';
import { applyEquipBonus, hasBracelet } from './bracelets.js';
import { THROW_HIT, SELL_RATE, gitanThrowDamage, hitRate } from './rules.js';
const OK = { tookTurn: true };
const NO = (reason) => ({ tookTurn: false, reason });
/** 使うときに対象アイテムを選ぶ必要があるか */
export function needsItemTarget(def) {
    if (def.kind === 'scroll') {
        return def.effect === 'identify' || def.effect === 'sealItem' || def.effect === 'recharge';
    }
    if (def.kind === 'pot') {
        return ['storage', 'synthesis', 'identifyPot', 'changePot', 'holePot', 'cashPot',
            'blessPot', 'strengthenPot', 'weakenPot', 'purifyPot', 'backpack',
            'unbreakable', 'warehousePot'].includes(def.effect);
    }
    return false;
}
/** 使うときに方向を選ぶ必要があるか */
export const needsDirection = (def) => def.kind === 'staff' && def.ballistics !== 'self';
/** 壺に物を入れられるか（＝「入れる」コマンドを出すか） */
export function isContainer(def) {
    return def.kind === 'pot' && def.capacity > 0;
}
/**
 * 道具を使う。
 * 巻物は濡れていると読めない、呪われた杖は不発、など個別の制約もここで見る。
 */
export function useItem(world, uid, targetUid, dir) {
    const p = world.player;
    const item = findItem(p, uid);
    if (!item)
        return NO('その道具は 持っていない');
    const def = getItem(item.defId);
    if (world.hasStatus(p, 'sealed') && (def.kind === 'staff' || def.kind === 'scroll')) {
        world.log('力が 封じられていて 使えない！', 'bad');
        return OK;
    }
    if (def.kind === 'scroll' && world.hasStatus(p, 'wet')) {
        world.log('巻物が 濡れていて 読めない！', 'bad');
        return OK;
    }
    if (def.kind === 'scroll' && world.hasStatus(p, 'blind')) {
        world.log('目が 見えなくて 読めない！', 'bad');
        return OK;
    }
    // 装備は「使う」で装備の切り替えになる
    if (def.kind === 'weapon' || def.kind === 'shield' || def.kind === 'bracelet') {
        return isEquipped(p, uid) ? unequipItem(world, uid) : equipItem(world, uid);
    }
    const target = targetUid !== undefined ? findItem(p, targetUid) : null;
    // 壺はカテゴリごとに専用の扱いをする
    if (def.kind === 'pot')
        return usePot(world, item, target);
    // 杖: 回数と呪い
    if (def.kind === 'staff') {
        if (item.charges <= 0) {
            world.log(`${itemName(item, world.run.identify)}は 何も 起こらなかった。`);
            identifyOnUse(world, item);
            return OK;
        }
        if (item.cursed && world.rng.percent(25)) {
            item.charges--;
            world.log('杖は 何も 起こさなかった……', 'bad');
            return OK;
        }
        item.charges--;
    }
    // 食料
    if (def.kind === 'food') {
        eat(world, p, def.nutrition, def.maxNutritionUp ?? 0);
        world.log(`${itemName(item, world.run.identify)}を 食べた。`, 'item');
        if (def.effect)
            runEffect(world, def.effect, item, p, target, dir);
        consume(world, item);
        return OK;
    }
    const effectId = def.effect;
    if (!effectId)
        return NO('使えない');
    const verb = def.kind === 'herb' ? '飲んだ' : def.kind === 'scroll' ? '読んだ' : '振った';
    world.log(`${itemName(item, world.run.identify)}を ${verb}。`, 'item');
    world.sfx(def.kind === 'herb' ? 'drink' : def.kind === 'scroll' ? 'scroll' : 'zap');
    const happened = runEffect(world, effectId, item, p, target, dir);
    if (!happened)
        world.log('しかし 何も 起こらなかった。');
    else
        identifyOnUse(world, item);
    // 草と巻物は使うと無くなる。杖は残る
    if (def.kind === 'herb' || def.kind === 'scroll')
        consume(world, item);
    return OK;
}
function runEffect(world, effectId, item, user, target, dir) {
    const handler = ITEM_EFFECTS[effectId];
    if (!handler)
        return false;
    return handler({ world, item, user, target, dir });
}
/** 使ったら種類が分かる */
function identifyOnUse(world, item) {
    world.run.identify.known[item.defId] = true;
}
/** 1 個消費する */
function consume(world, item) {
    const p = world.player;
    if (item.count > 1)
        item.count--;
    else
        removeFromInventory(p, item.uid);
}
// ---------------------------------------------------------------------------
// 壺
// ---------------------------------------------------------------------------
function usePot(world, pot, target) {
    const def = getItem(pot.defId);
    if (def.kind !== 'pot')
        return NO('壺ではない');
    const p = world.player;
    // 対象を取らない壺は、その場で効果が出る
    if (!needsItemTarget(def)) {
        const happened = runEffect(world, def.effect, pot, p, null);
        if (happened)
            identifyOnUse(world, pot);
        world.log(`${itemName(pot, world.run.identify)}を 使った。`, 'item');
        if (def.effect === 'sealPot' || def.effect === 'monsterPot')
            consume(world, pot);
        return OK;
    }
    if (!target)
        return NO('入れる物を 選んでいない');
    if (target.uid === pot.uid)
        return NO('自分自身は 入れられない');
    if (getItem(target.defId).kind === 'pot') {
        world.log('壺に 壺は 入らない。');
        return NO('壺に壺は入らない');
    }
    if (pot.contents.length >= def.capacity) {
        world.log(`${itemName(pot, world.run.identify)}は いっぱいだ。`);
        return NO('壺がいっぱい');
    }
    removeFromInventory(p, target.uid);
    world.log(`${shortItemName(target, world.run.identify)}を 壺に 入れた。`, 'item');
    identifyOnUse(world, pot);
    switch (def.effect) {
        case 'storage':
        case 'backpack':
        case 'unbreakable':
            pot.contents.push(target);
            break;
        case 'synthesis': {
            pot.contents.push(target);
            if (pot.contents.length >= def.capacity) {
                runEffect(world, 'synthesis', pot, p, null);
            }
            break;
        }
        case 'holePot':
            runEffect(world, 'holePot', pot, p, target);
            break; // 中身は消える
        case 'warehousePot':
            world.pendingWarehouse.push(target);
            runEffect(world, 'warehousePot', pot, p, target);
            break;
        case 'cashPot':
            runEffect(world, 'cashPot', pot, p, target);
            break;
        default: {
            // 識別・変化・祝福・強化・弱化・おはらい: 加工して戻す
            runEffect(world, def.effect, pot, p, target);
            if (!addToInventory(p, target))
                world.dropItem(target, p.pos);
            break;
        }
    }
    return OK;
}
/** 壺から取り出す */
export function takeOutOfPot(world, potUid, index) {
    const p = world.player;
    const pot = findItem(p, potUid);
    if (!pot)
        return NO('その壺は 持っていない');
    const item = pot.contents[index];
    if (!item)
        return NO('その中身は 無い');
    if (isInventoryFull(p))
        return NO('持ち物が いっぱい');
    pot.contents.splice(index, 1);
    addToInventory(p, item);
    world.log(`${shortItemName(item, world.run.identify)}を 取り出した。`, 'item');
    return OK;
}
// ---------------------------------------------------------------------------
// 装備
// ---------------------------------------------------------------------------
export function equipItem(world, uid) {
    const p = world.player;
    const item = findItem(p, uid);
    if (!item)
        return NO('その道具は 持っていない');
    const def = getItem(item.defId);
    const slot = def.kind === 'weapon' ? 'weaponUid'
        : def.kind === 'shield' ? 'shieldUid'
            : def.kind === 'bracelet' ? 'braceletUid' : null;
    if (!slot)
        return NO('装備できない');
    const currentUid = p[slot];
    if (currentUid !== null && currentUid !== uid) {
        const current = findItem(p, currentUid);
        if (current && current.cursed) {
            world.log(`${itemName(current, world.run.identify)}は 呪われていて 外せない！`, 'bad');
            return OK;
        }
    }
    // 前の腕輪のボーナスを外してから着け替える
    if (def.kind === 'bracelet')
        applyEquipBonus(world, p, false);
    p[slot] = uid;
    if (def.kind === 'bracelet')
        applyEquipBonus(world, p, true);
    item.plusKnown = true;
    if (def.kind === 'bracelet')
        world.run.identify.known[item.defId] = true;
    world.log(`${itemName(item, world.run.identify)}を 装備した。`, 'item');
    world.sfx('equip');
    if (item.cursed) {
        world.log('呪われていた！ 装備が 手から 離れない！', 'bad');
        world.sfx('curse');
    }
    return OK;
}
export function unequipItem(world, uid) {
    const p = world.player;
    const item = findItem(p, uid);
    if (!item)
        return NO('その道具は 持っていない');
    if (item.cursed) {
        world.log(`${itemName(item, world.run.identify)}は 呪われていて 外せない！`, 'bad');
        return OK;
    }
    if (p.weaponUid === uid)
        p.weaponUid = null;
    else if (p.shieldUid === uid)
        p.shieldUid = null;
    else if (p.braceletUid === uid) {
        applyEquipBonus(world, p, false);
        p.braceletUid = null;
    }
    else
        return NO('装備していない');
    world.log(`${itemName(item, world.run.identify)}を 外した。`, 'item');
    return OK;
}
// ---------------------------------------------------------------------------
// 投げる
// ---------------------------------------------------------------------------
export function throwItem(world, uid, dir) {
    const p = world.player;
    const item = findItem(p, uid);
    if (!item)
        return NO('その道具は 持っていない');
    if (isEquipped(p, uid) && item.cursed) {
        world.log('呪われていて 手から 離れない！', 'bad');
        return OK;
    }
    const def = getItem(item.defId);
    p.dir = dir;
    // 石や矢は山から 1 個だけ分けて投げる。ギタンは山ごと投げる
    const flying = def.kind === 'gitan'
        ? (removeFromInventory(p, uid) ?? item)
        : (splitOne(p, uid, () => world.nextUid()) ?? item);
    // 遠投の腕輪と遠投の印を着けていると、敵を貫通して飛ぶ
    const pierces = def.throwEffect === 'arrowPierce'
        || hasBracelet(world, p, 'farThrow')
        || (p.weaponUid !== null && findItem(p, p.weaponUid)?.runes.includes('reach') === true);
    const range = pierces ? 14 : 10;
    let cur = { ...p.pos };
    let victim = null;
    const path = [];
    for (let i = 0; i < range; i++) {
        const next = step(cur, dir);
        const tile = at(world.map, next.x, next.y);
        if (!tile || tile.kind === 'wall')
            break;
        cur = next;
        path.push({ ...cur });
        const a = world.actorAt(cur);
        if (a && a.alive && world.isHostile(p, a)) {
            victim = a;
            if (!pierces)
                break;
            // 貫通するときは通り過ぎざまにダメージだけ与えて飛び続ける
            dealDamage(world, p, a, throwDamage(world, flying, p), 'physical');
            victim = null;
        }
    }
    world.emit({
        t: 'projectile', from: { ...p.pos }, to: { ...cur },
        sprite: def.sprite, kind: def.kind === 'gitan' ? 'gitan' : 'item',
    });
    world.sfx('throw');
    world.log(`${shortItemName(flying, world.run.identify)}を 投げた。`, 'item');
    if (victim) {
        const evade = victim.kind === 'player' ? 0 : (world.defOf(victim).evade ?? 0);
        if (world.rng.chance(hitRate(THROW_HIT, 0, evade))) {
            // 壺は割れて中身が散らばる
            if (def.kind === 'pot' && def.effect !== 'unbreakable') {
                world.log(`${shortItemName(flying, world.run.identify)}は 割れた！`, 'item');
                world.sfx('break');
                for (const inner of flying.contents)
                    world.dropItem(inner, victim.pos);
                flying.contents = [];
            }
            const dmg = def.kind === 'gitan'
                ? gitanThrowDamage(flying.count)
                : throwDamage(world, flying, p);
            dealDamage(world, p, victim, dmg, 'physical');
            // 当たったギタンは消える（拾い直せない）
            if (def.kind === 'gitan') {
                world.log(`${flying.count}ギタンは 砕け散った。`, 'item');
                return OK;
            }
            // 当たった時の特殊効果
            const effectId = def.throwEffect ?? def.effect;
            if (effectId && ITEM_EFFECTS[effectId]) {
                const hit = ITEM_EFFECTS[effectId]({
                    world, item: flying, user: victim, victim, dir, thrown: true,
                });
                if (hit)
                    identifyOnUse(world, flying);
            }
            // 草・巻物・杖は当たると消える。武器や石は落ちる
            if (def.kind === 'herb' || def.kind === 'scroll' || def.kind === 'staff'
                || def.kind === 'pot' || def.kind === 'food') {
                return OK;
            }
            world.dropItem(flying, victim.pos);
            return OK;
        }
        world.log('しかし 外れた！');
    }
    // 誰にも当たらなかった: 落ちる（壊れ物は割れる）
    const landing = path.length > 0 ? path[path.length - 1] : p.pos;
    if (def.kind === 'pot' && def.effect !== 'unbreakable') {
        world.log('壺は 割れてしまった。', 'item');
        world.sfx('break');
        for (const inner of flying.contents)
            world.dropItem(inner, landing);
        return OK;
    }
    if (def.kind === 'herb' || def.kind === 'scroll') {
        // 草と巻物は地面に落ちる
        world.dropItem(flying, landing);
        return OK;
    }
    world.dropItem(flying, landing);
    world.sfx('land');
    return OK;
}
/**
 * ギタンを投げる。
 *
 * ギタンは持ち物ではなく所持金なので、投げる分だけその場で実体を作り、
 * 通常の投擲と同じ経路に載せる。持ち物へ一度入れてから投げると、
 * 外れて床に落ちたときに二重計上になってしまう。
 */
export function throwGitan(world, amount, dir) {
    const p = world.player;
    const n = Math.floor(amount);
    if (n <= 0)
        return NO('投げる額を 指定していない');
    if (p.gitan < n)
        return NO('そんなに ギタンを 持っていない');
    p.gitan -= n;
    const flying = makeItem('gitan', world.rng, { count: n, plusKnown: true }, () => world.nextUid());
    // 持ち物を経由せず、直接持たせてから投げる
    p.inventory.push(flying);
    return throwItem(world, flying.uid, dir);
}
// ---------------------------------------------------------------------------
// 店
// ---------------------------------------------------------------------------
/** 足元の商品を買う */
export function buyItem(world) {
    const p = world.player;
    const f = world.floorItemAt(p.pos);
    if (!f || f.item.shopPrice <= 0)
        return NO('ここには 売り物が 無い');
    if (p.gitan < f.item.shopPrice) {
        world.log('ギタンが 足りない。', 'warning');
        return NO('ギタンが足りない');
    }
    if (isInventoryFull(p)) {
        world.log('持ち物が いっぱいだ。', 'warning');
        return NO('持ち物がいっぱい');
    }
    p.gitan -= f.item.shopPrice;
    const price = f.item.shopPrice;
    f.item.shopPrice = 0;
    addToInventory(p, f.item);
    world.removeFloorItem(f);
    world.log(`${itemName(f.item, world.run.identify)}を ${price}ギタンで 買った。`, 'item');
    world.sfx('buy');
    return OK;
}
/** 店主に売る */
export function sellItem(world, uid) {
    const p = world.player;
    const item = findItem(p, uid);
    if (!item)
        return NO('その道具は 持っていない');
    if (item.shopPrice > 0)
        return NO('それは 店の 商品だ');
    if (isEquipped(p, uid) && item.cursed) {
        world.log('呪われていて 手から 離れない！', 'bad');
        return OK;
    }
    const price = Math.max(1, Math.floor(getItem(item.defId).price * SELL_RATE * (item.count || 1)));
    removeFromInventory(p, uid);
    p.gitan += price;
    // 店で売ると種類が分かる
    world.run.identify.known[item.defId] = true;
    world.log(`${itemName(item, world.run.identify)}を ${price}ギタンで 売った。`, 'item');
    world.sfx('gitan');
    return OK;
}
/** 借金（持ち出した商品の合計） */
export function shopDebt(world) {
    return world.player.inventory
        .filter((i) => i.shopPrice > 0)
        .reduce((sum, i) => sum + i.shopPrice, 0);
}
/** 借金を払う */
export function payDebt(world) {
    const debt = shopDebt(world);
    if (debt <= 0)
        return NO('払う物が 無い');
    const p = world.player;
    if (p.gitan < debt) {
        world.log(`${debt}ギタン 必要だが 足りない。`, 'warning');
        return NO('ギタンが足りない');
    }
    p.gitan -= debt;
    for (const it of p.inventory)
        it.shopPrice = 0;
    const room = world.map.rooms.find((r) => r.shop);
    if (room?.shop) {
        room.shop.angry = false;
        const keeper = world.run.monsters.find((m) => m.id === room.shop.ownerId);
        if (keeper)
            keeper.angry = false;
    }
    world.log(`${debt}ギタン 支払った。`, 'item');
    world.sfx('buy');
    return OK;
}
/** 合成（村の鍛冶屋から呼ぶ） */
export function synthesizeItems(world, baseUid, materialUids) {
    const p = world.player;
    const base = findItem(p, baseUid);
    if (!base)
        return false;
    for (const uid of materialUids) {
        const mat = findItem(p, uid);
        if (!mat)
            continue;
        mergeInto(world, base, mat);
        removeFromInventory(p, uid);
    }
    return true;
}
export { allCarriedItems, samePoint, chebyshev };
//# sourceMappingURL=itemActions.js.map