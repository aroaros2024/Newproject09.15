import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cmd, InputManager, REPEAT } from '../src/core/input.js';

test('キー割り当てに衝突が無い', () => {
  const conflicts = InputManager.findConflicts();
  assert.deepEqual(
    conflicts, [],
    `キーが衝突している:\n${conflicts.map((c) => `${c.code}: ${c.cmds.join(', ')}`).join('\n')}`,
  );
});

test('主要なコマンドにキーが割り当てられている', () => {
  const required: Cmd[] = [
    Cmd.A, Cmd.B, Cmd.X, Cmd.Y, Cmd.L, Cmd.R, Cmd.Dash,
    Cmd.Map, Cmd.Minimap, Cmd.Wait, Cmd.Stairs, Cmd.Log, Cmd.Help,
    Cmd.MenuItem, Cmd.MenuSpecial, Cmd.MenuTactics,
  ];
  for (const cmd of required) {
    assert.ok(InputManager.keysFor(cmd).length > 0, `${cmd} にキーが無い`);
  }
});

test('Ctrl / Alt / Meta は使わない', () => {
  for (const cmd of Object.values(Cmd)) {
    for (const code of InputManager.keysFor(cmd)) {
      assert.ok(!/^(Control|Alt|Meta)/.test(code), `${cmd} に修飾キー ${code} を使っている`);
    }
  }
});

test('WASD は移動専用で、ボタンには使われていない', () => {
  const movement = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
  for (const cmd of Object.values(Cmd)) {
    for (const code of InputManager.keysFor(cmd)) {
      assert.ok(!movement.has(code), `${cmd} が移動キー ${code} を奪っている`);
    }
  }
});

test('テンキーだけで全操作が完結する', () => {
  const needsNumpad: Cmd[] = [Cmd.A, Cmd.B, Cmd.X, Cmd.Y, Cmd.L, Cmd.R, Cmd.Dash, Cmd.Wait];
  for (const cmd of needsNumpad) {
    const keys = InputManager.keysFor(cmd);
    assert.ok(
      keys.some((k) => k.startsWith('Numpad')),
      `${cmd} にテンキーが割り当てられていない（${keys.join(', ')}）`,
    );
  }
});

test('キー名の表示が読みやすい形になる', () => {
  assert.equal(InputManager.keyLabel('KeyZ'), 'Z');
  assert.equal(InputManager.keyLabel('ArrowUp'), '↑');
  assert.equal(InputManager.keyLabel('Numpad5'), '[5]');
  assert.equal(InputManager.keyLabel('Period'), '.');
});

test('リピート設定が用途ごとに妥当な範囲にある', () => {
  for (const [name, cfg] of Object.entries(REPEAT)) {
    assert.ok(cfg.delay >= 100 && cfg.delay <= 600, `${name}: 初回ディレイが極端`);
    assert.ok(cfg.interval >= 20 && cfg.interval <= 200, `${name}: 反復間隔が極端`);
    assert.ok(cfg.delay > cfg.interval, `${name}: 初回ディレイが反復間隔より短い`);
  }
  // メニューは移動よりきびきび動く
  assert.ok(REPEAT.menu.interval < REPEAT.move.interval);
});
