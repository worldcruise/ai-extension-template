export const DOCUMENT_SETTINGS_KEY = 'documentSettings';
export const DOCUMENT_FORMATS = Object.freeze(['pdf', 'docx', 'json']);
export const DEFAULT_DOCUMENT_SETTINGS = Object.freeze({
  includeCoverLetter: true,
  autoDownload: true,
  autoPreview: true,
  formats: Object.freeze(['pdf'])
});

export function normalizeDocumentSettings(value) {
  const formats = DOCUMENT_FORMATS.filter(format => Array.isArray(value?.formats) && value.formats.includes(format));
  return {
    ...Object.fromEntries(['includeCoverLetter', 'autoDownload', 'autoPreview'].map(key => [key, value?.[key] !== false])),
    formats: formats.length ? formats : ['pdf']
  };
}

export async function readDocumentSettings(browser = globalThis.chrome) {
  const stored = await browser.storage.local.get(DOCUMENT_SETTINGS_KEY);
  return normalizeDocumentSettings(stored[DOCUMENT_SETTINGS_KEY]);
}

export function createDocumentSettings({ browser = globalThis.chrome, root = document, events = window } = {}) {
  const q = selector => root.querySelector(selector);
  const form = q('#document-settings-form'), status = q('#document-settings-status');
  const controls = {
    includeCoverLetter: q('#document-include-cover-letter'),
    autoDownload: q('#document-auto-download'),
    autoPreview: q('#document-auto-preview')
  };
  const formats = Object.fromEntries(DOCUMENT_FORMATS.map(format => [format, q('#document-format-' + format)]));
  let current = normalizeDocumentSettings(), pending = Promise.resolve(), revision = 0, disposed = false, writesPending = 0;
  function reflect() {
    for (const [key, control] of Object.entries(controls)) control.checked = current[key];
    controls.autoPreview.disabled = !current.autoDownload;
    for (const [format, control] of Object.entries(formats)) {
      control.checked = current.formats.includes(format);
      control.disabled = !current.autoDownload || control.checked && current.formats.length === 1;
    }
  }
  async function save() {
    const selected = Object.entries(formats).filter(([, control]) => control.checked).map(([format]) => format);
    if (controls.autoDownload.checked && !selected.length) {
      status.textContent = 'Choose at least one download format.';
      return;
    }
    const ticket = ++revision;
    current = normalizeDocumentSettings({
      ...Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.checked])), formats:selected
    });
    reflect();
    const snapshot = structuredClone(current);
    writesPending++;
    status.textContent = 'Saving document settings…';
    // Serialize writes so quick toggles cannot persist an older preference last.
    pending = pending.catch(() => {}).then(() => browser.storage.local.set({ [DOCUMENT_SETTINGS_KEY]: snapshot }));
    try {
      await pending;
      if (!disposed && ticket === revision) status.textContent = 'Document settings saved on this device.';
    } catch {
      if (!disposed && ticket === revision) status.textContent = 'Could not save document settings. Change a setting to try again.';
    } finally {
      writesPending--;
      if (!disposed && ticket === revision && !writesPending) {
        // A different open dock can write during our save. Refresh the final
        // stored value after queued writes, without flashing older own writes.
        try {
          const stored = await readDocumentSettings(browser);
          if (!disposed && ticket === revision && !writesPending) { current = stored; reflect(); }
        } catch { /* Keep the displayed preference and the save outcome. */ }
      }
    }
  }
  const onChange = () => { void save(); };
  form.addEventListener('change', onChange);
  const onSubmit = event => { event.preventDefault(); void save(); };
  form.addEventListener('submit', onSubmit);
  const changed = (changes, area) => {
    if (disposed || writesPending || area !== 'local' || !changes[DOCUMENT_SETTINGS_KEY]) return;
    revision++;
    current = normalizeDocumentSettings(changes[DOCUMENT_SETTINGS_KEY].newValue);
    reflect();
    status.textContent = 'Document settings updated on this device.';
  };
  browser.storage.onChanged.addListener(changed);
  function dispose() {
    disposed = true; revision++;
    browser.storage.onChanged.removeListener(changed);
    form.removeEventListener('change', onChange); form.removeEventListener('submit', onSubmit);
    events.removeEventListener('pagehide', dispose);
  }
  events.addEventListener('pagehide', dispose, { once: true });
  form.inert = true; reflect();
  const ticket = revision;
  const ready = readDocumentSettings(browser).then(value => {
    if (disposed || ticket !== revision) return;
    current = value; reflect();
    status.textContent = 'Changes save automatically on this device.';
  }).catch(() => {
    if (!disposed) status.textContent = 'Could not load document settings. Change a setting to save your preferences.';
  }).finally(() => { if (!disposed) form.inert = false; });
  return { ready, dispose };
}
