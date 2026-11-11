export const DEEPSEEK_HOME = 'https://chat.deepseek.com/';
export const PROVIDER_KEY = 'chatProvider';
export const normalizeProvider = value => value === 'deepseek' ? 'deepseek' : 'chatgpt';

// Keep both providers mounted; selecting one never navigates the other frame.
export function createChatProviders({ beforeChange, onSelect = () => {}, browser = chrome, document: doc = document }) {
  const select = doc.getElementById('chat-provider');
  const status = doc.getElementById('provider-status');
  const frame = doc.getElementById('deepseek-frame');
  let provider = 'chatgpt', touched = false, changing = false;
  function render(value) {
    provider = normalizeProvider(value);
    select.value = provider;
    const label = doc.getElementById('dock-chat-label');
    if (label) label.textContent = provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT';
    doc.getElementById('provider-sign-in-label').textContent = `Sign in to ${provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT'}`;
    doc.getElementById('chatgpt-pane').hidden = provider !== 'chatgpt';
    doc.getElementById('deepseek-pane').hidden = provider !== 'deepseek';
    if (provider === 'deepseek' && !frame.getAttribute('src')) frame.src = DEEPSEEK_HOME;
  }
  async function choose(value, { persist = true, guard = true, reveal = false } = {}) {
    if (changing) return;
    changing = true; select.disabled = true;
    try {
      if (guard) await beforeChange();
      render(value);
      status.textContent = '';
      if (reveal) onSelect(provider);
      if (persist) {
        try { await browser.storage.local.set({ [PROVIDER_KEY]: provider }); }
        catch { status.textContent = 'Provider changed for this panel; preference could not be saved.'; }
      }
    } catch (error) { select.value = provider; status.textContent = error.message || 'Could not switch provider.'; }
    finally { changing = false; select.disabled = false; }
  }
  select.addEventListener('change', () => { touched = true; void choose(select.value, { reveal: true }); });
  doc.getElementById('deepseek-open').addEventListener('click', () => {
    void browser.tabs.create({ url: DEEPSEEK_HOME }).catch(() => { status.textContent = 'Could not open DeepSeek in a tab.'; });
  });
  render('chatgpt');
  const ready = browser.storage.local.get(PROVIDER_KEY).then(saved => {
    if (!touched) return choose(saved[PROVIDER_KEY], { persist: false, guard: false });
  }).catch(() => {});
  return { ready, current: () => provider,
    showProvider: value => { touched = true; return choose(value); },
    showChatGPT: () => { touched = true; return choose('chatgpt', { guard: false }); } };
}
