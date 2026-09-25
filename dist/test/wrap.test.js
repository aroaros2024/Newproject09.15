/**
 * 文の折り返し（禁則）。句読点で行が始まらない・開き括弧で行が終わらない・語の間で折る。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText } from '../src/ui/draw.js';
/** 1 文字 = 10px として測る偽の描き先 */
const fake = {
    font: '',
    save() { },
    restore() { },
    measureText(s) {
        return { width: [...s].length * 10 };
    },
};
test('句読点は前の行にぶら下げる', () => {
    const lines = wrapText(fake, 'あいうえおかきくけこ。さしす', 100);
    assert.equal(lines[0], 'あいうえおかきくけこ。');
    assert.equal(lines[1], 'さしす');
    for (const l of wrapText(fake, 'HP が 減ったら、敵の いない 所で 休む。敵が いると 休めない。', 90)) {
        assert.ok(!/^[、。」）]/.test(l), `行頭が句読点: ${l}`);
    }
});
test('語の間の空白で折る', () => {
    const lines = wrapText(fake, 'あいう えおか きくけ', 80);
    assert.deepEqual(lines, ['あいう えおか', 'きくけ']);
});
test('開き括弧で行を終えない', () => {
    const lines = wrapText(fake, 'あいうえおかきく「けこ」', 90);
    for (const l of lines)
        assert.ok(!l.endsWith('「'), `行末が開き括弧: ${l}`);
});
test('改行はそのまま', () => {
    assert.deepEqual(wrapText(fake, 'あ\nい', 100), ['あ', 'い']);
});
//# sourceMappingURL=wrap.test.js.map