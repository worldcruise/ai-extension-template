import { CHATGPT_HOME, CHATGPT_ORIGIN, FRAME_CHANNEL, frameMessage, frameShortcutMessage, conversationUrl, linkedConversationUrl } from './sidebar-protocol.mjs';
import { createChatToolbar } from './chat-toolbar.mjs';
import { BUILD, connectionReport, requireMatchingRevision } from './runtime-info.mjs';

export function createChatSidebar({ onOpenChat = () => {}, getCompanyChats = () => [], onShortcut = () => {} } = {}) {
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
  let toolbar;
  let zoomPercent = 100;
  let navigationGuard = async () => {};
  let sessionConfirmed = false;
  const queueRequests = new Map();
  const historyRequests = new Map();
  let historyState = {loaded:false,urls:[],ready:false,hasDraft:false,busy:false};
  let historyEpoch = 0, historyAttempted = false, historyBusy = false, historyInspection = null;
  function renderHistory() {
    toolbar?.updateHistory({...historyState, enabled:initialized && !awaitingFrameLoad && connection.dataset.state === 'ready', pending:historyBusy || Boolean(historyInspection)});
  }
  function resetHistory() {
    historyEpoch++; historyAttempted = false; historyBusy = false; historyInspection = null;
    historyState = {loaded:false,urls:[],ready:false,hasDraft:false,busy:false};
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
  async function refreshHistory() {
    if (historyInspection || historyAttempted || historyState.loaded || !initialized || awaitingFrameLoad ||
        document.getElementById('chat-view').hidden || historyState.hasDraft || historyState.busy || !historyState.ready) return;
    const epoch = historyEpoch;
    historyAttempted = true;
    const operation = historyCommand('inspect');
    historyInspection = operation; renderHistory();
    try { const value = await operation; if (epoch === historyEpoch) historyState = value; }
    catch { if (epoch === historyEpoch) historyState = {...historyState,reason:'unavailable'}; }
    finally { if (epoch === historyEpoch) { historyInspection = null; renderHistory(); } }
  }
  async function moveHistory(direction) {
    if (historyBusy || awaitingFrameLoad || ![-1,1].includes(direction)) return;
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
      const target = globalThis.AiAgentChatHistory.target(state.urls, state.currentUrl, direction);
      if (!target) return;
      const result = await historyCommand('open', {target,currentUrl:state.currentUrl,direction});
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
    if (!initialized || awaitingFrameLoad || document.getElementById('chat-view').hidden) return false;
    const shortcut = frameShortcutMessage(message, sender, chrome.runtime.id, nonce);
    if (!shortcut || shortcutPresses.has(shortcut.pressId)) return false;
    shortcutPresses.add(shortcut.pressId);
    if (shortcutPresses.size > 128) shortcutPresses.delete(shortcutPresses.values().next().value);
    onShortcut(shortcut.action);
    return false;
  }
  chrome.runtime.onMessage.addListener(onWorkspaceShortcut);
  function rejectQueue(message) {
    for (const request of queueRequests.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    queueRequests.clear();
  }
  async function waitForReady(inspectOnly = false) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (initialized && !awaitingFrameLoad && (inspectOnly || connection.dataset.state === 'ready')) return;
      if (!inspectOnly && connection.dataset.state === 'guest') throw Object.assign(new Error('Sign in to ChatGPT, then reload the sidebar.'), { code: 'signed-out' });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('ChatGPT is not ready. Open Chat and check its connection.');
  }
  async function queueCommand(action, data = {}, onProgress = async () => true) {
    await waitForReady(['inspect', 'inspect-prepared'].includes(action));
    const operationId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const request = { resolve, reject, onProgress, action, progress: Promise.resolve(),
        timer: setTimeout(() => { queueRequests.delete(operationId); reject(new Error('ChatGPT did not respond. Inspect the source conversation before retrying.')); }, ['preflight', 'inspect', 'inspect-prepared'].includes(action) ? 12000 : 630000) };
      queueRequests.set(operationId, request);
      frame.contentWindow.postMessage({ channel: FRAME_CHANNEL, type: 'queue.command', nonce, operationId, action, data: { ...data, sessionConfirmed, hostBuildId: BUILD.id } }, CHATGPT_ORIGIN);
    });
  }

  function showState(state, text) {
    if (connection.dataset.state === state && status.textContent === text) return;
    connection.dataset.state = state;
    connection.hidden = state === 'ready';
    status.textContent = text;
    recovery.hidden = !['guest', 'slow', 'error'].includes(state);
    signIn.textContent = state === 'guest' ? 'Sign in to ChatGPT' : 'Open ChatGPT';
  }

  function probe() {
    if (!initialized || !nonce || awaitingFrameLoad) return;
    frame.contentWindow?.postMessage({ channel: FRAME_CHANNEL, type: 'probe', nonce, fontScale: zoomPercent }, CHATGPT_ORIGIN);
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
    rejectQueue('The ChatGPT frame navigated. Recover the recorded request before sending it again.');
    currentUrl = target;
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
    if (message.type === 'queue.progress' || message.type === 'queue.reply') {
      const request = queueRequests.get(message.operationId);
      if (!request) return;
      if (message.type === 'queue.progress') {
        request.progress = request.progress.then(async () => {
          const allowed = await request.onProgress(message);
          if (message.phase === 'prepared') frame.contentWindow.postMessage({ channel: FRAME_CHANNEL,
            type: 'queue.authorize', nonce, operationId: message.operationId, allowed: allowed !== false }, CHATGPT_ORIGIN);
        }).catch(error => {
          if (message.phase === 'prepared') {
            frame.contentWindow.postMessage({ channel: FRAME_CHANNEL, type: 'queue.authorize', nonce,
              operationId: message.operationId, allowed: false }, CHATGPT_ORIGIN);
            clearTimeout(request.timer); queueRequests.delete(message.operationId); request.reject(error);
          }
          // After a send, continue collecting even if a progress write fails.
          // The completed reply can still be journaled and saved or recovered.
        });
      } else {
        clearTimeout(request.timer); queueRequests.delete(message.operationId);
        void request.progress.then(() => {
          if (message.ok) {
            if (message.value.authState === 'signed-in') sessionConfirmed = true;
            if (message.value.authState === 'signed-out') {
              sessionConfirmed = false;
              showState('guest', 'Sign in to ChatGPT in a tab, then reload the sidebar.');
            } else if (message.value.authState && (message.value.composerPresent || message.value.authenticated)) {
              clearTimeout(watchdog);
              showState('ready', 'ChatGPT is ready.');
            }
            if (['inspect', 'preflight'].includes(request.action)) {
              document.getElementById('runtime-adapter-build').textContent = message.value.buildId || 'Unknown';
            }
            try {
              if (['preflight', 'submit'].includes(request.action)) requireMatchingRevision(message.value);
              request.resolve(connectionReport(message.value, sessionConfirmed, 'sidebar'));
            } catch (error) { request.reject(error); }
          } else request.reject(Object.assign(new Error(message.error.message), { code: message.error.code, diagnostics: message.error.diagnostics }));
        });
      }
      return;
    }
    if (message.type === 'sign-in') {
      sessionConfirmed = false;
      void openTab(`${CHATGPT_ORIGIN}/auth/login`);
      return;
    }
    currentUrl = message.url;
    if (message.history) historyState = message.history;
    if (message.buildId) document.getElementById('runtime-adapter-build').textContent = message.buildId;
    if (message.guest || message.authState === 'signed-out') sessionConfirmed = false;
    else if (message.authState === 'signed-in') sessionConfirmed = true;
    toolbar.updateCurrent();
    if (message.ready) {
      clearTimeout(watchdog);
      showState(message.guest ? 'guest' : 'ready', message.guest
        ? 'Sign in to ChatGPT in a tab, then reload the sidebar.' : 'ChatGPT is ready.');
    }
    renderHistory();
    if (toolbar.isOpen()) void refreshHistory();
  });

  frame.addEventListener('load', () => {
    rejectQueue('The ChatGPT page reloaded. Start the queue to reconcile the interrupted request.');
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
  window.addEventListener('pagehide', () => { rejectQueue('The sidebar closed. Recover this request after reopening it.'); resetHistory(); clearTimeout(watchdog); clearInterval(polling); chrome.runtime.onMessage.removeListener(onWorkspaceShortcut); });
  async function openConversation(url) {
    const target = linkedConversationUrl(url);
    if (!target) return;
    await navigationGuard();
    onOpenChat();
    if (target !== currentUrl) loadChat(target);
    toolbar.hide();
    toolbar.updateCurrent();
  }
  toolbar = createChatToolbar({
    currentUrl: () => currentUrl,
    getCompanyChats,
    onHistoryNeeded: () => { void refreshHistory(); },
    moveHistory: direction => { void moveHistory(direction); },
    selectConversation: chat => openConversation(chat.url)
  });
  void start();
  const queue = {
    kind: 'sidebar',
    inspect: () => queueCommand('inspect'),
    inspectPrepared: data => queueCommand('inspect-prepared', data),
    monitor: (data, progress) => queueCommand('recover', data, progress),
    async confirmSession() {
      const state = await queueCommand('inspect');
      if (state.authState === 'signed-out' || !state.composerPresent) throw new Error('Sign in to ChatGPT and wait for the composer before confirming this session.');
      sessionConfirmed = true;
      return { ...state, sessionConfirmed: true };
    },
    async openConversation(value) {
      const url = linkedConversationUrl(value);
      if (!url) throw new Error('This request has no source conversation.');
      if (url !== currentUrl) {
        const state = await queueCommand('inspect');
        if (state.authState === 'signed-out') throw Object.assign(new Error('Sign in to ChatGPT, then reload the sidebar.'), { code: 'signed-out' });
        if (state.hasDraft || state.busy) throw new Error('Finish or clear the current Chat draft or generation before opening the recorded conversation.');
        loadChat(url); await waitForReady();
      }
    },
    async newConversation() {
      await queueCommand('preflight');
      loadChat(CHATGPT_HOME);
      await waitForReady();
      await queueCommand('preflight');
    },
    submit(data, progress) { onOpenChat(); return queueCommand('submit', data, progress); },
    async recover(data) {
      await queue.openConversation(data.url);
      return queueCommand('recover', data);
    }
  };
  return { probe, openConversation, getCurrentChat: () => linkedConversationUrl(currentUrl),
    queue, setNavigationGuard: callback => { navigationGuard = callback; },
    refreshCompanies: toolbar.refreshCompanies, hideControls: toolbar.hide,
    signIn: () => openTab(`${CHATGPT_ORIGIN}/auth/login`) };
}
