import { icon } from './icons.mjs';
import './chat-history.js';

export function createChatToolbar({ currentUrl, onHistoryNeeded = () => {}, onNativeSearch = async () => false, moveHistory = () => {}, browser = globalThis.chrome,
  root = document, idPrefix = '', providerName = 'ChatGPT', routes = globalThis.AiAgentChatHistory }) {
  const q = selector => root.querySelector(selector.replace(/#([\w-]+)/g, (_, id) => `#${idPrefix}${id}`)) || document.querySelector(selector);
  const shell = q('#chat-toolbar-shell'), toolbar = q('#chat-toolbar'), reveal = q('#chat-toolbar-reveal');
  const pin = q('#chat-toolbar-pin'), pinStatus = q('#chat-toolbar-pin-status'), search = q('#company-chat-search');
  const searchStatus = q('#native-search-status'), newer = q('#chat-history-up'), older = q('#chat-history-down');
  const searchForm = q('#native-search-form'), searchSubmit = q('#native-search-submit');
  const pinKey = idPrefix ? `${idPrefix}toolbarPinned` : 'chatToolbarPinned';
  let history = {}, pinned = false, keyboardMode = false, hideTimer, searching = false;
  let pinRevision = 0, pinSave = Promise.resolve();
  function show() {
    clearTimeout(hideTimer); shell.dataset.open = 'true'; toolbar.inert = false;
    reveal.setAttribute('aria-expanded', 'true'); onHistoryNeeded();
  }
  function hide() {
    clearTimeout(hideTimer);
    if (shell.contains(document.activeElement)) document.activeElement.blur();
    if (pinned) { show(); return; }
    shell.dataset.open = 'false'; toolbar.inert = true; reveal.setAttribute('aria-expanded', 'false');
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (pinned) return;
    hideTimer = setTimeout(() => { if (keyboardMode && shell.contains(document.activeElement)) return; hide(); }, 180);
  }
  function setPinned(value) {
    pinned = value; shell.dataset.pinned = String(value); pin.setAttribute('aria-pressed', String(value));
    pin.title = value ? 'Unpin toolbar' : 'Pin toolbar'; pin.setAttribute('aria-label', pin.title);
    pin.replaceChildren(icon(value ? 'pin-off' : 'pin'));
    if (value) show(); else if (!shell.matches(':hover')) scheduleHide();
  }
  pin.addEventListener('click', () => {
    const revision = ++pinRevision; setPinned(!pinned); const value = pinned;
    pinStatus.textContent = value ? 'Toolbar pinned.' : 'Toolbar unpinned.';
    pinSave = pinSave.catch(() => {}).then(() => browser.storage.local.set({ [pinKey]: value }));
    void pinSave.catch(() => { if (pinRevision === revision) pinStatus.textContent = 'Could not save the toolbar preference. Your choice applies for this sidebar session.'; });
  });
  void browser.storage.local.get(pinKey).then(data => { if (!pinRevision && data[pinKey] === true) setPinned(true); }).catch(() => {});
  function updateCurrent() {
    const canMove = history.enabled && history.ready && !history.pending && !history.hasDraft && !history.busy && !history.navigating && history.reason !== 'signed-out';
    newer.disabled = !canMove || !history.loaded || !routes.target(history.urls, currentUrl(), -1);
    older.disabled = !canMove || Boolean(history.loaded && !routes.target(history.urls, currentUrl(), 1));
    const blocked = history.hasDraft ? 'Finish or clear the draft before switching chats.' : history.busy ? 'Wait for the response to finish before switching chats.'
      : !history.ready || !history.enabled ? `${providerName} is not ready.` : '';
    newer.title = blocked || (newer.disabled ? 'No newer conversation is available.' : `Newer ${providerName} conversation`);
    older.title = blocked || (older.disabled ? 'No older conversation is available in loaded history.' : `Older ${providerName} conversation`);
    search.disabled = searching || !history.enabled;
    searchSubmit.disabled = search.disabled;
    search.title = `Search chats in ${providerName}`;
    search.setAttribute('aria-label', search.title);
  }
  newer.addEventListener('click', () => moveHistory(-1)); older.addEventListener('click', () => moveHistory(1));
  searchForm.addEventListener('submit', event => {
    event.preventDefault();
    if (searching) return;
    const query = search.value.trim();
    searching = true; searchStatus.hidden = true; updateCurrent();
    void Promise.resolve().then(() => onNativeSearch(query)).then(opened => {
      if (!opened) throw new Error('Search unavailable');
      hide();
    }).catch(() => {
      searchStatus.textContent = `${providerName}'s search input is unavailable. Your query is kept here; open Search in the chat page and try again.`;
      searchStatus.hidden = false; show();
    }).finally(() => { searching = false; updateCurrent(); });
  });
  search.addEventListener('focus', () => { keyboardMode = true; show(); });
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (!event.repeat && !searching && !search.disabled) searchForm.requestSubmit();
  });
  shell.addEventListener('pointerenter', show); shell.addEventListener('pointerleave', scheduleHide);
  shell.addEventListener('focusin', show); shell.addEventListener('focusout', () => { if (!shell.matches(':hover')) scheduleHide(); });
  reveal.addEventListener('click', show);
  document.addEventListener('pointerdown', event => { keyboardMode = false; if (!shell.contains(event.target)) hide(); });
  document.addEventListener('keydown', event => {
    keyboardMode = true;
    if (event.key !== 'Escape' || shell.dataset.open !== 'true' || q('#chat-view').hidden || root !== document && root.hidden) return;
    event.preventDefault(); searchStatus.hidden = true; hide(); q('#chat-tab').focus();
  });
  window.addEventListener('pagehide', () => clearTimeout(hideTimer), { once: true });
  updateCurrent();
  return { updateCurrent, hide, isOpen: () => shell.dataset.open === 'true', updateHistory(value) { history = value; updateCurrent(); } };
}
