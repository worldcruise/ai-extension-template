import { DirectClient } from './direct-client.mjs';
import { AgentRuntime } from './agent-runtime.mjs';
import { BrowserTabs } from './browser-tabs.mjs';
import { ProtocolError } from './protocol.mjs';
import { installSidePanel, isAgentSender, panelWindow } from './side-panel.mjs';

const pageUrl = chrome.runtime.getURL('index.html');
const client = new DirectClient({ browser: chrome });
const changed = () => chrome.runtime.sendMessage({ type: 'agent.changed' }).catch(() => {});
const runtime = new AgentRuntime(client, changed);
const contexts = () => chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [pageUrl] });
const navigation = new BrowserTabs(chrome, chrome.storage.session, async () => (await contexts()).map(context => context.tabId));
const initialized = client.auth.ready;
installSidePanel(chrome, changed);
for (const event of [chrome.tabs.onActivated, chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onMoved, chrome.windows.onRemoved]) event.addListener(changed);
chrome.tabs.onRemoved.addListener(tabId => { if(client.auth.pending?.tabId===tabId)void client.auth.finish('authorization_cancelled').finally(changed); });
chrome.alarms.onAlarm.addListener(alarm => { if(alarm.name==='chatgpt-agent.authorization'&&client.auth.pending)void client.auth.finish('authorization_timeout').finally(changed); });

async function handle(message, sender) {
  await initialized;
  switch (message.type) {
    case 'agent.session': return (await runtime.verify()).session || null;
    case 'agent.connection': return runtime.verify();
    case 'agent.connect': { const result = await runtime.connect(); changed(); return result; }
    case 'agent.disconnect': try { return await runtime.disconnect(); } finally { changed(); }
    case 'agent.models': { const result = await runtime.models(message.accountId); changed(); return result; }
    case 'agent.cancel': runtime.cancel(message.requestId); return {};
    case 'agent.run': {
      const response = await runtime.request('/v1/run', {
        agentId: message.agentId, prompt: message.prompt, input: message.input,
        accountId: message.accountId, model: message.model,
        ...(message.thinkingEffort ? { thinkingEffort: message.thinkingEffort } : {}),
      }, { requestId: message.requestId });
      if (response.error || response.report?.error) throw new ProtocolError(response.error?.code || response.report.error.code);
      if (typeof response.text === 'string') return { text: response.text };
      if (Object.hasOwn(response, 'data')) return { data: response.data };
      throw new ProtocolError('invalid_agent_response');
    }
    case 'browser.status': { const { available, count } = await navigation.state(await panelWindow(chrome, sender, pageUrl, message.windowId)); return { available, count }; }
    case 'browser.move': return navigation.move(message.direction, await panelWindow(chrome, sender, pageUrl, message.windowId));
    default: throw new ProtocolError('invalid_request');
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'auth.callback') {
    client.auth.callback(message.query,sender).then(()=>{changed();sendResponse({ok:true,data:{connected:true}});},error=>{changed();sendResponse({ok:false,error:{code:typeof error.code==='string'&&/^[A-Za-z_]{1,80}$/.test(error.code)?error.code:'authorization_failed'}});});
    return true;
  }
  if (!isAgentSender(chrome, sender, pageUrl) || typeof message?.type !== 'string' || message.type === 'agent.changed') return;
  handle(message, sender).then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: {
    code: typeof error.code === 'string' && /^[A-Za-z_]{1,80}$/.test(error.code) ? error.code : 'agent_request_failed',
    ...(Number.isInteger(error.status) ? { status: error.status } : {}),
  } }));
  return true;
});
