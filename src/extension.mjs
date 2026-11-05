import { mountAgent } from './agent-shell.mjs';
import { agentDefinition } from './agent-definition.mjs';
import { call, extensionAdapter, errorMessage } from './extension-adapter.mjs';

const ui = mountAgent(document.querySelector('#agent'), {
  definition: agentDefinition, adapter: extensionAdapter(),
  navigation: {
    async status() { const { id: windowId } = await chrome.windows.getCurrent(); return call('browser.status', { windowId }); },
    async move(direction) { const { id: windowId } = await chrome.windows.getCurrent(); return call('browser.move', { direction, windowId }); },
  },
});
let refreshing = false, disposed = false;
async function refresh() {
  if (refreshing || disposed) return;
  refreshing = true;
  try {
    await ui.controller.refreshSession(); await ui.refreshNavigation();
  } catch (error) { if (!disposed && error.code !== 'cancelled' && !ui.controller.state.busy) ui.controller.status('error', error.message || errorMessage(error)); }
  finally { refreshing = false; }
}
const changed = message => { if (message?.type === 'agent.changed') void refresh(); };
chrome.runtime.onMessage.addListener(changed);
window.addEventListener('focus', refresh);
const interval = setInterval(refresh, 15000);
window.addEventListener('pagehide', () => { disposed = true; clearInterval(interval); window.removeEventListener('focus', refresh); chrome.runtime.onMessage.removeListener(changed); ui.destroy(); }, { once: true });
await ui.ready; await refresh();
