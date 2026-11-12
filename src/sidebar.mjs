import { CHATGPT_HOME, CHATGPT_ORIGIN, FRAME_CHANNEL, frameMessage, frameShortcutMessage, conversationUrl, linkedConversationUrl } from './sidebar-protocol.mjs';
import { createChatToolbar } from './chat-toolbar.mjs';

export function createChatSidebar({ onOpenChat = () => {}, onShortcut = () => {} } = {}) {
  const frame = document.getElementById('chatgpt-frame');
  const connection = document.getElementById('connection');
  const status = document.getElementById('status');
  const recovery = document.getElementById('recovery');
  const reload = document.getElementById('reload');
  const newChat = document.getElementById('new-chat');
  const zoomIn = document.getElementById('zoom-in');
  const zoomOut = document.getElementById('zoom-out');
  const signIn = document.getElementById('sign-in');
  let currentUrl = CHATGPT_HOME;
  let nonce;
  let watchdog;
  let polling;
  let initialized = false;
  let starting = false;
  let awaitingFrameLoad = false;
  let chatEstablished = false;
  let toolbar;
  let zoomPercent = 100;
  async function navigationGuard() {
    if (!initialized || awaitingFrameLoad) return;
    const current = await historyCommand('inspect', { readOnly: true });
    if (current.hasDraft || current.busy) throw new Error('Finish or clear the current draft or response before navigating.');
  }
  const historyRequests = new Map();
  let historyState = {loaded:false,urls:[],chats:[],ready:false,hasDraft:false,busy:false};
  let historyEpoch = 0, historyAttempted = false, historyBusy = false, historyInspection = null;
  function renderHistory() {
    toolbar?.updateHistory({...historyState, enabled:initialized && !awaitingFrameLoad && connection.dataset.state === 'ready', pending:historyBusy || Boolean(historyInspection), navigating:historyBusy});
  }
  function resetHistory() {
    historyEpoch++; historyAttempted = false; historyBusy = false; historyInspection = null;
    historyState = {loaded:false,urls:[],chats:[],ready:false,hasDraft:false,busy:false};
    for (const request of historyRequests.values()) { clearTimeout(request.timer); request.reject(new Error('The ChatGPT page changed.')); }
    historyRequests.clear(); renderHistory();
  }
  function historyCommand(action, data = {}) {
    if (!initialized || awaitingFrameLoad || !nonce) return Promise.reject(new Error('ChatGPT is not ready.'));
    const operationId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { historyRequests.delete(operationId); reject(new Error('ChatGPT history did not respond.')); }, 5000);
      historyRequests.set(operationId, {resolve,reject,timer});
      frame.contentWindow.postMessage({channel:FRAME_CHANNEL,type:'history.command',nonce,operationId,action,data}, CHATGPT_ORIGIN);
    });
  }
  async function refreshHistory(force = false) {
    if (historyInspection) {
      if (!force) return;
      const epoch = historyEpoch;
      try { await historyInspection; } catch { /* A fresh explicit read can retry inspection, never navigation. */ }
      if (epoch !== historyEpoch) return;
    }
    if (historyBusy || !initialized || awaitingFrameLoad || document.getElementById('chat-view').hidden ||
        !force && (historyAttempted || historyState.loaded || historyState.hasDraft || historyState.busy || !historyState.ready)) return;
    const epoch = historyEpoch;
    historyAttempted = true;
    const operation = historyCommand('inspect', {readOnly:force});
    historyInspection = operation; renderHistory();
    try { const value = await operation; if (epoch === historyEpoch) historyState = value; }
    catch { if (epoch === historyEpoch) historyState = {...historyState,reason:'unavailable'}; }
    finally { if (epoch === historyEpoch) { historyInspection = null; renderHistory(); } }
  }
  async function moveHistory(direction, selectedUrl = null) {
    if (historyBusy || awaitingFrameLoad || selectedUrl === null && ![-1,1].includes(direction)) return;
    const epoch = historyEpoch, original = globalThis.AiAgentChatHistory.route(currentUrl);
    historyBusy = true; renderHistory();
    try {
      await navigationGuard();
      if (epoch !== historyEpoch) return;
      if (historyInspection) await historyInspection;
      const state = await historyCommand('inspect');
      if (epoch !== historyEpoch) return;
      historyState = state;
      if (state.currentUrl !== original || state.hasDraft || state.busy || !state.ready) return;
      const target = selectedUrl === null ? globalThis.AiAgentChatHistory.target(state.urls, state.currentUrl, direction, state.pinnedUrls)
        : globalThis.AiAgentChatHistory.conversation(selectedUrl);
      if (!target || !state.urls.includes(target) || target === state.currentUrl) return;
      const result = await historyCommand('open', {target,currentUrl:state.currentUrl,
        ...(selectedUrl === null ? {direction} : {selection:true})});
      if (epoch !== historyEpoch) return;
      historyState = result;
      if (!result.dispatched) return;
      const deadline = Date.now() + 8000;
      while (epoch === historyEpoch && globalThis.AiAgentChatHistory.route(currentUrl) !== target && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // Dispatch alone is not observed navigation. Never click a second time
      // automatically when a site is slow or its route did not change.
      if (epoch === historyEpoch && globalThis.AiAgentChatHistory.route(currentUrl) !== target) historyState = {...historyState,reason:'unavailable'};
    } catch { if (epoch === historyEpoch) historyState = {...historyState,reason:'unavailable'}; }
    finally { if (epoch === historyEpoch) { historyBusy = false; renderHistory(); } }
  }
  const shortcutPresses = new Set();
  function onWorkspaceShortcut(message, sender) {
    if (document.getElementById('chatgpt-pane')?.hidden) return false;
    if (!initialized || awaitingFrameLoad || document.getElementById('chat-view').hidden) return false;
    const shortcut = frameShortcutMessage(message, sender, chrome.runtime.id, nonce);
    if (!shortcut || shortcutPresses.has(shortcut.pressId)) return false;
    shortcutPresses.add(shortcut.pressId);
    if (shortcutPresses.size > 128) shortcutPresses.delete(shortcutPresses.values().next().value);
    onShortcut(shortcut.action);
    return false;
  }
  chrome.runtime.onMessage.addListener(onWorkspaceShortcut);
  function showState(state, text) {
    connection.hidden = state === 'ready' || state === 'connected';
    if (connection.dataset.state === state && status.textContent === text) return;
    connection.dataset.state = state;
    status.textContent = text;
    recovery.hidden = !['guest', 'slow', 'error'].includes(state);
    signIn.textContent = state === 'guest' ? 'Sign in to ChatGPT' : 'Open ChatGPT';

  }

  function probe() {
    if (!initialized || !nonce || awaitingFrameLoad) return;
    const interactive = !document.getElementById('chat-view').hidden && !document.getElementById('chatgpt-pane').hidden;
    frame.contentWindow?.postMessage({ channel: FRAME_CHANNEL, type: 'probe', nonce, fontScale: zoomPercent, interactive }, CHATGPT_ORIGIN);
  }

  function setZoom(percent) {
    zoomPercent = Math.min(150, Math.max(50, percent));
    zoomIn.disabled = !initialized || zoomPercent === 150;
    zoomOut.disabled = !initialized || zoomPercent === 50;
    zoomIn.title = `Increase text size (${zoomPercent}%)`;
    zoomOut.title = `Decrease text size (${zoomPercent}%)`;
    document.getElementById('chat-zoom-status').textContent = `Chat text size ${zoomPercent}%`;
    probe();
  }

  function loadChat(url = currentUrl) {
    const target = conversationUrl(url);
    if (!target) return;

    currentUrl = target;
    chatEstablished = false;
    nonce = crypto.randomUUID();
    awaitingFrameLoad = true;

    resetHistory();
    toolbar?.hide();
    toolbar?.updateCurrent();
    clearTimeout(watchdog);
    clearInterval(polling);
    showState('loading', 'Opening ChatGPT…');
    watchdog = setTimeout(() => {
      showState('slow', 'ChatGPT is taking longer to load. You can try again or open it in a tab.');
    }, 25000);
    polling = setInterval(probe, 1500);
    frame.src = currentUrl;
  }

  async function start() {
    if (starting) return;
    starting = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'sidebar.initialize' });
      if (!response?.ok) throw new Error(response?.error || 'The sidebar could not start. Reload the extension and try again.');
      initialized = true;
      reload.disabled = newChat.disabled = false;
      setZoom(zoomPercent);
      loadChat();
    } catch (error) {
      showState('error', error.message || 'The sidebar could not start. Try again.');
    } finally {
      starting = false;
    }
  }

  async function openTab(url) {
    try { await chrome.tabs.create({ url }); }
    catch { showState('error', 'Could not open ChatGPT. Please open chatgpt.com in a browser tab.'); }
  }

  window.addEventListener('message', event => {
    const message = frameMessage(event, frame.contentWindow, nonce);
    if (!message || !initialized || awaitingFrameLoad) return;
    if (message.type === 'history.reply') {
      const request = historyRequests.get(message.operationId);
      if (!request) return;
      historyRequests.delete(message.operationId); clearTimeout(request.timer);
      if (message.ok) request.resolve(message.value);
      else request.reject(new Error('ChatGPT history is unavailable.'));
      return;
    }
    if (message.type === 'sign-in') {

      void openTab(`${CHATGPT_ORIGIN}/auth/login`);
      return;
    }
    currentUrl = message.url;
    if (message.history) historyState = message.history;
    toolbar.updateCurrent();
    if (message.guest || message.authState === 'signed-out') {
      chatEstablished = false;
      clearTimeout(watchdog);
      showState('guest', 'Sign in to ChatGPT in a tab, then reload the sidebar.');
    } else if (message.ready) {
      chatEstablished = true;
      clearTimeout(watchdog);
      showState('ready', 'ChatGPT is ready.');
    } else if (message.authState === 'signed-in' || chatEstablished) {
      // The current page can stay connected while its composer is temporarily
      // absent or hidden. Do not turn a dock expansion into a new load notice.
      chatEstablished = true;
      clearTimeout(watchdog);
      showState('connected', 'ChatGPT is connected.');
    } else if (connection.dataset.state === 'loading') {
      showState('loading', 'Waiting for ChatGPT’s message box…');
    }
    renderHistory();
    if (toolbar.isOpen()) void refreshHistory();
  });

  frame.addEventListener('load', () => {
    if (!awaitingFrameLoad) chatEstablished = false;

    awaitingFrameLoad = false;
    nonce = crypto.randomUUID();
    shortcutPresses.clear();
    resetHistory();
    toolbar?.hide();
    probe();

  });
  frame.addEventListener('error', () => {
    clearTimeout(watchdog);
    showState('error', 'ChatGPT could not load. Try again or open it in a tab.');
  });
  const navigateManually = url => { void navigationGuard().then(() => { onOpenChat(); loadChat(url); }).catch(error => showState('error', error.message)); };
  reload.addEventListener('click', () => navigateManually(currentUrl));
  newChat.addEventListener('click', () => navigateManually(CHATGPT_HOME));
  zoomIn.addEventListener('click', () => setZoom(zoomPercent + 10));
  zoomOut.addEventListener('click', () => setZoom(zoomPercent - 10));
  document.getElementById('open-tab').addEventListener('click', () => { void openTab(currentUrl); });
  signIn.addEventListener('click', () => {
    void openTab(connection.dataset.state === 'guest' ? `${CHATGPT_ORIGIN}/auth/login` : currentUrl);
  });
  document.getElementById('retry').addEventListener('click', () => initialized ? navigateManually(currentUrl) : void start());
  window.addEventListener('pagehide', () => { resetHistory(); clearTimeout(watchdog); clearInterval(polling); chrome.runtime.onMessage.removeListener(onWorkspaceShortcut); });
  async function openConversation(url, { reveal = true, isCurrent = () => true } = {}) {
    const target = linkedConversationUrl(url);
    if (!target) return;
    if (target !== currentUrl) await navigationGuard();
    if (!isCurrent()) return;
    if (reveal) onOpenChat();
    if (target !== currentUrl) loadChat(target);
    toolbar.hide();
    toolbar.updateCurrent();
  }
  toolbar = createChatToolbar({
    currentUrl: () => currentUrl,
    onNativeSearch: async query => (await historyCommand('search', { query })).reason !== 'unavailable',
    onHistoryNeeded: () => { void refreshHistory(); },
    onChatsRefresh: () => { void refreshHistory(true); },
    moveHistory: direction => { void moveHistory(direction); },
    selectConversation: chat => { void moveHistory(null, chat.url); }
  });
  void start();
  return { probe, openConversation, getCurrentChat: () => linkedConversationUrl(currentUrl),
    hideControls: toolbar.hide,
    signIn: () => openTab(`${CHATGPT_ORIGIN}/auth/login`) };
}
