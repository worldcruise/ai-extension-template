// Both frames stay mounted while the bottom chat pane is collapsed.
export function createWorkspaceDock({ onOpen, onClose, onStudioChange, root = document }) {
  const q = selector => root.querySelector(selector);
  const toggle = q('#chat-dock-toggle'), pane = q('#chat-view');
  const bar = q('.dock-status-bar');
  // Cross-origin pages can call focus() inside their frame even when the host
  // container is inert. Return focus if a parked page tries to take it back.
  const restoreCollapsedFocus = () => queueMicrotask(() => {
    if (pane.hidden && pane.contains(root.activeElement)) {
      root.defaultView?.focus();
      toggle.focus({ preventScroll: true });
    }
  });
  root.addEventListener('focusin', restoreCollapsedFocus);
  root.defaultView?.addEventListener('blur', restoreCollapsedFocus);
  root.defaultView?.addEventListener('pagehide', () => {
    root.removeEventListener('focusin', restoreCollapsedFocus);
    root.defaultView.removeEventListener('blur', restoreCollapsedFocus);
  }, { once: true });
  function select(id) {
    const open = id === 'chat';
    // Save the job scroll position before hiding it for Settings. In the
    // workspace, one accordion owns the content area at a time.
    if (id === 'settings') onStudioChange?.(false);
    q('#settings-view').hidden = id !== 'settings';
    q('#studio-view').hidden = id === 'settings';
    if (id !== 'settings') onStudioChange?.(!open);
    if (!open && pane.contains(root.activeElement)) {
      root.defaultView?.focus();
      toggle.focus({ preventScroll: true });
    }
    pane.hidden = !open;
    pane.inert = !open;
    pane.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    root.body.classList.toggle('chat-dock-open', open);
    if (open) onOpen?.(); else onClose?.();
  }
  toggle.addEventListener('click', () => select(pane.hidden ? 'chat' : 'studio'));
  bar.addEventListener('click', event => {
    if (event.target.closest('button, a, input, select, #account-panel')) return;
    toggle.click(); toggle.focus();
  });
  return { select };
}
