import test from 'node:test';
import assert from 'node:assert/strict';
import { savedCompanyChats } from '../src/company-chats.mjs';
import { createExamples } from '../src/studio-examples.mjs';

test('company chats require a saved resume and a real source link for the selected candidate', () => {
  const requests = createExamples();
  assert.deepEqual(savedCompanyChats(requests, 'morgan'), []);
  requests[0].sourceChatUrl = 'https://chatgpt.com/c/northstar?discard=private';
  requests[1].sourceChatUrl = 'https://evil.test/c/aster';
  requests[2].sourceChatUrl = 'https://chatgpt.com/c/harbor';
  assert.deepEqual(savedCompanyChats(requests, 'morgan'), [
    { id: '1', title: 'Northstar', role: 'Software Engineer', url: 'https://chatgpt.com/c/northstar' }
  ]);
  assert.deepEqual(savedCompanyChats(requests, 'jordan'), []);
  requests[2].state = 'ready';
  assert.equal(savedCompanyChats(requests, 'morgan').length, 2);
  requests[0].input.tailor = false;
  requests[2].resume = null;
  assert.deepEqual(savedCompanyChats(requests, 'morgan'), []);
});

test('distinct saved companies can share a conversation and keep their literal company names', () => {
  const requests = createExamples();
  for (const request of requests.slice(0, 2)) request.sourceChatUrl = 'https://chatgpt.com/c/shared';
  requests[1].input.job.company = '<img src=x onerror=alert(1)>';
  assert.deepEqual(savedCompanyChats(requests, 'morgan').map(chat => chat.title), [
    'Northstar', '<img src=x onerror=alert(1)>'
  ]);
});
