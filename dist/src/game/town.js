/**
 * 風の村。冒険の前後の処理をまとめる。
 *
 *   倉庫   … 持ち物を預ける。死んでも失われない
 *   道具屋 … 買う／売る
 *   鍛冶屋 … 合成・強化・呪い解き
 *   食事処 … 満腹度の最大値を上げる弁当
 *   入口   … ダンジョンを選んで潜る
 */
import { Rng } from '../core/rng.js';
import { getItem, allDungeons, getDungeon } from '../data/registry.js';
import { DUNGEON_ORDER } from '../data/dungeons.js';
import { makeItem } from './inventory.js';
import { mergeInto } from './itemEffects.js';
import { SELL_RATE } from './rules.js';
/** 倉庫に預けられる数 */
export const STORAGE_LIMIT = 80;
/** 鍛冶屋の料金 */
export const SMITH_PRICE = {
    /** 合成 1 回（素材 1 つにつき加算） */
    synthesisBase: 1000,
    synthesisPerMaterial: 500,
    /** 修正値 +1 あたり（今の修正値が高いほど高くなる） */
    temper: (plus) => 1500 * Math.max(1, plus + 1),
    /** 呪い解き */
    uncurse: 500,
};
/** 食事処の弁当 */
export const BENTOU_PRICE = 900;
/** ダンジョンに挑めるか */
export function canEnterDungeon(town, d) {
    if (!town.unlocked.includes(d.id))
        return false;
    if (d.requires && !town.cleared.includes(d.requires))
        return false;
    return true;
}
/** 村の一覧に出すダンジョン（未解放も「？？？」として並べる） */
export function dungeonList(town) {
    return DUNGEON_ORDER.map((id) => {
        const def = getDungeon(id);
        return {
            def,
            unlocked: canEnterDungeon(town, def),
            cleared: town.cleared.includes(id),
            best: town.bestDepth[id] ?? 0,
        };
    });
}
/** ダンジョンをクリアしたときに次を解放する */
export function unlockNext(town, clearedId) {
    const idx = DUNGEON_ORDER.indexOf(clearedId);
    if (idx < 0 || idx + 1 >= DUNGEON_ORDER.length)
        return null;
    const nextId = DUNGEON_ORDER[idx + 1];
    if (town.unlocked.includes(nextId))
        return null;
    town.unlocked.push(nextId);
    return nextId;
}
// ---------------------------------------------------------------------------
// 倉庫
// ---------------------------------------------------------------------------
export const storageFull = (town) => town.storage.length >= STORAGE_LIMIT;
/** 倉庫へ預ける */
export function depositItem(town, item) {
    const def = getItem(item.defId);
    if (def.stackable) {
        const stack = town.storage.find((i) => i.defId === item.defId);
        if (stack) {
            stack.count += item.count;
            return true;
        }
    }
    if (storageFull(town))
        return false;
    town.storage.push(item);
    return true;
}
/** 倉庫から出す */
export function withdrawItem(town, uid) {
    const i = town.storage.findIndex((it) => it.uid === uid);
    if (i < 0)
        return null;
    return town.storage.splice(i, 1)[0];
}
/** 倉庫のアイテムの並べ替え */
export function sortStorage(town) {
    town.storage.sort((a, b) => {
        const ka = getItem(a.defId).kind;
        const kb = getItem(b.defId).kind;
        if (ka !== kb)
            return ka < kb ? -1 : 1;
        if (a.defId !== b.defId)
            return a.defId < b.defId ? -1 : 1;
        return b.plus - a.plus;
    });
}
// ---------------------------------------------------------------------------
// 道具屋
// ---------------------------------------------------------------------------
/** 村の道具屋の品揃え。日替わりではなく、冒険の回数で変わる */
export function shopStock(town) {
    const rng = new Rng(`town-shop:${town.totalRuns}`);
    const pool = [
        'healHerb', 'healHerb', 'greatHerb', 'antidoteHerb', 'cureConfuse',
        'riceBall', 'riceBall', 'bigRiceBall',
        'identifyScroll', 'lightScroll', 'uncurseScroll', 'mapScroll',
        'woodStick', 'oakClub', 'bronzeSword', 'woodShield', 'leatherShield', 'bronzeShield',
        'storagePot', 'woodArrow', 'stone',
    ].filter((id) => {
        try {
            getItem(id);
            return true;
        }
        catch {
            return false;
        }
    });
    // クリアが進むと良い品も並ぶ
    if (town.cleared.length >= 1)
        pool.push('ironSword', 'ironShield', 'sleepStaff');
    if (town.cleared.length >= 2)
        pool.push('steelSword', 'steelShield', 'greatIdentify');
    if (town.cleared.length >= 3)
        pool.push('synthesisPot', 'blessWeapon', 'blessShield');
    if (town.cleared.length >= 4)
        pool.push('tenrinSword', 'tenrinShield');
    const picks = rng.sample(pool, Math.min(10, pool.length));
    return picks.map((id) => {
        const item = makeItem(id, rng, {}, () => town.nextUid++);
        item.plusKnown = true;
        // 村で買うものは識別済みで呪われていない
        item.cursed = false;
        item.shopPrice = getItem(id).price;
        return item;
    });
}
export function buyFromTown(town, item) {
    const price = item.shopPrice > 0 ? item.shopPrice : getItem(item.defId).price;
    if (town.gitan < price)
        return false;
    if (storageFull(town))
        return false;
    town.gitan -= price;
    item.shopPrice = 0;
    town.storage.push(item);
    return true;
}
export function sellToTown(town, uid) {
    const item = withdrawItem(town, uid);
    if (!item)
        return 0;
    const price = Math.max(1, Math.floor(getItem(item.defId).price * SELL_RATE * (item.count || 1)));
    town.gitan += price;
    return price;
}
// ---------------------------------------------------------------------------
// 鍛冶屋
// ---------------------------------------------------------------------------
export function synthesisCost(materialCount) {
    return SMITH_PRICE.synthesisBase + SMITH_PRICE.synthesisPerMaterial * materialCount;
}
/** 倉庫のアイテムを合成する */
export function smithSynthesize(world, town, baseUid, materialUids) {
    const cost = synthesisCost(materialUids.length);
    if (town.gitan < cost)
        return false;
    const base = town.storage.find((i) => i.uid === baseUid);
    if (!base)
        return false;
    const baseKind = getItem(base.defId).kind;
    if (baseKind !== 'weapon' && baseKind !== 'shield')
        return false;
    const materials = [];
    for (const uid of materialUids) {
        const m = town.storage.find((i) => i.uid === uid);
        if (!m)
            return false;
        if (getItem(m.defId).kind !== baseKind)
            return false;
        materials.push(m);
    }
    town.gitan -= cost;
    for (const m of materials) {
        mergeInto(world, base, m);
        withdrawItem(town, m.uid);
    }
    return true;
}
/** 修正値を +1 する */
export function smithTemper(town, uid) {
    const item = town.storage.find((i) => i.uid === uid);
    if (!item)
        return false;
    const cost = SMITH_PRICE.temper(item.plus);
    if (town.gitan < cost)
        return false;
    town.gitan -= cost;
    item.plus++;
    item.plusKnown = true;
    return true;
}
/** 呪いを解く */
export function smithUncurse(town, uid) {
    const item = town.storage.find((i) => i.uid === uid);
    if (!item || !item.cursed)
        return false;
    if (town.gitan < SMITH_PRICE.uncurse)
        return false;
    town.gitan -= SMITH_PRICE.uncurse;
    item.cursed = false;
    return true;
}
/**
 * 冒険が終わったときの精算。
 *
 * - クリア: 持ち帰ったものを倉庫へ入れ、報酬を受け取り、次のダンジョンを解放する
 * - 死亡  : 持ち物をすべて失う（始まりの洞窟だけは例外）
 * - 脱出  : 持ち帰ったものは残る
 */
export function finishRun(world, town, kind, cause) {
    const p = world.player;
    const d = world.dungeon;
    const keepItems = kind !== 'death' || d.id === 'd1';
    let lost = 0;
    if (keepItems) {
        for (const item of collectCarried(p)) {
            item.shopPrice = 0;
            if (!depositItem(town, item))
                lost++;
        }
        town.gitan += p.gitan;
    }
    else {
        lost = p.inventory.length;
    }
    // 倉庫の壺に入れた物は、死んでも届く
    for (const item of world.pendingWarehouse) {
        if (!depositItem(town, item))
            lost++;
    }
    world.pendingWarehouse = [];
    town.bestDepth[d.id] = Math.max(town.bestDepth[d.id] ?? 0, world.run.stats.maxDepth);
    town.totalRuns++;
    let unlocked = null;
    let rewardMessage = null;
    if (kind === 'clear') {
        if (!town.cleared.includes(d.id))
            town.cleared.push(d.id);
        unlocked = unlockNext(town, d.id);
        if (d.reward.gitan)
            town.gitan += d.reward.gitan;
        if (d.reward.itemId) {
            const rng = new Rng(`reward:${d.id}:${town.totalRuns}`);
            const item = makeItem(d.reward.itemId, rng, { plusKnown: true }, () => town.nextUid++);
            depositItem(town, item);
        }
        rewardMessage = d.reward.message;
    }
    const record = {
        dungeonId: d.id,
        dungeonName: d.name,
        depth: world.run.stats.maxDepth,
        level: p.level,
        turns: world.run.totalTurn,
        gitan: p.gitan,
        cause: kind === 'clear' ? null : cause,
        cleared: kind === 'clear',
        at: 0,
    };
    town.history.push(record);
    if (town.history.length > 50)
        town.history.shift();
    return { record, lost, unlocked, rewardMessage };
}
/** 持ち物と壺の中身をひとまとめにする */
function collectCarried(p) {
    const out = [];
    for (const item of p.inventory) {
        out.push(item);
        // 壺の中身も一緒に持ち帰る
        if (item.contents.length > 0) {
            out.push(...item.contents);
            item.contents = [];
        }
    }
    return out;
}
/** 村へ入るときに引き継ぐ強さ（持ち込み可ダンジョン用） */
export function carryOverOf(town) {
    // この作品では「レベルは毎回 1 から」。永続的に伸びるのは倉庫の装備だけ。
    // 引き継ぎを入れたくなった時のために口だけ用意しておく。
    void town;
    return null;
}
/** 図鑑に記録する */
export function recordSeen(town, itemIds, monsterIds) {
    for (const id of itemIds)
        town.seenItems[id] = true;
    for (const id of monsterIds)
        town.seenMonsters[id] = true;
}
/** 図鑑の達成率 */
export function collectionRate(town) {
    const totalItems = allDungeons().length > 0 ? Object.keys(town.seenItems).length : 0;
    return { items: totalItems, monsters: Object.keys(town.seenMonsters).length };
}
//# sourceMappingURL=town.js.map