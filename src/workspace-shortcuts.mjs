import './workspace-shortcut-keys.js';

export function createWorkspaceShortcuts({ selectView, selectJob, root = document, events = window }) {
  const keys = globalThis.AiAgentWorkspaceKeys;
  const q = selector => root.querySelector(selector);
  const held = new Set();
  function available(action) {
    if (!keys.isAction(action) || q('dialog[open]')) return false;
    return action.startsWith('view.') || !q('#studio-view').hidden || !q('#chat-view').hidden;
  }
  function run(action) {
    if (!available(action)) return false;
    if (action === 'view.studio' || action === 'view.chat') {
      const view = action === 'view.studio' ? 'studio' : 'chat';
      selectView(view);
      const target = view === 'chat' ? q('#chat-view .provider-pane:not([hidden]) iframe') : q('#results-tab');
      target?.focus({ preventScroll: true });
    } else if (action === 'queue.add') {
      if (!q('#add-request').disabled) {
        selectView('studio'); selectJob();
        q('#add-request').click();
      }
    } else {
      const control = q(action === 'tab.previous' ? '#previous-job' : '#next-job');
      if (!control.disabled) control.click();
    }
    return true;
  }
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  function keydown(event) {
    const key = event.code || event.key;
    if (event.repeat && held.has(key)) { consume(event); return; }
    const action = keys.action(event);
    if (!action || !available(action)) { if (!event.repeat) held.delete(key); return; }
    held.add(key); consume(event); run(action);
  }
  function keyup(event) { if (event.isTrusted && held.delete(event.code || event.key)) consume(event); }
  for (const binding of keys.bindings) {
    const control = root.getElementById(binding.target);
    control.setAttribute('aria-keyshortcuts', `Control+${binding.key}`);
    control.title = `${control.title || control.textContent.trim()} (${binding.shortcut})`;
  }
  events.addEventListener('keydown', keydown, true);
  events.addEventListener('keyup', keyup, true);
  return { run, dispose() {
    events.removeEventListener('keydown', keydown, true);
    events.removeEventListener('keyup', keyup, true);
    held.clear();
  } };
}
