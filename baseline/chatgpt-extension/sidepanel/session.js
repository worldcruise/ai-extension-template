(() => {
  let port;
  let ready = false;
  let snapshot = null;
  let shortcut = '';
  let initialized = false;
  let resolveStartup;
  window.sideAIResumeStartup = new Promise(resolve => { resolveStartup = resolve; });
  const frame = () => document.getElementById('chatgpt-iframe');
  const send = message => frame()?.contentWindow?.postMessage(message, 'https://chatgpt.com');
  const introKey = 'sideai-hide-resume-intro-seen';
  let introSeen = false;
  let hidePending = false;

  async function explainHide() {
    const shortcutOS = (await chrome.runtime.getPlatformInfo()).os;
    let commands = null;
    try { commands = await chrome.commands.getAll(); } catch (_) {}
    const shortcutLabel = name => {
      if (!commands) return 'Unavailable';
      const suggested = chrome.runtime.getManifest().commands?.[name]?.suggested_key;
      const fallback = typeof suggested === 'string' ? suggested : suggested?.[shortcutOS] || suggested?.default || '';
      const command = commands.find(item => item.name === name);
      if (!command?.shortcut) return `Not assigned (default: ${fallback.replace(/Command/g, '⌘').replace(/\+/g, ' + ')})`;
      return command.shortcut.replace(/Command/g, '⌘').replace(/\+/g, ' + ');
    };
    const normalShortcut = shortcutLabel('_execute_action');
    const resumeShortcut = shortcutLabel('toggle-resume-sidepanel');
    const lastShortcut = shortcutLabel('open-last-closed-sidepanel');
    const style = document.createElement('style');
    style.textContent = `
      .sideai-resume-intro { box-sizing: border-box; width: min(420px, calc(100% - 16px)); max-height: calc(100% - 16px); overflow: auto; margin: auto; padding: 16px; border: 1px solid var(--sp-border); border-radius: 16px; background: var(--sp-surface, #fff); color: var(--sp-text, #17202a); box-shadow: 0 24px 80px #0004; font: 12px/1.4 "Segoe UI", sans-serif; }
      .sideai-resume-intro::backdrop { background: #0007; }
      .sideai-resume-intro .intro-header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 5px; }
      .sideai-resume-intro h2 { flex: 1; min-width: 0; margin: 0; font-size: 18px; line-height: 1.25; }
      .sideai-resume-intro p { margin: 0; }
      .sideai-resume-intro .intro-copy { color: var(--sp-text-soft, #465363); }
      .sideai-resume-intro .intro-option { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--sp-border, #dce1e6); border-radius: 10px; }
      .sideai-resume-intro .intro-option.resume { background: rgba(16, 185, 129, .12); border-color: rgba(16, 185, 129, .3); }
      .sideai-resume-intro .intro-shortcut { display: block; margin: 2px 0 4px; font-size: 11px; font-weight: 600; overflow-wrap: anywhere; }
      .sideai-resume-intro .intro-note { margin-top: 8px; font-size: 11px; color: var(--sp-text-soft, #465363); }
      .sideai-resume-intro .intro-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
      .sideai-resume-intro button { padding: 8px 12px; border: 1px solid var(--sp-border, #dce1e6); border-radius: 10px; background: transparent; color: inherit; cursor: pointer; font: 600 12px/1.4 "Segoe UI", sans-serif; }
      .sideai-resume-intro button[data-confirm] { background: linear-gradient(135deg, #10b981, #059669); color: #fff; border-color: transparent; }
      .sideai-resume-intro button[data-close] { display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; }
      .sideai-resume-intro button[data-close]:hover { background: rgba(16, 185, 129, .12); }
      .sideai-resume-intro button[data-confirm]:hover { background: linear-gradient(135deg, #059669, #047857); }
      .sideai-resume-intro button[data-settings] { padding: 0; border: 0; border-radius: 2px; color: #6ee7b7; font: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
      body.light-mode .sideai-resume-intro button[data-settings] { color: #0f766e; }
      .sideai-resume-intro button[data-settings]:hover { color: #34d399; }
      body.light-mode .sideai-resume-intro button[data-settings]:hover { color: #0b5f59; }
      .sideai-resume-intro button:focus-visible { outline: 2px solid #059669; outline-offset: 3px; }
    `;
    const dialog = document.createElement('dialog');
    dialog.className = 'sideai-resume-intro';
    dialog.setAttribute('aria-labelledby', 'sideai-resume-intro-title');
    dialog.setAttribute('aria-describedby', 'sideai-resume-intro-description');
    dialog.innerHTML = `
      <div class="intro-header"><h2 id="sideai-resume-intro-title">Hide now. Continue later.</h2><button type="button" data-close aria-label="Close reminder" autofocus><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <p id="sideai-resume-intro-description" class="intro-copy">Choose how to return to your chat.</p>
      <div class="intro-option"><strong>Close normally</strong><span class="intro-shortcut" data-normal></span><p class="intro-copy">The next normal open starts a new chat.</p></div>
      <div class="intro-option resume"><strong>Hide and resume chat</strong><span class="intro-shortcut" data-resume></span><p class="intro-copy">Keeps this chat, draft and tabs until you hide another chat. Normal closing won’t replace it.</p></div>
      <div class="intro-option"><strong>Open last closed chat</strong><span class="intro-shortcut" data-last></span><p class="intro-copy">Reopens your last closed chat, however you closed it.</p></div>
      <p class="intro-note"><button type="button" data-settings>Change it in Settings</button> · Shown once after you confirm.</p>
      <div class="intro-actions"><button type="button" data-confirm>Got it — hide chat</button></div>`;
    dialog.querySelector('[data-normal]').textContent = `X button · ${normalShortcut}`;
    dialog.querySelector('[data-resume]').textContent = `Hide button · ${resumeShortcut}`;
    dialog.querySelector('[data-last]').textContent = lastShortcut;
    dialog.querySelector('[data-settings]').onclick = () => {
      chrome.runtime.sendMessage({ type: 'SIDEAI_OPEN_SHORTCUT_SETTINGS' }).catch(() => {});
    };
    document.head.appendChild(style);
    document.body.appendChild(dialog);
    return new Promise(resolve => {
      dialog.addEventListener('close', () => {
        const confirmed = dialog.returnValue === 'confirm';
        dialog.remove();
        style.remove();
        resolve(confirmed);
      }, { once: true });
      dialog.querySelector('[data-close]').onclick = () => dialog.close();
      dialog.querySelector('[data-confirm]').onclick = () => dialog.close('confirm');
      dialog.showModal();
    });
  }

  async function requestHide(chatSnapshot) {
    if (hidePending) return;
    hidePending = true;
    try {
      if (!introSeen) {
        try { introSeen = (await chrome.storage.local.get(introKey))[introKey] === true; } catch (_) {}
        if (!introSeen) {
          if (!await explainHide()) return;
          introSeen = true;
          try { await chrome.storage.local.set({ [introKey]: true }); } catch (_) {}
          // Capture again after confirmation so the saved chat is up to date.
          send({ type: 'SIDEAI_CAPTURE_RESUME' });
          return;
        }
      }
      port?.postMessage({ type: 'save-and-hide', snapshot: chatSnapshot });
    } catch (_) {
      send({ type: 'SIDEAI_RESUME_ERROR', message: 'Please try again.' });
    } finally { hidePending = false; }
  }

  function restore() {
    if (!ready) return;
    send({ type: 'SIDEAI_RESUME_CHAT', snapshot, shortcut });
    snapshot = null;
  }
  function connect(windowId) {
    window.sideAIPanelWindowId = windowId;
    port = chrome.runtime.connect({ name: 'sideai-resume-panel' });
    port.onMessage.addListener(message => {
      if (message.type === 'focus-composer') {
        window.sideAIPendingExplicitFocus = true;
        window.sideAIFocusComposer?.();
      }
      if (message.type === 'startup') {
        if (typeof message.shortcut === 'string') shortcut = message.shortcut;
        if (!initialized) {
          initialized = true;
          snapshot = message.snapshot;
          resolveStartup(snapshot);
        }
        restore();
      } else if (message.type === 'shortcut') {
        shortcut = message.shortcut;
        restore();
      } else if (message.type === 'open') {
        snapshot = message.snapshot;
        ready = false;
        frame().src = snapshot?.url || frame().dataset.src;
      } else if (message.type === 'capture-and-hide') {
        send({ type: 'SIDEAI_CAPTURE_RESUME' });
      } else if (message.type === 'close-window') {
        window.close();
      } else if (message.type === 'error') {
        send({ type: 'SIDEAI_RESUME_ERROR', message: message.message });
      }
    });
    port.onDisconnect.addListener(() => {
      if (!initialized) { initialized = true; resolveStartup(null); }
      setTimeout(() => connect(windowId), 250);
    });
    port.postMessage({ type: 'hello', windowId, initialized });
  }
  window.addEventListener('message', event => {
    if (event.source !== frame()?.contentWindow || event.origin !== 'https://chatgpt.com') return;
    if (event.data?.type === 'SIDEAI_CHAT_READY') {
      ready = true;
      if (Number.isInteger(window.sideAIPanelWindowId)) send({type:'SIDEAI_PANEL_CONTEXT',windowId:window.sideAIPanelWindowId});
      restore();
    } else if (event.data?.type === 'SIDEAI_HIDE_AND_RESUME') {
      requestHide(event.data.snapshot);
    } else if (event.data?.type === 'SIDEAI_CURRENT_CHAT' && ready) {
      try { port?.postMessage({ type: 'save-current-chat', snapshot: event.data.snapshot }); } catch (_) {}
    }
  });
  chrome.windows.getCurrent().then(win => connect(win.id)).catch(() => resolveStartup(null));
})();
