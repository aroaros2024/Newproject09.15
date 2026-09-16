/**
 * 冒険中の世界。
 *
 * RunState（セーブに載る素のデータ）に、実行中だけ必要なもの
 * （生きた Rng、演出イベントのキュー、ダンジョン定義）を足したもの。
 * ゲームロジックはすべてこの World を受け取って動く。
 */
import { Rng } from '../core/rng.js';
import { chebyshev, samePoint } from '../core/geom.js';
import { getMonster } from '../data/registry.js';
import { at, canEnter, isOpen } from '../dungeon/tilemap.js';
export class World {
    run;
    dungeon;
    rng;
    /** 描画側が消化する演出イベント */
    events = [];
    /** 冒険が終わったか（死亡・クリア・脱出） */
    finished = null;
    /**
     * アイテムの実体を作る関数。
     * spawn 側から注入する（combat から spawn を直接 import すると循環するため）。
     */
    itemFactory = null;
    /** 発動待ちのモンスターハウス。ターンエンジンが拾って処理する */
    pendingMonsterHouse = null;
    /** 階段を降りる予約。行動の解決後にターンエンジンが処理する */
    pendingDescend = false;
    /** 発動待ちのワナ。効果の適用はターンエンジンが行う */
    pendingTrap = null;
    /**
     * その階に合ったモンスターを指定位置に湧かせる関数。
     * spawn 側から注入する（循環参照を避けるため）。
     */
    monsterFactory = null;
    /** 指定のモンスターを指定位置に出す（ボスの形態変化などで使う） */
    spawnAt = null;
    /**
     * モンスターが倒れた瞬間に呼ばれる。フロアから取り除く直前。
     * 爆発とボスの撃破記録をここで済ませる。
     */
    onMonsterDefeated = null;
    /** 聖域の巻物が敷かれているマス。敵はここに入れない */
    sanctuaries = [];
    /** 身代わりの杖で狙われるようになった敵の id */
    decoyId = null;
    /**
     * 倉庫の壺に入れられ、帰還時に倉庫へ送られるアイテム。
     * 中断セーブを跨いでも消えないよう、実体は RunState に置いてある。
     */
    get pendingWarehouse() {
        // 古い中断セーブから復元した場合に備えて、無ければここで作る
        this.run.pendingWarehouse ??= [];
        return this.run.pendingWarehouse;
    }
    set pendingWarehouse(list) {
        this.run.pendingWarehouse = list;
    }
    constructor(run, dungeon) {
        this.run = run;
        this.dungeon = dungeon;
        this.rng = Rng.fromState(run.rng);
    }
    // ------------------------------------------------------------ 参照
    get map() {
        return this.run.map;
    }
    get player() {
        return this.run.player;
    }
    get depth() {
        return this.run.depth;
    }
    /** 最深部にいるか */
    get atBottom() {
        return this.run.depth >= this.dungeon.depth;
    }
    /** この階に出るボスの一覧（形態変化は配列の順） */
    bossesHere() {
        return this.dungeon.bosses.filter((b) => b.depth === this.run.depth);
    }
    /**
     * この階のボスをすべて倒したか。
     * ボスの居る階では、倒すまで階段を降りられない。
     */
    bossesCleared() {
        const here = this.bossesHere();
        if (here.length === 0)
            return true;
        return here.every((b) => this.run.defeatedBosses.includes(b.monsterId));
    }
    /** プレイヤー・仲間・敵をまとめて返す（行動順とは無関係） */
    allActors() {
        return [this.run.player, ...this.run.allies, ...this.run.monsters];
    }
    /** 生きているアクターだけ */
    livingActors() {
        return this.allActors().filter((a) => a.alive);
    }
    actorAt(p) {
        for (const a of this.allActors()) {
            if (a.alive && samePoint(a.pos, p))
                return a;
        }
        return null;
    }
    monsterAt(p) {
        const a = this.actorAt(p);
        return a && a.kind !== 'player' ? a : null;
    }
    actorById(id) {
        return this.allActors().find((a) => a.id === id) ?? null;
    }
    /** その場所にある床落ちアイテム（1 マスに 1 つ） */
    floorItemAt(p) {
        return this.run.floorItems.find((f) => samePoint(f.pos, p)) ?? null;
    }
    removeFloorItem(f) {
        const i = this.run.floorItems.indexOf(f);
        if (i >= 0)
            this.run.floorItems.splice(i, 1);
    }
    /** モンスターの静的定義 */
    defOf(m) {
        return getMonster(m.defId);
    }
    defOfId(id) {
        return getMonster(id);
    }
    /** 表示名（ボスは固有名を優先） */
    nameOf(a) {
        if (a.kind === 'player')
            return a.name;
        return a.nameOverride ?? this.defOf(a).name;
    }
    /** 敵対しているか。プレイヤーと仲間は味方同士 */
    isHostile(a, b) {
        const sideA = a.kind === 'player' || a.kind === 'ally';
        const sideB = b.kind === 'player' || b.kind === 'ally';
        if (a.kind === 'shopkeeper' || b.kind === 'shopkeeper') {
            // 店主は怒っている時だけプレイヤーに敵対する
            const keeper = a.kind === 'shopkeeper' ? a : b;
            const other = a.kind === 'shopkeeper' ? b : a;
            if (other.kind === 'player' || other.kind === 'ally')
                return keeper.angry;
            return false;
        }
        return sideA !== sideB;
    }
    // ------------------------------------------------------------ 更新
    nextUid() {
        return this.run.nextUid++;
    }
    nextActorId() {
        return this.run.nextActorId++;
    }
    addMonster(m) {
        if (m.kind === 'ally')
            this.run.allies.push(m);
        else
            this.run.monsters.push(m);
        return m;
    }
    removeActor(a) {
        if (a.kind === 'player')
            return;
        const list = a.kind === 'ally' ? this.run.allies : this.run.monsters;
        const i = list.indexOf(a);
        if (i >= 0)
            list.splice(i, 1);
    }
    dropItem(item, pos) {
        const spot = this.findDropSpot(pos);
        if (!spot)
            return null;
        const f = { item, pos: spot };
        this.run.floorItems.push(f);
        this.emit({ t: 'itemDrop', uid: item.uid, pos: spot });
        return f;
    }
    /**
     * アイテムを置ける場所を探す。
     * 指定位置が埋まっていたら、同心円状に近い空きマスを探す。
     */
    findDropSpot(from, maxRadius = 6) {
        if (this.canPlaceItem(from))
            return from;
        for (let r = 1; r <= maxRadius; r++) {
            const candidates = [];
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r)
                        continue;
                    const p = { x: from.x + dx, y: from.y + dy };
                    if (this.canPlaceItem(p))
                        candidates.push(p);
                }
            }
            if (candidates.length > 0)
                return this.rng.pick(candidates);
        }
        return null;
    }
    /** アイテムを置けるマスか（床で、階段でなく、他のアイテムが無い） */
    canPlaceItem(p) {
        const t = at(this.map, p.x, p.y);
        if (!t || t.kind !== 'floor')
            return false;
        if (this.floorItemAt(p))
            return false;
        return true;
    }
    /** アクターが立てるマスか（他のアクターがいないこと込み） */
    canStand(p, a) {
        const move = a.kind === 'player' ? this.playerMoveType() : this.defOf(a).moveType;
        if (!canEnter(this.map, p.x, p.y, move))
            return false;
        const other = this.actorAt(p);
        return !other || other === a;
    }
    /** プレイヤーの移動タイプ（浮遊・水グモの腕輪で変わる） */
    playerMoveType() {
        if (this.hasStatus(this.player, 'levitate'))
            return 'fly';
        const effect = this.braceletEffectOf(this.player);
        if (effect === 'levitate')
            return 'fly';
        if (effect === 'waterWalk')
            return 'water';
        return 'ground';
    }
    /**
     * 今効いている腕輪の効果 id。
     * bracelets.ts に実体があるが、World からも引けるよう関数を注入する。
     */
    braceletEffectLookup = null;
    braceletEffectOf(p) {
        return this.braceletEffectLookup ? this.braceletEffectLookup(p) : null;
    }
    // ------------------------------------------------------------ 状態異常
    hasStatus(a, id) {
        return a.statuses.some((s) => s.id === id && s.turns !== 0);
    }
    getStatus(a, id) {
        return a.statuses.find((s) => s.id === id && s.turns !== 0);
    }
    // ------------------------------------------------------------ 乱数の補助
    /** 条件に合う開けたマスをランダムに 1 つ */
    randomOpenTile(pred) {
        const candidates = [];
        for (let y = 0; y < this.map.height; y++) {
            for (let x = 0; x < this.map.width; x++) {
                if (!isOpen(at(this.map, x, y)))
                    continue;
                const p = { x, y };
                if (pred && !pred(p))
                    continue;
                candidates.push(p);
            }
        }
        return candidates.length > 0 ? this.rng.pick(candidates) : null;
    }
    /** プレイヤーから離れた、誰もいない床（湧き位置に使う） */
    randomSpawnTile(minDistFromPlayer = 6) {
        return this.randomOpenTile((p) => {
            const t = at(this.map, p.x, p.y);
            if (!t || t.kind !== 'floor')
                return false;
            if (this.actorAt(p))
                return false;
            if (t.shop)
                return false;
            if (samePoint(p, this.map.stairs))
                return false;
            return chebyshev(p, this.player.pos) >= minDistFromPlayer;
        });
    }
    // ------------------------------------------------------------ 演出
    emit(e) {
        this.events.push(e);
    }
    log(text, style = 'normal') {
        this.events.push({ t: 'message', text, style });
    }
    sfx(name) {
        this.events.push({ t: 'sfx', name });
    }
    /** 積まれたイベントを取り出して空にする */
    drainEvents() {
        const e = this.events;
        this.events = [];
        return e;
    }
    // ------------------------------------------------------------ セーブ
    /** 保存の直前に、実行中の状態を RunState へ書き戻す */
    syncForSave() {
        this.run.rng = this.rng.serialize();
        return this.run;
    }
}
/** プレイヤーの向きを変えるだけの補助 */
export function faceTo(a, dir) {
    a.dir = dir;
}
//# sourceMappingURL=world.js.map