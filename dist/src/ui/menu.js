/**
 * メニューの枠組み。
 *
 * シレンのメニューは「開いたものが積み上がり、B で 1 枚ずつ戻る」構造なので、
 * ここではスタックとして持つ。個々のメニューの中身は screens/ が組み立てる。
 */
import { Cmd } from '../core/input.js';
import { drawBadge, drawCursor, drawPanel, drawScrollArrow, drawText, ellipsize, wrapText, } from './draw.js';
import { UI } from './theme.js';
export class ListMenu {
    title;
    entries;
    rect;
    rows;
    rowH;
    showDesc;
    closable;
    emptyText;
    cursor = 0;
    scroll = 0;
    onClose;
    onKey;
    constructor(o) {
        this.title = o.title;
        this.entries = o.entries;
        this.rect = o.rect;
        this.rowH = o.rowH ?? 34;
        this.rows = o.rows ?? Math.max(1, Math.floor((o.rect.h - 64) / this.rowH));
        this.showDesc = o.showDesc ?? false;
        this.closable = o.closable ?? true;
        this.emptyText = o.emptyText ?? '何も無い';
        this.onClose = o.onClose;
        this.onKey = o.onKey;
    }
    get current() {
        return this.entries[this.cursor];
    }
    setEntries(entries) {
        this.entries = entries;
        this.cursor = Math.min(this.cursor, Math.max(0, entries.length - 1));
        this.clampScroll();
    }
    clampScroll() {
        if (this.cursor < this.scroll)
            this.scroll = this.cursor;
        if (this.cursor >= this.scroll + this.rows)
            this.scroll = this.cursor - this.rows + 1;
        this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.entries.length - this.rows)));
    }
    move(delta) {
        if (this.entries.length === 0)
            return;
        const n = this.entries.length;
        this.cursor = ((this.cursor + delta) % n + n) % n;
        this.clampScroll();
    }
    /** 入力を処理する。閉じるときは 'close' */
    handleInput(input) {
        if (this.onKey?.(input))
            return 'open';
        if (input.commandFires(Cmd.PageUp, 'page'))
            this.move(-this.rows);
        if (input.commandFires(Cmd.PageDown, 'page'))
            this.move(this.rows);
        if (input.directionFires('menu')) {
            const dir = input.direction();
            if (dir !== null) {
                // 上下でカーソル、左右でページ送り
                if (dir === 0 || dir === 1 || dir === 7)
                    this.move(-1);
                else if (dir === 4 || dir === 3 || dir === 5)
                    this.move(1);
                else if (dir === 6)
                    this.move(-this.rows);
                else if (dir === 2)
                    this.move(this.rows);
            }
        }
        if (input.justPressed(Cmd.A)) {
            const entry = this.current;
            if (entry && !entry.disabled) {
                const close = entry.onSelect?.();
                if (close)
                    return 'close';
            }
            return 'open';
        }
        if (this.closable && (input.justPressed(Cmd.B) || input.justPressed(Cmd.X))) {
            return 'close';
        }
        return 'open';
    }
    draw(g, time, frame = UI.frame) {
        const r = this.rect;
        drawPanel(g, r, { frame });
        drawText(g, this.title, r.x + 18, r.y + 30, {
            size: 18, bold: true, color: UI.cursorEdge,
        });
        g.save();
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.moveTo(r.x + 14, r.y + 40.5);
        g.lineTo(r.x + r.w - 14, r.y + 40.5);
        g.stroke();
        g.restore();
        const top = r.y + 50;
        if (this.entries.length === 0) {
            drawText(g, this.emptyText, r.x + r.w / 2, top + 40, {
                size: 17, align: 'center', color: UI.textDim,
            });
            return;
        }
        const visible = this.entries.slice(this.scroll, this.scroll + this.rows);
        visible.forEach((entry, i) => {
            const index = this.scroll + i;
            const y = top + i * this.rowH;
            const rowRect = { x: r.x + 14, y, w: r.w - 28, h: this.rowH - 4 };
            if (index === this.cursor)
                drawCursor(g, rowRect, time);
            const color = entry.disabled ? UI.textDisabled : (entry.color ?? UI.text);
            let x = rowRect.x + 12;
            // 番号（ショートカット用）
            if (index < 10) {
                drawText(g, `${(index + 1) % 10}`, x, y + this.rowH / 2 + 2, {
                    size: 13, color: UI.textDisabled, baseline: 'middle',
                });
                x += 20;
            }
            const labelMax = rowRect.w - (x - rowRect.x) - 140;
            drawText(g, ellipsize(g, entry.label, labelMax, 17), x, y + this.rowH / 2, {
                size: 17, color, baseline: 'middle',
            });
            let bx = rowRect.x + rowRect.w - 12;
            if (entry.right) {
                drawText(g, entry.right, bx, y + this.rowH / 2, {
                    size: 15, align: 'right', color: UI.textDim, baseline: 'middle',
                });
                bx -= g.measureText(entry.right).width + 14;
            }
            for (const badge of entry.badges ?? []) {
                const w = drawBadge(g, badge.text, bx - 34, y + 6, badge.color, 12);
                bx -= w + 6;
            }
        });
        // スクロールの矢印
        if (this.scroll > 0)
            drawScrollArrow(g, r.x + r.w / 2, top - 6, false, time);
        if (this.scroll + this.rows < this.entries.length) {
            drawScrollArrow(g, r.x + r.w / 2, top + this.rows * this.rowH + 6, true, time);
        }
        // 件数
        drawText(g, `${this.cursor + 1} / ${this.entries.length}`, r.x + r.w - 18, r.y + 30, { size: 14, align: 'right', color: UI.textDim });
        if (this.showDesc)
            this.drawDesc(g);
    }
    drawDesc(g) {
        const entry = this.current;
        const r = this.rect;
        const box = { x: r.x, y: r.y + r.h + 10, w: r.w, h: 92 };
        drawPanel(g, box, { alpha: 0.92 });
        const text = entry?.desc ?? '';
        const lines = wrapText(g, text, box.w - 36, 15).slice(0, 3);
        lines.forEach((line, i) => {
            drawText(g, line, box.x + 18, box.y + 30 + i * 22, {
                size: 15, color: UI.textDim,
            });
        });
    }
}
/** 開いているメニューの重なり */
export class MenuStack {
    stack = [];
    get isOpen() {
        return this.stack.length > 0;
    }
    get depth() {
        return this.stack.length;
    }
    get top() {
        return this.stack[this.stack.length - 1];
    }
    push(menu) {
        this.stack.push(menu);
    }
    pop() {
        const menu = this.stack.pop();
        menu?.onClose?.();
    }
    closeAll() {
        while (this.stack.length > 0)
            this.pop();
    }
    /** 入力を一番上のメニューへ流す。何か処理したら true */
    handleInput(input) {
        const menu = this.top;
        if (!menu)
            return false;
        // X はどの階層からでも全部閉じる
        if (input.justPressed(Cmd.X)) {
            this.closeAll();
            return true;
        }
        if (menu.handleInput(input) === 'close')
            this.pop();
        return true;
    }
    draw(g, time, frame = UI.frame) {
        // 下の階層は少し暗くして、今の階層が分かるようにする
        this.stack.forEach((menu, i) => {
            const isTop = i === this.stack.length - 1;
            g.save();
            if (!isTop)
                g.globalAlpha = 0.55;
            menu.draw(g, time, frame);
            g.restore();
        });
    }
}
export class ConfirmDialog {
    opts;
    yes;
    constructor(opts) {
        this.opts = opts;
        this.yes = opts.defaultYes ?? !opts.danger;
    }
    /** 決着したら true */
    handleInput(input) {
        if (input.directionFires('menu')) {
            const dir = input.direction();
            if (dir === 6 || dir === 0)
                this.yes = true;
            if (dir === 2 || dir === 4)
                this.yes = false;
        }
        if (input.justPressed(Cmd.A)) {
            if (this.yes)
                this.opts.onYes();
            else
                this.opts.onNo?.();
            return true;
        }
        if (input.justPressed(Cmd.B)) {
            this.opts.onNo?.();
            return true;
        }
        return false;
    }
    draw(g, screenW, screenH, time) {
        const lines = wrapText(g, this.opts.message, 440, 18);
        const h = 110 + lines.length * 26;
        const r = { x: screenW / 2 - 260, y: screenH / 2 - h / 2, w: 520, h };
        drawPanel(g, r, { frame: this.opts.danger ? UI.danger : UI.frame });
        lines.forEach((line, i) => {
            drawText(g, line, r.x + r.w / 2, r.y + 44 + i * 26, {
                size: 18, align: 'center',
            });
        });
        const by = r.y + r.h - 46;
        const yesRect = { x: r.x + r.w / 2 - 150, y: by, w: 130, h: 36 };
        const noRect = { x: r.x + r.w / 2 + 20, y: by, w: 130, h: 36 };
        if (this.yes)
            drawCursor(g, yesRect, time);
        else
            drawCursor(g, noRect, time);
        drawText(g, this.opts.yesLabel ?? 'はい', yesRect.x + yesRect.w / 2, by + 24, {
            size: 17, align: 'center', bold: this.yes,
        });
        drawText(g, this.opts.noLabel ?? 'いいえ', noRect.x + noRect.w / 2, by + 24, {
            size: 17, align: 'center', bold: !this.yes,
        });
    }
}
/** 方向を選ぶ（投げる・杖を振る） */
export class DirectionPicker {
    dir = 4;
    message;
    onPick;
    onCancel;
    constructor(message, initialDir, onPick, onCancel) {
        this.message = message;
        this.dir = initialDir;
        this.onPick = onPick;
        this.onCancel = onCancel;
    }
    /** 決着したら true */
    handleInput(input) {
        const d = input.direction();
        if (d !== null && input.directionFires('menu'))
            this.dir = d;
        if (input.justPressed(Cmd.A)) {
            this.onPick(this.dir);
            return true;
        }
        if (input.justPressed(Cmd.B) || input.justPressed(Cmd.X)) {
            this.onCancel();
            return true;
        }
        return false;
    }
    draw(g, screenW, screenH, playerPx, playerPy) {
        // 画面上部に案内
        const r = { x: screenW / 2 - 200, y: 130, w: 400, h: 56 };
        drawPanel(g, r, { frame: UI.cursorEdge });
        drawText(g, this.message, r.x + r.w / 2, r.y + 34, {
            size: 17, align: 'center',
        });
        void screenH;
        // プレイヤーの周りに 8 方向の矢印
        const vecs = [
            [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
        ];
        for (let i = 0; i < 8; i++) {
            const [dx, dy] = vecs[i];
            const x = playerPx + dx * 46;
            const y = playerPy + dy * 46;
            g.save();
            g.globalAlpha = i === this.dir ? 1 : 0.35;
            g.fillStyle = i === this.dir ? UI.cursorEdge : UI.textDim;
            g.translate(x, y);
            g.rotate(Math.atan2(dy, dx) + Math.PI / 2);
            g.beginPath();
            g.moveTo(0, -12);
            g.lineTo(9, 8);
            g.lineTo(-9, 8);
            g.closePath();
            g.fill();
            g.restore();
        }
    }
}
/** 個数を選ぶ（まとめて投げる・売る） */
export class QuantityPicker {
    value;
    min;
    max;
    message;
    onPick;
    onCancel;
    constructor(message, min, max, initial, onPick, onCancel) {
        this.message = message;
        this.min = min;
        this.max = max;
        this.value = Math.max(min, Math.min(max, initial));
        this.onPick = onPick;
        this.onCancel = onCancel;
    }
    handleInput(input) {
        if (input.directionFires('number')) {
            const d = input.direction();
            if (d === 0 || d === 1 || d === 7)
                this.value = Math.min(this.max, this.value + 1);
            if (d === 4 || d === 3 || d === 5)
                this.value = Math.max(this.min, this.value - 1);
            if (d === 2)
                this.value = Math.min(this.max, this.value + 10);
            if (d === 6)
                this.value = Math.max(this.min, this.value - 10);
        }
        if (input.justPressed(Cmd.A)) {
            this.onPick(this.value);
            return true;
        }
        if (input.justPressed(Cmd.B) || input.justPressed(Cmd.X)) {
            this.onCancel();
            return true;
        }
        return false;
    }
    draw(g, screenW, screenH) {
        const r = { x: screenW / 2 - 180, y: screenH / 2 - 60, w: 360, h: 120 };
        drawPanel(g, r, { frame: UI.cursorEdge });
        drawText(g, this.message, r.x + r.w / 2, r.y + 38, { size: 17, align: 'center' });
        drawText(g, `◀  ${this.value}  ▶`, r.x + r.w / 2, r.y + 84, {
            size: 30, bold: true, align: 'center', color: UI.cursorEdge,
        });
    }
}
//# sourceMappingURL=menu.js.map