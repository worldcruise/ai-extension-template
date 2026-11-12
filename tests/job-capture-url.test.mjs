import test from 'node:test';
import assert from 'node:assert/strict';
import { canCaptureJobUrl } from '../src/job-capture-url.mjs';

test('one-click capture excludes AI homes and conversations', () => {
  for (const url of [
    'https://chatgpt.com/', 'https://chatgpt.com/c/example', 'https://www.chatgpt.com/g/example',
    'https://CHATGPT.COM./c/example', 'https://chat.openai.com/',
    'https://chat.deepseek.com/', 'https://chat.deepseek.com/a/chat/s/example',
    'https://claude.ai/chat/example', 'https://gemini.google.com/app/example',
    'https://aistudio.google.com/prompts/new_chat', 'https://copilot.microsoft.com/',
    'https://grok.com/', 'https://www.perplexity.ai/search/example', 'https://poe.com/', 'https://chat.mistral.ai/chat'
  ]) assert.equal(canCaptureJobUrl(url), false, url);
});

test('one-click capture excludes webmail inboxes, messages and compose routes', () => {
  for (const url of [
    'https://mail.google.com/mail/u/0/#inbox', 'https://gmail.com/',
    'https://outlook.live.com/mail/0/inbox/id/message', 'https://outlook.office.com/mail/deeplink/compose',
    'https://outlook.office365.com/mail/', 'https://outlook.cloud.microsoft/mail/',
    'https://mail.yahoo.com/d/folders/1', 'https://mail.aol.com/', 'https://mail.proton.me/u/0/inbox',
    'https://mail.protonmail.com/', 'https://mail.zoho.eu/zm/', 'https://app.fastmail.com/mail/Inbox',
    'https://app.tuta.com/mail', 'https://mail.tutanota.com/', 'https://mailbox.org/',
    'https://www.icloud.com/mail/', 'https://beta.icloud.com/mail', 'https://www.icloud.com/#mail',
    'https://webmail.company.test/', 'https://mail.company.test/inbox', 'https://company.test/owa/',
    'https://company.test/webmail/#inbox'
  ]) assert.equal(canCaptureJobUrl(url), false, url);
});

test('job listings are not excluded for mentioning AI or mail in their path or query', () => {
  for (const url of [
    'https://jobs.example.test/ai-chat-engineer', 'https://jobs.example.test/mail-engineer',
    'https://jobs.example.test/123?source=mail.google.com', 'https://careers.deepseek.com/jobs',
    'https://openai.com/careers/', 'https://careers.google.com/', 'https://www.icloud.com/',
    'https://company.test/webmail-engineer', 'https://mail-jobs.example.test/',
    'https://chatgpt.com.jobs.example.test/opening', 'http://localhost:3000/jobs'
  ]) assert.equal(canCaptureJobUrl(url), true, url);
  for (const url of ['', 'not a url', 'chrome://settings/', 'about:blank', 'mailto:jobs@example.test',
    'file:///jobs.html', 'https://user:password@jobs.example.test/']) assert.equal(canCaptureJobUrl(url), false, url);
});
