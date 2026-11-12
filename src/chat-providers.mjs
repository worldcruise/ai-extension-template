export const DEEPSEEK_HOME = 'https://chat.deepseek.com/';
export const PROVIDER_KEY = 'chatProvider';
export const normalizeProvider = value => value === 'deepseek' ? 'deepseek' : 'chatgpt';

// Keep both providers mounted; selecting one never navigates the other frame.
export function createChatProviders({ beforeChange = async () => {}, onSelect = () => {}, onChange = () => {}, browser = chrome, document: doc = document, lazy = false }) {
  const select = doc.getElementById('chat-provider');
  const settingsSelect = doc.getElementById('workflow-provider');
  const dockSelect = doc.getElementById('dock-chat-provider');
  const selectors = [select, settingsSelect, dockSelect].filter(Boolean);
  const status = doc.getElementById('provider-status');
  const dockStatus = doc.getElementById('dock-provider-status');
  const frame = doc.getElementById('deepseek-frame');
  let provider = 'chatgpt', touched = false, changing = false;
  function render(value) {
    provider = normalizeProvider(value);
    for (const control of selectors) control.value = provider;
    doc.getElementById('provider-sign-in-label').textContent = `Sign in to ${provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT'}`;
    doc.getElementById('chatgpt-pane').hidden = provider !== 'chatgpt';
    doc.getElementById('deepseek-pane').hidden = provider !== 'deepseek';
    if(!lazy || !doc.getElementById('chat-view')?.hidden) ensureCurrent();
    onChange(provider);
  }
  function ensureCurrent() { if(provider==='deepseek'&&!frame.getAttribute('src'))frame.src=DEEPSEEK_HOME; }
  function report(message = '') {
    status.textContent = message;
    if (dockStatus) dockStatus.textContent = message;
    if (dockSelect) dockSelect.title = message || 'Choose AI chat provider';
  }
  async function choose(value, { persist = true, guard = true, reveal = false, source = null } = {}) {
    if (changing) return;
    changing = true; for (const control of selectors) control.disabled = true;
    try {
      if (guard) await beforeChange();
      render(value);
      report();
      if (reveal) onSelect(provider, source);
      if (persist) {
        try { await browser.storage.local.set({ [PROVIDER_KEY]: provider }); }
        catch { report('Provider changed for this panel; preference could not be saved.'); }
      }
    } catch (error) { for (const control of selectors) control.value = provider; report(error.message || 'Could not switch provider.'); }
    finally {
      changing = false; for (const control of selectors) control.disabled = false;
      if (source === 'dock') dockSelect?.focus?.({ preventScroll: true });
    }
  }
  select.addEventListener('change', () => { touched = true; void choose(select.value, { reveal: true, source: 'menu' }); });
  dockSelect?.addEventListener('change', () => { touched = true; void choose(dockSelect.value, { reveal: true, source: 'dock' }); });
  settingsSelect?.addEventListener('change', () => { touched = true; void choose(settingsSelect.value); });
  doc.getElementById('deepseek-open').addEventListener('click', () => {
    void browser.tabs.create({ url: DEEPSEEK_HOME }).catch(() => { status.textContent = 'Could not open DeepSeek in a tab.'; });
  });
  render('chatgpt');
  const ready = browser.storage.local.get(PROVIDER_KEY).then(saved => {
    if (!touched) return choose(saved[PROVIDER_KEY], { persist: false, guard: false });
  }).catch(() => {});
  return { ready, current: () => provider, ensureCurrent,
    showProvider: value => { touched = true; return choose(value); },
    showChatGPT: () => { touched = true; return choose('chatgpt', { guard: false }); } };
}
