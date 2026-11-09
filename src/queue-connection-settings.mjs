export const connectionStorageKey = 'resumeQueueConnection';
import { MANUAL_QUEUE_MODE, MANUAL_QUEUE_MESSAGE } from './queue-mode.mjs';

export function createQueueConnectionSettings({ browser = chrome, canChange = () => true, onChange = () => {}, openConnection } = {}) {
  const select = document.getElementById('queue-connection');
  const status = document.getElementById('queue-connection-status');
  let mode = 'sidebar', loaded = false;
  function reflect() {
    select.value = mode;
    select.disabled = !loaded || !canChange();
    status.textContent = MANUAL_QUEUE_MODE ? MANUAL_QUEUE_MESSAGE : mode === 'tab' ? 'The queue sends through its own ChatGPT tab in this window. Keep the sidebar open while it runs.'
      : 'The queue sends through Chat in this sidebar. Keep the sidebar open while it runs.';
  }
  function apply(value) { mode = value === 'tab' ? 'tab' : 'sidebar'; reflect(); onChange(mode); }
  select.addEventListener('change', () => {
    void (async () => {
      if (!canChange()) { reflect(); return; }
      const previous = mode;
      apply(select.value); select.disabled = true;
      try { await browser.storage.local.set({ [connectionStorageKey]: mode }); }
      catch { apply(previous); status.textContent = 'Could not save this connection. Try again.'; }
      finally { reflect(); }
    })();
  });
  document.getElementById('queue-connection-open').addEventListener('click', () => {
    void Promise.resolve(openConnection()).catch(error => { status.textContent = error.message; });
  });
  const changed = (changes, area) => { if (area === 'local' && changes[connectionStorageKey]) apply(changes[connectionStorageKey].newValue); };
  browser.storage.onChanged.addListener(changed);
  window.addEventListener('pagehide', () => browser.storage.onChanged.removeListener(changed));
  const ready = browser.storage.local.get(connectionStorageKey).then(data => apply(data[connectionStorageKey]))
    .catch(() => { status.textContent = 'Could not load connection settings. Sidebar Chat will be used.'; })
    .finally(() => { loaded = true; reflect(); });
  reflect();
  return { ready, mode: () => mode, refresh: reflect };
}
