// The tabs permission supplies URL metadata; reading page content still needs site access.
export function createBrowserTabs({ browser = globalThis.chrome, onChange = () => {}, onError = () => {} } = {}) {
  let windowId;
  let ownTabId;
  let selectedId;
  let tabs = [];
  let busy = false;
  let disposed = false;
  let pending = Promise.resolve();
  const subscriptions = [];
  const enqueue = operation => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  const publish = () => {
    if (!disposed) onChange({ windowId, count: tabs.length, index: tabs.findIndex(tab => tab.id === selectedId) + 1,
      tabId: selectedId ?? null, url: tabs.find(tab => tab.id === selectedId)?.url || '', busy });
  };
  const report = () => {
    tabs = [];
    selectedId = undefined;
    publish();
    if (!disposed) onError('Could not access this window’s tabs. Try opening the sidebar again.');
  };
  async function readTabs() {
    if (disposed || !Number.isInteger(windowId)) return;
    const queried = await browser.tabs.query({ windowId });
    if (disposed) return;
    const ownOrigin = browser.runtime.getURL('');
    tabs = queried.filter(tab => Number.isInteger(tab.id) && tab.id >= 0 && tab.id !== ownTabId &&
      !tab.url?.startsWith(ownOrigin)).sort((left, right) => left.index - right.index);
    selectedId = tabs.find(tab => tab.active)?.id ?? tabs.find(tab => tab.id === selectedId)?.id ?? tabs[0]?.id;
    publish();
  }
  function refresh() { return enqueue(readTabs).catch(report); }
  function listen(event, relevant) {
    if (!event?.addListener) return;
    const callback = (...args) => { if (relevant(...args)) void refresh(); };
    event.addListener(callback);
    subscriptions.push(() => event.removeListener(callback));
  }
  async function initialize() {
    try {
      if (!browser?.tabs || !browser?.windows) throw new Error('Extension APIs unavailable');
      const ownTab = await browser.tabs.getCurrent();
      ownTabId = ownTab?.id;
      windowId = ownTab?.windowId ?? (await browser.windows.getCurrent()).id;
      if (!Number.isInteger(windowId) || windowId < 0) throw new Error('No associated window');
      if (disposed) return;
      listen(browser.tabs.onActivated, info => info.windowId === windowId);
      listen(browser.tabs.onCreated, tab => tab.windowId === windowId);
      listen(browser.tabs.onRemoved, (_id, info) => info.windowId === windowId);
      listen(browser.tabs.onMoved, (_id, info) => info.windowId === windowId);
      listen(browser.tabs.onAttached, (_id, info) => info.newWindowId === windowId);
      listen(browser.tabs.onDetached, (_id, info) => info.oldWindowId === windowId);
      listen(browser.tabs.onUpdated, (_id, _change, tab) => tab.windowId === windowId);
      await refresh();
    } catch { report(); }
  }
  const ready = initialize();
  async function move(direction) {
    if (busy || disposed || ![-1, 1].includes(direction)) return;
    busy = true;
    publish();
    try {
      await ready;
      await enqueue(async () => {
        await readTabs();
        if (disposed || tabs.length < 2) return;
        const index = tabs.findIndex(tab => tab.id === selectedId);
        const target = tabs[(Math.max(0, index) + direction + tabs.length) % tabs.length];
        await browser.tabs.update(target.id, { active: true });
        await readTabs();
      });
    } catch { report(); }
    finally { busy = false; publish(); }
  }
  function dispose() {
    disposed = true;
    for (const unsubscribe of subscriptions) unsubscribe();
  }
  return { ready, refresh, move, dispose };
}
