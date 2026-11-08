import { icon } from './icons.mjs';

export function createChatToolbar({ getCompanyChats, selectConversation, currentUrl }) {
  const q = selector => document.querySelector(selector);
  const shell = q('#chat-toolbar-shell');
  const toolbar = q('#chat-toolbar');
  const reveal = q('#chat-toolbar-reveal');
  const toggle = q('#company-chat-toggle');
  const menu = q('#company-chat-menu');
  const search = q('#company-chat-search');
  const refresh = q('#company-chat-refresh');
  let keyboardMode = false;
  let hideTimer, menuHoverTimer;
  let chats = [];
  let selectionId = null;

  function closeCompanyMenu(focus = false) {
    clearTimeout(menuHoverTimer);
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus();
  }
  function show() {
    clearTimeout(hideTimer);
    shell.dataset.open = 'true';
    toolbar.inert = false;
    reveal.setAttribute('aria-expanded', 'true');
  }
  function hide() {
    clearTimeout(hideTimer);
    closeCompanyMenu();
    if (shell.contains(document.activeElement)) document.activeElement.blur();
    shell.dataset.open = 'false';
    toolbar.inert = true;
    reveal.setAttribute('aria-expanded', 'false');
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (keyboardMode && shell.contains(document.activeElement)) return;
      hide();
    }, 180);
  }
  function updateCurrent() {
    const matching = chats.find(chat => chat.id === selectionId && chat.url === currentUrl()) ||
      chats.find(chat => chat.url === currentUrl());
    selectionId = matching?.id || null;
    q('#company-chat-label').textContent = matching?.title || 'Company chats';
    toggle.title = matching?.title || 'Choose a saved company’s connected chat';
    for (const button of q('#company-chat-list').querySelectorAll('button')) {
      if (button.dataset.companyRequest === selectionId) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  function renderCompanies() {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = chats.filter(chat => `${chat.title} ${chat.role}`.toLocaleLowerCase().includes(query));
    q('#company-chat-list').replaceChildren(...filtered.map(chat => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.title = chat.title;
      button.dataset.chatUrl = chat.url;
      button.dataset.companyRequest = chat.id;
      const title = document.createElement('span');
      const company = document.createElement('strong');
      company.textContent = chat.title;
      const role = document.createElement('small');
      role.textContent = `${chat.role} · #${String(chat.id).padStart(3, '0')}`;
      title.append(company, role);
      button.append(icon('link'), title);
      button.addEventListener('click', () => {
        selectionId = chat.id;
        closeCompanyMenu(); selectConversation(chat); updateCurrent();
      });
      row.append(button);
      return row;
    }));
    q('#company-chat-status').textContent = !chats.length
      ? 'No connected company chats yet. Open a saved company’s Review and connect its chat.'
      : filtered.length ? `${filtered.length} connected chat${filtered.length === 1 ? '' : 's'}`
      : 'No companies match your search.';
    updateCurrent();
  }
  function refreshCompanies() {
    chats = getCompanyChats();
    renderCompanies();
  }
  function openCompanyMenu(focusSearch = false) {
    show();
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    search.value = '';
    refreshCompanies();
    if (focusSearch) search.focus();
  }

  shell.addEventListener('pointerenter', show);
  shell.addEventListener('pointerleave', scheduleHide);
  shell.addEventListener('focusin', show);
  shell.addEventListener('focusout', () => {
    if (!shell.matches(':hover')) scheduleHide();
  });
  reveal.addEventListener('click', show);
  toggle.addEventListener('pointerenter', event => {
    if (!['mouse', 'pen'].includes(event.pointerType)) return;
    clearTimeout(menuHoverTimer);
    menuHoverTimer = setTimeout(() => { if (menu.hidden) openCompanyMenu(); }, 120);
  });
  toggle.addEventListener('pointerleave', () => clearTimeout(menuHoverTimer));
  toggle.addEventListener('click', () => menu.hidden ? openCompanyMenu() : closeCompanyMenu());
  toggle.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); openCompanyMenu(true); }
  });
  refresh.addEventListener('click', refreshCompanies);
  search.addEventListener('input', renderCompanies);
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
    clearTimeout(hideTimer); clearTimeout(menuHoverTimer);
  });

  refreshCompanies();
  return { refreshCompanies, updateCurrent, hide };
}
