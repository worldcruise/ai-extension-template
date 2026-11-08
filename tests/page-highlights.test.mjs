import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageHighlights } from '../src/page-highlights.mjs';

function setup(url, denied = false) {
  const status = { title: '' };
  const toggle = { title: '', closest: () => status };
  globalThis.document = { getElementById: () => toggle };
  globalThis.window = { addEventListener() {} };
  const calls = [];
  const event = { addListener() {}, removeListener() {} };
  const browser = { runtime: { id:'extension', onMessage:event },
    tabs: { get:async () => ({url}), onUpdated:event }, scripting: {
      executeScript:async value => { if (denied) throw new Error('No page access'); calls.push(value); },
      removeCSS:async () => {}, insertCSS:async () => {}
    } };
  return { status, calls, controller:createPageHighlights({browser}) };
}

test('job highlighting excludes ChatGPT, extension pages, and browser-internal pages', async () => {
  for (const url of ['https://chatgpt.com/c/chat', 'https://www.chatgpt.com/', 'chrome-extension://extension/index.html', 'chrome://settings/']) {
    const fixture = setup(url);
    await fixture.controller.setTarget({tabId:7});
    await fixture.controller.update({enabled:true,keywords:['React']});
    assert.equal(fixture.calls.length, 0, url);
    assert.match(fixture.status.title, /job web pages only/);
  }
});

test('only an enabled configuration with keywords injects into the selected top-level page', async () => {
  const fixture = setup('https://jobs.example.test/engineering');
  await fixture.controller.setTarget({tabId:7});
  await fixture.controller.update({enabled:false,keywords:['React']});
  await fixture.controller.update({enabled:true,keywords:[]});
  assert.equal(fixture.calls.length, 0);
  await fixture.controller.update({enabled:true,keywords:['React']});
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.calls[0].target, {tabId:7});
  assert.match(fixture.status.title, /on for this job page/);
});

test('missing page permission gives an actionable tooltip without claiming highlights were applied', async () => {
  const fixture = setup('https://jobs.example.test/engineering', true);
  await fixture.controller.setTarget({tabId:7});
  await fixture.controller.update({enabled:true,keywords:['React']});
  assert.equal(fixture.calls.length, 0);
  assert.match(fixture.status.title, /Click the extension icon/);
});
