import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatProviders, DEEPSEEK_HOME } from '../src/chat-providers.mjs';
import { deepseekEmbedRules } from '../src/sidebar-protocol.mjs';

function setup(saved = 'chatgpt', beforeChange = async () => {}) {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, value: '', listeners: {},
      addEventListener(name, listener) { this.listeners[name] = listener; },
      getAttribute(name) { return this[name] || null; } });
    return nodes.get(id);
  } };
  const writes = [], opened = [];
  const browser = { storage: { local: { get: async () => ({ chatProvider: saved }), set: async value => writes.push(value) } },
    tabs: { create: async value => opened.push(value) } };
  return { connection: createChatProviders({ document, browser, beforeChange }), nodes, writes, opened };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('saved provider restores lazily and switching preserves both frame identities and routes', async () => {
  const { connection, nodes, writes, opened } = setup();
  await connection.ready;
  const frame = nodes.get('deepseek-frame'), select = nodes.get('chat-provider');
  assert.equal(frame.src, undefined);
  select.value = 'deepseek'; select.listeners.change(); await settle();
  assert.equal(frame.src, DEEPSEEK_HOME);
  assert.equal(nodes.get('chatgpt-pane').hidden, true);
  assert.equal(nodes.get('deepseek-pane').hidden, false);
  frame.src = DEEPSEEK_HOME + 'a/chat/kept';
  await connection.showChatGPT();
  select.value = 'deepseek'; select.listeners.change(); await settle();
  assert.equal(frame.src, DEEPSEEK_HOME + 'a/chat/kept');
  assert.equal(nodes.get('deepseek-frame'), frame);
  assert.deepEqual(writes.at(-1), { chatProvider: 'deepseek' });
  nodes.get('deepseek-open').listeners.click(); await settle();
  assert.deepEqual(opened, [{ url: DEEPSEEK_HOME }]);
  const restored = setup('deepseek'); await restored.connection.ready;
  assert.equal(restored.connection.current(), 'deepseek');
});

test('active-job guard rejects switching without loading DeepSeek or saving preference', async () => {
  const { connection, nodes, writes } = setup('chatgpt', async () => { throw new Error('Job active'); });
  await connection.ready;
  const select = nodes.get('chat-provider'); select.value = 'deepseek'; select.listeners.change(); await settle();
  assert.equal(connection.current(), 'chatgpt');
  assert.equal(select.value, 'chatgpt');
  assert.equal(nodes.get('deepseek-frame').src, undefined);
  assert.equal(nodes.get('provider-status').textContent, 'Job active');
  assert.deepEqual(writes, []);
});

test('DeepSeek header changes only match its HTTPS host in extension subframes', () => {
  const [rule] = deepseekEmbedRules('extension-id');
  assert.deepEqual(rule.condition.initiatorDomains, ['extension-id']);
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  const pattern = new RegExp(rule.condition.regexFilter);
  assert.equal(pattern.test(DEEPSEEK_HOME), true);
  for (const url of ['http://chat.deepseek.com/', 'https://chat.deepseek.com.evil.test/', 'https://deepseek.com/']) assert.equal(pattern.test(url), false);
});
