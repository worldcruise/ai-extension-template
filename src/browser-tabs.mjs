import { ProtocolError } from './protocol.mjs';

// Only Chrome tab/window IDs are used. Navigating never changes agent state.
export class BrowserTabs {
  constructor(browser, storage, excludedTabs = async () => []) {
    this.browser = browser; this.storage = storage; this.excludedTabs = excludedTabs;
    this.queue = Promise.resolve();
  }
  async bind(windowId) {
    if (!Number.isInteger(windowId)) throw new ProtocolError('browser_window_unavailable');
    const window = await this.browser.windows.get(windowId);
    if (window.type !== 'normal') throw new ProtocolError('browser_window_unavailable');
    await this.storage.set({ associatedBrowserWindow: windowId });
  }
  async state(windowId) {
    if (windowId === undefined) ({ associatedBrowserWindow: windowId } = await this.storage.get('associatedBrowserWindow'));
    if (!Number.isInteger(windowId)) return { available: false, count: 0 };
    try {
      const window = await this.browser.windows.get(windowId);
      if (window.type !== 'normal') return { available: false, count: 0 };
      const excluded = new Set(await this.excludedTabs());
      const tabs = (await this.browser.tabs.query({ windowId }))
        .filter(tab => Number.isInteger(tab.id) && !excluded.has(tab.id)).sort((a, b) => a.index - b.index);
      return { available: tabs.length > 0, count: tabs.length, windowId, tabs };
    } catch { return { available: false, count: 0 }; }
  }
  move(direction, windowId) {
    const operation = this.queue.catch(() => {}).then(async () => {
      if (![-1, 1].includes(direction)) throw new ProtocolError('invalid_request');
      const state = await this.state(windowId);
      if (!state.available) throw new ProtocolError('browser_window_unavailable');
      if (state.count === 1) return { count: 1, message: 'Only one browser tab is open.' };
      const index = state.tabs.findIndex(tab => tab.active);
      // The extension itself may be the active tab in an ordinary window.
      const nextIndex = index < 0 ? (direction === 1 ? 0 : state.count - 1)
        : (index + direction + state.count) % state.count;
      const tab = state.tabs[nextIndex];
      try {
        await this.browser.tabs.update(tab.id, { active: true });
        await this.browser.windows.update(state.windowId, { focused: true });
      } catch { throw new ProtocolError('browser_window_unavailable'); }
      return { count: state.count, tabId: tab.id, message: `Browser tab ${nextIndex + 1} of ${state.count} selected.` };
    });
    this.queue = operation;
    return operation;
  }
}
