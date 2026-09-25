/**
 * こざかなのリグ。
 *
 * 水面を泳ぐ小さな魚。下 4 ドットは水に沈む（rig.submerge）ので、
 * 目・背びれ・口など読ませたい所は水面（足元の 4 ドット上）より上に置く。
 * 歩き（泳ぎ）は水面から跳ねて弧を描き、また潜る。
 *
 *   E … 横から。背は明るい空色、腹は骨色、ひれは紅。尾びれは左右に振る（広い ↔ 細い）
 *   S … こちらを向いて頭を水面から出す。左右に張り出した目と丸い口、胸びれが水面で広がる
 *   N … 向こうへ泳ぐ背中。背びれの筋と、水面から跳ね上げた尾びれ
 */
import { mat, registerRig, registerSpecies } from '../rig.js';
import { PixBuf, runs } from '../pixbuf.js';
import { table } from './slime.js';
import { ci } from '../palette.js';
const R = Math.round;
/** 傾けるための下描き（横向きだけ使う） */
const scratch = new PixBuf(24, 24);
/**
 * 横向きの体の輪郭。尾の付け根（0）→ 鼻先（12）の列ごとに、中心の行から上と下へ何行あるか
 */
const TOP = [1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 2, 1];
const BOT = [0, 1, 1, 1, 2, 2, 3, 3, 3, 3, 2, 2, 1];
/** 尾びれ（右端が付け根につながる）。広げた形と、振って細く見える形 */
const TAIL_WIDE = ['hF..', '.hF.', '..FF', '..FF', '.fF.', 'ff..'];
const TAIL_THIN = ['.h..', '.hF.', '..FF', '..FF', '.fF.', '.f..'];
function drawSide(b, p, v) {
    const s = scratch;
    s.clear();
    const cy = 17;
    const nose = 19 + Math.max(-1, Math.min(1, R(p.lean)));
    const tail = nose - 12;
    const map = {
        f: mat(v, 'fin', 2), F: mat(v, 'fin', 3), h: mat(v, 'fin', 4),
    };
    // 尾びれ
    runs(s, tail - 4, cy - 3, p.sway > 0.3 || p.sway < -0.3 ? TAIL_THIN : TAIL_WIDE, map);
    // 背びれ（体の上の真ん中より少し後ろ）
    runs(s, tail + 4, cy - 6, ['.h..', 'hFh.', 'FFFh'], map);
    // 体：背は明るく、真ん中の行は側線、下は腹
    for (let i = 0; i <= 12; i++) {
        const x = tail + i;
        for (let dy = -TOP[i]; dy <= BOT[i]; dy++) {
            let c;
            if (dy <= -2)
                c = mat(v, 'body', 4);
            else if (dy <= 0)
                c = mat(v, 'body', 3);
            else if (dy === 1)
                c = mat(v, 'belly', 4);
            else
                c = mat(v, 'belly', 3);
            s.set(x, cy + dy, c);
        }
    }
    // えら（頭と胴の境の暗い弧）と、背の光の筋
    runs(s, tail + 7, cy - 2, ['.k', 'k.', 'k.'], { k: mat(v, 'body', 2) });
    runs(s, tail + 3, cy - 1, ['hhh'], { h: mat(v, 'body', 4) });
    // 目
    const eyes = p.eyes;
    const em = { e: mat(v, 'eye', 0), g: mat(v, 'glint', 5), w: mat(v, 'belly', 5) };
    if (eyes >= 1.5)
        runs(s, tail + 10, cy - 1, ['ee'], em);
    else if (eyes >= 0.5)
        runs(s, tail + 10, cy - 1, ['ee'], em);
    else
        runs(s, tail + 10, cy - 2, ['ge', 'ee'], em);
    // 口：閉じると鼻先に暗い点、開くと上あごと下あごの間に隙間
    const m = mat(v, 'eye', 1);
    if (p.mouth >= 0.5) {
        s.set(nose, cy, 0);
        s.set(nose - 1, cy, m);
        if (p.mouth >= 1.5) {
            s.set(nose, cy + 1, 0);
            s.set(nose - 1, cy + 1, m);
            s.set(nose + 1, cy - 1, mat(v, 'body', 3));
            s.set(nose + 1, cy + 2, mat(v, 'belly', 3));
        }
    }
    else {
        s.set(nose, cy, m);
        s.set(nose - 1, cy, m);
    }
    // 写す：傾き（tilt は鼻先が上がる量）と上下を付け、足元より下は切る
    const tilt = p.fx;
    const bob = R(p.bob);
    for (let x = 0; x < s.w; x++) {
        const dy = bob + R((tilt * (12 - x)) / 6);
        for (let y = 0; y < s.h; y++) {
            const c = s.px[y * s.w + x];
            if (!c)
                continue;
            const yy = y + dy;
            if (yy > 21 || yy < 2)
                continue;
            b.set(x, yy, c);
        }
    }
}
/** 手前へ泳いでくる：上から見た背と、手前（下）の頭。目は頭の左右、口は鼻先 */
function drawFront(b, p, v) {
    // 被弾で奥（上）へ押し戻される
    const bob = R(p.bob) + Math.min(0, R(p.lean));
    const cx = 12;
    const y0 = Math.max(3, 6 + bob);
    const map = {
        f: mat(v, 'fin', 2), F: mat(v, 'fin', 3), h: mat(v, 'fin', 4),
        '2': mat(v, 'body', 2), '3': mat(v, 'body', 3), '4': mat(v, 'body', 4),
        b: mat(v, 'belly', 4),
        e: mat(v, 'eye', 0), g: mat(v, 'glint', 5), m: mat(v, 'eye', 1), t: mat(v, 'mouth', 3),
    };
    // 奥の尾びれ（振ると細く見える）
    const wide = !(p.sway > 0.3 || p.sway < -0.3);
    runs(b, cx - 3, y0, wide
        ? ['hF...Fh', '.hFFFh.', '...F...']
        : ['.hF.Fh.', '..FFF..', '...F...'], map);
    // 背と頭（下ほど手前で太い）
    runs(b, cx - 3, y0 + 3, [
        '..323..',
        '.23432.',
        '.23443.',
        '2344432',
        '2344432',
        '2344432',
        '3444433',
        '.34443.',
        '..bbb..',
    ], map);
    // 背びれ：背の真ん中の紅い筋
    for (let y = y0 + 4; y <= y0 + 8; y++)
        b.set(cx, y, mat(v, 'fin', y === y0 + 4 ? 4 : 3));
    // 目：頭の左右に張り出す
    const shut = p.eyes >= 0.5;
    runs(b, cx - 4, y0 + 8, shut ? ['.', 'e'] : ['g', 'e'], map);
    runs(b, cx + 4, y0 + 8, shut ? ['.', 'e'] : ['g', 'e'], map);
    // 口（鼻先）
    if (p.mouth >= 1.5)
        runs(b, cx - 1, y0 + 11, ['mtm', '.m.'], map);
    else if (p.mouth >= 0.5)
        runs(b, cx - 1, y0 + 11, ['mmm'], map);
    else
        b.set(cx, y0 + 11, mat(v, 'eye', 1));
    // 胸びれ（頭の後ろ、揺れで上下）
    const up = p.fx2 > 0.5 ? -1 : 0;
    runs(b, cx - 5, y0 + 6 + up, ['.h', 'hF'], map);
    runs(b, cx + 4, y0 + 6 + up, ['.h', 'hF'], map, true);
}
function drawBack(b, p, v) {
    // 前へ跳ぶと奥（上）へ、被弾で手前（下）へ
    const bob = R(p.bob) - Math.max(0, R(p.lean * 0.7)) - Math.min(0, R(p.lean));
    const cx = 12;
    const y0 = 9 + bob;
    const map = {
        f: mat(v, 'fin', 2), F: mat(v, 'fin', 3), h: mat(v, 'fin', 4),
        '2': mat(v, 'body', 2), '3': mat(v, 'body', 3), '4': mat(v, 'body', 4),
    };
    // 奥の頭と背。目は頭の左右に少し見える。背びれは真ん中の紅い筋
    runs(b, cx - 2, y0, [
        '.344.',
        '34443',
        '34443',
        '23443',
        '23343',
        '22332',
        '.232.',
        '..2..',
    ], map);
    b.set(cx - 3, y0 + 1, mat(v, 'eye', 0));
    b.set(cx + 3, y0 + 1, mat(v, 'eye', 0));
    for (let y = y0 + 2; y <= y0 + 6; y++)
        b.set(cx, y, mat(v, 'fin', y === y0 + 2 ? 4 : 3));
    // 尾びれ：水面から跳ね上げる（広い ↔ 細い）
    const wide = !(p.sway > 0.3 || p.sway < -0.3);
    runs(b, cx - 3, y0 + 8, wide
        ? ['...F...', '.hFFFh.', 'hF...Fh']
        : ['...F...', '..FFF..', '.hF.Fh.'], map);
    // 胸びれ（水面）
    const up = p.fx2 > 0.5 ? -1 : 0;
    runs(b, cx - 5, y0 + 4 + up, ['hF', '.f'], map);
    runs(b, cx + 4, y0 + 4 + up, ['hF', '.f'], map, true);
}
const fish = {
    id: 'fish', tier: 'S', dirs: 3, submerge: 4,
    // 背の明るい空色は縁の光で 1 段上がると光る色（空の 5 段目）になるので、そのまま残す
    finish: { keep: new Set([ci('sky', 4)]) },
    anims: {
        // 待機：尾を振り、胸びれを動かし、1 ドット浮き沈みする
        idle: table([
            { sway: 0 },
            { sway: 1, fx2: 1 },
            { sway: 0, bob: -1 },
            { sway: -1, fx2: 1 },
        ], 4, true),
        // 泳ぐ：水面から跳ねて弧を描き、潜る（鼻先が上がる → 平ら → 下がる）
        walk: table([
            { sway: 1 },
            { bob: -3, fx: -1.5, sway: -1, fx2: 1 },
            { bob: -5, fx2: 1 },
            { bob: -2, fx: 1.5, sway: 1 },
        ], 10, true),
        // 噛みつく：沈んで溜める → 伸び上がる → 当たり（前へ跳び口を大きく開く）→ 戻る
        attack: table([
            { bob: 1, fx: 1, eyes: 1 },
            { bob: -2, fx: -1.5, lean: 1, mouth: 1 },
            { bob: -3, lean: 2, mouth: 2, fx2: 1 },
            { bob: -1, lean: 1, mouth: 1 },
            {},
        ], 15, false, 2),
        hurt: table([
            { lean: -2, fx: 1.5, eyes: 2, mouth: 1, sway: 1 },
            { lean: -1, fx: 0.5, eyes: 2 },
        ], 12, false),
        sleep: table([
            { eyes: 2, bob: 1 },
            { eyes: 2, bob: 1, sway: 1 },
        ], 2, true),
    },
    build(b, p, dir, v) {
        if (dir === 'E')
            drawSide(b, p, v);
        else if (dir === 'N')
            drawBack(b, p, v);
        else
            drawFront(b, p, v);
    },
};
registerRig(fish);
registerSpecies({
    fishSmall: {
        rig: 'fish',
        variant: {
            ramps: { body: 'sky', belly: 'bone', fin: 'crimson', eye: 'ink', glint: 'bone', mouth: 'rose' },
        },
    },
});
//# sourceMappingURL=fish.js.map