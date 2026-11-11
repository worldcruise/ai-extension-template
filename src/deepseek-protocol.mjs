import './deepseek-routes.js';

export const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com';
export const DEEPSEEK_CHANNEL = 'ai-agent-template.deepseek';

// The page offers a dedicated port. No host window messages are sent to an
// unloaded iframe, its initial extension-origin document, or a redirect page.
export function createDeepseekTransport({ frame, onData, onConnect }) {
  let port;
  function close() {
    if (!port) return;
    port.onmessage = null; port.onmessageerror = null; port.close(); port = null;
  }
  return {
    accept(event) {
      if (event.source !== frame.contentWindow || event.origin !== DEEPSEEK_ORIGIN || event.data?.channel !== DEEPSEEK_CHANNEL ||
          event.data.type !== 'hello' || event.ports?.length !== 1) return false;
      close();
      const next = event.ports[0]; port = next;
      next.onmessage = message => { if (port === next) onData(message.data); };
      next.onmessageerror = () => { if (port === next) close(); };
      next.start(); onConnect(); return true;
    },
    send(data) {
      if (!port) return false;
      try { port.postMessage(data); return true; }
      catch { close(); return false; }
    },
    close
  };
}
export const deepseekRoutes = globalThis.AiAgentDeepseekRoutes;
export const deepseekRoute = deepseekRoutes.route;
export const deepseekConversation = deepseekRoutes.conversation;
export function deepseekState(event, source, nonce) {
  const data = event.data;
  if (!nonce || event.source !== source || event.origin !== DEEPSEEK_ORIGIN || data?.channel !== DEEPSEEK_CHANNEL || data.nonce !== nonce || data.type !== 'state') return null;
  if (!deepseekRoute(data.url) || !['ready', 'hasDraft', 'busy'].every(key => typeof data[key] === 'boolean') || !Array.isArray(data.chats) || data.chats.length > 300 ||
      data.chats.some(chat => !deepseekConversation(chat?.url) || typeof chat.title !== 'string' || chat.title.length > 200)) return null;
  const chats = [...new Map(data.chats.map(chat => [deepseekConversation(chat.url), { url: deepseekConversation(chat.url), title: chat.title }])).values()];
  if (data.loaded !== undefined && typeof data.loaded !== 'boolean') return null;
  if (data.pinnedUrls !== undefined && (!Array.isArray(data.pinnedUrls) || data.pinnedUrls.length > 300 || data.pinnedUrls.some(url => !deepseekConversation(url)))) return null;
  const pinnedUrls = [...new Set((data.pinnedUrls || []).map(deepseekConversation))];
  const regular = chats.filter(chat => !pinnedUrls.includes(chat.url));
  return { currentUrl: deepseekRoute(data.url), chats: regular, urls: regular.map(chat => chat.url), pinnedUrls, loaded: data.loaded !== false, ready: data.ready,
    hasDraft: data.hasDraft, busy: data.busy };
}
