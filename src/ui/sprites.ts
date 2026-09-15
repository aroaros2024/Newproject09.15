/**
 * ドット絵スプライトの描画エンジン。
 *
 * 画像アセットを持たないので、スプライトは「パレット＋文字グリッド」として
 * ソース中に書く。16x16 を基本サイズとし、描画時に整数倍でキャンバスへ焼く。
 *
 *   const MAMURU: PixelSprite = {
 *     palette: { a: '#f0d060', b: '#c09020', k: '#201810' },
 *     rows: [
 *       '....aaaa....',
 *       '..aaaaaaaa..',
 *       ...
 *     ],
 *   };
 *
 * '.' と ' ' は透明。それ以外の 1 文字が palette のキーになる。
 * 焼いた結果は (id, size, tint) をキーにキャッシュされるので、
 * 毎フレームのピクセル走査は起きない。
 */

/** 文字グリッドで表したドット絵 */
export interface PixelSprite {
  /** 1 文字 → CSS 色。'.' と ' ' は予約（透明） */
  palette: Record<string, string>;
  /** 上から順の行。すべて同じ長さにすること */
  rows: string[];
  /** 影を落とすか（キャラクタは true、アイテムは false が既定） */
  shadow?: boolean;
}

export interface DrawOptions {
  /** 0..1。1 で完全に tintColor へ寄る */
  tint?: number;
  tintColor?: string;
  /** 0..1 */
  alpha?: number;
  /** 左右反転 */
  flipX?: boolean;
  /** 上下方向の伸縮（1 が等倍）。被弾時のスカッシュ演出用 */
  scaleY?: number;
  scaleX?: number;
  /** 回転（ラジアン）。中心を軸に回す */
  rotate?: number;
  /** シルエット表示（全体を 1 色で塗る）。透明モンスター等 */
  silhouette?: string;
}

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;

const TRANSPARENT = new Set(['.', ' ', '\t']);

/** オフスクリーンキャンバスを作る（OffscreenCanvas が無ければ普通の canvas） */
function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: Canvas2D): CanvasRenderingContext2D {
  const g = (c as HTMLCanvasElement).getContext('2d');
  if (!g) throw new Error('2D コンテキストを取得できませんでした');
  return g as CanvasRenderingContext2D;
}

/** '#rrggbb' → [r,g,b] */
function parseHex(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [255, 0, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number): string =>
  '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);

/** 2 色を t (0..1) で混ぜる */
export function mixColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return toHex(
    Math.round(ar + (br - ar) * k),
    Math.round(ag + (bg - ag) * k),
    Math.round(ab + (bb - ab) * k),
  );
}

/** 明度を上げ下げする。amount は -1..1 */
export function shade(color: string, amount: number): string {
  return amount >= 0 ? mixColor(color, '#ffffff', amount) : mixColor(color, '#000000', -amount);
}

/** rgba 文字列を作る */
export function rgba(color: string, alpha: number): string {
  const [r, g, b] = parseHex(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface BakedSprite {
  canvas: Canvas2D;
  /** 元グリッドの列数・行数 */
  cols: number;
  rows: number;
  /** 1 ドットあたりのピクセル数 */
  pixel: number;
}

/**
 * スプライトのキャッシュ。
 * 同じ (スプライト, 描画サイズ, tint) の組み合わせは一度だけ焼く。
 */
export class SpriteCache {
  private baked = new Map<string, BakedSprite>();
  private keyOf(id: string, size: number, tint: string): string {
    return `${id}|${size}|${tint}`;
  }

  /** キャッシュを捨てる（設定変更時など） */
  clear(): void {
    this.baked.clear();
  }

  get size(): number {
    return this.baked.size;
  }

  /**
   * スプライトを size ピクセル四方へ焼いて返す。
   * グリッドが正方形でない場合は幅を基準に縦横比を保つ。
   */
  bake(id: string, sprite: PixelSprite, size: number, tintKey = ''): BakedSprite {
    const key = this.keyOf(id, size, tintKey);
    const hit = this.baked.get(key);
    if (hit) return hit;

    const rows = sprite.rows;
    const cols = rows.length > 0 ? Math.max(...rows.map((r) => r.length)) : 1;
    const nrows = Math.max(1, rows.length);
    // ドット単位を整数ピクセルにして、にじみを防ぐ
    const pixel = Math.max(1, Math.floor(size / Math.max(cols, nrows)));
    const w = cols * pixel;
    const h = nrows * pixel;
    const canvas = makeCanvas(w, h);
    const g = ctx2d(canvas);
    g.imageSmoothingEnabled = false;

    for (let y = 0; y < nrows; y++) {
      const row = rows[y] ?? '';
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (TRANSPARENT.has(ch)) continue;
        const col = sprite.palette[ch];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x * pixel, y * pixel, pixel, pixel);
      }
    }

    const baked: BakedSprite = { canvas, cols, rows: nrows, pixel };
    // 無制限に増やさない（サイズ違いの組み合わせが増えたら一番古いものを捨てる）
    if (this.baked.size > 2048) {
      const firstKey = this.baked.keys().next().value;
      if (firstKey !== undefined) this.baked.delete(firstKey);
    }
    this.baked.set(key, baked);
    return baked;
  }

  /**
   * スプライトを描く。(cx, cy) はタイル中心のピクセル座標。
   */
  draw(
    g: CanvasRenderingContext2D,
    id: string,
    sprite: PixelSprite,
    cx: number,
    cy: number,
    size: number,
    opts: DrawOptions = {},
  ): void {
    const tintKey = opts.silhouette
      ? `sil:${opts.silhouette}`
      : opts.tint && opts.tint > 0
        ? `t:${opts.tintColor ?? '#ffffff'}:${Math.round(opts.tint * 8)}`
        : '';
    const baked = this.bake(id, sprite, size, tintKey);

    // tint / silhouette は焼いた直後に一度だけ適用してキャッシュへ載せる
    if (tintKey && !this.tinted.has(`${id}|${size}|${tintKey}`)) {
      this.applyTint(baked, opts);
      this.tinted.add(`${id}|${size}|${tintKey}`);
    }

    const w = baked.cols * baked.pixel;
    const h = baked.rows * baked.pixel;
    const sx = (opts.scaleX ?? 1) * (opts.flipX ? -1 : 1);
    const sy = opts.scaleY ?? 1;
    const alpha = opts.alpha ?? 1;

    const needsTransform = sx !== 1 || sy !== 1 || !!opts.rotate;
    g.save();
    if (alpha < 1) g.globalAlpha *= alpha;
    g.imageSmoothingEnabled = false;

    if (needsTransform) {
      g.translate(cx, cy);
      if (opts.rotate) g.rotate(opts.rotate);
      g.scale(sx, sy);
      g.drawImage(baked.canvas as CanvasImageSource, -w / 2, -h / 2, w, h);
    } else {
      // 整数座標に載せてドットのにじみを防ぐ
      g.drawImage(
        baked.canvas as CanvasImageSource,
        Math.round(cx - w / 2),
        Math.round(cy - h / 2),
        w, h,
      );
    }
    g.restore();
  }

  private tinted = new Set<string>();

  /** 焼いたキャンバスへ色調変換を直接かける */
  private applyTint(baked: BakedSprite, opts: DrawOptions): void {
    const g = ctx2d(baked.canvas);
    const w = baked.cols * baked.pixel;
    const h = baked.rows * baked.pixel;
    g.save();
    if (opts.silhouette) {
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = opts.silhouette;
      g.fillRect(0, 0, w, h);
    } else if (opts.tint && opts.tint > 0) {
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = opts.tint;
      g.fillStyle = opts.tintColor ?? '#ffffff';
      g.fillRect(0, 0, w, h);
    }
    g.restore();
  }
}

/** 共有キャッシュ。特別な理由がなければこれを使う */
export const sprites = new SpriteCache();

// ---------------------------------------------------------------------------
// 図形プリミティブ（エフェクトや UI 用。ドット絵ではない部分に使う）
// ---------------------------------------------------------------------------

/** 角丸矩形のパスを引く */
export function roundRectPath(
  g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

/** 星形のパスを引く */
export function starPath(
  g: CanvasRenderingContext2D, cx: number, cy: number,
  outer: number, inner: number, points = 5, rotation = -Math.PI / 2,
): void {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (Math.PI * i) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/** 楕円の影。キャラの足元に落とす */
export function drawShadow(
  g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, alpha = 0.35,
): void {
  g.save();
  g.fillStyle = `rgba(0,0,0,${alpha})`;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** 縁取り付きテキスト。ダンジョン上のポップアップ用 */
export function outlinedText(
  g: CanvasRenderingContext2D, text: string, x: number, y: number,
  fill: string, outline = '#000000', width = 3,
): void {
  g.save();
  g.lineJoin = 'round';
  g.miterLimit = 2;
  g.lineWidth = width;
  g.strokeStyle = outline;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
  g.restore();
}

/**
 * 文字グリッドの妥当性を検査する（開発時の取りこぼし検出用）。
 * 問題が無ければ空配列を返す。
 */
export function validateSprite(id: string, s: PixelSprite): string[] {
  const errs: string[] = [];
  if (s.rows.length === 0) {
    errs.push(`${id}: rows が空`);
    return errs;
  }
  const w = s.rows[0].length;
  s.rows.forEach((r, i) => {
    if (r.length !== w) errs.push(`${id}: 行 ${i} の長さが ${r.length}（期待 ${w}）`);
    for (const ch of r) {
      if (TRANSPARENT.has(ch)) continue;
      if (!s.palette[ch]) errs.push(`${id}: 行 ${i} の文字 '${ch}' がパレットに無い`);
    }
  });
  return [...new Set(errs)];
}
