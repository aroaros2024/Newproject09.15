/**
 * 描画エンジンの DOM に触れない決まり：キャンバスの大きさの決め方と、画質の段の表。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBacking, pixelInfo, sharpFactor } from '../src/ui/gfx/compositor.js';
import { GRADE_FULL, GRADE_NONE, GRADE_TINT, QUALITY_PRESETS, qualityPreset } from '../src/ui/gfx/quality.js';
test('ふつうの表示：16:9 を保って収まる最大の大きさ、実画素は CSS × 画素密度（2 まで）', () => {
    const a = computeBacking(1280, 720, 1, false);
    assert.deepEqual([a.cssW, a.cssH, a.backW, a.backH], [1280, 720, 1280, 720]);
    assert.equal(a.artPx, 3);
    assert.equal(a.integer, true);
    const b = computeBacking(1920, 1200, 1, false);
    assert.deepEqual([b.cssW, b.cssH, b.backW, b.backH], [1920, 1080, 1920, 1080]);
    assert.equal(b.artPx, 4.5);
    assert.equal(b.integer, false);
    // 画素密度は 2 で頭打ち
    const c = computeBacking(1280, 720, 3, false);
    assert.deepEqual([c.backW, c.backH, c.dpr], [2560, 1440, 2]);
    assert.equal(c.integer, true);
    const d = computeBacking(1366, 768, 1.5, false);
    assert.equal(d.cssW, 1365);
    assert.equal(d.backH, Math.round(d.cssH * 1.5));
    assert.equal(d.integer, false);
});
test('整数倍の表示：実画素は 1280×720 のちょうど n 倍（ドットの幅が完全に揃う）', () => {
    const a = computeBacking(1920, 1080, 1, true);
    assert.deepEqual([a.backW, a.backH], [1280, 720]);
    assert.equal(a.integer, true);
    const b = computeBacking(1920, 1080, 1.5, true);
    assert.deepEqual([b.backW, b.backH], [2560, 1440]);
    assert.equal(b.artPx, 6);
    assert.ok(Math.abs(b.cssW * 1.5 - 2560) < 1e-6);
    // 狭くても 1 倍より小さくはしない
    const c = computeBacking(800, 450, 1, true);
    assert.deepEqual([c.backW, c.backH], [1280, 720]);
});
test('1 ドットの実画素：整数かどうかと、整数でない時の中間の倍率（2〜4）', () => {
    assert.deepEqual(pixelInfo(1280, 720), { artPx: 3, integer: true });
    assert.deepEqual(pixelInfo(2560, 1440), { artPx: 6, integer: true });
    assert.equal(pixelInfo(1920, 1080).integer, false);
    assert.equal(pixelInfo(1281, 720).integer, false);
    assert.equal(sharpFactor(4.5), 4);
    assert.equal(sharpFactor(2.25), 2);
    assert.equal(sharpFactor(1.4), 2);
    assert.equal(sharpFactor(7.5), 4);
});
test('画質の段：低は重い合成を全部切り、高ほど光が細かく粒が多い', () => {
    assert.equal(QUALITY_PRESETS.length, 3);
    const [low, mid, high] = QUALITY_PRESETS;
    assert.deepEqual([low.level, mid.level, high.level], [0, 1, 2]);
    // 低：被写界深度・ブルーム・光の筋・霧・色調なし
    assert.equal(low.dof, false);
    assert.equal(low.bloomLevels, 0);
    assert.equal(low.shafts, false);
    assert.equal(low.fog, false);
    assert.equal(low.grade, GRADE_NONE);
    // 中：色味だけ・ブルーム 1 段・ぼかしなし
    assert.equal(mid.grade, GRADE_TINT);
    assert.equal(mid.bloomLevels, 1);
    assert.equal(mid.dof, false);
    // 高：全部
    assert.equal(high.grade, GRADE_FULL);
    assert.equal(high.bloomLevels, 2);
    assert.equal(high.dof && high.shafts && high.fog && high.rim, true);
    // 光の紙：高は 2 ドットに 1、中・低は 4 ドットに 1
    assert.deepEqual([low.lightDiv, mid.lightDiv, high.lightDiv], [4, 4, 2]);
    // 環境の粒 100 / 220 / 400
    assert.deepEqual([low.ambientParticles, mid.ambientParticles, high.ambientParticles], [100, 220, 400]);
    for (const q of QUALITY_PRESETS) {
        assert.ok(q.bloomLevels === 0 || (q.bloomStrength >= 0.35 && q.bloomStrength <= 0.6));
        assert.ok(q.vfxScale > 0 && q.vfxScale <= 1);
        assert.ok(q.liquidFps >= 2 && q.liquidFps <= 12);
    }
    assert.ok(low.particleCap < mid.particleCap && mid.particleCap < high.particleCap);
});
test('画質の段の番号は切り詰める（古いセーブの変な値でも落ちない）', () => {
    assert.equal(qualityPreset(-3).level, 0);
    assert.equal(qualityPreset(9).level, 2);
    assert.equal(qualityPreset(1.7).level, 1);
    assert.equal(qualityPreset(Number.NaN).level, 2);
});
//# sourceMappingURL=gfx.test.js.map