export function createPageHighlights({ browser = globalThis.chrome } = {}) {
  const toggle = document.getElementById('highlight-keywords');
  const label = toggle.closest('.keyword-page-toggle');
  let target;
  let settings;
  let generation = 0;
  function say(text) {
    label.title = toggle.title = text || 'Highlight keywords on job web pages';
  }
  async function apply() {
    const run = ++generation;
    const tabId = target;
    if (!settings?.enabled) { say(''); return; }
    if (!settings.keywords.length) { say('Add keywords in Settings → Keyword highlights.'); return; }
    if (!Number.isInteger(target)) { say('Select a job web page to highlight.'); return; }
    try {
      const tab = await browser.tabs.get(tabId);
      if (run !== generation) return;
      if (tab.url && (!/^https?:\/\//.test(tab.url) || /^https?:\/\/([^/]+\.)?chatgpt\.com(?:\/|$)/i.test(tab.url))) {
        say('Highlighting applies to job web pages only.'); return;
      }
      await browser.scripting.executeScript({ target: { tabId },
        files: ['src/keyword-matcher.js', 'src/job-page-highlighter.js'] });
      const css = { target: { tabId }, files: ['src/job-highlights.css'] };
      await browser.scripting.removeCSS(css);
      await browser.scripting.insertCSS(css);
      if (run === generation) say('Keyword highlighting is on for this job page.');
    } catch {
      if (run === generation) say('Click the extension icon on this job page to allow highlighting.');
    }
  }
  const navigated = (tabId, change) => { if (tabId === target && change.status === 'complete') void apply(); };
  const invoked = (message, sender) => {
    if (sender.id === browser.runtime.id && message?.type === 'keywords.refresh' && message.tabId === target) void apply();
  };
  browser.tabs.onUpdated.addListener(navigated);
  browser.runtime.onMessage.addListener(invoked);
  window.addEventListener('pagehide', () => {
    browser.tabs.onUpdated.removeListener(navigated);
    browser.runtime.onMessage.removeListener(invoked);
  });
  return {
    setTarget({ tabId }) { if (tabId !== target) { target = tabId; return apply(); } },
    update(value) { settings = value; return apply(); }
  };
}
