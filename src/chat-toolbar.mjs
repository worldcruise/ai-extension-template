import { icon } from './icons.mjs';
import './chat-history.js';

export function createChatToolbar({ selectConversation, currentUrl, onHistoryNeeded = () => {}, onChatsRefresh = () => {}, moveHistory = () => {}, browser = globalThis.chrome }) {
  const q = selector => document.querySelector(selector);
  const shell = q('#chat-toolbar-shell');
  const toolbar = q('#chat-toolbar');
  const reveal = q('#chat-toolbar-reveal');
  const pin = q('#chat-toolbar-pin');
  const pinStatus = q('#chat-toolbar-pin-status');
  const picker = q('.company-chat-picker');
  const menu = q('#company-chat-menu');
  const search = q('#company-chat-search');
  const refresh = q('#company-chat-refresh');
  const newer = q('#chat-history-up');
  const older = q('#chat-history-down');
  let history = {};
  let keyboardMode = false;
  let hideTimer, blurTimer;
  let chats = [];
  let selectionId = null;
  let activeIndex = -1;
  let pinned = false;
  let pinRevision = 0;
  let pinSave = Promise.resolve();

  function setActive(index) {
    const options = [...q('#company-chat-list').querySelectorAll('button')];
    activeIndex = index >= 0 && index < options.length ? index : -1;
    options.forEach((button, position) => button.setAttribute('aria-selected', String(position === activeIndex)));
    if (activeIndex < 0) search.removeAttribute('aria-activedescendant');
    else {
      search.setAttribute('aria-activedescendant', options[activeIndex].id);
      options[activeIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function closeCompanyMenu(focus = false) {
    menu.hidden = true;
    search.setAttribute('aria-expanded', 'false'); setActive(-1);
    if (focus) (pinned ? pin : reveal).focus();
  }
  function show() {
    clearTimeout(hideTimer);
    shell.dataset.open = 'true';
    toolbar.inert = false;
    reveal.setAttribute('aria-expanded', 'true');
    onHistoryNeeded();
  }
  function hide() {
    clearTimeout(hideTimer);
    closeCompanyMenu();
    if (shell.contains(document.activeElement)) document.activeElement.blur();
    if (pinned) { show(); return; }
    shell.dataset.open = 'false';
    toolbar.inert = true;
    reveal.setAttribute('aria-expanded', 'false');
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (pinned) return;
    hideTimer = setTimeout(() => {
      if (picker.contains(document.activeElement) || keyboardMode && shell.contains(document.activeElement)) return;
      hide();
    }, 180);
  }
  function setPinned(value) {
    pinned = value;
    shell.dataset.pinned = String(pinned);
    pin.setAttribute('aria-pressed', String(pinned));
    pin.title = pinned ? 'Unpin toolbar' : 'Pin toolbar';
    pin.setAttribute('aria-label', pin.title);
    pin.replaceChildren(icon(pinned ? 'pin-off' : 'pin'));
    if (pinned) show();
    else if (!shell.matches(':hover')) scheduleHide();
  }
  pin.addEventListener('click', () => {
    const revision = ++pinRevision;
    setPinned(!pinned);
    const value = pinned;
    pinStatus.textContent = value ? 'Toolbar pinned.' : 'Toolbar unpinned.';
    // Serialize rapid toggles so an older save cannot restore the wrong state.
    pinSave = pinSave.catch(() => {}).then(() => browser.storage.local.set({ chatToolbarPinned: value }));
    void pinSave.catch(() => {
      if (pinRevision === revision) pinStatus.textContent = 'Could not save the toolbar preference. Your choice applies for this sidebar session.';
    });
  });
  void browser.storage.local.get('chatToolbarPinned').then(data => {
    if (pinRevision === 0 && data.chatToolbarPinned === true) setPinned(true);
  }).catch(() => {});
  function updateCurrent() {
    renderHistory();
    const current = globalThis.AiAgentChatHistory.conversation(currentUrl());
    const matching = chats.find(chat => chat.id === selectionId && chat.url === current) ||
      chats.find(chat => chat.url === current);
    selectionId = matching?.id || null;
    search.title = matching ? `Current ChatGPT chat: ${matching.title}. Search saved ChatGPT chats.` : 'Search saved ChatGPT chats';
    for (const button of q('#company-chat-list').querySelectorAll('button')) {
      if (button.dataset.chatUrl === selectionId) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      button.querySelector('small').textContent = button.dataset.chatUrl === current ? 'Current chat' : 'Saved conversation';
    }
  }
  function renderHistory() {
    const routes = globalThis.AiAgentChatHistory;
    const canMove = history.enabled && history.ready && !history.pending && !history.hasDraft && !history.busy && history.reason !== 'signed-out';
    newer.disabled = !canMove || !history.loaded || !routes.target(history.urls, currentUrl(), -1);
    older.disabled = !canMove || Boolean(history.loaded && !routes.target(history.urls, currentUrl(), 1));
    const blocked = history.hasDraft ? 'Finish or clear the draft before switching chats.' : history.busy ? 'Wait for the response to finish before switching chats.'
      : history.pending ? 'Loading ChatGPT history…' : !history.ready || !history.enabled ? 'ChatGPT is not ready.'
      : history.reason === 'signed-out' ? 'Sign in to ChatGPT to browse chats.'
      : history.reason === 'unavailable' ? 'ChatGPT history is not available yet. Open its sidebar and try again.' : '';
    newer.title = blocked || (!routes.conversation(currentUrl()) ? 'New chat — no newer conversation.' : newer.disabled ? 'No newer conversation is available.' : 'Newer ChatGPT conversation');
    older.title = blocked || (older.disabled ? 'No older conversation is available in loaded history.' : !routes.conversation(currentUrl()) ? 'Open the most recent ChatGPT conversation' : 'Older ChatGPT conversation');
  }
  newer.addEventListener('click', () => moveHistory(-1));
  older.addEventListener('click', () => moveHistory(1));
  // A cached row may be selected while refreshing: the host waits for that
  // inspection and revalidates the native link before a single navigation.
  const canOpenChat = () => history.enabled && history.ready && !history.navigating && !history.hasDraft && !history.busy && history.reason !== 'signed-out';
  function updateListState() {
    const count = q('#company-chat-list').children.length;
    for (const button of q('#company-chat-list').querySelectorAll('button')) button.disabled = !canOpenChat();
    refresh.disabled = Boolean(history.pending);
    q('#company-chat-status').textContent = history.reason === 'signed-out' ? 'Sign in to ChatGPT to view saved chats.'
      : !history.enabled || !history.ready ? 'Waiting for ChatGPT…'
      : history.hasDraft ? 'Your draft is preserved. Finish or clear it before opening another chat.'
      : history.busy ? 'Wait for the response to finish before opening another chat.'
      : history.pending ? 'Loading ChatGPT chats…'
      : history.reason === 'unavailable' ? 'ChatGPT history is unavailable. Open its sidebar and refresh this list.'
      : !history.loaded ? 'Open or refresh the list to load ChatGPT chats.'
      : !chats.length ? 'No saved ChatGPT chats found.'
      : !count ? 'No chats match your search.'
      : `${count} saved chat${count === 1 ? '' : 's'}`;
  }
  function renderCompanies() {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = chats.filter(chat => chat.title.toLocaleLowerCase().includes(query));
    activeIndex = -1; search.removeAttribute('aria-activedescendant');
    q('#company-chat-list').replaceChildren(...filtered.map((chat, index) => {
      const row = document.createElement('li');
      row.setAttribute('role', 'presentation');
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `company-chat-option-${index}`;
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false'); button.tabIndex = -1;
      button.title = chat.title;
      button.dataset.chatUrl = chat.url;
      const title = document.createElement('span');
      const company = document.createElement('strong');
      company.textContent = chat.title;
      const role = document.createElement('small');
      role.textContent = chat.url === currentUrl() ? 'Current chat' : 'Saved conversation';
      title.append(company, role);
      button.append(icon('link'), title);
      button.addEventListener('pointerdown', event => { event.preventDefault(); });
      button.addEventListener('pointermove', () => setActive(index));
      button.addEventListener('click', () => {
        if (!canOpenChat()) return;
        selectionId = chat.id;
        search.value = ''; closeCompanyMenu(); search.blur(); selectConversation(chat); updateCurrent();
      });
      row.append(button);
      return row;
    }));
    updateListState();
    updateCurrent();
  }
  function openCompanyMenu() {
    show();
    menu.hidden = false;
    search.setAttribute('aria-expanded', 'true');
    renderCompanies(); onChatsRefresh();
  }

  shell.addEventListener('pointerenter', show);
  shell.addEventListener('pointerleave', scheduleHide);
  shell.addEventListener('focusin', show);
  shell.addEventListener('focusout', () => {
    if (!shell.matches(':hover')) scheduleHide();
  });
  reveal.addEventListener('click', show);
  search.addEventListener('focus', openCompanyMenu);
  search.addEventListener('click', () => { if (menu.hidden) openCompanyMenu(); });
  picker.addEventListener('focusin', () => clearTimeout(blurTimer));
  picker.addEventListener('focusout', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { if (!picker.contains(document.activeElement)) closeCompanyMenu(); }, 0);
  });
  search.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); if (menu.hidden) openCompanyMenu();
      const count = q('#company-chat-list').children.length;
      if (count) setActive(event.key === 'ArrowDown' ? (activeIndex + 1) % count : activeIndex < 0 ? count - 1 : (activeIndex - 1 + count) % count);
    }
    if (event.key === 'Enter' && !menu.hidden) {
      event.preventDefault();
      const options = [...q('#company-chat-list').querySelectorAll('button')];
      if (activeIndex >= 0) options[activeIndex]?.click();
      else if (options.length === 1) options[0].click();
    }
  });
  refresh.addEventListener('click', onChatsRefresh);
  search.addEventListener('input', () => { if (menu.hidden) openCompanyMenu(); else renderCompanies(); });
  document.addEventListener('pointerdown', event => {
    keyboardMode = false;
    if (!shell.contains(event.target)) hide();
  });
  document.addEventListener('keydown', event => {
    keyboardMode = true;
    if (event.key !== 'Escape' || shell.dataset.open !== 'true' || q('#chat-view').hidden) return;
    event.preventDefault();
    if (!menu.hidden) closeCompanyMenu(true);
    else { hide(); q('#chat-tab').focus(); }
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(hideTimer); clearTimeout(blurTimer);
  });

  renderCompanies();
  return { updateCurrent, hide, isOpen: () => shell.dataset.open === 'true',
    updateHistory(value) {
      history = value;
      const next = (value.chats || []).map(chat => ({...chat,id:chat.url}));
      if (JSON.stringify(next) !== JSON.stringify(chats)) { chats = next; renderCompanies(); }
      else updateListState();
      renderHistory();
    } };
}
