import { CHATGPT_HOME, conversationUrl, linkedConversationUrl, queueMessage } from './sidebar-protocol.mjs';
import { BUILD, connectionReport, requireMatchingRevision } from './runtime-info.mjs';

// The panel owns scheduling and durable receipts; this transport owns one tab in
// the panel's window. Personal ChatGPT tabs are never selected or navigated.
export function createChatgptTabConnection({ browser = chrome, getWindowId = async () => (await browser.windows.getCurrent()).id,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, onReport = () => {} } = {}) {
  let tabId, windowId, port, currentUrl, sessionConfirmed = false, acquiring;
  const pending = new Map();
  const updated = (id, change) => {
    if (id !== tabId || !change.url) return;
    currentUrl = conversationUrl(change.url);
    if (/^https:\/\/chatgpt\.com\/auth\//.test(change.url)) sessionConfirmed = false;
  };
  browser.tabs.onUpdated.addListener(updated);
  const failure = (code, message) => Object.assign(new Error(message), { code });
  function disconnect(message = 'The queue tab closed or navigated. Recover its recorded result before retrying.') {
    const previous = port; port = null;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(failure('tab-interrupted', message)); }
    pending.clear(); previous?.disconnect();
  }
  async function acquire() {
    if (acquiring) return acquiring;
    acquiring = (async () => {
      windowId ??= await getWindowId();
      if (!Number.isInteger(windowId)) throw new Error('The queue needs an open browser window.');
      const key = `resume-queue-tab:${windowId}`;
      if (!Number.isInteger(tabId)) tabId = (await browser.storage.session.get(key))[key];
      let tab;
      if (Number.isInteger(tabId)) {
        try { tab = await browser.tabs.get(tabId); } catch { tabId = null; }
        if (tab && tab.windowId !== windowId) throw failure('tab-moved', 'Move the queue tab back to this window before continuing.');
      }
      if (!tab) {
        sessionConfirmed = false;
        tab = await browser.tabs.create({ url: CHATGPT_HOME, windowId, active: false }); tabId = tab.id;
        await browser.storage.session.set({ [key]: tabId });
      }
      currentUrl = conversationUrl(tab.url) || currentUrl;
      return tab;
    })();
    try { return await acquiring; } finally { acquiring = null; }
  }
  function connect() {
    if (port) return port;
    const connected = browser.tabs.connect(tabId, { name: 'ai-agent-resume-tab-v1', frameId: 0 });
    port = connected;
    connected.onDisconnect.addListener(() => {
      // Read lastError when Chrome reports a missing content-script receiver.
      void browser.runtime.lastError;
      if (port === connected) disconnect();
    });
    connected.onMessage.addListener(data => {
      if (port !== connected) return;
      const message = queueMessage(data), request = message && pending.get(message.operationId);
      if (!request) return;
      if (message.type === 'queue.progress') {
        currentUrl = message.url;
        request.progress = request.progress.then(async () => {
          const allowed = await request.onProgress(message);
          if (message.phase === 'prepared') connected.postMessage({ type: 'queue.authorize', operationId: message.operationId, allowed: allowed !== false });
        }).catch(error => {
          if (message.phase === 'prepared') {
            connected.postMessage({ type: 'queue.authorize', operationId: message.operationId, allowed: false });
            clearTimeout(request.timer); pending.delete(message.operationId); request.reject(error);
          }
          // Once dispatch is possible, continue collecting despite progress-write
          // failures so the result can still reach the durable capture journal.
        });
      } else {
        clearTimeout(request.timer); pending.delete(message.operationId);
        void request.progress.then(() => {
          if (!message.ok) { request.reject(Object.assign(failure(message.error.code, message.error.message), { diagnostics: message.error.diagnostics })); return; }
          const value = message.value;
          if (value.authState === 'signed-in') sessionConfirmed = true;
          if (value.authState === 'signed-out') sessionConfirmed = false;
          currentUrl = conversationUrl(value.url) || currentUrl;
          try {
            if (['preflight', 'submit'].includes(request.action)) requireMatchingRevision(value);
            const report = connectionReport(value, sessionConfirmed, 'tab'); onReport(report); request.resolve(report);
          } catch (error) { request.reject(error); }
        });
      }
    });
    return connected;
  }
  function command(action, data = {}, onProgress = async () => true) {
    const connected = connect(), operationId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const request = { resolve, reject, onProgress, action, progress: Promise.resolve(), timer: setTimeout(() => {
        pending.delete(operationId); reject(failure('timeout', 'The ChatGPT tab did not respond. Inspect its recorded conversation before retrying.'));
      }, ['submit', 'recover'].includes(action) ? 630000 : 10000) };
      pending.set(operationId, request);
      try { connected.postMessage({ type: 'queue.command', operationId, action, data: { ...data, sessionConfirmed, hostBuildId: BUILD.id } }); }
      catch (error) { clearTimeout(request.timer); pending.delete(operationId); reject(error); }
    });
  }
  async function ready() {
    await acquire();
    const deadline = now() + 30000;
    while (now() < deadline) {
      const tab = await acquire();
      if (tab.url && !conversationUrl(tab.url)) {
        const signedOut = /^https:\/\/chatgpt\.com\/auth\//.test(tab.url);
        throw failure(signedOut ? 'signed-out' : 'navigation', signedOut ? 'Sign in to ChatGPT in the queue tab, then check again.' : 'The queue tab left ChatGPT. Return it to ChatGPT before continuing.');
      }
      if (tab.status === 'complete') {
        try {
          const report = await command('inspect');
          if (report.composerPresent || report.authState === 'signed-out') return report;
        } catch { /* The new document may not have installed its receiver yet. */ }
      }
      await wait(100);
    }
    throw failure('composer-unavailable', 'The ChatGPT queue tab is not ready. Open it, finish signing in, then check again.');
  }
  async function navigate(url) {
    disconnect();
    await browser.tabs.update(tabId, { url });
    currentUrl = url;
    return ready();
  }
  const queue = {
    kind: 'tab',
    inspect: ready,
    async confirmSession() {
      const report = await ready();
      if (report.authState === 'signed-out' || !report.composerPresent) throw failure('signed-out', 'Sign in and wait for the queue tab composer before confirming this session.');
      sessionConfirmed = true; return { ...report, sessionConfirmed: true };
    },
    async newConversation() {
      await ready(); await command('preflight'); await navigate(CHATGPT_HOME); await command('preflight');
    },
    async inspectPrepared(data) { await ready(); return command('inspect-prepared', data); },
    async submit(data, progress) {
      await ready(); await browser.tabs.update(tabId, { active: true });
      await wait(150);
      return command('submit', data, progress);
    },
    async openConversation(value) {
      const url = linkedConversationUrl(value);
      if (!url) throw new Error('This request has no saved conversation.');
      const report = await ready();
      if (currentUrl === url) return;
      if (report.hasDraft || report.busy) throw failure('existing-draft', 'Finish the queue tab draft or generation before opening another conversation.');
      await navigate(url);
    },
    async monitor(data, progress) { await ready(); return command('recover', data, progress); },
    async recover(data) { await queue.openConversation(data.url); return command('recover', data); }
  };
  return { queue,
    async open() { await acquire(); await browser.tabs.update(tabId, { active: true }); },
    async signIn() { await acquire(); await browser.tabs.update(tabId, { active: true }); },
    getCurrentChat: () => linkedConversationUrl(currentUrl),
    dispose() { browser.tabs.onUpdated.removeListener(updated); disconnect(); } };
}
