/**
 * 階の地形の絵をキャンバスにして持つ（ダンジョンの場面が 1 つ持つ）。
 *
 * 地形の描き手（art/terrain/）が PixBuf に描いた絵を、階に入った時に 1 度だけキャンバスへ焼く。
 * 掘ってマスの種類が変わったら、変わったマスの周り 3×3 だけ描き直して、そこだけ焼き直す
 * （地形の描き手の paintCells は全部描き直した時と同じ絵になる約束）。
 *
 * テーマの描き手がまだ無いときは、テーマの色で塗るだけの仮の描き手を使う（遊べる状態を保つ）。
 */
import { PixBuf, hline, rect, vline } from '../art/pixbuf.js';
import { hash2 } from '../art/hash.js';
import { ci } from '../art/palette.js';
import { ctx2d, makeCanvas, pixBufToImageData } from '../gfx/canvas.js';
const T = 16;
const KIND_CODE = { wall: 0, floor: 1, water: 2, lava: 3, stairs: 4, pit: 5 };
/** ゲームの階 → 地形の描き手が読んでよい情報だけ（ワナ・探索状態・暗い部屋は渡さない） */
export function toTerrainMap(map) {
    const tiles = map.tiles.map((t) => ({
        kind: t.kind, hard: t.hard, roomId: t.roomId, isDoor: t.isDoor, shop: t.shop,
    }));
    return { width: map.width, height: map.height, tiles, seed: map.seed };
}
export class TerrainView {
    base;
    liquid = [];
    emissive;
    lights = [];
    decor = [];
    /** 液体のマスがあるか（無ければ液体のコマを描かない） */
    hasLiquid = false;
    art = null;
    tmap = null;
    kinds = new Uint8Array(0);
    style;
    constructor(style, theme) {
        this.style = style ?? fallbackStyle(theme);
    }
    /** 階が変わった時：全部描いて焼く */
    build(map) {
        const w = map.width * T;
        const h = map.height * T;
        const art = {
            base: new PixBuf(w, h),
            liquid: [new PixBuf(w, h), new PixBuf(w, h), new PixBuf(w, h), new PixBuf(w, h)],
            emissive: new PixBuf(w, h),
            lights: [],
            decor: [],
        };
        const tmap = toTerrainMap(map);
        this.style.paint(tmap, art);
        this.art = art;
        this.tmap = tmap;
        this.kinds = new Uint8Array(map.tiles.length);
        for (let i = 0; i < map.tiles.length; i++)
            this.kinds[i] = KIND_CODE[map.tiles[i].kind];
        this.hasLiquid = map.tiles.some((t) => t.kind === 'water' || t.kind === 'lava');
        this.base = bake(art.base);
        this.liquid = art.liquid.map(bake);
        this.emissive = bake(art.emissive);
        this.lights = art.lights;
        this.decor = art.decor;
    }
    /**
     * 1 手ごと：マスの種類が変わった所（掘った・埋まった）を探し、周りだけ描き直す。
     * 変わった所があれば true
     */
    update(map) {
        if (!this.art || !this.tmap || this.kinds.length !== map.tiles.length)
            return false;
        const changed = [];
        for (let i = 0; i < map.tiles.length; i++) {
            const k = KIND_CODE[map.tiles[i].kind];
            if (k === this.kinds[i])
                continue;
            this.kinds[i] = k;
            const t = this.tmap.tiles[i];
            t.kind = map.tiles[i].kind;
            t.hard = map.tiles[i].hard;
            changed.push(i);
        }
        if (changed.length === 0)
            return false;
        this.style.paintCells(this.tmap, this.art, changed);
        // 周り 3×3（輪郭と壁の正面が隣へ掛かるので 1 マス広げる）を焼き直す
        const W = map.width;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const i of changed) {
            const x = i % W;
            const y = Math.floor(i / W);
            x0 = Math.min(x0, x - 1);
            y0 = Math.min(y0, y - 1);
            x1 = Math.max(x1, x + 1);
            y1 = Math.max(y1, y + 1);
        }
        x0 = Math.max(0, x0);
        y0 = Math.max(0, y0);
        x1 = Math.min(W - 1, x1);
        y1 = Math.min(map.height - 1, y1);
        rebake(this.base, this.art.base, x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T);
        rebake(this.emissive, this.art.emissive, x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T);
        this.art.liquid.forEach((b, k) => rebake(this.liquid[k], b, x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T));
        this.lights = this.art.lights;
        this.decor = this.art.decor;
        return true;
    }
}
function bake(b) {
    const c = makeCanvas(b.w, b.h);
    ctx2d(c).putImageData(pixBufToImageData(b), 0, 0);
    return c;
}
function rebake(c, b, x, y, w, h) {
    const part = new PixBuf(w, h);
    for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++)
            part.px[yy * w + xx] = b.get(x + xx, y + yy);
    }
    const g = ctx2d(c);
    g.clearRect(x, y, w, h);
    g.putImageData(pixBufToImageData(part), x, y);
}
// ---------------------------------------------------------------------------
// 仮の描き手（テーマの描き手が無いとき）。パレットの近い色で平らに塗る
// ---------------------------------------------------------------------------
function fallbackStyle(_theme) {
    const paintOne = (m, out, i) => {
        const x = i % m.width;
        const y = Math.floor(i / m.width);
        const t = m.tiles[i];
        const ox = x * T;
        const oy = y * T;
        const below = y + 1 < m.height ? m.tiles[i + m.width] : null;
        for (const l of out.liquid)
            rect(l, ox, oy, T, T, 0);
        rect(out.emissive, ox, oy, T, T, 0);
        switch (t.kind) {
            case 'wall':
                if (below && below.kind !== 'wall') {
                    rect(out.base, ox, oy, T, 4, ci('stone', 4));
                    rect(out.base, ox, oy + 4, T, 12, ci('stone', 2));
                    hline(out.base, ox, oy + 15, T, ci('stone', 0));
                    for (let r = 0; r < 3; r++)
                        hline(out.base, ox, oy + 7 + r * 3, T, ci('stone', 1));
                }
                else {
                    rect(out.base, ox, oy, T, T, ci('ink', 1));
                }
                break;
            case 'water':
            case 'lava': {
                const lava = t.kind === 'lava';
                rect(out.base, ox, oy, T, T, lava ? ci('ember', 2) : ci('water', 2));
                out.liquid.forEach((l, k) => {
                    for (let r = 0; r < 3; r++) {
                        const yy = oy + 3 + r * 5 + ((k + r) & 1);
                        hline(l, ox + ((k * 3 + r * 5) % 8), yy, 6, lava ? ci('ember', 4) : ci('water', 4));
                    }
                });
                if (lava)
                    rect(out.emissive, ox, oy, T, T, ci('ember', 3));
                break;
            }
            case 'pit':
                rect(out.base, ox, oy, T, T, ci('ink', 0));
                break;
            default: {
                const corridor = t.roomId < 0;
                const tone = corridor ? ci('stone', 1) : (hash2(x, y, m.seed) & 1 ? ci('stone', 2) : ci('stone', 3));
                rect(out.base, ox, oy, T, T, t.shop ? ci('crimson', 1) : tone);
                hline(out.base, ox, oy, T, ci('stone', 1));
                vline(out.base, ox, oy, T, ci('stone', 1));
                if (t.kind === 'stairs') {
                    for (let s = 0; s < 4; s++)
                        rect(out.base, ox + 3 + s, oy + 3 + s * 3, 10 - s * 2, 2, ci('bone', 4 - s));
                    rect(out.emissive, ox + 5, oy + 5, 6, 6, ci('gold', 5));
                }
            }
        }
    };
    return {
        theme: 'cave',
        paint(m, out) {
            for (let i = 0; i < m.tiles.length; i++)
                paintOne(m, out, i);
        },
        paintCells(m, out, cells) {
            const set = new Set();
            for (const c of cells) {
                const x = c % m.width;
                const y = Math.floor(c / m.width);
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx;
                        const yy = y + dy;
                        if (xx >= 0 && yy >= 0 && xx < m.width && yy < m.height)
                            set.add(yy * m.width + xx);
                    }
                }
            }
            for (const i of set)
                paintOne(m, out, i);
        },
    };
}
//# sourceMappingURL=terrainView.js.map