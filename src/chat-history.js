// Read ChatGPT's rendered history links and titles for the current panel only.
// No private endpoints, message contents, or persistent history copies.
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
  function target(values, current, direction, pinnedValues = []) {
    if (![-1, 1].includes(direction)) return null;
    const url = route(current), pinned = new Set(ordered(pinnedValues)), urls = ordered(values).filter(value => !pinned.has(value));
    if (!url) return null;
    if (!conversation(url) || pinned.has(url)) return direction === 1 ? urls[0] || null : null;
    const index = urls.indexOf(url);
    return index < 0 ? null : urls[index + direction] || null;
  }
  const reasons = ['draft','generation','loading','signed-out','unavailable','history-changed','conversation-changed'];
  function snapshot(value) {
    if (!value || !['loaded','ready','hasDraft','busy'].every(key => typeof value[key] === 'boolean') ||
        !route(value.currentUrl) || !Array.isArray(value.urls) || value.urls.length > 300 ||
        value.urls.some(url => !conversation(url)) || value.reason && !reasons.includes(value.reason)) return null;
    if (value.dispatched !== undefined && typeof value.dispatched !== 'boolean') return null;
    if (value.pinnedUrls !== undefined && (!Array.isArray(value.pinnedUrls) || value.pinnedUrls.length > 300 || value.pinnedUrls.some(url => !conversation(url)))) return null;
    const pinnedUrls = ordered(value.pinnedUrls), urls = ordered(value.urls).filter(url => !pinnedUrls.includes(url));
    if (value.chats !== undefined && (!Array.isArray(value.chats) || value.chats.length > 300 ||
        value.chats.some(chat => !chat || !urls.includes(conversation(chat.url)) || typeof chat.title !== 'string' || chat.title.length > 200))) return null;
    const seen = new Set();
    const chats = (value.chats || urls.map(url => ({url,title:'Saved chat'}))).filter(chat => {
      const url = conversation(chat.url); if (seen.has(url)) return false; seen.add(url); return true;
    }).map(chat => ({url:conversation(chat.url),title:chat.title.trim() || 'Untitled chat'}));
    if (value.dispatched && (!conversation(value.target) || !urls.includes(conversation(value.target)))) return null;
    return { loaded:value.loaded, ready:value.ready, hasDraft:value.hasDraft, busy:value.busy,
      currentUrl:route(value.currentUrl), urls, pinnedUrls, chats, ...(value.reason ? {reason:value.reason} : {}),
      ...(value.dispatched !== undefined ? {dispatched:value.dispatched} : {}),
      ...(value.dispatched ? {target:conversation(value.target)} : {}) };
  }
  function createReader({ getConnection, document: doc = document, location: page = location }) {
    let cache = [], chats = [], pinnedUrls = [], loaded = false;
    const links = () => [...doc.querySelectorAll('nav a[href], aside a[href], #history a[href], [data-testid="history"] a[href], [data-testid*="sidebar"] a[href], #stage-slideover-sidebar a[href]')]
      .filter(link => conversation(link.href)).slice(0, 300);
    const visible = node => node && !node.closest('[hidden], [inert]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const emptyHistory = () => {
      const container = doc.querySelector('nav[aria-label="Chat history"], #history, [data-testid="history"]');
      return Boolean(visible(doc.querySelector('[data-testid="history-empty-state"]')) || visible(container) && /(?:no chats|no conversations|start a chat)/i.test(container.textContent || ''));
    };
    function remember(found) {
      const regular = globalThis.AiAgentSidebarHistory.regularHistory(found, conversation);
      pinnedUrls = regular.pinnedUrls;
      const byUrl = new Map();
      for (const link of regular.links) { const url = conversation(link.href); if (!byUrl.has(url)) byUrl.set(url, link); }
      cache = [...byUrl.keys()];
      chats = cache.map(url => {
        const link = byUrl.get(url);
        const title = (link?.getAttribute?.('title') || link?.querySelector?.('[data-testid="conversation-title"], .truncate')?.textContent ||
          link?.textContent || link?.getAttribute?.('aria-label') || 'Untitled chat').replace(/[\u200b\ufeff]/g, '').replace(/\s+/gu, ' ').trim().slice(0, 200);
        return {url,title:title || 'Untitled chat'};
      });
      loaded = true;
    }
    function peek(connection) {
      const found = links();
      if (found.length) remember(found);
      else if (emptyHistory()) remember([]);
      const state = connection || getConnection();
      const editor = doc.querySelector('#prompt-textarea, [data-composer-markdown][contenteditable="true"], textarea[data-mobile-composer-prompt]');
      const draft = editor ? (editor.matches('textarea,input') ? editor.value : editor.textContent || '') : '';
      const editorVisible = editor?.isConnected && editor.getClientRects().length && getComputedStyle(editor).visibility !== 'hidden';
      const streaming = doc.querySelector('[data-is-streaming="true"], button[data-testid="stop-button"], button[aria-label*="stop generating" i], button[aria-label*="stop streaming" i]');
      if (state.authState === 'signed-out') remember([]);
      return { loaded, urls:cache, chats, pinnedUrls, currentUrl:route(page.href) || origin + '/', ready:state.composerReady === true || Boolean(editorVisible && !editor.disabled),
        hasDraft:state.hasDraft === true || Boolean(draft.replace(/[\u200b\ufeff]/g, '').trim()), busy:state.busy === true || Boolean(streaming?.getClientRects().length),
        ...(state.authState === 'signed-out' ? {reason:'signed-out'} : {}) };
    }
    function blocked(state) {
      return state.reason === 'signed-out' ? 'signed-out' : state.hasDraft ? 'draft' : state.busy ? 'generation' : !state.ready ? 'loading' : null;
    }
    const sidebar = globalThis.AiAgentSidebarHistory.create({ document: doc, links, empty: emptyHistory });
    const withLinks = (task, canOpen = () => true) => sidebar.withLinks(found => {
      if (found.length) remember(found);
      else if (emptyHistory()) remember([]);
      return task(found);
    }, { canOpen });
    async function inspect({ readOnly = false } = {}) {
      const state = peek(), reason = blocked(state);
      if (reason && !(readOnly && ['draft', 'generation'].includes(reason))) return {...state,reason};
      return withLinks(() => { const state = peek(); return state.loaded ? state : {...state,reason:'unavailable'}; });
    }
    async function open(data, acknowledge) {
      const initial = peek(), initialReason = blocked(initial);
      if (initialReason) { acknowledge({...initial,reason:initialReason,dispatched:false}); return; }
      await withLinks(found => {
        const state = peek(), reason = blocked(state);
        if (reason) { acknowledge({...state,reason,dispatched:false}); return; }
        if (route(data.currentUrl) !== state.currentUrl) { acknowledge({...state,reason:'conversation-changed',dispatched:false}); return; }
        const next = data.selection === true ? conversation(data.target) : target(state.urls, state.currentUrl, data.direction, state.pinnedUrls);
        const link = found.find(link => conversation(link.href) === next && (!link.target || link.target === '_self'));
        if (!next || !state.urls.includes(next) || next !== conversation(data.target) || !link?.isConnected) {
          acknowledge({...state,reason:'history-changed',dispatched:false}); return;
        }
        // Fresh draft/generation checks and this click share one synchronous
        // turn. Never overwrite a composer or retry a dispatched navigation.
        acknowledge({...state,dispatched:true,target:next});
        link.click();
      }, () => !blocked(peek()) && route(data.currentUrl) === route(page.href));
    }
    return { peek, inspect, open };
  }
  globalThis.AiAgentChatHistory = Object.freeze({ route, conversation, ordered, target, snapshot, createReader });
})();
