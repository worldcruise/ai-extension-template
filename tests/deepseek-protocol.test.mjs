import test from 'node:test';
import assert from 'node:assert/strict';
import { deepseekRoute, deepseekState, deepseekRoutes, DEEPSEEK_CHANNEL } from '../src/deepseek-protocol.mjs';

test('DeepSeek history accepts only its own conversation routes and preserves loaded order without wrapping', () => {
  const urls = ['https://chat.deepseek.com/a/chat/abc', 'https://chat.deepseek.com/a/chat/def'];
  assert.equal(deepseekRoute(urls[0] + '?private=value'), urls[0]);
  for (const url of ['https://evil.test/a/chat/a', 'https://chat.deepseek.com.evil.test/', 'https://user@chat.deepseek.com/', 'https://chat.deepseek.com/sign_in', 'javascript:alert(1)']) assert.equal(deepseekRoute(url), null);
  assert.equal(deepseekRoutes.target(urls, 'https://chat.deepseek.com/', 1), urls[0]);
  assert.equal(deepseekRoutes.target(urls, urls[0], -1), null);
  assert.equal(deepseekRoutes.target(urls, urls[1], 1), null);
});

test('DeepSeek state requires its frame, origin and nonce and bounds history payloads', () => {
  const source = {}, nonce = 'current';
  const event = { source, origin: 'https://chat.deepseek.com', data: { channel: DEEPSEEK_CHANNEL, type: 'state', nonce,
    url: 'https://chat.deepseek.com/', ready: true, hasDraft: false, busy: false,
    chats: [{ url: 'https://chat.deepseek.com/a/chat/abc', title: 'Literal title' }] } };
  assert.equal(deepseekState(event, source, nonce).chats[0].title, 'Literal title');
  assert.equal(deepseekState(event, {}, nonce), null);
  assert.equal(deepseekState(event, source, 'old'), null);
  assert.equal(deepseekState({ ...event, origin: 'https://evil.test' }, source, nonce), null);
  assert.equal(deepseekState({ ...event, data: { ...event.data, chats: Array(301).fill(event.data.chats[0]) } }, source, nonce), null);
  assert.equal(deepseekState({ ...event, data: { ...event.data, chats: [{ url: 'https://evil.test/', title: 'Unsafe' }] } }, source, nonce), null);
});
