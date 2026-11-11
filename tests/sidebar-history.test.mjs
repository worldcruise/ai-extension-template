import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/sidebar-history.js';

test('a pin action is not a pinned indicator, while a decorative pin is', () => {
  const marker = { closest: () => ({ role: 'menuitem' }) };
  const row = { querySelector: selector => selector.includes('pin-icon') ? marker : null };
  const link = { closest: selector => selector.startsWith('li,') ? row : null };
  assert.equal(globalThis.AiAgentSidebarHistory.isPinned(link), false);
  marker.closest = () => null;
  assert.equal(globalThis.AiAgentSidebarHistory.isPinned(link), true);
});

function fixture(t, { mounted = false, opened = false } = {}) {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ visibility: 'visible' });
  t.after(() => { globalThis.getComputedStyle = previous; });
  const log = [];
  function control(name, opening) {
    return { isConnected: true, disabled: false, textContent: '', closest: () => null,
      getClientRects: () => opened !== opening ? [1] : [],
      getAttribute: key => key === 'aria-label' ? name : null,
      click: () => { log.push(opening ? 'open' : 'close'); opened = opening; mounted = opening; } };
  }
  const controls = [control('Expand sidebar', true), control('Collapse sidebar', false)];
  const link = { isConnected: true, closest: () => null, getClientRects: () => opened ? [1] : [] };
  const helper = globalThis.AiAgentSidebarHistory.create({ document: { querySelectorAll: () => controls },
    links: () => mounted ? [link] : [] });
  return { helper, log, isOpen: () => opened, openNatively() { opened = true; mounted = true; } };
}

test('unmounted history is revealed for a read and its closed sidebar is restored', async t => {
  const { helper, log, isOpen } = fixture(t);
  assert.equal(await helper.withLinks(links => links.length), 1);
  assert.equal(isOpen(), false);
  assert.deepEqual(log, ['open', 'close']);
});
test('mounted but hidden history still opens before native link interaction', async t => {
  const { helper, log } = fixture(t, { mounted: true });
  assert.equal(await helper.withLinks(links => links.length), 1);
  assert.deepEqual(log, ['open', 'close']);
});

test('mounted hidden links navigate without opening the sidebar, and native auto-opening is restored', async t => {
  const { helper, log, isOpen, openNatively } = fixture(t, { mounted: true });
  assert.equal(await helper.withLinks(links => links.length, { allowHidden: true }), 1);
  assert.deepEqual(log, [], 'no sidebar flash is needed for mounted history');
  await helper.withLinks(() => openNatively(), { allowHidden: true });
  assert.deepEqual(log, ['close']);
  assert.equal(isOpen(), false);
});
test('an already open sidebar is left open, including after an operation fails', async t => {
  const { helper, log, isOpen } = fixture(t, { mounted: true, opened: true });
  await assert.rejects(helper.withLinks(() => { throw new Error('Failure'); }), /Failure/);
  assert.equal(isOpen(), true);
  assert.deepEqual(log, []);
});
test('inspection and navigation serialize their temporary sidebar ownership', async t => {
  const { helper, log } = fixture(t);
  await Promise.all([
    helper.withLinks(async links => { assert.equal(links.length, 1); await new Promise(resolve => setTimeout(resolve, 10)); }),
    helper.withLinks(links => { assert.equal(links.length, 1); })
  ]);
  assert.deepEqual(log, ['open', 'close', 'open', 'close']);
});
test('a failed operation restores a previously closed sidebar; blocked operations do not open it', async t => {
  const { helper, log, isOpen } = fixture(t);
  await assert.rejects(helper.withLinks(() => { throw new Error('Failure'); }), /Failure/);
  assert.equal(isOpen(), false);
  assert.deepEqual(log, ['open', 'close']);
  assert.equal(await helper.withLinks(links => links.length, { canOpen: () => false }), 0);
  assert.deepEqual(log, ['open', 'close']);
});

test('provider-specific unlabeled controls can reveal delayed history and restore the sidebar', async t => {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ visibility: 'visible' });
  t.after(() => { globalThis.getComputedStyle = previous; });
  let opened = false, mounted = false;
  const log = [];
  const link = { isConnected: true, closest: () => null, getClientRects: () => opened && mounted ? [1] : [] };
  const helper = globalThis.AiAgentSidebarHistory.create({ document: { querySelectorAll: () => [] },
    links: () => mounted ? [link] : [], waitMs: 500,
    fallbackControl: opening => ({ click() {
      log.push(opening ? 'open' : 'close'); opened = opening;
      if (opening) setTimeout(() => { mounted = true; }, 80); else mounted = false;
    } }) });
  assert.equal(await helper.withLinks(links => links.length), 1);
  assert.equal(opened, false);
  assert.deepEqual(log, ['open', 'close']);
});
