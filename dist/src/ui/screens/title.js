/**
 * タイトル画面。
 */
import { clearAll, hasRun } from '../../core/save.js';
import { drawText } from '../draw.js';
import { ConfirmDialog, ListMenu } from '../menu.js';
import { SCREEN_H, SCREEN_W, UI } from '../theme.js';
export class TitleScreen {
    app;
    onStart;
    onTown;
    id = 'title';
    menu;
    confirm = null;
    time = 0;
    constructor(app, onStart, onTown) {
        this.app = app;
        this.onStart = onStart;
        this.onTown = onTown;
        this.menu = new ListMenu({
            title: '', entries: [],
            rect: { x: SCREEN_W / 2 - 170, y: 400, w: 340, h: 240 },
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
                        clearAll();
                        window.location.reload();
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
    draw(g, now) {
        // 背景: ゆっくり流れる風
        g.fillStyle = '#07070e';
        g.fillRect(0, 0, SCREEN_W, SCREEN_H);
        g.save();
        for (let i = 0; i < 40; i++) {
            const y = (i * 53 + (now / 40) * (1 + (i % 3) * 0.4)) % (SCREEN_H + 80) - 40;
            const x = (i * 197 + Math.sin(now / 2400 + i) * 60) % SCREEN_W;
            g.globalAlpha = 0.05 + (i % 4) * 0.02;
            g.fillStyle = '#cdbb7a';
            g.fillRect(x, y, 60, 2);
        }
        g.restore();
        const cx = SCREEN_W / 2;
        drawText(g, '風の村と天輪の塔', cx, 190, {
            size: 62, bold: true, align: 'center', color: '#e8dcae',
            outline: '#1a1408', outlineWidth: 8,
        });
        drawText(g, '― 不思議のダンジョン ―', cx, 236, {
            size: 22, align: 'center', color: UI.textDim,
        });
        this.menu.draw(g, now);
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