// Briefly reveal native history when it is unmounted or hidden, then restore it.
(() => {
  const pinnedName = /^(?:pinned(?:[\s_-]+(?:chats|conversations|history|section))?|置顶|已置顶)$/i;
  function isPinned(link) {
    if (link.closest?.('[data-pinned="true"], [data-pinned="1"], [data-is-pinned="true"], [data-testid="pinned-chat"], [data-testid="pinned-conversation"], [data-testid="pinned-chats"]')) return true;
    const row = link.closest?.('li, [role="listitem"], [data-testid^="history-item-"], [data-testid="conversation-item"], [data-chat-id]') || link;
    if (row.querySelector?.('[aria-label="Unpin"], [aria-label^="Unpin " i], [title="Unpin"], [title^="Unpin " i], [aria-label="取消置顶"]')) return true;
    const marker = row.querySelector?.('[data-testid="pin-icon"], [data-icon="pin"], [data-lucide="pin"], .lucide-pin, [aria-label="Pinned"]');
    // A Pin action offered in a menu does not mean the conversation is pinned.
    if (marker && !marker.closest?.('button, [role="button"], [role="menu"], [role="menuitem"]')) return true;
    // Inspect section labels, never the chat title (a chat can be named Pinned).
    const headingSelector = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
    for (let node = link; node; node = node.parentElement) {
      if (node !== link && ['aria-label', 'data-testid', 'id'].some(key => pinnedName.test(node.getAttribute?.(key) || ''))) return true;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        const heading = sibling.matches?.(headingSelector) ? sibling
          : !sibling.querySelector?.('a[href]') && sibling.querySelector?.(headingSelector);
        if (heading) return pinnedName.test(heading.textContent.trim());
      }
      if (node.matches?.('nav, aside, body')) break;
    }
    return false;
  }
  function regularHistory(links, conversation) {
    const pinnedUrls = [...new Set(links.filter(isPinned).map(link => conversation(link.href)).filter(Boolean))];
    const pinned = new Set(pinnedUrls);
    return { links: links.filter(link => !pinned.has(conversation(link.href))), pinnedUrls };
  }
  const visible = node => {
    if (!node?.isConnected || node.closest('[hidden], [inert], [aria-hidden="true"]') || !node.getClientRects().length || getComputedStyle(node).visibility === 'hidden') return false;
    const rect = node.getBoundingClientRect?.();
    return !rect || rect.right > 0 && rect.left < (globalThis.innerWidth || Infinity);
  };
  function create({ document: doc = document, links, empty = () => false, fallbackControl = () => null, waitMs = 1500 }) {
    let tail = Promise.resolve();
    function control(opening) {
      return [...doc.querySelectorAll('button, [role="button"]')].find(node => {
        if (!visible(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
        const id = node.getAttribute('data-testid') || '';
        const names = [node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent].filter(Boolean).map(name => name.replace(/\s+/g, ' ').trim());
        if (id === (opening ? 'open-sidebar-button' : 'close-sidebar-button')) return true;
        if (names.some(name => opening ? /^(?:(?:open|expand|show) sidebar|展开侧边栏|打开侧边栏)(?:\s*(?:ctrl|cmd|command|control|[⌘⌃]).*)?$/i.test(name) : /^(?:(?:close|collapse|hide) sidebar|收起侧边栏|关闭侧边栏)(?:\s*(?:ctrl|cmd|command|control|[⌘⌃]).*)?$/i.test(name))) return true;
        return (id.includes('sidebar') || names.some(name => /sidebar|侧边栏/i.test(name))) && node.getAttribute('aria-expanded') === String(!opening);
      }) || fallbackControl(opening);
    }
    function withLinks(task, { canOpen = () => true, allowHidden = false } = {}) {
      const run = async () => {
        let opened = false;
        const initial = links(), restoreClosed = allowHidden && initial.length > 0 && !initial.some(visible);
        try {
          let found = links();
          if (!(allowHidden && found.length) && !found.some(visible) && !empty() && canOpen()) {
            const open = control(true);
            if (open) {
              open.click(); opened = true;
              const deadline = Date.now() + Math.min(4000, Math.max(0, waitMs));
              do {
                found = links();
                if (found.some(visible) || empty() || !canOpen()) break;
                await new Promise(resolve => setTimeout(resolve, 50));
              } while (Date.now() < deadline);
            }
          }
          return await task(links().filter(link => allowHidden ? link.isConnected : visible(link)));
        } finally {
          if (opened || restoreClosed && links().some(visible)) control(false)?.click();
        }
      };
      const result = tail.then(run, run); tail = result.catch(() => {}); return result;
    }
    return { withLinks };
  }
  globalThis.AiAgentSidebarHistory = Object.freeze({ create, isPinned, regularHistory });
})();
