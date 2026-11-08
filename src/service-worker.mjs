import { EMBED_RULE_ID, embedRules } from './sidebar-protocol.mjs';

let configuring;
function configureSidebar() {
  if (!configuring) {
    configuring = Promise.all([
      // Handle the action ourselves so Chrome grants activeTab before opening
      // the panel. The automatic side-panel action skips that permission grant.
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [EMBED_RULE_ID],
        addRules: embedRules(chrome.runtime.id)
      })
    ]).catch(error => {
      configuring = null;
      throw error;
    });
  }
  return configuring;
}

chrome.runtime.onInstalled.addListener(() => {
  void configureSidebar().catch(error => console.error('Sidebar setup failed:', error));
});
chrome.runtime.onStartup.addListener(() => {
  void configureSidebar().catch(error => console.error('Sidebar setup failed:', error));
});
chrome.action.onClicked.addListener(tab => {
  if (Number.isInteger(tab.windowId)) {
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(error => console.error('Could not open sidebar:', error));
  }
  void chrome.runtime.sendMessage({ type: 'keywords.refresh', tabId: tab.id }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'sidebar.initialize' || sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('index.html')) return false;
  configureSidebar().then(
    () => respond({ ok: true }),
    () => respond({ ok: false, error: 'The sidebar could not start. Reload the extension and try again.' })
  );
  return true;
});

void configureSidebar().catch(error => console.error('Sidebar setup failed:', error));
