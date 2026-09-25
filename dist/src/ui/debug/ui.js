/**
 * 検証用：UI の部品を 1 画面に並べる。?scene=ui:kit
 * 一時だけ出す部品（数字・告知の帯・階の札・黒帯・ボスの札）は ?scene=ui:widgets
 *
 * 枠・題の札・一覧・説明欄・確認・個数・方向・ゲージ・バッジを、
 * ダンジョンらしい暗い背景の上に置いて見比べる。
 */
import { SCREEN_H, SCREEN_W, UI } from '../theme.js';
import { drawBadge, drawBar, drawPanel, drawText, drawTitlePlaque, } from '../draw.js';
import { ConfirmDialog, DirectionPicker, ListMenu, QuantityPicker } from '../menu.js';
import { loadAllSprites } from '../spriteData.js';
import { PopupLayer, drawBanner, drawBossTitle, drawFloorCard, drawLetterbox, } from '../ui2/widgets.js';
function background(g) {
    // 暗い石畳（半透明の枠の透け具合を見るため）
    g.fillStyle = '#15121b';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    for (let y = 0; y < SCREEN_H; y += 48) {
        for (let x = 0; x < SCREEN_W; x += 48) {
            g.fillStyle = ((x / 48 + y / 48) & 1) === 0 ? '#2a2430' : '#231f29';
            g.fillRect(x + 1, y + 1, 46, 46);
        }
    }
    g.fillStyle = 'rgba(255,170,90,0.18)';
    g.beginPath();
    g.arc(640, 360, 260, 0, Math.PI * 2);
    g.fill();
}
/** 一時だけ出す部品を、決まった時刻で止めて並べる（撮って見比べるため） */
function widgets(g) {
    background(g);
    const popups = new PopupLayer();
    // 画面の左上を原点、1 マス 48px として、マスの上に数字を置く
    const samples = [
        ['12', 'damage', 2, 3], ['8', 'damageToPlayer', 4, 3], ['37', 'crit', 6, 3],
        ['+25', 'heal', 8, 3], ['MISS', 'miss', 10, 3], ['+18 EXP', 'exp', 12, 3],
        ['LEVEL UP', 'levelUp', 15, 3], ['眠った', 'info', 19, 3],
        ['5', 'damage', 23, 3], ['5', 'damage', 23, 3],
    ];
    // 全部を出してから 1 度だけ時間を進める（update は全部の数字を進めるので）
    for (const [text, kind, tx, ty] of samples)
        popups.spawn(text, kind, tx, ty);
    popups.update(160);
    popups.draw(g, 0, 0, 48);
    drawBanner(g, 'モンスターハウスだ！', '部屋の 敵が 一斉に 目を覚ました', 900, 1800, 250);
    drawFloorCard(g, '始まりの洞窟', 'B5F', 1, 640, 470);
    drawLetterbox(g, 1);
    drawBossTitle(g, '森の主', 'せせらぎの森の最深部', 1200);
}
export function open(spec, _params, canvas) {
    loadAllSprites();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SCREEN_W * dpr;
    canvas.height = SCREEN_H * dpr;
    canvas.style.width = `${SCREEN_W}px`;
    canvas.style.height = `${SCREEN_H}px`;
    const g = canvas.getContext('2d');
    if (!g)
        return;
    if (spec === 'ui:widgets') {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        widgets(g);
        return;
    }
    const menu = new ListMenu({
        title: '持ち物　12 / 20',
        rect: { x: 40, y: 40, w: 520, h: 400 },
        showDesc: true,
        entries: [
            { label: '鉄の剣+3[会2炎]', right: '武器', sprite: 'ironSword', badges: [{ text: 'E', color: UI.equip }, { text: '保', color: UI.good }], desc: '攻撃力 9+3 = 12　印 2/3\n会心の印 Lv2・火炎の印\n癖の無い剣。印を 3 つ埋められる。' },
            { label: '鉄の盾+2[減]', right: '盾', sprite: 'ironShield', badges: [{ text: 'E', color: UI.equip }], desc: '防御力 8+2 = 10' },
            { label: '薬草', right: '草', sprite: 'herb', badges: [{ text: '1', color: UI.cursorEdge }], desc: 'HP が 25 回復する。' },
            { label: 'みどりの草', right: '草', sprite: 'herb', desc: 'まだ 何か 分からない。' },
            { label: '眠りの杖[5]', right: '杖', sprite: 'staff', desc: 'あと 5 回 振れる' },
            { label: '保存の壺[0/4]', right: '壺', sprite: 'pot', desc: '中身 0 / 容量 4' },
            { label: '呪われた盾', right: '盾', sprite: 'shield', badges: [{ text: '呪', color: UI.curse }], desc: '' },
            { label: 'おにぎり', right: '食料', sprite: 'food', disabled: true, desc: '' },
        ],
    });
    menu.cursor = 0;
    const draw = (now) => {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.imageSmoothingEnabled = false;
        background(g);
        menu.draw(g, now);
        // ゲージとバッジ
        const r = { x: 600, y: 40, w: 640, h: 170 };
        drawPanel(g, r);
        drawTitlePlaque(g, 'ナギ　Lv 12', r.x + 14, r.y + 10);
        drawText(g, 'HP', r.x + 24, r.y + 80, { size: 20, color: UI.textDim });
        drawText(g, '87', r.x + 110, r.y + 82, { size: 22, bold: true, align: 'right', color: UI.hpHi });
        drawBar(g, { x: r.x + 140, y: r.y + 68, w: 300, h: 14 }, { ratio: 0.72, color: UI.hpHi });
        drawText(g, '満腹', r.x + 24, r.y + 124, { size: 17, color: UI.textDim });
        drawBar(g, { x: r.x + 80, y: r.y + 114, w: 140, h: 10 }, { ratio: 0.4, color: UI.food, segments: 4 });
        let bx = r.x + 250;
        for (const [t, c] of [['E', UI.equip], ['保', UI.good], ['呪', UI.curse], ['売', UI.gitan], ['1', UI.cursorEdge]]) {
            bx += drawBadge(g, t, bx, r.y + 110, c, 14) + 8;
        }
        drawText(g, '12,480 G', r.x + r.w - 24, r.y + 124, { size: 20, bold: true, align: 'right', color: UI.gitan });
        new ConfirmDialog({ message: '記録を すべて 消して、はじめから 遊びますか？\nこの操作は 取り消せません。', danger: true, onYes: () => { } })
            .draw(g, SCREEN_W + 520, SCREEN_H - 40, now);
        new QuantityPicker('いくつ 投げますか？', 1, 12, 5, () => { }, () => { }).draw(g, SCREEN_W + 520, SCREEN_H + 360);
        const dp = new DirectionPicker('どの向きに 投げますか？', 2, () => { }, () => { });
        dp.draw(g, 600, SCREEN_H, 300, 600);
        requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
}
//# sourceMappingURL=ui.js.map