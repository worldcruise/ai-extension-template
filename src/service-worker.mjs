import { EMBED_RULE_ID, DEEPSEEK_EMBED_RULE_ID, embedRules, deepseekEmbedRules } from './sidebar-protocol.mjs';
import { createJobExtractionService } from './job-extraction-service.mjs';
import { createReadPageCommands } from './read-page-commands.mjs';

const extractJob = createJobExtractionService();
const readPageCommands = createReadPageCommands();
const handleReadPageCommand = readPageCommands.handle;
chrome.commands.onCommand.addListener(handleReadPageCommand);

let configuring;
function configureSidebar() {
  if (!configuring) {
    configuring = Promise.all([
      // Handle the action ourselves so Chrome grants activeTab before opening
      // the panel. The automatic side-panel action skips that permission grant.
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [EMBED_RULE_ID, DEEPSEEK_EMBED_RULE_ID],
        addRules: [...embedRules(chrome.runtime.id), ...deepseekEmbedRules(chrome.runtime.id)]
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
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('index.html')) return false;
  if (message?.type === 'job.read-command.take' && Number.isInteger(message.windowId)) {
    respond({ ok: true, request: readPageCommands.take(message.windowId) });
    return false;
  }
  if (message?.type === 'job.extract' && typeof message.requestId==='string' && /^[\w-]{1,100}$/.test(message.requestId)) {
    extractJob(message.tabId).then(
      result => respond({ok:true,requestId:message.requestId,...result}),
      error => respond({ok:false,requestId:message.requestId,error:{code:error.code || 'extraction-failed',message:error.message || 'Could not read this job page. Try again.'}})
    );
    return true;
  }
  if (message?.type !== 'sidebar.initialize') return false;
  configureSidebar().then(
    () => respond({ ok: true }),
    () => respond({ ok: false, error: 'The sidebar could not start. Reload the extension and try again.' })
  );
  return true;
});

void configureSidebar().catch(error => console.error('Sidebar setup failed:', error));
