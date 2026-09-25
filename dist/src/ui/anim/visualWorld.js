/**
 * 見た目の世界（VisualWorld）。ゲームの論理と描画の間に立つ、DOM を持たない層。
 * 旧 src/ui/fx.ts（FxSystem）の役を置き換える。
 *
 * ロジックは決してアニメーションを待たない。ここは見た目を追従させるだけなので、
 * 入力が速ければ残りを一度に出し切って追いつく（取りこぼさない）。
 * ゲームの乱数（world.rng）と Math.random は一切使わない。見た目を通しても通さなくても
 * リプレイは同じ結果になる（test/visual.test.ts で固定）。
 *
 * ===========================================================================
 * 使い方（DungeonScreen と合成の担当へ）
 * ===========================================================================
 *
 *   const vw = new VisualWorld(sink);            // sink は描く側が実装する VfxSink（anim/types.ts）
 *   vw.speedScale = animScale(settings.animSpeed);
 *   vw.reduceMotion = settings.reduceMotion;
 *   vw.reset();                                  // 画面に入った時（enter）
 *
 *   // pumpEvents()：drainEvents() の結果を 1 手ぶんにつき 1 回渡す
 *   const now = vw.ingest(events, world);        // message と bgm だけが返る。ログと音楽はその場で出す
 *   for (const e of now) { message → app.log / recorder、bgm → audio.playBgm }
 *   // sfx はここに渡した後は自分で鳴らさない（当たりの瞬間に sink.sfx が呼ばれる）
 *   // 被弾でダッシュを止める・モンスターハウスで方向を離す、などの判定は今までどおり events を見る
 *
 *   // act(action) の直前：
 *   vw.notePlayerAction(action);                 // 食べる・読む・投げるの姿勢と、ダッシュの土煙
 *
 *   // tick(stepMs)：固定 60Hz
 *   vw.tick(stepMs, world);
 *
 *   // 入力の足止め（旧 fx.isHolding）：階の暗転・モンスターハウス・ボス・倒れた・踏破
 *   if (vw.isHolding()) return;
 *
 *   // HUD の HP：当たった瞬間に減って見える
 *   const hp = vw.shownHp(player.id, player.hp, player.maxHp);
 *
 *   // 描く：カメラは世界の画用紙のドット。camX / camY は整数。tick() が主人公の見た目の位置を追う
 *   const cam = vw.camera;                        // cam.camX, cam.camY（揺れは sink.shake の側で足す）
 *   vw.forEachDrawable(drawActor);               // drawActor は 1 度だけ作った関数にする（毎フレーム作らない）
 *   // または：const n = vw.sortDrawables(); for (i < n) vw.drawableAt(i)
 *   //   並びは足元の y → x → id（奥から手前）。主人公以外は見えるマスに居る者だけが並ぶ
 *   //   d.disguise が null でないミミックは、床の道具と同じ経路で描くこと（正体を漏らさない）
 *   //   d.artX / d.artY は足元（世界のドット）。画用紙の上では d.artX - cam.camX
 *   //   d.lift だけ浮かせ、影は artY に置く。d.flash で白く、d.dissolve（1〜4）で崩す
 *
 *   // 階が変わった時の暗転・札は floorChange を受け取った時にここが sink.transition / banner を呼ぶ。
 *   // 地形のキャッシュの作り直しは描く側（階の番号の変化で判断）
 *
 * ===========================================================================
 * できごと → 見た目（GameEvent の全種類。計画の時刻は anim/timeline.ts）
 * ===========================================================================
 *
 * 拍：移動は t = 0。攻撃・体当たり・飛び道具・ビーム・爆発・ワナ・ワープごとに次の拍。
 * 「当たり」＝攻撃は当たりのコマ（約 133ms）、飛び道具は着弾、ビームは終端。撃破は当たり ＋ 80ms。
 * 見えないマスの数字・吹き出し・光は出さない（主人公と仲間は出す）。効果音は常に鳴らす。
 *
 *   message       … その場で呼ぶ側へ返す（ログ）
 *   bgm           … その場で呼ぶ側へ返す（音楽）
 *   move          … t = 0 で歩き（ease-out で滑らせ、歩いた距離でコマを進める）。ダッシュは土煙、水に入ると splash
 *   bump          … 拍（間 90）。向きへ 3 ドット押し込んで戻る
 *   attack        … 拍（間 170）。振りかぶり → 当たりのコマで 5 ドット踏み込む → 戻る。会心の印は当たりで効く
 *   miss          … 当たりで「MISS」、かわした側が 2 ドット横へずれる。敵の空振りは attack が無いので拍を起こす
 *   damage        … 当たりで数字（敵へ damage・自分へ damageToPlayer・会心 crit）、白く光って 2 ドット下がる、
 *                   火花（hitPhysical / hitFire / hitMagic）。会心は crit ＋ 白い閃き 90ms ＋ 揺れ 7 ＋ 止め 60ms。
 *                   自分への被弾は揺れ 3
 *   heal          … 当たりで「+N」、heal の粒、緑の光
 *   defeat        … 当たり ＋ 80ms で白く光る → 4 段で崩れる（death の粒・魂の光）。崩れ終えたら台帳へ返す。
 *                   見えないマスで倒れた者は亡骸を残さない
 *   levelUp       … 当たりで levelUp の粒・金の光・「LEVEL UP!」、主人公は掲げる（use）
 *   status        … 掛かった時だけ当たりで statusApplied（tag に状態）。常時の飾りは statusMask から描く側が
 *   projectile    … 拍（間 = 飛ぶ時間）。投げた者は use の姿勢、sink.projectile（着弾の時刻に合わせた ms）
 *   zap           … 拍（間 160）。撃った者は cast、sink.beam（色から属性）。同じ所からの続きは終端だけ延ばす
 *   itemGet       … 当たりで itemGet の粒（主人公の足元）
 *   itemDrop      … 当たり（撃破の後なら撃破に揃える）で小さな土煙
 *   explosion     … 拍（間 260）。explosion の粒（power に半径）・火の光・フラッシュ・揺れ 8
 *   warp          … 拍（間 200）。縦に縮んで消える → 着いた先で伸びて現れる、両端に warp の粒。
 *                   主人公ならカメラは飛ぶ。消えたまま居なくなった者（取り巻き）はそのまま返す
 *   trap          … 拍（間 150）。ワナごとの粒（矢・ガスの色・落とし穴の土煙・溶岩・水しぶき…）と小さな揺れ
 *   floorChange   … 残りを出し切り（前の階の数字・粒は出さず、音だけ鳴らす）、sink.transition('floorOut')、
 *                   台帳を空にして、暗転の半ばで transition('floorIn') と「B5F」の札。入力は ANIM.floorFade 止める
 *   monsterHouse  … 当たりで帯の告知・揺れ 8、見えている敵が一斉に跳ねる。入力を 600ms 止める
 *   bossAppear    … 当たりで帯の告知（名前つき）・揺れ 4、ボスが吠える（攻撃の姿勢）。入力を 700ms 止める
 *   sfx           … 放つ音（throw・zap・explosion…）は拍の始まり、それ以外は当たりで sink.sfx。
 *                   敵の当たりの音は attack より先に積まれるので、続く攻撃の拍の当たりへ回す
 *   flash         … 当たりで sink.flash（動きを減らす設定では弱く）
 *   shake         … 当たりで sink.shake（動きを減らす設定では出さない）
 *   pause         … 入力をその長さ止める
 *   gameOver      … 当たり ＋ 80ms で主人公が崩れ落ちて 1 秒かけて灰色に、帯の告知。
 *                   入力（と結果画面への切り替え）は、この手の演出の長さ ＋ 1.2 秒止める
 *   dungeonClear  … 当たりで勝ちの姿勢（use）・金の粒と光・帯の告知。止める長さは gameOver と同じ
 *
 * 掘った壁（杖）はできごとが無いので、1 手ごとに地形の種類を控えと比べ、壁から変わった見えるマスに dig を出す。
 * 倒されずに一覧から消えた者（泥棒が逃げた・落ちた）は土煙で短く消し、見えないマスならすぐ返す。
 * 新しく湧いた者は（階に入った最初を除き）見えるマスなら土煙の中から現れる。
 */
import { PAL_HEX, ci } from '../art/palette.js';
import { ANIM } from '../theme.js';
import { ACTOR_PX, ActorRegistry, dirOfVec } from './actors.js';
import { Camera } from './camera.js';
import { CUE, Timeline } from './timeline.js';
// ---------------------------------------------------------------------------
// 強さと長さ（等速のミリ秒・画面の画素）
// ---------------------------------------------------------------------------
export const VISUAL_FX = {
    /** 会心の白い閃き・揺れ・止め */
    critFlashMs: 90,
    critFlashAlpha: 0.35,
    critShake: 7,
    critShakeMs: 200,
    critHitstop: 60,
    /** 当たりの瞬間に両者の姿勢を止める（通常・会心） */
    hitFreeze: 40,
    critFreeze: 90,
    /** 自分への被弾の揺れ */
    hurtShake: 3,
    hurtShakeMs: 120,
    /** 爆発 */
    explosionShake: 8,
    explosionShakeMs: 260,
    explosionFlashAlpha: 0.25,
    explosionFlashMs: 200,
    explosionLightMs: 380,
    /** モンスターハウス・ボス */
    houseShake: 8,
    houseShakeMs: 300,
    bossShake: 4,
    bossShakeMs: 400,
    /** 入力を止める長さ（旧 fx.ts と同じ） */
    holdHouse: 600,
    holdBoss: 700,
    holdEnd: 1200,
    /** ゲームのフラッシュ（復活など）の不透明度。動きを減らす設定では弱く */
    eventFlashAlpha: 0.45,
    reducedFlashAlpha: 0.15,
};
const hex = (r, step) => PAL_HEX[ci(r, step)];
/** 光の色（パレットから） */
const LIGHT = {
    fire: hex('ember', 4),
    heal: hex('leaf', 4),
    gold: hex('gold', 5),
    soul: hex('sky', 5),
    explosion: hex('ember', 4),
    white: '#ffffff',
    explosionFlash: hex('ember', 5),
};
/** 状態異常が掛かった瞬間の粒の色 */
const STATUS_COLOR = {
    confused: hex('rose', 4),
    blind: hex('ink', 3),
    asleep: hex('indigo', 4),
    deepAsleep: hex('indigo', 3),
    bound: hex('gold', 4),
    paralyzed: hex('gold', 5),
    fainted: hex('bone', 4),
    poisoned: hex('moss', 4),
    deadlyPoisoned: hex('moss', 3),
    burning: hex('ember', 4),
    wet: hex('water', 4),
    slow: hex('moss', 3),
    quick: hex('sky', 5),
    invisible: hex('sky', 4),
    sealed: hex('violet', 4),
    hungryFast: hex('earth', 4),
    strUp: hex('crimson', 4),
    trapped: hex('steel', 4),
    levitate: hex('sky', 5),
    terrified: hex('violet', 3),
    invincible: hex('gold', 5),
};
/** ワナごとの粒。爆発・ワープ・モンスターハウスは別のできごとが続くので小さく */
const TRAP_VFX = {
    arrow: { preset: 'hitPhysical', color: '', shake: 0 },
    poisonArrow: { preset: 'hitPhysical', color: hex('moss', 4), shake: 0 },
    spike: { preset: 'dust', color: '', shake: 3 },
    sleepGas: { preset: 'trapGas', color: hex('indigo', 4), shake: 0 },
    confuseGas: { preset: 'trapGas', color: hex('rose', 4), shake: 0 },
    blindGas: { preset: 'trapGas', color: hex('ink', 3), shake: 0 },
    bearTrap: { preset: 'dust', color: hex('steel', 4), shake: 2 },
    rustTrap: { preset: 'statusApplied', color: hex('earth', 4), shake: 0 },
    rotTrap: { preset: 'trapGas', color: hex('moss', 3), shake: 0 },
    alarm: { preset: 'statusApplied', color: hex('gold', 5), shake: 2 },
    summon: { preset: 'warp', color: hex('violet', 4), shake: 0 },
    warp: { preset: 'warp', color: hex('sky', 4), shake: 0 },
    spin: { preset: 'statusApplied', color: hex('sky', 4), shake: 0 },
    mine: { preset: 'dust', color: '', shake: 0 },
    bigMine: { preset: 'dust', color: '', shake: 0 },
    slowTrap: { preset: 'statusApplied', color: hex('moss', 3), shake: 0 },
    weakenTrap: { preset: 'statusApplied', color: hex('stone', 4), shake: 0 },
    curseTrap: { preset: 'statusApplied', color: hex('violet', 4), shake: 0 },
    hungerTrap: { preset: 'statusApplied', color: hex('earth', 4), shake: 0 },
    sealTrap: { preset: 'statusApplied', color: hex('violet', 4), shake: 0 },
    monsterHouseTrap: { preset: 'statusApplied', color: hex('crimson', 4), shake: 2 },
    itemLossTrap: { preset: 'dust', color: '', shake: 3 },
    lavaTrap: { preset: 'hitFire', color: hex('ember', 4), shake: 3 },
    waterTrap: { preset: 'splash', color: hex('water', 4), shake: 0 },
};
/** ゲームが使っているビームの色 → 属性。知らない色は色相で決める */
const ZAP_ELEMENT = {
    '#ff8030': 'fire',
    '#ffd040': 'fire',
    '#ffe060': 'thunder',
    '#e0c040': 'thunder',
    '#a0e0ff': 'ice',
    '#50a0e0': 'water',
    '#60c0a0': 'poison',
    '#7080e0': 'magic',
    '#e070d0': 'magic',
    '#b07fd8': 'magic',
    '#c0a0ff': 'magic',
};
/** ビームの色から属性を決める（'#rrggbb'） */
export function elementOfColor(color) {
    const known = ZAP_ELEMENT[color.toLowerCase()];
    if (known)
        return known;
    const n = /^#[0-9a-fA-F]{6}$/.test(color) ? parseInt(color.slice(1), 16) : -1;
    if (n < 0)
        return 'magic';
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d < 0.08)
        return 'light';
    let h;
    if (max === r)
        h = ((g - b) / d + 6) % 6;
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    h *= 60;
    if (h < 40 || h >= 330)
        return 'fire';
    if (h < 70)
        return 'thunder';
    if (h < 165)
        return 'poison';
    if (h < 200)
        return 'ice';
    if (h < 245)
        return 'water';
    return 'magic';
}
/** モンスターハウスの種類 → 帯の添え書き（旧 fx.ts と同じ） */
function houseLabel(kind) {
    switch (kind) {
        case 'normal': return 'モンスターが あふれ出した';
        case 'big': return '大部屋いっぱいの モンスター';
        case 'item': return 'アイテムだらけだ';
        case 'trap': return 'ワナだらけだ';
        case 'ghost': return '亡霊たちの 巣';
        case 'gitan': return 'ギタンだらけだ';
        default: return '';
    }
}
const DIR_X = [0, 1, 1, 1, 0, -1, -1, -1];
const DIR_Y = [-1, -1, 0, 1, 1, 1, 0, -1];
/** 地形の種類 → 控えの番号（掘った壁を見つけるため） */
function kindCode(kind) {
    switch (kind) {
        case 'wall': return 1;
        case 'floor': return 2;
        case 'water': return 3;
        case 'lava': return 4;
        case 'stairs': return 5;
        case 'pit': return 6;
        default: return 7;
    }
}
const WALL_CODE = 1;
/** 仲間・主人公か（見えないマスでも数字を出してよい側） */
const isFriend = (a) => a.kind === 'player' || a.kind === 'ally';
// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------
export class VisualWorld {
    /** キャラの見た目の台帳 */
    registry = new ActorRegistry();
    /** 1 手の中の拍 */
    timeline = new Timeline();
    /** カメラ（世界の画用紙のドット） */
    camera = new Camera();
    /** 揺れ・止め・強いフラッシュを切る設定 */
    reduceMotion = false;
    sink;
    /** 固定刻みの長さ（各部品へ配った値） */
    tickMs = 1000 / 60;
    world = null;
    playerId = -1;
    speed = 1;
    holdMs = 0;
    /** 会心の止め（この間は拍も姿勢も進めない） */
    freezeMs = 0;
    snapCamera = true;
    /** 次の移動がダッシュか（notePlayerAction で知る。移動のできごとには載っていない） */
    dashNext = false;
    /** 前の階の残りを出し切っている間（前の階の位置に粒や数字を出さない） */
    muted = false;
    /** 倒れた・踏破で、組の終わりまで入力を止めたい長さ */
    endHold = 0;
    immediate = [];
    opts = { dir8: -1, power: 1, color: '', tag: '' };
    p1 = { x: 0, y: 0 };
    p2 = { x: 0, y: 0 };
    /** 地形の種類の控え（階ごと） */
    kinds = null;
    constructor(sink) {
        this.sink = sink;
        this.registry.listener = this;
    }
    /** 見た目の通しの時刻（ミリ秒、固定刻みで進む。会心の止めの間は進まない） */
    get clockMs() {
        return this.registry.clockMs;
    }
    /** 受け口を差し替える（描く側を作り直したとき） */
    setSink(sink) {
        this.sink = sink;
    }
    /** アニメ速度の倍率（設定の「アニメ速度」：なし 0.001・速い 0.6・普通 1） */
    get speedScale() {
        return this.speed;
    }
    set speedScale(v) {
        this.speed = v > 0 ? v : 0.001;
        this.registry.speedScale = this.speed;
        this.timeline.speedScale = this.speed;
    }
    // ------------------------------------------------------------ 入口
    /**
     * 1 手ぶんのできごとを受け取る。pumpEvents 1 回につき 1 回呼ぶ。
     *
     * 前の手の残りはここで一度に出し切る（数字も亡骸も取りこぼさない）。
     * 返すのは message と bgm だけ（その場でログと音楽へ）。配列は使い回すので次の ingest までに読むこと。
     */
    ingest(events, world) {
        this.world = world;
        this.playerId = world.run.player.id;
        this.immediate.length = 0;
        if (events.length === 0)
            return this.immediate;
        this.timeline.flush(this);
        this.endHold = 0;
        let from = 0;
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.t === 'message' || e.t === 'bgm')
                this.immediate.push(e);
            if (e.t !== 'floorChange')
                continue;
            // 階の移動を挟む：手前は前の階として出し切り（数字と粒は出さない）、台帳を空にして後ろを続ける
            this.planSegment(events, from, i, world);
            this.timeline.finish();
            this.muted = true;
            this.timeline.flush(this);
            this.muted = false;
            this.enterFloor(e.depth, world);
            from = i + 1;
        }
        this.planSegment(events, from, events.length, world);
        this.registry.sync(world.run, world.map);
        this.checkDig(world.map);
        this.timeline.finish();
        // 倒れた・踏破は、この手の演出が出し終わってから告知を読む時間だけ止める（どちらも倍率を掛け済み）
        if (this.endHold > 0)
            this.holdMs = Math.max(this.holdMs, this.endHold + this.timeline.batchMs);
        this.timeline.advance(0, this);
        // 描く前に 1 度も刻みが来なくても（120Hz の画面など）、新しい者の位置が決まっているように
        this.registry.update(0);
        this.dashNext = false;
        return this.immediate;
    }
    /**
     * 見た目を 1 刻み（固定 60Hz）進める。
     * 刻みの長さは各部品に持たせておき、引数では渡さない（小数を渡すと V8 が箱を作ることがある。
     * 毎刻みの割り当てをゼロにするため）。長さが変わった時だけ配り直す
     */
    tick(stepMs, world) {
        if (stepMs !== this.tickMs) {
            this.tickMs = stepMs;
            this.timeline.tickMs = stepMs;
            this.registry.tickMs = stepMs;
            this.camera.tickMs = stepMs;
        }
        this.world = world;
        this.playerId = world.run.player.id;
        if (this.holdMs > 0)
            this.holdMs = Math.max(0, this.holdMs - stepMs);
        this.registry.sync(world.run, world.map);
        if (this.kinds === null)
            this.checkDig(world.map);
        if (this.freezeMs > 0) {
            this.freezeMs -= stepMs;
            this.registry.update(0);
        }
        else {
            this.timeline.tick(this);
            this.registry.tick();
        }
        this.updateCamera(world);
    }
    /**
     * 主人公がこれから行う行動を知らせる（act() の直前）。
     * 食べる・読む・飲む・投げるには専用のできごとが無いので、姿勢はここで始める。
     * ダッシュの移動にも印が無いので、土煙を出すかをここで覚えておく。
     */
    notePlayerAction(action) {
        this.dashNext = action.type === 'move' && action.dash === true;
        if (action.type === 'use' || action.type === 'throw') {
            const p = this.registry.get(this.playerId);
            if (p)
                this.registry.startUse(p);
        }
    }
    /** 待っている合図を今すぐ全部出す */
    flush() {
        this.timeline.flush(this);
    }
    /**
     * 全部を捨てて最初から（画面に入った時・中断から戻った時）。
     * 次の同期で今居る者を湧いた扱いにせず並べ、カメラは主人公へ飛ぶ。
     */
    reset() {
        this.registry.releaseAll();
        this.timeline.clear();
        this.snapCamera = true;
        this.kinds = null;
        this.freezeMs = 0;
        this.holdMs = 0;
        this.endHold = 0;
        this.dashNext = false;
    }
    /** 入力を止めたい演出の最中か（階の暗転・モンスターハウス・ボス・倒れた・踏破・pause） */
    isHolding() {
        return this.holdMs > 0;
    }
    /** 入力を ms（× 速度の倍率）止める */
    hold(ms) {
        this.holdMs = Math.max(this.holdMs, ms * this.speed);
    }
    // ------------------------------------------------------------ HUD と描く側へ
    /** まだ当たっていないダメージ（HP から実際に減る分） */
    pendingDamage(actorId) {
        return this.timeline.pendingDamage(actorId);
    }
    /** まだ出ていない回復 */
    pendingHeal(actorId) {
        return this.timeline.pendingHeal(actorId);
    }
    /** HUD に出す HP。当たりの瞬間まで前の値を見せる */
    shownHp(actorId, hp, maxHp) {
        const v = hp + this.timeline.pendingDamage(actorId) - this.timeline.pendingHeal(actorId);
        return v < 0 ? 0 : v > maxHp ? maxHp : v;
    }
    /** 描けるキャラを奥から手前へ並べて数を返す。drawableAt(i) で取り出す */
    sortDrawables() {
        return this.registry.sortDrawables();
    }
    drawableAt(i) {
        return this.registry.drawableAt(i);
    }
    /** 描けるキャラを奥から手前へ 1 体ずつ渡す。cb は毎フレーム作らないこと */
    forEachDrawable(cb) {
        const n = this.registry.sortDrawables();
        for (let i = 0; i < n; i++)
            cb(this.registry.drawableAt(i));
    }
    /** id のキャラの見た目（見えるかどうかに関係なく）。主人公のランタンの位置など */
    actor(id) {
        return this.registry.get(id);
    }
    // ------------------------------------------------------------ BeatContext
    strikeMs(actorId) {
        return this.registry.strikeMs(actorId);
    }
    actorAtTile(x, y) {
        return this.registry.actorAtTile(x, y);
    }
    locate(actorId, out) {
        const a = this.registry.get(actorId);
        if (!a)
            return false;
        out.x = a.tileX;
        out.y = a.tileY;
        return true;
    }
    hpOf(actorId) {
        const a = this.registry.get(actorId);
        return a ? a.hp : -1;
    }
    // ------------------------------------------------------------ RegistryListener
    actorAppeared(a) {
        if (this.muted)
            return;
        this.burst('dust', a.tileX, a.tileY, -1, 0.8, '', 'spawn');
    }
    actorVanished(a) {
        if (this.muted)
            return;
        this.burst('dust', a.fx, a.fy, -1, 0.6, '', 'vanish');
    }
    // ------------------------------------------------------------ 計画
    planSegment(events, from, to, world) {
        for (let i = from; i < to; i++)
            this.applyNow(events[i], world);
        this.timeline.plan(events, from, to, this);
    }
    /** 拍を待たずにその場で済ませること（移動・倒された印・ワープの着地待ち・入力の足止め） */
    applyNow(e, world) {
        const reg = this.registry;
        switch (e.t) {
            case 'move': {
                const a = reg.ensure(e.actorId, world.run, world.map);
                if (!a || a.warpLock)
                    return;
                reg.moveTo(a, e.to.x, e.to.y);
                if (a.kind === 'player' && this.dashNext && this.tileVisible(e.from.x, e.from.y)) {
                    this.burst('dust', e.from.x, e.from.y, dirOfVec(e.to.x - e.from.x, e.to.y - e.from.y, -1), 0.6, '', 'dash');
                }
                const t = this.tileOf(world.map, e.to.x, e.to.y);
                if (t === 'water' && (isFriend(a) || this.tileVisible(e.to.x, e.to.y))) {
                    this.burst('splash', e.to.x, e.to.y, -1, 0.6, '', 'step');
                }
                return;
            }
            case 'defeat': {
                const a = reg.get(e.actorId);
                if (!a)
                    return;
                // 見えないマスで倒れた者は亡骸を残さない（数字も出ない）
                if (!this.tileVisible(a.tileX, a.tileY)) {
                    reg.release(a);
                    return;
                }
                a.pendingDefeat = true;
                return;
            }
            case 'warp': {
                const a = reg.ensure(e.actorId, world.run, world.map);
                if (a)
                    a.warpLock = true;
                return;
            }
            case 'pause':
                this.hold(e.ms);
                return;
            case 'monsterHouse':
                this.hold(VISUAL_FX.holdHouse);
                return;
            case 'bossAppear':
                this.hold(VISUAL_FX.holdBoss);
                return;
            case 'gameOver':
            case 'dungeonClear':
                this.endHold = Math.max(this.endHold, VISUAL_FX.holdEnd * this.speed);
                return;
            default:
                return;
        }
    }
    /** 階に入った：暗転を始め、台帳を空にし、暗転の半ばで明けと札を出す */
    enterFloor(depth, world) {
        this.sink.transition('floorOut');
        this.reset();
        this.hold(ANIM.floorFade);
        const c = this.timeline.push(CUE.FLOOR_IN, ANIM.floorFade * 0.5 * this.speed);
        c.amount = depth;
        c.str = world.dungeon.name;
    }
    // ------------------------------------------------------------ 合図を出す
    fireCue(c) {
        const reg = this.registry;
        const s = this.speed;
        switch (c.kind) {
            case CUE.ATTACK: {
                const a = reg.get(c.actor);
                if (!a)
                    return;
                const t = c.target >= 0 ? reg.get(c.target) : undefined;
                if (t && (t.tileX !== a.tileX || t.tileY !== a.tileY)) {
                    reg.startAttack(a, Math.sign(t.tileX - a.tileX), Math.sign(t.tileY - a.tileY));
                }
                else {
                    reg.startAttack(a, DIR_X[a.dir8], DIR_Y[a.dir8]);
                }
                return;
            }
            case CUE.BUMP: {
                const a = reg.get(c.actor);
                if (a)
                    reg.startBump(a, c.amount);
                return;
            }
            case CUE.BEAM: {
                const a = c.actor >= 0 ? reg.get(c.actor) : undefined;
                if (a)
                    reg.startCast(a);
                if (this.muted)
                    return;
                // 見えている端が 1 つでもあれば出す（撃たれた側は見えている）
                if ((a && isFriend(a)) || this.tileVisible(c.x, c.y) || this.tileVisible(c.x2, c.y2)) {
                    this.sink.beam(this.pt1(c.x, c.y), this.pt2(c.x2, c.y2), c.str, elementOfColor(c.str), c.ms);
                    if (this.tileVisible(c.x2, c.y2))
                        this.light(c.x2, c.y2, c.str, 1.5, 0.7, 250);
                }
                return;
            }
            case CUE.THROW: {
                const a = c.actor >= 0 ? reg.get(c.actor) : undefined;
                if (a)
                    reg.startUse(a);
                if (this.muted)
                    return;
                if ((a && isFriend(a)) || this.tileVisible(c.x, c.y) || this.tileVisible(c.x2, c.y2)) {
                    this.sink.projectile(this.pt1(c.x, c.y), this.pt2(c.x2, c.y2), c.str === '' ? null : c.str, projectileKind(c.str2), c.ms);
                }
                return;
            }
            case CUE.EXPLODE: {
                if (this.muted)
                    return;
                const seen = this.tileVisible(c.x, c.y);
                const p = reg.get(this.playerId);
                const near = p !== undefined
                    && Math.max(Math.abs(p.tileX - c.x), Math.abs(p.tileY - c.y)) <= c.amount;
                if (seen) {
                    this.burst('explosion', c.x, c.y, -1, c.amount, '', '');
                    this.light(c.x, c.y, LIGHT.explosion, c.amount + 1.5, 1, VISUAL_FX.explosionLightMs);
                    this.sink.flash(LIGHT.explosionFlash, this.reduceMotion ? VISUAL_FX.reducedFlashAlpha : VISUAL_FX.explosionFlashAlpha, Math.max(1, VISUAL_FX.explosionFlashMs * s));
                }
                if ((seen || near) && !this.reduceMotion) {
                    this.sink.shake(VISUAL_FX.explosionShake, Math.max(1, VISUAL_FX.explosionShakeMs * s));
                }
                return;
            }
            case CUE.TRAP: {
                if (this.muted || !this.tileVisible(c.x, c.y))
                    return;
                const v = TRAP_VFX[c.str] ?? TRAP_VFX.spike;
                this.burst(v.preset, c.x, c.y, -1, 1, v.color, c.str);
                if (v.preset === 'hitFire')
                    this.light(c.x, c.y, LIGHT.fire, 2, 0.8, 300);
                if (v.shake > 0 && !this.reduceMotion)
                    this.sink.shake(v.shake, Math.max(1, 150 * s));
                return;
            }
            case CUE.WARP_OUT: {
                const a = reg.get(c.actor);
                if (!a)
                    return;
                reg.warpOut(a);
                if (!this.muted && this.shows(a, a.tileX, a.tileY))
                    this.burst('warp', a.fx, a.fy, -1, 1, '', 'out');
                return;
            }
            case CUE.WARP_IN: {
                const a = reg.get(c.actor);
                if (!a)
                    return;
                if (!a.present) {
                    // 取り巻きのように、縮んで消えたまま居なくなった
                    reg.release(a);
                    return;
                }
                reg.warpIn(a, c.x, c.y);
                a.visible = this.tileVisible(c.x, c.y);
                if (a.kind === 'player')
                    this.snapCamera = true;
                if (!this.muted && this.shows(a, c.x, c.y))
                    this.burst('warp', c.x, c.y, -1, 1, '', 'in');
                return;
            }
            case CUE.DAMAGE:
                this.fireDamage(c);
                return;
            case CUE.MISS: {
                const a = reg.get(c.actor);
                const src = c.target >= 0 ? reg.get(c.target) : undefined;
                if (a) {
                    const ux = src ? Math.sign(a.tileX - src.tileX) : 0;
                    const uy = src ? Math.sign(a.tileY - src.tileY) : 0;
                    reg.dodge(a, ux, uy);
                }
                if (this.muted || !this.shows(a, c.x, c.y))
                    return;
                this.sink.popup('MISS', 'miss', a ? a.fx : c.x, a ? a.fy : c.y);
                return;
            }
            case CUE.HEAL: {
                const a = reg.get(c.actor);
                if (this.muted || !this.shows(a, c.x, c.y))
                    return;
                const x = a ? a.fx : c.x;
                const y = a ? a.fy : c.y;
                this.sink.popup(`+${c.amount}`, 'heal', x, y);
                this.burst('heal', x, y, -1, 1, '', '');
                this.light(x, y, LIGHT.heal, 2, 0.6, 450);
                return;
            }
            case CUE.DEFEAT: {
                const a = reg.get(c.actor);
                if (!a)
                    return;
                if (this.muted) {
                    reg.release(a);
                    return;
                }
                reg.startDeath(a);
                if (this.shows(a, a.tileX, a.tileY)) {
                    this.burst('death', a.fx, a.fy, a.dir8, 1, '', a.species);
                    this.light(a.fx, a.fy, LIGHT.soul, 1.5, 0.7, 500);
                }
                return;
            }
            case CUE.LEVEL_UP: {
                const a = reg.get(c.actor);
                if (a)
                    reg.startUse(a);
                if (this.muted || !this.shows(a, c.x, c.y))
                    return;
                const x = a ? a.fx : c.x;
                const y = a ? a.fy : c.y;
                this.burst('levelUp', x, y, -1, 1, '', '');
                this.sink.popup('LEVEL UP!', 'levelUp', x, y);
                this.light(x, y, LIGHT.gold, 3, 0.9, 900);
                return;
            }
            case CUE.STATUS: {
                // 解けた時は何も出さない（常時の飾りが消えるだけ）
                if (!c.flag || this.muted)
                    return;
                const a = reg.get(c.actor);
                if (!this.shows(a, c.x, c.y))
                    return;
                this.burst('statusApplied', a ? a.fx : c.x, a ? a.fy : c.y, -1, 1, STATUS_COLOR[c.str] ?? '', c.str);
                return;
            }
            case CUE.ITEM_GET: {
                const p = reg.get(this.playerId);
                if (this.muted || !p)
                    return;
                this.burst('itemGet', p.fx, p.fy, -1, 1, '', '');
                return;
            }
            case CUE.ITEM_DROP:
                if (this.muted || !this.tileVisible(c.x, c.y))
                    return;
                this.burst('dust', c.x, c.y, -1, 0.5, '', 'item');
                return;
            case CUE.SFX:
                this.sink.sfx(c.str);
                return;
            case CUE.FLASH:
                if (this.muted)
                    return;
                this.sink.flash(c.str, this.reduceMotion ? VISUAL_FX.reducedFlashAlpha : VISUAL_FX.eventFlashAlpha, Math.max(1, c.ms * s));
                return;
            case CUE.SHAKE:
                if (this.muted || this.reduceMotion)
                    return;
                this.sink.shake(c.amount, Math.max(1, c.ms * s));
                return;
            case CUE.HOUSE: {
                if (this.muted)
                    return;
                this.sink.banner('モンスターハウス！', houseLabel(c.str), 'house');
                if (!this.reduceMotion)
                    this.sink.shake(VISUAL_FX.houseShake, Math.max(1, VISUAL_FX.houseShakeMs * s));
                for (let i = 0; i < reg.count; i++) {
                    const a = reg.at(i);
                    if (a.kind === 'monster' && a.present && a.visible)
                        reg.hop(a);
                }
                return;
            }
            case CUE.BOSS: {
                const a = reg.get(c.actor);
                if (a)
                    reg.startAttack(a, 0, 1);
                if (this.muted)
                    return;
                this.sink.banner('ボスが 立ちはだかる', this.nameOf(c.actor), 'boss');
                if (!this.reduceMotion)
                    this.sink.shake(VISUAL_FX.bossShake, Math.max(1, VISUAL_FX.bossShakeMs * s));
                return;
            }
            case CUE.GAME_OVER: {
                const p = reg.get(this.playerId);
                if (p)
                    reg.setDowned(p);
                this.sink.banner('ちからつきた……', c.str, 'gameOver');
                return;
            }
            case CUE.CLEAR: {
                const p = reg.get(this.playerId);
                if (p) {
                    reg.startUse(p);
                    this.burst('levelUp', p.fx, p.fy, -1, 1.4, LIGHT.gold, 'clear');
                    this.light(p.fx, p.fy, LIGHT.gold, 4, 1, 1200);
                }
                this.sink.banner('ダンジョン クリア！', undefined, 'clear');
                return;
            }
            case CUE.FLOOR_IN:
                this.sink.transition('floorIn');
                this.sink.banner(`B${c.amount}F`, c.str, 'floor');
                return;
            default: {
                const never = c.kind;
                void never;
            }
        }
    }
    fireDamage(c) {
        const reg = this.registry;
        const s = this.speed;
        const a = reg.get(c.actor);
        // 出どころ → 受けた者の向き。出どころが分からない（毒・空腹）なら下がらない
        let ux = 0;
        let uy = 0;
        if (a && !Number.isNaN(c.x2)) {
            ux = Math.sign(a.tileX - c.x2);
            uy = Math.sign(a.tileY - c.y2);
        }
        if (a) {
            reg.startHurt(a, ux, uy, c.flag ? ACTOR_PX.knockCrit : ACTOR_PX.knock);
            if (!this.reduceMotion) {
                const f = c.flag ? VISUAL_FX.critFreeze : VISUAL_FX.hitFreeze;
                reg.freeze(a, f * s);
                const src = c.target >= 0 ? reg.get(c.target) : undefined;
                if (src && src !== a)
                    reg.freeze(src, f * s);
            }
        }
        if (this.muted || !this.shows(a, c.x, c.y))
            return;
        const x = a ? a.fx : c.x;
        const y = a ? a.fy : c.y;
        const toPlayer = c.actor === this.playerId;
        this.sink.popup(String(c.amount), c.flag ? 'crit' : toPlayer ? 'damageToPlayer' : 'damage', x, y);
        const preset = c.flag ? 'crit'
            : c.str === 'fire' ? 'hitFire'
                : c.str === 'magic' ? 'hitMagic' : 'hitPhysical';
        this.burst(preset, x, y, dirOfVec(ux, uy, -1), c.flag ? 1.6 : 1, '', c.str);
        if (c.str === 'fire')
            this.light(x, y, LIGHT.fire, 1.5, 0.6, 220);
        if (c.flag) {
            this.sink.flash(LIGHT.white, this.reduceMotion ? VISUAL_FX.reducedFlashAlpha : VISUAL_FX.critFlashAlpha, Math.max(1, VISUAL_FX.critFlashMs * s));
            if (!this.reduceMotion) {
                this.sink.shake(VISUAL_FX.critShake, Math.max(1, VISUAL_FX.critShakeMs * s));
                const stop = VISUAL_FX.critHitstop * s;
                this.sink.hitstop(stop);
                this.freezeMs = Math.max(this.freezeMs, stop);
            }
        }
        else if (toPlayer && !this.reduceMotion) {
            this.sink.shake(VISUAL_FX.hurtShake, Math.max(1, VISUAL_FX.hurtShakeMs * s));
        }
    }
    // ------------------------------------------------------------ 内側
    /**
     * 見えるか。主人公と仲間はいつでも、それ以外は論理上のマスが見えている時だけ。
     * 台帳に居なければ合図に控えた位置で判断する。
     */
    shows(a, x, y) {
        if (a)
            return isFriend(a) || this.tileVisible(a.tileX, a.tileY);
        return this.tileVisible(x, y);
    }
    tileVisible(x, y) {
        const w = this.world;
        if (!w || Number.isNaN(x) || Number.isNaN(y))
            return false;
        const map = w.map;
        const tx = Math.round(x);
        const ty = Math.round(y);
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height)
            return false;
        return map.tiles[ty * map.width + tx].visible;
    }
    tileOf(map, x, y) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height)
            return '';
        return map.tiles[y * map.width + x].kind;
    }
    /** 吹き出しの補助の値を使い回しの物に書いて渡す */
    burst(preset, x, y, dir8, power, color, tag) {
        const o = this.opts;
        o.dir8 = dir8;
        o.power = power;
        o.color = color;
        o.tag = tag;
        this.sink.burst(preset, x, y, o);
    }
    light(x, y, color, radius, intensity, ms) {
        if (!this.tileVisible(x, y))
            return;
        this.sink.light(x, y, color, radius, intensity, Math.max(1, ms * this.speed));
    }
    pt1(x, y) {
        this.p1.x = x;
        this.p1.y = y;
        return this.p1;
    }
    pt2(x, y) {
        this.p2.x = x;
        this.p2.y = y;
        return this.p2;
    }
    /** ボスの名前（固有名を優先）。一覧を直接たどる */
    nameOf(id) {
        const w = this.world;
        if (!w)
            return undefined;
        const ms = w.run.monsters;
        for (let i = 0; i < ms.length; i++)
            if (ms[i].id === id)
                return w.nameOf(ms[i]);
        return undefined;
    }
    /**
     * 地形の種類を控えと比べ、壁から変わった見えるマスに dig を出す（杖で掘った）。
     * 控えは階ごと。最初の 1 回は控えるだけ。
     */
    checkDig(map) {
        const n = map.width * map.height;
        const tiles = map.tiles;
        if (this.kinds === null || this.kinds.length !== n) {
            const k = new Uint8Array(n);
            for (let i = 0; i < n; i++)
                k[i] = kindCode(tiles[i].kind);
            this.kinds = k;
            return;
        }
        const k = this.kinds;
        for (let i = 0; i < n; i++) {
            const code = kindCode(tiles[i].kind);
            if (code === k[i])
                continue;
            if (k[i] === WALL_CODE && !this.muted && tiles[i].visible) {
                this.burst('dig', i % map.width, Math.floor(i / map.width), -1, 1, '', '');
            }
            k[i] = code;
        }
    }
    updateCamera(world) {
        const p = this.registry.get(this.playerId);
        if (!p)
            return;
        this.camera.follow(p, world.map.width, world.map.height);
        if (this.snapCamera) {
            this.camera.snap();
            this.snapCamera = false;
        }
        else {
            this.camera.tick();
        }
    }
}
function projectileKind(s) {
    return s === 'magic' || s === 'gitan' ? s : 'item';
}
//# sourceMappingURL=visualWorld.js.map