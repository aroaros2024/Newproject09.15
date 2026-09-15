/**
 * 入力。キーボードとゲームパッドを「シレン風の仮想パッド」に写像する。
 *
 * ゲーム側はキーコードを一切見ず、Button 列挙だけを見る。
 * これによりキーコンフィグとゲームパッドが同じ経路に乗る。
 *
 * - `justPressed()`  … このフレームで押された（メニュー操作向け）
 * - `repeated()`     … 長押しリピートを含む（連続移動向け）
 * - `isDown()`       … 押しっぱなし判定（斜め固定・ダッシュ修飾キー向け）
 * - 行動アニメーション中の入力は 1 つだけ先行入力として貯める
 */
export const Button = {
    Up: 'Up',
    Down: 'Down',
    Left: 'Left',
    Right: 'Right',
    /** 決定 / 攻撃 / 調べる / 階段を降りる（Switch の A） */
    A: 'A',
    /** キャンセル / 押しながら移動でダッシュ（Switch の B） */
    B: 'B',
    /** メインメニュー（Switch の X） */
    X: 'X',
    /** 足元メニュー（Switch の Y） */
    Y: 'Y',
    /** 押しながらで斜め移動固定（Switch の L） */
    L: 'L',
    /** 押しながらで向きだけ変える（Switch の R） */
    R: 'R',
    /** 全体マップ */
    Map: 'Map',
    /** その場で足踏み（1 ターン待つ） */
    Wait: 'Wait',
    /** ポーズ / 中断メニュー */
    Start: 'Start',
    /** 表示切替（メッセージログ全文など） */
    Select: 'Select',
};
export const ALL_BUTTONS = Object.values(Button);
/**
 * 既定のキー配置。
 * Switch 版シレン 6 のボタン配置をキーボードへ写像している。
 * テンキーがある環境ではテンキーで 8 方向を直接入力できる。
 */
export const DEFAULT_BINDINGS = {
    Up: ['ArrowUp', 'KeyW', 'Numpad8'],
    Down: ['ArrowDown', 'KeyS', 'Numpad2'],
    Left: ['ArrowLeft', 'KeyA', 'Numpad4'],
    Right: ['ArrowRight', 'KeyD', 'Numpad6'],
    A: ['KeyZ', 'Enter', 'Space', 'NumpadEnter'],
    B: ['KeyX', 'Backspace'],
    X: ['KeyC', 'Escape'],
    Y: ['KeyV', 'KeyF'],
    L: ['ShiftLeft', 'ShiftRight'],
    R: ['ControlLeft', 'ControlRight'],
    Map: ['Tab', 'KeyM'],
    Wait: ['Period', 'Numpad5', 'KeyQ'],
    Start: ['KeyP', 'NumpadAdd'],
    Select: ['KeyE', 'NumpadSubtract'],
};
/** 斜めを直接入力できるテンキー（対応する 2 方向に展開する） */
const DIAGONAL_KEYS = {
    Numpad7: [Button.Up, Button.Left],
    Numpad9: [Button.Up, Button.Right],
    Numpad1: [Button.Down, Button.Left],
    Numpad3: [Button.Down, Button.Right],
};
/** ゲームパッド（標準配置）のボタン番号 → Button */
const GAMEPAD_MAP = {
    0: Button.A, // Switch の B / Xbox の A
    1: Button.B,
    2: Button.Y, // 西ボタン
    3: Button.X, // 北ボタン
    4: Button.L,
    5: Button.R,
    6: Button.Map, // ZL
    7: Button.Wait, // ZR
    8: Button.Select,
    9: Button.Start,
    12: Button.Up,
    13: Button.Down,
    14: Button.Left,
    15: Button.Right,
};
export const DEFAULT_REPEAT = { delayMs: 250, intervalMs: 70 };
const newState = () => ({
    down: false, since: 0, nextRepeat: 0,
    pressedEdge: false, repeatEdge: false, releasedEdge: false,
});
export class InputManager {
    bindings = structuredClone(DEFAULT_BINDINGS);
    keyToButtons = new Map();
    state = new Map();
    repeat = { ...DEFAULT_REPEAT };
    now = 0;
    attached = false;
    /** 先行入力。アニメーション中に押されたボタンを 1 つだけ覚えておく */
    buffered = null;
    bufferedAt = 0;
    /** 先行入力の有効時間(ms)。古すぎる入力は暴発防止のため捨てる */
    bufferWindowMs = 300;
    /** 最初の入力で 1 度だけ呼ばれる（AudioContext の解除などに使う） */
    onFirstInput = null;
    firstInputDone = false;
    /** キーコンフィグ画面用。次に押されたキーを 1 つ拾う */
    captureResolve = null;
    constructor() {
        for (const b of ALL_BUTTONS)
            this.state.set(b, newState());
        this.rebuildKeyMap();
    }
    // ------------------------------------------------------------ 設定
    getBindings() {
        return structuredClone(this.bindings);
    }
    setBindings(b) {
        this.bindings = { ...this.bindings, ...structuredClone(b) };
        this.rebuildKeyMap();
    }
    resetBindings() {
        this.bindings = structuredClone(DEFAULT_BINDINGS);
        this.rebuildKeyMap();
    }
    setRepeat(cfg) {
        this.repeat = { ...this.repeat, ...cfg };
    }
    /**
     * 割り当ての衝突を検出する。
     * 同じキーが複数のボタンに割り当てられていたら、その一覧を返す。
     */
    findConflicts() {
        const out = [];
        for (const [code, buttons] of this.keyToButtons) {
            if (buttons.length > 1)
                out.push({ code, buttons: [...buttons] });
        }
        return out;
    }
    rebuildKeyMap() {
        this.keyToButtons.clear();
        for (const b of ALL_BUTTONS) {
            for (const code of this.bindings[b] ?? []) {
                const list = this.keyToButtons.get(code);
                if (list)
                    list.push(b);
                else
                    this.keyToButtons.set(code, [b]);
            }
        }
    }
    // ------------------------------------------------------------ 接続
    attach() {
        if (this.attached)
            this.detach();
        window.addEventListener('keydown', this.handleKeyDown, { passive: false });
        window.addEventListener('keyup', this.handleKeyUp);
        window.addEventListener('blur', this.handleBlur);
        this.attached = true;
    }
    detach() {
        if (!this.attached)
            return;
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        window.removeEventListener('blur', this.handleBlur);
        this.attached = false;
    }
    handleBlur = () => {
        // フォーカスが外れたらキーが押しっぱなしのまま残らないようにする
        this.releaseAll();
    };
    /** すべてのボタンを離した状態にする */
    releaseAll() {
        for (const b of ALL_BUTTONS) {
            const s = this.state.get(b);
            if (s && s.down) {
                s.down = false;
                s.releasedEdge = true;
            }
        }
    }
    handleKeyDown = (e) => {
        if (this.captureResolve) {
            e.preventDefault();
            const r = this.captureResolve;
            this.captureResolve = null;
            r(e.code);
            return;
        }
        // ブラウザの既定動作（スクロール・タブ移動・検索）を潰す
        const handled = this.keyToButtons.has(e.code) || e.code in DIAGONAL_KEYS;
        if (handled)
            e.preventDefault();
        if (!this.firstInputDone) {
            this.firstInputDone = true;
            this.onFirstInput?.();
        }
        if (e.repeat)
            return; // OS のリピートは使わず自前で管理する
        const buttons = this.buttonsForCode(e.code);
        for (const b of buttons)
            this.pressButton(b);
    };
    handleKeyUp = (e) => {
        const buttons = this.buttonsForCode(e.code);
        for (const b of buttons)
            this.releaseButton(b);
    };
    buttonsForCode(code) {
        const diag = DIAGONAL_KEYS[code];
        if (diag)
            return [diag[0], diag[1]];
        return this.keyToButtons.get(code) ?? [];
    }
    pressButton(b) {
        const s = this.state.get(b);
        if (!s || s.down)
            return;
        s.down = true;
        s.since = this.now;
        s.nextRepeat = this.now + this.repeat.delayMs;
        s.pressedEdge = true;
        s.repeatEdge = true;
        this.pushBuffer(b);
    }
    releaseButton(b) {
        const s = this.state.get(b);
        if (!s || !s.down)
            return;
        s.down = false;
        s.releasedEdge = true;
    }
    // ------------------------------------------------------------ 更新
    /**
     * 毎フレーム 1 回呼ぶ。前フレームのエッジを消し、リピートを発火する。
     * @param nowMs performance.now() の値
     */
    update(nowMs) {
        this.now = nowMs;
        for (const b of ALL_BUTTONS) {
            const s = this.state.get(b);
            if (!s)
                continue;
            s.pressedEdge = false;
            s.repeatEdge = false;
            s.releasedEdge = false;
            if (s.down && nowMs >= s.nextRepeat) {
                s.repeatEdge = true;
                s.nextRepeat = nowMs + this.repeat.intervalMs;
            }
        }
        this.pollGamepad();
    }
    prevGamepad = new Set();
    pollGamepad() {
        const nav = navigator;
        if (typeof nav.getGamepads !== 'function')
            return;
        let pads;
        try {
            pads = nav.getGamepads();
        }
        catch {
            return;
        }
        const active = new Set();
        for (const pad of pads) {
            if (!pad)
                continue;
            for (const [idxStr, btn] of Object.entries(GAMEPAD_MAP)) {
                const gb = pad.buttons[Number(idxStr)];
                if (gb && gb.pressed)
                    active.add(btn);
            }
            // 左スティックを 8 方向へ
            const [ax = 0, ay = 0] = pad.axes;
            const dz = 0.45;
            if (ax < -dz)
                active.add(Button.Left);
            if (ax > dz)
                active.add(Button.Right);
            if (ay < -dz)
                active.add(Button.Up);
            if (ay > dz)
                active.add(Button.Down);
        }
        for (const b of active) {
            if (!this.prevGamepad.has(b)) {
                if (!this.firstInputDone) {
                    this.firstInputDone = true;
                    this.onFirstInput?.();
                }
                this.pressButton(b);
            }
        }
        for (const b of this.prevGamepad) {
            if (!active.has(b))
                this.releaseButton(b);
        }
        this.prevGamepad = active;
    }
    // ------------------------------------------------------------ 問い合わせ
    isDown(b) {
        return this.state.get(b)?.down ?? false;
    }
    /** このフレームで押下エッジが立ったか（リピートを含まない） */
    justPressed(b) {
        return this.state.get(b)?.pressedEdge ?? false;
    }
    /** このフレームで離されたか */
    justReleased(b) {
        return this.state.get(b)?.releasedEdge ?? false;
    }
    /** このフレームで入力があったか（長押しリピートを含む） */
    repeated(b) {
        return this.state.get(b)?.repeatEdge ?? false;
    }
    /** 押しっぱなしの経過時間(ms)。押されていなければ 0 */
    heldMs(b) {
        const s = this.state.get(b);
        return s && s.down ? this.now - s.since : 0;
    }
    /** いずれかのボタンが押されているか */
    anyDown() {
        for (const b of ALL_BUTTONS)
            if (this.isDown(b))
                return true;
        return false;
    }
    /**
     * 現在の方向入力を (dx, dy) で返す。押されていなければ (0,0)。
     * 上下・左右が同時に押されていれば斜めになる。
     */
    directionVector() {
        let x = 0;
        let y = 0;
        if (this.isDown(Button.Left))
            x -= 1;
        if (this.isDown(Button.Right))
            x += 1;
        if (this.isDown(Button.Up))
            y -= 1;
        if (this.isDown(Button.Down))
            y += 1;
        return { x, y };
    }
    /** リピートを含む方向入力があったか */
    directionRepeated() {
        return (this.repeated(Button.Up) || this.repeated(Button.Down) ||
            this.repeated(Button.Left) || this.repeated(Button.Right));
    }
    /** メニューのカーソル移動用。押しっぱなしでリピートする 4 方向 */
    menuDirection() {
        if (this.repeated(Button.Up))
            return 'up';
        if (this.repeated(Button.Down))
            return 'down';
        if (this.repeated(Button.Left))
            return 'left';
        if (this.repeated(Button.Right))
            return 'right';
        return null;
    }
    // ------------------------------------------------------------ 先行入力
    pushBuffer(b) {
        // 方向・決定系のみバッファする。修飾キーは貯めない
        if (b === Button.L || b === Button.R)
            return;
        this.buffered = b;
        this.bufferedAt = this.now;
    }
    /** 先行入力を取り出す（取り出したら消える）。古いものは捨てる */
    takeBuffered() {
        if (this.buffered === null)
            return null;
        const b = this.buffered;
        const age = this.now - this.bufferedAt;
        this.buffered = null;
        return age <= this.bufferWindowMs ? b : null;
    }
    peekBuffered() {
        return this.buffered;
    }
    clearBuffer() {
        this.buffered = null;
    }
    // ------------------------------------------------------------ キーコンフィグ
    /** 次に押されたキーの code を 1 つ返す。キーコンフィグ画面用 */
    captureNextKey() {
        return new Promise((resolve) => {
            this.captureResolve = resolve;
        });
    }
    cancelCapture() {
        this.captureResolve = null;
    }
    isCapturing() {
        return this.captureResolve !== null;
    }
    /** 表示用のキー名（日本語） */
    static keyLabel(code) {
        const table = {
            ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
            Enter: 'Enter', NumpadEnter: 'テンキーEnter', Space: 'スペース',
            Backspace: 'BackSpace', Escape: 'Esc', Tab: 'Tab', Period: '.',
            ShiftLeft: '左Shift', ShiftRight: '右Shift',
            ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
            NumpadAdd: 'テンキー＋', NumpadSubtract: 'テンキー−',
        };
        if (table[code])
            return table[code];
        if (code.startsWith('Key'))
            return code.slice(3);
        if (code.startsWith('Digit'))
            return code.slice(5);
        if (code.startsWith('Numpad'))
            return 'テンキー' + code.slice(6);
        return code;
    }
    /** ボタンの日本語名（設定画面の表示用） */
    static buttonLabel(b) {
        const table = {
            Up: '上', Down: '下', Left: '左', Right: '右',
            A: '決定・攻撃', B: 'キャンセル・ダッシュ', X: 'メニュー', Y: '足元',
            L: '斜め移動固定', R: '向き変更', Map: '全体図', Wait: 'その場で待つ',
            Start: '中断メニュー', Select: 'ログ表示',
        };
        return table[b] ?? b;
    }
}
export const input = new InputManager();
//# sourceMappingURL=input.js.map