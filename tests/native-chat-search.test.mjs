import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/native-chat-search.js', import.meta.url), 'utf8');
function node(name, onClick = () => {}) {
  return { isConnected: true, textContent: name, getClientRects: () => [1], closest: () => null, matches: () => false,
    getAttribute: key => key === 'aria-label' ? name : null, click: onClick };
}
class SearchInput {
  constructor() { this.isConnected = true; this.type = 'text'; this.events = []; }
  set value(value) { this.current = value; }
  get value() { return this.current || ''; }
  getClientRects() { return [1]; }
  closest(selector) { return selector.includes('dialog') ? {} : null; }
  matches() { return false; }
  hasAttribute() { return false; }
  getAttribute(key) { return key === 'placeholder' ? 'Search chats' : null; }
  focus() { this.focused = true; }
  dispatchEvent(event) { this.events.push(event.type); }
}
function setup() {
  const nodes = [], inputs = [];
  const document = { querySelectorAll: selector => selector === 'input' ? inputs : nodes, body: { dispatchEvent() {} } };
  class Event { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const context = vm.createContext({ document, getComputedStyle: () => ({ visibility: 'visible' }), setTimeout,
    HTMLInputElement: SearchInput, InputEvent: Event, Event, KeyboardEvent: Event });
  vm.runInContext(source, context);
  return { nodes, inputs, document, open: context.AiAgentNativeSearch };
}
test('direct search handles joined shortcut labels and fills only the native search field', async () => {
  const { nodes, inputs, open } = setup();
  const input = new SearchInput();
  const forbidden = () => { throw new Error('Unrelated control clicked'); };
  nodes.push(node('Search web', forbidden), node('Send', forbidden), node('Search chatsCtrlK', () => inputs.push(input)));
  assert.equal(await open({ query: 'older resume' }), true);
  assert.equal(input.value, 'older resume');
  assert.equal(input.focused, true);
  assert.deepEqual(input.events, ['input', 'change']);
});
test('missing native search returns unavailable without clicking an unrelated control', async () => {
  const { nodes, open } = setup(); nodes.push(node('Search web'), node('Send'));
  assert.equal(await open({ provider: 'deepseek' }), false);
});
test('native search can reveal the provider sidebar and confirms an actual search input appeared', async () => {
  const { nodes, inputs, open } = setup();
  nodes.push(node('Open sidebar', () => nodes.push(node('Search chats', () => inputs.push(new SearchInput())))));
  assert.equal(await open({ query: 'interview' }), true);
  assert.equal(inputs[0].value, 'interview');
});
test('ChatGPT shortcut fallback is verified through the search input, rather than claiming dispatch succeeded', async () => {
  const { inputs, document, open } = setup();
  document.body.dispatchEvent = event => { if (event.type === 'keydown' && event.ctrlKey && event.key === 'k') inputs.push(new SearchInput()); };
  assert.equal(await open({ query: 'project notes' }), true);
  assert.equal(inputs[0].value, 'project notes');
});
test('oversized queries are rejected before opening a search control', async () => {
  const { nodes, open } = setup(); nodes.push(node('Search chats', () => { throw new Error('Should not open'); }));
  assert.equal(await open({ query: 'x'.repeat(1001) }), false);
});

test('a provider that discards the query is reported as unavailable', async () => {
  const { inputs, open } = setup();
  const input = new SearchInput();
  input.dispatchEvent = () => { input.value = ''; };
  inputs.push(input);
  assert.equal(await open({ query: 'keep this query' }), false);
});
