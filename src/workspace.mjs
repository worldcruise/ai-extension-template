import { createChatSidebar } from './sidebar.mjs';
import { createStudio } from './studio.mjs';
import { renderIcons } from './icons.mjs';
import { createBrowserTabs } from './browser-tabs.mjs';
import { createKeywordSettings } from './keyword-settings.mjs';
import { createPageHighlights } from './page-highlights.mjs';
import { createResumeQueue } from './resume-queue.mjs';
import { createChatgptTabConnection } from './chatgpt-tab-connection.mjs';
import { createQueueConnectionSettings } from './queue-connection-settings.mjs';
import { createShortcutSettings } from './shortcut-settings.mjs';
import { createWorkspaceShortcuts } from './workspace-shortcuts.mjs';
import { BUILD } from './runtime-info.mjs';

const q = selector => document.querySelector(selector);
renderIcons();
q('#runtime-host-build').textContent = `${BUILD.version} · ${BUILD.id}`;

// Each panel remains mounted. Switching views never reloads the ChatGPT frame.
function bindTabs(entries, onSelect, onBeforeSelect) {
  function select(id) {
    onBeforeSelect?.(id);
    const known = entries.some(entry => entry.id === id);
    for (const entry of entries) {
      const selected = entry.id === id;
      entry.tab.setAttribute('aria-selected', String(selected));
      entry.tab.tabIndex = selected || (!known && entry === entries[0]) ? 0 : -1;
      entry.panel.hidden = !selected;
    }
    onSelect?.(id);
  }
  entries.forEach((entry, index) => {
    entry.tab.addEventListener('click', () => select(entry.id));
    entry.tab.addEventListener('keydown', event => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      let target;
      if (offset) target = entries[(index + offset + entries.length) % entries.length];
      if (event.key === 'Home') target = entries[0];
      if (event.key === 'End') target = entries.at(-1);
      if (!target) return;
      event.preventDefault();
      select(target.id);
      target.tab.focus();
    });
  });
  return select;
}

let chat;
let workspaceShortcuts;
const selectView = bindTabs([
  { id: 'studio', tab: q('#studio-tab'), panel: q('#studio-view') },
  { id: 'chat', tab: q('#chat-tab'), panel: q('#chat-view') }
], id => {
  q('#settings-view').hidden = id !== 'settings';
  if (id === 'chat') requestAnimationFrame(() => chat?.probe());
  else chat?.hideControls();
});

const studioScroll = q('#studio-scroll');
const studioPositions = { job: 0, results: 0 };
let studioPanel = 'results';
const selectStudioTab = bindTabs([
  { id: 'job', tab: q('#job-tab'), panel: q('#job-panel') },
  { id: 'results', tab: q('#results-tab'), panel: q('#results-panel') }
], id => {
  studioScroll.scrollTop = studioPositions[id];
  q('#job-actions').hidden = id !== 'job';
  q('#results-actions').hidden = id !== 'results';
}, id => {
  studioPositions[studioPanel] = studioScroll.scrollTop;
  studioPanel = id;
});

const dialogFocus = new WeakMap();
function openDialog(id) {
  const dialog = document.getElementById(id);
  dialogFocus.set(dialog, document.activeElement);
  dialog.showModal();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => dialogFocus.get(dialog)?.focus({ preventScroll: true }));
}
for (const button of document.querySelectorAll('[data-close-dialog]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

let browserTabs;
let browserWindowId;
const tabChat = createChatgptTabConnection({ getWindowId: async () => { await browserTabs.ready; return browserWindowId; },
  onReport: report => { q('#runtime-selected-build').textContent = `${report.confirmationScope} · ${report.adapterBuild}`; } });
let connectionSettings;
const selectedConnection = () => connectionSettings?.mode() === 'tab' ? tabChat : chat;
const queue = createResumeQueue({ getChat: async ({ fromAdd = false } = {}) => {
  await connectionSettings.ready;
  return fromAdd ? chat : selectedConnection();
} });
connectionSettings = createQueueConnectionSettings({
  canChange: () => !queue.snapshot().control.ownerId && !queue.snapshot().starting,
  openConnection: () => openSelectedChat()
});
function openSelectedChat() { return connectionSettings.mode() === 'tab' ? tabChat.open() : selectView('chat'); }
queue.subscribe(() => connectionSettings.refresh());
const shortcutSettings = createShortcutSettings();
bindTabs([
  { id: 'keywords', tab: q('#keyword-settings-tab'), panel: q('#keyword-settings-panel') },
  { id: 'queue', tab: q('#queue-settings-tab'), panel: q('#queue-settings-panel') },
  { id: 'shortcuts', tab: q('#shortcut-settings-tab'), panel: q('#shortcut-settings-panel') }
], id => {
  q('.settings-tabs [aria-selected="true"]').scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (id === 'shortcuts') void shortcutSettings.refresh();
})('keywords');
window.addEventListener('pagehide', () => tabChat.dispose());
const studio = createStudio({
  queue,
  openDialog,
  showStudio: panel => { selectView('studio'); selectStudioTab(panel); },
  showChat: (url, { connection = connectionSettings.mode() } = {}) => {
    if (!url) { selectView('chat'); return; }
    void (async () => {
      if (connection === 'tab') { await queue.pause(); await tabChat.queue.openConversation(url); await tabChat.open(); }
      else await chat?.openConversation(url);
    })().catch(error => studio.tabError(error.message));
  },
  getCurrentChat: () => selectedConnection()?.getCurrentChat(),
  moveTab: direction => browserTabs?.move(direction)
});
const pageHighlights = createPageHighlights();
createKeywordSettings({ onChange: pageHighlights.update });
browserTabs = createBrowserTabs({
  onChange: value => { browserWindowId = value.windowId; studio.updateTabs(value); pageHighlights.setTarget(value); },
  onError: studio.tabError
});
async function readFromShortcut() {
  await browserTabs.ready;
  if (!Number.isInteger(browserWindowId)) return;
  try {
    // A development tab showing index.html must not consume the dock's command.
    if (await chrome.tabs.getCurrent()) return;
    const response = await chrome.runtime.sendMessage({ type: 'job.read-command.take', windowId: browserWindowId });
    if (!response?.request) return;
    await browserTabs.refresh();
    selectView('studio');
    selectStudioTab('job');
    // Retain the shortcut's source tab if the user switches while opening.
    await studio.readPage(response.request.tabId);
  } catch (error) { studio.tabError(error.message || 'Could not read this job page.'); }
}
function onReadRequested(message, sender) {
  if (sender.id === chrome.runtime.id && message?.type === 'job.read-requested' &&
      message.windowId === browserWindowId) void readFromShortcut();
}
chrome.runtime.onMessage.addListener(onReadRequested);
void readFromShortcut();
window.addEventListener('pagehide', () => {
  browserTabs.dispose();
  chrome.runtime.onMessage.removeListener(onReadRequested);
  workspaceShortcuts?.dispose();
});

chat = createChatSidebar({
  onOpenChat: () => selectView('chat'),
  onShortcut: action => workspaceShortcuts?.run(action),
});
chat.setNavigationGuard(() => queue.pause());
workspaceShortcuts = createWorkspaceShortcuts({ selectView, selectJob: () => selectStudioTab('job') });
window.addEventListener('pagehide', () => queue.dispose(), { once: true });

const accountToggle = q('#account-toggle');
function closeAccount(focus = false) {
  q('#account-panel').hidden = true;
  accountToggle.setAttribute('aria-expanded', 'false');
  if (focus) accountToggle.focus();
}
accountToggle.addEventListener('click', () => {
  const open = q('#account-panel').hidden;
  q('#account-panel').hidden = !open;
  accountToggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', event => { if (!event.target.closest('.account-wrap')) closeAccount(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !q('#account-panel').hidden) { event.preventDefault(); closeAccount(true); }
});
q('#account-chat').addEventListener('click', () => { closeAccount(); selectView('chat'); });
async function checkConnection() {
  q('#chat-connection-title').textContent = 'Checking connection…';
  q('#chat-connection-message').textContent = 'Reading the ChatGPT page. No message will be sent.';
  q('#chat-connection-details').replaceChildren();
  q('#chat-confirm-session').hidden = q('#chat-session-note').hidden = q('#chat-connection-sign-in').hidden = true;
  q('#chat-check-again').disabled = true;
  try {
    await connectionSettings.ready;
    const report = await selectedConnection().queue.inspect();
    const signedOut = report.authState === 'signed-out';
    const known = report.authState === 'signed-in';
    q('#chat-connection-title').textContent = signedOut ? 'Sign in required' : known ? 'Authentication evidence recognized' : report.sessionConfirmed ? 'Session confirmed; authentication evidence unknown' : 'Authentication evidence unknown';
    q('#chat-connection-message').textContent = signedOut ? 'Sign in to ChatGPT in this browser profile, reload Chat, then check again.'
      : known ? 'ChatGPT account signals were detected. Return to the queue and click Start queue when ready.'
      : 'This ChatGPT layout does not expose the account controls we recognize. Open the selected ChatGPT connection, check your account, then confirm this session below.';
    const details = [['Connection', connectionSettings.mode() === 'tab' ? 'ChatGPT tab' : 'Sidebar Chat'],
      ['Composer presence', report.composerPresent ? 'Detected' : 'Not detected'], ['Composer readiness', report.composerReady ? 'Editable' : 'Not ready'],
      ['Authentication evidence', signedOut ? 'Signed out' : known ? 'Recognized' : 'Unknown'],
      ['Panel session', report.sessionConfirmed ? `Established for ${report.confirmationScope}` : 'Not confirmed'],
      ['Generation activity', report.busy ? 'Detected' : 'Not detected'],
      ['Unsent draft', report.hasDraft ? 'Present — finish or clear it before starting' : 'None'],
      ['Account signals', report.evidence.length ? report.evidence.join(', ') : 'Not recognized'],
      ['Host build', report.hostBuild], ['Adapter build', report.adapterBuild], ['Revision match', report.revisionMatches ? 'Yes' : 'No / unknown']];
    q('#runtime-selected-build').textContent = `${report.confirmationScope} · ${report.adapterBuild}`;
    q('#chat-connection-details').replaceChildren(...details.flatMap(([label, value]) => {
      const name = document.createElement('dt'), text = document.createElement('dd'); name.textContent = label; text.textContent = value; return [name, text];
    }));
    q('#chat-connection-sign-in').hidden = !signedOut;
    q('#chat-confirm-session').hidden = q('#chat-session-note').hidden = signedOut || known || report.sessionConfirmed || !report.composerPresent;
    if (known) await queue.retryConnectionBlocked();
  } catch (error) {
    q('#chat-connection-title').textContent = 'ChatGPT is not ready';
    q('#chat-connection-message').textContent = error.message;
  } finally { q('#chat-check-again').disabled = false; }
}
q('#account-check').addEventListener('click', () => {
  closeAccount(); selectView('chat'); openDialog('chat-connection-dialog'); void checkConnection();
});
q('#chat-check-again').addEventListener('click', () => { void checkConnection(); });
q('#chat-connection-open').addEventListener('click', () => { void Promise.resolve(openSelectedChat()).catch(error => { q('#chat-connection-message').textContent = error.message; }); });
q('#chat-confirm-session').addEventListener('click', () => {
  void (async () => {
    q('#chat-confirm-session').disabled = true;
    try {
      await selectedConnection().queue.confirmSession(); await queue.retryConnectionBlocked();
      q('#chat-connection-title').textContent = 'ChatGPT session confirmed';
      q('#chat-connection-message').textContent = 'Return to the queue and click Start queue. Your unsent jobs have been restored; no message was sent by this check.';
      q('#chat-confirm-session').hidden = q('#chat-session-note').hidden = true;
    } catch (error) { q('#chat-connection-message').textContent = error.message; }
    finally { q('#chat-confirm-session').disabled = false; }
  })();
});
q('#chat-connection-sign-in').addEventListener('click', () => { void selectedConnection().signIn(); });
q('#chat-connection-back').addEventListener('click', () => { q('#chat-connection-dialog').close(); selectView('studio'); selectStudioTab('results'); });
q('#account-sign-in').addEventListener('click', () => { closeAccount(); void chat.signIn(); });
q('#account-settings').addEventListener('click', () => {
  closeAccount(); selectView('settings'); q('.settings-tabs [aria-selected="true"]').focus();
});
q('#settings-back').addEventListener('click', () => { selectView('studio'); q('#studio-tab').focus(); });
