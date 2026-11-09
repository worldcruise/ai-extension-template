// A normal ChatGPT page remains passive until this extension's workspace connects.
(() => {
  if (window !== window.top || !globalThis.AiAgentChatQueue || globalThis.AiAgentQueueTab) return;
  globalThis.AiAgentQueueTab = true;
  const owners = new Map();
  const adapter = AiAgentChatQueue.createPageAdapter(message => owners.get(message.operationId)?.port.postMessage(message));
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'ai-agent-resume-tab-v1' || port.sender?.id !== chrome.runtime.id || port.sender?.url !== chrome.runtime.getURL('index.html')) {
      port.disconnect(); return;
    }
    port.onMessage.addListener(message => {
      if (typeof message?.operationId !== 'string' || !/^[\w-]{1,100}$/.test(message.operationId)) return;
      const { operationId } = message;
      if (message.type === 'queue.authorize') {
        if (owners.get(operationId)?.port === port) adapter.authorize(operationId, message.allowed);
        return;
      }
      if (message.type !== 'queue.command' || owners.has(operationId) ||
          !['inspect', 'inspect-prepared', 'preflight', 'submit', 'recover'].includes(message.action)) return;
      owners.set(operationId, { port, action: message.action });
      adapter.execute(message.action, message.data, operationId).then(
        value => { if (owners.has(operationId)) port.postMessage({ type: 'queue.reply', operationId, ok: true, value }); },
        error => { if (owners.has(operationId)) port.postMessage({ type: 'queue.reply', operationId, ok: false,
          error: { code: error.code || 'chat-error', message: error.message.slice(0, 2000), diagnostics: error.diagnostics } }); }
      ).finally(() => owners.delete(operationId));
    });
    port.onDisconnect.addListener(() => {
      for (const [id, operation] of owners) if (operation.port === port) {
        if (['submit', 'recover'].includes(operation.action)) adapter.dispose();
        owners.delete(id);
      }
    });
  });
  window.addEventListener('pagehide', () => adapter.dispose());
})();
