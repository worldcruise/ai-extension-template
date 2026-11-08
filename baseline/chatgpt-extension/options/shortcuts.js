async function setupSideAIShortcutSettings() {
  const grid = document.querySelector('.shortcuts-grid');
  if (!grid) return;
  const shortcutOS = (await chrome.runtime.getPlatformInfo()).os;
  const defaultShortcut = name => {
    const suggested = chrome.runtime.getManifest().commands?.[name]?.suggested_key;
    return typeof suggested === 'string' ? suggested : suggested?.[shortcutOS] || suggested?.default || '';
  };
  const actions = [
    ['_execute_action', 'Open/close SideAI sidebar', 'Opening starts a new chat.', defaultShortcut('_execute_action')],
    ['toggle-resume-sidepanel', 'Hide and resume chat', 'Keep your hidden chat until you hide another one.', defaultShortcut('toggle-resume-sidepanel')],
    ['open-last-closed-sidepanel', 'Open last closed chat', 'Reopen the most recently closed chat, however you closed it.', defaultShortcut('open-last-closed-sidepanel')],
    ['focus-sidepanel-prompt', 'Focus ChatGPT prompt', 'Move directly from the page into the SideAI prompt.', defaultShortcut('focus-sidepanel-prompt')],
    ['textMenu', 'AI Text Menu', 'Ask AI about selected text.'],
    ['writingAssistant', 'Writing Assistant', 'Open the assistant in a writing field.'],
    ['chatPage', 'Chat with this page', 'Chat with the page when no text is selected and you are outside a writing field.']
  ];
  const format = SideAIShortcuts.format;
  document.querySelector('.shortcuts-intro').textContent = 'Choose Change, press your keys, then Save. Page shortcuts are saved on this device and reset to ' + format(SideAIShortcuts.defaults.textMenu) + '. Sidebar shortcuts are managed by Chrome.';
  grid.replaceChildren();
  const rows = new Map();
  for (const [name, title, description, nativeDefault] of actions) {
    const local = !nativeDefault;
    const card = document.createElement('section');
    card.className = 'shortcut-card';
    card.dataset.shortcut = name;
    card.innerHTML = '<div class="shortcut-card-header"><div><h4></h4><p></p></div><div class="shortcut-badge"></div></div><p class="shortcut-help" role="status"></p><div class="shortcut-card-actions"><button type="button" class="shortcut-action-btn shortcut-change">Change</button><button type="button" class="shortcut-secondary-btn shortcut-reset">Reset</button></div>';
    card.querySelector('h4').textContent = title;
    card.querySelector('p').textContent = description;
    const help = card.querySelector('.shortcut-help');
    const change = card.querySelector('.shortcut-change');
    const reset = card.querySelector('.shortcut-reset');
    change.setAttribute('aria-label', 'Change shortcut: ' + title);
    reset.setAttribute('aria-label', 'Reset shortcut: ' + title);
    if (local) {
      const editor = document.createElement('div');
      editor.className = 'shortcut-local-editor';
      editor.hidden = true;
      editor.innerHTML = '<input class="shortcut-recorder" type="text" readonly placeholder="Press your shortcut"><button type="button" class="shortcut-action-btn">Save</button><button type="button" class="shortcut-secondary-btn">Cancel</button>';
      card.appendChild(editor);
      const input = editor.querySelector('input');
      input.setAttribute('aria-label', 'Record shortcut: ' + title);
      const [save, cancel] = editor.querySelectorAll('button');
      let pending = '';
      const close = () => { editor.hidden = true; change.disabled = false; change.focus(); };
      change.addEventListener('click', () => {
        pending = ''; input.value = ''; save.disabled = true;
        editor.hidden = false; change.disabled = true;
        help.textContent = 'Press a combination with Ctrl, Alt/Option, Shift or Command. Escape cancels. Browser and system shortcuts may take priority.';
        input.focus();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Tab') return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') { close(); return; }
        const value = SideAIShortcuts.fromEvent(event);
        if (!value) return;
        pending = value; input.value = format(value); save.disabled = false;
      });
      save.addEventListener('click', async () => {
        if (!pending) return;
        try { await SideAIShortcuts.save(name, pending); close(); }
        catch (_) { help.textContent = 'Could not save. Please try again.'; }
      });
      cancel.addEventListener('click', close);
      reset.addEventListener('click', async () => {
        try { await SideAIShortcuts.reset(name); close(); }
        catch (_) { help.textContent = 'Could not reset. Please try again.'; }
      });
    } else {
      change.textContent = 'Change in Chrome'; reset.textContent = 'Reset in Chrome';
      const openEditor = async resetting => {
        help.textContent = resetting ? 'To reset, enter ' + format(nativeDefault) + ' for this action in Chrome.' : 'Choose this action in Chrome and press your preferred keys.';
        try { await chrome.tabs.create({url:'chrome://extensions/shortcuts'}); }
        catch (_) { help.textContent = 'Could not open Chrome shortcut settings. Please try again.'; }
      };
      change.addEventListener('click', () => openEditor(false));
      reset.addEventListener('click', () => openEditor(true));
    }
    grid.appendChild(card);
    rows.set(name, {card, help, nativeDefault});
  }
  function refreshLocal() {
    for (const [name, {card, help, nativeDefault}] of rows) {
      if (nativeDefault) continue;
      card.querySelector('.shortcut-badge').textContent = format(SideAIShortcuts.get(name));
      help.textContent = 'Default: ' + format(SideAIShortcuts.defaults[name]) + ' · Saved on this device';
    }
  }
  async function refreshNative() {
    try {
      const commands = await chrome.commands.getAll();
      for (const [name, {card, help, nativeDefault}] of rows) {
        if (!nativeDefault) continue;
        const assigned = commands.find(command => command.name === name)?.shortcut;
        card.querySelector('.shortcut-badge').textContent = format(assigned) || 'Not assigned';
        card.querySelector('.shortcut-change').textContent = assigned ? 'Change in Chrome' : 'Assign in Chrome';
        help.textContent = assigned ? 'Default: ' + format(nativeDefault) + ' · Managed by Chrome'
          : 'No key is assigned in Chrome. It may have been cleared or taken by another extension. Choose Assign in Chrome and try ' + format(nativeDefault) + ', or another available combination.';
      }
    } catch (_) {}
  }
  await SideAIShortcuts.ready;
  refreshLocal(); await refreshNative();
  SideAIShortcuts.subscribe(refreshLocal);
  window.addEventListener('focus', refreshNative);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNative(); });
  const showTab = () => { if (location.hash === '#shortcuts') document.querySelector('[data-tab="shortcuts"]')?.click(); };
  showTab(); window.addEventListener('hashchange', showTab);
}
