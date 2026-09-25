/**
 * 検証用：描画エンジン（合成・光・ブルーム・ぼかし・色調）をゲーム無しで動かす。
 *
 *   ?scene=gfx:test     合成した場面（30×20 マスの部屋・松明 3・ランタン・溶岩・暗い所・未探索）
 *   ?scene=gfx:passes   途中の紙（地形・光・ブルーム…）を全部並べる
 *
 * 付けられるもの
 *   &q=0|1|2        画質（既定 2）
 *   &scale=1|1.5|2  画面の実画素の倍率（キャンバスの実画素を変えて、端末の画素密度の代わりにする）
 *   &pp=1           整数倍で表示（pixelPerfect）
 *   &perf=1         左上に時間を出し、window.__perf に統計を出す（&sync=0|1|2 で測り方、&overlay=0 で数字を出さない）
 *   &dof=0          被写界深度を切る
 *   &t=<秒>         時刻を止める（撮り直しても同じ絵にする）
 *   &cam=x_y        カメラを止める（世界のドット。撮影の場面の並びがカンマ区切りなので _ でつなぐ）
 *
 * 地形も敵もゲームのデータを使わず、ここで PixBuf に描いて作る（旧来の絵の読み込みの確認に 3 体だけ借りる）。
 * 乱数は使わない（ばらつきは座標のハッシュ）。
 */
import { PixBuf, disc, ellipse, hline, line, rect } from '../art/pixbuf.js';
import { WHITE, ci } from '../art/palette.js';
import { hash2, hashFloat } from '../art/hash.js';
import { mat, registerRig, registerSpecies } from '../art/rig.js';
import { idleBreath, walkCycle } from '../art/anim.js';
import { makeCanvas, pixBufToCanvas } from '../gfx/canvas.js';
import { Compositor } from '../gfx/compositor.js';
import { FX_FLASH, FX_NORMAL, FX_OCCLUDER, SheetCache, animIndex } from '../gfx/sheets.js';
import { worldToLogicalX, worldToLogicalY, } from '../gfx/types.js';
import { TILE_EXPLORED, TILE_UNEXPLORED, TILE_VISIBLE_DARK, TILE_VISIBLE_LIT, flickerSeed, parseHex, } from '../gfx-core/lightModel.js';
import { loadAllSprites } from '../spriteData.js';
import { SCREEN_H, SCREEN_W } from '../theme.js';
import { ART_H, ART_W, TILE_ART } from '../gfx/view.js';
// ---------------------------------------------------------------------------
// 地図
// ---------------------------------------------------------------------------
const MW = 30;
const MH = 20;
const T = TILE_ART;
const K_FLOOR = 0;
const K_WALL = 1;
const K_LAVA = 2;
function buildKinds() {
    const k = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++) {
        for (let x = 0; x < MW; x++) {
            let v = K_FLOOR;
            if (x === 0 || y === 0 || x === MW - 1 || y === MH - 1)
                v = K_WALL;
            // 仕切りの壁（x = 16）。y = 9〜10 が出入口
            if (x === 16 && y !== 9 && y !== 10)
                v = K_WALL;
            // 溶岩：左の部屋の帯と、右の部屋の池（池の右半分は未探索）
            if (y >= 14 && y <= 15 && x >= 3 && x <= 11)
                v = K_LAVA;
            if (y >= 12 && y <= 13 && x >= 20 && x <= 27)
                v = K_LAVA;
            k[y * MW + x] = v;
        }
    }
    return k;
}
const KINDS = buildKinds();
const kindAt = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH ? K_WALL : KINDS[y * MW + x];
/** 松明（上の壁の正面） */
const TORCH_X = [3, 8, 13];
/** 右の部屋で最初から未探索の所 */
const unexploredAt = (x, y) => x >= 17 && ((x >= 25 && y >= 8) || y >= 14);
function paintFloor(b, tx, ty) {
    const ox = tx * T;
    const oy = ty * T;
    const tone = hash2(tx, ty, 7) & 1 ? ci('stone', 2) : ci('stone', 3);
    rect(b, ox, oy, T, T, tone);
    // 目地（上と左）
    hline(b, ox, oy, T, ci('stone', 1));
    for (let y = 0; y < T; y++)
        b.set(ox, oy + y, ci('stone', 1));
    // 小石（座標のハッシュで 0〜2 個）
    const n = hash2(tx, ty, 11) % 3;
    for (let i = 0; i < n; i++) {
        const h = hash2(tx, ty, 20 + i);
        b.set(ox + 3 + (h % 10), oy + 3 + ((h >> 8) % 10), ci('stone', 4));
    }
    // 上が壁なら、壁の落とす陰（2 ドットのディザ）
    if (kindAt(tx, ty - 1) === K_WALL) {
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < T; x++)
                if (((x + y) & 1) === 0 || y === 0)
                    b.set(ox + x, oy + y, ci('stone', 1));
        }
    }
}
function paintWall(b, tx, ty) {
    const ox = tx * T;
    const oy = ty * T;
    if (kindAt(tx, ty + 1) !== K_WALL) {
        // 床に面した壁：上の縁 4 ドット ＋ 正面 12 ドット（レンガ）
        rect(b, ox, oy, T, 4, ci('stone', 4));
        hline(b, ox, oy, T, ci('stone', 5));
        rect(b, ox, oy + 4, T, 12, ci('stone', 3));
        for (let y = 4; y < 16; y++) {
            const row = Math.floor((y - 4) / 4);
            for (let x = 0; x < T; x++) {
                const joint = (x + (row & 1) * 4 + tx * 3) % 8 === 0;
                if ((y - 4) % 4 === 3 || joint)
                    b.set(ox + x, oy + y, ci('stone', 1));
                else if ((y - 4) % 4 === 0)
                    b.set(ox + x, oy + y, ci('stone', 4));
            }
        }
        hline(b, ox, oy + 15, T, ci('stone', 0));
    }
    else {
        // 壁の天井（暗い面）。2×2 の粒でざらつきだけ付ける
        rect(b, ox, oy, T, T, ci('ink', 1));
        for (let y = 0; y < T; y += 2) {
            for (let x = 0; x < T; x += 2) {
                if (hash2(ox + x, oy + y, 5) % 5 === 0)
                    rect(b, ox + x, oy + y, 2, 2, ci('stone', 1));
            }
        }
    }
}
function paintLavaBase(b, tx, ty) {
    const ox = tx * T;
    const oy = ty * T;
    rect(b, ox, oy, T, T, ci('ember', 1));
}
/** 溶岩のコマ f（0〜3）。明るい所ほど光る色 */
function paintLavaFrame(b, glow, f) {
    for (let ty = 0; ty < MH; ty++) {
        for (let tx = 0; tx < MW; tx++) {
            if (kindAt(tx, ty) !== K_LAVA)
                continue;
            for (let y = 0; y < T; y++) {
                for (let x = 0; x < T; x++) {
                    const wx = tx * T + x;
                    const wy = ty * T + y;
                    // 岸の 1 ドットは冷えた縁
                    const edge = (x === 0 && kindAt(tx - 1, ty) !== K_LAVA)
                        || (x === T - 1 && kindAt(tx + 1, ty) !== K_LAVA)
                        || (y === 0 && kindAt(tx, ty - 1) !== K_LAVA)
                        || (y === T - 1 && kindAt(tx, ty + 1) !== K_LAVA);
                    if (edge) {
                        b.set(wx, wy, ci('stone', 1));
                        continue;
                    }
                    const ph = f * Math.PI / 2;
                    const v = Math.sin(wx * 0.31 + ph) + Math.sin(wy * 0.47 + wx * 0.13 - ph)
                        + 0.6 * Math.sin((wx + wy) * 0.21 + ph * 2);
                    const c = v > 1.55 ? ci('ember', 5) : v > 1.0 ? ci('ember', 4) : v > 0.25 ? ci('ember', 3)
                        : v > -0.8 ? ci('ember', 2) : ci('ember', 1);
                    b.set(wx, wy, c);
                    if (v > 0.25)
                        glow.set(wx, wy, c);
                }
            }
        }
    }
}
/** 松明の炎（5×7、3 コマ） */
function flameFrame(f) {
    const b = new PixBuf(5, 8);
    const tip = f === 1 ? 0 : 1;
    const lean = f === 2 ? 1 : 0;
    b.set(2 + lean, tip, ci('ember', 3));
    hline(b, 1 + lean, tip + 1, 3 - lean, ci('ember', 3));
    rect(b, 0, 3, 5, 3, ci('ember', 3));
    rect(b, 1, 2, 3, 4, ci('ember', 4));
    rect(b, 1, 6, 3, 1, ci('ember', 4));
    b.set(2, 3, ci('ember', 5));
    b.set(2, 4, WHITE);
    b.set(2, 5, ci('gold', 5));
    return b;
}
function buildTerrain() {
    const base = new PixBuf(MW * T, MH * T);
    for (let ty = 0; ty < MH; ty++) {
        for (let tx = 0; tx < MW; tx++) {
            const k = kindAt(tx, ty);
            if (k === K_WALL)
                paintWall(base, tx, ty);
            else if (k === K_LAVA)
                paintLavaBase(base, tx, ty);
            else
                paintFloor(base, tx, ty);
        }
    }
    // 松明の燭台
    for (const tx of TORCH_X) {
        const ox = tx * T;
        rect(base, ox + 6, 10, 4, 1, ci('earth', 2));
        rect(base, ox + 7, 11, 2, 3, ci('earth', 1));
    }
    const lava = [];
    const lavaGlow = [];
    for (let f = 0; f < 4; f++) {
        const b = new PixBuf(MW * T, MH * T);
        const g = new PixBuf(MW * T, MH * T);
        paintLavaFrame(b, g, f);
        lava.push(pixBufToCanvas(b));
        lavaGlow.push(pixBufToCanvas(g));
    }
    const flame = [];
    const flameGlow = [];
    for (let f = 0; f < 3; f++) {
        const b = flameFrame(f);
        flame.push(pixBufToCanvas(b));
        flameGlow.push(pixBufToCanvas(b));
    }
    return { base: pixBufToCanvas(base), lava, lavaGlow, flame, flameGlow };
}
// ---------------------------------------------------------------------------
// 検証用のリグ（小さな人と、光る玉）
// ---------------------------------------------------------------------------
const figure = {
    id: 'gfxFigure', tier: 'hero', dirs: 1,
    anims: { idle: idleBreath(), walk: walkCycle(8, 10) },
    build(b, p, _dir, v) {
        const cx = 16;
        const foot = 45;
        const bob = Math.round(p.bob);
        // 脚（前に出ている脚は 1 ドット持ち上がる）
        const liftL = p.legL > 0.4 ? 1 : 0;
        const liftR = p.legR > 0.4 ? 1 : 0;
        rect(b, cx - 4, foot - 9 - liftL, 3, 9, mat(v, 'leg', 2));
        rect(b, cx + 1, foot - 9 - liftR, 3, 9, mat(v, 'leg', 2));
        rect(b, cx - 4, foot - 2 - liftL, 3, 2, mat(v, 'leg', 1));
        rect(b, cx + 1, foot - 2 - liftR, 3, 2, mat(v, 'leg', 1));
        // 合羽
        const top = foot - 20 + bob;
        rect(b, cx - 5, top, 11, 12, mat(v, 'cloak', 3));
        rect(b, cx + 2, top + 1, 4, 11, mat(v, 'cloak', 2));
        hline(b, cx - 5 + Math.round(p.sway * 0.5), top + 11, 11, mat(v, 'cloak', 1));
        // 腕
        rect(b, cx - 7, top + 2, 2, 7, mat(v, 'cloak', 3));
        rect(b, cx + 6, top + 2, 2, 7, mat(v, 'cloak', 2));
        b.set(cx - 7, top + 9, mat(v, 'skin', 3));
        b.set(cx + 7, top + 9, mat(v, 'skin', 2));
        // 刀
        line(b, cx + 4, top + 9, cx + 9, top + 5, mat(v, 'blade', 4));
        // 頭
        const hy = top - 5 + Math.round(p.head - p.bob);
        disc(b, cx, hy, 4, mat(v, 'skin', 3));
        rect(b, cx + 2, hy - 2, 2, 5, mat(v, 'skin', 2));
        b.set(cx - 2, hy, mat(v, 'eye', 0));
        b.set(cx - 2, hy + 1, mat(v, 'eye', 0));
        b.set(cx + 1, hy, mat(v, 'eye', 0));
        b.set(cx + 1, hy + 1, mat(v, 'eye', 0));
        // 笠
        ellipse(b, cx, hy - 3, 8, 2, mat(v, 'hat', 3));
        hline(b, cx - 3, hy - 6, 7, mat(v, 'hat', 4));
        hline(b, cx - 5, hy - 5, 11, mat(v, 'hat', 4));
        hline(b, cx - 7, hy - 1, 15, mat(v, 'hat', 2));
    },
};
const orb = {
    id: 'gfxOrb', tier: 'S', dirs: 1, hover: 6,
    anims: { idle: idleBreath(4, 4, 1) },
    build(b, p, _dir, v) {
        const cx = 12;
        const cy = 9 + Math.round(p.bob);
        disc(b, cx, cy, 6, mat(v, 'shell', 2));
        disc(b, cx, cy, 5, mat(v, 'shell', 3));
        disc(b, cx - 1, cy - 1, 3, mat(v, 'core', 4));
        disc(b, cx - 1, cy - 1, 1, mat(v, 'core', 5));
        b.set(cx - 3, cy - 3, WHITE);
        // 下の飾り（浮いている台）
        hline(b, cx - 3, cy + 7, 7, mat(v, 'shell', 1));
    },
};
let rigsRegistered = false;
function registerTestRigs() {
    if (rigsRegistered)
        return;
    rigsRegistered = true;
    registerRig(figure);
    registerRig(orb);
    registerSpecies({
        gfxFigure: {
            rig: 'gfxFigure',
            variant: { ramps: { leg: 'ink', cloak: 'water', skin: 'skin', eye: 'ink', hat: 'gold', blade: 'steel' } },
        },
        gfxFigure2: {
            rig: 'gfxFigure',
            variant: { ramps: { leg: 'earth', cloak: 'crimson', skin: 'skin', eye: 'ink', hat: 'bone', blade: 'steel' } },
        },
        gfxOrb: { rig: 'gfxOrb', variant: { ramps: { shell: 'indigo', core: 'violet' } } },
    });
}
// ---------------------------------------------------------------------------
// テーマの空気（洞窟の見当）
// ---------------------------------------------------------------------------
const LOOK = {
    theme: 'cave',
    ambient: '#d4d8ee',
    litLevel: 0.88,
    darkLevel: 0.45,
    memoryColor: '#5a6898',
    lantern: { color: '#ffd8a0', radius: 4.5 },
    fog: { color: '#8390b4', alpha: 0.16 },
    grade: { desaturate: 0.1, tint: '#ffcf8a', tintAlpha: 0.1 },
    vignette: 0.32,
    shafts: { count: 2, color: '#ffe6b8', alpha: 0.13 },
    ambientParticles: [],
    palette: { floor: 'stone', wall: 'stone', accent: 'ember' },
};
// ---------------------------------------------------------------------------
// 場面
// ---------------------------------------------------------------------------
const A_IDLE = animIndex('idle');
const A_WALK = animIndex('walk');
const EMBERS = 28;
class TestScene {
    camX = 26;
    camY = 40;
    look = LOOK;
    mapW = MW;
    mapH = MH;
    tileVersion = 0;
    fixedCam = null;
    art = buildTerrain();
    sheets = new SheetCache();
    actors = [];
    order = [];
    player;
    walker;
    orbActor;
    slime;
    playerTile = -1;
    lanternRgb = parseHex(LOOK.lantern.color);
    shadowTex;
    glowTex;
    /** 床の物（旧来の絵）：[種, マス x, マス y] */
    ground = [];
    lavaFrame = 0;
    time = 0;
    /** 火の粉ごとの速さ・位相・横の位置・大きさ（最初に決めておく。毎フレームはハッシュを引かない） */
    ember = new Float32Array(EMBERS * 4);
    /** 松明ごとの揺らぎの種 */
    torchSeed = TORCH_X.map((tx) => flickerSeed(tx, 0));
    constructor() {
        const s = this.sheets;
        const mk = (species, tx, ty, shadow) => {
            const a = {
                species, x: tx * T + 8, y: ty * T + 13, anim: A_IDLE, dir8: 4, frame: 0, shadow,
                hover: s.rigOf(species)?.hover ?? 0, flash: false, light: 0, lightRadius: 0,
            };
            this.actors.push(a);
            this.order.push(a);
            return a;
        };
        this.player = mk(s.index('gfxFigure'), 18, 10, 12);
        this.walker = mk(s.index('gfxFigure2'), 6, 8, 12);
        this.orbActor = mk(s.index('gfxOrb'), 21, 9, 10);
        this.orbActor.light = 0xb070ff;
        this.orbActor.lightRadius = 40;
        this.slime = mk(s.index('slimeBlue'), 7, 11, 12);
        mk(s.index('batCave'), 19, 12, 10);
        mk(s.index('bossForest', true), 11, 5, 26);
        this.ground.push(s.index('stairsDown'), 23, 4);
        this.ground.push(s.index('herb'), 5, 10);
        this.ground.push(s.index('pot'), 20, 11);
        this.ground.push(s.index('trapWarp'), 13, 11);
        this.shadowTex = bakeShadow();
        this.glowTex = bakeGlow(0xffa040);
        for (let i = 0; i < EMBERS; i++) {
            this.ember[i * 4] = 0.12 + 0.18 * hashFloat(i, 1, 77);
            this.ember[i * 4 + 1] = hashFloat(i, 2, 77);
            this.ember[i * 4 + 2] = 3 * T + hashFloat(i, 3, 77) * 9 * T;
            this.ember[i * 4 + 3] = 10 + 8 * hashFloat(i, 4, 77);
        }
    }
    /** 時刻 t（秒）で、カメラとキャラを動かす */
    update(t) {
        this.time = t;
        if (this.fixedCam) {
            this.camX = this.fixedCam[0];
            this.camY = this.fixedCam[1];
        }
        else {
            this.camX = Math.round(26 + 26 * Math.sin(t * 0.21));
            this.camY = Math.round(40 + 40 * Math.sin(t * 0.13 + 1));
        }
        // 主人公：出入口の前を行き来する（歩いた距離でコマを進める）
        const p = this.player;
        const u = 0.5 - 0.5 * Math.cos(t * 0.6);
        const px = 18 * T + 8 + Math.round(48 * u);
        p.dir8 = Math.sin(t * 0.6) >= 0 ? 2 : 6;
        p.anim = Math.abs(Math.sin(t * 0.6)) > 0.08 ? A_WALK : A_IDLE;
        p.frame = p.anim === A_WALK ? Math.floor(px / 3) : Math.floor(t * 4);
        p.x = px;
        const tile = Math.floor(p.y / T) * MW + Math.floor(p.x / T);
        if (tile !== this.playerTile) {
            this.playerTile = tile;
            this.tileVersion++;
        }
        // 明るい部屋を歩く人
        const w = this.walker;
        const v = 0.5 - 0.5 * Math.cos(t * 0.45 + 1);
        w.x = 4 * T + 8 + Math.round(8 * T * v);
        w.dir8 = Math.sin(t * 0.45 + 1) >= 0 ? 2 : 6;
        w.anim = A_WALK;
        w.frame = Math.floor(w.x / 3);
        // 光る玉とそのほか：待機（毎フレーム呼ぶので for-of の反復子も作らない）
        const list = this.actors;
        for (let i = 0; i < list.length; i++) {
            const a = list[i];
            if (a === p || a === w)
                continue;
            a.frame = Math.floor(t * 4 + a.x * 0.1);
        }
        // スライムは 3 秒ごとに白く光る（被弾の閃きの確かめ）
        this.slime.flash = t % 3 < 0.12;
        this.lavaFrame = Math.floor(t * 6) & 3;
    }
    stateOf(tx, ty) {
        if (tx < 0 || ty < 0 || tx >= MW || ty >= MH)
            return TILE_UNEXPLORED;
        if (tx <= 16)
            return TILE_VISIBLE_LIT;
        if (unexploredAt(tx, ty))
            return TILE_UNEXPLORED;
        const ptx = Math.floor(this.player.x / T);
        const pty = Math.floor(this.player.y / T);
        return Math.max(Math.abs(tx - ptx), Math.abs(ty - pty)) <= 2 ? TILE_VISIBLE_DARK : TILE_EXPLORED;
    }
    visibleAt(wx, wy) {
        return this.stateOf(Math.floor(wx / T), Math.floor(wy / T)) >= TILE_VISIBLE_DARK;
    }
    writeTileStates(out) {
        for (let ty = 0; ty < MH; ty++) {
            for (let tx = 0; tx < MW; tx++)
                out[ty * MW + tx] = this.stateOf(tx, ty);
        }
    }
    collectLights(out, _f) {
        const p = this.player;
        out.addRgb(p.x, p.y - 10, LOOK.lantern.radius * T, this.lanternRgb, 0.9);
        for (let i = 0; i < TORCH_X.length; i++) {
            const tx = TORCH_X[i];
            out.addRgb(tx * T + 8, 7, 4 * T, 0xffa050, 0.85, this.torchSeed[i]);
        }
        out.addRgb(5 * T, 15 * T, 3 * T, 0xff6a20, 0.7);
        out.addRgb(10 * T, 15 * T, 3 * T, 0xff6a20, 0.7);
        out.addRgb(22 * T, 13 * T, 2.8 * T, 0xff6a20, 0.7);
        out.addRgb(26 * T, 13 * T, 2.8 * T, 0xff6a20, 0.7);
        for (let i = 0; i < this.actors.length; i++) {
            const a = this.actors[i];
            if (a.light && this.visibleAt(a.x, a.y)) {
                out.addRgb(a.x, a.y - a.hover - 8, a.lightRadius, a.light, 0.8);
            }
        }
    }
    paintTerrain(a, _f) {
        a.drawImage(this.art.base, 0, 0);
        a.drawImage(this.art.lava[this.lavaFrame], 0, 0);
        const fl = this.art.flame[Math.floor(this.time * 9) % 3];
        for (let i = 0; i < TORCH_X.length; i++)
            a.drawImage(fl, TORCH_X[i] * T + 6, 3);
    }
    paintGround(a2, _f) {
        const g = this.ground;
        for (let i = 0; i < g.length; i += 3) {
            const f = this.sheets.frame(g[i], 0, 4, 0);
            if (!f)
                continue;
            // 探索済みのマスだけ（見えていなくても描く。暗さは光の乗算で付く）
            if (this.stateOf(g[i + 1], g[i + 2]) === TILE_UNEXPLORED)
                continue;
            a2.drawImage(f.src, f.sx, f.sy, f.w, f.h, g[i + 1] * T + 8 - f.ax, g[i + 2] * T + 13 - f.ay, f.w, f.h);
        }
    }
    paintActors(b, lighter, _f) {
        // 足元の y の順（確保済みの配列を挿入ソート）
        const o = this.order;
        for (let i = 1; i < o.length; i++) {
            const v = o[i];
            let j = i - 1;
            while (j >= 0 && o[j].y > v.y) {
                o[j + 1] = o[j];
                j--;
            }
            o[j + 1] = v;
        }
        for (let i = 0; i < o.length; i++) {
            const a = o[i];
            if (!this.visibleAt(a.x, a.y))
                continue;
            // 影
            b.globalAlpha = 0.5;
            b.drawImage(this.shadowTex, a.x - a.shadow / 2, a.y - 2, a.shadow, 4);
            b.globalAlpha = 1;
            const f = this.sheets.frame(a.species, a.anim, a.dir8, a.frame, a.flash ? FX_FLASH : FX_NORMAL);
            if (f)
                lighter.drawFrame(f, a.x, a.y, 1, !a.flash);
        }
    }
    paintEmissive(e, _f) {
        e.drawImage(this.art.lavaGlow[this.lavaFrame], 0, 0);
        const fl = this.art.flameGlow[Math.floor(this.time * 9) % 3];
        for (let i = 0; i < TORCH_X.length; i++)
            e.drawImage(fl, TORCH_X[i] * T + 6, 3);
        // キャラは足元の順（paintActors で並べ替え済み）に、光る所以外を黒で描く（手前の体が奥の光を隠す）
        const o = this.order;
        for (let i = 0; i < o.length; i++) {
            const a = o[i];
            if (!this.visibleAt(a.x, a.y))
                continue;
            const f = this.sheets.frame(a.species, a.anim, a.dir8, a.frame, FX_OCCLUDER);
            if (f)
                e.drawImage(f.src, f.sx, f.sy, f.w, f.h, a.x - f.ax, a.y - f.ay, f.w, f.h);
        }
    }
    /** HD の層：左の溶岩から立ちのぼる火の粉（柔らかい光の玉を加算） */
    paintHD(g, f) {
        const t = this.time;
        const em = this.ember;
        g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < EMBERS; i++) {
            const life = (t * em[i * 4] + em[i * 4 + 1]) % 1;
            const wx = em[i * 4 + 2] + Math.sin(t * 1.3 + i) * 5 + life * 6;
            const wy = 14 * T + 4 - life * 70;
            if (!this.visibleAt(wx, 14 * T + 4))
                continue;
            const lx = worldToLogicalX(wx, f.camX);
            const ly = worldToLogicalY(wy, f.camY);
            const size = em[i * 4 + 3];
            g.globalAlpha = Math.sin(Math.PI * life) * 0.9;
            g.drawImage(this.glowTex, lx - size / 2, ly - size / 2, size, size);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
    }
}
/** 足元の影（黒い楕円、ふちがやわらかい） */
function bakeShadow() {
    const w = 32;
    const h = 8;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = (x + 0.5 - w / 2) / (w / 2);
            const dy = (y + 0.5 - h / 2) / (h / 2);
            const d = Math.sqrt(dx * dx + dy * dy);
            const i = (y * w + x) * 4;
            img.data[i] = 8;
            img.data[i + 1] = 6;
            img.data[i + 2] = 16;
            img.data[i + 3] = d >= 1 ? 0 : Math.round(255 * Math.min(1, (1 - d) * 2.2));
        }
    }
    g.putImageData(img, 0, 0);
    return c;
}
/** HD の粒の柔らかい光の玉 */
function bakeGlow(rgb) {
    const s = 32;
    const c = makeCanvas(s, s);
    const g = c.getContext('2d');
    const img = new ImageData(s, s);
    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const dx = (x + 0.5 - s / 2) / (s / 2);
            const dy = (y + 0.5 - s / 2) / (s / 2);
            const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
            const core = Math.pow(1 - d, 3);
            const i = (y * s + x) * 4;
            img.data[i] = Math.min(255, ((rgb >> 16) & 255) + core * 120);
            img.data[i + 1] = Math.min(255, ((rgb >> 8) & 255) + core * 120);
            img.data[i + 2] = Math.min(255, (rgb & 255) + core * 120);
            img.data[i + 3] = Math.round(255 * Math.pow(1 - d, 2));
        }
    }
    g.putImageData(img, 0, 0);
    return c;
}
// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------
function makeStage(w, h, id) {
    const game = document.getElementById('game');
    if (game)
        game.style.display = 'none';
    const stage = document.getElementById('stage');
    if (stage)
        stage.style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.style.display = 'block';
    const canvas = document.createElement('canvas');
    canvas.id = id;
    canvas.width = w;
    canvas.height = h;
    canvas.style.display = 'block';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    document.body.appendChild(canvas);
    return canvas;
}
function readParams(params) {
    const q = Math.max(0, Math.min(2, Number(params.get('q') ?? 2) | 0));
    const scale = Math.max(0.5, Math.min(3, Number(params.get('scale') ?? 1) || 1));
    const tp = params.get('t');
    const cp = params.get('cam');
    let cam = null;
    if (cp) {
        const [x, y] = cp.split(/[,_]/).map((v) => Number(v) | 0);
        cam = [x, y];
    }
    const sync = Math.max(0, Math.min(2, Number(params.get('sync') ?? 1) | 0));
    return {
        q, scale, pp: params.get('pp') === '1', perf: params.get('perf') === '1', sync,
        dof: params.get('dof') !== '0', t: tp !== null ? Number(tp) : null, cam,
        overlay: params.get('overlay') !== '0',
    };
}
/** gfx:test — 合成した場面を動かし続ける */
function openTest(params) {
    const o = readParams(params);
    const canvas = makeStage(1280, 720, 'sheet');
    const comp = new Compositor(o.q);
    comp.dofEnabled = o.dof;
    // 実画素 = 1280×720 × scale。表示も同じ大きさにして、撮った絵が実画素そのものになるようにする
    const size = comp.resize(canvas, SCREEN_W * o.scale, SCREEN_H * o.scale, 1, o.pp);
    const g = canvas.getContext('2d', { alpha: false });
    if (!g)
        return;
    const scene = new TestScene();
    scene.fixedCam = o.cam;
    const title = `q=${o.q} scale=${o.scale} ${size.backW}x${size.backH} artPx=${size.artPx.toFixed(2)}${size.integer ? '' : ' sharp'}`;
    if (o.perf) {
        comp.perf.enabled = true;
        comp.perf.sync = o.sync;
        comp.perf.expose({ quality: o.q, scale: o.scale, backW: size.backW, backH: size.backH });
    }
    const loop = (now) => {
        const tt = o.t !== null ? o.t * 1000 : now;
        scene.update(tt / 1000);
        comp.render(g, scene, o.t !== null && !o.perf ? tt : now);
        if (o.perf && o.overlay)
            comp.perf.drawOverlay(g, title);
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
/** gfx:passes — 1 フレーム描いて、途中の紙を全部並べる */
function openPasses(params) {
    const o = readParams(params);
    const comp = new Compositor(o.q);
    comp.dofEnabled = o.dof;
    const main = document.createElement('canvas');
    comp.resize(main, SCREEN_W * o.scale, SCREEN_H * o.scale, 1, o.pp);
    const mg = main.getContext('2d', { alpha: false });
    if (!mg)
        return;
    const scene = new TestScene();
    scene.fixedCam = o.cam ?? [26, 40];
    const t = o.t ?? 3;
    // 2 回描く（1 回目でマスの紙と光の絵が焼ける）
    for (let i = 0; i < 2; i++) {
        scene.update(t);
        comp.render(mg, scene, t * 1000);
    }
    const bufs = comp.debugBuffers();
    bufs.push({ name: `final ${main.width}x${main.height}`, c: main });
    const cols = 4;
    const cw = ART_W;
    const chh = ART_H;
    const pad = 14;
    const rows = Math.ceil(bufs.length / cols);
    const sheet = makeStage(pad + cols * (cw + pad), pad + rows * (chh + 22 + pad), 'sheet');
    const g = sheet.getContext('2d');
    if (!g)
        return;
    g.fillStyle = '#15131c';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.imageSmoothingEnabled = false;
    g.font = '13px monospace';
    g.textBaseline = 'top';
    bufs.forEach((b, i) => {
        const x = pad + (i % cols) * (cw + pad);
        const y = pad + Math.floor(i / cols) * (chh + 22 + pad);
        const src = b.c;
        // 透明が分かるよう市松の地
        for (let yy = 0; yy < chh; yy += 12) {
            for (let xx = 0; xx < cw; xx += 12) {
                g.fillStyle = ((xx + yy) / 12) & 1 ? '#3a3844' : '#2c2a34';
                g.fillRect(x + xx, y + 22 + yy, 12, 12);
            }
        }
        let k = Math.min(cw / src.width, chh / src.height);
        if (k >= 1)
            k = Math.floor(k);
        g.drawImage(b.c, x, y + 22, src.width * k, src.height * k);
        g.fillStyle = '#e8d6a0';
        g.fillText(`${b.name}  (${src.width}x${src.height})`, x, y + 4);
    });
}
/** ?scene=gfx:… を開く */
export function open(spec, params, _canvas) {
    loadAllSprites();
    registerTestRigs();
    const kind = spec.split(':')[1] ?? 'test';
    if (kind === 'passes')
        openPasses(params);
    else
        openTest(params);
}
//# sourceMappingURL=gfx.js.map