// Only user-requested toolbar navigation and text sizing; never insert or send.
(() => {
  if (window === window.top || location.ancestorOrigins[0] !== chrome.runtime.getURL('').replace(/\/$/, '')) return;
  const parentOrigin = location.ancestorOrigins[0], channel = 'ai-agent-template.deepseek';
  let nonce, scale = 100, style, timer;
  const visible = node => node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  function route(value) {
    try { const url = new URL(value, location.origin); return url.origin === location.origin && !url.username && !url.password && /^\/(?:a\/chat\/[\w-]+)?\/?$/.test(url.pathname) ? url.origin + url.pathname : null; } catch { return null; }
  }
  function state() {
    const editors = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible);
    const hasDraft = editors.some(node => (node.value || node.textContent || '').replace(/[\u200b\ufeff]/g, '').trim()) || Boolean(document.querySelector('[data-testid="attachment"], [data-testid="file-preview"], [data-state="uploading"]'));
    const busy = [...document.querySelectorAll('[data-is-streaming="true"], [data-testid="stop-button"], button[aria-label*="stop" i], button[title*="stop" i], [role="button"][aria-label*="stop" i]')].some(visible);
    const chats = [], seen = new Set();
    for (const link of document.querySelectorAll('a[href]')) {
      const url = route(link.href);
      if (!url?.includes('/a/chat/') || seen.has(url)) continue;
      seen.add(url); chats.push({ url, title: (link.getAttribute('title') || link.textContent || 'Untitled chat').replace(/\s+/g, ' ').trim().slice(0, 200) });
      if (chats.length === 300) break;
    }
    return { url: route(location.href) || location.origin + '/', ready: editors.some(node => !node.disabled), hasDraft, busy, chats };
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
  function post() { if (nonce) window.parent.postMessage({ channel, nonce, type: 'state', ...state() }, parentOrigin); }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || event.origin !== parentOrigin || data?.channel !== channel || typeof data.nonce !== 'string' || !/^[\w-]{1,100}$/.test(data.nonce)) return;
    if (data.action === 'probe') {
      nonce = data.nonce;
      if (Number.isInteger(data.scale) && data.scale >= 50 && data.scale <= 150 && data.scale !== scale) { scale = data.scale; resize(); }
      post(); return;
    }
    if (data.nonce !== nonce) return;
    if (data.action === 'search' && typeof data.operationId === 'string' && /^[\w-]{1,100}$/.test(data.operationId)) {
      void globalThis.AiAgentNativeSearch({ query: data.query ?? '', provider: 'deepseek' }).then(ok => window.parent.postMessage({ channel, nonce, type: 'search.reply', operationId: data.operationId, ok }, parentOrigin)).catch(() => window.parent.postMessage({ channel, nonce, type: 'search.reply', operationId: data.operationId, ok: false }, parentOrigin));
      return;
    }
    const current = state();
    if (current.hasDraft || current.busy || !current.ready) { post(); return; }
    if (['reload', 'new'].includes(data.action) && typeof data.operationId === 'string' && /^[\w-]{1,100}$/.test(data.operationId)) {
      window.parent.postMessage({ channel, nonce, type: 'navigate', operationId: data.operationId,
        action: data.action, url: data.action === 'new' ? location.origin + '/' : current.url }, parentOrigin);
      return;
    }
    if (data.action === 'open' && data.currentUrl === current.url) {
      const target = route(data.target);
      const link = [...document.querySelectorAll('a[href]')].find(node => route(node.href) === target && (!node.target || node.target === '_self'));
      if (target?.includes('/a/chat/') && link?.isConnected) link.click();
    }
    post();
  });
  const observer = new MutationObserver(() => {
    clearTimeout(timer); timer = setTimeout(() => { observer.disconnect(); resize(); observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); post(); }, 120);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('input', post, true);
  setInterval(post, 1000);
})();
