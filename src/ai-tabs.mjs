import { providerHome, providerUrl } from './generation-data.mjs';

export const tabUrl = tab => tab.pendingUrl || tab.url;
const unavailable = () => ({ ready: false, busy: false, url: null });
const opening = new WeakMap();

function eligibleUrl(value, provider) {
  try {
    const url = new URL(value), home = providerHome(provider);
    return Boolean(home && url.origin === new URL(home).origin && !url.username && !url.password &&
      !/^\/(?:auth|login|sign_in)(?:\/|$)/i.test(url.pathname));
  } catch { return false; }
}

export async function providerTabs(provider, browser = chrome) {
  if (!providerHome(provider)) throw new Error('Choose ChatGPT or DeepSeek.');
  // Pending destinations matter: a new ChatGPT/DeepSeek tab can still have an
  // about:blank URL, and a former AI tab can already be leaving the provider.
  const tabs = await browser.tabs.query({});
  return tabs.filter(tab => Number.isInteger(tab.id) && eligibleUrl(tabUrl(tab), provider))
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) ||
      (b.lastAccessed || 0) - (a.lastAccessed || 0) || b.id - a.id);
}

// This function is serialized into the top frame. Keep it self-contained and
// read-only: no text is returned, and no clicking, focus changes, or generation
// injection occurs. DeepSeek draft detection returns only an eligibility flag.
export function providerTabState(provider, expectedOrigin) {
  const url = location.origin + location.pathname;
  if (window !== window.top || location.origin !== expectedOrigin || document.readyState === 'loading') return { ready: false, busy: false, url };
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length &&
    getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none');
  const anyVisible = selectors => selectors.some(selector => [...document.querySelectorAll(selector)].some(visible));
  const deepseekLoading = () => {
    const editor = ['#chat-input', 'textarea[placeholder*="DeepSeek"]', 'textarea[placeholder*="发送"]', 'form textarea', '[contenteditable="true"][role="textbox"]']
      .flatMap(selector => [...document.querySelectorAll(selector)]).find(visible);
    const composer = editor?.closest('form') || editor?.parentElement;
    const latest = [...document.querySelectorAll('[data-message-author-role="assistant"], [data-role="assistant"], .ds-markdown, [data-testid="thinking"], [data-role="reasoning"], .ds-think-content, .ds-think-content-wrapper')]
      .filter(node => visible(node) && !node.closest('form,textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],script,style,[data-message-author-role="user"],[data-role="user"],[data-testid="user-message"],.user-message,nav,aside,[role="navigation"]')).at(-1);
    const parent = latest?.parentElement;
    const response = latest?.closest('[data-message-author-role="assistant"], [data-role="assistant"], .ds-message, article') ||
      (parent && !parent.matches('body,html,main') ? parent : latest);
    const scopes = [composer, response].filter(Boolean);
    return [...document.querySelectorAll('.ds-loading')].some(node => visible(node) &&
      !node.closest('nav,aside,[role="navigation"]') && scopes.some(scope => scope === node || scope.contains(node)));
  };
  const busy = anyVisible([
    '[data-is-streaming="true"]', ...(provider === 'chatgpt' ? ['.result-streaming'] : []), '[data-testid="stop-button"]',
    'button[aria-label*="Stop" i]', 'button[title*="Stop" i]', '[role="button"][aria-label*="Stop" i]', '[role="button"][title*="Stop" i]',
    'button[aria-label*="停止"]', '[role="button"][aria-label*="停止"]'
  ]) || provider === 'deepseek' && deepseekLoading();
  const login = /^\/(?:auth|login|sign_in)(?:\/|$)/i.test(location.pathname) || anyVisible([
    'form[data-logged-out]', '[data-testid="login-button"]', '[data-testid="sign-in-button"]',
    'input[type="password"]', 'input[autocomplete="one-time-code"]'
  ]);
  if (busy || login) return { ready: false, busy, url };
  const selectors = provider === 'chatgpt' ? [
    '#prompt-textarea', '[data-testid="prompt-textarea"]',
    'div[contenteditable="true"][data-id="root"]', 'textarea[data-id="root"]', 'textarea[name="prompt"]',
    'form textarea', 'form [contenteditable="true"]', 'form [contenteditable="plaintext-only"]'
  ] : [
    '#chat-input', 'textarea[placeholder*="DeepSeek"]', 'textarea[placeholder*="发送"]',
    'form textarea', '[contenteditable="true"][role="textbox"]'
  ];
  const writable = node => visible(node) && !node.closest('[inert], [data-message-author-role], [data-role="assistant"], [data-role="user"], [data-testid^="conversation-turn"]') &&
    !node.disabled && !node.readOnly && node.getAttribute('aria-disabled') !== 'true' &&
    node.matches('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
  for (const selector of selectors) {
    const editors = new Set([...document.querySelectorAll(selector)].flatMap(node =>
      node.matches('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]') ? [node] :
        [...node.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')]).filter(writable));
    if (editors.size === 1) {
      const editor = [...editors][0];
      // DeepSeek's sender preserves drafts and attachments; skip such pages so
      // choosing an idle tab does not immediately fail at the insertion guard.
      if (provider === 'deepseek' && (String(editor.value || editor.textContent || '').replace(/[\u200b\ufeff]/g, '').trim() ||
        document.querySelector('[data-testid="file-thumbnail"], [data-testid="attachment-preview"], [data-testid="attachment"], [data-testid="file-preview"], [data-file-id], [data-state="uploading"]'))) return { ready: false, busy: false, url };
      return { ready: true, busy: false, url };
    }
  }
  return { ready: false, busy: false, url };
}

export async function inspectProviderTab(tab, provider, browser = chrome) {
  if (!Number.isInteger(tab?.id) || !eligibleUrl(tabUrl(tab), provider) || tab.status === 'loading' || tab.pendingUrl) return unavailable();
  let timer;
  const inspect = async () => {
    try {
      const before = await browser.tabs.get(tab.id);
      if (!eligibleUrl(before.url, provider) || before.status === 'loading' || before.pendingUrl) return unavailable();
      const result = await browser.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] },
        func: providerTabState, args: [provider, new URL(providerHome(provider)).origin] });
      const state = result?.[0]?.result;
      const after = await browser.tabs.get(tab.id);
      if (!state || after.status === 'loading' || after.pendingUrl || after.url !== before.url ||
          !eligibleUrl(state.url, provider) || new URL(state.url).pathname !== new URL(after.url).pathname) return unavailable();
      return { ready: state.ready === true && state.busy === false, busy: state.busy === true, url: state.url };
    } catch { return unavailable(); }
  };
  try {
    // An unresponsive page must not stall selection of later open chats.
    return await Promise.race([inspect(), new Promise(resolve => { timer = setTimeout(() => resolve(unavailable()), 2000); })]);
  } finally { clearTimeout(timer); }
}

export async function firstIdleProviderTab(provider, { browser = chrome, excludeTabIds = [] } = {}) {
  const excluded = new Set(excludeTabIds);
  for (const tab of await providerTabs(provider, browser)) {
    if (excluded.has(tab.id)) continue;
    const state = await inspectProviderTab(tab, provider, browser);
    if (state.ready && !state.busy) return tab;
  }
  return null;
}

export async function focusProviderTab(tab, browser = chrome) {
  if (!Number.isInteger(tab?.id)) throw new Error('The AI tab is unavailable. Try opening it again.');
  await browser.tabs.update(tab.id, { active: true });
  if (Number.isInteger(tab.windowId)) await browser.windows.update(tab.windowId, { focused: true });
  return tab;
}

export async function openProviderTab(provider, { url = null, browser = chrome, focus = true } = {}) {
  const home = providerHome(provider), saved = url == null ? null : providerUrl(url, provider, true);
  if (!home) throw new Error('Choose ChatGPT or DeepSeek.');
  if (url != null && !saved) throw new Error('This AI conversation link is invalid.');
  let pending = opening.get(browser);
  if (!pending) { pending = new Map(); opening.set(browser, pending); }
  const key = `${provider}:${saved || 'home'}`;
  let operation = pending.get(key);
  if (!operation) operation = (async () => {
    // Opening a saved conversation never submits, so focus it even while it is
    // generating; choosing a destination for a new job excludes busy pages.
    let tab = saved ? (await providerTabs(provider, browser)).find(tab => providerUrl(tabUrl(tab), provider, true) === saved) :
      await firstIdleProviderTab(provider, { browser });
    tab ||= await browser.tabs.create({ url: saved || home, active: focus });
    return tab;
  })();
  pending.set(key, operation);
  try {
    const tab = await operation;
    // Focus is per caller: a foreground request that joins a background open
    // still focuses the tab, while background callers never steal focus.
    return focus ? await focusProviderTab(tab, browser) : tab;
  } finally { if (pending.get(key) === operation) pending.delete(key); }
}
