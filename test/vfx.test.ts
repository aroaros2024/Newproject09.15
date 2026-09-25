/**
 * 演出の表：全部の演出に中身があり、強さで粒が増え、色の差し替えが効く。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { VFX_PRESET_IDS, type BurstOpts } from '../src/ui/anim/types.js';
import { ParticlePool } from '../src/ui/gfx-core/particles.js';
import { ELEMENT_RAMP, ELEMENT_TONE, VFX, fireVfx, statusRamp } from '../src/ui/gfx-core/vfxPresets.js';
import { RAMP_EMBER, RAMP_MAGIC, RAMP_POISON } from '../src/ui/art/palette.js';

const opts = (o: Partial<BurstOpts> = {}): BurstOpts => ({ dir8: -1, power: 1, color: '', tag: '', ...o });

test('全部の演出に粒がある', () => {
  for (const id of VFX_PRESET_IDS) {
    const r = VFX[id];
    assert.ok(r && r.bursts.length > 0, `${id} に粒が無い`);
    const pool = new ParticlePool(512, new Rng(1));
    assert.ok(fireVfx(pool, id, 32, 32, opts()) > 0, `${id} で粒が生まれない`);
  }
});

test('強さで粒が増える（会心・大きな爆発）', () => {
  const a = new ParticlePool(2048, new Rng(1));
  const b = new ParticlePool(2048, new Rng(1));
  const n1 = fireVfx(a, 'explosion', 0, 0, opts());
  const n2 = fireVfx(b, 'explosion', 0, 0, opts({ power: 2 }));
  assert.ok(n2 > n1 * 1.5, `${n1} → ${n2}`);
});

test('状態異常の粒は状態の色、属性は色の組を持つ', () => {
  assert.equal(statusRamp('burning'), RAMP_EMBER);
  assert.equal(statusRamp('poisoned'), RAMP_POISON);
  assert.equal(statusRamp('unknown'), RAMP_MAGIC);
  for (const e of ['physical', 'fire', 'ice', 'thunder', 'water', 'magic', 'poison', 'light'] as const) {
    assert.ok(ELEMENT_RAMP[e].length > 0);
    assert.ok(ELEMENT_TONE[e] >= 0);
  }
});

test('向きのある演出は向きの側へ飛ぶ', () => {
  const pool = new ParticlePool(512, new Rng(3));
  fireVfx(pool, 'hitPhysical', 0, 0, opts({ dir8: 2 }));
  let right = 0;
  for (let i = 0; i < pool.count; i++) if (pool.vx[i] > 0) right++;
  assert.ok(right > pool.count * 0.7, `${right}/${pool.count}`);
});
