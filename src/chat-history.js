// Read only ChatGPT's rendered history. No private endpoints or chat titles.
(() => {
  if (globalThis.AiAgentChatHistory) return;
  const origin = 'https://chatgpt.com';
  function route(value) {
    try {
      const url = new URL(value, origin);
      if (typeof value !== 'string' || value.length > 500 || url.origin !== origin || url.username || url.password ||
          !/^\/(?:c\/[\w-]+|g\/[\w-]+(?:\/c\/[\w-]+)?)?\/?$/.test(url.pathname)) return null;
      return origin + url.pathname.replace(/\/$/, '') + (url.pathname === '/' ? '/' : '');
    } catch { return null; }
  }
  const conversation = value => { const url = route(value); return url?.includes('/c/') ? url : null; };
  function ordered(values) {
    return [...new Set((Array.isArray(values) ? values : []).slice(0, 300).map(conversation).filter(Boolean))];
  }
  function target(values, current, direction) {
    if (![-1, 1].includes(direction)) return null;
    const url = route(current), urls = ordered(values);
    if (!url) return null;
    if (!conversation(url)) return direction === 1 ? urls[0] || null : null;
    const index = urls.indexOf(url);
    return index < 0 ? null : urls[index + direction] || null;
  }
  const reasons = ['draft','generation','loading','signed-out','unavailable','history-changed','conversation-changed'];
  function snapshot(value) {
    if (!value || !['loaded','ready','hasDraft','busy'].every(key => typeof value[key] === 'boolean') ||
        !route(value.currentUrl) || !Array.isArray(value.urls) || value.urls.length > 300 ||
        value.urls.some(url => !conversation(url)) || value.reason && !reasons.includes(value.reason)) return null;
    if (value.dispatched !== undefined && typeof value.dispatched !== 'boolean') return null;
    const urls = ordered(value.urls);
    if (value.dispatched && (!conversation(value.target) || !urls.includes(conversation(value.target)))) return null;
    return { loaded:value.loaded, ready:value.ready, hasDraft:value.hasDraft, busy:value.busy,
      currentUrl:route(value.currentUrl), urls, ...(value.reason ? {reason:value.reason} : {}),
      ...(value.dispatched !== undefined ? {dispatched:value.dispatched} : {}),
      ...(value.dispatched ? {target:conversation(value.target)} : {}) };
  }
  function createReader({ getConnection, document: doc = document, location: page = location }) {
    let cache = [], loaded = false;
    const links = () => [...doc.querySelectorAll('nav a[href], aside a[href], #history a[href], [data-testid="history"] a[href]')]
      .filter(link => conversation(link.href)).slice(0, 300);
    const visible = node => node && !node.closest('[hidden], [inert]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const control = selectors => [...doc.querySelectorAll(selectors)].find(visible);
    const emptyHistory = () => Boolean(doc.querySelector('[data-testid="history-empty-state"]')) ||
      /(?:no chats|no conversations|start a chat)/i.test(doc.querySelector('nav[aria-label="Chat history"], #history, [data-testid="history"]')?.textContent || '');
    function peek() {
      const found = links();
      if (found.length) { cache = ordered(found.map(link => link.href)); loaded = true; }
      else if (emptyHistory()) { cache = []; loaded = true; }
      const state = getConnection();
      const editor = doc.querySelector('#prompt-textarea, [data-composer-markdown][contenteditable="true"], textarea[data-mobile-composer-prompt]');
      const draft = editor ? (editor.matches('textarea,input') ? editor.value : editor.textContent || '') : '';
      const editorVisible = editor?.isConnected && editor.getClientRects().length && getComputedStyle(editor).visibility !== 'hidden';
      const streaming = doc.querySelector('[data-is-streaming="true"], button[data-testid="stop-button"], button[aria-label*="stop generating" i], button[aria-label*="stop streaming" i]');
      if (state.authState === 'signed-out') { cache = []; loaded = true; }
      return { loaded, urls:cache, currentUrl:route(page.href) || origin + '/', ready:state.composerReady === true || Boolean(editorVisible && !editor.disabled),
        hasDraft:state.hasDraft === true || Boolean(draft.replace(/[\u200b\ufeff]/g, '').trim()), busy:state.busy === true || Boolean(streaming?.getClientRects().length),
        ...(state.authState === 'signed-out' ? {reason:'signed-out'} : {}) };
    }
    function blocked(state) {
      return state.reason === 'signed-out' ? 'signed-out' : state.hasDraft ? 'draft' : state.busy ? 'generation' : !state.ready ? 'loading' : null;
    }
    async function withLinks(task) {
      let opened = false;
      try {
        if (!links().length) {
          const open = control('button[data-testid="open-sidebar-button"], button[aria-label="Open sidebar" i]');
          if (open) {
            open.click(); opened = true;
            for (let count = 0; count < 30 && !links().length; count++) await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        const found = links();
        if (found.length) { cache = ordered(found.map(link => link.href)); loaded = true; }
        else if (emptyHistory()) { cache = []; loaded = true; }
        return task(found);
      } finally {
        if (opened) control('button[data-testid="close-sidebar-button"], button[aria-label="Close sidebar" i]')?.click();
      }
    }
    async function inspect() {
      const state = peek(), reason = blocked(state);
      if (reason) return {...state,reason};
      return withLinks(() => { const state = peek(); return state.loaded ? state : {...state,reason:'unavailable'}; });
    }
    async function open(data, acknowledge) {
      const initial = peek(), initialReason = blocked(initial);
      if (initialReason) { acknowledge({...initial,reason:initialReason,dispatched:false}); return; }
      await withLinks(found => {
        const state = peek(), reason = blocked(state);
        if (reason) { acknowledge({...state,reason,dispatched:false}); return; }
        if (route(data.currentUrl) !== state.currentUrl) { acknowledge({...state,reason:'conversation-changed',dispatched:false}); return; }
        const next = target(state.urls, state.currentUrl, data.direction);
        const link = found.find(link => conversation(link.href) === next && (!link.target || link.target === '_self'));
        if (!next || next !== conversation(data.target) || !link?.isConnected) {
          acknowledge({...state,reason:'history-changed',dispatched:false}); return;
        }
        // Fresh draft/generation checks and this click share one synchronous
        // turn. Never overwrite a composer or retry a dispatched navigation.
        acknowledge({...state,dispatched:true,target:next});
        link.click();
      });
    }
    return { peek, inspect, open };
  }
  globalThis.AiAgentChatHistory = Object.freeze({ route, conversation, ordered, target, snapshot, createReader });
})();
