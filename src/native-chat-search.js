// Search only through the provider's visible search input. Never touch a composer.
(() => {
  const visible = node => node?.isConnected && node.getClientRects().length && !node.closest('[hidden],[inert]') && getComputedStyle(node).visibility !== 'hidden';
  const names = node => [node.getAttribute('aria-label'), node.getAttribute('title'), node.innerText, node.textContent].filter(Boolean).map(name => name.replace(/\s+/g, ' ').trim());
  const searchName = /^(?:search(?: chats?| conversations?| history)?|搜索(?:聊天|对话|历史记录)?)(?:\s*(?:(?:ctrl|cmd|command|control)\s*\+?\s*k|[⌘⌃]\s*k))?$/i;
  function searchInput() {
    return [...document.querySelectorAll('input')].find(node => visible(node) && !node.disabled && !node.readOnly &&
      !['password', 'email', 'file', 'hidden'].includes(node.type) && !node.matches('#prompt-textarea, [name="prompt"], [data-composer-markdown]') &&
      (node.hasAttribute('cmdk-input') || /search|搜索/i.test([node.getAttribute('placeholder'), node.getAttribute('aria-label'), node.getAttribute('data-testid')].filter(Boolean).join(' '))) &&
      (node.closest('dialog, [role="dialog"], [cmdk-root]') || node.type === 'search' || node.getAttribute('role') === 'combobox' ||
        /search (?:chats?|conversations?|history)|搜索(?:聊天|对话|历史记录)/i.test(node.getAttribute('placeholder') || '')));
  }
  function control() {
    return [...document.querySelectorAll('button, a, [role="button"]')].find(node => visible(node) && !node.matches(':disabled,[aria-disabled="true"]') &&
      (names(node).some(name => searchName.test(name)) || ['search-chats-button', 'search-chat-button', 'search-history-button'].includes(node.getAttribute('data-testid'))));
  }
  async function waitInput(ms) {
    const until = Date.now() + ms;
    do { const input = searchInput(); if (input) return input; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < until);
    return null;
  }
  globalThis.AiAgentNativeSearch = async ({ query = '', provider = 'chatgpt' } = {}) => {
    if (typeof query !== 'string' || query.length > 1000) return false;
    let input = searchInput();
    if (!input) {
      let search = control();
      if (!search) {
        const open = [...document.querySelectorAll('button, [role="button"]')].find(node => visible(node) && !node.disabled &&
          (node.getAttribute('data-testid') === 'open-sidebar-button' || names(node).some(name => /^(?:open sidebar|expand sidebar|打开侧边栏|展开侧边栏)$/i.test(name))));
        if (open) {
          open.click();
          const deadline = Date.now() + 700;
          do { search = control(); if (search) break; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
        }
      }
      if (search) { search.click(); input = await waitInput(1000); }
      // ChatGPT documents Ctrl/Cmd+K. Use it when the layout hides or renames Search.
      // Verify the native input appeared; dispatch alone never counts as success.
      if (!input && provider === 'chatgpt') {
        const mac = /Mac|iPhone|iPad/i.test(globalThis.navigator?.platform || '');
        const target = document.activeElement || document.body || document;
        for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, {
          key: 'k', code: 'KeyK', keyCode: 75, which: 75, ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true
        }));
        input = await waitInput(1000);
      }
    }
    if (!input?.isConnected || !visible(input)) return false;
    input.focus();
    if (query) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(input, query);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: query }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 80));
      const current = searchInput();
      if (!current || current.value !== query) return false;
      current.focus();
    }
    return true;
  };
})();
