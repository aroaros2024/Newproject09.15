/**
 * ダンジョンの場面：描画エンジン（gfx/compositor.ts）に絵を渡す WorldScene の実装。
 *
 * 持つもの
 *   - VisualWorld（anim/）… 見た目の台帳・拍・カメラ。ゲームのできごとを受けて、当たりの瞬間に演出を呼ぶ
 *   - VfxLayer（world/vfxLayer.ts）… その演出の受け口（粒・飛び道具・ビーム・光・揺れ・数字・告知）
 *   - 粒子の置き場とカールノイズの流れ場 … 環境の粒（塵・火の粉・胞子…）と技の粒
 *   - SheetCache（gfx/sheets.ts）… キャラのコマを焼いた頁
 *   - TerrainView（world/terrainView.ts）… 階の地形の絵
 *
 * 【情報を漏らさない決まり】
 *   - 見えないマスの敵は描かない（VisualWorld が見えるマスの者だけを並べる）。光る敵の光も同じ
 *   - 床の道具とワナは探索済みのマスだけ（暗さは光の乗算で付く）。未探索は描画エンジンが黒く塗る
 *   - 化けたミミックは床の道具と同じ経路・同じ揺れで描く
 *   - 環境の粒は見えているマスにだけ生まれる（溶岩の火の粉で未探索の溶岩を教えない）
 *
 * 毎フレームの関数（paint* / collectLights）の中では配列・関数・文字列を作らない。
 */
import { Rng as RngClass } from '../../core/rng.js';
import { STATUS_BIT } from '../anim/types.js';
import { VisualWorld } from '../anim/visualWorld.js';
import { iconKeyOf } from '../art/items.js';
import { PixBuf, bbox } from '../art/pixbuf.js';
import { TIER_BOX, getRig, getSpecies, renderFrame } from '../art/rig.js';
import { ornamentOf } from '../art/fxSprites.js';
import { CURL_GRID_DUNGEON, CurlField } from '../gfx-core/curl.js';
import { TILE_EXPLORED, TILE_UNEXPLORED, TILE_VISIBLE_DARK, TILE_VISIBLE_LIT, flickerSeed, parseHex } from '../gfx-core/lightModel.js';
import { ParticlePool } from '../gfx-core/particles.js';
import { ctx2d, makeCanvas } from '../gfx/canvas.js';
import { itemCanvas, ornamentCanvas, trapCanvas } from '../gfx/fxAtlas.js';
import { drawEmissive, drawHDParticles, drawPixelParticles, makeHDAtlas } from '../gfx/particlesDraw.js';
import { FX_DISSOLVE_25, FX_FLASH, FX_NORMAL, FX_OCCLUDER, SheetCache, animIndex, } from '../gfx/sheets.js';
import { ART_SCALE, CROP_X, CROP_Y } from '../gfx/view.js';
import { font } from '../theme.js';
import { TerrainView } from './terrainView.js';
import { VfxLayer } from './vfxLayer.js';
const T = 16;
/** テーマの空気の仮の値（テーマの描き手が無い間）。暗い洞窟の環境光・ランタン・霧 */
function fallbackLook(theme) {
    return {
        theme: theme.art,
        ambient: '#c8cce6',
        litLevel: 0.88,
        darkLevel: 0.45,
        memoryColor: '#56628e',
        lantern: { color: '#ffd8a0', radius: 4.5 },
        fog: { color: '#7f8cb0', alpha: 0.12 },
        grade: { desaturate: 0.1, tint: '#ffcf8a', tintAlpha: 0.08 },
        vignette: 0.3,
        shafts: { count: 1, color: '#ffe6b8', alpha: 0.1 },
        ambientParticles: [],
        palette: { floor: 'stone', wall: 'stone', accent: 'ember' },
    };
}
const NO_THEME_ART = { lookOf: () => null, styleOf: () => null };
/** 常時の飾りを出す状態異常（上から順に 2 つまで） */
const ORNAMENT_ORDER = [
    'asleep', 'deepAsleep', 'paralyzed', 'confused', 'fainted', 'sealed', 'bound', 'burning', 'poisoned',
    'deadlyPoisoned', 'blind', 'slow', 'quick', 'wet', 'terrified', 'strUp', 'invincible',
];
export class DungeonScene {
    camX = 0;
    camY = 0;
    look;
    mapW = 1;
    mapH = 1;
    tileVersion = 0;
    shakeX = 0;
    shakeY = 0;
    flashAlpha = 0;
    flashColor = '#ffffff';
    vfx;
    vw;
    pool;
    field = new CurlField(CURL_GRID_DUNGEON);
    atlas = makeHDAtlas();
    sheets = new SheetCache();
    terrain;
    world;
    depth = -1;
    floorSeed = -1;
    time = 0;
    /** 種の id → 頁の番号（-1 = 絵が無い） */
    speciesIdx = new Map();
    /** 種の id → 足元から絵の上端までのドット（状態異常の飾りの高さ） */
    headOf = new Map();
    roomDark = [];
    lanternRgb;
    hdXf = { scale: ART_SCALE, offX: 0, offY: 0 };
    emXf = { scale: 1, offX: 0, offY: 0 };
    shadowTex;
    /** 液体・見える床のマス（環境の粒の生まれる所を選ぶ） */
    lavaTiles = new Int32Array(0);
    waterTiles = new Int32Array(0);
    spawn;
    /** 描く順に並べたキャラ（paintActors で並べ、paintEmissive で使い回す） */
    drawN = 0;
    /** 店の値札の文字（道具の uid → 文字。毎フレーム作らない） */
    priceText = new Map();
    deathBuf = new Map();
    /** 画質の段ごとの環境の粒の倍率 */
    ambientScale = 1;
    constructor(world, onSfx, themeArt = NO_THEME_ART) {
        this.world = world;
        this.pool = new ParticlePool(2048, new RngClass('fx:dungeon'));
        this.vfx = new VfxLayer(this.pool, onSfx, (tx, ty, tag) => this.dissolveSprite(tx, ty, tag));
        this.vw = new VisualWorld(this.vfx);
        this.look = themeArt.lookOf(world.dungeon.theme) ?? fallbackLook(world.dungeon.theme);
        this.lanternRgb = parseHex(this.look.lantern.color);
        this.terrain = new TerrainView(themeArt.styleOf(world.dungeon.theme), world.dungeon.theme);
        this.shadowTex = bakeShadow();
        this.spawn = (region, out, rng) => this.spawnPoint(region, out, rng);
    }
    /** 画面に入った時（中断から戻った時も） */
    reset(world) {
        this.world = world;
        this.vw.reset();
        this.vfx.reset();
        this.depth = -1;
    }
    // =========================================================== 階と 1 手
    /** 階が変わったか（または初めて）を見て、地形・粒・コマの準備をやり直す */
    checkFloor() {
        const run = this.world.run;
        const map = this.world.map;
        if (run.depth === this.depth && map.seed === this.floorSeed)
            return;
        this.depth = run.depth;
        this.floorSeed = map.seed;
        this.mapW = map.width;
        this.mapH = map.height;
        this.terrain.build(map);
        this.roomDark.length = 0;
        for (const r of map.rooms)
            this.roomDark[r.id] = r.dark;
        const lava = [];
        const water = [];
        map.tiles.forEach((t, i) => {
            if (t.kind === 'lava')
                lava.push(i);
            else if (t.kind === 'water')
                water.push(i);
        });
        this.lavaTiles = Int32Array.from(lava);
        this.waterTiles = Int32Array.from(water);
        this.pool.clear();
        this.pool.clearAmbient();
        for (const a of this.look.ambientParticles)
            this.pool.addAmbient(a, this.spawn);
        this.pool.setAmbientScale(this.ambientScale);
        this.priceText.clear();
        this.tileVersion++;
        this.vfx.setFloorCard(this.world.dungeon.name, `B${run.depth}F`);
        // この階に居る者のコマを先に焼く（初めて見えた瞬間に焼くと、そのフレームが引っかかる）
        const ids = new Set(['player']);
        for (const m of run.monsters)
            ids.add(m.defId);
        for (const a of run.allies)
            ids.add(a.defId);
        this.prebake([...ids]);
    }
    /** 1 手進んだ後（pumpEvents から）：見える範囲と地形の変化を描画エンジンへ知らせる */
    onTurn() {
        this.checkFloor();
        this.terrain.update(this.world.map);
        this.tileVersion++;
    }
    /** 固定 60Hz */
    tick(stepMs, world) {
        this.world = world;
        this.time += stepMs;
        this.checkFloor();
        this.vw.tick(stepMs, world);
        this.vfx.tick(stepMs);
        if (this.vfx.hitstopLeft <= 0) {
            this.field.tick();
            this.pool.step(stepMs / 1000, this.field);
        }
        this.camX = this.vw.camera.camX;
        this.camY = this.vw.camera.camY;
        this.shakeX = this.vfx.shakeX;
        this.shakeY = this.vfx.shakeY;
        this.flashAlpha = this.vfx.flashAlpha;
        this.flashColor = this.vfx.flashColor;
    }
    /** 主人公の足元の画面の位置（論理座標）。案内の札を出す所 */
    playerScreen(out) {
        const d = this.vw.actor(this.world.player.id);
        const ax = d ? d.artX : this.world.player.pos.x * T + 8;
        const ay = d ? d.artY : this.world.player.pos.y * T + 13;
        out.x = (ax - this.camX) * ART_SCALE - CROP_X;
        out.y = (ay - this.camY) * ART_SCALE - CROP_Y;
    }
    // =========================================================== WorldScene
    writeTileStates(out) {
        const tiles = this.world.map.tiles;
        for (let i = 0; i < tiles.length; i++) {
            const t = tiles[i];
            if (t.visible) {
                const dark = t.roomId < 0 || this.roomDark[t.roomId] === true;
                out[i] = dark ? TILE_VISIBLE_DARK : TILE_VISIBLE_LIT;
            }
            else {
                out[i] = t.explored ? TILE_EXPLORED : TILE_UNEXPLORED;
            }
        }
    }
    collectLights(out, _f) {
        const world = this.world;
        // 主人公のランタン（明るい部屋では弱く小さく）
        const pd = this.vw.actor(world.player.id);
        const px = pd ? pd.artX : world.player.pos.x * T + 8;
        const py = pd ? pd.artY : world.player.pos.y * T + 13;
        const ptile = world.map.tiles[world.player.pos.y * world.map.width + world.player.pos.x];
        const litRoom = ptile && ptile.roomId >= 0 && this.roomDark[ptile.roomId] === false;
        out.addRgb(px, py - 10, (litRoom ? 3 : this.look.lantern.radius) * T, this.lanternRgb, litRoom ? 0.55 : 0.9);
        // 地形の灯り（松明は明るい部屋だけ灯る。暗い部屋の燭台は火が無い）
        const lights = this.terrain.lights;
        const x0 = this.camX - 64;
        const y0 = this.camY - 64;
        const x1 = this.camX + 428 + 64;
        const y1 = this.camY + 240 + 64;
        for (let i = 0; i < lights.length; i++) {
            const l = lights[i];
            const wx = l.tx * T + l.ox;
            const wy = l.ty * T + l.oy;
            if (wx < x0 || wx > x1 || wy < y0 || wy > y1)
                continue;
            if ((l.kind === 'torch' || l.kind === 'brazier') && l.roomId >= 0 && this.roomDark[l.roomId])
                continue;
            const seed = l.kind === 'torch' || l.kind === 'brazier' ? flickerSeed(l.tx, l.ty) : 0;
            out.addRgb(wx, wy, l.radius * T, parseHexCached(l.color), l.intensity, seed);
        }
        // 一瞬の光（回復・爆発・魔法）
        const v = this.vfx;
        for (let i = 0; i < v.lN; i++) {
            out.addRgb(v.lX[i], v.lY[i], v.lR[i], parseHexCached(v.lColor[i]), v.lightStrength(i));
        }
        // 光る敵（見えている者だけ並んでいる）
        const n = this.vw.sortDrawables();
        for (let i = 0; i < n; i++) {
            const d = this.vw.drawableAt(i);
            if (d.disguise !== null || d.species === 'player')
                continue;
            const light = getSpecies(d.species)?.light;
            if (light)
                out.addRgb(d.artX, d.artY - d.lift - 8, light.radius * T, parseHexCached(light.color), light.intensity * d.alpha);
        }
    }
    paintTerrain(a, f) {
        const tv = this.terrain;
        a.drawImage(tv.base, 0, 0);
        if (tv.hasLiquid && tv.liquid.length > 0) {
            const fps = f.quality.liquidFps || 6;
            a.drawImage(tv.liquid[Math.floor(this.time / (1000 / fps)) % tv.liquid.length], 0, 0);
        }
    }
    paintGround(a2, _f) {
        const world = this.world;
        const map = world.map;
        // ワナ（見つけていて、まだ残っているもの。探索済みのマスだけ）
        const x0 = Math.max(0, Math.floor(this.camX / T) - 1);
        const y0 = Math.max(0, Math.floor(this.camY / T) - 1);
        const x1 = Math.min(map.width - 1, Math.floor((this.camX + 428) / T) + 1);
        const y1 = Math.min(map.height - 1, Math.floor((this.camY + 240) / T) + 1);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const t = map.tiles[y * map.width + x];
                if (!t.trap || !t.trap.revealed || t.trap.used || !t.explored)
                    continue;
                const c = trapCanvas(t.trap.defId);
                if (c)
                    a2.drawImage(c, x * T, y * T);
            }
        }
        // 床の道具（探索済みのマスだけ。少し上下に揺れる）
        const known = world.run.identify.known;
        const items = world.run.floorItems;
        for (let i = 0; i < items.length; i++) {
            const f = items[i];
            const t = map.tiles[f.pos.y * map.width + f.pos.x];
            if (!t || !t.explored)
                continue;
            if (f.pos.x < x0 || f.pos.x > x1 || f.pos.y < y0 || f.pos.y > y1)
                continue;
            const c = itemCanvas(iconKeyOf(f.item.defId, !!known[f.item.defId]));
            if (!c)
                continue;
            const bob = Math.round(Math.sin(this.time / 380 + f.pos.x + f.pos.y) * 1);
            a2.drawImage(c, f.pos.x * T, f.pos.y * T - 1 + bob);
        }
        // 化けたミミック（道具と同じ経路・同じ揺れ）
        const n = this.vw.sortDrawables();
        for (let i = 0; i < n; i++) {
            const d = this.vw.drawableAt(i);
            if (d.disguise === null)
                continue;
            const c = itemCanvas(iconKeyOf(d.disguise, !!known[d.disguise]));
            if (!c)
                continue;
            const bob = Math.round(Math.sin(this.time / 380 + d.tileX + d.tileY) * 1);
            a2.drawImage(c, d.tileX * T, d.tileY * T - 1 + bob);
        }
    }
    paintActors(b, lighter, _f) {
        const n = this.vw.sortDrawables();
        this.drawN = n;
        this.playerDrawn = -1;
        this.playerHidden = false;
        for (let i = 0; i < n; i++) {
            const d = this.vw.drawableAt(i);
            if (d.disguise !== null)
                continue;
            this.drawActor(b, lighter, d, i);
        }
        // 大きな敵が主人公の手前に重なったら、主人公の影絵を薄く重ねて居場所を見せる
        if (this.playerHidden && this.playerDrawn >= 0) {
            const d = this.vw.drawableAt(this.playerDrawn);
            const idx = this.speciesIndex(d);
            if (idx >= 0) {
                const anim = this.animOf(idx, d.anim);
                const f = this.sheets.frame(idx, anim, d.dir8, this.frameOf(idx, anim, d.frame), FX_NORMAL);
                if (f)
                    lighter.drawFrame(f, d.artX, d.artY - d.lift + d.submerge, 0.45 * d.alpha, true);
            }
        }
        // ドットの粒（キャラの上。光の乗算より上なので、自分で光る色のまま見える）
        drawPixelParticles(b, this.pool, 0, 0);
        this.vfx.paintPixel(b);
    }
    paintEmissive(e, _f) {
        e.drawImage(this.terrain.emissive, 0, 0);
        // キャラは光る所以外を黒で（手前の体が奥の光を隠す）
        for (let i = 0; i < this.drawN; i++) {
            const d = this.vw.drawableAt(i);
            if (d.disguise !== null || d.alpha <= 0)
                continue;
            const idx = this.speciesIndex(d);
            if (idx < 0)
                continue;
            const a = this.animOf(idx, d.anim);
            const f = this.sheets.frame(idx, a, d.dir8, this.frameOf(idx, a, d.frame), FX_OCCLUDER);
            if (f)
                e.drawImage(f.src, f.sx, f.sy, f.w, f.h, d.artX - f.ax, d.artY - d.lift - f.ay, f.w, f.h);
        }
        drawEmissive(e, this.pool, this.emXf, this.atlas);
    }
    paintHD(g, f) {
        this.hdXf.offX = -f.camX * ART_SCALE - CROP_X;
        this.hdXf.offY = -f.camY * ART_SCALE - CROP_Y;
        drawHDParticles(g, this.pool, this.hdXf, this.atlas);
        this.vfx.paintHD(g, f.camX, f.camY);
        this.paintPrices(g, f);
    }
    /** 描画エンジンの後（UI の下）：告知の帯・暗転・階の札 */
    paintOverlay(g) {
        this.vfx.paintOverlay(g);
    }
    // =========================================================== キャラ 1 体
    /** 主人公を描いた順番（-1 はまだ）と、その絵の範囲。後から重なる者があれば影絵を重ねる */
    playerDrawn = -1;
    playerHidden = false;
    playerRect = new Float32Array(4);
    drawActor(b, lighter, d, order) {
        const idx = this.speciesIndex(d);
        const alpha = d.alpha * (1 - d.warp);
        if (alpha <= 0.01)
            return;
        const footY = d.artY - d.lift + d.submerge;
        // 影（地面に残す。浮いている者は薄く）
        const shadowW = d.boss ? 40 : 14;
        b.globalAlpha = (d.lift > 0 ? 0.3 : 0.45) * alpha;
        b.drawImage(this.shadowTex, d.artX - shadowW / 2, d.artY - 3, shadowW, 5);
        b.globalAlpha = 1;
        if (idx < 0)
            return;
        let fx = FX_NORMAL;
        if (d.dying && d.dissolve > 0)
            fx = FX_DISSOLVE_25 + Math.min(3, d.dissolve - 1);
        else if (d.flash > 0.5)
            fx = FX_FLASH;
        const anim = this.animOf(idx, d.anim);
        const f = this.sheets.frame(idx, anim, d.dir8, this.frameOf(idx, anim, d.frame), fx);
        if (!f)
            return;
        // 主人公との重なり（絵の枠で見る。枠の余白のぶん少し内側で判定する）
        const x0 = d.artX - f.ax + 4;
        const y0 = footY - f.ay + 4;
        const x1 = x0 + f.w - 8;
        const y1 = y0 + f.h - 8;
        if (d.species === 'player' && d.kind === 'player') {
            this.playerDrawn = order;
            this.playerRect[0] = x0;
            this.playerRect[1] = y0;
            this.playerRect[2] = x1;
            this.playerRect[3] = y1;
        }
        else if (this.playerDrawn >= 0 && !this.playerHidden) {
            const r = this.playerRect;
            if (x0 < r[2] && r[0] < x1 && y0 < r[3] && r[1] < y1)
                this.playerHidden = true;
        }
        if (d.submerge > 0) {
            // 水に沈める：水面（足元）より下は描かない
            b.save();
            b.beginPath();
            b.rect(d.artX - f.w, d.artY - f.h - 8, f.w * 2, f.h + 8);
            b.clip();
            lighter.drawFrame(f, d.artX, footY, alpha, fx !== FX_FLASH);
            b.restore();
            // 波紋
            b.fillStyle = 'rgba(200,230,255,0.55)';
            const w = 6 + ((this.time / 120) | 0) % 4;
            b.fillRect(d.artX - w, d.artY, w * 2, 1);
        }
        else {
            lighter.drawFrame(f, d.artX, footY, alpha, fx !== FX_FLASH);
        }
        if (d.dying)
            return;
        // 常時の飾り（状態異常。上から順に 2 つまで）
        if (d.statusMask !== 0) {
            const head = this.headHeight(d.species, f.ay);
            let shown = 0;
            for (let k = 0; k < ORNAMENT_ORDER.length && shown < 2; k++) {
                const id = ORNAMENT_ORDER[k];
                if ((d.statusMask & STATUS_BIT[id]) === 0)
                    continue;
                const spec = ornamentOf(id);
                if (!spec)
                    continue;
                const c = ornamentCanvas(id, Math.floor((this.time / 1000) * spec.fps));
                if (!c)
                    continue;
                const oy = spec.anchor === 'head' ? footY - head - 12 - shown * 6
                    : spec.anchor === 'body' ? footY - Math.round(head * 0.55) - 7 : footY - 10;
                lighter.drawImage(c, 0, 0, 14, 14, d.artX - 7 + shown * 5, oy, d.artX, d.artY, alpha, false);
                shown++;
            }
        }
        // 仲間の印（頭の上の小さな緑の三角）
        if (d.kind === 'ally') {
            const top = footY - this.headHeight(d.species, f.ay) - 5;
            b.fillStyle = '#7fe08f';
            b.fillRect(d.artX - 2, top, 5, 1);
            b.fillRect(d.artX - 1, top + 1, 3, 1);
            b.fillRect(d.artX, top + 2, 1, 1);
        }
    }
    /** 足元から絵の上端までの高さ（待機の 1 コマ目で測って覚える） */
    headHeight(species, fallbackAy) {
        const hit = this.headOf.get(species);
        if (hit !== undefined)
            return hit;
        let h = Math.min(fallbackAy, 30);
        const def = getSpecies(species);
        const rig = def ? getRig(def.rig) : undefined;
        if (def && rig) {
            const box = TIER_BOX[rig.tier];
            const buf = new PixBuf(box.w, box.h);
            renderFrame(buf, rig, def.variant, 'idle', 4, 0);
            const r = bbox(buf);
            if (r.h > 0)
                h = box.ay - r.y;
        }
        this.headOf.set(species, h);
        return h;
    }
    /** 頁の番号（主人公のリグがまだ無い間は旧来の 8 方向の絵） */
    speciesIndex(d) {
        const key = d.species === 'player' && !getSpecies('player') ? `player${d.dir8 & 7}` : d.species;
        let idx = this.speciesIdx.get(key);
        if (idx === undefined) {
            idx = this.sheets.index(key, d.boss && !getSpecies(key));
            this.speciesIdx.set(key, idx);
        }
        return idx;
    }
    /** 動きの番号。その種に無い動きは待機 */
    animOf(idx, anim) {
        const a = animIndex(anim);
        return this.sheets.frameCount(idx, a) > 0 ? a : 0;
    }
    /**
     * コマの番号をその動きのコマ数に収める。台帳のコマ番号はリグの動きのコマ数で数えるが、
     * 旧来の絵（1 コマ）やコマ数の違う動きへ落ちた時にはみ出すと、頁の隣の絵を読んでしまう
     */
    frameOf(idx, anim, frame) {
        const n = this.sheets.frameCount(idx, anim);
        return n > 0 ? ((frame % n) + n) % n : 0;
    }
    /** 撃破：倒れた者の絵の 1 ドットずつを粒にして崩す（120 個まで） */
    dissolveSprite(tileX, tileY, species) {
        const def = getSpecies(species);
        const rig = def ? getRig(def.rig) : undefined;
        if (!def || !rig)
            return;
        const box = TIER_BOX[rig.tier];
        let buf = this.deathBuf.get(rig.tier);
        if (!buf) {
            buf = new PixBuf(box.w, box.h);
            this.deathBuf.set(rig.tier, buf);
        }
        renderFrame(buf, rig, def.variant, 'hurt', 4, 0);
        const footX = tileX * T + 8;
        const footY = tileY * T + 13 - (rig.hover ?? 0);
        this.pool.fromSprite(buf, footX - box.ax, footY - box.ay, box.w > 40 ? 3 : 2);
    }
    /** 環境の粒の生まれる所（見えているマスだけ。割り当てをしない） */
    spawnPoint(region, out, rng) {
        const map = this.world.map;
        const tiles = map.tiles;
        const pick = (list) => {
            if (list.length === 0)
                return false;
            for (let k = 0; k < 4; k++) {
                const i = list[rng.int(list.length)];
                if (!tiles[i].visible)
                    continue;
                out[0] = (i % map.width) * T + rng.float() * T;
                out[1] = Math.floor(i / map.width) * T + rng.float() * T;
                return true;
            }
            return false;
        };
        if (region === 'lava')
            return pick(this.lavaTiles);
        if (region === 'water')
            return pick(this.waterTiles);
        if (region === 'torch') {
            const lights = this.terrain.lights;
            if (lights.length === 0)
                return false;
            for (let k = 0; k < 4; k++) {
                const l = lights[rng.int(lights.length)];
                if (l.kind !== 'torch' && l.kind !== 'brazier')
                    continue;
                if (l.roomId >= 0 && this.roomDark[l.roomId])
                    continue;
                const t = tiles[l.ty * map.width + l.tx];
                const below = tiles[(l.ty + 1) * map.width + l.tx];
                if (!(t?.visible || below?.visible))
                    continue;
                out[0] = l.tx * T + l.ox + (rng.float() - 0.5) * 3;
                out[1] = l.ty * T + l.oy - 2 - rng.float() * 3;
                return true;
            }
            return false;
        }
        // view / shaft：画面の中の見えている床
        for (let k = 0; k < 6; k++) {
            const wx = this.camX + rng.float() * 428;
            const wy = this.camY + (region === 'shaft' ? rng.float() * 140 : rng.float() * 240);
            const tx = Math.floor(wx / T);
            const ty = Math.floor(wy / T);
            if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height)
                continue;
            const t = tiles[ty * map.width + tx];
            if (!t.visible || t.kind === 'wall')
                continue;
            out[0] = wx;
            out[1] = wy;
            return true;
        }
        return false;
    }
    /** 店の値札（見えている店の道具だけ） */
    paintPrices(g, f) {
        const items = this.world.run.floorItems;
        const map = this.world.map;
        let first = true;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.item.shopPrice <= 0)
                continue;
            const t = map.tiles[it.pos.y * map.width + it.pos.x];
            if (!t || !t.visible)
                continue;
            if (first) {
                g.save();
                g.font = font(14, 'bold');
                g.textAlign = 'center';
                g.lineWidth = 3;
                g.strokeStyle = '#0b1020';
                g.fillStyle = '#ffd98a';
                first = false;
            }
            let s = this.priceText.get(it.item.uid);
            if (s === undefined) {
                s = `${it.item.shopPrice}G`;
                this.priceText.set(it.item.uid, s);
            }
            const x = (it.pos.x * T + 8 - f.camX) * ART_SCALE - CROP_X;
            const y = (it.pos.y * T - f.camY) * ART_SCALE - CROP_Y - 2;
            g.strokeText(s, x, y);
            g.fillText(s, x, y);
        }
        if (!first)
            g.restore();
    }
    /** 次の階の絵を暗転の間に焼いておく（種の頁） */
    prebake(ids) {
        this.sheets.prebake(ids, [FX_NORMAL, FX_FLASH, FX_OCCLUDER]);
    }
    /** 見えない所の map（テスト用） */
    get floorMap() {
        return this.world.map;
    }
    /** 粒の数（計測用） */
    get particleCount() {
        return this.pool.count;
    }
}
const hexCache = new Map();
function parseHexCached(hex) {
    let v = hexCache.get(hex);
    if (v === undefined) {
        v = parseHex(hex);
        hexCache.set(hex, v);
    }
    return v;
}
/** 影（柔らかい楕円）。1 枚だけ焼いて伸ばして使う */
function bakeShadow() {
    const c = makeCanvas(32, 10);
    const g = ctx2d(c);
    const grad = g.createRadialGradient(16, 5, 0, 16, 5, 16);
    grad.addColorStop(0, 'rgba(0,0,0,0.9)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.save();
    g.scale(1, 10 / 32);
    g.fillRect(0, 0, 32, 32);
    g.restore();
    return c;
}
//# sourceMappingURL=dungeonScene.js.map