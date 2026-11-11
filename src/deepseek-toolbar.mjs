import { createChatToolbar } from './chat-toolbar.mjs';
import { DEEPSEEK_ORIGIN, DEEPSEEK_CHANNEL, deepseekRoutes, deepseekState, deepseekRoute, createDeepseekTransport } from './deepseek-protocol.mjs';
import { createDeepseekRecovery } from './deepseek-recovery.mjs';

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
  let lastStateAt = 0, loadStartedAt = Date.now();
  const status = document.getElementById('deepseek-status');
  const connection = document.getElementById('deepseek-connection'), retry = document.getElementById('deepseek-retry');
  const searchRequests = new Map();
  const historyRequests = new Map();
  const transport = createDeepseekTransport({ frame,
    onData: data => onMessage({ data, source: frame.contentWindow, origin: DEEPSEEK_ORIGIN }),
    onConnect: () => { nonce = crypto.randomUUID(); onLoad(); }
  });
  let historyAttempted = false, historyPending = false;
  function historyCommand(action, extra = {}) {
    return new Promise(resolve => {
      const operationId = crypto.randomUUID();
      const timer = setTimeout(() => { historyRequests.delete(operationId); resolve({ reason: 'timeout' }); }, 8000);
      historyRequests.set(operationId, { resolve, timer });
      if (!command(action, { operationId, ...extra })) { clearTimeout(timer); historyRequests.delete(operationId); resolve({ reason: 'disconnected' }); }
    });
  }
  async function refreshHistory() {
    if (!connected || !state.ready || state.hasDraft || state.busy || historyPending || navigating || historyAttempted) return;
    historyAttempted = true; historyPending = true; render();
    try { await historyCommand('history.inspect'); }
    finally { historyPending = false; render(); }
  }
  async function moveHistory(direction) {
    if (![-1, 1].includes(direction) || !connected || !state.ready || state.hasDraft || state.busy || navigating || historyPending) return;
    const original = currentUrl;
    navigating = true; render();
    const notice = q('native-search-status'); notice.hidden = true;
    const result = await historyCommand('history.move', { direction, currentUrl: original });
    navigating = false; render();
    if (currentUrl === original) {
      const reasons = {
        draft: 'Finish or clear your DeepSeek draft before switching chats.',
        generation: 'Wait for the DeepSeek response to finish before switching chats.',
        loading: 'DeepSeek is still loading its message box. Try again when it is ready.',
        'current-not-loaded': 'This conversation is not in the loaded DeepSeek history. Open its sidebar and scroll to this chat, then try again.',
        boundary: direction === 1 ? 'You are at the oldest loaded DeepSeek chat.' : 'You are at the newest loaded DeepSeek chat.',
        'navigation-unconfirmed': 'DeepSeek did not confirm the chat switch. The page was kept open to preserve your session; use its native history to select the chat.',
        'conversation-changed': 'The current DeepSeek chat changed. Try the arrow again.'
      };
      notice.textContent = reasons[result?.reason] || 'DeepSeek history could not be read. Open its native sidebar once and try the arrow again.';
      notice.hidden = false;
    }
  }
  function command(action, extra = {}) {
    const interactive = !document.getElementById('chat-view').hidden && !pane.hidden;
    return transport.send({ channel: DEEPSEEK_CHANNEL, nonce, action, scale, interactive, ...extra });
  }
  const toolbar = createChatToolbar({ root: pane, idPrefix: 'deepseek-', providerName: 'DeepSeek', routes: deepseekRoutes,
    onNativeSearch: query => new Promise(resolve => {
      const operationId = crypto.randomUUID();
      const timer = setTimeout(() => { searchRequests.delete(operationId); resolve(false); }, 5000);
      searchRequests.set(operationId, { resolve, timer });
      if (!command('search', { operationId, query })) { clearTimeout(timer); searchRequests.delete(operationId); resolve(false); }
    }),
    currentUrl: () => currentUrl, onHistoryNeeded: () => { void refreshHistory(); }, moveHistory: direction => { void moveHistory(direction); } });
  const freshState = () => connected && Date.now() - lastStateAt < 6000;
  const protectedInput = () => state.hasDraft || state.busy || state.hasFormInput;
  const recovery = createDeepseekRecovery({
    online: navigator.onLine !== false,
    getState: () => ({ mounted: frame.hasAttribute('src'), ready: freshState() && state.ready,
      protected: protectedInput() || navigating || historyPending }),
    probe: () => command('probe'), reconnect: () => reconnect({ automatic: true }), onChange: render
  });
  function render() {
    toolbar.updateHistory({ ...state, enabled: connected, navigating, pending: historyPending });
    q('new-chat').disabled = recovery.offline || !connected || !state.ready || protectedInput() || navigating;
    q('reload').disabled = retry.disabled = recovery.offline || !frame.hasAttribute('src') || protectedInput() || navigating || historyPending;
    q('zoom-in').disabled = !connected || scale === 150;
    q('zoom-out').disabled = !connected || scale === 50;
    q('chat-zoom-status').textContent = `Chat text size ${scale}%`;
    q('zoom-in').title = `Increase text size (${scale}%)`; q('zoom-out').title = `Decrease text size (${scale}%)`;
    status.hidden = connection.hidden = !recovery.offline && connected && state.ready;
    retry.hidden = recovery.offline || Date.now() - loadStartedAt < 6000;
    // A hidden or loading composer is not evidence that the session signed out.
    status.textContent = recovery.offline ? 'You’re offline. DeepSeek will retry when your connection returns.'
      : protectedInput() ? 'Waiting for DeepSeek’s message box… Finish or clear the current input or response before reconnecting.'
        : connected ? 'Waiting for DeepSeek’s message box… Use Reload if the page is stuck.'
          : 'Connecting to DeepSeek… Use Reload if the page is stuck.';
  }
  let navigationTimer;
  let pendingNavigation;
  function requestNavigation(action, url, resolve) {
    if (recovery.offline || !connected || (!state.ready && action !== 'reload') || protectedInput() || navigating) return;
    recovery.stop();
    const operationId = crypto.randomUUID();
    pendingNavigation = { action, operationId, url, resolve }; navigating = true; render();
    if (!command(action, { operationId, ...(url ? { url } : {}) })) { pendingNavigation = null; navigating = false; render(); resolve?.(false); return; }
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => { pendingNavigation?.resolve?.(false); pendingNavigation = null; navigating = false; render(); }, 5000);
  }
  function onMessage(event) {
    const data = event.data;
    if (event.source === frame.contentWindow && event.origin === DEEPSEEK_ORIGIN && data?.channel === DEEPSEEK_CHANNEL && data.nonce === nonce && data.type === 'history.reply' && typeof data.dispatched === 'boolean') {
      const request = historyRequests.get(data.operationId);
      if (request && (data.target === undefined || deepseekRoutes.conversation(data.target) === data.target)) {
        clearTimeout(request.timer); historyRequests.delete(data.operationId);
        const reasons = ['draft', 'generation', 'loading', 'current-not-loaded', 'boundary', 'conversation-changed', 'history-unavailable', 'navigation-unconfirmed'];
        request.resolve({ target: data.target, reason: reasons.includes(data.reason) ? data.reason : '' });
      }
      return;
    }
    if (event.source === frame.contentWindow && event.origin === DEEPSEEK_ORIGIN && data?.channel === DEEPSEEK_CHANNEL && data.nonce === nonce && data.type === 'search.reply' && typeof data.ok === 'boolean') {
      const request = searchRequests.get(data.operationId);
      if (request) { clearTimeout(request.timer); searchRequests.delete(data.operationId); request.resolve(data.ok); }
      return;
    }
    if (pendingNavigation && event.source === frame.contentWindow && event.origin === DEEPSEEK_ORIGIN &&
        data?.channel === DEEPSEEK_CHANNEL && data.nonce === nonce && data.type === 'navigate' &&
        data.operationId === pendingNavigation.operationId && data.action === pendingNavigation.action &&
        deepseekRoute(data.url) === data.url && (data.action === 'new' ? data.url === DEEPSEEK_ORIGIN + '/' : data.action === 'open' ? data.url === pendingNavigation.url : data.url === currentUrl)) {
      // The extension initiates full loads so its scoped embed rule still applies.
      const resolve = pendingNavigation.resolve;
      pendingNavigation = null; clearTimeout(navigationTimer); loadFrame(data.url); resolve?.(true);
      return;
    }
    const next = deepseekState(event, frame.contentWindow, nonce);
    if (!next) return;
    if (currentUrl !== next.currentUrl) {
      pendingNavigation?.resolve?.(false); pendingNavigation = null;
      navigating = false; clearTimeout(navigationTimer); q('native-search-status').hidden = true;
    }
    currentUrl = next.currentUrl; state = next; connected = true; lastStateAt = Date.now(); render(); toolbar.updateCurrent();
    if (shell.dataset.open === 'true') void refreshHistory();
  }
  function clearRequests() {
    for (const requests of [searchRequests, historyRequests]) {
      for (const request of requests.values()) { clearTimeout(request.timer); request.resolve(false); }
      requests.clear();
    }
  }
  function onLoad() {
    clearRequests(); historyAttempted = false; historyPending = false; connected = false; navigating = false;
    state = { ...state, ready: false }; lastStateAt = 0; loadStartedAt = Date.now();
    pendingNavigation?.resolve?.(false); pendingNavigation = null; clearTimeout(navigationTimer); render(); command('probe');
  }
  function loadFrame(url) {
    // Retire the old channel before navigation. A browser network-error page
    // cannot answer probes; the replacement document must offer a fresh port.
    transport.close(); nonce = crypto.randomUUID(); currentUrl = url;
    state = { loaded: false, ready: false, hasDraft: false, busy: false, hasFormInput: false, urls: [], chats: [] };
    onLoad(); frame.src = url;
  }
  function reconnect({ automatic = false } = {}) {
    if (recovery.offline || !frame.hasAttribute('src') || protectedInput() || navigating || historyPending) return;
    if (!automatic) recovery.stop();
    if (freshState()) { requestNavigation('reload'); return; }
    // A previously ready page with a silent channel may still hold unseen input.
    // Only an explicit Reload may replace that page without a fresh guard reply.
    if (automatic && state.ready) return;
    loadFrame(deepseekRoute(currentUrl) || deepseekRoute(frame.src) || DEEPSEEK_ORIGIN + '/');
  }
  const onWindowMessage = event => { transport.accept(event); };
  window.addEventListener('message', onWindowMessage); frame.addEventListener('load', onLoad);
  q('new-chat').addEventListener('click', () => requestNavigation('new'));
  q('reload').addEventListener('click', () => reconnect());
  retry.addEventListener('click', () => reconnect());
  q('open-tab').addEventListener('click', () => {
    void chrome.tabs.create({ url: currentUrl }).catch(() => { status.hidden = connection.hidden = false; status.textContent = 'Could not open DeepSeek in a tab.'; });
  });
  for (const [id, delta] of [['zoom-in', 10], ['zoom-out', -10]]) q(id).addEventListener('click', () => {
    scale = Math.max(50, Math.min(150, scale + delta)); command('probe'); render();
  });
  const onOnline = () => recovery.setOnline(true), onOffline = () => recovery.setOnline(false);
  window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
  const poll = setInterval(() => {
    recovery.setOnline(navigator.onLine !== false);
    if (!pane.hidden && frame.hasAttribute('src')) {
      if (lastStateAt && Date.now() - lastStateAt >= 6000) connected = false;
      command('probe'); render();
    }
  }, 1500);
  window.addEventListener('pagehide', () => {
    recovery.dispose(); transport.close(); clearRequests(); clearInterval(poll); clearTimeout(navigationTimer);
    window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline);
    window.removeEventListener('message', onWindowMessage); frame.removeEventListener('load', onLoad);
  }, { once: true });
  render();
  return {
    probe: () => command('probe'),
    getCurrentChat: () => connected ? deepseekRoutes.conversation(currentUrl) : null,
    async openConversation(url) {
      const target = deepseekRoutes.conversation(url);
      if (!target) throw new Error('This is not a DeepSeek conversation URL.');
      const deadline = Date.now() + 6000;
      while ((!connected || !state.ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      if (!connected || !state.ready) throw new Error('Wait for DeepSeek’s message box to load, then open this saved chat again.');
      if (target === currentUrl) return;
      if (state.hasDraft || state.busy || navigating) throw new Error('Finish your DeepSeek draft or response before opening a saved chat.');
      if (!await new Promise(resolve => requestNavigation('open', target, resolve))) throw new Error('DeepSeek did not allow the chat switch. Finish any draft and try again.');
    }
  };
}
