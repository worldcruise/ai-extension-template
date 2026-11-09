// Shared by the sidebar and its isolated ChatGPT frame adapter.
(() => {
  if (globalThis.AiAgentWorkspaceKeys) return;
  const bindings = Object.freeze([
    { key: 'ArrowUp', shortcut: 'Ctrl+Up', action: 'view.studio', label: 'Open Resume Studio', target: 'studio-tab' },
    { key: 'ArrowDown', shortcut: 'Ctrl+Down', action: 'view.chat', label: 'Open Chat', target: 'chat-tab' },
    { key: 'ArrowLeft', shortcut: 'Ctrl+Left', action: 'tab.previous', label: 'Previous browser tab', target: 'previous-job' },
    { key: 'ArrowRight', shortcut: 'Ctrl+Right', action: 'tab.next', label: 'Next browser tab', target: 'next-job' },
    { key: 'Enter', shortcut: 'Ctrl+Enter', action: 'queue.add', label: 'Add, copy prompt and send in a new Sidebar Chat', target: 'add-request' }
  ].map(Object.freeze));
  const isAction = action => bindings.some(binding => binding.action === action);
  function action(event) {
    if (event.isTrusted !== true || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
        event.isComposing || event.keyCode === 229 || event.repeat) return null;
    return bindings.find(binding => binding.key === event.key)?.action || null;
  }
  globalThis.AiAgentWorkspaceKeys = Object.freeze({ bindings, isAction, action });
})();
