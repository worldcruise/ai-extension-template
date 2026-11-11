import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/deepseek-consent.js';

function fixture(t, saved = {}, { custom = false } = {}) {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ visibility: 'visible' });
  t.after(() => { globalThis.getComputedStyle = previous; });
  const values = saved, clicked = [], listeners = {};
  let showing = true;
  const base = { isConnected: true, closest: () => null, getClientRects: () => showing ? [1] : [], getAttribute: () => null };
  const buttons = ['Reject all', 'Accept all'].map(textContent => ({ ...base, textContent,
    closest: selector => custom && selector.includes('dialog') ? root : null,
    contains: target => target === buttons.find(button => button.textContent === textContent),
    click() { clicked.push(textContent); showing = false; } }));
  const root = { ...base, textContent: 'We use cookies. Reject all Accept all',
    querySelector: () => custom ? {} : null, querySelectorAll: () => buttons };
  const document = { documentElement: {}, querySelectorAll: () => [root],
    addEventListener: (name, handler) => { listeners[name] = handler; }, removeEventListener() {} };
  class Observer { observe() {} disconnect() {} }
  const browser = { storage: { local: { get: async () => values, set: async patch => Object.assign(values, patch), remove: async key => { delete values[key]; } } } };
  const consent = globalThis.AiAgentDeepseekConsent.create({ document, browser, Observer });
  t.after(() => consent.dispose());
  return { consent, buttons, clicked, listeners, values };
}

test('no cookie action is chosen until the user makes an explicit trusted choice', async t => {
  const page = fixture(t); await page.consent.ready;
  assert.deepEqual(page.clicked, []);
  page.listeners.click({ isTrusted: false, target: page.buttons[1] });
  assert.equal(page.values.deepseekCookieChoice, undefined);
  page.listeners.click({ isTrusted: true, target: page.buttons[0] });
  assert.deepEqual(page.values.deepseekCookieChoice, { version: 1, kind: 'reject-optional', label: 'reject all' });
});
test('a newly loaded banner reuses the saved reject choice without accepting cookies', async t => {
  const page = fixture(t, { deepseekCookieChoice: { version: 1, kind: 'reject-optional', label: 'reject all' } });
  await page.consent.ready;
  assert.deepEqual(page.clicked, ['Reject all']);
});
test('an explicit accept-all choice is replayed only with the same consent label', async t => {
  const page = fixture(t, { deepseekCookieChoice: { version: 1, kind: 'accept-all', label: 'accept all' } });
  await page.consent.ready;
  assert.deepEqual(page.clicked, ['Accept all']);
});
test('custom cookie preferences are not replaced with a generic acceptance', async t => {
  const page = fixture(t, { deepseekCookieChoice: { version: 1, kind: 'accept-all', label: 'accept all' } }, { custom: true });
  await page.consent.ready;
  page.listeners.click({ isTrusted: true, target: page.buttons[1] });
  assert.deepEqual(page.clicked, []);
  assert.equal(page.values.deepseekCookieChoice, undefined, 'custom preferences clear the previous generic action');
});
