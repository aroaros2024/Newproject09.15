/**
 * 冒険の結果画面。
 */
import { Cmd } from '../../core/input.js';
import { loadReplay } from '../../core/save.js';
import { copyPlayLog } from '../clipboard.js';
import { drawPanel, drawText } from '../draw.js';
import { SCREEN_H, SCREEN_W, UI } from '../theme.js';
export class ResultScreen {
    app;
    data;
    onClose;
    id = 'result';
    t = 0;
    /** プレイログをコピーしたときの知らせ */
    notice = '';
    constructor(app, data, onClose) {
        this.app = app;
        this.data = data;
        this.onClose = onClose;
    }
    enter() {
        this.app.audio.playBgm(this.data.kind === 'clear' ? 'result' : null);
        if (this.data.kind === 'clear')
            this.app.audio.play('fanfare');
    }
    update(dt) {
        this.t += dt;
        // 演出が終わるまでは入力を受け付けない
        if (this.t < 700)
            return;
        const input = this.app.input;
        // 倒れた直後がいちばん記録の要るところなので、村へ戻る前に出せるようにしておく
        if (input.justPressed(Cmd.CopyLog)) {
            void this.copyLog();
            return;
        }
        if (input.justPressed(Cmd.A) || input.justPressed(Cmd.B) || input.justPressed(Cmd.X)) {
            this.onClose();
        }
    }
    async copyLog() {
        const d = this.data;
        this.notice = await copyPlayLog(this.app.recorder.current ?? loadReplay(), {
            dungeonName: d.record.dungeonName,
            ending: d.record.cleared ? 'クリア' : (d.record.cause ?? '―'),
            player: null,
            depth: d.record.depth,
            turn: d.record.turns,
            at: d.record.at,
        });
    }
    draw(g, now) {
        const d = this.data;
        const clear = d.kind === 'clear';
        const grad = g.createLinearGradient(0, 0, 0, SCREEN_H);
        if (clear) {
            grad.addColorStop(0, '#1a1508');
            grad.addColorStop(1, '#070608');
        }
        else {
            grad.addColorStop(0, '#12070a');
            grad.addColorStop(1, '#050408');
        }
        g.fillStyle = grad;
        g.fillRect(0, 0, SCREEN_W, SCREEN_H);
        const title = clear ? 'ダンジョン 踏破！'
            : d.kind === 'escape' ? '村へ 生還した' : 'ちからつきた……';
        const color = clear ? '#e8c66a' : d.kind === 'escape' ? '#9fd6f0' : '#e07a6a';
        const appear = Math.min(1, this.t / 500);
        g.save();
        g.globalAlpha = appear;
        drawText(g, title, SCREEN_W / 2, 130, {
            size: 52, bold: true, align: 'center', color, family: 'serif', spacing: 6,
            outline: '#0b1020', outlineWidth: 8,
        });
        g.restore();
        const r = { x: SCREEN_W / 2 - 340, y: 190, w: 680, h: 380 };
        drawPanel(g, r);
        const rows = [
            ['ダンジョン', d.record.dungeonName],
            ['到達した階', `${d.record.depth} F`],
            ['レベル', `Lv ${d.record.level}`],
            ['かかったターン', `${d.record.turns.toLocaleString('ja-JP')}`],
            ['倒した数', `${d.stats.kills}`],
            ['拾った道具', `${d.stats.itemsFound}`],
            ['稼いだギタン', `${d.stats.gitanEarned.toLocaleString('ja-JP')}`],
            ['与えたダメージ', `${d.stats.damageDealt.toLocaleString('ja-JP')}`],
            ['受けたダメージ', `${d.stats.damageTaken.toLocaleString('ja-JP')}`],
        ];
        if (!clear && d.record.cause)
            rows.push(['最期', d.record.cause]);
        if (d.lost > 0)
            rows.push(['失った道具', `${d.lost} 個`]);
        rows.forEach(([label, value], i) => {
            const y = r.y + 54 + i * 32;
            const shown = this.t > 600 + i * 70;
            if (!shown)
                return;
            drawText(g, label, r.x + 48, y, { size: 18, color: UI.textDim });
            drawText(g, value, r.x + r.w - 48, y, { size: 20, align: 'right', bold: true });
        });
        let y = r.y + r.h + 34;
        if (d.rewardMessage && this.t > 1400) {
            drawText(g, d.rewardMessage, SCREEN_W / 2, y, {
                size: 19, align: 'center', color: UI.good,
            });
            y += 30;
        }
        if (d.unlockedName && this.t > 1700) {
            drawText(g, `「${d.unlockedName}」へ 行けるように なった！`, SCREEN_W / 2, y, {
                size: 19, align: 'center', color: UI.cursorEdge,
            });
        }
        if (this.notice) {
            drawText(g, this.notice, SCREEN_W / 2, SCREEN_H - 62, {
                size: 16, align: 'center', color: UI.good,
            });
        }
        if (this.t > 2000) {
            const blink = 0.55 + 0.45 * Math.sin(now / 320);
            g.save();
            g.globalAlpha = blink;
            drawText(g, '決定キーで 村へ 戻る　　P で プレイログを コピー', SCREEN_W / 2, SCREEN_H - 34, {
                size: 17, align: 'center', color: UI.textDim,
            });
            g.restore();
        }
    }
}
//# sourceMappingURL=result.js.map