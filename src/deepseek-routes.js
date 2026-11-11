// Shared by the host and isolated content script so route validation cannot drift.
(() => {
  const origin = 'https://chat.deepseek.com';
  function route(value) {
    if (typeof value !== 'string' || value.length > 2000) return null;
    try {
      const url = new URL(value);
      if (url.origin !== origin || url.username || url.password || !/^\/(?:a\/chat\/s\/[\w-]+)?\/?$/.test(url.pathname)) return null;
      return origin + (url.pathname.replace(/\/$/, '') || '/');
    } catch { return null; }
  }
  const conversation = value => { const url = route(value); return url?.includes('/a/chat/s/') ? url : null; };
  function target(urls = [], current, direction, pinnedUrls = []) {
    if (![-1, 1].includes(direction) || !route(current)) return null;
    const pinned = new Set(pinnedUrls.map(conversation).filter(Boolean));
    urls = urls.filter(url => !pinned.has(conversation(url)));
    if (!conversation(current) || pinned.has(conversation(current))) return direction === 1 ? urls[0] || null : null;
    const index = urls.indexOf(conversation(current));
    return index < 0 ? null : urls[index + direction] || null;
  }
  globalThis.AiAgentDeepseekRoutes = Object.freeze({ route, conversation, target });
})();
