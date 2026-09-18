/**
 * 起動とゲームループ。
 *
 * index.html から `boot(canvas)` が呼ばれる。
 * ここで入力・音・セーブを繋ぎ、画面を切り替えながら毎フレーム描画する。
 */

import { audio } from './core/audio.js';
import { input } from './core/input.js';
import {
  clearAll, clearRun, loadRun, loadSettings, loadTown, saveRun, saveSettings, saveTown,
  loadReplay, saveReplay,
} from './core/save.js';
import type { ItemInstance, RunState, Settings, TownState } from './core/types.js';
import { getDungeon, validateData } from './data/registry.js';
import { attachFactories, startRun } from './game/run.js';
import { finishRun } from './game/town.js';
import { World } from './game/world.js';
import { Recorder } from './game/recorder.js';
import { MessageLog } from './ui/log.js';
import { loadAllSprites } from './ui/spriteData.js';
import { SCREEN_H, SCREEN_W } from './ui/theme.js';
import { animScale, messageCps, type App, type Screen } from './ui/screens/app.js';
import { DungeonScreen } from './ui/screens/dungeon.js';
import { ResultScreen, type ResultData } from './ui/screens/result.js';
import { TitleScreen } from './ui/screens/title.js';
import { TownScreen } from './ui/screens/town.js';

class Game implements App {
  readonly input = input;
  readonly audio = audio;
  readonly log = new MessageLog();
  readonly recorder = new Recorder();
  settings: Settings;
  town: TownState;
  current: Screen | null = null;

  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private lastTime = 0;
  private running = false;
  private dungeonScreen: DungeonScreen | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('2D コンテキストを取得できませんでした');
    this.g = g;
    this.settings = loadSettings();
    this.town = loadTown();
  }

  // ------------------------------------------------------------ 起動

  start(): void {
    const errors = validateData();
    if (errors.length > 0) {
      // データが壊れているまま遊ばせない
      throw new Error(`データ不整合:\n${errors.slice(0, 10).join('\n')}`);
    }
    this.loadSprites();

    input.attach();
    input.onFirstInput = () => audio.unlock();
    this.applySettings();

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      audio.handleVisibility(document.hidden);
    });
    window.addEventListener('beforeunload', () => this.persist());
    this.onResize();

    this.goTo(this.makeTitle());
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** ドット絵を読み込む。不備があれば警告だけ出して遊べる状態は保つ */
  private loadSprites(): void {
    const { count, errors } = loadAllSprites();
    if (errors.length > 0) {
      console.warn(`ドット絵の不備 ${errors.length} 件:`, errors.slice(0, 20));
    }
    if (count === 0) {
      console.warn('ドット絵が 1 つも登録されていません。図形で代替します。');
    }
  }

  // ------------------------------------------------------------ 画面

  private makeTitle(): TitleScreen {
    return new TitleScreen(
      this,
      (resume) => {
        if (resume) this.resumeRun();
      },
      () => this.goTo(this.makeTown()),
    );
  }

  private makeTown(): TownScreen {
    return new TownScreen(
      this,
      (dungeonId, bring) => this.beginRun(dungeonId, bring),
      () => this.goTo(this.makeTitle()),
    );
  }

  private beginRun(dungeonId: string, bring: ItemInstance[]): void {
    // 写し取るのは潜る前。startRun は村のギタンを冒険へ移すので、
    // あとから写すと再生の出発点が本物と違ってしまう
    this.recorder.snapshot(this.town, bring);
    const world = startRun(dungeonId, this.town, { bring });
    this.recorder.begin(dungeonId, world.run.seed);
    const replay = this.recorder.current;
    if (replay) saveReplay(replay);
    this.enterDungeon(world);
  }

  private resumeRun(): void {
    const run = loadRun();
    if (!run) {
      this.goTo(this.makeTitle());
      return;
    }
    try {
      const world = new World(run, getDungeon(run.dungeonId));
      attachFactories(world);
      // 記録も続きから。ここで拾わないと、再開後に見つけた不具合を再現できない
      const replay = loadReplay();
      if (replay && replay.dungeonId === run.dungeonId && replay.seed === run.seed) {
        this.recorder.resume(replay);
      } else {
        this.recorder.clear();
      }
      this.enterDungeon(world);
    } catch {
      // 中断データが壊れていた
      clearRun();
      this.log.add('中断データを 読み込めませんでした。', 'warning', performance.now());
      this.goTo(this.makeTown());
    }
  }

  private enterDungeon(world: World): void {
    this.log.clear();
    const screen = new DungeonScreen(
      this,
      world,
      (kind, reason) => this.endRun(world, kind, reason),
      () => {
        // 中断。自動保存を止めないと、村やタイトルにいる間も
        // 古い world を書き続けてしまう
        this.stopAutoSave();
        this.dungeonScreen = null;
        this.goTo(this.makeTitle());
      },
    );
    this.dungeonScreen = screen;
    this.goTo(screen);
    // 定期的に中断データを保存する（不意の終了に備えて）
    this.startAutoSave(world);
  }

  private autoSaveTimer: number | null = null;

  private startAutoSave(world: World): void {
    this.stopAutoSave();
    this.autoSaveTimer = setInterval(() => {
      if (world.finished) return;
      saveRun(world.syncForSave());
      const replay = this.recorder.current;
      if (replay) saveReplay(replay);
    }, 20000) as unknown as number;
  }

  private stopAutoSave(): void {
    if (this.autoSaveTimer !== null) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  private endRun(world: World, kind: 'clear' | 'death' | 'escape', reason: string): void {
    this.stopAutoSave();
    clearRun();
    // 記録は消さない。倒れたあと、結果画面や村から書き出せるようにしておく
    const replay = this.recorder.current;
    if (replay) saveReplay(replay);
    const result = finishRun(world, this.town, kind, reason);
    result.record.at = Date.now();
    this.persist();
    this.dungeonScreen = null;

    const data: ResultData = {
      record: result.record,
      kind,
      rewardMessage: result.rewardMessage,
      unlockedName: result.unlocked ? getDungeon(result.unlocked).name : null,
      lost: result.lost,
      stats: {
        kills: world.run.stats.kills,
        itemsFound: world.run.stats.itemsFound,
        gitanEarned: world.run.stats.gitanEarned,
        damageDealt: world.run.stats.damageDealt,
        damageTaken: world.run.stats.damageTaken,
      },
    };
    this.goTo(new ResultScreen(this, data, () => this.goTo(this.makeTown())));
  }

  goTo(screen: Screen): void {
    this.current?.exit?.();
    this.current = screen;
    input.releaseAll();
    screen.enter?.();
  }

  // ------------------------------------------------------------ 設定と保存

  applySettings(): void {
    audio.setSettings({
      master: this.settings.masterVolume,
      sfx: this.settings.sfxVolume,
      bgm: this.settings.bgmVolume,
      muted: this.settings.muted,
    });
    this.log.cps = messageCps(this.settings.messageSpeed);
    input.numpadOnlyDiagonal = !this.settings.diagonalFree;
    this.dungeonScreen?.applySettings();
    void animScale;
  }

  persist(): void {
    // 「はじめから」で消したあとは二度と書き戻さない。
    // beforeunload の persist() が走ると、消したはずの記録が復活する
    if (this.wiped) return;
    saveSettings(this.settings);
    saveTown(this.town);
  }

  /** 「はじめから」。記録を消し、以後の保存を止めてから読み込み直す */
  resetAll(): void {
    this.wiped = true;
    this.stopAutoSave();
    clearAll();
    window.location.reload();
  }

  private wiped = false;

  // ------------------------------------------------------------ ループ

  private onResize = (): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const availW = window.innerWidth;
    const availH = window.innerHeight;
    // 論理解像度を保ったまま、画面に収まる最大の倍率で拡大する
    const scale = Math.min(availW / SCREEN_W, availH / SCREEN_H);
    this.canvas.style.width = `${Math.floor(SCREEN_W * scale)}px`;
    this.canvas.style.height = `${Math.floor(SCREEN_H * scale)}px`;
    this.canvas.width = Math.floor(SCREEN_W * dpr);
    this.canvas.height = Math.floor(SCREEN_H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.g.imageSmoothingEnabled = false;
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    // タブが裏に回っていた間の巨大な dt でロジックが飛ばないよう上限を設ける
    const dt = Math.min(64, now - this.lastTime);
    this.lastTime = now;

    input.beginFrame(now);
    try {
      this.current?.update(dt, now);
      this.g.save();
      this.g.setTransform(
        this.canvas.width / SCREEN_W, 0, 0, this.canvas.height / SCREEN_H, 0, 0,
      );
      this.g.imageSmoothingEnabled = false;
      this.current?.draw(this.g, now);
      this.g.restore();
    } catch (e) {
      this.running = false;
      this.drawCrash(e);
      throw e;
    }
    // 押下エッジを消すのはフレームの最後。ここより前で消すと
    // このフレームに届いた入力を画面が観測できないまま捨ててしまう
    input.endFrame();
    requestAnimationFrame(this.frame);
  };

  /** 例外で止まったとき、真っ黒な画面ではなく事情を出す */
  private drawCrash(e: unknown): void {
    const g = this.g;
    g.save();
    g.setTransform(this.canvas.width / SCREEN_W, 0, 0, this.canvas.height / SCREEN_H, 0, 0);
    g.fillStyle = '#12060a';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    g.fillStyle = '#ff8080';
    g.font = '22px monospace';
    g.fillText('予期しないエラーで 停止しました', 40, 60);
    g.font = '14px monospace';
    const message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    message.split('\n').slice(0, 20).forEach((line, i) => {
      g.fillText(line.slice(0, 110), 40, 100 + i * 20);
    });
    g.fillStyle = '#c0c0d0';
    g.fillText('ページを再読み込みしてください（冒険は 20 秒ごとに保存されています）', 40, SCREEN_H - 40);
    g.restore();
  }
}

let game: Game | null = null;

/** index.html から呼ばれる起動関数 */
export function boot(canvas: HTMLCanvasElement): void {
  game = new Game(canvas);
  game.start();
}

/** デバッグ用（コンソールから触れるように） */
export function currentGame(): unknown {
  return game;
}

export type { RunState };
