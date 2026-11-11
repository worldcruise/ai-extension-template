import test from 'node:test';
import assert from 'node:assert/strict';
import { savedChatUrl, requestChatUrl, chatProviderForUrl } from '../src/saved-chat.mjs';

test('saved job conversations accept only provider conversation routes and omit query data', () => {
  assert.equal(savedChatUrl('https://chatgpt.com/c/job-1?token=private#draft'), 'https://chatgpt.com/c/job-1');
  const deepseek = 'https://chat.deepseek.com/a/chat/s/11111111-1111-4111-8111-111111111111';
  assert.equal(savedChatUrl(deepseek + '?tracking=private#draft'), deepseek);
  assert.equal(chatProviderForUrl(deepseek), 'deepseek');
  assert.equal(requestChatUrl({ manualChatUrl: deepseek, sourceChatUrl: 'https://chatgpt.com/c/old' }), deepseek);
  assert.equal(requestChatUrl({ sourceChatUrl: 'https://chatgpt.com/c/legacy' }), 'https://chatgpt.com/c/legacy');
  for (const value of ['https://chat.deepseek.com/', 'https://chatgpt.com/', 'https://chat.deepseek.com/login', 'https://chatgpt.com.evil.test/c/job', 'https://user:pass@chat.deepseek.com/a/chat/s/job', 'javascript:alert(1)', undefined]) assert.equal(savedChatUrl(value), null);
});
