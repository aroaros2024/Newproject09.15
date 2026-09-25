/**
 * ネズミ（のらネズミ・どろネズミ・オオネズミ・ネズミの長） のリグ。
 *
 * 小さいネズミ（S：rat）と大きいネズミ（M：ratM）は同じ組み立て
 * （尾 → 奥の脚 → 胴 → 手前の脚 → 頭 → 耳）で、部品の絵（RatKit）だけが違う。
 * 部品は手描きの点の並び（runs）で、姿勢に合わせてずらし、伸び縮みは
 * 「真ん中の列・行を増やす／減らす」で作る（手描きの形のまま伸びる）。
 *
 * 段階の差：のら（灰茶）→ どろ（茶・下半分が泥）→ オオ（大きい・傷・出っ歯・赤い目）
 * → 長（白い老ネズミ・赤いマント・金の小さな冠・杖のように立てた尾）。
 */
import { mat, registerRig, registerSpecies, } from '../rig.js';
import { hurt, keyed } from '../anim.js';
import { line, runs } from '../pixbuf.js';
import { WHITE, ci } from '../palette.js';
/** 左半分（中央の列を含む）から左右対称の絵を作る */
export function sym(half) {
    return half.map((row) => row + [...row.slice(0, -1)].reverse().join(''));
}
/** 左右反転 */
export function flipT(t) {
    return t.map((row) => [...row].reverse().join(''));
}
/** 列 col を n 回増やす（n < 0 なら消す）。手描きの形のまま伸び縮みさせる */
export function widen(t, col, n) {
    if (n === 0)
        return [...t];
    return t.map((row) => {
        if (col >= row.length)
            return row;
        if (n > 0)
            return row.slice(0, col) + row[col].repeat(n + 1) + row.slice(col + 1);
        return row.slice(0, col) + row.slice(col - n);
    });
}
/** 行 row を n 回増やす（n < 0 なら消す） */
export function heighten(t, row, n) {
    if (n === 0 || row >= t.length)
        return [...t];
    if (n > 0)
        return [...t.slice(0, row), ...Array(n + 1).fill(t[row]), ...t.slice(row + 1)];
    return [...t.slice(0, row), ...t.slice(row - n)];
}
/** 材質の 1〜5 段を文字に割り当てる。chars は「深い影 影 地 明 最明」の順、'_' は使わない */
export function shades(v, name, chars) {
    const out = {};
    for (let i = 0; i < chars.length; i++)
        if (chars[i] !== '_')
            out[chars[i]] = mat(v, name, i + 1);
    return out;
}
/** 絵の幅 */
export const widthOf = (t) => t.reduce((m, row) => Math.max(m, row.length), 0);
/** 塗ってある所にだけ載せる（泥・傷・マント・模様） */
export function over(b, x, y, rows, map) {
    for (let j = 0; j < rows.length; j++) {
        const row = rows[j];
        for (let i = 0; i < row.length; i++) {
            const c = map[row[i]];
            if (c !== undefined)
                b.paint(x + i, y + j, c);
        }
    }
}
/** 折れ線（点の列）。太さ 2 のところは下にもう 1 列足す */
export function polyline(b, x, y, pts, c, thick = 0) {
    for (let i = 1; i < pts.length; i++) {
        line(b, x + pts[i - 1][0], y + pts[i - 1][1], x + pts[i][0], y + pts[i][1], c);
        if (i <= thick)
            line(b, x + pts[i - 1][0], y + pts[i - 1][1] + 1, x + pts[i][0], y + pts[i][1] + 1, c);
    }
}
export const rnd = Math.round;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
// ---------------------------------------------------------------------------
// 色
// ---------------------------------------------------------------------------
/** 飾りのビット */
const F_MUD = 1;
const F_SCAR = 2;
const F_KING = 4;
function palOf(v) {
    const eyeStep = v.params?.eyeStep ?? 0;
    const mud = ((v.flags ?? 0) & F_MUD) !== 0;
    // 毛は furShift だけ明るくずらせる（暗い床の上で読めるように）
    const fs = v.params?.furShift ?? 0;
    const map = {
        c: mat(v, 'fur', 1 + fs),
        b: mat(v, 'fur', 2 + fs),
        a: mat(v, 'fur', 3 + fs),
        h: mat(v, 'fur', 4 + fs),
        ...shades(v, 'belly', '_uvwW'),
        ...shades(v, 'pink', 'rqpP_'),
        ...shades(v, 'mud', 'xyz__'),
        ...shades(v, 'cape', 'FDCI_'),
        ...shades(v, 'crown', '_gGk_'),
        e: mat(v, 'eye', eyeStep),
        E: WHITE,
        t: mat(v, 'teeth', 5),
        T: mat(v, 'teeth', 3),
        m: ci('crimson', 1),
        s: mat(v, 'scar', 4),
        S: mat(v, 'scar', 3),
    };
    // 足の裏：泥のネズミは泥だらけ
    map.f = mud ? map.y : map.p;
    map.g = mud ? map.x : map.q;
    return map;
}
const NONE = { t: [], x: 0, y: 0 };
// ---------------------------------------------------------------------------
// S の大きさ（のらネズミ・どろネズミ）
// ---------------------------------------------------------------------------
const KIT_S = {
    ax: 12, ay: 21, legLen: 2, tailThick: 0, reach: 1,
    E: {
        body: {
            x: -8, y: -9,
            t: [
                '...aaaa....',
                '.aahhhhaa..',
                'ahhhhhaaaa.',
                'ahhhaaaaaaa',
                'ahaaaaaaaab',
                'aaaaaaaaabb',
                '.aaaaaaabb.',
                '..bbbbbbb..',
            ],
        },
        stretch: 5,
        mud: [
            '...........',
            '....y......',
            '...yy......',
            '...........',
            'y........y.',
            'yy.y..yyyy.',
            'yyyyyyyyyy.',
            'xxxxxxxxxx.',
        ],
        scar: [], cape: [],
        head: {
            x: 8, y: 2,
            t: [
                '..aaaa...',
                '.aaaaaaa.',
                'aaaaaaaaq',
                'abbbbbb..',
            ],
        },
        headOpen: [
            '..aaaa...',
            '.aaaaaaa.',
            'aaaaaaaaq',
            'abbbbmmt.',
            '.bbbbbt..',
        ],
        headScar: [],
        eyes: [[4, 1]],
        ears: [{ x: 0, y: -3, t: ['.pp.', 'pPpq', 'ppqa'] }],
        teeth: NONE, crown: NONE, brows: NONE, robe: NONE,
        legsFar: [{ x: 2, y: 0, t: ['b', 'g'] }, { x: 8, y: 0, t: ['b', 'g'] }],
        legsNear: [{ x: 3, y: 0, t: ['ab', 'ff'] }, { x: 9, y: 0, t: ['a', 'f'] }],
        tail: [[1, 6], [0, 6], [-1, 6], [-2, 5], [-2, 3]],
        staff: [],
    },
    S: {
        body: {
            x: -6, y: -12,
            t: [
                '....aaaaa....',
                '..aahhhhaaa..',
                '.ahhhhhaaaab.',
                'ahhhaaaaaaabb',
                'ahaaaaaaaaabb',
                'aaaaaaaaaabbb',
                'baaaaaaaaabbb',
                '.bbbbbbbbbbb.',
            ],
        },
        stretch: 6,
        mud: [
            '.............',
            '.......yy....',
            '...y...y.....',
            '.............',
            '.............',
            'y..........yy',
            'yyy......yyyy',
            'xxxxxxxxxxxxx',
        ],
        scar: [], cape: [],
        head: {
            x: 2, y: 4,
            t: [
                '..hhaaa..',
                '.hhaaaaa.',
                'haaaaaaab',
                'aaaaaaaab',
                'aaaaaaaab',
                '.aavwvab.',
                '..avwvb..',
                '...qpq...',
            ],
        },
        headOpen: [
            '..hhaaa..',
            '.hhaaaaa.',
            'haaaaaaab',
            'aaaaaaaab',
            'aaavqvaab',
            '.atmmmtb.',
            '..ammmb..',
            '...bbb...',
        ],
        headScar: [],
        eyes: [[1, 3], [6, 3]],
        ears: [
            { x: -3, y: -3, t: ['.aa.', 'apPa', 'appb', '.bb.'] },
            { x: 8, y: -3, t: ['.aa.', 'apPa', 'appb', '.bb.'] },
        ],
        teeth: NONE, crown: NONE, brows: NONE, robe: NONE,
        legsFar: [],
        legsNear: [
            { x: 3, y: -1, t: ['bb', 'ff'] },
            { x: 8, y: -1, t: ['bb', 'gg'] },
        ],
        tail: [[12, 7], [13, 7], [14, 6], [14, 5], [14, 4]],
        staff: [],
    },
    N: {
        body: {
            x: -6, y: -11,
            t: [
                '...aaaaaaa...',
                '..ahhhhaaaa..',
                '.ahhhhaaaaab.',
                '.ahhhaaaaaab.',
                '.ahhaaaaaaab.',
                'ahhaaaaaaaabb',
                'ahaaaaaaaaabb',
                'aaaaaabaaaabb',
                '.aaaabbbaabb.',
                '..bbbb.bbbb..',
            ],
        },
        stretch: 5,
        mud: [
            '.............',
            '.............',
            '.......y.....',
            '..y...yy.....',
            '.............',
            '.............',
            'y..y.....y..y',
            'yyyyy..yyyyyy',
            'yyyyyyyyyyyyy',
            'xxxxxxxxxxxxx',
        ],
        scar: [], cape: [],
        head: {
            x: 3, y: -3,
            t: [
                '..aaa..',
                '.ahhaa.',
                'ahhaaab',
                'aaaaabb',
                '.aaabb.',
            ],
        },
        headOpen: [],
        headScar: [],
        eyes: [],
        ears: [
            { x: -2, y: -1, t: ['.qq.', 'qppq', '.qq.'] },
            { x: 5, y: -1, t: ['.qq.', 'qppq', '.qq.'] },
        ],
        teeth: NONE, crown: NONE, brows: NONE, robe: NONE,
        legsFar: [],
        legsNear: [
            { x: 2, y: -1, t: ['bb', 'ff'] },
            { x: 8, y: -1, t: ['bb', 'gg'] },
        ],
        tail: [[7, 9], [8, 10], [11, 10], [13, 9]],
        staff: [],
    },
};
// ---------------------------------------------------------------------------
// M の大きさ（オオネズミ・ネズミの長）
// ---------------------------------------------------------------------------
const KIT_M = {
    ax: 16, ay: 37, legLen: 3, tailThick: 2, reach: 2,
    E: {
        body: {
            x: -11, y: -17,
            t: [
                '........aaaaa....',
                '......aahhhhhaa..',
                '....aahhhhhhhhaa.',
                '...ahhhhhhhhhaaa.',
                '..ahhhhhhhhaaaaaa',
                '.ahhhhhhaaaaaaaaa',
                '.ahhhhaaaaaaaaaaa',
                'ahhhaaaaaaaaaaaaa',
                'ahhaaaaaaaaaaaaaa',
                'ahaaaaaaaaaaaaaab',
                'aaaaaaaabaaaaaabb',
                'aaaaaaabaaaaaabbb',
                'baaaaabaaaaaabbb.',
                '.bbaaabbaaabbbb..',
                '..bbbbbbbbbbbb...',
            ],
        },
        stretch: 7,
        mud: [],
        scar: [
            '.................',
            '.................',
            '............s.s..',
            '...........s.s...',
            '..........s.s....',
        ],
        cape: [
            '........CCCCC....',
            '......CCIIIICC...',
            '....CCCIIICCCCG..',
            '...CCCICCCCCCCG..',
            '..CCCCCCCCCCCCGk.',
            '.DCCCCCCCCCCCDG..',
            '.DDCCCCCCCCCDDG..',
            '.GDDCCCCCCCDDG...',
            '..GGDDCCCDDGG....',
            '....GGDDDGG......',
            '......GGG........',
        ],
        head: {
            x: 11, y: 5,
            t: [
                '..aaaaa....',
                '.aaaaaaaa..',
                'aaaaaaaaaa.',
                'aaaaaaaaaaa',
                'aaaaaaaaaaaq',
                'abbbbbbbbbb.',
                '.bbbbbbbb...',
                '..bbbb......',
            ],
        },
        headOpen: [
            '..aaaaa.....',
            '.aaaaaaaa...',
            'aaaaaaaaaa..',
            'aaaaaaaaaaa.',
            'aaaaaaaaaaaq',
            'abbbbbbmtt..',
            '.bbbbbmmm...',
            '..bbbbbt....',
            '...bbbb.....',
        ],
        headScar: [
            '...........',
            '....s......',
            '.....s.....',
        ],
        eyes: [[6, 1]],
        ears: [{ x: 1, y: -4, t: ['.ppp.', 'pPPpp', 'pPppq', 'ppqqq', '.pqa.'] }],
        teeth: { x: 9, y: 5, t: ['tT', 't.'] },
        crown: { x: 2, y: -5, t: ['k.k.k', 'kGkGg', 'GGGgg'] },
        brows: { x: 5, y: 0, t: ['WWw'] },
        robe: NONE,
        legsFar: [
            { x: 3, y: 0, t: ['cb', '.c', '.gg'] },
            { x: 12, y: 0, t: ['b', 'c', 'gg'] },
        ],
        legsNear: [
            { x: 4, y: 0, t: ['aab', '.ab', '.fff'] },
            { x: 13, y: 0, t: ['ab', 'ab', 'fff'] },
        ],
        tail: [[1, 12], [0, 12], [-1, 11], [-2, 10], [-3, 8], [-3, 6], [-2, 5]],
        staff: [[2, 9], [0, 8], [-2, 6], [-2, -6], [-1, -8], [1, -8], [2, -7], [1, -6]],
    },
    S: {
        body: {
            x: -9, y: -22,
            t: [
                '......aaaaaaa......',
                '....aahhhhhhaaa....',
                '...ahhhhhhhhaaaa...',
                '..ahhhhhhhaaaaaaa..',
                '.ahhhhhhaaaaaaaaab.',
                '.ahhhaaaaaaaaaaaab.',
                'ahhaaaaaaaaaaaaaabb',
                'ahaaaaaaaaaaaaaaabb',
                'aaaaaaaaaaaaaaaabbb',
                'baaaaaaaaaaaaaaabbb',
                'bbaaaaaaaaaaaaabbbb',
                '.bbbbbbbbbbbbbbbbb.',
            ],
        },
        stretch: 9,
        mud: [],
        scar: [
            '...................',
            '...................',
            '..............s....',
            '...............s...',
            '................s..',
        ],
        cape: [],
        head: {
            x: 3, y: 9,
            t: [
                '....hhaaa....',
                '...hhhaaaa...',
                '..hhhaaaaaa..',
                '.hhaaaaaaaab.',
                '.haaaaaaaaab.',
                'haaaaaaaaaabb',
                'aaaaaaaaaaabb',
                '.aaaawwvaabb.',
                '..aaawwvabb..',
                '...aawvabb...',
                '....awvab....',
                '.....qpq.....',
            ],
        },
        headOpen: [
            '....hhaaa....',
            '...hhhaaaa...',
            '..hhhaaaaaa..',
            '.hhaaaaaaaab.',
            '.haaaaaaaaab.',
            'haaaaaaaaaabb',
            'aaaaavqvaaabb',
            '.aaatmmmtabb.',
            '..aatmmmtbb..',
            '...ammmmmb...',
            '....btmtb....',
            '.....bbb.....',
        ],
        headScar: [
            '.............',
            '.............',
            '.........s...',
            '..........s..',
            '.............',
            '.............',
            '..........s..',
            '...........s.',
        ],
        eyes: [[2, 4], [9, 4]],
        ears: [
            { x: -3, y: -4, t: ['.aaaa.', 'apPPpa', 'apPppb', 'apppqb', 'abqqb.', '.bbb..'] },
            { x: 10, y: -4, t: ['.aaaa.', 'apPPpa', 'apPppb', 'apppqb', '.bqqbb', '..bbb.'] },
        ],
        teeth: { x: 6, y: 12, t: ['tT'] },
        crown: { x: 3, y: -3, t: ['k..k..k', 'kGkCkGg', 'GGGGGgg'] },
        brows: { x: 1, y: 3, t: ['WWW....www'] },
        robe: {
            x: -3, y: 4,
            t: [
                'IC...............CD',
                'ICC.............CCD',
                'ICCG...........GCCD',
                'CCCG...........GCDD',
                'CCCCG.........GCCDD',
                'DCCCG.........GCDDD',
                'DCCCCG.......GCCDDD',
                '.DDDDG.......GDDDD.',
            ],
        },
        legsFar: [],
        legsNear: [
            { x: 3, y: 0, t: ['aab', 'bbb', 'fff'] },
            { x: 13, y: 0, t: ['abb', 'bbb', 'ggg'] },
        ],
        tail: [[18, 9], [19, 9], [20, 8], [21, 7], [21, 4], [20, 3]],
        staff: [[17, 7], [19, 6], [20, 4], [20, -4], [19, -6], [17, -6], [16, -5], [17, -4]],
    },
    N: {
        body: {
            x: -9, y: -17,
            t: [
                '.....aaaaaaaaa.....',
                '...aahhhhhaaaaaa...',
                '..ahhhhhhaaaaaaaa..',
                '.ahhhhhaaaaaaaaaab.',
                '.ahhhhaaaaaaaaaaab.',
                'ahhhaaaaaaaaaaaaabb',
                'ahhaaaaaaaaaaaaaabb',
                'ahhaaaaaaaaaaaaaabb',
                'ahaaaaaaaaaaaaaaabb',
                'aaaaaaaaaaaaaaaabbb',
                'aaaaaaaaaaaaaaaabbb',
                'aaaaaaaabaaaaaaabbb',
                'baaaaaabbbaaaaabbb.',
                '.baaaabb.bbaaabbb..',
                '..bbbbb...bbbbbb...',
            ],
        },
        stretch: 6,
        mud: [],
        scar: [
            '...................',
            '...................',
            '...........s.......',
            '............s......',
            '.............s.....',
            '..............s....',
        ],
        cape: [
            '.....GGGGGGGGG.....',
            '...GGCCCCCCCCGG...',
            '..GCIIIICCCCCCCG..',
            '.CCIIICCCCCCCCCCD.',
            '.CCIICCCCCCCCCCCD.',
            'CCCCCCCCCCCCCCCCDD',
            'CCCCCCCCCCCCCCCCDD',
            'CCCCCCCCCCCCCCCCDD',
            'DCCCCCCCCCCCCCCDDD',
            'DDCCCCCCCCCCCCDDD.',
            '.DDDDCCCCCCDDDD...',
            '....FDDDDDDF......',
        ],
        head: {
            x: 4, y: -5,
            t: [
                '...aaaaa...',
                '.aahhhhaaa.',
                'ahhhhaaaaab',
                'ahhaaaaaabb',
                'aaaaaaabbbb',
                '.aaaaaabbb.',
                '..aaabbb...',
            ],
        },
        headOpen: [],
        headScar: [],
        eyes: [],
        ears: [
            { x: -3, y: -2, t: ['.qqq.', 'qpppq', 'qpppq', '.qqq.'] },
            { x: 9, y: -2, t: ['.qqq.', 'qpppq', 'qpppq', '.qqq.'] },
        ],
        teeth: NONE,
        crown: { x: 2, y: -3, t: ['k..k..k', 'kGkGkGg', 'GGGGGgg'] },
        brows: NONE,
        robe: NONE,
        legsFar: [],
        legsNear: [
            { x: 2, y: 0, t: ['bbb', 'bbb', 'fff'] },
            { x: 14, y: 0, t: ['bbb', 'bbb', 'ggg'] },
        ],
        tail: [[9, 13], [10, 15], [11, 16], [15, 16], [17, 15], [18, 13]],
        staff: [[11, 13], [14, 12], [18, 10], [20, 8], [20, -2], [19, -4], [17, -4], [16, -3], [17, -2]],
    },
};
// ---------------------------------------------------------------------------
// 組み立て（S と M で共通）
// ---------------------------------------------------------------------------
/** 目。0：2×2 の黒目と光、1：細目（横 2）、2：閉じ（明るいまぶたの下に暗いまつげの線） */
function eye2(b, x, y, eyes, map) {
    const e = rnd(eyes);
    if (e <= 0)
        runs(b, x, y, ['Ee', 'ee'], map);
    else if (e === 1)
        runs(b, x, y + 1, ['Ee'], map);
    else
        runs(b, x, y, ['hh', 'ee'], map);
}
function put(b, x, y, part, map) {
    if (part.t.length)
        runs(b, x + part.x, y + part.y, part.t, map);
}
function buildRat(K, b, p, dir, v) {
    const map = palOf(v);
    const flags = v.flags ?? 0;
    const V = K[dir === 'N' ? 'N' : dir === 'S' ? 'S' : 'E'];
    const bob = rnd(p.bob);
    const head = rnd(p.head) - bob;
    const sw = rnd(p.sway);
    const sq = clamp(rnd(p.sqX), -1, 1);
    const legF = clamp(rnd(p.legL), -1, 1);
    const legH = clamp(rnd(p.legR), -1, 1);
    const mouth = rnd(p.mouth);
    const curl = p.fx > 0.5;
    const tailC = map.p;
    // 眠り：脚をたたんで胴を床へ下ろし、1 行つぶす
    const drop = curl ? K.legLen : 0;
    const bodyT = curl
        ? (dir === 'N' ? heighten(V.body.t, V.stretch, -1) : heighten(V.body.t, 3, -1))
        : dir === 'N' ? heighten(V.body.t, V.stretch, sq) : widen(V.body.t, V.stretch, sq);
    const pad = (t) => (t.length >= V.body.t.length ? t
        : [...t, ...Array(V.body.t.length - t.length).fill('')]);
    const lay = (t) => (t.length === 0 ? [] : curl
        ? (dir === 'N' ? heighten(pad(t), V.stretch, -1) : heighten(pad(t), 3, -1))
        : dir === 'N' ? heighten(pad(t), V.stretch, sq) : widen(t, V.stretch, sq));
    const grow = sq > 0 && dir !== 'N' ? sq : 0;
    const tall = dir === 'N' ? Math.max(0, sq) : 0;
    let lean;
    let bx;
    let by;
    let hx;
    let hy;
    if (dir === 'E') {
        // 横向き：尻と尾は動かさず、伸び縮みは前（頭）の側で起こす
        lean = clamp(rnd(p.lean), 0, K.reach - Math.max(0, sq));
        bx = K.ax + V.body.x + lean;
        by = K.ay + V.body.y + bob + drop + (curl ? 1 : 0);
        hx = bx + V.head.x + sq;
        hy = by + V.head.y + head + (curl ? K.legLen - 1 : 0);
    }
    else if (dir === 'S') {
        lean = clamp(rnd(p.lean), -2, 1);
        bx = K.ax + V.body.x - grow;
        by = K.ay + V.body.y + bob - Math.max(0, -lean) + drop;
        hx = K.ax + V.body.x + V.head.x;
        hy = K.ay + V.body.y + V.head.y + bob + head + lean + (curl ? 1 : 0);
    }
    else {
        lean = clamp(rnd(p.lean), -1, 2);
        bx = K.ax + V.body.x;
        by = K.ay + V.body.y + bob - tall + drop + (curl ? 1 : 0);
        hx = bx + V.head.x;
        hy = K.ay + V.body.y + V.head.y + bob + head - lean + (curl ? 2 : 0);
    }
    const footY = K.ay;
    // 頭は足元の行より下へ出さない
    const headRows = mouth >= 2 && V.headOpen.length ? V.headOpen.length : V.head.t.length;
    if (dir !== 'N')
        hy = Math.min(hy, footY - headRows + 1);
    const staff = (flags & F_KING) !== 0 && V.staff.length > 0;
    // 尾。横・手前向きは胴の奥、奥向きは胴の手前（床の上を手前へ流れる）
    const drawTail = () => {
        const pts = staff ? V.staff : V.tail;
        const last = pts.length - 1;
        const tip = staff ? pts[last] : dir === 'N'
            ? [pts[last][0] + sw, pts[last][1]]
            : [pts[last][0], pts[last][1] + sw];
        const ox = dir === 'S' ? bx + grow : bx;
        const oy = dir === 'N' ? K.ay + V.body.y - tall + (staff ? bob : 0) : by;
        polyline(b, ox, oy, [...pts.slice(0, last), tip], tailC, K.tailThick);
        if (staff) {
            // 杖の尾に金の輪
            const [rx, ry] = pts[3];
            b.set(ox + rx, oy + ry + 2, map.G);
            b.set(ox + rx, oy + ry + 3, map.g);
        }
    };
    if (dir !== 'N')
        drawTail();
    // 脚：跳ねている間（fx2）は足ごと浮く。胴だけが上がる（息・溜め）ときは脚を伸ばして床に残す
    const air = Math.max(0, rnd(p.fx2));
    const stretchLeg = (t) => (dir !== 'S' ? heighten(t, 0, Math.max(0, -bob - air)) : t);
    const legTop = (t) => footY - air - t.length + 1;
    // 奥の脚
    if (!curl) {
        V.legsFar.forEach((leg, i) => {
            const dx = i === 0 ? -legH : -legF;
            const t = stretchLeg(leg.t);
            runs(b, bx + leg.x + dx + (i === 1 ? sq : 0), legTop(t), t, map);
        });
    }
    // 奥向き：耳と頭は胴の奥
    if (dir === 'N') {
        for (const ear of V.ears)
            put(b, hx, hy, ear, map);
        runs(b, hx, hy, V.head.t, map);
        if (flags & F_KING)
            put(b, hx, hy, V.crown, map);
    }
    // 胴
    runs(b, bx, by, bodyT, map);
    if (flags & F_MUD)
        over(b, bx, by, lay(V.mud), map);
    if (flags & F_SCAR)
        over(b, bx, by, lay(V.scar), map);
    if (flags & F_KING)
        over(b, bx, by, lay(V.cape), map);
    // 手前向き：耳は背中の上・顔の奥。噛みつく瞬間は耳を後ろへ倒す
    if (dir === 'S') {
        const flat = mouth >= 2 ? 1 : 0;
        V.ears.forEach((ear, i) => put(b, hx + (i === 0 ? -flat : flat), hy - flat, ear, map));
        if (flags & F_KING)
            put(b, hx, hy, V.robe, map);
    }
    // 手前の脚
    if (!curl) {
        V.legsNear.forEach((leg, i) => {
            let dx = 0;
            let dy = 0;
            if (dir === 'E')
                dx = i === 0 ? legH : legF + sq;
            else {
                // 手前・奥向きは左右の足を交互に上げる
                const lift = i === 0 ? legF : -legF;
                dy = lift > 0 ? -1 : 0;
                dx = dir === 'S' ? (i === 0 ? -Math.max(0, sq) : Math.max(0, sq)) : 0;
            }
            const t = stretchLeg(leg.t);
            runs(b, bx + (dir === 'S' ? grow : 0) + leg.x + dx, legTop(t) + dy, t, map);
        });
    }
    if (dir === 'N') {
        drawTail();
        return;
    }
    // 頭
    runs(b, hx, hy, mouth >= 2 ? V.headOpen : V.head.t, map);
    if (flags & F_SCAR)
        over(b, hx, hy, V.headScar, map);
    for (const [ex, ey] of V.eyes)
        eye2(b, hx + ex, hy + ey, p.eyes, map);
    if (flags & F_KING)
        put(b, hx, hy, V.brows, map);
    if (mouth < 2 && (flags & (F_SCAR | F_KING)))
        put(b, hx, hy, V.teeth, map);
    if (dir === 'E') {
        const flat = mouth >= 2 ? 1 : 0;
        for (const ear of V.ears)
            put(b, hx - flat, hy + flat, ear, map);
    }
    if (flags & F_KING)
        put(b, hx, hy - (mouth >= 2 && dir === 'S' ? 1 : 0), V.crown, map);
}
// ---------------------------------------------------------------------------
// 動き
// ---------------------------------------------------------------------------
/** 待機：胴が 1 ドット上下し、尾の先が揺れる */
const ratIdle = {
    frames: 4, fps: 4, loop: true,
    pose(i, _n, out) {
        out.bob = i === 1 ? -1 : 0;
        out.head = out.bob;
        out.sway = [0, -1, 0, 1][i];
    },
};
/** 小さいネズミの走り：縮む → 伸びて跳ぶ → 着地（跳ねる 4 コマ） */
const ratHop = {
    frames: 4, fps: 10, loop: true,
    pose(i, _n, out) {
        out.bob = [0, -2, -1, 0][i];
        out.fx2 = -out.bob;
        out.sqX = [-1, 1, 0, 0][i];
        out.legL = [0, 1, 0, -1][i];
        out.legR = [0, -1, 0, 1][i];
        out.sway = [1, 0, -1, 0][i];
    },
};
/** 大きいネズミの走り（6 コマ）：前足と後ろ足が交互に地面を蹴る */
const ratTrot = {
    frames: 6, fps: 10, loop: true,
    pose(i, n, out) {
        const t = i / n;
        const s = Math.sin(t * Math.PI * 2);
        out.legL = s;
        out.legR = -s;
        out.bob = Math.abs(s) > 0.5 ? -1 : 0;
        out.sqX = i === 1 || i === 4 ? 1 : 0;
        out.sway = Math.round(Math.cos(t * Math.PI * 2));
    },
};
/** 噛みつき：身を引いて溜める → 伸びて噛む（当たり）→ 戻る */
const ratBite = {
    frames: 5, fps: 15, loop: false, strike: 2,
    pose(i, n, out) {
        const t = i / (n - 1);
        out.lean = keyed([[0, 0], [0.25, -1], [0.5, 2], [0.75, 1], [1, 0]], t);
        out.sqX = keyed([[0, 0], [0.25, -1], [0.5, 1], [0.75, 1], [1, 0]], t);
        out.head = keyed([[0, 0], [0.25, -2], [0.5, 1], [0.75, 0], [1, 0]], t);
        out.legL = i === 2 ? 1 : 0;
        out.mouth = i === 2 ? 2 : i === 3 ? 1 : 0;
        out.eyes = i === 2 ? 1 : 0;
        out.sway = i === 1 ? -1 : i === 2 ? 1 : 0;
    },
};
/** 眠り：脚をたたんで丸くなり、ゆっくり息をする */
const ratSleep = {
    frames: 2, fps: 2, loop: true,
    pose(i, _n, out) {
        out.fx = 1;
        out.eyes = 2;
        out.bob = i === 0 ? 0 : -1;
        out.head = 0;
        out.sway = 0;
    },
};
const ratS = {
    id: 'rat', tier: 'S', dirs: 3,
    anims: { idle: ratIdle, walk: ratHop, attack: ratBite, hurt: hurt(), sleep: ratSleep },
    build: (b, p, dir, v) => buildRat(KIT_S, b, p, dir, v),
};
const ratM = {
    id: 'ratM', tier: 'M', dirs: 3,
    anims: { idle: ratIdle, walk: ratTrot, attack: ratBite, hurt: hurt(), sleep: ratSleep },
    build: (b, p, dir, v) => buildRat(KIT_M, b, p, dir, v),
};
registerRig(ratS);
registerRig(ratM);
registerSpecies({
    ratField: {
        rig: 'rat',
        variant: {
            ramps: { fur: 'stone', belly: 'bone', pink: 'rose', eye: 'ink', teeth: 'bone' },
            params: { furShift: 1 },
        },
    },
    ratMud: {
        rig: 'rat',
        variant: {
            ramps: { fur: 'earth', belly: 'stone', pink: 'skin', eye: 'ink', teeth: 'bone', mud: 'stone' },
            flags: F_MUD,
        },
    },
    ratGiant: {
        rig: 'ratM',
        variant: {
            ramps: { fur: 'steel', belly: 'steel', pink: 'rose', eye: 'crimson', teeth: 'gold', scar: 'rose' },
            flags: F_SCAR,
            params: { eyeStep: 2 },
        },
    },
    ratKing: {
        rig: 'ratM',
        variant: {
            ramps: {
                fur: 'bone', belly: 'bone', pink: 'rose', eye: 'ink', teeth: 'bone',
                cape: 'crimson', crown: 'gold',
            },
            flags: F_KING,
        },
    },
});
//# sourceMappingURL=rat.js.map