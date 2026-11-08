import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadPageCommands } from '../src/read-page-commands.mjs';

function setup() {
  let time = 1000;
  const opened = [], messages = [];
  const browser = {
    sidePanel: { open: options => { opened.push(options); return Promise.resolve(); } },
    runtime: { sendMessage: async message => { messages.push(message); } }
  };
  const commands = createReadPageCommands(browser, () => time);
  return { ...commands, opened, messages, browser, advance: ms => { time += ms; } };
}

test('shortcut opens synchronously, queues a cold panel read, and consumes it once', async () => {
  const commands = setup();
  const opening = commands.handle('read-job-page', { id: 12, windowId: 4 });
  assert.deepEqual(commands.opened, [{ windowId: 4 }], 'open retains the command user gesture');
  await opening;
  assert.deepEqual(commands.messages, [{ type: 'job.read-requested', windowId: 4 }]);
  assert.equal(commands.take(99), null, 'another window cannot claim the request');
  assert.deepEqual(commands.take(4), { tabId: 12, windowId: 4, createdAt: 1000 });
  assert.equal(commands.take(4), null, 'startup and notification cannot duplicate the read');
});

test('queued reads stay in their window and repeated shortcuts select the latest source tab', async () => {
  const commands = setup();
  await commands.handle('read-job-page', { id: 12, windowId: 4 });
  await commands.handle('read-job-page', { id: 13, windowId: 5 });
  await commands.handle('read-job-page', { id: 14, windowId: 4 });
  assert.equal(commands.take(4).tabId, 14);
  assert.equal(commands.take(5).tabId, 13);
});

test('stale reads and unrelated or invalid commands cannot trigger extraction', async () => {
  const commands = setup();
  commands.handle('_execute_action', { id: 12, windowId: 4 });
  commands.handle('read-job-page');
  commands.handle('read-job-page', { id: -1, windowId: 4 });
  commands.handle('read-job-page', { id: 12, windowId: -1 });
  assert.equal(commands.opened.length, 0);
  await commands.handle('read-job-page', { id: 12, windowId: 4 });
  commands.advance(30000);
  assert.equal(commands.take(4), null);
});

test('a closed panel keeps its queued read when there is no notification listener', async () => {
  const commands = setup();
  commands.browser.runtime.sendMessage = async () => { throw new Error('No receiver'); };
  await commands.handle('read-job-page', { id: 12, windowId: 4 });
  assert.equal(commands.take(4).tabId, 12);
});

test('a failed panel open clears its queued read', async () => {
  const commands = setup();
  commands.browser.sidePanel.open = async () => { throw new Error('Open failed'); };
  const original = console.error;
  console.error = () => {};
  try {
    await commands.handle('read-job-page', { id: 12, windowId: 4 });
    assert.equal(commands.take(4), null);
  } finally { console.error = original; }
});
