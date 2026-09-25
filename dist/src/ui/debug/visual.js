/**
 * 検証用の場面（見た目の台帳と拍）。URL に ?scene=visual:… を付けると開く。
 *
 *   ?scene=visual:play:<ダンジョン>   実際の階を自動で遊び、台帳・拍・演出の呼び出しを簡単な絵で見せる
 *       &seed=N（階の種） &spawn=ratField.slimeBlue（隣に出す敵） &turns=N（先に進めておく手数）
 *       &at=ms（最後の手の何 ms 後で止めて描くか） &still=1（止めたまま。撮影用） &speed=0.6（アニメ速度）
 *   ?scene=visual:beats               決まった 1 手を何通りか流し、合図の時刻を帯に並べる
 *
 * 絵は仮（旧 16×16 の絵と図形）。ここで見るのは「いつ・どこに・何が出るか」だけ。
 * 下の帯は今の手の合図（●）と、実際に受け口が呼ばれた時刻（｜）。
 * 自動で遊ぶ手の選び方には表示用の乱数を使う（ゲームの乱数は読まない）。
 */
import '../art/index.js';
import { Rng } from '../../core/rng.js';
import { DIRS, DIR_VEC, dirTo } from '../../core/geom.js';
import { getItem } from '../../data/registry.js';
import { at, canEnter } from '../../dungeon/tilemap.js';
import { enterFloor, startRun } from '../../game/run.js';
import { stepTurn } from '../../game/turn.js';
import { getSprite, sprites } from '../sprites.js';
import { loadAllSprites } from '../spriteData.js';
import { ART_H, ART_W, TILE_ART } from '../gfx/view.js';
import { CUE, Timeline } from '../anim/timeline.js';
import { VisualWorld } from '../anim/visualWorld.js';
const TICK = 1000 / 60;
/**
 * 撮影の画面（1280×720）に収めるため、世界は 2 倍で左上に置く（本番は 3 倍）。
 * 右は受け口が呼ばれた記録、下は今の手の合図の帯
 */
const K = 2;
const SHEET_W = 1280;
const SHEET_H = 720;
const VIEW_W = ART_W * K;
const VIEW_H = ART_H * K;
const STRIP_H = SHEET_H - VIEW_H;
/** 帯の横軸（ミリ秒） */
const STRIP_MS = 900;
const CUE_NAME = {};
for (const [k, v] of Object.entries(CUE))
    CUE_NAME[v] = k;
const CUE_COLOR = {
    [CUE.ATTACK]: '#e8d6a0',
    [CUE.BUMP]: '#a19cb4',
    [CUE.BEAM]: '#bd66d0',
    [CUE.THROW]: '#aacde0',
    [CUE.EXPLODE]: '#ffb13b',
    [CUE.TRAP]: '#c79e5e',
    [CUE.WARP_OUT]: '#78a2c2',
    [CUE.WARP_IN]: '#78a2c2',
    [CUE.DAMAGE]: '#ff6b6b',
    [CUE.MISS]: '#d2c6a6',
    [CUE.HEAL]: '#86b64e',
    [CUE.DEFEAT]: '#f59263',
    [CUE.LEVEL_UP]: '#fff7de',
    [CUE.SFX]: '#5a6f84',
};
const PRESET_COLOR = {
    hitPhysical: '#ffb13b', hitFire: '#e8701c', hitMagic: '#bd66d0', crit: '#ffffff', heal: '#86b64e',
    death: '#aacde0', levelUp: '#e8d6a0', explosion: '#ff8030', warp: '#78a2c2', dust: '#a0773f',
    splash: '#4fa0dc', trapGas: '#7a74db', statusApplied: '#e2738a', itemGet: '#fff1a8', dig: '#85705f',
};
function newTown() {
    return {
        playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
        cleared: [], unlocked: ['d1', 'd2', 'd3', 'd4'], bestDepth: {},
        seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
    };
}
class DebugSink {
    fx = [];
    calls = [];
    shakePx = 0;
    shakeLife = 0;
    flashColor = '';
    flashA = 0;
    flashLife = 0;
    flashT = 0;
    bannerText = '';
    bannerSub = '';
    bannerLife = 0;
    fade = 0;
    fadeDir = 0;
    vw = null;
    note(what) {
        this.calls.push({ at: this.vw ? this.vw.timeline.now : 0, what });
    }
    burst(preset, tileX, tileY, opts) {
        this.note(`burst:${preset}`);
        this.fx.push({
            kind: 'burst', label: preset, color: opts.color || PRESET_COLOR[preset], x: tileX, y: tileY,
            x2: 0, y2: 0, power: opts.power, t: 0, life: 520,
        });
    }
    beam(from, to, color, element, ms) {
        this.note(`beam:${element}`);
        this.fx.push({
            kind: 'beam', label: element, color, x: from.x, y: from.y, x2: to.x, y2: to.y, power: ms, t: 0, life: ms + 160,
        });
    }
    projectile(from, to, spriteKey, kind, ms) {
        this.note(`projectile:${kind}`);
        this.fx.push({
            kind: 'projectile', label: spriteKey ?? kind, color: '#e0d8c0', x: from.x, y: from.y, x2: to.x, y2: to.y,
            power: ms, t: 0, life: ms,
        });
    }
    light(tileX, tileY, color, radius, intensity, durationMs) {
        this.fx.push({
            kind: 'light', label: '', color, x: tileX, y: tileY, x2: radius, y2: intensity, power: 1, t: 0,
            life: durationMs,
        });
    }
    shake(px, ms) {
        this.note(`shake:${px}`);
        this.shakePx = Math.max(this.shakePx, px);
        this.shakeLife = Math.max(this.shakeLife, ms);
    }
    flash(color, alpha, ms) {
        this.note('flash');
        this.flashColor = color;
        this.flashA = alpha;
        this.flashLife = ms;
        this.flashT = 0;
    }
    hitstop(ms) {
        this.note(`hitstop:${Math.round(ms)}`);
    }
    popup(text, kind, tileX, tileY) {
        this.note(`popup:${text}`);
        const color = kind === 'damageToPlayer' ? '#ff5a5a' : kind === 'crit' ? '#ffb03a'
            : kind === 'heal' ? '#7ef07e' : kind === 'miss' ? '#b8b8c8' : kind === 'levelUp' ? '#ffe08a' : '#ffffff';
        this.fx.push({
            kind: 'popup', label: text, color, x: tileX, y: tileY, x2: 0, y2: 0,
            power: kind === 'crit' ? 1.4 : 1, t: 0, life: 760,
        });
    }
    banner(text, sub, kind) {
        this.note(`banner:${kind ?? ''}`);
        this.bannerText = text;
        this.bannerSub = sub ?? '';
        this.bannerLife = 1400;
    }
    transition(kind) {
        this.note(`transition:${kind}`);
        this.fadeDir = kind === 'floorOut' ? 1 : -1;
        if (kind === 'floorOut')
            this.fade = 0.01;
    }
    sfx(id) {
        this.note(`sfx:${id}`);
    }
    update(ms) {
        for (const f of this.fx)
            f.t += ms;
        this.fx = this.fx.filter((f) => f.t < f.life);
        if (this.shakeLife > 0)
            this.shakeLife -= ms;
        else
            this.shakePx = 0;
        if (this.flashLife > 0)
            this.flashT += ms;
        if (this.bannerLife > 0)
            this.bannerLife -= ms;
        if (this.fadeDir > 0)
            this.fade = Math.min(1, this.fade + ms / 200);
        if (this.fadeDir < 0) {
            this.fade = Math.max(0, this.fade - ms / 200);
            if (this.fade === 0)
                this.fadeDir = 0;
        }
    }
}
// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------
function makeSheet(w, h) {
    const game = document.getElementById('game');
    if (game)
        game.style.display = 'none';
    // body は中央寄せの flex なので、画面より高い絵は上へはみ出して撮れない。ただの箱にする
    document.body.style.display = 'block';
    document.body.style.overflow = 'auto';
    document.body.style.background = '#0b1020';
    const canvas = document.createElement('canvas');
    canvas.id = 'sheet';
    canvas.width = w;
    canvas.height = h;
    canvas.style.display = 'block';
    document.body.appendChild(canvas);
    const g = canvas.getContext('2d');
    if (!g)
        throw new Error('2D コンテキストを取得できませんでした');
    g.imageSmoothingEnabled = false;
    return g;
}
function text(g, s, x, y, color, size = 13, align = 'left') {
    g.font = `${size}px monospace`;
    g.textAlign = align;
    g.textBaseline = 'top';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(s, x, y);
    g.fillStyle = color;
    g.fillText(s, x, y);
}
// ---------------------------------------------------------------------------
// 自動で遊ぶ
// ---------------------------------------------------------------------------
/** 隣の敵を殴る。見えている敵が近ければ寄る。それ以外は歩き回る（表示用の乱数で） */
function autoAction(world, r) {
    const p = world.player;
    let best = null;
    let bestD = 99;
    for (const m of world.run.monsters) {
        if (!m.alive || m.kind === 'shopkeeper')
            continue;
        if (!at(world.map, m.pos.x, m.pos.y)?.visible)
            continue;
        const d = Math.max(Math.abs(m.pos.x - p.pos.x), Math.abs(m.pos.y - p.pos.y));
        if (d < bestD) {
            bestD = d;
            best = m;
        }
    }
    if (best && bestD === 1) {
        const d = dirTo(p.pos, best.pos);
        if (d !== null)
            return { type: 'attack', dir: d };
    }
    if (best && bestD <= 6) {
        const d = dirTo(p.pos, best.pos);
        if (d !== null) {
            const q = { x: p.pos.x + DIR_VEC[d].x, y: p.pos.y + DIR_VEC[d].y };
            if (canEnter(world.map, q.x, q.y, 'ground'))
                return { type: 'move', dir: d };
        }
    }
    for (let tries = 0; tries < 8; tries++) {
        const d = DIRS[r.int(8)];
        const q = { x: p.pos.x + DIR_VEC[d].x, y: p.pos.y + DIR_VEC[d].y };
        if (canEnter(world.map, q.x, q.y, 'ground') && !world.actorAt(q))
            return { type: 'move', dir: d };
    }
    return { type: 'wait' };
}
/** 帯に印と名前を置く。名前が重ならないよう、空いている段へ順に入れる */
function drawMarks(g, marks, xOf, top, lanes) {
    const ends = new Array(lanes).fill(-1e9);
    for (const m of marks) {
        const x = xOf(m.time);
        const name = CUE_NAME[m.kind] ?? '?';
        const w = 12 + name.length * 6.2;
        let lane = ends.findIndex((e) => e < x - 6);
        if (lane < 0)
            lane = ends.indexOf(Math.min(...ends));
        ends[lane] = x + w;
        const y = top + lane * 16;
        const color = CUE_COLOR[m.kind] ?? '#c6d4de';
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y + 6, 4, 0, Math.PI * 2);
        g.fill();
        text(g, name, x + 6, y, color, 10);
    }
}
function snapshotPlan(vw, out) {
    out.length = 0;
    for (let i = 0; i < vw.timeline.pending; i++) {
        const c = vw.timeline.pendingAt(i);
        out.push({ time: c.time, kind: c.kind, beat: c.beat });
    }
}
function play(dungeonId, params) {
    loadAllSprites();
    const seed = Number(params.get('seed') ?? 101) | 0;
    const world = startRun(dungeonId, newTown(), { seed });
    const depth = Number(params.get('depth') ?? 1) | 0;
    if (depth > 1)
        enterFloor(world, Math.min(depth, world.dungeon.depth));
    const p = world.player;
    p.maxHp = 999;
    p.hp = 999;
    const spawn = (params.get('spawn') ?? 'ratField.slimeBlue').split(/[.,]/).filter(Boolean);
    const spots = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
    let k = 0;
    for (const defId of spawn) {
        while (k < spots.length) {
            const [dx, dy] = spots[k++];
            const m = world.spawnAt?.(defId, { x: p.pos.x + dx, y: p.pos.y + dy });
            if (m) {
                m.asleep = false;
                break;
            }
        }
    }
    const sink = new DebugSink();
    const vw = new VisualWorld(sink);
    sink.vw = vw;
    vw.speedScale = Number(params.get('speed') ?? 1) || 1;
    vw.reset();
    const plan = [];
    let batchCalls = [];
    const pick = new Rng(`visual-auto:${seed}`);
    const doTurn = () => {
        const a = autoAction(world, pick);
        vw.notePlayerAction(a);
        stepTurn(world, a);
        sink.calls = [];
        vw.ingest(world.drainEvents(), world);
        snapshotPlan(vw, plan);
        batchCalls = sink.calls;
        world.player.hp = world.player.maxHp;
    };
    const tickN = (ms) => {
        const n = Math.round(ms / TICK);
        for (let i = 0; i < n; i++) {
            vw.tick(TICK, world);
            sink.update(TICK);
        }
    };
    vw.ingest(world.drainEvents(), world);
    // 階に入った時の札（1.4 秒）が消えるまで待ってから遊び始める
    tickN(1600);
    const turns = Math.max(0, Number(params.get('turns') ?? 12) | 0);
    for (let i = 0; i < turns && !world.finished; i++) {
        doTurn();
        tickN(i === turns - 1 ? Number(params.get('at') ?? 150) : 420);
    }
    const g = makeSheet(SHEET_W, SHEET_H);
    const art = document.createElement('canvas');
    art.width = ART_W;
    art.height = ART_H;
    const ag = art.getContext('2d');
    if (!ag)
        return;
    ag.imageSmoothingEnabled = false;
    const draw = () => {
        drawWorld(ag, world, vw);
        g.fillStyle = '#05050a';
        g.fillRect(0, 0, SHEET_W, SHEET_H);
        const sx = sink.shakePx > 0 ? Math.round(Math.sin(vw.clockMs * 0.09) * sink.shakePx) : 0;
        g.save();
        g.beginPath();
        g.rect(0, 0, VIEW_W, VIEW_H);
        g.clip();
        g.drawImage(art, sx, 0, VIEW_W, VIEW_H);
        drawLabels(g, vw, sx);
        drawFx(g, vw, sink, sx);
        g.restore();
        drawCalls(g, batchCalls, vw);
        drawStrip(g, vw, plan, world);
    };
    draw();
    if (params.get('still') === '1')
        return;
    let last = performance.now();
    let acc = 0;
    let sinceTurn = 0;
    const loop = (now) => {
        acc += Math.min(250, now - last);
        last = now;
        while (acc >= TICK) {
            acc -= TICK;
            vw.tick(TICK, world);
            sink.update(TICK);
            sinceTurn += TICK;
            if (sinceTurn >= 520 && !world.finished && !vw.isHolding()) {
                sinceTurn = 0;
                doTurn();
            }
        }
        draw();
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
/** 地形（仮の塗り）とキャラ（旧 16×16 の絵）を画用紙へ */
function drawWorld(g, world, vw) {
    const theme = world.dungeon.theme;
    const cam = vw.camera;
    g.fillStyle = '#05050a';
    g.fillRect(0, 0, ART_W, ART_H);
    const map = world.map;
    const x0 = Math.max(0, Math.floor(cam.camX / TILE_ART));
    const y0 = Math.max(0, Math.floor(cam.camY / TILE_ART));
    const x1 = Math.min(map.width - 1, Math.floor((cam.camX + ART_W) / TILE_ART));
    const y1 = Math.min(map.height - 1, Math.floor((cam.camY + ART_H) / TILE_ART));
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const t = at(map, x, y);
            if (!t || !t.explored)
                continue;
            const px = x * TILE_ART - cam.camX;
            const py = y * TILE_ART - cam.camY;
            let c = theme.floor;
            if (t.kind === 'wall')
                c = theme.wall;
            else if (t.kind === 'water' || t.kind === 'lava')
                c = theme.liquid;
            else if (t.kind === 'pit')
                c = '#05050a';
            else if (t.roomId < 0)
                c = theme.corridor;
            else if (((x + y) & 1) === 0)
                c = theme.floorAlt;
            g.fillStyle = c;
            g.fillRect(px, py, TILE_ART, TILE_ART);
            if (t.kind === 'wall') {
                g.fillStyle = theme.wallTop;
                g.fillRect(px, py + TILE_ART - 4, TILE_ART, 4);
            }
            if (t.kind === 'stairs') {
                g.fillStyle = '#8ce08c';
                g.fillRect(px + 4, py + 5, 8, 2);
                g.fillRect(px + 5, py + 8, 6, 2);
                g.fillRect(px + 6, py + 11, 4, 2);
            }
            if (!t.visible) {
                g.fillStyle = 'rgba(5,5,12,0.62)';
                g.fillRect(px, py, TILE_ART, TILE_ART);
            }
        }
    }
    vw.forEachDrawable((d) => {
        const fx = d.artX - cam.camX;
        const fy = d.artY - cam.camY;
        g.save();
        g.globalAlpha = d.alpha * (d.dying ? 1 - d.dissolve * 0.22 : 1);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath();
        g.ellipse(fx, fy + 1, 5, 2, 0, 0, Math.PI * 2);
        g.fill();
        const id = d.disguise ? (getItem(d.disguise).sprite) : d.kind === 'player' ? `player${d.dir8}` : d.species;
        const sp = getSprite(id);
        const scaleY = 1 - d.warp;
        if (sp && scaleY > 0) {
            sprites.draw(g, id, sp, fx, fy - d.lift - 7 * scaleY, TILE_ART, {
                tint: d.flash > 0 ? d.flash : d.grey > 0 ? d.grey * 0.8 : 0,
                tintColor: d.flash > 0 ? '#ffffff' : '#8a8a8a',
                scaleY,
            });
        }
        else if (scaleY > 0) {
            g.fillStyle = d.kind === 'player' ? '#4d7399' : '#ad2e30';
            g.fillRect(fx - 5, fy - d.lift - 12, 10, 12);
        }
        g.restore();
    });
}
/** キャラの頭の上に、動き・コマ・崩れの段を小さく */
function drawLabels(g, vw, sx) {
    const cam = vw.camera;
    const n = vw.sortDrawables();
    for (let i = 0; i < n; i++) {
        const d = vw.drawableAt(i);
        const x = (d.artX - cam.camX) * K + sx;
        const y = (d.artY - cam.camY - d.lift) * K + 4;
        const label = d.dying ? `崩${d.dissolve}` : `${d.anim.slice(0, 3)}${d.frame}`;
        text(g, label, x, y, d.dying ? '#f59263' : '#c6d4de', 10, 'center');
    }
}
/** 受け口に残った演出を図形で（HD の層の代わり） */
function drawFx(g, vw, sink, sx) {
    const cam = vw.camera;
    const toX = (tx) => ((tx + 0.5) * TILE_ART - cam.camX) * K + sx;
    const toY = (ty) => ((ty + 0.5) * TILE_ART - cam.camY) * K;
    g.save();
    for (const f of sink.fx) {
        const u = f.t / f.life;
        if (f.kind === 'light') {
            const r = f.x2 * TILE_ART * K;
            const grad = g.createRadialGradient(toX(f.x), toY(f.y), 0, toX(f.x), toY(f.y), r);
            grad.addColorStop(0, f.color);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            g.globalCompositeOperation = 'lighter';
            g.globalAlpha = 0.35 * f.y2 * (1 - u);
            g.fillStyle = grad;
            g.fillRect(toX(f.x) - r, toY(f.y) - r, r * 2, r * 2);
            g.globalCompositeOperation = 'source-over';
        }
        else if (f.kind === 'burst') {
            g.globalAlpha = 1 - u;
            g.strokeStyle = f.color;
            g.lineWidth = 3;
            g.beginPath();
            g.arc(toX(f.x), toY(f.y) - 10, 5 + u * 26 * Math.max(0.5, Math.min(2, f.power)), 0, Math.PI * 2);
            g.stroke();
            text(g, f.label, toX(f.x), toY(f.y) + 10, f.color, 10, 'center');
        }
        else if (f.kind === 'beam') {
            const k = Math.min(1, f.t / Math.max(1, f.power));
            g.globalAlpha = f.t > f.power ? 1 - (f.t - f.power) / 160 : 1;
            g.strokeStyle = f.color;
            g.lineWidth = 6;
            g.beginPath();
            g.moveTo(toX(f.x), toY(f.y) - 10);
            g.lineTo(toX(f.x + (f.x2 - f.x) * k), toY(f.y + (f.y2 - f.y) * k) - 10);
            g.stroke();
        }
        else if (f.kind === 'projectile') {
            const x = toX(f.x + (f.x2 - f.x) * u);
            const y = toY(f.y + (f.y2 - f.y) * u) - 10 - Math.sin(u * Math.PI) * 16;
            g.globalAlpha = 1;
            g.fillStyle = f.color;
            g.beginPath();
            g.arc(x, y, 7, 0, Math.PI * 2);
            g.fill();
        }
        else if (f.kind === 'popup') {
            g.globalAlpha = u > 0.75 ? (1 - u) * 4 : 1;
            text(g, f.label, toX(f.x), toY(f.y) - 44 - 20 * Math.min(1, u * 2.2), f.color, Math.round(20 * f.power), 'center');
        }
    }
    g.restore();
    if (sink.flashLife > 0 && sink.flashT < sink.flashLife) {
        g.save();
        g.globalAlpha = sink.flashA * (1 - sink.flashT / sink.flashLife);
        g.fillStyle = sink.flashColor;
        g.fillRect(0, 0, VIEW_W, VIEW_H);
        g.restore();
    }
    if (sink.fade > 0) {
        g.fillStyle = `rgba(0,0,0,${sink.fade})`;
        g.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (sink.bannerLife > 0) {
        g.fillStyle = 'rgba(11,16,32,0.8)';
        g.fillRect(0, VIEW_H / 2 - 50, VIEW_W, 100);
        text(g, sink.bannerText, VIEW_W / 2, VIEW_H / 2 - 36, '#e8d6a0', 30, 'center');
        if (sink.bannerSub)
            text(g, sink.bannerSub, VIEW_W / 2, VIEW_H / 2 + 6, '#f1ebdd', 16, 'center');
    }
}
/** 右：今の手で受け口が呼ばれた記録（組の中の時刻） */
function drawCalls(g, calls, vw) {
    const x0 = VIEW_W;
    g.fillStyle = '#0d1124';
    g.fillRect(x0, 0, SHEET_W - x0, VIEW_H);
    text(g, '受け口の呼び出し（この手）', x0 + 12, 10, '#e8d6a0', 13);
    let y = 32;
    for (const c of calls) {
        if (y > VIEW_H - 18)
            break;
        const due = c.at <= vw.timeline.now;
        text(g, `${String(Math.round(c.at)).padStart(4, ' ')}ms  ${c.what}`, x0 + 12, y, due ? '#d2c6a6' : '#5a6f84', 11);
        y += 15;
    }
}
/** 下の帯：今の手の合図 */
function drawStrip(g, vw, plan, world) {
    const y0 = VIEW_H;
    const left = 60;
    const w = SHEET_W - left - 30;
    const xOf = (ms) => left + (Math.min(STRIP_MS, ms) / STRIP_MS) * w;
    g.fillStyle = '#10142a';
    g.fillRect(0, y0, SHEET_W, STRIP_H);
    g.strokeStyle = '#2f4a6e';
    g.lineWidth = 1;
    for (let ms = 0; ms <= STRIP_MS; ms += 100) {
        g.beginPath();
        g.moveTo(xOf(ms), y0 + 24);
        g.lineTo(xOf(ms), y0 + STRIP_H - 8);
        g.stroke();
        text(g, `${ms}`, xOf(ms), y0 + 6, '#78a2c2', 11, 'center');
    }
    text(g, '合図', 6, y0 + 36, '#a19cb4', 12);
    drawMarks(g, plan, xOf, y0 + 30, 10);
    // 今の時刻
    g.fillStyle = '#ff5a5a';
    g.fillRect(xOf(vw.timeline.now) - 1, y0 + 22, 2, STRIP_H - 28);
    text(g, `turn ${world.run.totalTurn}  beats ${vw.timeline.beats}  batch ${Math.round(vw.timeline.batchMs)}ms`
        + `  ×${vw.timeline.compression.toFixed(2)}  anims ${vw.registry.count} (made ${vw.registry.created})`, SHEET_W - 8, y0 + STRIP_H - 18, '#a19cb4', 11, 'right');
}
// ---------------------------------------------------------------------------
// 決まった 1 手の帯
// ---------------------------------------------------------------------------
function beats() {
    const world = startRun('d1', newTown(), { seed: 99 });
    world.drainEvents();
    const p = world.player;
    const ms = [];
    for (const d of [2, 6, 4, 0]) {
        const q = { x: p.pos.x + DIR_VEC[d].x, y: p.pos.y + DIR_VEC[d].y };
        const m = world.spawnAt?.('ratField', q);
        if (m)
            ms.push(m);
    }
    while (ms.length < 3)
        ms.push(ms[0]);
    const [m1, m2, m3] = ms;
    const P = p.id;
    const cases = [
        {
            name: '殴って倒す → レベルアップ',
            events: [
                { t: 'attack', actorId: P, targetId: m1.id, critical: false },
                { t: 'sfx', name: 'hit' },
                { t: 'attack', actorId: P, targetId: m1.id, critical: false },
                { t: 'damage', actorId: m1.id, amount: 14, kind: 'physical' },
                { t: 'defeat', actorId: m1.id },
                { t: 'sfx', name: 'defeat' },
                { t: 'levelUp', actorId: P },
                { t: 'sfx', name: 'levelUp' },
            ],
        },
        {
            name: '3 体の反撃（空振りを含む）',
            events: [
                { t: 'attack', actorId: m1.id, targetId: P, critical: false },
                { t: 'damage', actorId: P, amount: 3, kind: 'physical' },
                { t: 'miss', actorId: m2.id, targetId: P },
                { t: 'attack', actorId: m3.id, targetId: P, critical: true },
                { t: 'damage', actorId: P, amount: 9, kind: 'physical' },
            ],
        },
        {
            name: '杖（ビーム）→ 投げ物',
            events: [
                { t: 'zap', from: { ...p.pos }, to: { ...m1.pos }, color: '#c0a0ff' },
                { t: 'sfx', name: 'zap' },
                { t: 'status', actorId: m1.id, status: 'asleep', applied: true },
                { t: 'projectile', from: { ...p.pos }, to: { x: m2.pos.x * 2 - p.pos.x, y: m2.pos.y * 2 - p.pos.y },
                    sprite: 'arrow', kind: 'item' },
                { t: 'sfx', name: 'throw' },
                { t: 'damage', actorId: m2.id, amount: 6, kind: 'physical' },
            ],
        },
        {
            name: '地雷：ワナ → 爆発 → 巻き込み',
            events: [
                { t: 'trap', pos: { ...p.pos }, trapId: 'mine' },
                { t: 'explosion', pos: { ...p.pos }, radius: 1 },
                { t: 'sfx', name: 'explosion' },
                { t: 'damage', actorId: P, amount: 20, kind: 'fire' },
                { t: 'damage', actorId: m1.id, amount: 30, kind: 'fire' },
                { t: 'defeat', actorId: m1.id },
                { t: 'damage', actorId: m2.id, amount: 30, kind: 'fire' },
                { t: 'defeat', actorId: m2.id },
            ],
        },
        {
            name: '長い手（6 拍 → 800ms に縮める）',
            events: Array.from({ length: 6 }, (_v, i) => [
                { t: 'attack', actorId: [m1, m2, m3][i % 3].id, targetId: P, critical: false },
                { t: 'damage', actorId: P, amount: i + 1, kind: 'physical' },
            ]).flat(),
        },
    ];
    const rowH = 92;
    const left = 250;
    const w = 1280 - left - 30;
    const g = makeSheet(1280, 40 + cases.length * rowH);
    g.fillStyle = '#0b1020';
    g.fillRect(0, 0, 1280, 40 + cases.length * rowH);
    const xOf = (t) => left + (t / STRIP_MS) * w;
    for (let t = 0; t <= STRIP_MS; t += 100) {
        g.strokeStyle = '#1f2c46';
        g.beginPath();
        g.moveTo(xOf(t), 30);
        g.lineTo(xOf(t), 40 + cases.length * rowH);
        g.stroke();
        text(g, `${t}ms`, xOf(t), 10, '#78a2c2', 11, 'center');
    }
    cases.forEach((c, row) => {
        const sink = new DebugSink();
        const vw = new VisualWorld(sink);
        sink.vw = vw;
        vw.reset();
        vw.tick(TICK, world);
        // 0ms の合図は ingest の中で出てしまうので、同じ台帳を見る別のタイムラインで計画だけ立てて並べる
        const tl = new Timeline();
        tl.plan(c.events, 0, c.events.length, vw);
        tl.finish();
        const marks = [];
        for (let i = 0; i < tl.pending; i++) {
            const cue = tl.pendingAt(i);
            marks.push({ time: cue.time, kind: cue.kind, beat: cue.beat });
        }
        const y = 40 + row * rowH;
        g.fillStyle = row % 2 === 0 ? '#10142a' : '#0d1124';
        g.fillRect(0, y, 1280, rowH);
        text(g, c.name, 10, y + 8, '#e8d6a0', 13);
        text(g, `拍 ${tl.beats} / ${Math.round(tl.batchMs)}ms / ×${tl.compression.toFixed(2)}`, 10, y + 28, '#a19cb4', 11);
        drawMarks(g, marks, xOf, y + 8, 5);
    });
}
/** ?scene=visual:… を開く */
export function open(spec, params) {
    const parts = spec.split(':');
    switch (parts[1]) {
        case 'play':
            play(parts[2] ?? 'd1', params);
            return;
        case 'beats':
            beats();
            return;
        default: {
            const g = makeSheet(600, 60);
            text(g, `知らない場面: ${spec}`, 10, 20, '#ff8080', 14);
        }
    }
}
//# sourceMappingURL=visual.js.map