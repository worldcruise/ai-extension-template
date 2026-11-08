// Keep the latest shortcut per window until its panel is ready. Notifications
// alone would be lost when the shortcut opens a previously closed sidebar.
export function createReadPageCommands(browser = chrome, now = Date.now) {
  const pending = new Map();
  function take(windowId) {
    const request = pending.get(windowId);
    pending.delete(windowId);
    return request && now() - request.createdAt < 30000 ? request : null;
  }
  function handle(command, tab) {
    if (command !== 'read-job-page' || !Number.isInteger(tab?.id) || tab.id < 0 ||
        !Number.isInteger(tab.windowId) || tab.windowId < 0) return;
    // Prune abandoned requests without timers that keep the worker alive.
    for (const [windowId, request] of pending) {
      if (now() - request.createdAt >= 30000) pending.delete(windowId);
    }
    const request = { tabId: tab.id, windowId: tab.windowId, createdAt: now() };
    pending.set(tab.windowId, request);
    // Call synchronously in onCommand to retain Chrome's user gesture.
    return browser.sidePanel.open({ windowId: tab.windowId }).then(() =>
      browser.runtime.sendMessage({ type: 'job.read-requested', windowId: tab.windowId }).catch(() => {})
    ).catch(error => {
      if (pending.get(tab.windowId) === request) pending.delete(tab.windowId);
      console.error('Could not open Resume Studio:', error);
    });
  }
  return { handle, take };
}
