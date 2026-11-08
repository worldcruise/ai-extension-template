// Local page shortcuts use Command on macOS and Control on Windows/Linux.
(() => {
  if (globalThis.SideAIShortcuts) return;
  const storageKey = 'sideaiLocalShortcutsV2';
  const isMac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const defaultKey = isMac ? 'Command+J' : 'Ctrl+J';
  const defaults = Object.freeze({ textMenu: defaultKey, writingAssistant: defaultKey, chatPage: defaultKey });
  const commandFirst = value => value.includes('Command+') && !value.startsWith('Command+') ? 'Command+' + value.replace('Command+', '') : value;
  let settings = { ...defaults };
  const listeners = new Set();
  const normalize = raw => Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
    const value = typeof raw?.[name] === 'string' && raw[name] ? raw[name] : fallback;
    return [name, commandFirst(isMac && value === 'Ctrl+J' ? defaultKey : value)];
  }));
  function fromEvent(event) {
    if (event.isComposing || event.getModifierState?.('AltGraph')) return '';
    let key = event.key;
    if (!key || ['Control', 'Shift', 'Alt', 'Meta', 'OS', 'Dead', 'Unidentified'].includes(key)) return '';
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    const parts = [];
    if (event.metaKey) parts.push('Command');
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d{1,2}$/.test(key)) return '';
    return [...parts, key].join('+');
  }
  function notify() { for (const listener of listeners) listener({ ...settings }); }
  const ready = chrome.storage.local.get(storageKey).then(result => {
    settings = normalize(result[storageKey]);
    notify();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[storageKey]) return;
    settings = normalize(changes[storageKey].newValue);
    notify();
  });
  globalThis.SideAIShortcuts = {
    defaults, ready, fromEvent,
    get: name => settings[name] || '',
    format: value => commandFirst(value || '').replace(/Command/g, '⌘').replace(/\+/g, ' + '),
    matches: (event, name) => !event.repeat && !event.defaultPrevented && fromEvent(event) === settings[name],
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async save(name, value) {
      if (!(name in defaults) || !value) throw new Error('Choose a shortcut first.');
      const latest = await chrome.storage.local.get(storageKey);
      const next = { ...normalize(latest[storageKey]), [name]: value };
      await chrome.storage.local.set({ [storageKey]: next });
      settings = next;
      notify();
    },
    async reset(name) { await this.save(name, defaults[name]); }
  };
})();
