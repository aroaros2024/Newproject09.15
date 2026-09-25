/**
 * ワナの絵（16×16 ドット）。床の上に置く石の板に、ワナごとの印を載せる。
 *
 * ワナは見つけた時点で名前も分かるので、絵もワナごとに分ける（ガスは色で分ける）。
 * 穴のワナ（落とし穴・転落）だけは板ではなく穴そのものを描く。
 */
import { WHITE, ci } from './palette.js';
import { ellipse, hline, line, rect, runs, vline } from './pixbuf.js';
import { finalize } from './shade.js';
export const TRAP_ICON_SIZE = 16;
/** 石の板（2〜13 の角を落とした四角）。左上が明るく、右下が暗い */
function plate(b, ramp = 'stone') {
    rect(b, 2, 2, 12, 12, ci(ramp, 2));
    hline(b, 3, 2, 10, ci(ramp, 3));
    vline(b, 2, 3, 10, ci(ramp, 3));
    hline(b, 3, 13, 10, ci(ramp, 1));
    vline(b, 13, 3, 10, ci(ramp, 1));
    // 角を落とす
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]])
        b.set(x, y, 0);
    // 内側の溝
    hline(b, 4, 4, 8, ci(ramp, 1));
    vline(b, 4, 5, 7, ci(ramp, 1));
    hline(b, 5, 11, 7, ci(ramp, 3));
    vline(b, 11, 5, 6, ci(ramp, 3));
}
/** 右上向きの矢 */
function arrowMark(b, tip, shaft) {
    line(b, 5, 10, 9, 6, ci(shaft, 4));
    runs(b, 8, 4, ['.aa', 'abb', '.b.'], { a: ci(tip, 5), b: ci(tip, 3) });
    runs(b, 4, 9, ['a..', 'ab.', '.b.'], { a: ci('bone', 5), b: ci('bone', 3) });
}
/** 噴き出し口と色のついた煙（丸い煙の粒を 3 つ重ねる） */
function gas(b, ramp) {
    plate(b);
    for (const x of [5, 8, 11])
        b.set(x - 1, 11, ci('ink', 1));
    runs(b, 3, 4, [
        '....aab...',
        '.aa.abbbc.',
        'abbcbbbbbc',
        'abbbbbcbbc',
        '.bccbbccc.',
        '..cc.cc...',
    ], { a: ci(ramp, 5), b: ci(ramp, 4), c: ci(ramp, 2) });
}
/** 穴（落とし穴・転落） */
function hole(b) {
    ellipse(b, 8, 8, 6, 5, ci('earth', 2));
    ellipse(b, 8, 8, 5, 4, ci('ink', 0));
    ellipse(b, 8, 9, 4, 2, ci('ink', 1));
    hline(b, 4, 3, 8, ci('earth', 3));
}
const TRAPS = {
    arrow: (b) => {
        plate(b);
        arrowMark(b, 'steel', 'earth');
    },
    poisonArrow: (b) => {
        plate(b);
        arrowMark(b, 'moss', 'earth');
        b.set(10, 8, ci('moss', 4));
        b.set(10, 9, ci('moss', 3));
    },
    spike: (b) => {
        hole(b);
        // 底の杭
        for (const x of [6, 8, 10]) {
            b.set(x, 8, ci('stone', 4));
            b.set(x, 9, ci('stone', 3));
        }
    },
    sleepGas: (b) => gas(b, 'indigo'),
    confuseGas: (b) => gas(b, 'rose'),
    blindGas: (b) => gas(b, 'ink'),
    bearTrap: (b) => {
        plate(b);
        // 開いた顎と歯
        ellipse(b, 8, 8, 4, 3, ci('steel', 3), false);
        for (const x of [5, 7, 9, 11])
            b.set(x, 6, ci('steel', 5));
        for (const x of [6, 8, 10])
            b.set(x, 10, ci('steel', 4));
        b.set(8, 8, ci('crimson', 3));
    },
    rustTrap: (b) => {
        plate(b);
        runs(b, 5, 5, [
            '.aab..',
            'abbbc.',
            'abcbbc',
            '.bcc.c',
            '..c...',
            '..c...',
        ], { a: ci('ember', 3), b: ci('earth', 3), c: ci('earth', 2) });
    },
    rotTrap: (b) => {
        plate(b);
        runs(b, 4, 5, [
            '...aa...',
            '.aabbb..',
            'abbbbbc.',
            'bbcbbccc',
            '.c.cc.c.',
        ], { a: ci('moss', 5), b: ci('moss', 4), c: ci('violet', 2) });
    },
    alarm: (b) => {
        plate(b);
        runs(b, 5, 4, [
            '..aa..',
            '.abbc.',
            '.abbc.',
            'abbbbc',
            'cccccc',
            '..cc..',
        ], { a: ci('gold', 5), b: ci('gold', 4), c: ci('gold', 2) });
    },
    summon: (b) => {
        plate(b, 'indigo');
        ellipse(b, 8, 8, 4, 4, ci('violet', 4), false);
        b.set(8, 5, ci('violet', 5));
        b.set(6, 9, ci('violet', 5));
        b.set(10, 9, ci('violet', 5));
        line(b, 8, 5, 6, 9, ci('violet', 3));
        line(b, 8, 5, 10, 9, ci('violet', 3));
        hline(b, 7, 9, 3, ci('violet', 3));
    },
    warp: (b) => {
        plate(b, 'indigo');
        runs(b, 4, 4, [
            '..aaaa..',
            '.a....b.',
            'a..aa..b',
            'a.a..b.b',
            'a.a.bb.b',
            'a..b...b',
            '.b....b.',
            '..bbbb..',
        ], { a: ci('sky', 5), b: ci('sky', 3) });
    },
    spin: (b) => {
        plate(b);
        ellipse(b, 8, 8, 4, 4, ci('steel', 3), false);
        // 回る向きの矢じり
        runs(b, 10, 3, ['a.', 'aa', 'a.'], { a: ci('steel', 5) });
        runs(b, 5, 11, ['.a', 'aa', '.a'], { a: ci('steel', 5) });
        b.set(8, 8, ci('steel', 4));
    },
    mine: (b) => {
        plate(b);
        ellipse(b, 8, 9, 3, 2, ci('steel', 2));
        hline(b, 6, 8, 5, ci('steel', 4));
        b.set(8, 7, ci('crimson', 4));
        b.set(8, 6, ci('ember', 5));
    },
    bigMine: (b) => {
        plate(b);
        ellipse(b, 8, 9, 5, 3, ci('steel', 2));
        hline(b, 5, 7, 7, ci('steel', 4));
        hline(b, 4, 8, 9, ci('steel', 3));
        b.set(6, 6, ci('ember', 5));
        b.set(10, 6, ci('ember', 5));
        b.set(8, 6, ci('crimson', 4));
    },
    slowTrap: (b) => {
        plate(b);
        // 砂時計
        runs(b, 5, 4, [
            'cccccc',
            '.abbc.',
            '..ab..',
            '..bd..',
            '.bddd.',
            'cccccc',
        ], { a: ci('sky', 5), b: ci('sky', 3), c: ci('earth', 3), d: ci('gold', 4) });
    },
    weakenTrap: (b) => {
        plate(b);
        // 石像の頭
        runs(b, 5, 4, [
            '.aabb.',
            'abbbbc',
            'b.bb.c',
            'bbbbbc',
            '.bccc.',
            'cccccc',
        ], { a: ci('stone', 5), b: ci('stone', 4), c: ci('stone', 3) });
    },
    curseTrap: (b) => {
        plate(b, 'indigo');
        runs(b, 5, 4, [
            'a....a',
            '.a..a.',
            '..bb..',
            '..bb..',
            '.b..b.',
            'b....b',
        ], { a: ci('violet', 5), b: ci('violet', 3) });
    },
    hungerTrap: (b) => {
        plate(b);
        // 空の椀
        runs(b, 4, 6, [
            'aaaaaaaa',
            'bccccccb',
            '.bbbbbb.',
            '..bbbb..',
            '...dd...',
        ], { a: ci('crimson', 4), b: ci('crimson', 3), c: ci('ink', 1), d: ci('crimson', 2) });
    },
    sealTrap: (b) => {
        plate(b);
        // 札
        rect(b, 6, 4, 4, 8, ci('bone', 4));
        vline(b, 6, 4, 8, ci('bone', 5));
        vline(b, 9, 4, 8, ci('bone', 3));
        for (const y of [6, 8])
            hline(b, 7, y, 2, ci('crimson', 3));
        b.set(7, 10, ci('crimson', 4));
    },
    monsterHouseTrap: (b) => {
        plate(b, 'crimson');
        // 角の生えた顔
        runs(b, 4, 4, [
            'a......a',
            '.a.bb.a.',
            '..bbbb..',
            '.bcbbcb.',
            '.bbbbbb.',
            '..bddb..',
        ], { a: ci('bone', 4), b: ci('crimson', 3), c: ci('gold', 5), d: ci('ink', 1) });
    },
    itemLossTrap: (b) => {
        hole(b);
        // 下向きの矢印
        vline(b, 8, 5, 4, ci('bone', 4));
        hline(b, 6, 8, 5, ci('bone', 3));
        hline(b, 7, 9, 3, ci('bone', 3));
        b.set(8, 10, ci('bone', 3));
    },
    lavaTrap: (b) => {
        plate(b, 'earth');
        // ひび割れから溶岩が覗く
        line(b, 4, 6, 8, 8, ci('ember', 4));
        line(b, 8, 8, 11, 5, ci('ember', 3));
        line(b, 8, 8, 9, 11, ci('ember', 4));
        b.set(8, 8, ci('ember', 5));
        b.set(7, 8, WHITE);
    },
    waterTrap: (b) => {
        plate(b, 'water');
        ellipse(b, 8, 8, 4, 2, ci('water', 5), false);
        ellipse(b, 8, 8, 2, 1, ci('sky', 5), false);
        b.set(8, 5, ci('sky', 4));
        b.set(7, 4, ci('sky', 5));
    },
};
/** ワナの絵を描く（鍵はワナの id）。知らない id なら false */
export function buildTrapIcon(id, out, finish = true) {
    const draw = TRAPS[id];
    if (!draw)
        return false;
    out.clear();
    draw(out);
    if (finish)
        finalize(out);
    return true;
}
export const hasTrapIcon = (id) => id in TRAPS;
export const allTrapIconIds = () => Object.keys(TRAPS);
//# sourceMappingURL=traps.js.map