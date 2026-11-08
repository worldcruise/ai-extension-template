import { CHATGPT_HOME, CHATGPT_ORIGIN, FRAME_CHANNEL, frameMessage, conversationUrl, linkedConversationUrl } from './sidebar-protocol.mjs';
import { createChatToolbar } from './chat-toolbar.mjs';

export function createChatSidebar({ onOpenChat = () => {}, getCompanyChats = () => [] } = {}) {
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
    currentUrl = target;
    nonce = crypto.randomUUID();
    awaitingFrameLoad = true;
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
    if (message.type === 'sign-in') {
      void openTab(`${CHATGPT_ORIGIN}/auth/login`);
      return;
    }
    currentUrl = message.url;
    toolbar.updateCurrent();
    if (message.ready) {
      clearTimeout(watchdog);
      showState(message.guest ? 'guest' : 'ready', message.guest
        ? 'Sign in to ChatGPT in a tab, then reload the sidebar.' : 'ChatGPT is ready.');
    }
  });

  frame.addEventListener('load', () => {
    awaitingFrameLoad = false;
    nonce = crypto.randomUUID();
    toolbar?.hide();
    probe();
  });
  frame.addEventListener('error', () => {
    clearTimeout(watchdog);
    showState('error', 'ChatGPT could not load. Try again or open it in a tab.');
  });
  reload.addEventListener('click', () => { onOpenChat(); loadChat(); });
  newChat.addEventListener('click', () => { onOpenChat(); loadChat(CHATGPT_HOME); });
  zoomIn.addEventListener('click', () => setZoom(zoomPercent + 10));
  zoomOut.addEventListener('click', () => setZoom(zoomPercent - 10));
  document.getElementById('open-tab').addEventListener('click', () => { void openTab(currentUrl); });
  signIn.addEventListener('click', () => {
    void openTab(connection.dataset.state === 'guest' ? `${CHATGPT_ORIGIN}/auth/login` : currentUrl);
  });
  document.getElementById('retry').addEventListener('click', () => initialized ? loadChat() : void start());
  window.addEventListener('pagehide', () => { clearTimeout(watchdog); clearInterval(polling); });
  function openConversation(url) {
    const target = linkedConversationUrl(url);
    if (!target) return;
    onOpenChat();
    if (target !== currentUrl) loadChat(target);
    toolbar.hide();
    toolbar.updateCurrent();
  }
  toolbar = createChatToolbar({
    currentUrl: () => currentUrl,
    getCompanyChats,
    selectConversation: chat => openConversation(chat.url)
  });
  void start();
  return { probe, openConversation, getCurrentChat: () => linkedConversationUrl(currentUrl),
    refreshCompanies: toolbar.refreshCompanies, hideControls: toolbar.hide,
    signIn: () => openTab(`${CHATGPT_ORIGIN}/auth/login`) };
}
