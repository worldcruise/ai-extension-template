import { createJobQueue } from './job-queue.mjs';
import { createGenerationClient } from './generation-client.mjs';
import { openProviderTab } from './ai-tabs.mjs';
import { openApplicationTabs } from './apply-tabs.mjs';
import { createChatSidebar } from './sidebar.mjs';
import { createStudio } from './studio.mjs';
import { renderIcons } from './icons.mjs';
import { createBrowserTabs } from './browser-tabs.mjs';
import { createKeywordSettings } from './keyword-settings.mjs';
import { createPageHighlights } from './page-highlights.mjs';
import { createShortcutSettings } from './shortcut-settings.mjs';
import { createDocumentSettings } from './document-settings.mjs';
import { createJobAnalysisSettings } from './job-analysis-settings.mjs';
import { createWorkspaceShortcuts } from './workspace-shortcuts.mjs';
import { createChatProviders } from './chat-providers.mjs';
import { createDeepseekToolbar } from './deepseek-toolbar.mjs';
import { createWorkspaceDock } from './workspace-dock.mjs';
import { chatProviderForUrl, requestChatUrl } from './saved-chat.mjs';

const q = selector => document.querySelector(selector);
renderIcons();

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
let deepseekChat;
let chatProviders;
let workspaceShortcuts;
const { select: selectView } = createWorkspaceDock({
  onOpen: () => requestAnimationFrame(() => {
    if(pendingSidebarUrl){const url=pendingSidebarUrl;pendingSidebarUrl=null;void syncSidebarChat(url).catch(error=>studio.chatError(error.message));}
    else { chatProviders?.ensureCurrent();if(chatProviders?.current()==='chatgpt')void chat?.ensureLoaded(); }
    chat?.probe();
    deepseekChat?.probe();
  }),
  onClose: () => {
    chat?.probe();
    deepseekChat?.probe();
    chat?.hideControls();
  },
  onStudioChange: setStudioExpanded
});

const studioScroll = q('#studio-scroll');
const studioPositions = { job: 0, results: 0, apply: 0 };
let studioPanel = 'apply';
function setStudioExpanded(expanded) {
  const content = q('#studio-content'), toggle = q('#studio-dock-toggle');
  if (expanded === !content.hidden) return;
  if (!expanded) studioPositions[studioPanel] = studioScroll.scrollTop;
  content.hidden = !expanded;
  q('#studio-view').dataset.collapsed = String(!expanded);
  document.body.classList.toggle('studio-dock-collapsed', !expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.title = `${expanded ? 'Collapse' : 'Expand'} job workspace`;
  toggle.setAttribute('aria-label', toggle.title);
  if (expanded) studioScroll.scrollTop = studioPositions[studioPanel];
  else if (content.contains(document.activeElement)) toggle.focus();
}
q('#studio-dock-toggle').addEventListener('click', () => selectView(q('#studio-content').hidden ? 'studio' : 'chat'));
q('.studio-navigation').addEventListener('click', event => {
  if (event.target.closest('button')) return;
  q('#studio-dock-toggle').click();
  q('#studio-dock-toggle').focus();
});
const selectStudioTab = bindTabs([
  { id: 'apply', tab: q('#apply-tab'), panel: q('#apply-panel') },
  { id: 'results', tab: q('#results-tab'), panel: q('#results-panel') },
  { id: 'job', tab: q('#job-tab'), panel: q('#job-panel') }
], id => {
  selectView('studio');
  studioScroll.scrollTop = studioPositions[id];
  q('#job-actions').hidden = id !== 'job';
  q('#results-actions').hidden = id !== 'results';
  q('#apply-actions').hidden = id !== 'apply';
}, id => {
  if (!q('#studio-content').hidden) studioPositions[studioPanel] = studioScroll.scrollTop;
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
const queue = createJobQueue();
const generations = createGenerationClient();
let silentChatRevision = 0, silentChatWork = Promise.resolve(), pendingSidebarUrl = null;
function syncSidebarChat(url) {
  const revision = ++silentChatRevision;
  pendingSidebarUrl=url || null;
  if (!url) return Promise.resolve();
  const isCurrent = () => revision === silentChatRevision;
  const task = async () => {
    await chatProviders.ready;
    if (!isCurrent()) return;
    const provider = chatProviderForUrl(url);
    await chatProviders.showProvider(provider);
    if(q('#chat-view').hidden){pendingSidebarUrl=url;return;}
    pendingSidebarUrl=null;
    chatProviders.ensureCurrent();
    if (!isCurrent()) return;
    await (provider === 'deepseek' ? deepseekChat : chat).openConversation(url, { reveal: false, isCurrent });
  };
  silentChatWork = silentChatWork.catch(() => {}).then(task);
  return silentChatWork;
}
async function openSelectedChat() {
  await chatProviders.ready;
  return openProviderTab(chatProviders.current());
}
q('#queue-connection-open').addEventListener('click', () => { void openSelectedChat().catch(error => studio.chatError(error.message)); });
const shortcutSettings = createShortcutSettings();
createDocumentSettings();
createJobAnalysisSettings();
bindTabs([
  { id: 'keywords', tab: q('#keyword-settings-tab'), panel: q('#keyword-settings-panel') },
  { id: 'queue', tab: q('#queue-settings-tab'), panel: q('#queue-settings-panel') },
  { id: 'shortcuts', tab: q('#shortcut-settings-tab'), panel: q('#shortcut-settings-panel') }
], id => {
  q('.settings-tabs [aria-selected="true"]').scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (id === 'shortcuts') void shortcutSettings.refresh();
})('keywords');
const studio = createStudio({
  queue,
  generations,
  getChatProvider: () => chatProviders?.current() || 'chatgpt',
  openApplication: request => openApplicationTabs({ jobUrl: request.input.job.url }),
  openDialog,
  syncChat: syncSidebarChat,
  showStudio: panel => { selectView('studio'); selectStudioTab(panel); },
  showChat: url => {
    pendingSidebarUrl=null;
    silentChatRevision++;
    if (!url) { selectView('chat'); return; }
    void (async () => {
      const provider = chatProviderForUrl(url);
      await chatProviders.showProvider(provider); selectView('chat');
      await (provider === 'deepseek' ? deepseekChat : chat).openConversation(url);
    })().catch(error => studio.chatError(error.message));
  },
  getCurrentChat: () => chatProviders?.current() === 'deepseek' ? deepseekChat?.getCurrentChat() : chat?.getCurrentChat(),
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
  lazy:true,
  onOpenChat: () => { silentChatRevision++; selectView('chat'); },
  onShortcut: action => workspaceShortcuts?.run(action),
});
deepseekChat = createDeepseekToolbar();
chatProviders = createChatProviders({ lazy:true, onSelect: (_provider, source) => { pendingSidebarUrl=null;silentChatRevision++; selectView('chat'); closeAccount(source !== 'dock'); } });
workspaceShortcuts = createWorkspaceShortcuts({ selectView, selectJob: () => selectStudioTab('job') });
window.addEventListener('pagehide', () => { queue.dispose(); generations.dispose(); }, { once: true });

const accountToggle = q('#account-toggle');
function positionAccount() {
  const panel = q('#account-panel');
  if (panel.hidden) return;
  const bounds = accountToggle.getBoundingClientRect();
  const above = bounds.top - 12, below = innerHeight - bounds.bottom - 12;
  const placeAbove = above >= panel.scrollHeight + 2 || above >= below;
  panel.dataset.placement = placeAbove ? 'above' : 'below';
  panel.style.maxHeight = `${Math.max(0, placeAbove ? above : below)}px`;
}
function closeAccount(focus = false) {
  q('#account-panel').hidden = true;
  accountToggle.setAttribute('aria-expanded', 'false');
  if (focus) accountToggle.focus();
}
accountToggle.addEventListener('click', () => {
  const open = q('#account-panel').hidden;
  q('#account-panel').hidden = !open;
  accountToggle.setAttribute('aria-expanded', String(open));
  if (open) positionAccount();
});
q('#profile-details').addEventListener('click', () => closeAccount(true), true);
window.addEventListener('resize', positionAccount);
document.addEventListener('click', event => { if (!event.target.closest('.account-wrap')) closeAccount(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !q('#account-panel').hidden) { event.preventDefault(); closeAccount(true); }
});
q('#account-sign-in').addEventListener('click', () => {
  closeAccount();
  if (chatProviders.current() === 'deepseek') q('#deepseek-open').click();
  else void chat.signIn();
});
q('#account-settings').addEventListener('click', () => {
  closeAccount(); selectView('settings'); q('.settings-tabs [aria-selected="true"]').focus();
});
q('#settings-back').addEventListener('click', () => { selectView('studio'); q('.studio-tabs [aria-selected="true"]').focus(); });
