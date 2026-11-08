import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationUrl, embedRules, frameMessage, linkedConversationUrl, FRAME_CHANNEL } from '../src/sidebar-protocol.mjs';

test('conversation routes discard queries and reject unrelated or sensitive URLs', () => {
  assert.equal(conversationUrl('https://chatgpt.com/c/chat-123?token=secret#section'), 'https://chatgpt.com/c/chat-123');
  assert.equal(conversationUrl('https://chatgpt.com/g/g-example/c/chat-123'), 'https://chatgpt.com/g/g-example/c/chat-123');
  for (const url of ['javascript:alert(1)', 'https://chatgpt.com.evil.test/', 'https://user:pass@chatgpt.com/',
    'https://chatgpt.com/auth/login?code=secret', 'https://chatgpt.com/backend-api/conversation', '/c/chat-123']) {
    assert.equal(conversationUrl(url), null, url);
  }
});

test('company source links accept only real conversation routes', () => {
  assert.equal(linkedConversationUrl('https://chatgpt.com/c/company-one?discard=private'), 'https://chatgpt.com/c/company-one');
  assert.equal(linkedConversationUrl('https://chatgpt.com/g/project/c/company-two'), 'https://chatgpt.com/g/project/c/company-two');
  for (const url of [undefined, '', 'https://chatgpt.com/', 'https://chatgpt.com/g/project',
    'https://chatgpt.com/auth/login', 'https://evil.test/c/company-one']) assert.equal(linkedConversationUrl(url), null);
});

test('the embed rule is restricted to this extension and ChatGPT subframes', () => {
  const [rule] = embedRules('example-extension-id');
  assert.deepEqual(rule.condition.initiatorDomains, ['example-extension-id']);
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  const pattern = new RegExp(rule.condition.regexFilter);
  assert.ok(pattern.test('https://chatgpt.com/c/123'));
  for (const url of ['https://chatgpt.com.evil.test/', 'http://chatgpt.com/', 'https://other.test/?chatgpt.com']) {
    assert.equal(pattern.test(url), false);
  }
});

test('frame signals require the expected window, origin, channel and navigation nonce', () => {
  const source = {};
  const event = { source, origin: 'https://chatgpt.com', data: {
    channel: FRAME_CHANNEL, nonce: 'navigation-1', type: 'state', ready: true, guest: false,
    url: 'https://chatgpt.com/c/chat-123?private=query'
  } };
  assert.deepEqual(frameMessage(event, source, 'navigation-1'), {
    type: 'state', ready: true, guest: false, url: 'https://chatgpt.com/c/chat-123'
  });
  assert.equal(frameMessage(event, {}, 'navigation-1'), null);
  assert.equal(frameMessage({ ...event, origin: 'https://evil.test' }, source, 'navigation-1'), null);
  assert.equal(frameMessage(event, source, 'navigation-2'), null);
  assert.equal(frameMessage({ ...event, data: { ...event.data, channel: 'other' } }, source, 'navigation-1'), null);
  assert.equal(frameMessage({ ...event, data: { ...event.data, url: 'https://evil.test/' } }, source, 'navigation-1'), null);
  assert.equal(frameMessage({ ...event, data: { ...event.data, type: 'unknown' } }, source, 'navigation-1'), null);
});
