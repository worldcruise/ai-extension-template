import './workspace-shortcut-keys.js';

export const READ_PAGE_COMMAND = 'read-job-page';
const readPageDescription = 'Read company, job title, URL, and Job Description from this tab';

export function ariaShortcut(shortcut) {
  const aliases = { Ctrl: 'Control', MacCtrl: 'Control', Command: 'Meta', Option: 'Alt' };
  return shortcut.replaceAll('⌘', 'Meta+').replaceAll('⌃', 'Control+')
    .replaceAll('⇧', 'Shift+').replaceAll('⌥', 'Alt+')
    .split('+').filter(Boolean).map(key => aliases[key] || key).join('+');
}

export async function readPageShortcut(browser = globalThis.chrome) {
  const keys = browser.runtime.getManifest().commands[READ_PAGE_COMMAND].suggested_key;
  const [commands, platform] = await Promise.allSettled([
    browser.commands.getAll(), browser.runtime.getPlatformInfo()
  ]);
  const defaultShortcut = typeof keys === 'string' ? keys : platform.status === 'fulfilled'
    ? keys[platform.value.os] || keys.default
    : `${keys.default} (${keys.mac} on macOS)`;
  const shortcut = commands.status === 'fulfilled'
    ? commands.value.find(command => command.name === READ_PAGE_COMMAND)?.shortcut || '' : '';
  return { shortcut, defaultShortcut, state: commands.status === 'rejected' ? 'unknown' : shortcut ? 'assigned' : 'unassigned' };
}

export function updateReadPageHint(button, result) {
  if (result !== undefined) button.dataset.readResult = result;
  button.title = `${readPageDescription}${button.dataset.shortcut ? ` (${button.dataset.shortcut})` : ''}.` +
    (button.dataset.readResult ? `\n${button.dataset.readResult}` : '');
}

export function createShortcutSettings({ browser = globalThis.chrome, root = document, events = window } = {}) {
  const q = selector => root.querySelector(selector);
  const button = q('#read-page') || q('#read-page-shortcut');
  const status = q('#shortcut-settings-status');
  q('#workspace-shortcut-list').replaceChildren(...globalThis.AiAgentWorkspaceKeys.bindings.flatMap(binding => {
    const label = root.createElement('dt'); label.textContent = binding.label;
    const value = root.createElement('dd');
    const key = root.createElement('kbd'); key.textContent = binding.shortcut;
    value.append(key); return [label, value];
  }));
  let revision = 0;
  let disposed = false;
  async function refresh() {
    const current = ++revision;
    const binding = await readPageShortcut(browser);
    if (disposed || current !== revision) return;
    q('#read-page-shortcut').textContent = binding.state === 'unknown' ? 'Unknown' : binding.shortcut || 'Not assigned';
    q('#read-page-shortcut-default').textContent = binding.defaultShortcut;
    button.dataset.shortcut = binding.shortcut;
    if (binding.shortcut) button.setAttribute('aria-keyshortcuts', ariaShortcut(binding.shortcut));
    else button.removeAttribute('aria-keyshortcuts');
    updateReadPageHint(button);
    status.textContent = binding.state === 'unknown' ? 'Could not read Chrome’s shortcut assignments. Open shortcut settings to check.'
      : binding.state === 'unassigned' ? 'Read page has no shortcut assigned in Chrome. Choose Change shortcut to set one.'
      : 'Current assignment from Chrome. Changes refresh when you return to the sidebar.';
  }
  async function open() {
    try { await browser.tabs.create({ url: 'chrome://extensions/shortcuts' }); }
    catch { status.textContent = 'Could not open shortcut settings. Open chrome://extensions/shortcuts in a new tab.'; }
  }
  const onRefresh = () => { void refresh(); };
  q('#shortcut-settings-open').addEventListener('click', open);
  q('#shortcut-settings-refresh').addEventListener('click', onRefresh);
  events.addEventListener('focus', onRefresh);
  events.addEventListener('pagehide', () => {
    disposed = true;
    events.removeEventListener('focus', onRefresh);
  }, { once: true });
  return { refresh, ready: refresh() };
}
