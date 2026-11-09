import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ariaShortcut, readPageShortcut, updateReadPageHint } from '../src/shortcut-settings.mjs';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
function browser(shortcut, os = 'win') {
  return {
    runtime: { getManifest: () => manifest, getPlatformInfo: async () => ({ os }) },
    commands: { getAll: async () => [{ name: 'read-job-page', shortcut }] }
  };
}

test('the current Chrome assignment is separate from the new Read page default', async () => {
  assert.deepEqual(await readPageShortcut(browser('Ctrl+Shift+S')), {
    shortcut: 'Ctrl+Shift+S', defaultShortcut: 'Ctrl+Shift+F', state: 'assigned'
  });
  assert.equal((await readPageShortcut(browser('Command+Shift+S', 'mac'))).defaultShortcut, 'Command+Shift+F');
});

test('unassigned and unreadable shortcuts never claim the default is active', async () => {
  assert.deepEqual(await readPageShortcut(browser('')), {
    shortcut: '', defaultShortcut: 'Ctrl+Shift+F', state: 'unassigned'
  });
  const unavailable = browser('');
  unavailable.commands.getAll = async () => { throw new Error('Unavailable'); };
  unavailable.runtime.getPlatformInfo = async () => { throw new Error('Unavailable'); };
  assert.deepEqual(await readPageShortcut(unavailable), {
    shortcut: '', defaultShortcut: 'Ctrl+Shift+F (Command+Shift+F on macOS)', state: 'unknown'
  });
});

test('Chrome modifier names and macOS symbols have accessible shortcut equivalents', () => {
  assert.equal(ariaShortcut('Ctrl+Shift+F'), 'Control+Shift+F');
  assert.equal(ariaShortcut('Command+Shift+F'), 'Meta+Shift+F');
  assert.equal(ariaShortcut('\u2318\u21e7F'), 'Meta+Shift+F');
  assert.equal(ariaShortcut('\u2303\u2325F'), 'Control+Alt+F');
});

test('Read page retains the active shortcut hint after extraction and assignment changes', () => {
  const button = { dataset: { shortcut: 'Ctrl+Shift+F' }, title: '' };
  updateReadPageHint(button, 'Job details read.');
  assert.match(button.title, /\(Ctrl\+Shift\+F\)\.\nJob details read\./);
  button.dataset.shortcut = 'Ctrl+Shift+S';
  updateReadPageHint(button);
  assert.match(button.title, /\(Ctrl\+Shift\+S\)\.\nJob details read\./);
  button.dataset.shortcut = '';
  updateReadPageHint(button);
  assert.doesNotMatch(button.title, /Ctrl\+/);
  assert.match(button.title, /Job details read\./);
});
