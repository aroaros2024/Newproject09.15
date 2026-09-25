/**
 * キャラの見た目の台帳（ActorAnim）。
 *
 * ゲームのアクターとは別に「最後に居た位置と絵」を持つ。ゲームは倒した敵を
 * 同じ手の中で removeActor してしまうので、見た目をアクターから直接引くと
 * 崩れる演出もその一撃の数字も出せない（旧 fx.ts の不具合）。ここでは倒された印が
 * 付いたものを亡骸として残し、崩れ終わってから台帳へ返す。
 *
 * 置き場は使い回し。Map（id → ActorAnim）と詰めた配列、返されたものの置き場（free-list）を持ち、
 * 毎刻みの更新でも同期でも新しい物を作らない。作るのは同時に居る数の最大を超えたときだけ。
 *
 * 位置は 60Hz で滑らかに動かし、姿勢（コマ番号）は動きの fps でしか変えない。
 * コマ数・fps・当たりのコマはリグ（art/rig.ts）から引き、リグがまだ無い種は既定の表を使う
 * （旧 16×16 の絵を仮に使っている間もコマの進み方が揃うように）。
 */
import { getMonster } from '../../data/registry.js';
import { getRig, getSpecies } from '../art/rig.js';
import { hashFloat } from '../art/hash.js';
import { TILE_ART } from '../gfx/view.js';
import { ANIM } from '../theme.js';
import { STATUS_BIT } from './types.js';
/** リグの無い敵の既定（docs/ART_GUIDE.md の表と同じ） */
export const MONSTER_TIMING = {
    idle: { frames: 4, fps: 4, loop: true },
    walk: { frames: 4, fps: 10, loop: true },
    attack: { frames: 5, fps: 15, loop: false, strike: 2 },
    cast: { frames: 6, fps: 12, loop: false, strike: 4 },
    hurt: { frames: 2, fps: 12, loop: false },
    sleep: { frames: 2, fps: 2, loop: true },
    use: { frames: 4, fps: 12, loop: false, strike: 2 },
};
/** リグの無い主人公の既定。歩き 8 コマ・攻撃 6 コマ */
export const HERO_TIMING = {
    ...MONSTER_TIMING,
    walk: { frames: 8, fps: 10, loop: true },
    attack: { frames: 6, fps: 15, loop: false, strike: 2 },
};
export const ACTOR_TIMES = {
    /** 歩き終えてから待機に戻るまでの猶予。連続で歩くときに待機のコマが挟まらないように */
    walkHold: 60,
    /** 白い光が消えるまで */
    flashDecay: 160,
    /** 倒れたときに白く光っている時間 */
    deathFlash: 100,
    /** 崩れる 1 段の長さ（12fps） */
    dissolveStep: 1000 / 12,
    /** 崩れる段の数 */
    dissolveSteps: 4,
    /** 湧いたときに見えてくるまで */
    spawnFade: 220,
    /** 倒されずに居なくなったときに消えるまで */
    vanish: 180,
    /** ワープで縮む・伸びる */
    warpOut: 110,
    warpIn: 140,
    /** 被弾で下がって戻る */
    knock: 180,
    /** 空振りをかわして戻る */
    dodge: 200,
    /** 体当たり（壁にぶつかる）の往復と、押し込む瞬間 */
    bump: 110,
    bumpStrike: 45,
    /** モンスターハウスで跳ねる */
    hop: 260,
    /** 倒れた主人公が灰色になるまで */
    downGrey: 1000,
};
export const ACTOR_PX = {
    /** 攻撃で踏み込む量 */
    lunge: 5,
    /** 壁にぶつかる */
    bump: 3,
    /** 被弾で下がる（通常・会心） */
    knock: 2,
    knockCrit: 3,
    /** 空振りをかわす */
    dodge: 2,
    /** モンスターハウスで跳ねる高さ */
    hop: 5,
};
/** 透明のときの不透明度（旧 renderer.ts と同じ） */
const INVISIBLE_ALPHA = 0.32;
/** これより遠くへ動いたら滑らせずに置き直す（マス）。ワープや吹き飛ばし */
const TELEPORT_TILES = 3;
/** 足元はマスの (8, 13) */
const FOOT_X = 8;
const FOOT_Y = 13;
const SLEEP_BITS = STATUS_BIT.asleep | STATUS_BIT.deepAsleep | STATUS_BIT.fainted;
const FREEZE_BITS = STATUS_BIT.paralyzed;
/** 8 方向の単位ベクトル（0 = 北から時計回り） */
const DIR_X = [0, 1, 1, 1, 0, -1, -1, -1];
const DIR_Y = [-1, -1, 0, 1, 1, 1, 0, -1];
// 緩急（ease-out-quad・ease-in・ease-in-out）は step() の中に式のまま書く。
// 小さな関数でも、大きな step() からは呼び出しのまま残ることがあり、そのとき小数の引数と戻り値に
// 毎回箱（HeapNumber）が作られる。毎刻み・1 体ごとに通る所なので割り当てを出さない
/** ベクトル → 8 方向（ゼロなら fallback） */
export function dirOfVec(dx, dy, fallback) {
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    for (let i = 0; i < 8; i++)
        if (DIR_X[i] === sx && DIR_Y[i] === sy)
            return i;
    return fallback;
}
// ---------------------------------------------------------------------------
// キャラ 1 体
// ---------------------------------------------------------------------------
export class ActorAnim {
    // --- 描く側が読む値（ActorDrawable）
    id = -1;
    kind = 'monster';
    species = '';
    disguise = null;
    boss = false;
    anim = 'idle';
    dir8 = 4;
    frame = 0;
    artX = 0;
    artY = 0;
    lift = 0;
    submerge = 0;
    alpha = 1;
    flash = 0;
    dying = false;
    dissolve = 0;
    warp = 0;
    grey = 0;
    statusMask = 0;
    asleep = false;
    tileX = 0;
    tileY = 0;
    fx = 0;
    fy = 0;
    // --- 台帳
    /** 詰めた配列の中の位置 */
    slot = -1;
    /** 最後に同期で見かけた回 */
    stamp = 0;
    /** 今ゲームの一覧に居るか（倒された・消えたら false） */
    present = false;
    /** 論理上のマスが今見えているか */
    visible = false;
    defId = '';
    rig = null;
    hover = 0;
    /** 待機のコマをずらす位相 0〜1（全員が同時に呼吸しないように） */
    phase = 0;
    paralyzed = false;
    invisible = false;
    /** 最後の同期で見た HP（1 手のダメージの合計が HP を超えないように、計画で使う） */
    hp = 0;
    // --- 移動
    fromX = 0;
    fromY = 0;
    toX = 0;
    toY = 0;
    moveT = 0;
    moveDur = 0;
    /** 歩いた距離（マス）。歩きのコマはこれで進める（足が滑らない） */
    walkDist = 0;
    walkHold = 0;
    // --- 動き
    state = 'idle';
    /** 今の動きの経過（等速のミリ秒） */
    stateT = 0;
    stateDur = 0;
    /** 止まっている残り（ミリ秒、実時間）。当たりの瞬間の手応え */
    hitstop = 0;
    // --- 踏み込み（攻撃・体当たり）
    lungeX = 0;
    lungeY = 0;
    lungeUX = 0;
    lungeUY = 0;
    lungeT = 0;
    lungeDur = 0;
    lungeStrike = 0;
    lungeAmp = 0;
    // --- 下がる（被弾・かわす）
    knockX = 0;
    knockY = 0;
    knockUX = 0;
    knockUY = 0;
    knockT = 0;
    knockDur = 0;
    knockAmp = 0;
    // --- 跳ねる（モンスターハウス）
    hopT = 0;
    hopDur = 0;
    // --- 生き死に
    /** 倒された。撃破の瞬間（タイムラインの DEFEAT）まで普通に描く */
    pendingDefeat = false;
    /** 湧いて見えてくる 0〜1 */
    spawnT = 1;
    vanishing = false;
    vanishT = 0;
    /** ワープ中。1 = 縮む、-1 = 伸びる、0 = なし */
    warpDir = 0;
    warpT = 0;
    /** ワープの着地待ち。同期で勝手に新しい位置へ滑らせない */
    warpLock = false;
    /** 倒れた主人公（最後のコマで止め、灰色にしていく） */
    downed = false;
    /** 返すときに全部を初期値へ戻す（使い回しで前の値が残らないように） */
    reset() {
        this.id = -1;
        this.kind = 'monster';
        this.species = '';
        this.disguise = null;
        this.boss = false;
        this.anim = 'idle';
        this.dir8 = 4;
        this.frame = 0;
        this.artX = 0;
        this.artY = 0;
        this.lift = 0;
        this.submerge = 0;
        this.alpha = 1;
        this.flash = 0;
        this.dying = false;
        this.dissolve = 0;
        this.warp = 0;
        this.grey = 0;
        this.statusMask = 0;
        this.asleep = false;
        this.tileX = 0;
        this.tileY = 0;
        this.fx = 0;
        this.fy = 0;
        this.slot = -1;
        this.stamp = 0;
        this.present = false;
        this.visible = false;
        this.defId = '';
        this.rig = null;
        this.hover = 0;
        this.phase = 0;
        this.paralyzed = false;
        this.invisible = false;
        this.hp = 0;
        this.fromX = 0;
        this.fromY = 0;
        this.toX = 0;
        this.toY = 0;
        this.moveT = 0;
        this.moveDur = 0;
        this.walkDist = 0;
        this.walkHold = 0;
        this.state = 'idle';
        this.stateT = 0;
        this.stateDur = 0;
        this.hitstop = 0;
        this.lungeX = 0;
        this.lungeY = 0;
        this.lungeUX = 0;
        this.lungeUY = 0;
        this.lungeT = 0;
        this.lungeDur = 0;
        this.lungeStrike = 0;
        this.lungeAmp = 0;
        this.knockX = 0;
        this.knockY = 0;
        this.knockUX = 0;
        this.knockUY = 0;
        this.knockT = 0;
        this.knockDur = 0;
        this.knockAmp = 0;
        this.hopT = 0;
        this.hopDur = 0;
        this.pendingDefeat = false;
        this.spawnT = 1;
        this.vanishing = false;
        this.vanishT = 0;
        this.warpDir = 0;
        this.warpT = 0;
        this.warpLock = false;
        this.downed = false;
    }
    /** 滑らせずにその場へ置く */
    place(x, y) {
        this.tileX = x;
        this.tileY = y;
        this.fx = x;
        this.fy = y;
        this.fromX = x;
        this.fromY = y;
        this.toX = x;
        this.toY = y;
        this.moveT = 0;
        this.moveDur = 0;
    }
    /** 移動の補間の途中か */
    get moving() {
        return this.moveT < this.moveDur;
    }
}
export class ActorRegistry {
    /** アニメ速度の倍率（設定の「アニメ速度」。0.001 で瞬間） */
    speedScale = 1;
    listener = null;
    /** これまでに作った ActorAnim の数（使い回しが効いているかの検査用） */
    created = 0;
    /**
     * 見た目の通しの時刻（ミリ秒）。待機のコマの位相に使う。
     * 台帳が自分で持つのは、小数を関数の引数で渡すと V8 が毎回箱（HeapNumber）を作るため
     */
    clockMs = 0;
    /**
     * 固定刻みの長さ（ミリ秒）。tick() はこれだけ進める。
     * 刻みの長さを毎回引数で渡すと、V8 が小数の箱（HeapNumber）を作ることがあるので持っておく
     */
    tickMs = 1000 / 60;
    /** 今の刻みの長さ（実時間）と、速度の倍率で割った長さ（動きの時計） */
    stepMs = 0;
    actMs = 0;
    byId = new Map();
    list = [];
    listCount = 0;
    pool = [];
    poolCount = 0;
    order = [];
    orderCount = 0;
    stamp = 0;
    /** この階の最初の同期を済ませたか（済む前に居た者は湧いた扱いにしない） */
    synced = false;
    /** 台帳に居る数（亡骸・消えかけを含む） */
    get count() {
        return this.listCount;
    }
    /** 返されて次を待っている数 */
    get freeCount() {
        return this.poolCount;
    }
    /** この階の最初の同期を済ませたか */
    get hasSynced() {
        return this.synced;
    }
    /** i 番目（0 ≦ i < count）。並びに意味は無い */
    at(i) {
        return this.list[i];
    }
    get(id) {
        return this.byId.get(id);
    }
    /** 全部を返す（階の移動・画面に入り直したとき） */
    releaseAll() {
        for (let i = this.listCount - 1; i >= 0; i--)
            this.release(this.list[i]);
        this.synced = false;
    }
    /** 1 体を台帳から外して置き場へ返す */
    release(a) {
        if (a.id < 0 || a.slot < 0)
            return;
        this.byId.delete(a.id);
        const i = a.slot;
        const last = this.list[this.listCount - 1];
        this.list[i] = last;
        last.slot = i;
        this.listCount--;
        a.reset();
        if (this.poolCount < this.pool.length)
            this.pool[this.poolCount] = a;
        else
            this.pool.push(a);
        this.poolCount++;
    }
    // ------------------------------------------------------------ 同期
    /**
     * ゲームの一覧（player・allies・monsters）を直接たどって、目標のマス・種・向き・
     * 状態異常・化けの皮・見えているかを写す。world.allActors() は配列を作るので使わない。
     *
     * 一覧から消えた者は、倒された印（pendingDefeat）・崩れている最中・ワープの着地待ちなら残す。
     * それ以外は「倒されずに居なくなった」ので、見えるマスなら短く消し、見えなければすぐ返す。
     */
    sync(run, map) {
        const stamp = ++this.stamp;
        this.syncActor(run.player, map, stamp);
        const allies = run.allies;
        for (let i = 0; i < allies.length; i++)
            this.syncActor(allies[i], map, stamp);
        const monsters = run.monsters;
        for (let i = 0; i < monsters.length; i++)
            this.syncActor(monsters[i], map, stamp);
        for (let i = this.listCount - 1; i >= 0; i--) {
            const a = this.list[i];
            if (a.stamp === stamp)
                continue;
            a.present = false;
            a.visible = tileVisible(map, a.tileX, a.tileY);
            if (a.pendingDefeat || a.dying || a.warpLock || a.vanishing)
                continue;
            if (!a.visible) {
                this.release(a);
                continue;
            }
            this.startVanish(a);
            this.listener?.actorVanished(a);
        }
        this.synced = true;
    }
    /**
     * id のアクターを一覧から探して台帳に載せる（同期より先にイベントが来たとき用）。
     * 既に居ればそれを返す。一覧にも居なければ undefined。
     */
    ensure(id, run, map) {
        const known = this.byId.get(id);
        if (known)
            return known;
        const actor = findActor(run, id);
        if (!actor)
            return undefined;
        this.syncActor(actor, map, this.stamp);
        return this.byId.get(id);
    }
    syncActor(actor, map, stamp) {
        let a = this.byId.get(actor.id);
        const fresh = a === undefined;
        if (!a) {
            a = this.alloc(actor.id);
            a.place(actor.pos.x, actor.pos.y);
        }
        a.stamp = stamp;
        a.present = true;
        // 消えかけていた者が一覧に戻った（同じ id）。消すのをやめて、そのまま描き続ける
        if (a.vanishing) {
            a.vanishing = false;
            a.vanishT = 0;
        }
        this.refresh(a, actor);
        if (!a.warpLock && (actor.pos.x !== a.tileX || actor.pos.y !== a.tileY)) {
            this.moveTo(a, actor.pos.x, actor.pos.y);
        }
        a.visible = tileVisible(map, a.tileX, a.tileY);
        if (fresh && this.synced && a.kind !== 'player' && a.visible) {
            a.spawnT = 0;
            this.listener?.actorAppeared(a);
        }
    }
    alloc(id) {
        let a;
        if (this.poolCount > 0) {
            a = this.pool[--this.poolCount];
        }
        else {
            a = new ActorAnim();
            this.created++;
        }
        a.reset();
        a.id = id;
        a.phase = hashFloat(id, 0, 0x51de);
        a.slot = this.listCount;
        if (this.listCount < this.list.length)
            this.list[this.listCount] = a;
        else
            this.list.push(a);
        this.listCount++;
        this.byId.set(id, a);
        return a;
    }
    /** 種・向き・状態異常を写す。種が変わったとき（成長・仲間になる）だけリグを引き直す */
    refresh(a, actor) {
        const kindChanged = a.kind !== actor.kind;
        a.kind = actor.kind;
        if (actor.kind === 'player') {
            if (a.species !== 'player' || kindChanged) {
                a.defId = 'player';
                a.species = 'player';
                this.resolveSpecies(a);
            }
            a.disguise = null;
        }
        else {
            if (a.defId !== actor.defId || kindChanged) {
                a.defId = actor.defId;
                a.species = actor.defId;
                this.resolveSpecies(a);
            }
            a.disguise = actor.disguise ? actor.disguise.defId : null;
        }
        a.dir8 = actor.dir;
        a.hp = actor.hp;
        let mask = 0;
        const st = actor.statuses;
        for (let i = 0; i < st.length; i++) {
            if (st[i].turns !== 0)
                mask |= STATUS_BIT[st[i].id] ?? 0;
        }
        a.statusMask = mask;
        a.asleep = (actor.kind !== 'player' && actor.asleep) || (mask & SLEEP_BITS) !== 0;
        a.paralyzed = (mask & FREEZE_BITS) !== 0;
        a.invisible = (mask & STATUS_BIT.invisible) !== 0;
    }
    resolveSpecies(a) {
        const sp = getSpecies(a.species);
        const rig = sp ? getRig(sp.rig) : undefined;
        a.rig = rig ?? null;
        a.hover = rig?.hover ?? 0;
        a.submerge = rig?.submerge ?? 0;
        a.boss = a.kind !== 'player' && isBossDef(a.defId);
    }
    // ------------------------------------------------------------ 動かす
    /** 論理上のマスを変え、今の見た目の位置から滑らせる。遠ければ置き直す */
    moveTo(a, x, y) {
        if (Math.abs(x - a.fx) > TELEPORT_TILES || Math.abs(y - a.fy) > TELEPORT_TILES) {
            a.place(x, y);
            return;
        }
        a.tileX = x;
        a.tileY = y;
        a.fromX = a.fx;
        a.fromY = a.fy;
        a.toX = x;
        a.toY = y;
        a.moveT = 0;
        a.moveDur = Math.max(1, ANIM.move * this.speedScale);
    }
    /** 動きのコマの進み方（リグがあればリグ、無ければ既定） */
    timing(a, id) {
        const def = a.rig ? a.rig.anims[id] : undefined;
        if (def)
            return def;
        return (a.kind === 'player' ? HERO_TIMING : MONSTER_TIMING)[id];
    }
    /** 攻撃の当たりまで（等速のミリ秒）。台帳に居なければ既定 */
    strikeMs(id) {
        const a = this.byId.get(id);
        const tm = a ? this.timing(a, 'attack') : MONSTER_TIMING.attack;
        return ((tm.strike ?? 2) * 1000) / tm.fps;
    }
    /** そのマスに居る（生きている）キャラの id。居なければ -1 */
    actorAtTile(x, y) {
        for (let i = 0; i < this.listCount; i++) {
            const a = this.list[i];
            if (a.present && !a.dying && a.tileX === x && a.tileY === y)
                return a.id;
        }
        return -1;
    }
    /** 攻撃：振りかぶり → 当たりのコマで踏み込む → 戻る。ux, uy は相手への向き */
    startAttack(a, ux, uy) {
        if (a.dying || a.downed)
            return;
        const tm = this.timing(a, 'attack');
        this.setState(a, 'attack', tm);
        a.dir8 = dirOfVec(ux, uy, a.dir8);
        this.setLunge(a, ux, uy, ACTOR_PX.lunge, ((tm.strike ?? 2) * 1000) / tm.fps, a.stateDur);
    }
    /** 壁や動けない所へぶつかる：短く押し込むだけ（姿勢は変えない） */
    startBump(a, dir8) {
        if (a.dying || a.downed)
            return;
        const d = ((dir8 % 8) + 8) % 8;
        a.dir8 = d;
        this.setLunge(a, DIR_X[d], DIR_Y[d], ACTOR_PX.bump, ACTOR_TIMES.bumpStrike, ACTOR_TIMES.bump);
    }
    /** 詠唱（杖・魔法・息） */
    startCast(a) {
        if (a.dying || a.downed)
            return;
        this.setState(a, 'cast', this.timing(a, 'cast'));
    }
    /** 道具を使う・投げる・掲げる */
    startUse(a) {
        if (a.dying || a.downed)
            return;
        this.setState(a, 'use', this.timing(a, 'use'));
    }
    /** 被弾：白く光って ux, uy の向きへ下がる */
    startHurt(a, ux, uy, px) {
        a.flash = 1;
        if (a.dying)
            return;
        if (!a.downed)
            this.setState(a, 'hurt', this.timing(a, 'hurt'));
        this.setKnock(a, ux, uy, px, ACTOR_TIMES.knock);
    }
    /** 空振りをかわす：攻撃の向きと直角へ少しずれて戻る */
    dodge(a, ux, uy) {
        if (a.dying)
            return;
        // 攻撃の向きを 90° 回す。向きが無ければ横へ
        const px = ux === 0 && uy === 0 ? 1 : -uy;
        const py = ux === 0 && uy === 0 ? 0 : ux;
        this.setKnock(a, px, py, ACTOR_PX.dodge, ACTOR_TIMES.dodge);
    }
    /** 倒れる：白く光ってから 4 段で崩れ、終わったら返す */
    startDeath(a) {
        a.pendingDefeat = false;
        a.dying = true;
        a.state = 'death';
        a.stateT = 0;
        a.stateDur = ACTOR_TIMES.deathFlash + ACTOR_TIMES.dissolveStep * ACTOR_TIMES.dissolveSteps;
        a.flash = 1;
        a.disguise = null;
    }
    /** 倒されずに居なくなった：短く薄れて返す */
    startVanish(a) {
        a.vanishing = true;
        a.vanishT = 0;
    }
    /** モンスターハウス：その場で跳ねる */
    hop(a) {
        a.hopT = 0;
        a.hopDur = ACTOR_TIMES.hop;
    }
    /** ワープで縦に縮んで消える */
    warpOut(a) {
        a.warpDir = 1;
        a.warpT = 0;
    }
    /** ワープの着地：新しいマスへ置き、縦に伸びて現れる */
    warpIn(a, x, y) {
        a.place(x, y);
        a.warpLock = false;
        a.warpDir = -1;
        a.warpT = 0;
    }
    /** 主人公が倒れた：被弾の最後のコマで止め、灰色にしていく */
    setDowned(a) {
        if (a.downed)
            return;
        a.downed = true;
        this.setState(a, 'hurt', this.timing(a, 'hurt'));
    }
    /** 姿勢を止める（当たりの瞬間の手応え）。ms は実時間 */
    freeze(a, ms) {
        if (ms > a.hitstop)
            a.hitstop = ms;
    }
    setState(a, s, tm) {
        a.state = s;
        a.stateT = 0;
        a.stateDur = (tm.frames * 1000) / tm.fps;
    }
    setLunge(a, ux, uy, px, strike, dur) {
        const n = ux !== 0 && uy !== 0 ? Math.SQRT1_2 : 1;
        a.lungeUX = ux * n;
        a.lungeUY = uy * n;
        a.lungeAmp = px;
        a.lungeT = 0;
        a.lungeStrike = Math.max(1, strike);
        a.lungeDur = Math.max(a.lungeStrike + 1, dur);
    }
    setKnock(a, ux, uy, px, dur) {
        const len = Math.hypot(ux, uy);
        a.knockUX = len > 0 ? ux / len : 0;
        a.knockUY = len > 0 ? uy / len : 0;
        a.knockAmp = px;
        a.knockT = 0;
        a.knockDur = dur;
    }
    // ------------------------------------------------------------ 毎刻み
    /**
     * ms（実時間）ぶん進める（通しの時刻も進む）。0 なら進めずに描く値だけ作り直す。
     * 崩れ終わった亡骸・消え終わった者はここで返す。
     */
    update(ms) {
        this.stepMs = ms;
        this.advanceAll();
    }
    /** 固定刻み（tickMs）ぶん進める。毎刻みはこちら */
    tick() {
        this.stepMs = this.tickMs;
        this.advanceAll();
    }
    advanceAll() {
        const ms = this.stepMs;
        this.clockMs += ms;
        // 動き（攻撃・崩れ…）は速度の倍率で縮める。移動の補間は moveDur に掛け済み
        this.actMs = ms / Math.max(0.001, this.speedScale);
        for (let i = this.listCount - 1; i >= 0; i--) {
            const a = this.list[i];
            if (this.step(a))
                this.release(a);
        }
    }
    /**
     * 1 体を進める。返してよければ true。
     * 刻みの長さは引数ではなく stepMs / actMs から読む（小数を引数で渡すと毎回箱が作られる）
     */
    step(a) {
        const ms = this.stepMs;
        const act = this.actMs;
        // --- 位置（60Hz で滑らかに）
        if (a.moveT < a.moveDur) {
            a.moveT = Math.min(a.moveDur, a.moveT + ms);
            const u = 1 - a.moveT / a.moveDur;
            const e = 1 - u * u;
            const nx = a.fromX + (a.toX - a.fromX) * e;
            const ny = a.fromY + (a.toY - a.fromY) * e;
            a.walkDist += Math.max(Math.abs(nx - a.fx), Math.abs(ny - a.fy));
            a.fx = nx;
            a.fy = ny;
            a.walkHold = ACTOR_TIMES.walkHold;
        }
        else if (a.walkHold > 0) {
            a.walkHold -= ms;
        }
        // --- 姿勢の時計（止まっている間は進めない）
        if (a.hitstop > 0) {
            a.hitstop -= ms;
        }
        else {
            a.stateT += act;
            if (a.lungeT < a.lungeDur)
                a.lungeT += act;
            if (a.knockT < a.knockDur)
                a.knockT += act;
            if (a.hopT < a.hopDur)
                a.hopT += act;
            if (a.flash > 0 && !(a.dying && a.stateT < ACTOR_TIMES.deathFlash)) {
                a.flash = Math.max(0, a.flash - act / ACTOR_TIMES.flashDecay);
            }
        }
        // --- 動きの切り替え
        switch (a.state) {
            case 'attack':
            case 'cast':
            case 'use':
            case 'hurt':
                if (a.stateT >= a.stateDur && !a.downed) {
                    a.state = this.baseState(a);
                    a.stateT = 0;
                }
                break;
            case 'death':
                if (a.stateT >= a.stateDur)
                    return true;
                break;
            default:
                a.state = this.baseState(a);
                break;
        }
        // --- コマ
        const animId = a.state === 'death' ? 'hurt' : a.state;
        const tm = this.timing(a, animId);
        const frames = Math.max(1, tm.frames);
        let frame = 0;
        switch (a.state) {
            case 'walk':
                frame = Math.floor(a.walkDist * 4) % frames;
                break;
            case 'idle':
            case 'sleep':
                frame = a.paralyzed ? 0 : Math.floor((this.clockMs * tm.fps) / 1000 + a.phase * frames) % frames;
                break;
            case 'death':
                frame = 0;
                break;
            default:
                frame = a.downed ? frames - 1 : Math.min(frames - 1, Math.floor((a.stateT * tm.fps) / 1000));
                break;
        }
        a.anim = animId;
        a.frame = frame < 0 ? 0 : frame;
        // --- 崩れ
        if (a.dying) {
            const t = a.stateT - ACTOR_TIMES.deathFlash;
            a.dissolve = t < 0 ? 0 : Math.min(ACTOR_TIMES.dissolveSteps, 1 + Math.floor(t / ACTOR_TIMES.dissolveStep));
            if (t >= 0)
                a.flash = 0;
        }
        // --- 踏み込み（振りかぶって少し引く → 当たりで踏み込む → 戻る）
        if (a.lungeT < a.lungeDur) {
            const t = a.lungeT;
            const s = a.lungeStrike;
            let k;
            if (t < s * 0.5) {
                // 振りかぶって少し引く（ease-out）
                const u = 1 - t / (s * 0.5);
                k = -0.25 * (1 - u * u);
            }
            else if (t < s) {
                // 踏み込む（ease-in）
                const u = (t - s * 0.5) / (s * 0.5);
                k = -0.25 + 1.25 * u * u;
            }
            else {
                // 戻る（ease-in-out）
                const u = (t - s) / (a.lungeDur - s);
                k = 1 - (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
            }
            a.lungeX = a.lungeUX * a.lungeAmp * k;
            a.lungeY = a.lungeUY * a.lungeAmp * k;
        }
        else {
            a.lungeX = 0;
            a.lungeY = 0;
        }
        // --- 下がる（すぐ下がって、ゆっくり戻る）
        if (a.knockT < a.knockDur) {
            const p = a.knockT / a.knockDur;
            const u = (p - 0.2) / 0.8;
            const f = p < 0.2 ? p / 0.2 : 1 - (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
            a.knockX = a.knockUX * a.knockAmp * f;
            a.knockY = a.knockUY * a.knockAmp * f;
        }
        else {
            a.knockX = 0;
            a.knockY = 0;
        }
        // --- 跳ねる
        let hopLift = 0;
        if (a.hopT < a.hopDur)
            hopLift = ACTOR_PX.hop * Math.sin((Math.PI * a.hopT) / a.hopDur);
        // --- ワープ
        if (a.warpDir !== 0) {
            a.warpT += act;
            if (a.warpDir > 0) {
                a.warp = Math.min(1, a.warpT / ACTOR_TIMES.warpOut);
            }
            else {
                a.warp = Math.max(0, 1 - a.warpT / ACTOR_TIMES.warpIn);
                if (a.warp <= 0)
                    a.warpDir = 0;
            }
        }
        // --- 見えてくる・消える・灰色
        if (a.spawnT < 1)
            a.spawnT = Math.min(1, a.spawnT + act / ACTOR_TIMES.spawnFade);
        let fade = 1;
        if (a.vanishing) {
            a.vanishT += act;
            if (a.vanishT >= ACTOR_TIMES.vanish)
                return true;
            fade = 1 - a.vanishT / ACTOR_TIMES.vanish;
        }
        if (a.downed && a.grey < 1)
            a.grey = Math.min(1, a.grey + act / ACTOR_TIMES.downGrey);
        a.alpha = (a.invisible ? INVISIBLE_ALPHA : 1) * a.spawnT * fade * (a.warp >= 1 ? 0 : 1);
        a.artX = Math.round(a.fx * TILE_ART + FOOT_X + a.lungeX + a.knockX);
        a.artY = Math.round(a.fy * TILE_ART + FOOT_Y + a.lungeY + a.knockY);
        a.lift = a.hover + Math.round(hopLift);
        return false;
    }
    baseState(a) {
        if (a.moveT < a.moveDur || a.walkHold > 0)
            return 'walk';
        return a.asleep ? 'sleep' : 'idle';
    }
    // ------------------------------------------------------------ 描く順
    /**
     * 描けるキャラを足元の y → x → id の順に並べ、数を返す。以後 drawableAt(i) で取り出す。
     * 並べ替えは確保済みの配列の挿入ソート（前のフレームとほぼ同じ並びなのでほぼ一巡で済む）。
     */
    sortDrawables() {
        let n = 0;
        for (let i = 0; i < this.listCount; i++) {
            const a = this.list[i];
            if (!isDrawable(a))
                continue;
            if (n < this.order.length)
                this.order[n] = a;
            else
                this.order.push(a);
            n++;
        }
        const o = this.order;
        for (let i = 1; i < n; i++) {
            const v = o[i];
            let j = i - 1;
            while (j >= 0 && drawsAfter(o[j], v)) {
                o[j + 1] = o[j];
                j--;
            }
            o[j + 1] = v;
        }
        this.orderCount = n;
        return n;
    }
    /** sortDrawables() で並べた i 番目 */
    drawableAt(i) {
        return this.order[i];
    }
    /** 最後に並べた数 */
    get drawableCount() {
        return this.orderCount;
    }
}
/**
 * 描いてよいか。主人公以外は論理上のマスが今見えている時だけ
 * （見えないマスの敵は影・光・飾りも含めて一切描かない）。
 */
export function isDrawable(a) {
    if (a.id < 0 || a.alpha <= 0)
        return false;
    return a.kind === 'player' || a.visible;
}
/** a を b より後に描くか（奥から手前へ） */
function drawsAfter(a, b) {
    if (a.artY !== b.artY)
        return a.artY > b.artY;
    if (a.artX !== b.artX)
        return a.artX > b.artX;
    return a.id > b.id;
}
function tileVisible(map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height)
        return false;
    return map.tiles[y * map.width + x].visible;
}
/** 一覧を直接たどって id のアクターを探す（配列を作らない） */
function findActor(run, id) {
    if (run.player.id === id)
        return run.player;
    for (let i = 0; i < run.allies.length; i++)
        if (run.allies[i].id === id)
            return run.allies[i];
    for (let i = 0; i < run.monsters.length; i++)
        if (run.monsters[i].id === id)
            return run.monsters[i];
    return null;
}
/** ボスか。知らない id（検証の場面の仮の種）は false */
function isBossDef(defId) {
    try {
        return getMonster(defId).isBoss === true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=actors.js.map