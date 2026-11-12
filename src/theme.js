(() => {
  const key = 'ui-theme:v1', root = document.documentElement;
  let theme = 'light', revision = 0, writes = 0, pending = Promise.resolve();
  const normalize = value => value === 'dark' ? 'dark' : 'light';
  function apply(value) {
    theme = normalize(value); root.dataset.theme = theme;
    try { localStorage.setItem(key, theme); } catch { /* Chrome storage remains available. */ }
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
      toggle.title = label; toggle.setAttribute('aria-label', label);
      const copy = document.getElementById('theme-label');
      if (copy) copy.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    }
  }
  try { theme = normalize(localStorage.getItem(key)); } catch { /* Default to the reference's light theme. */ }
  apply(theme);
  const initial = revision;
  void chrome.storage.local.get(key).then(saved => {
    if (initial === revision && saved[key]) apply(saved[key]);
  }).catch(() => {});
  const changed = (changes, area) => {
    if (!writes && area === 'local' && changes[key]) { revision++; apply(changes[key].newValue); }
  };
  chrome.storage.onChanged.addListener(changed);
  document.addEventListener('DOMContentLoaded', () => {
    apply(theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      revision++; apply(theme === 'dark' ? 'light' : 'dark');
      const value = theme, ticket = revision; writes++;
      pending = pending.catch(() => {}).then(() => chrome.storage.local.set({ [key]: value }));
      void pending.catch(() => {}).finally(async () => {
        writes--;
        if (!writes) {
          try {
            const stored = await chrome.storage.local.get(key);
            if (!writes && ticket === revision && stored[key]) apply(stored[key]);
          } catch { /* Keep the locally cached selection. */ }
        }
      });
    });
  }, { once: true });
  window.addEventListener('pagehide', () => chrome.storage.onChanged.removeListener(changed), { once: true });
})();
