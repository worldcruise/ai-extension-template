import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatProviders, DEEPSEEK_HOME } from '../src/chat-providers.mjs';
import { deepseekEmbedRules } from '../src/sidebar-protocol.mjs';

function setup(saved = 'chatgpt', beforeChange = async () => {}, options={}) {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { hidden: id==='chat-view'&&!!options.lazy, value: '', listeners: {}, focusCalls: 0,
      addEventListener(name, listener) { this.listeners[name] = listener; },
      focus() { this.focusCalls++; },
      getAttribute(name) { return this[name] || null; } });
    return nodes.get(id);
  } };
  const writes = [], opened = [], selected = [], selectionSources = [];
  const browser = { storage: { local: { get: async () => ({ chatProvider: saved }), set: async value => writes.push(value) } },
    tabs: { create: async value => opened.push(value) } };
  return { connection: createChatProviders({ document, browser, beforeChange,...options,onSelect: (provider, source) => { selected.push(provider); selectionSources.push(source); } }), nodes, writes, opened, selected, selectionSources };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('collapsed workspace can restore DeepSeek selection without loading its page',async()=>{
  const {connection,nodes}=setup('deepseek',undefined,{lazy:true});await connection.ready;
  assert.equal(connection.current(),'deepseek');assert.equal(nodes.get('deepseek-frame').src,undefined);
  nodes.get('chat-view').hidden=false;connection.ensureCurrent();assert.equal(nodes.get('deepseek-frame').src,DEEPSEEK_HOME);
});

test('saved provider restores lazily and switching preserves both frame identities and routes', async () => {
  const { connection, nodes, writes, opened, selected } = setup();
  await connection.ready;
  assert.deepEqual(selected, [], 'restoring preferences does not open Chat');
  const frame = nodes.get('deepseek-frame'), select = nodes.get('chat-provider');
  assert.equal(frame.src, undefined);
  select.value = 'deepseek'; select.listeners.change(); await settle();
  assert.equal(frame.src, DEEPSEEK_HOME);
  assert.equal(nodes.get('chatgpt-pane').hidden, true);
  assert.equal(nodes.get('deepseek-pane').hidden, false);
  assert.deepEqual(selected, ['deepseek']);
  frame.src = DEEPSEEK_HOME + 'a/chat/s/kept';
  await connection.showChatGPT();
  assert.deepEqual(selected, ['deepseek'], 'programmatic selection does not dismiss menus');
  select.value = 'deepseek'; select.listeners.change(); await settle();
  assert.equal(frame.src, DEEPSEEK_HOME + 'a/chat/s/kept');
  assert.equal(nodes.get('deepseek-frame'), frame);
  assert.deepEqual(writes.at(-1), { chatProvider: 'deepseek' });
  nodes.get('deepseek-open').listeners.click(); await settle();
  assert.deepEqual(opened, [{ url: DEEPSEEK_HOME }]);
  const restored = setup('deepseek'); await restored.connection.ready;
  assert.equal(restored.connection.current(), 'deepseek');
});

test('active-job guard rejects switching without loading DeepSeek or saving preference', async () => {
  const { connection, nodes, writes, selected } = setup('chatgpt', async () => { throw new Error('Job active'); });
  await connection.ready;
  const select = nodes.get('chat-provider'); select.value = 'deepseek'; select.listeners.change(); await settle();
  assert.equal(connection.current(), 'chatgpt');
  assert.equal(select.value, 'chatgpt');
  assert.equal(nodes.get('deepseek-frame').src, undefined);
  assert.equal(nodes.get('provider-status').textContent, 'Job active');
  assert.deepEqual(writes, []);
  assert.deepEqual(selected, [], 'rejected selection leaves the menu open');
});

test('bottom selector switches and persists the provider while synchronizing menu and settings', async () => {
  const { connection, nodes, writes, selected, selectionSources } = setup('deepseek');
  await connection.ready;
  for (const id of ['chat-provider', 'workflow-provider', 'dock-chat-provider']) assert.equal(nodes.get(id).value, 'deepseek');
  assert.deepEqual(selected, [], 'restoring a provider does not expand chat');
  const frame = nodes.get('deepseek-frame'); frame.src = DEEPSEEK_HOME + 'a/chat/s/preserved';
  const dock = nodes.get('dock-chat-provider'); dock.value = 'chatgpt'; dock.listeners.change(); await settle();
  for (const id of ['chat-provider', 'workflow-provider', 'dock-chat-provider']) assert.equal(nodes.get(id).value, 'chatgpt');
  assert.deepEqual(writes.at(-1), { chatProvider: 'chatgpt' });
  assert.deepEqual(selected, ['chatgpt']); assert.deepEqual(selectionSources, ['dock']);
  assert.equal(dock.focusCalls, 1, 'provider selection retains keyboard focus in the bottom bar');
  assert.equal(frame.src, DEEPSEEK_HOME + 'a/chat/s/preserved');
  const settings = nodes.get('workflow-provider'); settings.value = 'deepseek'; settings.listeners.change(); await settle();
  assert.equal(dock.value, 'deepseek'); assert.equal(nodes.get('chat-provider').value, 'deepseek');
  assert.deepEqual(selected, ['chatgpt'], 'Settings changes do not expand chat');
  assert.equal(frame.src, DEEPSEEK_HOME + 'a/chat/s/preserved');
});

test('bottom selector shares pending and rejected-switch states with the other controls', async () => {
  let reject;
  const pending = new Promise((_, rejectPromise) => { reject = rejectPromise; });
  const { connection, nodes, writes, selected } = setup('chatgpt', () => pending);
  await connection.ready;
  const dock = nodes.get('dock-chat-provider'); dock.value = 'deepseek'; dock.listeners.change();
  for (const id of ['chat-provider', 'workflow-provider', 'dock-chat-provider']) assert.equal(nodes.get(id).disabled, true);
  reject(new Error('Finish the current action first.')); await settle();
  for (const id of ['chat-provider', 'workflow-provider', 'dock-chat-provider']) {
    assert.equal(nodes.get(id).disabled, false); assert.equal(nodes.get(id).value, 'chatgpt');
  }
  assert.equal(nodes.get('dock-provider-status').textContent, 'Finish the current action first.');
  assert.equal(nodes.get('provider-status').textContent, 'Finish the current action first.');
  assert.equal(dock.title, 'Finish the current action first.');
  assert.equal(nodes.get('deepseek-frame').src, undefined);
  assert.deepEqual(writes, []); assert.deepEqual(selected, []);
});

test('DeepSeek header changes only match its HTTPS host in extension subframes', () => {
  const [rule] = deepseekEmbedRules('extension-id');
  assert.deepEqual(rule.condition.initiatorDomains, ['extension-id']);
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  const pattern = new RegExp(rule.condition.regexFilter);
  assert.equal(pattern.test(DEEPSEEK_HOME), true);
  for (const url of ['http://chat.deepseek.com/', 'https://chat.deepseek.com.evil.test/', 'https://deepseek.com/']) assert.equal(pattern.test(url), false);
});
