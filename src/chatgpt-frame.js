// Observe ChatGPT only when it is embedded by this extension. The website owns
// its composer, conversations and authentication; no tokens or chats are stored.
(() => {
  if (window === window.top) return;
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  if (location.ancestorOrigins[0] !== extensionOrigin) return;
  const channel = 'ai-agent-template.sidebar';
  let nonce;
  let timer;
  let stateTimer, lastConnectionState;
  let lastState;
  let fontPercent = 100;
  let fontStyle;
  let fontTargets = new Set();
  let previousInert = null;
  function setInteractive(active) {
    const root = document.documentElement;
    if (!root || typeof active !== 'boolean') return;
    if (!active && previousInert === null) { previousInert = root.inert; root.inert = true; }
    else if (active && previousInert !== null) { root.inert = previousInert; previousInert = null; }
  }
  const heldShortcuts = new Set();
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  window.addEventListener('keydown', event => {
    const key = event.code || event.key;
    if (event.repeat && heldShortcuts.has(key)) { consume(event); return; }
    const action = globalThis.AiAgentWorkspaceKeys?.action(event);
    if (!action || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
      if (!event.repeat) heldShortcuts.delete(key);
      return;
    }
    heldShortcuts.add(key); consume(event);
    // Reserve the chord during the handshake too: Ctrl+Enter must never fall
    // through to ChatGPT's Send behavior while the sidebar is connecting.
    if (!nonce) return;
    // Runtime messaging authenticates this isolated content script. A page's
    // postMessage cannot manufacture a queue action or a trusted key press.
    void chrome.runtime.sendMessage({ type: 'workspace.shortcut', nonce, action, pressId: crypto.randomUUID() }).catch(() => {});
  }, true);
  window.addEventListener('keyup', event => {
    if (event.isTrusted && heldShortcuts.delete(event.code || event.key)) consume(event);
  }, true);

  function resizeText() {
    if (fontPercent === 100) {
      for (const element of fontTargets) {
        element.removeAttribute('data-ai-sidebar-font');
        element.style.removeProperty('--ai-sidebar-font-size');
      }
      fontTargets.clear();
      fontStyle?.remove();
      fontStyle = undefined;
      return;
    }
    if (!document.body) return;
    if (!fontStyle?.isConnected) {
      fontStyle = document.createElement('style');
      (document.head || document.documentElement).append(fontStyle);
    }
    const rule = `[data-ai-sidebar-font] { font-size: calc(var(--ai-sidebar-font-size) * ${fontPercent / 100}) !important; }`;
    if (fontStyle.textContent !== rule) fontStyle.textContent = rule;
    // Measure native typography with our rule disabled so inherited sizes never
    // compound when a message streams or the selected percentage changes.
    fontStyle.sheet.disabled = true;
    const targets = new Set(document.body.querySelectorAll('textarea, input:not([type="hidden"]), select, [contenteditable="true"]'));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const parent = text.parentElement;
      if (text.textContent.trim() && parent?.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
          !parent.closest('script, style, noscript, template')) targets.add(parent);
    }
    for (const element of fontTargets) {
      if (targets.has(element)) continue;
      element.removeAttribute('data-ai-sidebar-font');
      element.style.removeProperty('--ai-sidebar-font-size');
    }
    const sizes = [...targets].map(element => [element, getComputedStyle(element).fontSize]);
    for (const [element, size] of sizes) {
      if (element.style.getPropertyValue('--ai-sidebar-font-size') !== size) element.style.setProperty('--ai-sidebar-font-size', size);
      if (!element.hasAttribute('data-ai-sidebar-font')) element.setAttribute('data-ai-sidebar-font', '');
    }
    fontTargets = targets;
    fontStyle.sheet.disabled = false;
  }

  function setFontSize(percent) {
    if (!Number.isInteger(percent) || percent < 50 || percent > 150 || percent === fontPercent) return;
    fontPercent = percent;
    resizeText();
  }

  function post(data) {
    if (nonce) window.parent.postMessage({ channel, nonce, ...data }, extensionOrigin);
  }
  // Read-only UI state: never insert text, submit, or read conversation replies.
  const visible = node => Boolean(node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  function inspectView() {
    const candidates = [...document.querySelectorAll('#prompt-textarea, [data-testid="prompt-textarea"], form textarea, form [contenteditable="true"]')];
    const editor = candidates.map(node => node.matches('textarea,[contenteditable="true"]') ? node : node.querySelector('textarea,[contenteditable="true"]')).find(visible);
    const signedOut = [...document.querySelectorAll('form[data-logged-out], [data-testid="login-button"], [data-testid="signup-button"], [data-testid="sign-in-button"], [data-testid="logged-out"], a[href*="/auth/login"], a[href*="/auth/signup"]')].some(visible) ||
      [...document.querySelectorAll('button, a, [role="button"]')].some(node => visible(node) && /^(?:log in|sign in|sign up|create account)$/i.test((node.getAttribute('aria-label') || node.textContent).trim()));
    const signedIn = Boolean(document.querySelector('[data-testid="accounts-profile-button"], [data-testid="profile-button"], [data-testid="user-menu-button"], [data-testid="profile-menu-button"], [data-testid="account-menu-trigger"]')) ||
      [...document.querySelectorAll('button[aria-label*="profile" i], button[aria-label*="account" i], [role="button"][aria-label*="profile" i]')].some(visible);
    const attachment = editor?.closest('form')?.querySelector('[data-testid="file-thumbnail"], [data-testid="attachment-preview"], [data-file-id]');
    return { composerPresent: Boolean(editor), composerReady: Boolean(editor && !editor.disabled && !editor.readOnly),
      hasDraft: Boolean((editor?.value || editor?.textContent || '').replace(/[\u200b\ufeff]/g, '').trim() || attachment),
      busy: [...document.querySelectorAll('[data-is-streaming="true"], [data-testid="stop-button"], button[aria-label*="stop generating" i], button[aria-label*="stop streaming" i]')].some(visible),
      authState: signedOut ? 'signed-out' : signedIn ? 'signed-in' : 'unknown' };
  }
  const historyReader = globalThis.AiAgentChatHistory.createReader({ getConnection: inspectView });

  function sendState(force = false) {
    if (!nonce) return;
    const connection = inspectView();
    const ready = connection?.composerPresent === true;
    const guest = connection?.authState === 'signed-out' || Boolean(document.querySelector('form[data-logged-out]'));
    const basic = { type: 'state', url: location.origin + location.pathname, ready, guest, authState: connection?.authState };
    const signature = JSON.stringify([basic,connection?.hasDraft,connection?.busy]);
    if (!force && signature === lastConnectionState) return;
    lastConnectionState = signature;
    const state = { ...basic, history:historyReader.peek(connection) };
    const serialized = JSON.stringify(state);
    if (force || serialized !== lastState) { lastState = serialized; post(state); }
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== extensionOrigin ||
        event.data?.channel !== channel ||
        typeof event.data.nonce !== 'string' || event.data.nonce.length > 100) return;
    if (event.data.type === 'probe') {
      nonce = event.data.nonce;
      setInteractive(event.data.interactive);
      setFontSize(event.data.fontScale);
      sendState(true);
    }
    if (event.data.nonce !== nonce) return;
    const operationId = event.data.operationId;
    if (typeof operationId !== 'string' || !/^[\w-]{1,100}$/.test(operationId)) return;
    if (event.data.type === 'history.command' && event.isTrusted) {
      const reply = value => post({type:'history.reply',operationId,ok:true,value});
      if (event.data.action === 'search') void globalThis.AiAgentNativeSearch({ query: event.data.data?.query ?? '', provider: 'chatgpt' }).then(opened => reply({ ...historyReader.peek(), ...(!opened ? { reason: 'unavailable' } : {}) })).catch(() => post({type:'history.reply',operationId,ok:false}));
      else if (event.data.action === 'inspect') void historyReader.inspect({readOnly:event.data.data?.readOnly === true}).then(reply).catch(() => post({type:'history.reply',operationId,ok:false}));
      else if (event.data.action === 'open') void historyReader.open(event.data.data || {}, reply).catch(() => post({type:'history.reply',operationId,ok:false}));
      return;
    }
  });

  // Authentication needs a first-party tab. Handle only explicit sign-in UI.
  document.addEventListener('click', event => {
    if (!nonce) return;
    const control = event.target?.closest?.('a, button, [role="button"]');
    if (!control) return;
    const href = control.getAttribute('href');
    let loginLink = false;
    if (href) {
      try {
        const url = new URL(href, location.href);
        loginLink = url.origin === 'https://chatgpt.com' && /^\/auth\/(login|signin)(?:\/|$)/.test(url.pathname);
      } catch { /* Ignore malformed links. */ }
    }
    const loginButton = control.matches('[data-testid="login-button"]') ||
      (document.querySelector('form[data-logged-out]') && /^(log in|sign in)$/i.test(control.textContent.trim()));
    if (!loginLink && !loginButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    post({ type: 'sign-in' });
  }, true);

  function scheduleUpdate() {
    // Connection changes wake the host promptly. Font measurement remains
    // throttled and never delays readiness behind a full typography pass.
    if (!stateTimer) stateTimer = setTimeout(() => { stateTimer = undefined; sendState(); }, 0);
    if (fontPercent !== 100 && !timer) timer = setTimeout(() => { timer = undefined; resizeText(); }, 100);
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => !fontStyle?.contains(record.target))) scheduleUpdate();
  });
  function observe() {
    if (document.documentElement) observer.observe(document.documentElement, {
      childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class']
    });
    resizeText();
    sendState();
  }
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });
  window.addEventListener('popstate', () => sendState(true));
  window.addEventListener('resize', scheduleUpdate);
  document.addEventListener('input', scheduleUpdate, true);
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); clearTimeout(stateTimer); });
})();
