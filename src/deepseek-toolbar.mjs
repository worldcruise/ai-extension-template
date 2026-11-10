import { createChatToolbar } from './chat-toolbar.mjs';
import { DEEPSEEK_ORIGIN, DEEPSEEK_CHANNEL, deepseekRoutes, deepseekState, deepseekRoute } from './deepseek-protocol.mjs';

export function createDeepseekToolbar() {
  const pane = document.getElementById('deepseek-pane'), frame = document.getElementById('deepseek-frame');
  const shell = document.getElementById('chat-toolbar-shell').cloneNode(true);
  // Reuse the same layout and interaction controller with independent identities.
  for (const node of [shell, ...shell.querySelectorAll('*')]) {
    for (const attr of ['id', 'for', 'aria-controls', 'aria-describedby', 'aria-activedescendant']) {
      if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).split(' ').map(id => 'deepseek-' + id).join(' '));
    }
    for (const attr of ['title', 'aria-label']) if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).replaceAll('ChatGPT', 'DeepSeek'));
    for (const child of node.childNodes) if (child.nodeType === 3) child.textContent = child.textContent.replaceAll('ChatGPT', 'DeepSeek');
  }
  shell.dataset.open = 'false'; shell.dataset.pinned = 'false';
  pane.prepend(shell);
  const q = id => document.getElementById('deepseek-' + id);
  let nonce = crypto.randomUUID(), currentUrl = DEEPSEEK_ORIGIN + '/', scale = 100, connected = false, navigating = false;
  let state = { loaded: false, ready: false, hasDraft: false, busy: false, urls: [], chats: [] };
  const status = document.getElementById('deepseek-status');
  const searchRequests = new Map();
  function command(action, extra = {}) {
    frame.contentWindow?.postMessage({ channel: DEEPSEEK_CHANNEL, nonce, action, scale, ...extra }, DEEPSEEK_ORIGIN);
  }
  const toolbar = createChatToolbar({ root: pane, idPrefix: 'deepseek-', providerName: 'DeepSeek', routes: deepseekRoutes,
    onNativeSearch: query => new Promise(resolve => {
      const operationId = crypto.randomUUID();
      const timer = setTimeout(() => { searchRequests.delete(operationId); resolve(false); }, 5000);
      searchRequests.set(operationId, { resolve, timer }); command('search', { operationId, query });
    }),
    currentUrl: () => currentUrl, onHistoryNeeded: () => command('probe'), onChatsRefresh: () => command('probe'),
    selectConversation: chat => navigate(chat.url), moveHistory: direction => navigate(deepseekRoutes.target(state.urls, currentUrl, direction)) });
  function render() {
    toolbar.updateHistory({ ...state, enabled: connected, navigating });
    q('new-chat').disabled = q('reload').disabled = !connected || !state.ready || state.hasDraft || state.busy || navigating;
    q('zoom-in').disabled = !connected || scale === 150;
    q('zoom-out').disabled = !connected || scale === 50;
    q('chat-zoom-status').textContent = `Chat text size ${scale}%`;
    q('zoom-in').title = `Increase text size (${scale}%)`; q('zoom-out').title = `Decrease text size (${scale}%)`;
    status.hidden = connected && state.ready;
    status.textContent = connected ? 'Sign in to DeepSeek to use chat controls. If needed, open DeepSeek in a tab.' : 'Connecting to DeepSeek… If chat does not load, use Open in tab.';
  }
  function navigate(target) {
    if (!target || target === currentUrl || !state.urls.includes(target) || !state.ready || state.hasDraft || state.busy || navigating) return;
    navigating = true; render(); command('open', { target, currentUrl });
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => { navigating = false; render(); }, 8000);
  }
  let navigationTimer;
  let pendingNavigation;
  function requestNavigation(action) {
    if (!connected || !state.ready || state.hasDraft || state.busy || navigating) return;
    const operationId = crypto.randomUUID();
    pendingNavigation = { action, operationId }; navigating = true; render();
    command(action, { operationId });
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => { pendingNavigation = null; navigating = false; render(); }, 5000);
  }
  function onMessage(event) {
    const data = event.data;
    if (event.source === frame.contentWindow && event.origin === DEEPSEEK_ORIGIN && data?.channel === DEEPSEEK_CHANNEL && data.nonce === nonce && data.type === 'search.reply' && typeof data.ok === 'boolean') {
      const request = searchRequests.get(data.operationId);
      if (request) { clearTimeout(request.timer); searchRequests.delete(data.operationId); request.resolve(data.ok); }
      return;
    }
    if (pendingNavigation && event.source === frame.contentWindow && event.origin === DEEPSEEK_ORIGIN &&
        data?.channel === DEEPSEEK_CHANNEL && data.nonce === nonce && data.type === 'navigate' &&
        data.operationId === pendingNavigation.operationId && data.action === pendingNavigation.action &&
        deepseekRoute(data.url) === data.url && (data.action === 'new' ? data.url === DEEPSEEK_ORIGIN + '/' : data.url === currentUrl)) {
      // The extension initiates full loads so its scoped embed rule still applies.
      pendingNavigation = null; clearTimeout(navigationTimer); connected = false; render(); frame.src = data.url;
      return;
    }
    const next = deepseekState(event, frame.contentWindow, nonce);
    if (!next) return;
    if (currentUrl !== next.currentUrl) { navigating = false; clearTimeout(navigationTimer); }
    currentUrl = next.currentUrl; state = next; connected = true; render(); toolbar.updateCurrent();
  }
  function onLoad() { for (const request of searchRequests.values()) { clearTimeout(request.timer); request.resolve(false); } searchRequests.clear(); nonce = crypto.randomUUID(); connected = false; navigating = false; pendingNavigation = null; clearTimeout(navigationTimer); render(); command('probe'); }
  window.addEventListener('message', onMessage); frame.addEventListener('load', onLoad);
  q('new-chat').addEventListener('click', () => requestNavigation('new'));
  q('reload').addEventListener('click', () => requestNavigation('reload'));
  q('open-tab').addEventListener('click', () => {
    void chrome.tabs.create({ url: currentUrl }).catch(() => { status.hidden = false; status.textContent = 'Could not open DeepSeek in a tab.'; });
  });
  for (const [id, delta] of [['zoom-in', 10], ['zoom-out', -10]]) q(id).addEventListener('click', () => {
    scale = Math.max(50, Math.min(150, scale + delta)); command('probe'); render();
  });
  const poll = setInterval(() => { if (!pane.hidden && frame.hasAttribute('src')) command('probe'); }, 1500);
  window.addEventListener('pagehide', () => { clearInterval(poll); clearTimeout(navigationTimer); window.removeEventListener('message', onMessage); frame.removeEventListener('load', onLoad); }, { once: true });
  render();
}
