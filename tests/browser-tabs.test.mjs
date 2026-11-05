import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTabs } from '../src/browser-tabs.mjs';
import { AgentController } from '../src/controller.mjs';

function setup(ids = [1, 2, 3]) {
  let stored = {}, active = ids[0], closed = false;
  const activations = [], focus = [];
  const browser = {
    windows: { async get(id) { if (closed) throw Error(); return { id, type: id === 10 ? 'normal' : 'popup' }; }, async update(id) { focus.push(id); } },
    tabs: { async query({ windowId }) { assert.equal(windowId, 10); return ids.map((id, index) => ({ id, index, active: id === active })); }, async update(id) { activations.push(id); active = id; } },
  };
  const storage = { async get() { return stored; }, async set(value) { stored = { ...stored, ...value }; } };
  return { tabs: new BrowserTabs(browser, storage), browser, activations, focus, close() { closed = true; } };
}
test('Previous/Next wrap first/last in the associated browser window and serialize rapid clicks', async () => {
  const f = setup(); await f.tabs.bind(10);
  assert.equal((await f.tabs.move(-1)).tabId, 3);
  assert.equal((await f.tabs.move(1)).tabId, 1);
  await Promise.all([f.tabs.move(1), f.tabs.move(1)]);
  assert.deepEqual(f.activations, [3, 1, 2, 3]); assert.deepEqual(f.focus, [10, 10, 10, 10]);
});
test('single-tab navigation is a no-op; empty/closed windows cannot retarget another window', async () => {
  const single = setup([7]); await single.tabs.bind(10);
  assert.equal((await single.tabs.move(1)).count, 1); assert.deepEqual(single.activations, []);
  single.close(); assert.equal((await single.tabs.state()).available, false);
  await assert.rejects(single.tabs.move(-1), { code: 'browser_window_unavailable' });
  const empty = setup([]); await empty.tabs.bind(10); await assert.rejects(empty.tabs.move(1), { code: 'browser_window_unavailable' });
});
test('popup windows cannot be bound and invalid directions never activate a tab', async () => {
  const f = setup(); await assert.rejects(f.tabs.bind(20), { code: 'browser_window_unavailable' });
  await f.tabs.bind(10); await assert.rejects(f.tabs.move(2), { code: 'invalid_request' }); assert.deepEqual(f.activations, []);
});
test('agent tabs are excluded from adjacency without reading titles or URLs', async () => {
  const f = setup([1, 9, 2]); f.tabs.excludedTabs = async () => [9]; await f.tabs.bind(10);
  assert.equal((await f.tabs.state()).count, 2); assert.equal((await f.tabs.move(1)).tabId, 2);
});
test('navigation preserves prompt/input/model/effort/output and pending inference', async () => {
  const f = setup(); await f.tabs.bind(10); let finish;
  const session = { authenticated: true, user: { id: 'account', name: 'Name' } };
  const adapter = { async getSession() { return session; }, async signIn() {}, async signOut() {},
    async getModels() { return [{ id: 'model', thinkingEfforts: ['medium'] }]; }, async run() { return { text: 'Output' }; } };
  const c = new AgentController({ definition: { input: { value: 'Input' }, prompt: { value: 'Prompt' } }, adapter });
  await c.start(); await c.run();
  const snapshot = structuredClone(c.state); await f.tabs.move(1); await f.tabs.move(-1); assert.deepEqual(c.state, snapshot);
  adapter.run = () => new Promise(resolve => { finish = resolve; });
  const running = c.run(); await Promise.resolve(); const epoch = c.runEpoch;
  await f.tabs.move(1); assert.equal(c.state.busy, 'running'); assert.equal(c.runEpoch, epoch); assert.equal(c.runAbort.signal.aborted, false);
  finish('New output'); await running; assert.equal(c.state.result, 'New output');
});
