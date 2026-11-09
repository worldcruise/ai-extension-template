export const JOB_PAGE_ORIGINS = Object.freeze(['http://*/*', 'https://*/*']);

// Called directly from Read page's click handler, before any asynchronous work,
// so Chrome receives the user gesture required for its native permission prompt.
export function requestJobPageAccess(tabId, browser = globalThis.chrome) {
  const failure = (code, message) => Object.assign(new Error(message), { code });
  if (!Number.isInteger(tabId) || tabId < 0) return Promise.reject(failure('invalid-tab', 'Choose a job tab before reading the page.'));
  let changed = false;
  const updated = (id, change) => { if (id === tabId && (typeof change.url === 'string' || change.status === 'loading')) changed = true; };
  const removed = id => { if (id === tabId) changed = true; };
  const cleanup = () => {
    browser.tabs.onUpdated.removeListener(updated);
    browser.tabs.onRemoved.removeListener(removed);
  };
  browser.tabs.onUpdated.addListener(updated);
  browser.tabs.onRemoved.addListener(removed);
  let pending;
  try { pending = browser.permissions.request({ origins: [...JOB_PAGE_ORIGINS] }); }
  catch { cleanup(); return Promise.reject(failure('access-request', 'Chrome could not request website access. Click Read page directly in the sidebar to try again.')); }
  return Promise.resolve(pending).then(granted => {
    if (changed) throw failure('page-changed', 'The job tab changed while waiting for website access. Click Read page again.');
    if (!granted) throw failure('access-denied', 'Website access was not granted. Click Read page to try again, or use its keyboard shortcut for temporary access.');
  }, () => { throw failure('access-request', 'Chrome could not request website access. Click Read page directly in the sidebar to try again.'); }).finally(cleanup);
}
