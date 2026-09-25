/**
 * 粒子の置き場。
 * 毎フレーム回るので、配列が増えない・上限を超えない・消えた場所を使い回す、を固定する。
 * 技の粒は環境の粒を追い出して入り、満杯なら環境の粒は生まれない（技の演出を優先）。
 *
 * Math.random を使っていないことはテストでは確かめられない（node の fs を型に入れていない）。
 * ソースを読む人が確かめる。ここでは「同じ種なら同じ結果」だけを見る。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { RAMP_DUST, RAMP_EMBER, RAMP_HEAL, RAMP_MAGIC, ci } from '../src/ui/art/palette.js';
import { PixBuf, countPainted, ellipse, rect } from '../src/ui/art/pixbuf.js';
import { CurlField } from '../src/ui/gfx-core/curl.js';
import { KIND_HD, KIND_PIXEL, MODE_AGE, MODE_SPRITE, PF_AMBIENT, ParticlePool, SPRITE_PARTICLE_MAX, } from '../src/ui/gfx-core/particles.js';
const H = 1 / 60;
const TAU = Math.PI * 2;
const anywhere = (_region, out, rng) => {
    out[0] = rng.float() * 428;
    out[1] = rng.float() * 240;
    return true;
};
const DUST = {
    name: '塵', region: 'view', cap: 400, rate: 120, life: [2, 5], ramp: RAMP_DUST, glow: null,
    size: 1, flow: 1, gravity: 0,
};
const EMBERS = {
    name: '火の粉', region: 'torch', cap: 100, rate: 60, life: [1, 2], ramp: RAMP_EMBER, glow: null,
    size: 1, flow: 1.3, gravity: -16, emissive: true,
};
const MOTES = {
    name: '蛍', region: 'view', cap: 60, rate: 20, life: [3, 6], ramp: null, glow: '#c5e07a',
    size: 2, flow: 0.8, gravity: 0, blink: true, emissive: true,
};
const MAGIC = {
    count: 300, speed: [30, 90], spread: TAU, life: [0.8, 1.6], size: 1, ramp: RAMP_MAGIC,
    kind: KIND_PIXEL, gain: 1.8, drag: 2.5, gravity: 0, flowRamp: 2, radius: 3, emissive: true,
};
const GLOW = {
    count: 40, speed: [5, 20], spread: TAU, life: [0.5, 1], size: 4, ramp: RAMP_HEAL,
    kind: KIND_HD, gain: 1, drag: 2, gravity: -20, flowRamp: 1, emissive: true,
};
/** 丸い仮の絵 */
function blob(w, h, r) {
    const b = new PixBuf(w, h);
    ellipse(b, w >> 1, h >> 1, r, r, ci('violet', 3));
    ellipse(b, w >> 1, h >> 1, r >> 1, r >> 1, ci('gold', 4));
    return b;
}
/** 置き場の配列を全部並べる（実体が変わらないことを見るため） */
function arraysOf(p) {
    return [p.x, p.y, p.vx, p.vy, p.age, p.life, p.size, p.gain, p.drag, p.grav, p.flowIn, p.phase,
        p.kind, p.rampId, p.mode, p.flags, p.tone, p.emitter];
}
test('1 万刻み回しても上限を超えず、配列は増えも作り直されもしない', () => {
    const rng = new Rng('particles:soak');
    const pool = new ParticlePool(2048, rng);
    const field = new CurlField({ cols: 28, rows: 16 });
    pool.addAmbient(DUST, anywhere);
    pool.addAmbient(EMBERS, anywhere);
    pool.addAmbient(MOTES, anywhere);
    const arrays = arraysOf(pool);
    const buffers = arrays.map((a) => a.buffer);
    const lengths = arrays.map((a) => a.length);
    const sprite = blob(32, 32, 12);
    let maxCount = 0;
    let sawFull = false;
    for (let t = 0; t < 10000; t++) {
        if (t % 10 === 0)
            pool.burst(MAGIC, 50 + rng.float() * 300, 40 + rng.float() * 160);
        if (t % 45 === 0)
            pool.burst(GLOW, 200, 120, 0, -1);
        if (t % 300 === 0)
            pool.fromSprite(sprite, 100, 100, 1);
        // 途中で画質を落とし、また戻す
        if (t === 4000)
            pool.setAmbientScale(0.25);
        if (t === 7000)
            pool.setAmbientScale(1);
        field.tick();
        pool.step(H, field, t > 5000 ? 6 : 0);
        const n = pool.count;
        assert.ok(n <= pool.capacity, `${t}: ${n} 個`);
        assert.ok(pool.ambientCount <= n);
        if (n > maxCount)
            maxCount = n;
        if (n === pool.capacity)
            sawFull = true;
        if (t % 997 === 0) {
            for (let i = 0; i < n; i++) {
                assert.ok(pool.age[i] < pool.life[i], `${t}: ${i} が寿命を過ぎている`);
                assert.ok(Number.isFinite(pool.x[i]) && Number.isFinite(pool.y[i]));
                // 区画：前が環境の粒、後ろが技の粒
                assert.equal((pool.flags[i] & PF_AMBIENT) !== 0, i < pool.ambientCount, `${t}: ${i} の区画`);
            }
        }
    }
    assert.ok(sawFull, `一度も満杯にならなかった（最大 ${maxCount}）`);
    const after = arraysOf(pool);
    after.forEach((a, k) => {
        assert.equal(a, arrays[k], `${k} 番の配列が作り直された`);
        assert.equal(a.buffer, buffers[k], `${k} 番の置き場が作り直された`);
        assert.equal(a.length, lengths[k], `${k} 番の長さが変わった`);
    });
});
test('消えた粒の場所を詰めて使い回し、粒の中身は崩れない', () => {
    const rng = new Rng(11);
    const pool = new ParticlePool(64, rng);
    const field = new CurlField({ cols: 8, rows: 8 });
    const a = { ...MAGIC, count: 40, life: [0.3, 1.2], size: 1, gravity: 5 };
    const b = { ...MAGIC, count: 40, life: [0.3, 1.2], size: 2, gravity: -7 };
    assert.equal(pool.burst(a, 60, 60), 40);
    assert.equal(pool.burst(b, 60, 60), 24, '上限 64 を超えた分は入らない');
    assert.equal(pool.count, 64);
    let refilled = 0;
    for (let t = 0; t < 200; t++) {
        pool.step(H, field);
        // 同じ粒の項目は一緒に移っている（大きさと重力の組が崩れない）
        for (let i = 0; i < pool.count; i++) {
            const g = pool.grav[i];
            assert.ok((pool.size[i] === 1 && g === 5) || (pool.size[i] === 2 && g === -7), `${t}: ${i}`);
        }
        if (t === 40) {
            const before = pool.count;
            assert.ok(before < 64, '40 刻みで 1 つも消えていない');
            refilled = pool.burst(b, 60, 60);
            assert.equal(refilled, Math.min(40, 64 - before));
            assert.equal(pool.count, before + refilled);
        }
    }
    assert.ok(refilled > 0);
    assert.equal(pool.count, 0, '寿命が過ぎたら全部消える');
});
test('MODE_AGE：年齢とともに階調を進むだけで戻らない', () => {
    const pool = new ParticlePool(8, new Rng(3));
    const field = new CurlField({ cols: 4, rows: 4 });
    const one = { ...MAGIC, count: 1, life: [1.2, 1.2] };
    pool.burst(one, 30, 30);
    assert.equal(pool.mode[0], MODE_AGE);
    const seen = [];
    while (pool.count > 0) {
        const s = pool.rampStepOf(0);
        assert.equal(pool.colorIndexOf(0), RAMP_MAGIC[s]);
        if (seen.length)
            assert.ok(s >= seen[seen.length - 1], `${seen.join(',')} → ${s}`);
        seen.push(s);
        pool.step(H, field);
    }
    assert.equal(seen[0], 0, '白から始まる');
    assert.equal(seen[seen.length - 1], RAMP_MAGIC.length - 1, '最後の段まで進む');
});
test('満杯なら技の粒は環境の粒を追い出して入り、環境の粒は生まれない', () => {
    const pool = new ParticlePool(100, new Rng(21));
    const field = new CurlField({ cols: 28, rows: 16 });
    const flood = { ...DUST, cap: 1000, rate: 6000, life: [100, 100] };
    pool.addAmbient(flood, anywhere);
    pool.step(H, field);
    assert.equal(pool.count, 100);
    assert.equal(pool.ambientCount, 100);
    pool.step(H, field);
    assert.equal(pool.count, 100, '満杯のまま');
    const long = { ...MAGIC, life: [100, 100] };
    assert.equal(pool.burst({ ...long, count: 30 }, 10, 10), 30);
    assert.equal(pool.count, 100);
    assert.equal(pool.ambientCount, 70, '環境の粒が 30 個追い出された');
    assert.equal(pool.burst({ ...long, count: 100 }, 10, 10), 70, '残りの環境の粒の分だけ入る');
    assert.equal(pool.ambientCount, 0);
    assert.equal(pool.burst({ ...long, count: 10 }, 10, 10), 0, '技の粒で満杯なら入らない');
    // 満杯の間は環境の粒は生まれない
    for (let t = 0; t < 30; t++)
        pool.step(H, field);
    assert.equal(pool.ambientCount, 0);
    assert.equal(pool.count, 100);
});
test('環境の粒は出どころごとの上限と画質の倍率を守る', () => {
    const pool = new ParticlePool(2048, new Rng(4));
    const field = new CurlField({ cols: 28, rows: 16 });
    const e = pool.addAmbient({ ...DUST, cap: 200, rate: 2000, life: [50, 50] }, anywhere);
    assert.ok(e >= 0);
    pool.step(0.5, field);
    assert.equal(pool.ambientCount, 200);
    pool.clearAmbient();
    assert.equal(pool.count, 0);
    pool.setAmbientScale(0.25);
    pool.addAmbient({ ...DUST, cap: 200, rate: 2000, life: [50, 50] }, anywhere);
    for (let t = 0; t < 60; t++)
        pool.step(H, field);
    assert.equal(pool.ambientCount, 50);
    // 場所が無いと答えた回は生まれない
    const pool2 = new ParticlePool(64, new Rng(4));
    pool2.addAmbient(DUST, () => false);
    for (let t = 0; t < 60; t++)
        pool2.step(H, field);
    assert.equal(pool2.count, 0);
});
test('出どころを外すと、その粒だけ消えて技の粒は残る', () => {
    const pool = new ParticlePool(512, new Rng(9));
    const field = new CurlField({ cols: 28, rows: 16 });
    const a = pool.addAmbient({ ...DUST, rate: 600, life: [50, 50] }, anywhere);
    pool.addAmbient({ ...EMBERS, rate: 600, life: [50, 50] }, anywhere);
    pool.step(0.1, field);
    pool.burst({ ...MAGIC, count: 20, life: [50, 50] }, 10, 10);
    const vfx = pool.count - pool.ambientCount;
    let dust = 0;
    for (let i = 0; i < pool.ambientCount; i++)
        if (pool.emitter[i] === a)
            dust++;
    const embers = pool.ambientCount - dust;
    assert.ok(dust > 0 && embers > 0);
    pool.removeAmbient(a);
    assert.equal(pool.count - pool.ambientCount, vfx);
    assert.equal(pool.ambientCount, embers);
    for (let i = 0; i < pool.ambientCount; i++)
        assert.notEqual(pool.emitter[i], a);
});
test('fromSprite：透明でない画素 1 つに粒 1 つ（多い絵は上限まで間引く）', () => {
    const pool = new ParticlePool(2048, new Rng(12));
    const small = blob(24, 24, 5);
    const opaque = countPainted(small);
    assert.ok(opaque > 0 && opaque <= SPRITE_PARTICLE_MAX);
    assert.equal(pool.fromSprite(small, 40, 50, 1), opaque);
    // 粒は画素の場所から、その画素の色で始まる
    for (let i = 0; i < pool.count; i++) {
        assert.equal(pool.mode[i], MODE_SPRITE);
        const px = pool.x[i] - 40;
        const py = pool.y[i] - 50;
        assert.ok(Number.isInteger(px) && Number.isInteger(py));
        assert.equal(pool.colorIndexOf(i), small.get(px, py));
    }
    pool.clear();
    assert.equal(pool.fromSprite(small, 0, 0, 2), Math.ceil(opaque / 2));
    pool.clear();
    const big = new PixBuf(64, 64);
    rect(big, 4, 4, 56, 56, ci('stone', 3));
    const bigOpaque = countPainted(big);
    const n = pool.fromSprite(big, 0, 0, 1);
    assert.ok(n <= SPRITE_PARTICLE_MAX && n >= SPRITE_PARTICLE_MAX / 2, `${bigOpaque} 画素 → ${n} 個`);
    assert.equal(pool.fromSprite(new PixBuf(8, 8), 0, 0), 0, '空の絵からは何も出ない');
});
test('崩れる粒は同じ階調を暗い方へ下りる', () => {
    const pool = new ParticlePool(64, new Rng(13));
    const field = new CurlField({ cols: 4, rows: 4 });
    const b = new PixBuf(4, 4);
    b.set(1, 1, ci('leaf', 4));
    pool.fromSprite(b, 10, 10, 1);
    let prev = 99;
    while (pool.count > 0) {
        const c = pool.colorIndexOf(0);
        const step = (c - 1) % 6;
        assert.ok(step <= prev, `段が戻った ${prev} → ${step}`);
        assert.equal(Math.floor((c - 1) / 6), Math.floor((ci('leaf', 4) - 1) / 6), '別の階調になった');
        prev = step;
        pool.step(H, field);
    }
    assert.ok(prev < 4, '暗くならなかった');
});
test('同じ種・同じ手順なら同じ粒（表示用の乱数だけで決まる）', () => {
    const run = () => {
        const pool = new ParticlePool(1024, new Rng('same'));
        const field = new CurlField({ cols: 28, rows: 16 });
        pool.addAmbient(DUST, anywhere);
        for (let t = 0; t < 300; t++) {
            if (t % 30 === 0)
                pool.burst(MAGIC, 100, 100, 1, 0);
            field.tick();
            pool.step(H, field);
        }
        return pool.x.slice(0, pool.count);
    };
    assert.deepEqual(run(), run());
});
test('HD の粒の濃さは 0〜1、技の粒は年齢で薄れる', () => {
    const pool = new ParticlePool(64, new Rng(14));
    const field = new CurlField({ cols: 4, rows: 4 });
    pool.burst({ ...GLOW, count: 1, life: [1, 1] }, 20, 20);
    let prev = 2;
    while (pool.count > 0) {
        const a = pool.alphaOf(0);
        assert.ok(a >= 0 && a <= 1);
        assert.ok(a <= prev);
        prev = a;
        pool.step(H, field);
    }
    pool.addAmbient(MOTES, anywhere);
    for (let t = 0; t < 400; t++) {
        pool.step(H, field);
        for (let i = 0; i < pool.count; i++) {
            const a = pool.alphaOf(i);
            assert.ok(a >= 0 && a <= 1, `${a}`);
        }
    }
});
//# sourceMappingURL=particles.test.js.map