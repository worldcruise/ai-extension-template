import test from 'node:test';
import assert from 'node:assert/strict';
import { openApplicationTabs } from '../src/apply-tabs.mjs';

const jobUrl = 'https://jobs.example.test/engineering?role=123#apply';
function fixture(initial = []) {
  let nextId = Math.max(0, ...initial.map(tab => tab.id));
  const tabs = new Map(initial.map(tab => [tab.id, { windowId: 1, status: 'complete', ...tab }]));
  const created = [], updates = [], windows = [], inspections = [];
  const browser = { tabs: {
    query: async () => [...tabs.values()],
    get: async id => { if (!tabs.has(id)) throw new Error('Tab closed'); return tabs.get(id); },
    create: async values => {
      const tab = { id: ++nextId, windowId: 1, status: 'complete', ...values };
      if (values.active) for (const item of tabs.values()) item.active = false;
      tabs.set(tab.id, tab); created.push({ ...values }); return tab;
    },
    update: async (id, values) => {
      updates.push({ id, ...values });
      if (values.active) for (const item of tabs.values()) if (item.windowId === tabs.get(id).windowId) item.active = false;
      return Object.assign(tabs.get(id), values);
    }
  }, windows: { update: async (id, values) => { windows.push({ id, ...values }); } }, scripting: {
    executeScript: async options => {
      inspections.push(options); const tab = tabs.get(options.target.tabId);
      return [{ result: { url: tab.url, ready: !tab.busy, busy: Boolean(tab.busy) } }];
    }
  } };
  return { browser, tabs, created, updates, windows, inspections };
}

test('Go to apply focuses only the listing and leaves existing AI conversations untouched', async () => {
  for (const conversationUrl of ['https://chatgpt.com/c/saved', 'https://chat.deepseek.com/a/chat/s/saved']) {
    const f = fixture([{ id: 1, url: jobUrl, active: false }, { id: 2, url: conversationUrl, windowId: 2, active: true, busy: true }]);
    const result = await openApplicationTabs({ jobUrl, conversationUrl: conversationUrl + '?private=value', provider: 'chatgpt', browser: f.browser });
    assert.equal(result.jobTab.id, 1); assert.equal(result.aiTab, null); assert.equal(result.warning, '');
    assert.deepEqual(f.created, []);
    assert.deepEqual(f.updates, [{ id: 1, active: true }]);
    assert.deepEqual(f.windows, [{ id: 1, focused: true }]);
    assert.deepEqual(f.inspections, [], 'opening the saved chat performs no generation injection');
  }
});

test('duplicate clicks open only one listing even when a saved AI conversation is supplied', async () => {
  for (const conversationUrl of ['https://chatgpt.com/c/saved', 'https://chat.deepseek.com/a/chat/s/saved']) {
    const f = fixture();
    const args = { jobUrl, conversationUrl, browser: f.browser };
    const results = await Promise.all([openApplicationTabs(args), openApplicationTabs(args)]);
    assert.equal(results[0].jobTab.id, results[1].jobTab.id);
    assert.equal(results[0].aiTab,null);assert.equal(results[1].aiTab,null);
    assert.deepEqual(f.created, [{ url: jobUrl, active: true }]);
    assert.deepEqual(f.updates, [{ id: results[0].jobTab.id, active: true }]);
    assert.equal(f.tabs.get(results[0].jobTab.id).active, true);
    await openApplicationTabs(args);
    assert.equal(f.created.length, 1, 'later clicks reuse the listing');
  }
});

test('without a saved conversation, Go to apply opens only the listing and leaves AI tabs untouched', async () => {
  for (const [provider, home, conversation] of [
    ['chatgpt', 'https://chatgpt.com/', 'https://chatgpt.com/c/idle'],
    ['deepseek', 'https://chat.deepseek.com/', 'https://chat.deepseek.com/a/chat/s/idle']
  ]) {
    const f = fixture([{ id: 1, url: jobUrl }, { id: 2, url: home, busy: true, lastAccessed: 100 }, { id: 3, url: conversation, lastAccessed: 50 }]);
    const result = await openApplicationTabs({ jobUrl, provider, browser: f.browser });
    assert.equal(result.aiTab, null); assert.equal(f.created.length, 0); assert.equal(result.warning, '');
    assert.deepEqual(f.updates, [{ id: 1, active: true }]);
    assert.deepEqual(f.inspections, [], 'unlinked jobs never inspect or inject into AI pages');
    assert.equal(f.tabs.get(1).active, true);
  }
});

test('an unlinked job creates only its listing even when no AI tab is open', async () => {
  const f = fixture();
  const result = await openApplicationTabs({ jobUrl, provider: 'deepseek', browser: f.browser });
  assert.deepEqual(f.created, [{ url: jobUrl, active: true }]);
  assert.equal(result.aiTab, null); assert.equal(result.warning, '');
  assert.equal(f.tabs.get(result.jobTab.id).active, true);
});

test('opening an existing listing never attempts to create an AI tab', async () => {
  const f = fixture([{ id: 1, url: jobUrl }]);
  f.browser.tabs.create = async () => { throw new Error('Browser cannot open an AI tab.'); };
  const result = await openApplicationTabs({ jobUrl, conversationUrl: 'https://chatgpt.com/c/saved', browser: f.browser });
  assert.equal(result.jobTab.id, 1); assert.equal(result.aiTab, null);
  assert.equal(result.warning,'');
  assert.equal(f.tabs.get(1).active, true);
});

test('invalid listing URLs cannot open tabs; invalid saved AI links cannot redirect the AI tab', async () => {
  const f = fixture();
  for (const url of ['javascript:alert(1)', 'file:///private', 'https://user:secret@jobs.example.test/']) {
    await assert.rejects(openApplicationTabs({ jobUrl: url, browser: f.browser }), /valid web listing/);
  }
  assert.equal(f.created.length, 0);
  const result = await openApplicationTabs({ jobUrl, conversationUrl: 'https://chatgpt.com.evil.test/c/stolen', browser: f.browser });
  assert.equal(result.aiTab, null); assert.equal(result.warning,'');
  assert.deepEqual(f.created, [{ url: jobUrl, active: true }]);
});

test('listing reuse considers pending destinations and preserves distinct job query and hash identities', async () => {
  const f = fixture([{ id: 1, url: jobUrl, pendingUrl: 'https://unrelated.example/' },
    { id: 2, url: 'https://jobs.example.test/engineering?role=456#apply' },
    { id: 3, url: 'about:blank', pendingUrl: jobUrl, status: 'loading' },
    { id: 4, url: 'https://chatgpt.com/c/saved' }]);
  const result = await openApplicationTabs({ jobUrl, conversationUrl: 'https://chatgpt.com/c/saved', browser: f.browser });
  assert.equal(result.jobTab.id, 3); assert.equal(f.created.length, 0);
  assert.deepEqual(f.updates, [{ id: 3, active: true }]);
});
