/**
 * ターンエンジン。
 *
 * 1 ターンの流れ:
 *   プレイヤーの行動 → 床の効果 → 仲間の行動 → 敵の行動
 *   → 状態異常 → 満腹度 → HP 自然回復 → 自然湧き → 風 → 視界の再計算
 *
 * 速度は「1 ターンを 2 ラウンドに分ける」方式で表現する。
 *   通常  : ラウンド 0 だけ行動
 *   倍速  : ラウンド 0 と 1 の両方で行動
 *   鈍足  : 偶数ターンのラウンド 0 だけ行動
 *
 * ロジックはアニメーションを待たない。演出は World.events に積むだけで、
 * 描画側が自分のペースで消化する。
 */
import { chebyshev, samePoint } from '../core/geom.js';
import { naturalSpawn, triggerMonsterHouse } from '../dungeon/spawn.js';
import { getItem } from '../data/registry.js';
import { onEnterTile, performPlayerAction } from './actions.js';
import { killActor } from './combat.js';
import { AiContext, takeAllyTurn, takeMonsterTurn } from './monsterAI.js';
import { detectAdjacentTraps } from './actions.js';
import { tickHunger, tickRegen } from './hunger.js';
import { applyTrapEffect } from './trapEffects.js';
import { descend, refreshFov } from './run.js';
import { tickStatuses } from './status.js';
import { handlePlayerDeath } from './death.js';
import { syncBraceletBonus } from './bracelets.js';
import { WIND_GRACE_TURNS } from './rules.js';
/** そのアクターがこのラウンドで行動するか */
function actsThisRound(world, a, round) {
    const speed = a.kind === 'player'
        ? (world.hasStatus(a, 'quick') ? 'double' : world.hasStatus(a, 'slow') ? 'slow' : 'normal')
        : effectiveSpeed(world, a);
    switch (speed) {
        case 'double':
            return round === 0 || round === 1;
        case 'doubleAttack':
            return round === 0;
        case 'slow':
            return round === 0 && world.run.totalTurn % 2 === 0;
        case 'normal':
        default:
            return round === 0;
    }
}
/** 状態異常込みのモンスターの速度 */
function effectiveSpeed(world, m) {
    const base = world.defOf(m).speed;
    const quick = world.hasStatus(m, 'quick');
    const slow = world.hasStatus(m, 'slow');
    if (quick && slow)
        return base;
    if (quick)
        return base === 'slow' ? 'normal' : 'double';
    if (slow)
        return base === 'double' ? 'normal' : 'slow';
    return base;
}
/** プレイヤーが 1 ターンに行動できる回数（疾風なら 2） */
export function playerRounds(world) {
    return world.hasStatus(world.player, 'quick') ? 2 : 1;
}
/** 鈍足のプレイヤーの周りでは、他のみんなが 2 回分動く */
function otherRoundsPerInput(world) {
    return world.hasStatus(world.player, 'slow') ? 2 : 1;
}
/**
 * プレイヤーの行動を 1 つ処理して、1 ターンを進める。
 *
 * 戻り値が tookTurn: false のときはターンが進んでいない
 * （メニューを閉じた、壁にぶつかった等）。
 */
export function stepTurn(world, action) {
    if (world.finished)
        return { tookTurn: false, reason: '冒険は終わっている' };
    // 「このターンぶんはもう動いた」印を落としてから始める。
    // 印が立つのは addMonster（＝湧いた直後）だけなので、
    // 湧いたその場で殴られることが無くなる
    for (const a of world.run.monsters)
        a.actedThisTurn = 0;
    for (const a of world.run.allies)
        a.actedThisTurn = 0;
    // 行動の前の居場所を控える。ワープ・落とし穴・階の移動も「移った」に数える
    const fromPos = { ...world.player.pos };
    const fromDepth = world.run.depth;
    const result = performPlayerAction(world, action);
    if (!result.tookTurn) {
        refreshFov(world);
        return result;
    }
    // 「ターンを消費した操作」を種類ごとに 1 箇所で数える。
    // 個々の処理に数える行を足して回ると、必ずどこかが漏れる。
    // 眠っていてターンだけ過ぎた場合は、押した操作は起きていないので数えない
    if (!result.skipped)
        world.tally(`act:${action.type}`);
    resolvePendingEffects(world);
    if (checkPlayerDeath(world, 'ちからつきた'))
        return result;
    // プレイヤーが乗ったマスの効果。
    // 動いていないなら「乗った瞬間」の処理は起こさない
    // （置いた道具をその場で拾い直す、などを防ぐ）
    const moved = world.run.depth !== fromDepth || !samePoint(fromPos, world.player.pos);
    onEnterTile(world, world.player, moved);
    resolvePendingEffects(world);
    if (checkPlayerDeath(world, 'ちからつきた'))
        return result;
    detectAdjacentTraps(world, world.player);
    checkMonsterHouse(world);
    // 疾風: 敵を動かさずに、もう 1 回だけ入力を受け付ける。
    // 「1 回の入力で 2 回動く」ではなく「2 回操作できる」ことが倍速の価値なので、
    // ここで敵のターンを回さずに戻る
    if (!world.finished && world.hasStatus(world.player, 'quick') && !world.run.playerActAgain) {
        world.run.playerActAgain = true;
        refreshFov(world);
        return result;
    }
    world.run.playerActAgain = false;
    // 鈍足: 自分が 1 回動く間に、他のみんなが 2 回分動く
    for (let i = 0; i < otherRoundsPerInput(world); i++) {
        if (world.finished)
            break;
        runOthers(world);
    }
    endOfTurn(world);
    return result;
}
/** 敵と仲間の行動 */
function runOthers(world) {
    const ctx = new AiContext(world);
    for (let round = 0; round < 2; round++) {
        ctx.invalidate();
        for (const ally of [...world.run.allies]) {
            if (!ally.alive)
                continue;
            if (!actsThisRound(world, ally, round))
                continue;
            // このターンに生まれた者は動かない。
            // actedThisTurn は「抑止の印」であって行動回数ではない。
            // takeAllyTurn / takeMonsterTurn の中で増やしてはいけない
            // （増やすと倍速がラウンド 1 を失って壊れる）
            if (ally.actedThisTurn > 0)
                continue;
            takeAllyTurn(world, ally, ctx);
        }
        for (const m of [...world.run.monsters]) {
            if (!m.alive)
                continue;
            if (!actsThisRound(world, m, round))
                continue;
            if (m.actedThisTurn > 0)
                continue;
            takeMonsterTurn(world, m, ctx);
            resolvePendingEffects(world);
            if (checkPlayerDeath(world, causeOfDeath(world, m)))
                return;
        }
        cleanupDead(world);
    }
}
function causeOfDeath(world, m) {
    return `${world.nameOf(m)}に やられた`;
}
/**
 * alive=false のまま残っている敵を片付ける。
 *
 * 通常の撃破は killActor() がその場でフックを呼んで取り除くので、
 * ここに来るのは「HP を直接 0 にされた」ような経路だけ。
 * 取りこぼしても後始末が二度走らないよう、フックは冪等にしてある。
 */
function cleanupDead(world) {
    for (const m of [...world.run.monsters]) {
        if (m.alive)
            continue;
        world.onMonsterDefeated?.(m);
        world.removeActor(m);
    }
    for (const a of [...world.run.allies]) {
        if (!a.alive)
            world.removeActor(a);
    }
}
/**
 * プレイヤーが倒れていないか確かめる。
 *
 * ワナや爆発のダメージは killActor() を通るが、プレイヤーの場合
 * killActor は alive=false にするだけで world.finished は立てない
 * （復活判定があるため）。この確認を挟まないと、HP0・alive=false・
 * finished=null という「幽霊状態」のまま行動し続けられてしまう。
 */
function checkPlayerDeath(world, cause) {
    if (world.finished)
        return true;
    const p = world.player;
    if (p.hp > 0 && p.alive)
        return false;
    return handlePlayerDeath(world, cause);
}
/** 行動中に積まれた「あとで処理するもの」を解決する */
function resolvePendingEffects(world) {
    let guard = 0;
    while (guard++ < 8) {
        if (world.pendingTrap) {
            const { actor, trapId } = world.pendingTrap;
            world.pendingTrap = null;
            applyTrapEffect(world, actor, trapId);
            continue;
        }
        if (world.pendingMonsterHouse) {
            const room = world.pendingMonsterHouse;
            world.pendingMonsterHouse = null;
            triggerMonsterHouse(world, room);
            continue;
        }
        if (world.pendingDescend) {
            world.pendingDescend = false;
            descend(world);
            continue;
        }
        break;
    }
    cleanupDead(world);
}
/** プレイヤーがモンスターハウスの部屋に入ったか */
function checkMonsterHouse(world) {
    const tile = world.map.tiles[world.player.pos.y * world.map.width + world.player.pos.x];
    if (!tile || tile.roomId < 0)
        return;
    const room = world.map.rooms.find((r) => r.id === tile.roomId);
    if (!room || !room.monsterHouse || room.houseTriggered)
        return;
    world.tally('house');
    triggerMonsterHouse(world, room);
}
/**
 * 到達値を記録する。
 *
 * 「いちばん強く鍛えた装備」「一度に持ったギタン」のような値は、
 * 上がる経路が多すぎて個別に数えられない。毎ターン 1 度だけ見て、
 * 最大値を控える形にしておけば数え漏れない。
 */
function recordPeaks(world) {
    const p = world.player;
    world.tallyMax('gitan', p.gitan);
    world.tallyMax('killsInRun', world.run.stats.kills);
    for (const item of p.inventory) {
        const def = getItem(item.defId);
        if (def.kind !== 'weapon' && def.kind !== 'shield')
            continue;
        // 呪われた -3 を「到達」に数えないよう、修正値は正のぶんだけ見る
        if (item.plus > 0)
            world.tallyMax('plus', item.plus);
        world.tallyMax('runes', item.runes.length);
    }
}
/** ターンの終わりの処理 */
function endOfTurn(world) {
    world.run.floorTurn++;
    world.run.totalTurn++;
    // 竜脈の腕輪の最大 HP ボーナスを引き直す。
    // 置く・投げる・売る・壺に入れる・封印される、といった経路をすべて
    // 個別に直すのは無理があるので、毎ターンここで一度だけ辻褄を合わせる
    syncBraceletBonus(world, world.player);
    // 到達値。鍛える・合成する・拾う・呪われる……と経路が多すぎるので、
    // 腕輪と同じ理由でここに集める
    recordPeaks(world);
    // 状態異常。火傷や猛毒で敵が倒れた場合も、通常の撃破と同じ経路を通して
    // 経験値・ドロップ・盗まれた道具の返却が起きるようにする
    for (const a of [...world.livingActors()]) {
        if (!tickStatuses(world, a))
            continue;
        if (a.kind === 'player') {
            if (handlePlayerDeath(world, '状態異常に 力尽きた'))
                return;
        }
        else {
            killActor(world, world.player, a);
        }
    }
    cleanupDead(world);
    if (world.finished)
        return;
    // 満腹度
    tickHunger(world, world.player);
    if (checkPlayerDeath(world, 'ちからつきた'))
        return;
    // HP 自然回復
    for (const a of world.livingActors())
        tickRegen(world, a);
    // 自然湧き
    naturalSpawn(world);
    // 不定の風
    tickWind(world);
    refreshFov(world);
    updateShopAnger(world);
    ensureBossChainNotStuck(world);
}
/**
 * ボスが「倒してもいないのに居なくなった」状態を拾う。
 *
 * 第 2 形態の出現に失敗した、ワナで落ちた、といった経路でフロアから
 * ボスが消えると、撃破が記録されないまま階段が永久に閉じ、その冒険が
 * 詰んでしまう。倒せる相手が居なくなったなら、そこで決着とみなす。
 */
function ensureBossChainNotStuck(world) {
    const here = world.bossesHere();
    if (here.length === 0 || world.bossesCleared())
        return;
    const alive = world.run.monsters.some((m) => m.alive && world.defOf(m).isBoss);
    if (alive)
        return;
    for (const b of here) {
        if (!world.run.defeatedBosses.includes(b.monsterId)) {
            world.run.defeatedBosses.push(b.monsterId);
        }
    }
    world.log('あたりの 気配が 静まった。階段が 開いている。', 'good');
}
/** 不定の風。一定ターンを過ぎると次の階へ飛ばされる */
function tickWind(world) {
    if (world.dungeon.windTurns <= 0)
        return;
    if (world.run.windLeft <= 0)
        return;
    world.run.windLeft--;
    if (world.run.windLeft === WIND_GRACE_TURNS) {
        world.log('不気味な 風が 吹き始めた……', 'warning');
        world.sfx('wind');
    }
    if (world.run.windLeft <= 0) {
        world.log('不定の風に 飛ばされた！', 'bad');
        world.sfx('wind');
        if (world.atBottom) {
            // 最下層で吹かれるとクリアにはならず、村へ戻される
            world.finished = { kind: 'escape', reason: '風に 飛ばされて 村へ 戻った' };
            return;
        }
        descend(world);
    }
}
/** 店の商品を持ったまま出ようとしていないか */
function updateShopAnger(world) {
    const p = world.player;
    const room = world.map.rooms.find((r) => r.shop && !r.shop.angry);
    if (!room || !room.shop)
        return;
    const carrying = p.inventory.some((i) => i.shopPrice > 0);
    if (!carrying)
        return;
    const tile = world.map.tiles[p.pos.y * world.map.width + p.pos.x];
    if (tile?.shop)
        return; // まだ店の中
    // 店を出た
    room.shop.angry = true;
    world.tally('steal');
    const keeper = world.run.monsters.find((m) => m.id === room.shop.ownerId);
    if (keeper)
        keeper.angry = true;
    const debt = p.inventory
        .filter((i) => i.shopPrice > 0)
        .reduce((sum, i) => sum + i.shopPrice, 0);
    world.log(`「どろぼう〜！ ${debt}ギタン 払え〜！」`, 'bad');
    world.sfx('steal');
    world.emit({ t: 'bgm', track: 'monsterHouse' });
    // 番犬を呼ぶ
    const factory = world.monsterFactory;
    if (factory) {
        for (let i = 0; i < 4; i++) {
            const spot = world.randomSpawnTile(4);
            if (spot)
                factory(spot);
        }
    }
}
/**
 * 足踏みで一定ターン休む（HP 回復のための「休憩」）。
 *
 * 危ないことが起きたら必ず止める。ここで止め損ねると、
 * 「気づいたら死んでいた」という一番やってはいけない事故になる。
 */
export function restTurns(world, maxTurns) {
    const p = world.player;
    const startDepth = world.run.depth;
    const startItems = p.inventory.length;
    const startStatuses = statusKey(p);
    let n = 0;
    while (n < maxTurns) {
        // 踏み出す前に確かめる。あとから見る作りだと、敵の真横で「休む」を
        // 選ぶたびに必ず 1 ターン献上して 1 発もらう羽目になる
        if (world.finished)
            break;
        if (world.run.depth !== startDepth)
            break; // 風や落とし穴で階が変わった
        if (p.hp >= p.maxHp)
            break; // 全快した
        if (restIsPointless(world))
            break; // 休んでも回復しない
        if (p.inventory.length !== startItems)
            break; // 盗まれた
        if (statusKey(p) !== startStatuses)
            break; // 休んでいる間に状態が変わった
        if (hostileNear(world))
            break; // 敵がいる
        const before = p.hp;
        stepTurn(world, { type: 'wait' });
        n++; // 進んだターンは必ず数える（表示が嘘をつかないように）
        if (p.hp < before)
            break; // 殴られた
    }
    return n;
}
/**
 * 休んでも回復しない状態か。
 * hunger.ts の自然回復の条件と揃えること。
 * 「何か状態異常が付いている」で止めると、浮遊やちから上昇のような
 * 無害なものでも永久に休めなくなる。
 */
function restIsPointless(world) {
    const p = world.player;
    return p.foodX10 <= 0
        || world.hasStatus(p, 'poisoned')
        || world.hasStatus(p, 'deadlyPoisoned');
}
/**
 * 休憩をやめるべき「敵」が近くにいるか。
 * 店主や仲間は敵ではないので、隣にいても休める。
 */
function hostileNear(world) {
    const p = world.player;
    for (const m of world.run.monsters) {
        if (!m.alive)
            continue;
        if (!world.isHostile(p, m))
            continue;
        const d = chebyshev(m.pos, p.pos);
        // 真隣は、寝ていても・見えていなくても危ない（隣接なら必ず起きる）
        if (d <= 1)
            return true;
        if (m.asleep)
            continue;
        const t = world.map.tiles[m.pos.y * world.map.width + m.pos.x];
        if (t?.visible && d <= 6)
            return true;
    }
    return false;
}
/** 休憩を中断すべき状態異常の顔ぶれ。疾風と永続のものは数えない */
const statusKey = (p) => p.statuses.filter((st) => st.turns !== 0 && st.id !== 'quick')
    .map((st) => st.id).sort().join(',');
/**
 * 1 ターンも休めない理由。休めるなら null。
 * 「0 ターン 休んだ。」とだけ出して何も起きないように見えるのが、
 * 「もう一度休む → また殴られる」を生んでいたので、理由を必ず言う。
 */
export function whyCannotRest(world) {
    const p = world.player;
    if (world.finished)
        return null;
    if (p.hp >= p.maxHp)
        return 'HP は 満タンだ。';
    if (p.foodX10 <= 0)
        return '空腹で 回復しない。';
    if (world.hasStatus(p, 'poisoned') || world.hasStatus(p, 'deadlyPoisoned')) {
        return '毒で 回復しない。';
    }
    if (hostileNear(world))
        return '敵が 近くにいて 休めない。';
    return null;
}
/** 階段の上にいるか */
export const onStairs = (world) => samePoint(world.player.pos, world.map.stairs);
//# sourceMappingURL=turn.js.map