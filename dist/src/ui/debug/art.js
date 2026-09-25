/**
 * 検証用の場面（ドット絵の見本帳）。URL に ?scene=art:… を付けると開く。
 *
 *   ?scene=art:palette                 パレットの全色
 *   ?scene=art:species:<種の id>        その種の全部の動き × 向き × コマ
 *   ?scene=art:rig:<リグの id>          そのリグを使う全部の種
 *   ?scene=art:lineup                  全部の種の待機（手前向き）を段ごとに並べる
 *   ?scene=art:lineup&tier=L           段を絞る
 *   ?scene=art:items                   道具の絵（全部の鍵。一覧の大きさでも並べる）
 *   ?scene=art:traps                   ワナの絵
 *   ?scene=art:fx                      演出の絵（状態異常の飾り・矢・魔法の玉・火花・爆発）
 *
 * 付けられるもの：&scale=4（拡大率）&gray=1（明るさだけで見る）
 *
 * ゲームの画面は使わず、ページに大きなキャンバス（#sheet）を 1 枚作って描く。
 * tools/shots.mjs はこのキャンバスを撮る。
 */
import '../art/index.js';
import { PAL_HEX, PAL_SIZE, RAMPS, STEPS, WHITE, ci, luminance } from '../art/palette.js';
import { PixBuf } from '../art/pixbuf.js';
import { ANIM_IDS, TIER_BOX, allSpeciesIds, animOf, getRig, getSpecies, renderFrame, } from '../art/rig.js';
import { PAL_RGBA } from '../art/palette.js';
import { ICON_SIZE, allIconKeys, buildIcon, iconKeyOf } from '../art/items.js';
import { ALL_ITEMS, allTraps, tryGetItem } from '../../data/registry.js';
import { buildTrapIcon } from '../art/traps.js';
import { ARROW_SIZE, BLAST_FRAMES, BLAST_SIZE, ORB_SIZE, ORN_SIZE, SPARK_FRAMES, SPARK_SIZE, allOrnamentIds, buildArrow, buildExplosion, buildHitSpark, buildOrb, buildOrnament, ornamentOf, } from '../art/fxSprites.js';
const BG_GREY = '#5a5f6e';
const BG_DARK = '#14121c';
const BG_WARM = '#6b5a44';
/** 描く向き（8 方向の番号）。反転した西向きも 1 つ見せる */
function dirsToShow(rig) {
    if (rig.dirs === 5)
        return [4, 3, 2, 1, 0, 6];
    if (rig.dirs === 3)
        return [4, 2, 0, 6];
    return [4, 6];
}
const DIR_LABEL = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W(反転)', 'NW'];
function makeSheet(w, h, bg = BG_GREY) {
    const game = document.getElementById('game');
    if (game)
        game.style.display = 'none';
    const stage = document.getElementById('stage');
    if (stage)
        stage.style.display = 'block';
    document.body.style.overflow = 'auto';
    const canvas = document.createElement('canvas');
    canvas.id = 'sheet';
    canvas.width = Math.ceil(w);
    canvas.height = Math.ceil(h);
    canvas.style.imageRendering = 'pixelated';
    canvas.style.display = 'block';
    document.body.appendChild(canvas);
    const g = canvas.getContext('2d');
    if (!g)
        throw new Error('2D コンテキストを取得できませんでした');
    g.imageSmoothingEnabled = false;
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    return { canvas, g };
}
/** 画用紙を拡大して描く。gray なら明るさだけにする */
function blit(g, b, x, y, k, gray = false) {
    const img = new ImageData(b.w, b.h);
    const u32 = new Uint32Array(img.data.buffer);
    for (let i = 0; i < b.px.length; i++) {
        const c = b.px[i];
        if (c === 0)
            continue;
        if (gray) {
            const v = Math.round(Math.sqrt(luminance(c)) * 255);
            u32[i] = ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
        }
        else {
            u32[i] = PAL_RGBA[c];
        }
    }
    const tmp = document.createElement('canvas');
    tmp.width = b.w;
    tmp.height = b.h;
    const tg = tmp.getContext('2d');
    if (!tg)
        return;
    tg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, Math.round(x), Math.round(y), b.w * k, b.h * k);
}
function label(g, text, x, y, color = '#f1ebdd', size = 14) {
    g.font = `${size}px monospace`;
    g.fillStyle = color;
    g.textBaseline = 'top';
    g.fillText(text, x, y);
}
// ---------------------------------------------------------------------------
function palette() {
    const cell = 40;
    const { g } = makeSheet(120 + STEPS * cell, 40 + (RAMPS.length + 1) * cell, BG_DARK);
    RAMPS.forEach((name, r) => {
        label(g, name, 8, 30 + r * cell + 12);
        for (let s = 0; s < STEPS; s++) {
            g.fillStyle = PAL_HEX[ci(r, s)];
            g.fillRect(100 + s * cell, 30 + r * cell, cell - 4, cell - 4);
        }
    });
    label(g, 'white', 8, 30 + RAMPS.length * cell + 12);
    g.fillStyle = PAL_HEX[WHITE];
    g.fillRect(100, 30 + RAMPS.length * cell, cell - 4, cell - 4);
    label(g, `${PAL_SIZE - 1} colors`, 8, 6);
}
/** 1 つの種の見本帳 */
function speciesSheet(id, k, gray, sheet, top = 0) {
    const def = getSpecies(id);
    const rig = def ? getRig(def.rig) : undefined;
    if (!def || !rig) {
        if (!sheet) {
            const s = makeSheet(600, 60, BG_DARK);
            label(s.g, `種 ${id} が見つからない`, 10, 20, '#ff8080');
        }
        return 0;
    }
    const box = TIER_BOX[rig.tier];
    const dirs = dirsToShow(rig);
    const anims = ANIM_IDS.filter((a) => rig.anims[a]);
    const maxFrames = Math.max(...anims.map((a) => rig.anims[a]?.frames ?? 1));
    const cellW = box.w * k + 6;
    const cellH = box.h * k + 6;
    const rowsH = anims.length * dirs.length * cellH;
    const width = 140 + maxFrames * cellW + 3 * (box.w * 3 + 12) + 40;
    const height = 40 + rowsH + 20;
    const s = sheet ?? makeSheet(width, height);
    const g = s.g;
    label(g, `${id}  rig=${rig.id}  tier=${rig.tier}  dirs=${rig.dirs}`, 10, top + 10);
    const buf = new PixBuf(box.w, box.h);
    let y = top + 36;
    for (const a of anims) {
        const anim = animOf(rig, a);
        if (!anim)
            continue;
        for (const d of dirs) {
            label(g, `${a}${anim.strike !== undefined ? `*${anim.strike}` : ''} ${DIR_LABEL[d]}`, 8, y + cellH / 2 - 8, '#e8d6a0', 12);
            for (let f = 0; f < anim.frames; f++) {
                renderFrame(buf, rig, def.variant, a, d, f);
                const x = 140 + f * cellW;
                g.fillStyle = '#4a4f5c';
                g.fillRect(x, y, box.w * k, box.h * k);
                // 足元の目印
                g.fillStyle = '#ff5a5a';
                g.fillRect(x + box.ax * k, y + box.ay * k, k, 1);
                blit(g, buf, x, y, k, gray);
            }
            y += cellH;
        }
    }
    // 実寸（3 倍）で 3 つの背景に置く
    renderFrame(buf, rig, def.variant, 'idle', 4, 0);
    const bx = 140 + maxFrames * cellW + 20;
    [BG_DARK, BG_GREY, BG_WARM].forEach((bg, i) => {
        const x = bx + i * (box.w * 3 + 12);
        g.fillStyle = bg;
        g.fillRect(x, top + 36, box.w * 3, box.h * 3);
        blit(g, buf, x, top + 36, 3, gray);
    });
    return height;
}
function rigSheet(rigId, k, gray) {
    const ids = allSpeciesIds().filter((id) => getSpecies(id)?.rig === rigId);
    if (ids.length === 0) {
        const s = makeSheet(600, 60, BG_DARK);
        label(s.g, `リグ ${rigId} を使う種が無い`, 10, 20, '#ff8080');
        return;
    }
    // 大きさを先に測る
    const rig = getRig(rigId);
    if (!rig)
        return;
    const box = TIER_BOX[rig.tier];
    const anims = ANIM_IDS.filter((a) => rig.anims[a]);
    const dirs = dirsToShow(rig);
    const maxFrames = Math.max(...anims.map((a) => rig.anims[a]?.frames ?? 1));
    const per = 40 + anims.length * dirs.length * (box.h * k + 6) + 20;
    const width = 140 + maxFrames * (box.w * k + 6) + 3 * (box.w * 3 + 12) + 40;
    const s = makeSheet(width, per * ids.length);
    ids.forEach((id, i) => speciesSheet(id, k, gray, s, i * per));
}
/** 全部の種の待機を段ごとに並べる（監督役が絵柄の揃いを見る） */
function lineup(tierFilter, gray) {
    const ids = allSpeciesIds().filter((id) => {
        const def = getSpecies(id);
        const rig = def ? getRig(def.rig) : undefined;
        return rig && (!tierFilter || rig.tier === tierFilter);
    });
    const tiers = ['hero', 'S', 'M', 'L', 'boss'];
    const k = 3;
    const width = 1600;
    // 先に高さを数える
    let height = 20;
    const plan = [];
    for (const t of tiers) {
        const list = ids.filter((id) => getRig(getSpecies(id).rig).tier === t);
        if (list.length === 0)
            continue;
        const box = TIER_BOX[t];
        const perRow = Math.max(1, Math.floor((width - 20) / (box.w * k + 10)));
        height += 30 + Math.ceil(list.length / perRow) * (box.h * k + 24);
        plan.push({ tier: t, ids: list });
    }
    const { g } = makeSheet(width, height, BG_DARK);
    let y = 10;
    for (const { tier, ids: list } of plan) {
        const box = TIER_BOX[tier];
        label(g, `tier ${tier}  (${list.length})`, 10, y);
        y += 26;
        const perRow = Math.max(1, Math.floor((width - 20) / (box.w * k + 10)));
        const buf = new PixBuf(box.w, box.h);
        list.forEach((id, i) => {
            const def = getSpecies(id);
            const rig = getRig(def.rig);
            const x = 10 + (i % perRow) * (box.w * k + 10);
            const yy = y + Math.floor(i / perRow) * (box.h * k + 24);
            g.fillStyle = '#26232f';
            g.fillRect(x, yy, box.w * k, box.h * k);
            renderFrame(buf, rig, def.variant, 'idle', 4, 0);
            blit(g, buf, x, yy, k, gray);
            label(g, id, x, yy + box.h * k + 4, '#a9a391', 11);
        });
        y += Math.ceil(list.length / perRow) * (box.h * k + 24);
    }
}
/**
 * 道具の絵を種類ごとに並べる。4 倍（見本）と、一覧の大きさ（2 倍・紺の地）の 2 通り。
 * 最後に「未識別で見える絵」を種類ごとに並べ、正体が漏れていないかを目で確かめる。
 */
function itemsSheet(k, gray) {
    const groups = new Map();
    for (const key of allIconKeys()) {
        const def = tryGetItem(key);
        const g = def ? def.kind : 'category';
        if (!groups.has(g))
            groups.set(g, []);
        groups.get(g).push(key);
    }
    const cellW = ICON_SIZE * k + 76;
    const cellH = ICON_SIZE * k + 30;
    const width = 1680;
    const perRow = Math.floor((width - 20) / cellW);
    let height = 20;
    for (const list of groups.values())
        height += 30 + Math.ceil(list.length / perRow) * cellH;
    // 未識別の見え方
    const unknownKeys = [...new Set(ALL_ITEMS.map((d) => iconKeyOf(d.id, false)))];
    height += 40 + Math.ceil(unknownKeys.length / perRow) * cellH;
    const { g } = makeSheet(width, height, BG_DARK);
    const buf = new PixBuf(ICON_SIZE, ICON_SIZE);
    let y = 10;
    const cell = (key, name, i) => {
        const x = 10 + (i % perRow) * cellW;
        const yy = y + Math.floor(i / perRow) * cellH;
        buildIcon(key, buf);
        g.fillStyle = '#26232f';
        g.fillRect(x, yy, ICON_SIZE * k, ICON_SIZE * k);
        blit(g, buf, x, yy, k, gray);
        // 一覧の大きさ（2 倍）を紺の地に
        g.fillStyle = '#10152a';
        g.fillRect(x + ICON_SIZE * k + 4, yy, ICON_SIZE * 2 + 8, ICON_SIZE * 2 + 8);
        blit(g, buf, x + ICON_SIZE * k + 8, yy + 4, 2, gray);
        // 床の大きさ（3 倍）を石の地に
        g.fillStyle = '#4a4550';
        g.fillRect(x + ICON_SIZE * k + 4, yy + ICON_SIZE * 2 + 12, ICON_SIZE * 3 + 4, ICON_SIZE * 3 + 4);
        blit(g, buf, x + ICON_SIZE * k + 6, yy + ICON_SIZE * 2 + 14, 3, gray);
        label(g, name, x, yy + ICON_SIZE * k + 6, '#a9a391', 11);
    };
    for (const [kind, list] of groups) {
        label(g, `${kind}  (${list.length})`, 10, y);
        y += 26;
        list.forEach((key, i) => cell(key, tryGetItem(key)?.name ?? key, i));
        y += Math.ceil(list.length / perRow) * cellH;
    }
    label(g, '未識別で見える絵（全部の道具を知らない状態で引いた鍵）', 10, y + 8, '#ffb070');
    y += 34;
    unknownKeys.forEach((key, i) => cell(key, key, i));
}
/** ワナの絵を、見本（k 倍）と床の大きさ（3 倍・石の床の上）で並べる */
function trapsSheet(k, gray) {
    const traps = allTraps();
    const cellW = 16 * k + 70;
    const cellH = 16 * k + 30;
    const width = 1400;
    const perRow = Math.floor((width - 20) / cellW);
    const { g } = makeSheet(width, 40 + Math.ceil(traps.length / perRow) * cellH, BG_DARK);
    const buf = new PixBuf(16, 16);
    traps.forEach((t, i) => {
        const x = 10 + (i % perRow) * cellW;
        const y = 10 + Math.floor(i / perRow) * cellH;
        buildTrapIcon(t.id, buf);
        g.fillStyle = '#26232f';
        g.fillRect(x, y, 16 * k, 16 * k);
        blit(g, buf, x, y, k, gray);
        g.fillStyle = '#4a4550';
        g.fillRect(x + 16 * k + 4, y, 48, 48);
        blit(g, buf, x + 16 * k + 4, y, 3, gray);
        label(g, t.name, x, y + 16 * k + 6, '#a9a391', 11);
    });
}
/** 演出の絵：飾りは全コマ、矢は 8 方向、玉・火花・爆発は全コマ */
function fxSheet(k, gray) {
    const ids = allOrnamentIds();
    const rowH = ORN_SIZE * k + 22;
    const height = 40 + ids.length * rowH + 3 * (BLAST_SIZE * k + 40) + 40;
    const { g } = makeSheet(1400, height, BG_DARK);
    let y = 10;
    const orn = new PixBuf(ORN_SIZE, ORN_SIZE);
    for (const id of ids) {
        const spec = ornamentOf(id);
        label(g, `${id} (${spec.anchor}, ${spec.fps}fps)`, 10, y + rowH / 2 - 8, '#e8d6a0', 12);
        for (let f = 0; f < spec.frames; f++) {
            buildOrnament(id, f, orn);
            const x = 220 + f * (ORN_SIZE * k + 10);
            g.fillStyle = '#4a4f5c';
            g.fillRect(x, y, ORN_SIZE * k, ORN_SIZE * k);
            blit(g, orn, x, y, k, gray);
        }
        y += rowH;
    }
    y += 10;
    const arrow = new PixBuf(ARROW_SIZE, ARROW_SIZE);
    label(g, 'arrow ×8', 10, y + 20, '#e8d6a0', 12);
    for (let d = 0; d < 8; d++) {
        buildArrow(d, d < 4 ? 'steel' : 'sky', arrow);
        const x = 220 + d * (ARROW_SIZE * k + 10);
        g.fillStyle = '#4a4f5c';
        g.fillRect(x, y, ARROW_SIZE * k, ARROW_SIZE * k);
        blit(g, arrow, x, y, k, gray);
    }
    y += ARROW_SIZE * k + 20;
    const orb = new PixBuf(ORB_SIZE, ORB_SIZE);
    label(g, 'orb', 10, y + 20, '#e8d6a0', 12);
    ['violet', 'ember', 'sky', 'moss'].forEach((ramp, r) => {
        for (let f = 0; f < 4; f++) {
            buildOrb(f, ramp, orb);
            const x = 220 + (r * 4 + f) * (ORB_SIZE * k + 8);
            g.fillStyle = '#26232f';
            g.fillRect(x, y, ORB_SIZE * k, ORB_SIZE * k);
            blit(g, orb, x, y, k, gray);
        }
    });
    y += ORB_SIZE * k + 20;
    const spark = new PixBuf(SPARK_SIZE, SPARK_SIZE);
    label(g, 'hit spark', 10, y + 20, '#e8d6a0', 12);
    for (let f = 0; f < SPARK_FRAMES; f++) {
        buildHitSpark(f, spark);
        const x = 220 + f * (SPARK_SIZE * k + 10);
        g.fillStyle = '#26232f';
        g.fillRect(x, y, SPARK_SIZE * k, SPARK_SIZE * k);
        blit(g, spark, x, y, k, gray);
    }
    y += SPARK_SIZE * k + 20;
    const blast = new PixBuf(BLAST_SIZE, BLAST_SIZE);
    const kb = Math.max(2, k - 1);
    label(g, 'explosion', 10, y + 20, '#e8d6a0', 12);
    for (let f = 0; f < BLAST_FRAMES; f++) {
        buildExplosion(f, blast);
        const x = 220 + f * (BLAST_SIZE * kb + 10);
        g.fillStyle = '#26232f';
        g.fillRect(x, y, BLAST_SIZE * kb, BLAST_SIZE * kb);
        blit(g, blast, x, y, kb, gray);
    }
}
/** ?scene=art:… を開く */
export function open(spec, params) {
    const parts = spec.split(':');
    const k = Math.max(1, Math.min(8, Number(params.get('scale') ?? 4)));
    const gray = params.get('gray') === '1';
    switch (parts[1]) {
        case 'palette':
            palette();
            return;
        case 'species':
            speciesSheet(parts[2] ?? '', k, gray);
            return;
        case 'rig':
            rigSheet(parts[2] ?? '', k, gray);
            return;
        case 'lineup':
            lineup(params.get('tier') ?? null, gray);
            return;
        case 'items':
            itemsSheet(k, gray);
            return;
        case 'traps':
            trapsSheet(k, gray);
            return;
        case 'fx':
            fxSheet(k, gray);
            return;
        default: {
            const { g } = makeSheet(600, 60, BG_DARK);
            label(g, `知らない場面: ${spec}`, 10, 20, '#ff8080');
        }
    }
}
//# sourceMappingURL=art.js.map