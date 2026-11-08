import { createChatSidebar } from './sidebar.mjs';
import { createStudio } from './studio.mjs';
import { renderIcons } from './icons.mjs';
import { createBrowserTabs } from './browser-tabs.mjs';
import { createKeywordSettings } from './keyword-settings.mjs';
import { createPageHighlights } from './page-highlights.mjs';

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
const studio = createStudio({
  openDialog,
  showStudio: panel => { selectView('studio'); selectStudioTab(panel); },
  showChat: url => chat?.openConversation(url),
  getCurrentChat: () => chat?.getCurrentChat(),
  onCompanyChatsChange: () => chat?.refreshCompanies(),
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
});

chat = createChatSidebar({
  onOpenChat: () => selectView('chat'),
  getCompanyChats: studio.getCompanyChats
});

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
q('#account-sign-in').addEventListener('click', () => { closeAccount(); void chat.signIn(); });
q('#account-settings').addEventListener('click', () => {
  closeAccount(); selectView('settings'); q('#keyword-settings-tab').focus();
});
q('#settings-back').addEventListener('click', () => { selectView('studio'); q('#studio-tab').focus(); });
