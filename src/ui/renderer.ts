/**
 * ダンジョンの描画。
 *
 * レイヤ順: 地形 → 地形の飾り → ワナ → アイテム → アクター → エフェクト。
 * 地形はカメラが動かない限り変わらないので、オフスクリーンに焼いて使い回す。
 */

import { type Point, chebyshev } from '../core/geom.js';
import type { DungeonTheme, FloorMap, Tile } from '../core/types.js';
import { at } from '../dungeon/tilemap.js';
import { type Ctx, drawText, roundRect } from './draw.js';
import type { ActorView, FxSystem } from './fx.js';
import { getSprite, mixColor, rgba, sprites } from './sprites.js';
import { SCREEN_H, SCREEN_W, TILE, UI } from './theme.js';

/** カメラ。プレイヤーを中心に置きつつ、マップの外を映さない */
export class Camera {
  x = 0;
  y = 0;
  private targetX = 0;
  private targetY = 0;

  /** 追従の速さ（0〜1、1 で即座） */
  follow = 0.18;

  /**
   * カメラの行き過ぎを許す量（画面サイズに対する割合）。
   *
   * 0 にするとマップの端でカメラが止まり、プレイヤーが画面の隅に
   * 寄ってしまう。マップの外は探索前の闇と同じ黒なので、少しはみ出して
   * でもプレイヤーを中央付近に置いた方が見やすい。
   */
  private static readonly OVERSCROLL = 0.22;

  setTarget(center: Point, map: FloorMap, viewW: number, viewH: number): void {
    const mapW = map.width * TILE;
    const mapH = map.height * TILE;
    const marginX = viewW * Camera.OVERSCROLL;
    const marginY = viewH * Camera.OVERSCROLL;
    let cx = center.x * TILE + TILE / 2 - viewW / 2;
    let cy = center.y * TILE + TILE / 2 - viewH / 2;
    cx = clampRange(cx, -marginX, mapW - viewW + marginX);
    cy = clampRange(cy, -marginY, mapH - viewH + marginY);
    this.targetX = cx;
    this.targetY = cy;
  }

  snap(): void {
    this.x = this.targetX;
    this.y = this.targetY;
  }

  update(dt: number): void {
    const k = Math.min(1, (dt / 16) * this.follow);
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
    if (Math.abs(this.x - this.targetX) < 0.5) this.x = this.targetX;
    if (Math.abs(this.y - this.targetY) < 0.5) this.y = this.targetY;
  }
}

/** lo > hi のときは中央を返す（マップが画面より小さい場合） */
function clampRange(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return v < lo ? lo : v > hi ? hi : v;
}

/** 地形を焼いたキャンバス。フロアが変わるまで使い回す */
class TerrainCache {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private key = '';

  get(map: FloorMap, theme: DungeonTheme): HTMLCanvasElement | OffscreenCanvas {
    const key = `${map.seed}:${map.width}x${map.height}:${theme.floor}`;
    if (this.canvas && this.key === key) return this.canvas;
    const w = map.width * TILE;
    const h = map.height * TILE;
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : (() => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      })();
    const g = (canvas as HTMLCanvasElement).getContext('2d') as Ctx;
    g.imageSmoothingEnabled = false;
    paintTerrain(g, map, theme);
    this.canvas = canvas;
    this.key = key;
    return canvas;
  }

  invalidate(): void {
    this.canvas = null;
    this.key = '';
  }
}

/** 地形をまるごと描く（キャッシュ用） */
function paintTerrain(g: Ctx, map: FloorMap, theme: DungeonTheme): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = at(map, x, y);
      if (!t) continue;
      paintTile(g, t, x, y, map, theme);
    }
  }
}

function paintTile(g: Ctx, t: Tile, x: number, y: number, map: FloorMap, theme: DungeonTheme): void {
  const px = x * TILE;
  const py = y * TILE;

  if (t.kind === 'wall') {
    g.fillStyle = theme.wall;
    g.fillRect(px, py, TILE, TILE);
    // 下が床なら、壁の「上面」を描いて立体的に見せる
    const below = at(map, x, y + 1);
    if (below && below.kind !== 'wall') {
      g.fillStyle = theme.wallTop;
      g.fillRect(px, py + TILE - 8, TILE, 8);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(px, py + TILE - 2, TILE, 2);
    }
    // 岩肌の粒
    g.fillStyle = mixColor(theme.wall, '#000000', 0.25);
    const seed = (x * 73856093) ^ (y * 19349663);
    if ((seed & 7) === 0) g.fillRect(px + 6, py + 8, 5, 4);
    if ((seed & 31) === 3) g.fillRect(px + 18, py + 18, 6, 5);
    return;
  }

  // 床の市松模様で広さが分かるようにする
  const alt = ((x + y) & 1) === 0;
  if (t.kind === 'floor' || t.kind === 'stairs') {
    g.fillStyle = t.roomId >= 0
      ? (alt ? theme.floor : theme.floorAlt)
      : theme.corridor;
    g.fillRect(px, py, TILE, TILE);
    // 部屋の床にうっすら目地を入れる
    if (t.roomId >= 0) {
      g.strokeStyle = 'rgba(255,255,255,0.03)';
      g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    }
  } else if (t.kind === 'water' || t.kind === 'lava') {
    g.fillStyle = alt ? theme.liquid : theme.liquidAlt;
    g.fillRect(px, py, TILE, TILE);
    g.fillStyle = rgba(theme.liquidAlt, 0.35);
    g.fillRect(px + 4, py + 10, TILE - 8, 3);
    g.fillRect(px + 10, py + 20, TILE - 16, 2);
  } else if (t.kind === 'pit') {
    g.fillStyle = '#05050a';
    g.fillRect(px, py, TILE, TILE);
  }

  if (t.shop) {
    g.fillStyle = 'rgba(255,210,74,0.12)';
    g.fillRect(px, py, TILE, TILE);
  }
}

export interface RenderContext {
  map: FloorMap;
  theme: DungeonTheme;
  camera: Camera;
  fx: FxSystem;
  /** 今の時刻(ms)。ゆらぎの位相に使う */
  time: number;
  /** ミニマップ的に全部見せる（デバッグ用） */
  revealAll?: boolean;
}

export class DungeonRenderer {
  private terrain = new TerrainCache();

  /** フロアが変わったら呼ぶ */
  invalidateTerrain(): void {
    this.terrain.invalidate();
  }

  /** 地形と、その上の明るさを描く */
  drawTerrain(g: Ctx, ctx: RenderContext): void {
    const { map, theme, camera } = ctx;
    const canvas = this.terrain.get(map, theme);
    g.drawImage(canvas as CanvasImageSource, -camera.x, -camera.y);

    // 見えていないマスを暗くする（探索済みは薄暗く、未探索は真っ暗）
    const x0 = Math.max(0, Math.floor(camera.x / TILE));
    const y0 = Math.max(0, Math.floor(camera.y / TILE));
    const x1 = Math.min(map.width - 1, Math.ceil((camera.x + SCREEN_W) / TILE));
    const y1 = Math.min(map.height - 1, Math.ceil((camera.y + SCREEN_H) / TILE));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = at(map, x, y);
        if (!t) continue;
        if (ctx.revealAll || t.visible) continue;
        const px = x * TILE - camera.x;
        const py = y * TILE - camera.y;
        g.fillStyle = t.explored ? rgba(theme.gloom, 0.62) : theme.gloom;
        g.fillRect(px, py, TILE, TILE);
      }
    }
  }

  /** 階段・ワナ・床のアイテム */
  drawGround(
    g: Ctx, ctx: RenderContext,
    floorItems: Array<{ pos: Point; sprite: string; shopPrice: number }>,
  ): void {
    const { map, camera } = ctx;
    const stairs = map.stairs;
    const st = at(map, stairs.x, stairs.y);
    if (st && (ctx.revealAll || st.explored)) {
      drawSpriteAt(g, 'stairsDown', stairs, camera, () => {
        // 代替図形: 下向きの階段
        const px = stairs.x * TILE - camera.x;
        const py = stairs.y * TILE - camera.y;
        g.fillStyle = '#2a2a34';
        g.fillRect(px + 4, py + 6, 24, 22);
        g.fillStyle = '#8ce08c';
        for (let i = 0; i < 3; i++) {
          g.fillRect(px + 6 + i * 3, py + 10 + i * 6, 20 - i * 6, 4);
        }
      });
    }

    // ワナ
    const x0 = Math.max(0, Math.floor(camera.x / TILE));
    const y0 = Math.max(0, Math.floor(camera.y / TILE));
    const x1 = Math.min(map.width - 1, Math.ceil((camera.x + SCREEN_W) / TILE));
    const y1 = Math.min(map.height - 1, Math.ceil((camera.y + SCREEN_H) / TILE));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = at(map, x, y);
        if (!t?.trap || !t.trap.revealed || t.trap.used) continue;
        if (!ctx.revealAll && !t.explored) continue;
        const p = { x, y };
        drawSpriteAt(g, trapSpriteOf(t.trap.defId), p, camera, () => {
          const px = x * TILE - camera.x;
          const py = y * TILE - camera.y;
          g.fillStyle = '#c8632a';
          g.beginPath();
          g.moveTo(px + 16, py + 8);
          g.lineTo(px + 26, py + 24);
          g.lineTo(px + 6, py + 24);
          g.closePath();
          g.fill();
          g.fillStyle = '#20141a';
          g.fillRect(px + 15, py + 14, 2, 6);
          g.fillRect(px + 15, py + 21, 2, 2);
        });
      }
    }

    // 床のアイテム
    for (const item of floorItems) {
      const t = at(map, item.pos.x, item.pos.y);
      if (!t || (!ctx.revealAll && !t.explored)) continue;
      const bob = Math.sin(ctx.time / 380 + item.pos.x + item.pos.y) * 1.5;
      drawSpriteAt(g, item.sprite, item.pos, camera, () => {
        const px = item.pos.x * TILE - camera.x;
        const py = item.pos.y * TILE - camera.y;
        g.fillStyle = '#d8d8e8';
        roundRect(g, px + 9, py + 10 + bob, 14, 14, 3);
        g.fill();
        g.strokeStyle = '#20202c';
        g.lineWidth = 2;
        g.stroke();
      }, bob);
      if (item.shopPrice > 0 && t.visible) {
        drawText(g, `${item.shopPrice}G`,
          item.pos.x * TILE - camera.x + TILE / 2,
          item.pos.y * TILE - camera.y - 2, {
            size: 12, align: 'center', color: UI.gitan,
            outline: '#000', outlineWidth: 3,
          });
      }
    }
  }

  /** アクター 1 体 */
  drawActor(
    g: Ctx, ctx: RenderContext, view: ActorView, spriteId: string,
    opts: { asleep?: boolean; invisible?: boolean; boss?: boolean; tint?: string } = {},
  ): void {
    const { camera } = ctx;
    const px = (view.x + view.lungeX) * TILE - camera.x + TILE / 2;
    const py = (view.y + view.lungeY) * TILE - camera.y + TILE / 2;
    const scale = opts.boss ? 1.35 : 1;
    const squashY = 1 - view.squash * 0.22;
    const squashX = 1 + view.squash * 0.16;
    const alpha = opts.invisible ? 0.32 : 1 - view.fade;
    if (alpha <= 0) return;

    // 影
    g.save();
    g.globalAlpha = alpha * 0.4;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(px, py + TILE * 0.38 * scale, TILE * 0.3 * scale, TILE * 0.12 * scale, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    const sprite = getSprite(spriteId);
    g.save();
    g.globalAlpha = alpha;
    if (sprite) {
      sprites.draw(g, spriteId, sprite, px, py - view.fade * 8, TILE * scale, {
        scaleX: squashX,
        scaleY: squashY,
        tint: view.flash > 0 ? Math.min(1, view.flash) : (opts.tint ? 0.5 : 0),
        tintColor: view.flash > 0 ? '#ffffff' : opts.tint,
      });
    } else {
      // 絵が未登録でも遊べるよう、色付きの丸で代替する
      g.fillStyle = opts.tint ?? '#d05050';
      g.beginPath();
      g.ellipse(px, py, TILE * 0.32 * scale * squashX, TILE * 0.34 * scale * squashY, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1a1020';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#fff';
      g.fillRect(px - 6, py - 4, 3, 4);
      g.fillRect(px + 3, py - 4, 3, 4);
    }
    g.restore();

    if (opts.asleep) {
      drawText(g, 'Ｚ', px + TILE * 0.3, py - TILE * 0.28, {
        size: 14, color: '#a0c0ff', outline: '#000', outlineWidth: 3,
      });
    }
  }

  /** 弾・光線・爆発・ポップアップ */
  drawEffects(g: Ctx, ctx: RenderContext): void {
    const { camera, fx } = ctx;
    const toPx = (p: Point): { x: number; y: number } => ({
      x: p.x * TILE - camera.x + TILE / 2,
      y: p.y * TILE - camera.y + TILE / 2,
    });

    for (const b of fx.activeBeams) {
      const t = b.life / b.maxLife;
      const a = toPx(b.from);
      const c = toPx(b.to);
      g.save();
      g.globalAlpha = 1 - t;
      g.strokeStyle = b.color;
      g.lineWidth = 6 * (1 - t) + 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(c.x, c.y);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }

    for (const p of fx.activeProjectiles) {
      const t = Math.min(1, p.life / p.maxLife);
      const a = toPx(p.from);
      const c = toPx(p.to);
      const x = a.x + (c.x - a.x) * t;
      const y = a.y + (c.y - a.y) * t - Math.sin(t * Math.PI) * 10;
      const sprite = getSprite(p.sprite);
      if (sprite) {
        sprites.draw(g, p.sprite, sprite, x, y, TILE * 0.8, { rotate: t * 8 });
      } else {
        g.save();
        g.fillStyle = p.kind === 'gitan' ? UI.gitan : p.kind === 'magic' ? '#c0a0ff' : '#e0d8c0';
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }

    for (const b of fx.activeBursts) {
      const t = b.life / b.maxLife;
      const c = toPx(b.pos);
      const radius = TILE * b.radius * (0.4 + t * 1.1);
      g.save();
      g.globalAlpha = (1 - t) * 0.85;
      const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
      grad.addColorStop(0, '#fff6d0');
      grad.addColorStop(0.45, b.color);
      grad.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(c.x, c.y, radius, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    for (const p of fx.activePopups) {
      const t = p.life / p.maxLife;
      const c = toPx({ x: p.x, y: p.y });
      const rise = -18 * Math.min(1, t * 2.2);
      const color = p.kind === 'damage' ? '#ff6b6b'
        : p.kind === 'heal' ? '#7ef07e'
          : p.kind === 'exp' ? '#8cc0ff'
            : p.kind === 'gitan' ? UI.gitan
              : p.kind === 'critical' ? '#ffb03a' : '#d8d8e8';
      g.save();
      g.globalAlpha = t > 0.75 ? (1 - t) * 4 : 1;
      drawText(g, p.text, c.x, c.y + rise, {
        size: p.kind === 'exp' ? 18 : 20,
        bold: true, align: 'center', color,
        outline: '#000', outlineWidth: 4,
      });
      g.restore();
    }
  }

  /** 画面全体のフラッシュとバナー */
  drawScreenFx(g: Ctx, fx: FxSystem): void {
    if (fx.flashAlpha > 0 && fx.flashColor) {
      g.save();
      g.globalAlpha = fx.flashAlpha;
      g.fillStyle = fx.flashColor;
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
      g.restore();
    }
    const banner = fx.banner;
    if (banner) {
      const t = banner.life / banner.maxLife;
      const alpha = t < 0.12 ? t / 0.12 : t > 0.8 ? (1 - t) / 0.2 : 1;
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, SCREEN_H / 2 - 70, SCREEN_W, banner.sub ? 130 : 96);
      drawText(g, banner.text, SCREEN_W / 2, SCREEN_H / 2 - 6, {
        size: 44, bold: true, align: 'center', color: banner.color,
        outline: '#000', outlineWidth: 6,
      });
      if (banner.sub) {
        drawText(g, banner.sub, SCREEN_W / 2, SCREEN_H / 2 + 34, {
          size: 20, align: 'center', color: UI.text,
          outline: '#000', outlineWidth: 4,
        });
      }
      g.restore();
    }
  }
}

/** スプライトがあればそれを、無ければ代替の図形を描く */
function drawSpriteAt(
  g: Ctx, id: string, pos: Point, camera: Camera,
  fallback: () => void, yOffset = 0,
): void {
  const sprite = getSprite(id);
  if (!sprite) {
    fallback();
    return;
  }
  sprites.draw(
    g, id, sprite,
    pos.x * TILE - camera.x + TILE / 2,
    pos.y * TILE - camera.y + TILE / 2 + yOffset,
    TILE,
  );
}

/** ワナ id → 絵の鍵（ワナごとの新しい絵。sprites.ts の橋渡しが読む） */
function trapSpriteOf(trapId: string): string {
  return `trap:${trapId}`;
}


/** 画面内に入っているか（描画を間引くため） */
export function isOnScreen(p: Point, camera: Camera, margin = 2): boolean {
  const px = p.x * TILE - camera.x;
  const py = p.y * TILE - camera.y;
  return px > -TILE * margin && py > -TILE * margin
    && px < SCREEN_W + TILE * margin && py < SCREEN_H + TILE * margin;
}

export { chebyshev };
