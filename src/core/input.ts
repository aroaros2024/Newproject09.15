/**
 * 入力。キーボードとゲームパッドを「シレン 6 のボタン」へ写像する。
 *
 * ゲーム側はキーコードを一切見ず、Cmd 列挙と「今の方向入力」だけを見る。
 *
 * 方針（docs/DESIGN.md §操作 に対応）:
 *   - Ctrl / Alt / Meta が押された入力は一切受け取らない（ブラウザと衝突するため）
 *   - Shift は方向キーの修飾（ダッシュ）にだけ使う。例外は Shift+. の階段だけ
 *   - 斜めは「矢印/WADS の 2 キー同時押し」か「テンキー 1/3/7/9」か「L 押しながら」
 *   - 反対方向の同時押しは相殺して無方向にする
 *   - リピートの間隔は用途ごとに違う（移動・メニュー・数値入力…）
 */

import type { Dir } from './geom.js';

/** 意味づけされたコマンド */
export const Cmd = {
  /** 決定 / 調べる / メッセージ送り */
  A: 'A',
  /** キャンセル / 戻る */
  B: 'B',
  /** メインメニュー */
  X: 'X',
  /** 足元メニュー */
  Y: 'Y',
  /** 押している間、斜め移動に固定 */
  L: 'L',
  /** 押している間、向きだけ変える */
  R: 'R',
  /** 押しながら方向でダッシュ */
  Dash: 'Dash',
  /** 押している間、全体マップ */
  Map: 'Map',
  /** ミニマップの表示切り替え */
  Minimap: 'Minimap',
  /** その場で 1 ターン待つ */
  Wait: 'Wait',
  /** 階段メニュー（Shift + .） */
  Stairs: 'Stairs',
  /** メッセージ履歴 */
  Log: 'Log',
  /** 操作ヘルプ */
  Help: 'Help',
  /** プレイログをクリップボードへ */
  CopyLog: 'CopyLog',
  /** 道具メニューを直接開く */
  MenuItem: 'MenuItem',
  /** 特殊メニューを直接開く */
  MenuSpecial: 'MenuSpecial',
  /** 作戦メニューを直接開く */
  MenuTactics: 'MenuTactics',
  /** ページ送り */
  PageUp: 'PageUp',
  PageDown: 'PageDown',
} as const;

export type Cmd = (typeof Cmd)[keyof typeof Cmd];

/** ショートカット（数字キー） */
export type ShortcutIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** code → コマンド。ここに無い code は未割り当て */
const KEY_TO_CMD: Record<string, Cmd> = {
  Space: Cmd.A, Enter: Cmd.A, NumpadEnter: Cmd.A, KeyZ: Cmd.A,
  Escape: Cmd.B, Backspace: Cmd.B, NumpadSubtract: Cmd.B,
  KeyE: Cmd.X, Numpad0: Cmd.X,
  KeyF: Cmd.Y, NumpadDecimal: Cmd.Y,
  KeyQ: Cmd.L, NumpadDivide: Cmd.L,
  KeyR: Cmd.R, NumpadMultiply: Cmd.R,
  ShiftLeft: Cmd.Dash, ShiftRight: Cmd.Dash, NumpadAdd: Cmd.Dash,
  Tab: Cmd.Map,
  KeyM: Cmd.Minimap,
  Period: Cmd.Wait, Numpad5: Cmd.Wait,
  KeyL: Cmd.Log,
  KeyH: Cmd.Help, F1: Cmd.Help,
  KeyP: Cmd.CopyLog,
  KeyI: Cmd.MenuItem,
  KeyT: Cmd.MenuSpecial,
  KeyC: Cmd.MenuTactics,
  PageUp: Cmd.PageUp, PageDown: Cmd.PageDown,
};

/** KeyX は「キャンセル」と「ダッシュ」を兼ねる（原作の B ボタン） */
const DUAL_KEYS: Record<string, Cmd[]> = {
  KeyX: [Cmd.B, Cmd.Dash],
};

/** 方向キー。U/D/L/R のどれを押しているか */
type Axis = 'U' | 'D' | 'L' | 'R';
const KEY_TO_AXIS: Record<string, Axis> = {
  ArrowUp: 'U', KeyW: 'U', Numpad8: 'U',
  ArrowDown: 'D', KeyS: 'D', Numpad2: 'D',
  ArrowLeft: 'L', KeyA: 'L', Numpad4: 'L',
  ArrowRight: 'R', KeyD: 'R', Numpad6: 'R',
};

/** テンキーで直接入力できる斜め */
const KEY_TO_DIAGONAL: Record<string, Dir> = {
  Numpad7: 7, Numpad9: 1, Numpad1: 5, Numpad3: 3,
};

/** U/D/L/R のビットから 8 方向を引く表 */
const DIR_FROM_UDLR: Record<number, Dir | null> = {
  0b1000: 0, // U
  0b1001: 1, // U+R
  0b0001: 2, // R
  0b0101: 3, // D+R
  0b0100: 4, // D
  0b0110: 5, // D+L
  0b0010: 6, // L
  0b1010: 7, // U+L
};

/** 用途ごとのリピート設定 */
export const REPEAT = {
  move: { delay: 180, interval: 90 },
  wait: { delay: 300, interval: 120 },
  menu: { delay: 300, interval: 70, fastAfter: 5, fastInterval: 45 },
  page: { delay: 350, interval: 140 },
  number: { delay: 300, interval: 60, fastAfter: 10, fastInterval: 25 },
  message: { delay: 200, interval: 90 },
} as const;

/**
 * 2 キー同時押しを斜めとみなす猶予(ms)。
 *
 * 40ms では人間の 2 本指の同時押しに間に合わず、斜めに失敗すると
 * 「まっすぐ 2 歩」＝ 2 ターン消費になり、敵に 2 回殴られる。
 * テンキー（1/3/7/9）なら猶予なしで斜めに歩けるので、
 * きびきび動かしたい人はそちらを使える。
 */
export const DIAG_WINDOW_MS = 90;

/** ゲームパッド（standard mapping）のボタン番号 → コマンド */
const PAD_TO_CMD: Record<number, Cmd> = {
  0: Cmd.A, 1: Cmd.B, 2: Cmd.Y, 3: Cmd.X,
  4: Cmd.L, 5: Cmd.R, 6: Cmd.Map, 7: Cmd.Dash,
  8: Cmd.Log, 9: Cmd.X,
  10: Cmd.Wait,
};
const PAD_TO_AXIS: Record<number, Axis> = { 12: 'U', 13: 'D', 14: 'L', 15: 'R' };

interface KeyState {
  pressedAt: number;
  lastRepeatAt: number;
  repeatCount: number;
  /** このフレームで押下エッジが立った */
  edge: boolean;
  /**
   * 離されたが、まだ押下エッジを 1 度も観測していない状態。
   *
   * フレームより短い「タップ」で keydown と keyup が同じフレーム間に起きると、
   * 素直に削除してしまうと入力が丸ごと消える。そこでエッジを 1 フレーム
   * 生かしてから消すようにしている。
   */
  releasedPending: boolean;
  /**
   * 長押しのリピートを止める印。
   *
   * ダメージを受けた時などに立て、押し直すまで連射を再開しない。
   * コマンドごとに持つ（共通のフラグにすると、無関係なキーを 1 回
   * 押しただけで待機の連射まで復活してしまう）。
   */
  repeatBlocked: boolean;
}

export class InputManager {
  private keys = new Map<string, KeyState>();
  private cmds = new Map<Cmd, KeyState>();
  private axes = new Map<Axis, KeyState>();
  /** テンキーの斜め。押下エッジだけを見る */
  private diagonalEdge: Dir | null = null;
  private shortcutEdge: ShortcutIndex | null = null;

  private now = 0;
  private attached = false;

  /**
   * 方向のリピートを止めるラッチ。
   * 被弾や敵の出現でバッファを消したとき、キーを押し直すまで走り出さないようにする。
   */
  private dirLatched = false;

  /** 斜め合成の待ち。単発入力で斜めを取りこぼさないための猶予 */
  private pendingDir: { dir: Dir; at: number } | null = null;

  /** 最初の入力で 1 度だけ呼ばれる（AudioContext の解除用） */
  onFirstInput: (() => void) | null = null;
  private firstInputDone = false;

  /** 斜め合成の猶予（設定で伸ばせる） */
  diagWindowMs = DIAG_WINDOW_MS;
  /** 矢印キーの同時押しで斜めにしない（テンキーのみ設定） */
  numpadOnlyDiagonal = false;

  // ------------------------------------------------------------ 接続

  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.attached = false;
  }

  private onBlur = (): void => this.releaseAll();

  releaseAll(): void {
    this.keys.clear();
    this.cmds.clear();
    this.axes.clear();
    this.pendingDir = null;
    this.dirLatched = false;
  }

  private newState(): KeyState {
    return {
      pressedAt: this.now, lastRepeatAt: this.now,
      repeatCount: 0, edge: true, releasedPending: false,
      repeatBlocked: false,
    };
  }

  /**
   * キーを離す。まだ押下エッジを観測していなければ、
   * 次の update() まで状態を残して「押して離した」ことを伝える。
   */
  private releaseState(map: Map<string, KeyState>, key: string): void {
    const s = map.get(key);
    if (!s) return;
    if (s.edge) s.releasedPending = true;
    else map.delete(key);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // ブラウザのショートカットと衝突するので、修飾キー付きは受け取らない
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const code = e.code;
    const known = code in KEY_TO_CMD || code in DUAL_KEYS
      || code in KEY_TO_AXIS || code in KEY_TO_DIAGONAL
      || /^Digit[0-9]$/.test(code);
    if (!known) return;
    e.preventDefault();

    if (!this.firstInputDone) {
      this.firstInputDone = true;
      this.onFirstInput?.();
    }
    if (e.repeat) return; // OS のリピートは使わず自前で管理する
    if (this.keys.has(code)) return;
    this.keys.set(code, this.newState());

    // 階段は Shift + Period だけの特別扱い
    if (code === 'Period' && e.shiftKey) {
      this.cmds.set(Cmd.Stairs, this.newState());
      return;
    }

    const axis = KEY_TO_AXIS[code];
    if (axis) {
      this.axes.set(axis, this.newState());
      this.dirLatched = false;
      this.notePendingDir();
      return;
    }
    const diag = KEY_TO_DIAGONAL[code];
    if (diag !== undefined) {
      this.diagonalEdge = diag;
      this.dirLatched = false;
      return;
    }
    const digit = /^Digit([0-9])$/.exec(code);
    if (digit) {
      this.shortcutEdge = Number(digit[1]) as ShortcutIndex;
      return;
    }
    for (const cmd of DUAL_KEYS[code] ?? [KEY_TO_CMD[code]]) {
      if (cmd) this.cmds.set(cmd, this.newState());
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    this.keys.delete(code);
    const axis = KEY_TO_AXIS[code];
    if (axis) {
      this.releaseState(this.axes as Map<string, KeyState>, axis);
      this.dirLatched = false;
      return;
    }
    if (code in KEY_TO_DIAGONAL) return;
    for (const cmd of DUAL_KEYS[code] ?? [KEY_TO_CMD[code]]) {
      if (cmd) this.releaseState(this.cmds as Map<string, KeyState>, cmd);
    }
    if (code === 'Period') this.releaseState(this.cmds as Map<string, KeyState>, Cmd.Stairs);
  };

  /** 単発入力の斜め判定のために、直前の方向を覚えておく */
  private notePendingDir(): void {
    const dir = this.rawDirection();
    if (dir !== null) this.pendingDir = { dir, at: this.now };
  }

  // ------------------------------------------------------------ 毎フレーム

  /**
   * フレームの先頭で呼ぶ。時刻を進め、ゲームパッドを読む。
   *
   * 押下エッジはここでは消さない。消すのは endFrame()。
   * ここで消すと、直前のフレームからこのフレームまでの間に届いた keydown を
   * 誰も観測できないまま捨ててしまう（＝キーがまったく効かなくなる）。
   */
  beginFrame(nowMs: number): void {
    this.now = nowMs;
    this.pollGamepad();
  }

  /** フレームの末尾で呼ぶ。観測し終えた押下エッジを消す */
  endFrame(): void {
    this.expireEdges(this.keys);
    this.expireEdges(this.cmds as Map<string, KeyState>);
    this.expireEdges(this.axes as Map<string, KeyState>);
    this.diagonalEdge = null;
    this.shortcutEdge = null;
  }

  /**
   * 押下エッジを 1 フレームで消す。
   * 既に離されていたものは、エッジを見せ終えた時点で取り除く。
   */
  private expireEdges(map: Map<string, KeyState>): void {
    for (const [key, s] of [...map]) {
      if (s.edge) {
        s.edge = false;
        if (s.releasedPending) map.delete(key);
      } else if (s.releasedPending) {
        map.delete(key);
      }
    }
  }

  private prevPad = new Set<Cmd | Axis>();

  private pollGamepad(): void {
    const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
    if (typeof nav.getGamepads !== 'function') return;
    let pads: (Gamepad | null)[];
    try {
      pads = nav.getGamepads();
    } catch {
      return;
    }
    const active = new Set<Cmd | Axis>();
    for (const pad of pads) {
      if (!pad || pad.mapping !== 'standard') continue;
      for (const [idx, cmd] of Object.entries(PAD_TO_CMD)) {
        if (pad.buttons[Number(idx)]?.pressed) active.add(cmd);
      }
      for (const [idx, axis] of Object.entries(PAD_TO_AXIS)) {
        if (pad.buttons[Number(idx)]?.pressed) active.add(axis);
      }
      const dz = 0.45;
      const [ax = 0, ay = 0] = pad.axes;
      if (ax < -dz) active.add('L');
      if (ax > dz) active.add('R');
      if (ay < -dz) active.add('U');
      if (ay > dz) active.add('D');
    }
    for (const k of active) {
      if (this.prevPad.has(k)) continue;
      if (!this.firstInputDone) {
        this.firstInputDone = true;
        this.onFirstInput?.();
      }
      if (k === 'U' || k === 'D' || k === 'L' || k === 'R') {
        this.axes.set(k, this.newState());
        this.dirLatched = false;
      } else {
        this.cmds.set(k, this.newState());
      }
    }
    for (const k of this.prevPad) {
      if (active.has(k)) continue;
      if (k === 'U' || k === 'D' || k === 'L' || k === 'R') {
        this.releaseState(this.axes as Map<string, KeyState>, k);
      } else {
        this.releaseState(this.cmds as Map<string, KeyState>, k);
      }
    }
    this.prevPad = active;
  }

  // ------------------------------------------------------------ 問い合わせ

  isDown(cmd: Cmd): boolean {
    return this.cmds.has(cmd);
  }

  /** このフレームで押されたか */
  justPressed(cmd: Cmd): boolean {
    return this.cmds.get(cmd)?.edge === true;
  }

  /**
   * 押下エッジを消費する。
   *
   * 同じフレームで 2 つの意味に取られたくない時に使う
   * （例: メッセージの早送りに使った A が、そのまま攻撃にもなる）。
   */
  consume(cmd: Cmd): void {
    const s = this.cmds.get(cmd);
    if (s) s.edge = false;
  }

  heldMs(cmd: Cmd): number {
    const s = this.cmds.get(cmd);
    return s ? this.now - s.pressedAt : 0;
  }

  /** 数字キーのショートカット。押されたフレームだけ値を返す */
  takeShortcut(): ShortcutIndex | null {
    const v = this.shortcutEdge;
    this.shortcutEdge = null;
    return v;
  }

  /** 押されている U/D/L/R から合成した方向（相殺と斜め固定を考慮しない生の値） */
  private rawDirection(): Dir | null {
    let up = this.axes.has('U');
    let dn = this.axes.has('D');
    let lf = this.axes.has('L');
    let rt = this.axes.has('R');
    if (up && dn) up = dn = false;
    if (lf && rt) lf = rt = false;
    const bits = (up ? 0b1000 : 0) | (dn ? 0b0100 : 0) | (lf ? 0b0010 : 0) | (rt ? 0b0001 : 0);
    if (bits === 0) return null;
    return DIR_FROM_UDLR[bits] ?? null;
  }

  /**
   * 今の方向入力。
   * テンキーの斜めが押されていればそれを優先する。
   * L（斜め固定）が押されている間は、直交方向を捨てる。
   */
  direction(): Dir | null {
    if (this.diagonalEdge !== null) return this.diagonalEdge;
    if (this.dirLatched) return null;
    const dir = this.rawDirection();
    if (dir === null) return null;
    // 矢印の同時押しで斜めにしない設定
    if (this.numpadOnlyDiagonal && (dir & 1) === 1) return null;
    // 斜め固定中に直交方向が来たら入力を捨てる
    if (this.isDown(Cmd.L) && (dir & 1) === 0) return null;
    return dir;
  }

  /** 方向キーがひとつでも押されているか */
  hasDirectionHeld(): boolean {
    return this.axes.size > 0;
  }

  /**
   * 方向入力がこのフレームで「発火」したか。
   * 押した瞬間と、リピート間隔を満たしたときに true。
   */
  directionFires(kind: keyof typeof REPEAT = 'move'): boolean {
    if (this.dirLatched) return false;
    if (this.diagonalEdge !== null) return true;
    let newest: KeyState | null = null;
    for (const s of this.axes.values()) {
      if (!newest || s.pressedAt > newest.pressedAt) newest = s;
    }
    if (!newest) return false;
    if (newest.edge) {
      // 単発入力は、斜めの相方を待つ猶予を置いてから確定させる
      return true;
    }
    return this.repeatFires(newest, kind);
  }

  /** コマンドのリピート判定（メニューのカーソル移動など） */
  commandFires(cmd: Cmd, kind: keyof typeof REPEAT = 'menu'): boolean {
    const s = this.cmds.get(cmd);
    if (!s) return false;
    // 押し直し（エッジ）は必ず通す。止めるのは長押しの連射だけ
    if (s.edge) {
      s.repeatBlocked = false;
      return true;
    }
    if (s.repeatBlocked) return false;
    return this.repeatFires(s, kind);
  }

  private repeatFires(s: KeyState, kind: keyof typeof REPEAT): boolean {
    const cfg = REPEAT[kind] as {
      delay: number; interval: number; fastAfter?: number; fastInterval?: number;
    };
    const elapsed = this.now - s.pressedAt;
    if (elapsed < cfg.delay) return false;
    const interval = cfg.fastAfter !== undefined && s.repeatCount >= cfg.fastAfter
      ? (cfg.fastInterval ?? cfg.interval)
      : cfg.interval;
    if (this.now - s.lastRepeatAt < interval) return false;
    s.lastRepeatAt = this.now;
    s.repeatCount++;
    return true;
  }

  /**
   * 方向のリピートを止める。
   * 被弾・敵の出現・フロア移動のときに呼び、走り続ける事故を防ぐ。
   */
  /**
   * 危険が起きたので、押しっぱなしの移動と連射を止める。
   *
   * 押し直すまで復帰しない。これが無いと、「.」を押している間は
   * 毎秒 8 ターン進み続け、殴られながら止まれない。
   */
  latchDirection(): void {
    this.dirLatched = true;
    for (const s of this.cmds.values()) s.repeatBlocked = true;
  }

  get isDirectionLatched(): boolean {
    return this.dirLatched;
  }

  /** 斜め合成の猶予中か（単発入力の確定を待っている） */
  isWaitingForDiagonal(): boolean {
    if (!this.pendingDir) return false;
    if (this.numpadOnlyDiagonal) return false;
    return this.now - this.pendingDir.at < this.diagWindowMs;
  }

  // ------------------------------------------------------------ 表示用

  /** 表示用のキー名 */
  static keyLabel(code: string): string {
    const table: Record<string, string> = {
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Enter: 'Enter', NumpadEnter: '[Enter]', Space: 'Space',
      Backspace: 'BackSpace', Escape: 'Esc', Tab: 'Tab', Period: '.',
      ShiftLeft: 'Shift', ShiftRight: 'Shift',
      NumpadAdd: '[+]', NumpadSubtract: '[-]', NumpadMultiply: '[*]',
      NumpadDivide: '[/]', NumpadDecimal: '[.]',
    };
    if (table[code]) return table[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return `[${code.slice(6)}]`;
    return code;
  }

  /** そのコマンドに割り当てられた code 一覧（ヘルプ画面用） */
  static keysFor(cmd: Cmd): string[] {
    const out: string[] = [];
    for (const [code, c] of Object.entries(KEY_TO_CMD)) if (c === cmd) out.push(code);
    for (const [code, list] of Object.entries(DUAL_KEYS)) {
      if (list.includes(cmd)) out.push(code);
    }
    if (cmd === Cmd.Stairs) out.push('Shift+Period');
    return out;
  }

  /**
   * キー割り当ての衝突を調べる。
   * 「同じ code が 2 つの機能に割り当てられている」ものを返す。
   * KeyX だけは B とダッシュを意図的に兼ねているので除外する。
   */
  static findConflicts(): Array<{ code: string; cmds: Cmd[] }> {
    const seen = new Map<string, Cmd[]>();
    const push = (code: string, cmd: Cmd): void => {
      const list = seen.get(code);
      if (list) list.push(cmd);
      else seen.set(code, [cmd]);
    };
    for (const [code, cmd] of Object.entries(KEY_TO_CMD)) push(code, cmd);
    for (const code of Object.keys(KEY_TO_AXIS)) push(code, 'DIR' as Cmd);
    for (const code of Object.keys(KEY_TO_DIAGONAL)) push(code, 'DIAG' as Cmd);
    const out: Array<{ code: string; cmds: Cmd[] }> = [];
    for (const [code, cmds] of seen) {
      if (cmds.length > 1) out.push({ code, cmds });
    }
    return out;
  }
}

export const input = new InputManager();
