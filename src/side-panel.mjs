import { ProtocolError } from './protocol.mjs';

export function installSidePanel(browser, onOpened = () => {}) {
  browser.action.onClicked.addListener(tab => {
    if (!Number.isInteger(tab.windowId) || tab.windowId < 0) return;
    // Open synchronously from the action's user gesture, before any async work.
    browser.sidePanel.open({ windowId: tab.windowId }).then(onOpened).catch(() => {});
  });
}

export function isAgentSender(browser, sender, pageUrl) {
  return sender.id === browser.runtime.id && sender.url === pageUrl;
}

export async function panelWindow(browser, sender, pageUrl, ownWindowId) {
  if (!isAgentSender(browser, sender, pageUrl)) throw new ProtocolError('browser_window_unavailable');
  if (Number.isInteger(sender.tab?.windowId) && sender.tab.windowId >= 0) return sender.tab.windowId;
  // Chrome supplies neither sender.tab nor sender.documentId for native panels.
  // The exact trusted packaged page gets its own window through windows.getCurrent();
  // BrowserTabs checks that this is still an available normal browser window.
  if (Number.isInteger(ownWindowId) && ownWindowId >= 0) return ownWindowId;
  throw new ProtocolError('browser_window_unavailable');
}
