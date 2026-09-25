/**
 * 見た目の台帳と拍（src/ui/anim/）。
 *
 * 旧 fx.ts の不具合（倒した敵がその場で消える・その一撃の数字が出ない・見えないマスに数字が出る・
 * 1 手のできごとが全部同じフレームで始まる）を、本物の戦闘を通して直っていることを固定する。
 * それと、見た目を通してもゲームの乱数が 1 つも進まないこと（リプレイが壊れない）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import type { Action, Dir, GameEvent, MonsterActor, TownState } from '../src/core/types.js';
import { DIRS, DIR_VEC, dirTo } from '../src/core/geom.js';
import { enterFloor, startRun } from '../src/game/run.js';
import { stepTurn } from '../src/game/turn.js';
import { dealDamage } from '../src/game/combat.js';
import { at, canEnter } from '../src/dungeon/tilemap.js';
import type { World } from '../src/game/world.js';
import { VisualWorld, elementOfColor } from '../src/ui/anim/visualWorld.js';
import { ACTOR_TIMES } from '../src/ui/anim/actors.js';
import { BEAT_TIMES, CUE } from '../src/ui/anim/timeline.js';
import { Camera } from '../src/ui/anim/camera.js';
import type {
  ActorDrawable, BannerKind, BurstOpts, PopupKind, ProjectileKind, TilePoint, TransitionKind,
  VfxElement, VfxPresetId, VfxSink,
} from '../src/ui/anim/types.js';
import { VFX_PRESET_IDS } from '../src/ui/anim/types.js';

const TICK = 1000 / 60;

function newTown(): TownState {
  return {
    playerName: 'ナギ', storage: [], bankGitan: 0, gitan: 0,
    cleared: [], unlocked: ['d1'], bestDepth: {},
    seenItems: {}, seenMonsters: {}, history: [], totalRuns: 0, nextUid: 1,
  };
}

interface Rec {
  /** 組の中の時刻（timeline.now） */
  at: number;
  call: string;
  what: string;
  x: number;
  y: number;
  tag: string;
}

/** 呼ばれた順に全部書き留める受け口 */
class RecordingSink implements VfxSink {
  readonly log: Rec[] = [];
  vw: VisualWorld | null = null;

  private add(call: string, what: string, x: number, y: number, tag = ''): void {
    this.log.push({ at: this.vw ? this.vw.timeline.now : 0, call, what, x, y, tag });
  }

  burst(preset: VfxPresetId, tileX: number, tileY: number, opts: Readonly<BurstOpts>): void {
    this.add('burst', preset, tileX, tileY, opts.tag);
  }

  beam(from: TilePoint, to: TilePoint, _color: string, element: VfxElement, ms: number): void {
    this.add('beam', element, from.x, from.y, `${to.x},${to.y},${Math.round(ms)}`);
  }

  projectile(from: TilePoint, to: TilePoint, spriteKey: string | null, kind: ProjectileKind, ms: number): void {
    this.add('projectile', kind, from.x, from.y, `${spriteKey}:${to.x},${to.y},${Math.round(ms)}`);
  }

  light(tileX: number, tileY: number, color: string): void {
    this.add('light', color, tileX, tileY);
  }

  shake(px: number): void {
    this.add('shake', String(px), 0, 0);
  }

  flash(color: string): void {
    this.add('flash', color, 0, 0);
  }

  hitstop(ms: number): void {
    this.add('hitstop', String(ms), 0, 0);
  }

  popup(text: string, kind: PopupKind, tileX: number, tileY: number): void {
    this.add('popup', text, tileX, tileY, kind);
  }

  banner(text: string, sub?: string, kind?: BannerKind): void {
    this.add('banner', text, 0, 0, `${sub ?? ''}|${kind ?? ''}`);
  }

  transition(kind: TransitionKind): void {
    this.add('transition', kind, 0, 0);
  }

  sfx(id: string): void {
    this.add('sfx', id, 0, 0);
  }

  popups(): Rec[] {
    return this.log.filter((r) => r.call === 'popup');
  }
}

function makeVisual(): { vw: VisualWorld; sink: RecordingSink } {
  const sink = new RecordingSink();
  const vw = new VisualWorld(sink);
  sink.vw = vw;
  vw.reset();
  return { vw, sink };
}

/** 主人公の隣の空いた床に敵を出す（見えているマス） */
function spawnBeside(world: World, defId: string, prefer: readonly Dir[] = DIRS): MonsterActor {
  const p = world.player.pos;
  for (const d of prefer) {
    const q = { x: p.x + DIR_VEC[d].x, y: p.y + DIR_VEC[d].y };
    if (!canEnter(world.map, q.x, q.y, 'ground')) continue;
    // 斜めは角が塞がっていると殴れないので、上下左右を優先して探す
    const m = world.spawnAt?.(defId, q);
    if (m) return m;
  }
  throw new Error('隣に敵を出せなかった');
}

/** 主人公を打たれ強く、一撃で倒せるようにする */
function makeStrong(world: World): void {
  const p = world.player;
  p.maxHp = 9999;
  p.hp = 9999;
  p.str = 99;
  p.maxStr = 99;
}

function runTicks(vw: VisualWorld, world: World, ms: number): void {
  const n = Math.ceil(ms / TICK);
  for (let i = 0; i < n; i++) vw.tick(TICK, world);
}

const ORTHO: readonly Dir[] = [2, 6, 0, 4];

test('本物の戦闘で倒した敵は、取り除かれた後も亡骸が残り、数字は当たりの瞬間に出る', () => {
  const world = startRun('d1', newTown(), { seed: 4242 });
  world.drainEvents();
  makeStrong(world);
  const { vw, sink } = makeVisual();
  vw.tick(TICK, world);

  const m = spawnBeside(world, 'ratField', ORTHO);
  m.asleep = false;
  vw.tick(TICK, world);
  assert.ok(at(world.map, m.pos.x, m.pos.y)?.visible, '隣のマスが見えていない');
  assert.ok(vw.registry.get(m.id), '台帳に載っていない');
  const tile = { ...m.pos };
  const d = dirTo(world.player.pos, m.pos) as Dir;

  let killed = false;
  for (let turn = 0; turn < 40 && !killed; turn++) {
    sink.log.length = 0;
    stepTurn(world, { type: 'attack', dir: d });
    const events = world.drainEvents();
    vw.ingest(events, world);
    killed = events.some((e) => e.t === 'defeat' && e.actorId === m.id);
    if (!killed) runTicks(vw, world, 1000);
  }
  assert.ok(killed, '40 手で倒せなかった');

  // ゲームの側からはもう消えている
  assert.ok(!world.run.monsters.includes(m), 'removeActor されていない');
  // 見た目の側には亡骸が残っている（旧 fx.ts はここで捨てていた）
  const corpse = vw.registry.get(m.id);
  assert.ok(corpse, '倒した瞬間に見た目まで消えた');
  assert.equal(corpse!.pendingDefeat, true);
  // 当たりの前なので、数字はまだ出ていない
  assert.equal(sink.popups().length, 0, '当たりの前に数字が出た');
  assert.ok(vw.pendingDamage(m.id) > 0, 'HUD 用の「まだ当たっていないダメージ」が無い');

  // 当たりの時刻（主人公の攻撃の当たりのコマ）で数字が出る
  runTicks(vw, world, BEAT_TIMES.attackImpact + TICK);
  const dmg = sink.popups().find((r) => r.what !== 'MISS');
  assert.ok(dmg, '倒した一撃の数字が出ない');
  assert.equal(dmg!.x, tile.x);
  assert.equal(dmg!.y, tile.y);
  assert.ok(dmg!.at >= BEAT_TIMES.attackImpact - 1 && dmg!.at < BEAT_TIMES.attackImpact + TICK + 1,
    `数字の時刻が当たりと合わない: ${dmg!.at}`);
  assert.equal(vw.pendingDamage(m.id), 0);

  // 撃破（当たり ＋ 80ms）で崩れ始める
  runTicks(vw, world, BEAT_TIMES.defeatDelay + TICK);
  const dying = vw.registry.get(m.id);
  assert.ok(dying && dying.dying, '崩れ始めない');
  assert.ok(sink.log.some((r) => r.call === 'burst' && r.what === 'death' && r.tag === 'ratField'));
  // 崩れている間も描く一覧に居る
  let listed = false;
  vw.forEachDrawable((dr: ActorDrawable) => {
    if (dr.id === m.id) listed = true;
  });
  assert.ok(listed, '崩れている亡骸が描く一覧に無い');

  // 崩れ終えたら台帳へ返す
  const free = vw.registry.freeCount;
  runTicks(vw, world, ACTOR_TIMES.deathFlash + ACTOR_TIMES.dissolveStep * 4 + TICK * 2);
  assert.equal(vw.registry.get(m.id), undefined, '崩れ終えても返されない');
  assert.equal(vw.registry.freeCount, free + 1, '置き場へ戻っていない');
});

test('見えないマスで倒れた敵は、亡骸も数字も粒も出さない', () => {
  const world = startRun('d1', newTown(), { seed: 777 });
  world.drainEvents();
  const { vw, sink } = makeVisual();
  vw.tick(TICK, world);

  let m = world.run.monsters.find((x) => !at(world.map, x.pos.x, x.pos.y)?.visible);
  if (!m) {
    // 見えない床を探して出す
    for (let i = 0; i < world.map.tiles.length && !m; i++) {
      const t = world.map.tiles[i];
      const x = i % world.map.width;
      const y = Math.floor(i / world.map.width);
      if (t.kind === 'floor' && !t.visible) m = world.spawnAt?.('ratField', { x, y }) ?? undefined;
    }
  }
  assert.ok(m, '見えないマスに敵が居ない');
  vw.tick(TICK, world);
  assert.ok(vw.registry.get(m!.id), '見えない敵も台帳には載せておく');
  let drawn = false;
  vw.forEachDrawable((d) => {
    if (d.id === m!.id) drawn = true;
  });
  assert.equal(drawn, false, '見えない敵が描く一覧に居る');

  const tile = { ...m!.pos };
  sink.log.length = 0;
  dealDamage(world, world.player, m!, m!.hp + 50, 'physical');
  assert.ok(!world.run.monsters.includes(m!), '倒れていない');
  vw.ingest(world.drainEvents(), world);
  assert.equal(vw.registry.get(m!.id), undefined, '見えないマスに亡骸が残った');
  runTicks(vw, world, 1200);
  const leaked = sink.log.filter((r) => (r.call === 'popup' || r.call === 'burst' || r.call === 'light')
    && Math.round(r.x) === tile.x && Math.round(r.y) === tile.y);
  assert.deepEqual(leaked, [], '見えないマスに数字や粒が出た');
  assert.ok(sink.log.some((r) => r.call === 'sfx'), '効果音は鳴らす');
});

/** 拍の検査用の 1 手ぶん（主人公の会心 → 敵の空振り → 敵の攻撃 → 炎の息） */
function scriptedBatch(world: World, m1: MonsterActor, m2: MonsterActor): GameEvent[] {
  const P = world.player.id;
  return [
    { t: 'message', text: 'こうげき' },
    { t: 'attack', actorId: P, targetId: m1.id, critical: false },
    { t: 'sfx', name: 'hitCritical' },
    { t: 'attack', actorId: P, targetId: m1.id, critical: true },
    { t: 'damage', actorId: m1.id, amount: 12, kind: 'physical' },
    { t: 'miss', actorId: m2.id, targetId: P },
    { t: 'sfx', name: 'hitMiss' },
    { t: 'attack', actorId: m2.id, targetId: P, critical: false },
    { t: 'damage', actorId: P, amount: 3, kind: 'physical' },
    { t: 'zap', from: { ...m1.pos }, to: { ...world.player.pos }, color: '#ff8030' },
    { t: 'sfx', name: 'explosion' },
    { t: 'damage', actorId: P, amount: 5, kind: 'fire' },
    { t: 'bgm', track: 'd1' },
  ];
}

function beatWorld(): { world: World; m1: MonsterActor; m2: MonsterActor } {
  const world = startRun('d1', newTown(), { seed: 99 });
  world.drainEvents();
  makeStrong(world);
  const m1 = spawnBeside(world, 'ratField', [2, 6, 0, 4]);
  const m2 = spawnBeside(world, 'ratField', [6, 2, 4, 0]);
  return { world, m1, m2 };
}

test('1 手のできごとは拍に分かれ、当たりの時刻に出る（決まった時刻・毎回同じ）', () => {
  const run = (): { rec: Rec[]; times: number[] } => {
    const { world, m1, m2 } = beatWorld();
    const { vw, sink } = makeVisual();
    vw.tick(TICK, world);
    const now = vw.ingest(scriptedBatch(world, m1, m2), world);
    assert.deepEqual(now.map((e) => e.t), ['message', 'bgm'], 'ログと音楽はその場で返す');
    const times: number[] = [];
    for (let i = 0; i < vw.timeline.pending; i++) {
      const c = vw.timeline.pendingAt(i);
      if (c.kind === CUE.DAMAGE || c.kind === CUE.MISS) times.push(Math.round(c.time * 100) / 100);
    }
    runTicks(vw, world, 1000);
    return { rec: sink.log.slice(), times };
  };
  const a = run();
  // 当たり：主人公の攻撃は 133.33ms、敵の空振りは 170 + 133.33、敵の攻撃は 340 + 133.33、
  // 炎の息は 510 ＋ 走る時間（60 + 12 × 1 マス）
  assert.deepEqual(a.times, [133.33, 303.33, 473.33, 582]);
  const pops = a.rec.filter((r) => r.call === 'popup');
  assert.deepEqual(pops.map((r) => `${r.what}:${r.tag}`),
    ['12:crit', 'MISS:miss', '3:damageToPlayer', '5:damageToPlayer']);
  for (let i = 0; i < pops.length; i++) {
    assert.ok(pops[i].at >= a.times[i] && pops[i].at < a.times[i] + TICK + 0.01,
      `${pops[i].what} が ${pops[i].at}ms に出た（予定 ${a.times[i]}）`);
  }
  // 会心の手応え：閃き・揺れ・止め
  assert.ok(a.rec.some((r) => r.call === 'hitstop'));
  assert.ok(a.rec.some((r) => r.call === 'burst' && r.what === 'crit'));
  // 放つ音（explosion）は拍の始まり、当たりの音は当たりで鳴る
  const boom = a.rec.find((r) => r.call === 'sfx' && r.what === 'explosion');
  assert.ok(boom && boom.at >= 510 && boom.at < 510 + TICK + 0.01, `息の音が ${boom?.at}ms`);
  const crit = a.rec.find((r) => r.call === 'sfx' && r.what === 'hitCritical');
  assert.ok(crit && crit.at >= 133.33, '会心の音が当たりより先に鳴った');
  // ビームは炎の属性
  assert.ok(a.rec.some((r) => r.call === 'beam' && r.what === 'fire'));

  // 同じ入力なら毎回同じ
  const b = run();
  assert.deepEqual(b.rec, a.rec);
  assert.deepEqual(b.times, a.times);
});

test('1 手ぶんが長ければ 800ms に比例で縮める', () => {
  const { world, m1, m2 } = beatWorld();
  const { vw } = makeVisual();
  vw.tick(TICK, world);
  const P = world.player.id;
  const events: GameEvent[] = [];
  for (let i = 0; i < 6; i++) {
    const src = i % 2 === 0 ? m1.id : m2.id;
    events.push({ t: 'attack', actorId: src, targetId: P, critical: false });
    events.push({ t: 'damage', actorId: P, amount: 1 + i, kind: 'physical' });
  }
  vw.ingest(events, world);
  assert.ok(vw.timeline.compression < 1, '縮めていない');
  let last = -1;
  const order: number[] = [];
  for (let i = 0; i < vw.timeline.pending; i++) {
    const c = vw.timeline.pendingAt(i);
    assert.ok(c.time <= BEAT_TIMES.batchCap + 1e-6, `${c.time}ms は上限を超えている`);
    assert.ok(c.time >= last, '時刻の順に並んでいない');
    last = c.time;
    if (c.kind === CUE.DAMAGE) order.push(c.amount);
  }
  assert.deepEqual(order, [1, 2, 3, 4, 5, 6], '縮めても順番は変わらない');
});

test('次の手が来たら、前の手の残り（数字・崩れ）を一度に出し切る', () => {
  const { world, m1, m2 } = beatWorld();
  const { vw, sink } = makeVisual();
  vw.tick(TICK, world);
  const P = world.player.id;
  // combat.ts と同じく、倒した者は同じ手の中で一覧から外す
  world.removeActor(m1);
  vw.ingest([
    { t: 'attack', actorId: P, targetId: m1.id, critical: false },
    { t: 'damage', actorId: m1.id, amount: 7, kind: 'physical' },
    { t: 'defeat', actorId: m1.id },
  ], world);
  assert.equal(sink.popups().length, 0);
  assert.ok(vw.registry.get(m1.id)?.pendingDefeat);

  // 空の組では何も出し切らない（メニューの pumpEvents など）
  vw.ingest([], world);
  assert.equal(sink.popups().length, 0);

  // 刻みを待たずに次の手
  const now = vw.ingest([
    { t: 'message', text: 'つぎ' },
    { t: 'attack', actorId: m2.id, targetId: P, critical: false },
    { t: 'damage', actorId: P, amount: 2, kind: 'physical' },
  ], world);
  assert.equal(now.length, 1);
  const pops = sink.popups().map((r) => r.what);
  assert.deepEqual(pops, ['7'], '前の手の数字が出ていない（または今の手の数字が早く出た）');
  const corpse = vw.registry.get(m1.id);
  assert.ok(corpse && corpse.dying, '前の手の亡骸が崩れ始めていない');
  assert.equal(vw.pendingDamage(P), 2);
  assert.equal(vw.shownHp(P, world.player.hp, world.player.maxHp), Math.min(world.player.maxHp, world.player.hp + 2));
});

test('倒し過ぎのダメージは HUD の HP を前の値より上に戻さない', () => {
  const { world, m1 } = beatWorld();
  const { vw } = makeVisual();
  vw.tick(TICK, world);
  const p = world.player;
  p.maxHp = 60;
  p.hp = 10;
  vw.tick(TICK, world);
  p.hp = 0;
  vw.ingest([
    { t: 'attack', actorId: m1.id, targetId: p.id, critical: false },
    { t: 'damage', actorId: p.id, amount: 50, kind: 'physical' },
  ], world);
  assert.equal(vw.shownHp(p.id, p.hp, p.maxHp), 10);
  runTicks(vw, world, 300);
  assert.equal(vw.shownHp(p.id, p.hp, p.maxHp), 0);
});

test('階の移動：前の階の残りは粒を出さず、暗転して台帳を空にし、明けに階の札', () => {
  const world = startRun('d1', newTown(), { seed: 31 });
  world.drainEvents();
  const { vw, sink } = makeVisual();
  runTicks(vw, world, 100);
  const before = vw.registry.count;
  assert.ok(before > 1);
  const P = world.player.id;
  const events: GameEvent[] = [{ t: 'damage', actorId: P, amount: 4, kind: 'physical' }];
  enterFloor(world, 2);
  events.push(...world.drainEvents());
  sink.log.length = 0;
  vw.ingest(events, world);
  assert.ok(sink.log.some((r) => r.call === 'transition' && r.what === 'floorOut'));
  assert.ok(!sink.log.some((r) => r.call === 'popup'), '前の階の数字が出た');
  assert.ok(vw.isHolding(), '暗転の間は入力を止める');
  // 新しい階の顔ぶれだけが居る（湧いた扱いの土煙は出さない）
  for (let i = 0; i < vw.registry.count; i++) {
    const a = vw.registry.at(i);
    assert.ok(a.id === P || world.run.monsters.some((m) => m.id === a.id) || world.run.allies.some((m) => m.id === a.id));
  }
  assert.ok(!sink.log.some((r) => r.call === 'burst' && r.tag === 'spawn'));
  runTicks(vw, world, 400);
  assert.ok(sink.log.some((r) => r.call === 'transition' && r.what === 'floorIn'));
  assert.ok(sink.log.some((r) => r.call === 'banner' && r.what === 'B2F'));
  runTicks(vw, world, 400);
  assert.equal(vw.isHolding(), false);
});

test('300 手の再生：見た目を通しても通さなくても、ゲームの乱数と結果は同じ', () => {
  const seed = 2718;
  const plain = startRun('d2', newTown(), { seed });
  const seen = startRun('d2', newTown(), { seed });
  // 300 手を最後まで回すため、両方の主人公を同じだけ打たれ強くする
  for (const w of [plain, seen]) {
    w.player.maxHp = 9999;
    w.player.hp = 9999;
  }
  const { vw, sink } = makeVisual();
  // 隣に敵が居れば殴る（戦闘の演出を多く通すため）。それ以外はでたらめに動く。
  // 盤面だけから決まるので、両方の世界で同じ手になる
  const script = (w: World, r: Rng): Action => {
    const roll = r.int(100);
    const p = w.player.pos;
    let near: MonsterActor | null = null;
    let nearD = 99;
    for (const m of w.run.monsters) {
      const d = Math.max(Math.abs(m.pos.x - p.x), Math.abs(m.pos.y - p.y));
      if (d < nearD) {
        nearD = d;
        near = m;
      }
    }
    if (near && nearD === 1 && roll < 85) return { type: 'attack', dir: dirTo(p, near.pos) as Dir };
    if (near && nearD <= 10 && roll < 70) {
      const d = dirTo(p, near.pos) as Dir;
      if (canEnter(w.map, p.x + DIR_VEC[d].x, p.y + DIR_VEC[d].y, 'ground')) return { type: 'move', dir: d };
    }
    if (roll < 60) return { type: 'move', dir: r.pick(DIRS) as Dir, dash: roll < 10 };
    if (roll < 78) return { type: 'attack', dir: r.pick(DIRS) as Dir };
    if (roll < 86) return { type: 'wait' };
    if (roll < 92) return { type: 'pickup' };
    return { type: 'stairs' };
  };
  const ra = new Rng(11);
  const rb = new Rng(11);
  plain.drainEvents();
  const first = seen.drainEvents();

  // 見た目の側が Math.random を呼んだら落とす
  const realRandom = Math.random;
  const forbid = (): number => {
    throw new Error('見た目の層が Math.random を呼んだ');
  };
  let leaks = 0;
  let drawn = 0;
  const onDraw = (d: ActorDrawable): void => {
    drawn++;
    if (d.kind === 'player') return;
    if (!at(seen.map, d.tileX, d.tileY)?.visible) leaks++;
  };
  Math.random = forbid;
  try {
    vw.ingest(first, seen);
    vw.tick(TICK, seen);
  } finally {
    Math.random = realRandom;
  }

  let turns = 0;
  let damages = 0;
  for (let i = 0; i < 300; i++) {
    if (plain.finished || seen.finished) break;
    // 戦闘を多く通すため、12 手ごとに両方の世界の同じ場所へ敵を出す（湧きの乱数も両方で同じだけ進む）
    if (i % 12 === 0) {
      for (const w of [plain, seen]) {
        try {
          spawnBeside(w, 'ratField', ORTHO);
        } catch {
          // 隣が埋まっていれば出さない（両方の世界で同じ）
        }
      }
      // 本番では湧いた手の ingest で台帳に載る。ここでは手の外で出したので 1 刻みで載せる
      Math.random = forbid;
      try {
        vw.tick(TICK, seen);
      } finally {
        Math.random = realRandom;
      }
    }
    const a = script(plain, ra);
    const b = script(seen, rb);
    assert.deepEqual(b, a, `${i} 手目で手がずれた`);
    turns++;
    plain.player.hp = plain.player.maxHp;
    seen.player.hp = seen.player.maxHp;
    stepTurn(plain, a);
    plain.drainEvents();

    Math.random = forbid;
    try {
      vw.notePlayerAction(b);
    } finally {
      Math.random = realRandom;
    }
    stepTurn(seen, b);
    const events = seen.drainEvents();
    damages += events.filter((e) => e.t === 'damage').length;
    Math.random = forbid;
    try {
      vw.ingest(events, seen);
      const n = (i % 3) + (i % 7 === 0 ? 0 : 1);
      for (let k = 0; k < n; k++) vw.tick(TICK, seen);
      vw.forEachDrawable(onDraw);
    } finally {
      Math.random = realRandom;
    }
  }
  assert.deepEqual(seen.rng.serialize(), plain.rng.serialize(), 'ゲームの乱数がずれた');
  assert.equal(seen.run.totalTurn, plain.run.totalTurn);
  assert.equal(seen.run.depth, plain.run.depth);
  assert.deepEqual(seen.player.pos, plain.player.pos);
  assert.equal(seen.player.hp, plain.player.hp);
  assert.equal(leaks, 0, '見えないマスのキャラが描く一覧に入った');
  assert.ok(drawn > 0);
  assert.equal(turns, 300, '300 手を回し切っていない');
  // ダメージの数字は 1 つも落とさない（まだ当たっていない最後の手の分を除く）。
  // 敵は主人公の隣で殴り合うので、見えないマスのダメージはこの流れには無い
  const shown = sink.log.filter((r) => r.call === 'popup'
    && (r.tag === 'damage' || r.tag === 'damageToPlayer' || r.tag === 'crit')).length;
  let waiting = 0;
  for (let i = 0; i < vw.timeline.pending; i++) if (vw.timeline.pendingAt(i).kind === CUE.DAMAGE) waiting++;
  assert.ok(damages >= 10, `戦闘がほとんど起きていない（ダメージ ${damages}）`);
  assert.equal(shown + waiting, damages, `ダメージの数字を落とした（数字 ${shown} ＋ 待ち ${waiting}、ダメージ ${damages}）`);
});

test('敵が入れ替わり続けても、台帳と合図の置き場は増え続けない', () => {
  const world = startRun('d1', newTown(), { seed: 5150 });
  world.drainEvents();
  makeStrong(world);
  const { vw } = makeVisual();
  vw.tick(TICK, world);
  const cycle = (): void => {
    const m = spawnBeside(world, 'slimeBlue', ORTHO);
    vw.tick(TICK, world);
    dealDamage(world, world.player, m, m.hp + 5, 'physical');
    vw.ingest(world.drainEvents(), world);
    runTicks(vw, world, 800);
    world.player.hp = world.player.maxHp;
  };
  for (let i = 0; i < 5; i++) cycle();
  const created = vw.registry.created;
  const cues = vw.timeline.capacity;
  for (let i = 0; i < 60; i++) cycle();
  assert.equal(vw.registry.created, created, `ActorAnim を作り続けている（${created} → ${vw.registry.created}）`);
  assert.equal(vw.timeline.capacity, cues, 'Cue を作り続けている');
  assert.ok(vw.registry.count <= world.run.monsters.length + world.run.allies.length + 1);
});

test('描く順は足元の y → x（奥から手前）で、配列を作らずに並べ直せる', () => {
  const world = startRun('d1', newTown(), { seed: 8080 });
  world.drainEvents();
  spawnBeside(world, 'ratField', [0, 4, 2, 6]);
  spawnBeside(world, 'ratField', [4, 0, 6, 2]);
  const { vw } = makeVisual();
  runTicks(vw, world, 200);
  const n = vw.sortDrawables();
  assert.ok(n >= 3);
  for (let i = 1; i < n; i++) {
    const a = vw.drawableAt(i - 1);
    const b = vw.drawableAt(i);
    assert.ok(a.artY < b.artY || (a.artY === b.artY && a.artX <= b.artX), '奥から手前の順になっていない');
    assert.ok(Number.isInteger(b.artX) && Number.isInteger(b.artY), '足元が整数でない');
  }
  const p = vw.actor(world.player.id)!;
  assert.equal(p.artX, world.player.pos.x * 16 + 8);
  assert.equal(p.artY, world.player.pos.y * 16 + 13);
});

test('歩き：位置は毎刻み滑らかに動き、姿勢のコマは歩いた距離で進む', () => {
  const world = startRun('d1', newTown(), { seed: 12 });
  world.drainEvents();
  const { vw } = makeVisual();
  vw.tick(TICK, world);
  const p = world.player;
  let dir: Dir | null = null;
  for (const d of DIRS) {
    const q = { x: p.pos.x + DIR_VEC[d].x, y: p.pos.y + DIR_VEC[d].y };
    if (canEnter(world.map, q.x, q.y, 'ground') && !world.actorAt(q) && (d & 1) === 0) {
      dir = d;
      break;
    }
  }
  assert.ok(dir !== null);
  const x0 = vw.actor(p.id)!.artX;
  const y0 = vw.actor(p.id)!.artY;
  stepTurn(world, { type: 'move', dir: dir! });
  vw.ingest(world.drainEvents(), world);
  const xs: number[] = [];
  const frames = new Set<number>();
  for (let i = 0; i < 12; i++) {
    vw.tick(TICK, world);
    const a = vw.actor(p.id)!;
    xs.push(a.artX + a.artY);
    if (a.anim === 'walk') frames.add(a.frame);
  }
  // 16 ドットを 1 刻みで飛ばずに、途中の位置を通る
  const moved = xs.filter((v) => v !== x0 + y0 && v !== xs[xs.length - 1]);
  assert.ok(moved.length >= 3, `途中の位置が少ない: ${xs.join(',')}`);
  assert.ok(frames.size >= 2, '歩きのコマが進まない');
  const a = vw.actor(p.id)!;
  assert.equal(a.artX, world.player.pos.x * 16 + 8);
  assert.equal(a.artY, world.player.pos.y * 16 + 13);
});

test('カメラは整数で読み出し、マップの外へはみ出し過ぎない', () => {
  const cam = new Camera();
  cam.centerOnTile(0, 0, 48, 32);
  cam.snap();
  assert.ok(Number.isInteger(cam.camX) && Number.isInteger(cam.camY));
  assert.ok(cam.camX >= -cam.viewW * Camera.OVERSCROLL - 0.5, '左へはみ出し過ぎ');
  cam.centerOnTile(47, 31, 48, 32);
  for (let i = 0; i < 120; i++) {
    cam.update(TICK);
    assert.ok(Number.isInteger(cam.camX));
  }
  assert.ok(Math.abs(cam.x - cam.targetX) < 1e-9, '寄り切らない');
  assert.ok(cam.camX <= 48 * 16 - cam.viewW + cam.viewW * Camera.OVERSCROLL + 0.5, '右へはみ出し過ぎ');
});

test('ビームの色から属性を決め、演出の名前はそろっている', () => {
  assert.equal(elementOfColor('#ff8030'), 'fire');
  assert.equal(elementOfColor('#ffe060'), 'thunder');
  assert.equal(elementOfColor('#50a0e0'), 'water');
  assert.equal(elementOfColor('#c0a0ff'), 'magic');
  assert.equal(elementOfColor('#ffffff'), 'light');
  assert.equal(elementOfColor('#30d060'), 'poison');
  assert.equal(new Set(VFX_PRESET_IDS).size, VFX_PRESET_IDS.length);
  for (const id of ['hitPhysical', 'hitFire', 'hitMagic', 'crit', 'heal', 'death', 'levelUp', 'explosion',
    'warp', 'dust', 'splash', 'trapGas', 'statusApplied', 'itemGet', 'dig']) {
    assert.ok((VFX_PRESET_IDS as readonly string[]).includes(id), id);
  }
});

test('アニメ速度「なし」では、当たりも撃破も待たずに出る', () => {
  const { world, m1 } = beatWorld();
  const { vw, sink } = makeVisual();
  vw.speedScale = 0.001;
  vw.tick(TICK, world);
  world.removeActor(m1);
  vw.ingest([
    { t: 'attack', actorId: world.player.id, targetId: m1.id, critical: false },
    { t: 'damage', actorId: m1.id, amount: 9, kind: 'physical' },
    { t: 'defeat', actorId: m1.id },
  ], world);
  vw.tick(TICK, world);
  assert.deepEqual(sink.popups().map((r) => r.what), ['9']);
  vw.tick(TICK, world);
  assert.equal(vw.registry.get(m1.id), undefined, '崩れが一瞬で終わらない');
});

test('倒れた：告知の前に入力が戻らず、主人公は崩れ落ちて灰色になる', () => {
  const { world, m1 } = beatWorld();
  const { vw, sink } = makeVisual();
  vw.speedScale = 0.6;
  vw.tick(TICK, world);
  const P = world.player.id;
  vw.ingest([
    { t: 'attack', actorId: m1.id, targetId: P, critical: false },
    { t: 'damage', actorId: P, amount: 99, kind: 'physical' },
    { t: 'gameOver', reason: 'ネズミに やられた' },
  ], world);
  const until = vw.timeline.batchMs + 1200 * 0.6;
  runTicks(vw, world, until - 2 * TICK);
  assert.ok(vw.isHolding(), '告知を読む前に入力が戻る');
  const banner = sink.log.find((r) => r.call === 'banner');
  assert.ok(banner && banner.what === 'ちからつきた……' && banner.tag.endsWith('|gameOver'));
  runTicks(vw, world, 4 * TICK);
  assert.equal(vw.isHolding(), false, '止めすぎ（倍率が二重に掛かっている）');
  runTicks(vw, world, 1000);
  const p = vw.actor(P)!;
  assert.equal(p.anim, 'hurt');
  assert.ok(p.grey > 0.99, '灰色にならない');
});

const CUE_NAMES: Record<number, string> = Object.fromEntries(Object.entries(CUE).map(([k, v]) => [v, k]));

/** まだ出していない合図を「名前@時刻」で */
function planOf(vw: VisualWorld, kinds?: readonly number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < vw.timeline.pending; i++) {
    const c = vw.timeline.pendingAt(i);
    if (kinds && !kinds.includes(c.kind)) continue;
    out.push(`${c.kind === CUE.SFX ? c.str : CUE_NAMES[c.kind]}@${Math.round(c.time)}`);
  }
  return out;
}

test('敵の当たりの音（attack より先に積まれる）は、その敵の当たりで鳴る', () => {
  const { world, m1, m2 } = beatWorld();
  const { vw } = makeVisual();
  vw.tick(TICK, world);
  const P = world.player.id;
  world.removeActor(m1);
  // combat.ts の順：主人公は attack → sfx → attack、敵は sfx → attack（resolveAttack だけを通る）
  vw.ingest([
    { t: 'attack', actorId: P, targetId: m1.id, critical: false },
    { t: 'sfx', name: 'hit' },
    { t: 'attack', actorId: P, targetId: m1.id, critical: false },
    { t: 'damage', actorId: m1.id, amount: 8, kind: 'physical' },
    { t: 'defeat', actorId: m1.id },
    { t: 'sfx', name: 'defeat' },
    { t: 'message', text: 'ネズミの こうげき！' },
    { t: 'sfx', name: 'hitCritical' },
    { t: 'attack', actorId: m2.id, targetId: P, critical: true },
    { t: 'damage', actorId: P, amount: 4, kind: 'physical' },
    { t: 'sfx', name: 'damage' },
  ], world);
  // 敵の拍は撃破（213ms）の後に始まり、当たりは 213 + 133
  assert.deepEqual(planOf(vw, [CUE.SFX]), ['hit@133', 'defeat@213', 'hitCritical@347', 'damage@347']);
});

test('同じ爆発に巻き込まれた者のダメージは、先に倒れた者の撃破を待たない', () => {
  const { world, m1, m2 } = beatWorld();
  const { vw } = makeVisual();
  vw.tick(TICK, world);
  world.removeActor(m1);
  world.removeActor(m2);
  vw.ingest([
    { t: 'explosion', pos: { ...world.player.pos }, radius: 1 },
    { t: 'damage', actorId: m1.id, amount: 30, kind: 'fire' },
    { t: 'defeat', actorId: m1.id },
    { t: 'damage', actorId: m2.id, amount: 30, kind: 'fire' },
    { t: 'defeat', actorId: m2.id },
    { t: 'itemDrop', uid: 1, pos: { ...m2.pos } },
  ], world);
  const impact = BEAT_TIMES.explosionImpact;
  const defeat = impact + BEAT_TIMES.defeatDelay;
  assert.deepEqual(planOf(vw), [
    `DAMAGE@${impact}`, `DAMAGE@${impact}`, `DEFEAT@${defeat}`, `DEFEAT@${defeat}`, `ITEM_DROP@${defeat}`,
  ]);
});
