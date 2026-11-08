import './keyword-matcher.js';

export function createKeywordSettings({ onChange = () => {}, browser = globalThis.chrome } = {}) {
  const { storageKey, normalize, parseInput } = globalThis.AiAgentKeywords;
  const q = selector => document.querySelector(selector);
  const form = q('#keyword-settings-form');
  const toggle = q('#highlight-keywords');
  const save = q('#keyword-save');
  const status = q('#keyword-save-status');
  let current = normalize();
  let pending = Promise.resolve();
  function reflect() {
    toggle.checked = current.enabled;
    q('#keyword-enabled').checked = current.enabled;
    q('#keyword-list').value = current.keywords.join('\n');
    q('#keyword-color').value = current.color;
    q('#keyword-case-sensitive').checked = current.caseSensitive;
    q('#keyword-whole-words').checked = current.wholeWords;
  }
  async function persist(next) {
    current = normalize(next);
    reflect(); onChange(current);
    const snapshot = structuredClone(current);
    status.textContent = 'Saving…';
    pending = pending.catch(() => {}).then(() => browser.storage.local.set({ [storageKey]: snapshot }));
    try { await pending; status.textContent = 'Keyword settings saved on this device.'; }
    catch { status.textContent = 'Could not save keyword settings. Please try again.'; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const next = { enabled: q('#keyword-enabled').checked, color: q('#keyword-color').value,
        caseSensitive: q('#keyword-case-sensitive').checked, wholeWords: q('#keyword-whole-words').checked };
      next.keywords = parseInput(q('#keyword-list').value, next.caseSensitive);
      save.disabled = true;
      await persist(next);
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  });
  form.addEventListener('input', () => { status.textContent = 'Unsaved keyword changes.'; });
  toggle.addEventListener('change', () => { void persist({ ...current, enabled: toggle.checked }); });
  const changed = (changes, area) => {
    if (area !== 'local' || !changes[storageKey]) return;
    const next = normalize(changes[storageKey].newValue);
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    current = next; reflect(); onChange(current);
  };
  browser.storage.onChanged.addListener(changed);
  window.addEventListener('pagehide', () => browser.storage.onChanged.removeListener(changed));
  form.inert = true; toggle.disabled = true;
  const ready = browser.storage.local.get(storageKey).then(data => {
    current = normalize(data[storageKey]); reflect(); onChange(current);
    status.textContent = 'Keywords are used only on job web pages.';
  }).catch(() => { status.textContent = 'Could not load keyword settings. You can edit and save them again.'; })
    .finally(() => { form.inert = false; toggle.disabled = false; });
  return { ready };
}
