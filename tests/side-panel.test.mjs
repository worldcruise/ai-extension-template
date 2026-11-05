import test from 'node:test';
import assert from 'node:assert/strict';
import { installSidePanel, isAgentSender, panelWindow } from '../src/side-panel.mjs';
import { BrowserTabs } from '../src/browser-tabs.mjs';

test('toolbar click opens the native panel synchronously in the clicked window without creating a popup', async () => {
  let click, opened;
  const calls = [];
  installSidePanel({ action: { onClicked: { addListener(listener) { click = listener; } } }, sidePanel: { open(value) { calls.push(value); return Promise.resolve(); } } }, () => { opened = true; });
  click({ windowId: 12 }); assert.deepEqual(calls, [{ windowId: 12 }]); await Promise.resolve(); assert.equal(opened, true);
  click({}); assert.equal(calls.length, 1);
});
test('tabless native panel messages are accepted only from the exact packaged page and extension', () => {
  const browser = { runtime: { id: 'extension' } }, pageUrl = 'chrome-extension://extension/index.html';
  assert.equal(isAgentSender(browser, { id: 'extension', url: pageUrl }, pageUrl), true);
  assert.equal(isAgentSender(browser, { id: 'other', url: pageUrl }, pageUrl), false);
  assert.equal(isAgentSender(browser, { id: 'extension', url: 'https://untrusted.test' }, pageUrl), false);
});
test('navigation belongs to the sending panel window even with multiple browser windows', async () => {
  const pageUrl = 'chrome-extension://extension/index.html', activated = [];
  const browser = { runtime: { id: 'extension', async getContexts(filter) { return [{ documentId: filter.documentIds[0], documentUrl: pageUrl, windowId: filter.documentIds[0] === 'A' ? 10 : 20 }]; } },
    windows: { async get(id) { return { id, type: 'normal' }; }, async update() {} },
    tabs: { async query({ windowId }) { return [{ id: windowId + 1, index: 0, active: true }, { id: windowId + 2, index: 1, active: false }]; }, async update(id) { activated.push(id); } } };
  const navigation = new BrowserTabs(browser, { async get() { throw Error('Docked navigation must not depend on a global window preference'); } });
  for (const windowId of [10, 20]) await navigation.move(1, await panelWindow(browser, { id: 'extension', url: pageUrl }, pageUrl, windowId));
  assert.deepEqual(activated, [12, 22]);
  await assert.rejects(panelWindow(browser, { id: 'extension', url: pageUrl }, pageUrl), { code: 'browser_window_unavailable' });
});
test('native panels without a sender tab or document ID use the packaged page’s own current window', async () => {
  const pageUrl='chrome-extension://extension/index.html';
  const browser={runtime:{id:'extension',async getContexts(){return [{contextType:'SIDE_PANEL',windowId:-1,documentId:'panel',documentUrl:pageUrl}];}}};
  const sender={id:'extension',url:pageUrl};
  assert.equal(await panelWindow(browser,sender,pageUrl,17),17);
  await assert.rejects(panelWindow(browser,sender,pageUrl),{code:'browser_window_unavailable'});
});
