import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserTabs } from '../src/browser-tabs.mjs';

function fixture(initialTabs, ownTab) {
  const rows = structuredClone(initialTabs);
  const queries = [], updates = [];
  let focusedWindow = 1;
  function event() {
    const handlers = new Set();
    return { handlers, addListener: fn => handlers.add(fn), removeListener: fn => handlers.delete(fn),
      emit: (...args) => { for (const handler of handlers) handler(...args); } };
  }
  const tabs = {
    getCurrent: async () => ownTab,
    query: async options => { queries.push(options); return structuredClone(rows.filter(row => row.windowId === options.windowId)); },
    update: async (id, changes) => {
      updates.push(id);
      const target = rows.find(row => row.id === id);
      if (!target) throw new Error('Tab closed');
      for (const row of rows) if (row.windowId === target.windowId) row.active = row.id === id;
      Object.assign(target, changes);
      tabs.onActivated.emit({ tabId: id, windowId: target.windowId });
      return structuredClone(target);
    },
    onActivated: event(), onCreated: event(), onRemoved: event(), onMoved: event(),
    onAttached: event(), onDetached: event(), onUpdated: event()
  };
  return { rows, queries, updates, focus: id => { focusedWindow = id; }, browser: {
    tabs, windows: { getCurrent: async () => ({ id: focusedWindow }) },
    runtime: { getURL: path => `chrome-extension://workspace/${path}` }
  } };
}

test('navigation wraps in tab order, excludes the workspace, and stays with its owning window', async () => {
  const data = fixture([
    { id: 11, windowId: 1, index: 3, active: true },
    { id: 12, windowId: 1, index: 0, active: false },
    { id: 99, windowId: 1, index: 4, url: 'chrome-extension://workspace/index.html' },
    { id: 21, windowId: 2, index: 0, active: true }
  ], { id: 99, windowId: 1 });
  let latest;
  const navigation = createBrowserTabs({ browser: data.browser, onChange: state => { latest = state; } });
  await navigation.ready;
  assert.equal(latest.count, 2);
  assert.equal(latest.index, 2);
  data.focus(2);
  await navigation.move(1);
  assert.equal(latest.tabId, 12);
  assert.equal(latest.index, 1);
  await navigation.move(-1);
  assert.equal(latest.tabId, 11);
  assert.equal(data.rows.find(row => row.id === 21).active, true);
  assert.ok(data.queries.every(query => query.windowId === 1));
  assert.deepEqual(data.updates, [12, 11]);
  navigation.dispose();
  assert.ok(Object.values(data.browser.tabs).filter(value => value?.handlers).every(event => event.handlers.size === 0));
});

test('opening, closing and reordering tabs updates the count and selected position', async () => {
  const data = fixture([{ id: 1, windowId: 1, index: 0, active: true }]);
  let latest;
  const navigation = createBrowserTabs({ browser: data.browser, onChange: state => { latest = state; } });
  await navigation.ready;
  await navigation.move(1);
  assert.deepEqual(data.updates, []);
  data.rows.push({ id: 2, windowId: 1, index: 1 });
  data.browser.tabs.onCreated.emit(data.rows[1]);
  await navigation.refresh();
  assert.equal(latest.count, 2);
  data.rows[0].index = 2;
  data.browser.tabs.onMoved.emit(1, { windowId: 1 });
  await navigation.refresh();
  assert.equal(latest.index, 2);
  data.rows.splice(1, 1);
  data.browser.tabs.onRemoved.emit(2, { windowId: 1 });
  await navigation.refresh();
  assert.equal(latest.count, 1);
  assert.equal(latest.index, 1);
  data.rows.splice(0);
  data.browser.tabs.onRemoved.emit(1, { windowId: 1 });
  await navigation.refresh();
  assert.equal(latest.count, 0);
  assert.equal(latest.index, 0);
  navigation.dispose();
});

test('a failed tab switch releases the controls and a later refresh can recover', async () => {
  const data = fixture([{ id: 1, windowId: 1, index: 0, active: true }, { id: 2, windowId: 1, index: 1 }]);
  let latest, errors = 0;
  const navigation = createBrowserTabs({ browser: data.browser, onChange: state => { latest = state; }, onError: () => { errors++; } });
  await navigation.ready;
  data.browser.tabs.update = async () => { throw new Error('Window closed'); };
  await navigation.move(1);
  assert.equal(errors, 1);
  assert.equal(latest.busy, false);
  assert.equal(latest.count, 0);
  await navigation.refresh();
  assert.equal(latest.count, 2);
  navigation.dispose();
});

test('pending navigation publishes the destination so capture eligibility changes before load completes', async () => {
  const data = fixture([{ id: 1, windowId: 1, index: 0, active: true, url: 'https://jobs.example.test/job' }]);
  let latest;
  const navigation = createBrowserTabs({ browser: data.browser, onChange: state => { latest = state; } });
  await navigation.ready;
  assert.equal(latest.url, 'https://jobs.example.test/job');
  data.rows[0].pendingUrl = 'https://mail.google.com/mail/';
  data.browser.tabs.onUpdated.emit(1, { status: 'loading' }, data.rows[0]);
  await navigation.refresh();
  assert.equal(latest.url, 'https://mail.google.com/mail/');
  delete data.rows[0].pendingUrl;
  await navigation.refresh();
  assert.equal(latest.url, 'https://jobs.example.test/job', 'cancelled navigation restores the actual page');
  navigation.dispose();
});
