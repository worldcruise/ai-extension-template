// Remember only a cookie choice the user explicitly makes in DeepSeek's banner.
// Never read, export, or modify authentication cookies.
(() => {
  const key = 'deepseekCookieChoice';
  const containers = 'dialog, [role="dialog"], [id*="cookie" i], [class*="cookie" i], [data-testid*="cookie" i]';
  const label = node => (node.getAttribute('aria-label') || node.textContent || node.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  function kind(value) {
    if (/^(?:accept all|allow all|accept all cookies|接受所有|全部接受|全部同意)$/i.test(value)) return 'accept-all';
    if (/^(?:reject all|reject|decline|decline all|reject all cookies|reject non-essential cookies|only necessary|necessary only|essential only|仅必要|拒绝所有|全部拒绝|拒绝)$/i.test(value)) return 'reject-optional';
    if (/^(?:accept|agree|i agree|接受|同意)$/i.test(value)) return 'accept';
    if (/^(?:got it|understood|ok|okay|知道了|明白了)$/i.test(value)) return 'dismiss';
    return null;
  }
  function create({ document: doc = document, browser = chrome, Observer = MutationObserver } = {}) {
    let choice, touched = false, disposed = false, timer;
    const handled = new WeakSet();
    const visible = node => node?.isConnected && !node.closest('[hidden], [inert]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    function buttons() {
      const result = new Map();
      for (const root of [...doc.querySelectorAll(containers)].slice(0, 100)) {
        if (!visible(root) || !/cookies?/i.test(root.textContent || '')) continue;
        // Custom checkbox choices stay with DeepSeek; don't turn them into Accept all.
        if (root.querySelector('input[type="checkbox"], [role="checkbox"], input[type="radio"]')) continue;
        for (const button of root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')) {
          const name = label(button), action = kind(name);
          if (action && visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true') result.set(button, { kind: action, label: name });
        }
      }
      return result;
    }
    function replay() {
      if (disposed || !choice) return;
      const match = [...buttons()].find(([button, value]) => !handled.has(button) && value.kind === choice.kind && value.label === choice.label);
      // A renamed or different consent action requires a new explicit choice.
      if (match) { handled.add(match[0]); match[0].click(); }
    }
    function capture(event) {
      if (!event.isTrusted || disposed) return;
      const root = event.target.closest?.(containers);
      if (root && visible(root) && /cookies?/i.test(root.textContent || '') &&
          root.querySelector('input[type="checkbox"], [role="checkbox"], input[type="radio"]')) {
        touched = true; choice = undefined;
        void browser.storage.local.remove(key).catch(() => {});
        return;
      }
      const match = [...buttons()].find(([button]) => button === event.target || button.contains(event.target));
      if (!match) return;
      handled.add(match[0]);
      touched = true; choice = { version: 1, ...match[1] };
      void browser.storage.local.set({ [key]: choice }).catch(() => {});
    }
    const ready = browser.storage.local.get(key).then(saved => {
      const value = saved[key];
      if (!touched && value?.version === 1 && typeof value.label === 'string' && value.label.length <= 100 && kind(value.label) === value.kind) choice = value;
      replay();
    }).catch(() => {});
    const observer = new Observer(() => { clearTimeout(timer); timer = setTimeout(replay, 100); });
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    doc.addEventListener('click', capture, true);
    return { ready, dispose() { disposed = true; clearTimeout(timer); observer.disconnect(); doc.removeEventListener('click', capture, true); } };
  }
  globalThis.AiAgentDeepseekConsent = Object.freeze({ create });
  if (typeof window === 'undefined' || window === window.top || location.ancestorOrigins[0] !== chrome.runtime.getURL('').replace(/\/$/, '')) return;
  const consent = create();
  window.addEventListener('pagehide', () => consent.dispose(), { once: true });
})();
