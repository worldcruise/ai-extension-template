import test from 'node:test';
import assert from 'node:assert/strict';
import { existingChatGPTTabs, openChatGPTTab } from '../src/chatgpt-tabs.mjs';

test('tab selection prefers active then recent ChatGPT, including pending pages and excluding sign-in', async () => {
  const tabs = [
    { id: 1, url: 'https://chatgpt.com/c/recent', lastAccessed: 100 },
    { id: 2, url: 'https://chatgpt.com/', active: true, lastAccessed: 1 },
    { id: 3, url: 'about:blank', pendingUrl: 'https://chatgpt.com/c/loading', lastAccessed: 50 },
    { id: 4, url: 'https://chatgpt.com/auth/login', active: true },
    { id: 5, url: 'https://chatgpt.com.evil.test/', active: true },
    { id: 6, url: 'https://chatgpt.com/', pendingUrl: 'https://other.example/' },
    { id: 7, url: 'https://user:password@chatgpt.com/' }
  ];
  assert.deepEqual((await existingChatGPTTabs({ tabs: { query: async () => tabs } })).map(tab => tab.id), [2, 1, 3]);
});

test('Open selected AI creates ChatGPT only when no eligible tab exists', async () => {
  const tabs = [], created = [], updates = [], windows = [];
  const browser = { tabs: { query: async () => tabs, get: async id => tabs.find(tab => tab.id === id),
    create: async values => { const tab = { id: 1, windowId: 2, ...values }; tabs.push(tab); created.push(values); return tab; },
    update: async (id, values) => updates.push({ id, ...values }) }, windows: { update: async (id, values) => windows.push({ id, ...values }) },
    scripting: { executeScript: async options => [{ result: { ready: true, busy: false, url: tabs.find(tab => tab.id === options.target.tabId).url } }] } };
  assert.equal((await openChatGPTTab(browser)).id, 1);
  tabs[0].url = 'https://chatgpt.com/c/keep-this';
  assert.equal((await openChatGPTTab(browser)).id, 1);
  assert.deepEqual(created, [{ url: 'https://chatgpt.com/', active: true }]);
  assert.equal(updates.length, 2); assert.ok(updates.every(item => item.active && !item.url));
  assert.ok(windows.every(item => item.id === 2 && item.focused));
});
