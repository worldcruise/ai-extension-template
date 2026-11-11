// Toolbar navigation, guarded network recovery and text sizing; never insert or send.
(() => {
  if (window === window.top || location.ancestorOrigins[0] !== chrome.runtime.getURL('').replace(/\/$/, '')) return;
  const parentOrigin = location.ancestorOrigins[0], channel = 'ai-agent-template.deepseek';
  const transport = new MessageChannel();
  const sendToHost = data => { try { transport.port1.postMessage(data); } catch { /* The panel was closed. */ } };
  let nonce, scale = 100, style, timer;
  let previousInert = null;
  function setInteractive(active) {
    const root = document.documentElement;
    if (!root || typeof active !== 'boolean') return;
    if (!active && previousInert === null) { previousInert = root.inert; root.inert = true; }
    else if (active && previousInert !== null) { root.inert = previousInert; previousInert = null; }
  }
  let historyLoaded = false, cachedChats = [], pinnedUrls = [];
  const visible = node => node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const routes = globalThis.AiAgentDeepseekRoutes, route = routes.route;
  const historyLinks = () => [...document.querySelectorAll('nav a[href], aside a[href], #history a[href], [data-testid*="sidebar"] a[href], a[href^="/a/chat/s/"], a[href^="https://chat.deepseek.com/a/chat/s/"]')].filter(link => routes.conversation(link.href)).slice(0, 300);
  function remember(found) {
    const regular = globalThis.AiAgentSidebarHistory.regularHistory(found, routes.conversation);
    pinnedUrls = regular.pinnedUrls;
    const seen = new Set();
    cachedChats = regular.links.filter(link => { const url = route(link.href); if (seen.has(url)) return false; seen.add(url); return true; })
      .map(link => ({ url: route(link.href), title: (link.getAttribute('title') || link.textContent || 'Untitled chat').replace(/\s+/g, ' ').trim().slice(0, 200) }));
    historyLoaded = true;
  }
  const emptyHistory = () => visible(document.querySelector('[data-testid="history-empty-state"]'));
  function sidebarIcon() {
    return [...document.querySelectorAll('div[role="button"][tabindex="0"]')].find(node => {
      if (!visible(node) || node.closest('form, .ds-message, [role="dialog"]') || node.getAttribute('aria-disabled') === 'true' || !node.querySelector('svg')) return false;
      const name = [node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent].filter(Boolean).join(' ').trim();
      if (name && !/sidebar|侧边栏/i.test(name)) return false;
      const rect = node.getBoundingClientRect();
      return rect.left >= 0 && rect.left < 96 && rect.top >= 0 && rect.top < 120 && rect.width > 0 && rect.width <= 64 && rect.height > 0 && rect.height <= 64;
    }) || null;
  }
  const sidebar = globalThis.AiAgentSidebarHistory.create({ links: historyLinks, empty: emptyHistory, fallbackControl: sidebarIcon, waitMs: 3500 });
  function state() {
    const editors = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(node => node.isConnected);
    const hasDraft = editors.some(node => (node.value || node.textContent || '').replace(/[\u200b\ufeff]/g, '').trim()) || Boolean(document.querySelector('[data-testid="attachment"], [data-testid="file-preview"], [data-state="uploading"]'));
    // Send only a boolean, never sign-in details. Recovery must not clear a
    // password, verification code, file selection, or other unfinished input.
    const hasFormInput = [...document.querySelectorAll('input')].some(node => visible(node) &&
      !['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color'].includes(node.type) && Boolean(node.value));
    const busy = [...document.querySelectorAll('[data-is-streaming="true"], [data-testid="stop-button"], button[aria-label*="stop" i], button[title*="stop" i], [role="button"][aria-label*="stop" i]')].some(visible);
    const found = historyLinks();
    if (found.length) remember(found);
    else if (emptyHistory()) remember([]);
    return { url: route(location.href) || location.origin + '/', ready: editors.some(node => visible(node) && !node.disabled), hasDraft, busy, hasFormInput, chats: cachedChats, pinnedUrls, loaded: historyLoaded };
  }
  function resize() {
    if (!document.body || scale === 100 && !style) return;
    if (!style?.isConnected) { style = document.createElement('style'); (document.head || document.documentElement).append(style); }
    style.textContent = `[data-deepseek-font] {font-size:calc(var(--deepseek-native-font) * ${scale / 100}) !important}`;
    style.sheet.disabled = true;
    const targets = [...document.body.querySelectorAll('*')].filter(node => !node.closest('script,style,svg,noscript') &&
      (node.matches('textarea,input,[contenteditable="true"]') || [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())));
    const sizes = targets.map(node => [node, getComputedStyle(node).fontSize]);
    for (const [node, size] of sizes) { node.style.setProperty('--deepseek-native-font', size); node.setAttribute('data-deepseek-font', ''); }
    style.sheet.disabled = false;
  }
  function post() { if (nonce) sendToHost({ channel, nonce, type: 'state', ...state() }); }
  transport.port1.onmessage = event => {
    const data = event.data;
    if (data?.channel !== channel || typeof data.nonce !== 'string' || !/^[\w-]{1,100}$/.test(data.nonce)) return;
    if (data.action === 'probe') {
      nonce = data.nonce;
      setInteractive(data.interactive);
      if (Number.isInteger(data.scale) && data.scale >= 50 && data.scale <= 150 && data.scale !== scale) { scale = data.scale; resize(); }
      post(); return;
    }
    if (data.nonce !== nonce) return;
    if (['history.inspect', 'history.move'].includes(data.action) && typeof data.operationId === 'string' && /^[\w-]{1,100}$/.test(data.operationId)) {
      const requestNonce = nonce;
      const originalEditors = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible);
      let reason = 'history-unavailable';
      const allowed = () => {
        const current = state();
        if (nonce !== requestNonce || data.action === 'history.move' && current.url !== data.currentUrl) { reason = 'conversation-changed'; return false; }
        if (current.hasDraft || current.busy) { reason = current.hasDraft ? 'draft' : 'generation'; return false; }
        if (!current.ready && !originalEditors.some(node => node.isConnected && !node.disabled)) { reason = 'loading'; return false; }
        return true;
      };
      let dispatched = false;
      const operation = allowed() ? sidebar.withLinks(async found => {
        if (!allowed()) return;
        if (found.length || emptyHistory()) remember(found);
        if (data.action !== 'history.move') { reason = found.length || emptyHistory() ? '' : 'history-unavailable'; return; }
        if (![-1, 1].includes(data.direction)) return;
        const current = state(), urls = cachedChats.map(chat => chat.url);
        const target = routes.target(urls, current.url, data.direction, pinnedUrls);
        if (!target) { reason = !urls.length && !historyLoaded ? 'history-unavailable' : routes.conversation(current.url) && !urls.includes(current.url) && !pinnedUrls.includes(current.url) ? 'current-not-loaded' : 'boundary'; return; }
        const link = found.find(link => route(link.href) === target && (!link.target || link.target === '_self'));
        if (target !== current.url && link?.isConnected) {
          // Let DeepSeek's delegated SPA handler run, then cancel the browser's
          // default full-document navigation. Never reload as a fallback.
          const preventReload = event => { if (event.composedPath().includes(link)) event.preventDefault(); };
          window.addEventListener('click', preventReload);
          try { dispatched = true; link.click(); }
          finally { window.removeEventListener('click', preventReload); }
          const deadline = Date.now() + 2200;
          while (nonce === requestNonce && route(location.href) === current.url && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
          reason = route(location.href) === target ? '' : 'navigation-unconfirmed';
        }
      }, { canOpen: allowed, allowHidden: data.action === 'history.move' }) : Promise.resolve();
      void operation.then(() => {
        if (nonce !== requestNonce) return;
        post(); sendToHost({ channel, nonce: requestNonce, type: 'history.reply', operationId: data.operationId, dispatched, reason });
      }).catch(() => { if (nonce === requestNonce) { post(); sendToHost({ channel, nonce: requestNonce, type: 'history.reply', operationId: data.operationId, dispatched: false, reason: 'history-unavailable' }); } });
      return;
    }
    if (data.action === 'search' && typeof data.operationId === 'string' && /^[\w-]{1,100}$/.test(data.operationId)) {
      void globalThis.AiAgentNativeSearch({ query: data.query ?? '', provider: 'deepseek' }).then(ok => sendToHost({ channel, nonce, type: 'search.reply', operationId: data.operationId, ok })).catch(() => sendToHost({ channel, nonce, type: 'search.reply', operationId: data.operationId, ok: false }));
      return;
    }
    const current = state();
    if (current.hasDraft || current.busy || current.hasFormInput || (!current.ready && data.action !== 'reload')) { post(); return; }
    if (['reload', 'new', 'open'].includes(data.action) && typeof data.operationId === 'string' && /^[\w-]{1,100}$/.test(data.operationId)) {
      if (data.action === 'open' && routes.conversation(data.url) !== data.url) return;
      sendToHost({ channel, nonce, type: 'navigate', operationId: data.operationId,
        action: data.action, url: data.action === 'new' ? location.origin + '/' : data.action === 'open' ? data.url : current.url });
      return;
    }
    post();
  };
  transport.port1.start();
  window.parent.postMessage({ channel, type: 'hello' }, parentOrigin, [transport.port2]);
  const observer = new MutationObserver(() => {
    clearTimeout(timer); timer = setTimeout(() => { observer.disconnect(); resize(); observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); post(); }, 120);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('input', post, true);
  setInterval(post, 1000);
})();
