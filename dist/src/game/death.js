/**
 * 死亡と復活。
 *
 * 力尽きた瞬間に「復活の草」「復活の腕輪」を持っていれば一度だけ生き返る。
 * 復活しなかった場合は冒険が終わり、持ち物を失う（倉庫は無事）。
 */
import { getItem } from '../data/registry.js';
import { findItem, removeFromInventory } from './inventory.js';
import { itemName } from './naming.js';
/**
 * プレイヤーが倒れた時の処理。
 * 復活できたら false（冒険は続く）、終わったら true。
 */
export function handlePlayerDeath(world, cause) {
    const p = world.player;
    if (p.hp > 0)
        return false;
    // 1. 復活の腕輪
    if (p.braceletUid !== null) {
        const b = findItem(p, p.braceletUid);
        if (b && !b.cursed) {
            const def = getItem(b.defId);
            if (def.kind === 'bracelet' && def.effect === 'revive') {
                removeFromInventory(p, b.uid);
                revive(world, 1);
                world.log('腕輪が 砕け散り、力が よみがえった！', 'good');
                return false;
            }
        }
    }
    // 2. 持ち物の復活の草（壺の中・呪われている物は働かない）
    const herb = p.inventory.find((i) => i.defId === 'reviveHerb' && !i.cursed);
    if (herb) {
        if (herb.count > 1)
            herb.count--;
        else
            removeFromInventory(p, herb.uid);
        revive(world, 0.5);
        world.log(`${itemName(herb, world.run.identify)}が 光り、生き返った！`, 'good');
        world.sfx('fanfare');
        return false;
    }
    // 3. 力尽きる
    p.alive = false;
    p.hp = 0;
    world.log(`${p.name}は ${cause}……`, 'bad');
    world.emit({ t: 'gameOver', reason: cause });
    world.emit({ t: 'bgm', track: null });
    world.sfx('gameOver');
    world.finished = { kind: 'death', reason: cause };
    return true;
}
function revive(world, ratio) {
    const p = world.player;
    p.hp = Math.max(1, Math.floor(p.maxHp * ratio));
    p.alive = true;
    p.statuses = [];
    world.emit({ t: 'heal', actorId: p.id, amount: p.hp });
    world.emit({ t: 'flash', color: '#ffe080', ms: 500 });
}
/**
 * 死亡・帰還時に持ち物をどう扱うか。
 * d1（チュートリアル）だけは持ち物を失わない。
 */
export function losesItemsOnDeath(dungeonId) {
    return dungeonId !== 'd1';
}
//# sourceMappingURL=death.js.map