/**
 * 相棒。ガチャの SSR で手に入り、冒険の最初から付いてくる。
 *
 * 設計の芯は 2 つ。
 *
 * 1. 倒れても失わない。次の冒険では戻ってくる。
 *    失う形にすると「強い相棒を連れて行くのが怖い」になり、
 *    育てるほど使わなくなる。愛着の逆を行く。
 *
 * 2. 連れて行ける強さは、そのときのプレイヤーのレベルに追随する。
 *    「もっと不思議のダンジョン」はレベル 1 から始まるので、
 *    村で育てた Lv40 の相棒をそのまま連れて行けると、
 *    ダンジョンの方が消えてなくなる。
 */
import { tryGetPartner } from '../data/partners.js';
/** 相棒のレベルの上限 */
export const PARTNER_MAX_LEVEL = 50;
/**
 * プレイヤーより何レベルまで先に行けるか。
 *
 * 0 にすると相棒が常に足手まといになり、大きくすると相棒が全部倒す。
 * 「1 体ぶん多い」くらいの手応えに収まる幅にしてある。
 */
export const PARTNER_LEAD = 3;
/**
 * 村で伸ばせる上限。
 *
 * 相棒は 1 体 1 回しか出ないので、上限は最初から最大。
 * 育つのは冒険で得た経験値だけ。
 */
export const partnerLevelCap = () => PARTNER_MAX_LEVEL;
/** 次のレベルまでに要る経験値 */
export function partnerExpToNext(level) {
    const l = Math.max(1, Math.floor(level));
    return 20 * l * l;
}
/**
 * 冒険で実際に出る強さ。
 *
 * 育てた値そのままではなく、プレイヤーのレベルに引きずられる。
 * 強い相棒が弱いダンジョンを壊さないようにするため。
 */
export function effectivePartnerLevel(rec, playerLevel) {
    return Math.max(1, Math.min(Math.floor(rec.level), Math.max(1, Math.floor(playerLevel)) + PARTNER_LEAD));
}
/** そのレベルでの能力値 */
export function partnerStats(def, level) {
    const n = Math.max(0, Math.floor(level) - 1);
    return {
        hp: Math.round(def.hp + def.hpGrow * n),
        atk: Math.round(def.atk + def.atkGrow * n),
        def: Math.round(def.def + def.defGrow * n),
    };
}
export const partnerName = (rec) => rec.nickname || tryGetPartner(rec.id)?.name || rec.id;
/** プレイヤーの近くで、味方を置けるマスを探す */
function spotNearPlayer(world) {
    const from = world.player.pos;
    for (let r = 1; r <= 5; r++) {
        const candidates = [];
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r)
                    continue;
                const p = { x: from.x + dx, y: from.y + dy };
                if (world.actorAt(p))
                    continue;
                if (!world.canPlaceItem(p))
                    continue;
                candidates.push(p);
            }
        }
        if (candidates.length > 0)
            return world.rng.pick(candidates);
    }
    return null;
}
/**
 * 相棒を冒険に連れて行く。フロア 1 に入ったあとで呼ぶ。
 *
 * 見た目と特技は借り元のモンスターのものを使い、能力値と名前だけ差し替える。
 * こうすると AI も戦闘も仲間の作戦もそのまま動く。
 */
export function spawnPartner(world, rec) {
    const def = tryGetPartner(rec.id);
    if (!def)
        return null;
    const spot = spotNearPlayer(world);
    if (!spot)
        return null;
    const m = world.spawnAt?.(def.baseId, spot) ?? null;
    if (!m)
        return null;
    // spawnAt は敵として run.monsters に積む。味方の列へ移し替える。
    // removeActor は kind を見てどちらの列かを決めるので、
    // kind を書き換えるのは外したあと。先に書き換えると両方の列に居座る
    world.removeActor(m);
    m.kind = 'ally';
    m.tactic = 'follow';
    m.nameOverride = partnerName(rec);
    m.asleep = false;
    world.addMonster(m);
    const level = effectivePartnerLevel(rec, world.player.level);
    const st = partnerStats(def, level);
    m.level = level;
    m.maxHp = st.hp;
    m.hp = st.hp;
    m.atk = st.atk;
    m.def = st.def;
    // 相棒を倒しても経験値にはしない（混乱で斬って得をする形にしない）
    m.exp = 0;
    world.run.partner = { id: rec.id, actorId: m.id, level: rec.level, exp: 0 };
    return m;
}
/**
 * 冒険中に相棒が得た経験値。
 *
 * 村へは finishRun でまとめて移す。数えと同じで、村へ直接書くと
 * 中断セーブから再開したときに同じぶんを二度入れてしまう。
 */
export function gainPartnerExp(world, amount) {
    const rp = world.run.partner;
    if (!rp || amount <= 0)
        return;
    rp.exp += Math.floor(amount);
}
/** プレイヤーが倒したときに相棒へ回るぶん */
export const PARTNER_SHARE = 0.5;
/**
 * 村の記録へ反映する。冒険が終わったときに 1 度だけ呼ぶ。
 * 上限に達したぶんの経験値は切り捨てる（貯めても意味が無いので見せない）。
 */
export function mergePartnerExp(rec, gained) {
    const cap = partnerLevelCap();
    let levels = 0;
    rec.exp += Math.max(0, Math.floor(gained));
    while (rec.level < cap && rec.exp >= partnerExpToNext(rec.level)) {
        rec.exp -= partnerExpToNext(rec.level);
        rec.level++;
        levels++;
    }
    if (rec.level >= cap)
        rec.exp = 0;
    return levels;
}
/** 冒険中の相棒のアクター（居なければ null） */
export function partnerActor(world, rp) {
    if (!rp)
        return null;
    return world.run.allies.find((a) => a.id === rp.actorId) ?? null;
}
/** プレイヤーのレベルが上がったら、相棒も付いて行く（村で育てた上限まで） */
export function refreshPartnerLevel(world, p) {
    const rp = world.run.partner;
    if (!rp)
        return;
    const m = partnerActor(world, rp);
    if (!m || !m.alive)
        return;
    const def = tryGetPartner(rp.id);
    if (!def)
        return;
    const want = effectivePartnerLevel({ id: rp.id, level: rp.level, exp: 0 }, p.level);
    if (want <= m.level)
        return;
    const before = partnerStats(def, m.level);
    const after = partnerStats(def, want);
    m.level = want;
    m.maxHp += after.hp - before.hp;
    m.hp = Math.min(m.maxHp, m.hp + (after.hp - before.hp));
    m.atk = after.atk;
    m.def = after.def;
}
//# sourceMappingURL=partner.js.map