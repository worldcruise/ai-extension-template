import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJobPageAccess } from '../src/job-page-access.mjs';

function setup() {
  function event() {
    const listeners = new Set();
    return { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener),
      emit: (...args) => { for (const listener of listeners) listener(...args); }, count: () => listeners.size };
  }
  let grant, reject;
  const permission = new Promise((resolve, fail) => { grant = resolve; reject = fail; });
  const requests = [];
  const browser = { tabs: { onUpdated: event(), onRemoved: event() },
    permissions: { request: options => { requests.push(options); return permission; } } };
  return { browser, requests, grant, reject };
}

test('Read page requests optional HTTP(S) access synchronously and releases its navigation listeners', async () => {
  const fixture = setup();
  const pending = requestJobPageAccess(7, fixture.browser);
  assert.deepEqual(fixture.requests, [{ origins: ['http://*/*', 'https://*/*'] }], 'request runs before any await can lose the click gesture');
  fixture.grant(true);
  await pending;
  assert.equal(fixture.browser.tabs.onUpdated.count(), 0);
  assert.equal(fixture.browser.tabs.onRemoved.count(), 0);
});

test('denied access cannot proceed to extraction', async () => {
  const fixture = setup();
  let extracted = false;
  const pending = requestJobPageAccess(7, fixture.browser).then(() => { extracted = true; });
  fixture.grant(false);
  await assert.rejects(pending, error => error.code === 'access-denied');
  assert.equal(extracted, false);
  assert.equal(fixture.browser.tabs.onUpdated.count(), 0);
});

test('navigation or tab closure while consent is pending cancels the original read', async () => {
  for (const interrupt of [
    browser => browser.tabs.onUpdated.emit(7, { status: 'loading' }),
    browser => browser.tabs.onUpdated.emit(7, { url: 'https://another-job.test/posting' }),
    browser => browser.tabs.onRemoved.emit(7)
  ]) {
    const fixture = setup();
    const pending = requestJobPageAccess(7, fixture.browser);
    interrupt(fixture.browser);
    fixture.grant(true);
    await assert.rejects(pending, error => error.code === 'page-changed');
    assert.equal(fixture.browser.tabs.onUpdated.count(), 0);
  }
});

test('unrelated tab events and a completed load do not cancel the selected job', async () => {
  const fixture = setup();
  const pending = requestJobPageAccess(7, fixture.browser);
  fixture.browser.tabs.onUpdated.emit(8, { status: 'loading' });
  fixture.browser.tabs.onRemoved.emit(8);
  fixture.browser.tabs.onUpdated.emit(7, { status: 'complete' });
  fixture.grant(true);
  await pending;
});

test('permission API failures release listeners without leaking raw error details', async () => {
  for (const synchronous of [false, true]) {
    const fixture = setup();
    if (synchronous) fixture.browser.permissions.request = () => { throw new Error('Raw API details'); };
    const pending = requestJobPageAccess(7, fixture.browser);
    if (!synchronous) fixture.reject(new Error('Raw API details'));
    await assert.rejects(pending, error => error.code === 'access-request' && !error.message.includes('Raw API'));
    assert.equal(fixture.browser.tabs.onUpdated.count(), 0);
    assert.equal(fixture.browser.tabs.onRemoved.count(), 0);
  }
});

test('invalid targets never request website permission', async () => {
  const fixture = setup();
  await assert.rejects(requestJobPageAccess(-1, fixture.browser), error => error.code === 'invalid-tab');
  assert.equal(fixture.requests.length, 0);
});
