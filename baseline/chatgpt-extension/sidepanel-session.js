// Chat slots belong to one window and last for this browser session.
(() => {
  const hideCommand = 'toggle-resume-sidepanel', lastCommand = 'open-last-closed-sidepanel';
  const panels = new Map(), pending = new Map(), writes = new Map();
  const focusPending = new Set();
  const key = (id, slot) => `sideai-${slot}-chat:${id}`;
  const post = (port, message) => { try { port.postMessage(message); } catch (_) {} };
  function queue(id, operation) {
    const write = (writes.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    writes.set(id, write);
    write.finally(() => { if (writes.get(id) === write) writes.delete(id); }).catch(() => {});
    return write;
  }
  function sanitize(raw) {
    const url = new URL(raw?.url || 'https://chatgpt.com/');
    if (url.origin !== 'https://chatgpt.com' || !/^\/(?:c\/[a-f0-9-]+|g\/[\w-]+(?:\/c\/[a-f0-9-]+)?)?\/?$/i.test(url.pathname)) throw new Error('Only ChatGPT chats can be resumed.');
    return { url: url.origin + url.pathname, draft: typeof raw?.draft === 'string' ? raw.draft.slice(0, 100000) : '', tabIds: [...new Set((raw?.tabIds || []).filter(Number.isInteger))].slice(0, 50) };
  }
  async function readSlot(id, slot) {
    await writes.get(id);
    const data = await chrome.storage.session.get(key(id, slot));
    return data[key(id, slot)] ? sanitize(data[key(id, slot)]) : null;
  }
  function takeIntent(id) {
    const intent = pending.get(id);
    pending.delete(id);
    return intent?.expires > Date.now() ? intent.slot : null;
  }
  function rememberClosed(id, panel) {
    if (panel && !panel.visible) return;
    if (panel) panel.visible = false;
    const snapshot = panel?.current;
    if (panel && !snapshot && !panel.initialized) return;
    queue(id, async () => {
      const current = snapshot || (await chrome.storage.session.get(key(id, 'current')))[key(id, 'current')];
      if (current) await chrome.storage.session.set({ [key(id, 'last-closed')]: sanitize(current) });
    }).catch(() => {});
  }
  function openInPanel(id, panel, slot) {
    panel.current = null;
    panel.initialized = false;
    readSlot(id, slot).then(snapshot => {
      if (panels.get(id) === panel && panel.visible) post(panel.port, { type: 'open', snapshot });
    }).catch(error => post(panel.port, { type: 'error', message: error.message }));
  }
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'sideai-resume-panel' || !port.sender?.url?.startsWith(chrome.runtime.getURL('sidepanel/index.html'))) return;
    let windowId, panel, saving = false;
    port.onMessage.addListener(message => {
      if (message.type === 'hello' && Number.isInteger(message.windowId)) {
        windowId = message.windowId;
        panel = { port, visible: true, current: null, initialized: !!message.initialized };
        panels.set(windowId, panel);
        const slot = takeIntent(windowId);
        Promise.resolve(slot ? readSlot(windowId, slot) : null).then(snapshot => {
          post(port, { type: 'startup', snapshot });
          if (focusPending.delete(windowId)) post(port, { type: 'focus-composer' });
          if (message.initialized && slot) post(port, { type: 'open', snapshot });
        }).catch(() => post(port, { type: 'startup', snapshot: null }));
        // Shortcut labels must never delay navigation or saved-chat restoration.
        chrome.commands.getAll().then(commands => {
          post(port, { type: 'shortcut', shortcut: commands.find(c => c.name === hideCommand)?.shortcut || '' });
        }).catch(() => {});
      }
      if (!panel || panels.get(windowId) !== panel) return;
      if (message.type === 'save-current-chat' && panel.visible && !saving) {
        try {
          const snapshot = sanitize(message.snapshot);
          panel.current = snapshot;
          queue(windowId, () => chrome.storage.session.set({ [key(windowId, 'current')]: snapshot })).catch(() => {});
        } catch (_) {}
      }
      if (message.type === 'save-and-hide' && panel.visible && !saving) {
        saving = true;
        (async () => {
          const snapshot = sanitize(message.snapshot);
          panel.current = snapshot;
          await queue(windowId, () => chrome.storage.session.set({
            [key(windowId, 'hidden')]: snapshot, [key(windowId, 'last-closed')]: snapshot, [key(windowId, 'current')]: snapshot
          }));
          if (chrome.sidePanel.close) await chrome.sidePanel.close({ windowId });
          else post(port, { type: 'close-window' });
        })().catch(error => post(port, { type: 'error', message: error.message })).finally(() => { saving = false; });
      }
    });
    port.onDisconnect.addListener(() => {
      if (panels.get(windowId) !== panel) return;
      rememberClosed(windowId, panel);
      panels.delete(windowId);
    });
  });
  chrome.sidePanel.onClosed?.addListener(info => rememberClosed(info.windowId, panels.get(info.windowId)));
  chrome.sidePanel.onOpened?.addListener(info => {
    const panel = panels.get(info.windowId);
    if (panel && !panel.visible) {
      panel.visible = true;
      const slot = takeIntent(info.windowId);
      if (slot) openInPanel(info.windowId, panel, slot);
      else { panel.current = null; panel.initialized = false; post(panel.port, { type: 'open', snapshot: null }); }
    }
  });
  chrome.commands.onCommand.addListener((name, tab) => {
    if (name === 'focus-sidepanel-prompt') {
      const focus = windowId => {
        const panel = panels.get(windowId);
        if (panel) {
          // Reopen the native panel so Chrome transfers keyboard focus from the page widget.
          // Opening an already visible panel only focuses its DOM, leaving keystrokes on the page.
          if (chrome.sidePanel.close) {
            focusPending.add(windowId);
            pending.set(windowId, { slot: 'current', expires: Date.now() + 30000 });
            Promise.all([chrome.sidePanel.close({ windowId }).catch(() => {}), chrome.sidePanel.open({ windowId })])
              .catch(() => { focusPending.delete(windowId); post(panel.port, { type: 'focus-composer' }); });
          } else {
            chrome.sidePanel.open({ windowId }).then(() => post(panel.port, { type: 'focus-composer' })).catch(() => post(panel.port, { type: 'focus-composer' }));
          }
        } else {
          focusPending.add(windowId);
          chrome.sidePanel.open({ windowId }).catch(() => focusPending.delete(windowId));
        }
      };
      if (Number.isInteger(tab?.windowId)) focus(tab.windowId);
      else chrome.windows.getLastFocused().then(win => focus(win.id));
      return;
    }
    if (name !== hideCommand && name !== lastCommand) return;
    const run = windowId => {
      const panel = panels.get(windowId);
      const slot = name === hideCommand ? 'hidden' : 'last-closed';
      if (panel?.visible) {
        if (name === hideCommand) post(panel.port, { type: 'capture-and-hide' });
        else openInPanel(windowId, panel, slot);
        return;
      }
      pending.set(windowId, { slot, expires: Date.now() + 30000 });
      chrome.sidePanel.open({ windowId }).catch(error => {
        pending.delete(windowId);
        console.warn('[SideAI] Cannot open panel:', error);
      });
    };
    if (Number.isInteger(tab?.windowId)) run(tab.windowId);
    else chrome.windows.getLastFocused().then(win => run(win.id));
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'SIDEAI_GET_SHORTCUTS') {
      chrome.commands.getAll().then(commands => respond({ commands })).catch(() => respond({ commands: [] }));
      return true;
    }
    if (message.type === 'SIDEAI_EDIT_SHORTCUTS') {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).then(() => respond({ success: true })).catch(() => respond({ success: false }));
      return true;
    }
    if (message.type === 'SIDEAI_OPEN_SHORTCUT_SETTINGS') {
      const url = chrome.runtime.getURL('options/options.html');
      (async () => {
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find(tab => tab.url?.split('#')[0] === url);
        if (existing) {
          await chrome.tabs.update(existing.id, { active: true, url: url + '#shortcuts' });
          await chrome.tabs.sendMessage(existing.id, {type:'switchOptionsTab',tab:'shortcuts'}).catch(() => {});
        } else await chrome.tabs.create({ url: url + '#shortcuts' });
        respond({success:true});
      })().catch(() => respond({success:false}));
      return true;
    }
  });
  chrome.windows.onRemoved.addListener(id => {
    panels.delete(id); pending.delete(id); focusPending.delete(id);
    queue(id, () => chrome.storage.session.remove(['current', 'hidden', 'last-closed'].map(slot => key(id, slot)))).catch(() => {});
  });
})();
