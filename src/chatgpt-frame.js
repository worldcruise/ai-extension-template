// Observe ChatGPT only when it is embedded by this extension. The website owns
// its composer, conversations and authentication; no tokens or chats are stored.
(() => {
  if (window === window.top) return;
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  if (location.ancestorOrigins[0] !== extensionOrigin) return;
  const channel = 'ai-agent-template.sidebar';
  let nonce;
  let timer;
  let lastState;
  let fontPercent = 100;
  let fontStyle;
  let fontTargets = new Set();

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

  function sendState(force = false) {
    if (!nonce) return;
    const editor = document.querySelector('#prompt-textarea, [data-composer-markdown][contenteditable="true"], textarea[data-mobile-composer-prompt]');
    const ready = Boolean(editor?.getClientRects().length);
    const guest = Boolean(document.querySelector('form[data-logged-out]'));
    const state = { type: 'state', url: location.origin + location.pathname, ready, guest };
    const serialized = JSON.stringify(state);
    if (force || serialized !== lastState) { lastState = serialized; post(state); }
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== extensionOrigin ||
        event.data?.channel !== channel ||
        typeof event.data.nonce !== 'string' || event.data.nonce.length > 100) return;
    if (event.data.type === 'probe') {
      nonce = event.data.nonce;
      setFontSize(event.data.fontScale);
      sendState(true);
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
    if (timer) return;
    timer = setTimeout(() => { timer = undefined; resizeText(); sendState(); }, 100);
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
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); });
})();
