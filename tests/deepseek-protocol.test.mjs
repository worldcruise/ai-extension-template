import test from 'node:test';
import assert from 'node:assert/strict';
import { deepseekRoute, deepseekState, deepseekRoutes, DEEPSEEK_CHANNEL, createDeepseekTransport } from '../src/deepseek-protocol.mjs';

test('DeepSeek history accepts only its own conversation routes and preserves loaded order without wrapping', () => {
  const urls = ['https://chat.deepseek.com/a/chat/s/abc', 'https://chat.deepseek.com/a/chat/s/def'];
  assert.equal(deepseekRoute(urls[0] + '?private=value'), urls[0]);
  assert.equal(deepseekRoute(urls[0] + '/?private=value#fragment'), urls[0]);
  for (const url of ['https://chat.deepseek.com/a/chat/abc', 'https://chat.deepseek.com/a/chat/s/', 'https://chat.deepseek.com/a/chat/s/abc/extra']) assert.equal(deepseekRoute(url), null);
  for (const url of ['https://evil.test/a/chat/s/a', 'https://chat.deepseek.com.evil.test/', 'https://user@chat.deepseek.com/', 'https://chat.deepseek.com/sign_in', 'javascript:alert(1)']) assert.equal(deepseekRoute(url), null);
  assert.equal(deepseekRoutes.target(urls, 'https://chat.deepseek.com/', 1), urls[0]);
  assert.equal(deepseekRoutes.target(urls, urls[0], -1), null);
  assert.equal(deepseekRoutes.target(urls, urls[1], 1), null);
  assert.equal(deepseekRoutes.target(urls, urls[0] + '?private=value', 1), urls[1]);
  const pinned = 'https://chat.deepseek.com/a/chat/s/pinned';
  assert.equal(deepseekRoutes.target([pinned, ...urls], 'https://chat.deepseek.com/', 1, [pinned]), urls[0]);
  assert.equal(deepseekRoutes.target(urls, pinned, 1, [pinned]), urls[0]);
  assert.equal(deepseekRoutes.target(urls, pinned, -1, [pinned]), null);
  assert.equal(deepseekRoutes.target([pinned], pinned, 1, [pinned]), null);
});

function fakePort() {
  return { messages: [], started: false, closed: false,
    postMessage(data) { this.messages.push(data); },
    start() { this.started = true; }, close() { this.closed = true; } };
}
test('DeepSeek transport never posts commands to the initial extension-origin window', () => {
  const frame = { contentWindow: { postMessage() { throw new Error('Must not use window postMessage'); } } };
  const transport = createDeepseekTransport({ frame, onData() {}, onConnect() {} });
  assert.equal(transport.send({ action: 'probe' }), false);
  const port = fakePort(), hello = { source: frame.contentWindow, origin: 'https://chat.deepseek.com', data: { channel: DEEPSEEK_CHANNEL, type: 'hello' }, ports: [port] };
  assert.equal(transport.accept({ ...hello, origin: 'chrome-extension://example' }), false);
  assert.equal(transport.accept({ ...hello, source: {} }), false);
  assert.equal(transport.accept({ ...hello, ports: [] }), false);
  assert.equal(transport.send({ action: 'probe' }), false);
  assert.equal(transport.accept(hello), true);
  assert.equal(port.started, true);
  assert.equal(transport.send({ action: 'probe' }), true);
  assert.deepEqual(port.messages, [{ action: 'probe' }]);
  transport.close();
});
test('DeepSeek navigation replaces the old port and ignores its queued responses', () => {
  const frame = { contentWindow: {} }, received = [];
  let connects = 0;
  const transport = createDeepseekTransport({ frame, onData: data => received.push(data), onConnect: () => connects++ });
  const hello = port => ({ source: frame.contentWindow, origin: 'https://chat.deepseek.com', data: { channel: DEEPSEEK_CHANNEL, type: 'hello' }, ports: [port] });
  const old = fakePort(), next = fakePort(); transport.accept(hello(old));
  const staleHandler = old.onmessage;
  transport.accept(hello(next));
  staleHandler({ data: 'stale' }); next.onmessage({ data: 'current' });
  assert.equal(old.closed, true);
  assert.deepEqual(received, ['current']); assert.equal(connects, 2);
  next.onmessageerror();
  assert.equal(transport.send({ action: 'probe' }), false);
  assert.equal(next.closed, true);
});

test('DeepSeek state requires its frame, origin and nonce and bounds history payloads', () => {
  const source = {}, nonce = 'current';
  const event = { source, origin: 'https://chat.deepseek.com', data: { channel: DEEPSEEK_CHANNEL, type: 'state', nonce,
    url: 'https://chat.deepseek.com/', ready: true, hasDraft: false, busy: false,
    chats: [{ url: 'https://chat.deepseek.com/a/chat/s/abc', title: 'Literal title' }] } };
  assert.equal(deepseekState(event, source, nonce).chats[0].title, 'Literal title');
  assert.equal(deepseekState(event, source, nonce).hasFormInput, false);
  assert.equal(deepseekState({ ...event, data: { ...event.data, hasFormInput: true } }, source, nonce).hasFormInput, true);
  assert.equal(deepseekState({ ...event, data: { ...event.data, hasFormInput: 'private input' } }, source, nonce), null);
  assert.equal(deepseekState({ ...event, data: { ...event.data, loaded: false, chats: [] } }, source, nonce).loaded, false);
  assert.equal(deepseekState({ ...event, data: { ...event.data, loaded: 'yes' } }, source, nonce), null);
  assert.equal(deepseekState({ ...event, data: { ...event.data, pinnedUrls: ['https://evil.test/a/chat/s/pin'] } }, source, nonce), null);
  assert.equal(deepseekState({ ...event, data: { ...event.data, pinnedUrls: Array(301).fill(event.data.chats[0].url) } }, source, nonce), null);
  assert.equal(deepseekState({ ...event, data: { ...event.data, pinnedUrls: 'invalid' } }, source, nonce), null);
  const pinnedState = deepseekState({ ...event, data: { ...event.data, pinnedUrls: [event.data.chats[0].url] } }, source, nonce);
  assert.deepEqual(pinnedState.chats, []);
  assert.deepEqual(pinnedState.pinnedUrls, [event.data.chats[0].url]);
  assert.equal(deepseekState(event, {}, nonce), null);
  assert.equal(deepseekState(event, source, 'old'), null);
  assert.equal(deepseekState({ ...event, origin: 'https://evil.test' }, source, nonce), null);
  assert.equal(deepseekState({ ...event, data: { ...event.data, chats: Array(301).fill(event.data.chats[0]) } }, source, nonce), null);
  assert.equal(deepseekState({ ...event, data: { ...event.data, chats: [{ url: 'https://evil.test/', title: 'Unsafe' }] } }, source, nonce), null);
});
