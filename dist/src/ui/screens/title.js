/**
 * タイトル画面。
 */
import { hasRun } from '../../core/save.js';
import { buildTitleDiorama } from '../art/scenes/title.js';
import { drawCursor, drawText } from '../draw.js';
import { DioramaView } from '../world/diorama.js';
import { ConfirmDialog, ListMenu, liveValue } from '../menu.js';
import { SCREEN_H, SCREEN_W, UI } from '../theme.js';
export class TitleScreen {
    app;
    onStart;
    onTown;
    id = 'title';
    menu;
    confirm = null;
    time = 0;
    /** 背景のジオラマ（初めて描く時に作る） */
    view = null;
    constructor(app, onStart, onTown) {
        this.app = app;
        this.onStart = onStart;
        this.onTown = onTown;
        this.menu = new ListMenu({
            title: '', entries: [],
            rect: { x: SCREEN_W / 2 - 170, y: 452, w: 340, h: 196 },
            rowH: 44, closable: false,
        });
        this.rebuild();
    }
    enter() {
        this.app.audio.playBgm('title');
        this.rebuild();
    }
    rebuild() {
        const entries = [];
        if (hasRun()) {
            entries.push({
                label: '冒険を 再開する',
                desc: '中断した冒険の続きから始めます。',
                onSelect: () => {
                    this.onStart(true);
                    return true;
                },
            });
        }
        entries.push({
            label: '風の村へ',
            desc: '倉庫で支度をして、ダンジョンへ潜ります。',
            onSelect: () => {
                this.onTown();
                return true;
            },
        });
        entries.push({
            label: 'はじめから',
            color: UI.textDim,
            desc: 'これまでの記録をすべて消して、最初からやり直します。',
            onSelect: () => {
                this.confirm = new ConfirmDialog({
                    message: 'これまでの記録が すべて 消えます。よろしいですか？',
                    danger: true,
                    onYes: () => {
                        this.app.resetAll();
                    },
                });
                return false;
            },
        });
        this.menu.setEntries(entries);
    }
    update(dt) {
        this.time += dt;
        const input = this.app.input;
        if (this.confirm) {
            if (this.confirm.handleInput(input))
                this.confirm = null;
            return;
        }
        this.menu.handleInput(input);
    }
    tick(stepMs) {
        this.view?.tick(stepMs / 1000);
    }
    draw(g, now) {
        // 背景：夜の風の村と天輪の塔。ゆっくり横へ流す
        if (!this.view)
            this.view = new DioramaView(buildTitleDiorama());
        this.view.camX = 10 + Math.sin(now / 14000) * 10;
        g.fillStyle = '#07070e';
        g.fillRect(0, 0, SCREEN_W, SCREEN_H);
        this.view.draw(g, now);
        const cx = SCREEN_W / 2;
        // 題字：明朝の金。後ろに薄い紺の帯を敷いて、星空の上でも読めるように
        const band = g.createLinearGradient(0, 0, SCREEN_W, 0);
        band.addColorStop(0, 'rgba(8,10,24,0)');
        band.addColorStop(0.5, 'rgba(8,10,24,0.55)');
        band.addColorStop(1, 'rgba(8,10,24,0)');
        g.fillStyle = band;
        g.fillRect(0, 128, SCREEN_W, 128);
        drawText(g, '風の村と天輪の塔', cx + 3, 205, {
            size: 64, bold: true, align: 'center', color: 'rgba(0,0,0,0.6)', family: 'serif',
        });
        drawText(g, '風の村と天輪の塔', cx, 202, {
            size: 64, bold: true, align: 'center', color: '#f0dfa8', family: 'serif',
            outline: '#2a1c08', outlineWidth: 4,
        });
        drawText(g, '― 不思議のダンジョン ―', cx, 240, {
            size: 22, align: 'center', color: '#c9c2ae', family: 'serif',
        });
        // 選択肢：枠は置かず、村の上に明朝で並べる（選んでいる行だけ青の帯）
        const rows = this.menu.entries;
        const top = SCREEN_H - 92 - rows.length * 46;
        rows.forEach((e, i) => {
            const y = top + i * 46;
            const sel = i === this.menu.cursor;
            if (sel)
                drawCursor(g, { x: cx - 150, y, w: 300, h: 40 }, now);
            drawText(g, liveValue(e.label) ?? '', cx, y + 28, {
                size: 22, align: 'center', family: 'serif', bold: sel,
                color: sel ? '#f7ecc8' : liveValue(e.color) ?? '#d8d0bc',
                outline: 'rgba(6,8,20,0.85)', outlineWidth: 4,
            });
        });
        drawText(g, '↑↓ で選ぶ　　Z / Enter / Space で決定', cx, SCREEN_H - 40, {
            size: 15, align: 'center', color: UI.textDim,
        });
        if (this.confirm) {
            g.save();
            g.fillStyle = 'rgba(0,0,0,0.5)';
            g.fillRect(0, 0, SCREEN_W, SCREEN_H);
            g.restore();
            this.confirm.draw(g, SCREEN_W, SCREEN_H, now);
        }
    }
}
//# sourceMappingURL=title.js.map