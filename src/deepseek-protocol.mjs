export const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com';
export const DEEPSEEK_CHANNEL = 'ai-agent-template.deepseek';
export function deepseekRoute(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.origin !== DEEPSEEK_ORIGIN || url.username || url.password || !/^\/(?:a\/chat\/[\w-]+)?\/?$/.test(url.pathname)) return null;
    return url.origin + url.pathname;
  } catch { return null; }
}
export const deepseekConversation = value => {
  const url = deepseekRoute(value);
  return url?.includes('/a/chat/') ? url : null;
};
export const deepseekRoutes = { conversation: deepseekConversation,
  target(urls = [], current, direction) {
    if (![-1, 1].includes(direction)) return null;
    if (!deepseekConversation(current)) return direction === 1 ? urls[0] || null : null;
    const index = urls.indexOf(deepseekConversation(current));
    return index < 0 ? null : urls[index + direction] || null;
  }
};
export function deepseekState(event, source, nonce) {
  const data = event.data;
  if (!nonce || event.source !== source || event.origin !== DEEPSEEK_ORIGIN || data?.channel !== DEEPSEEK_CHANNEL || data.nonce !== nonce || data.type !== 'state') return null;
  if (!deepseekRoute(data.url) || !['ready', 'hasDraft', 'busy'].every(key => typeof data[key] === 'boolean') || !Array.isArray(data.chats) || data.chats.length > 300 ||
      data.chats.some(chat => !deepseekConversation(chat?.url) || typeof chat.title !== 'string' || chat.title.length > 200)) return null;
  const chats = [...new Map(data.chats.map(chat => [deepseekConversation(chat.url), { url: deepseekConversation(chat.url), title: chat.title }])).values()];
  return { currentUrl: deepseekRoute(data.url), chats, urls: chats.map(chat => chat.url), loaded: true, ready: data.ready,
    hasDraft: data.hasDraft, busy: data.busy };
}
