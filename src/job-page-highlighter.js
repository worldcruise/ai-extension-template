// Runs only in the top-level web page selected through the extension action.
// CSS ranges paint text without inserting wrappers into a site's DOM.
(() => {
  if (window !== window.top || !/^https?:$/.test(location.protocol) ||
      /(^|\.)chatgpt\.com$/i.test(location.hostname)) return;
  if (globalThis.AiAgentJobHighlights) { globalThis.AiAgentJobHighlights.refresh(); return; }
  if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return;
  const { storageKey, normalize, findMatches } = globalThis.AiAgentKeywords;
  const name = 'ai-agent-job-keywords';
  let settings = normalize();
  let timer;
  function clear() {
    CSS.highlights.delete(name);
    document.documentElement.style.removeProperty('--ai-agent-keyword-color');
  }
  function paint() {
    if (!settings.enabled || !settings.keywords.length || !document.body) { clear(); return; }
    document.documentElement.style.setProperty('--ai-agent-keyword-color', settings.color);
    const groups = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.data || parent?.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
          parent.closest('script,style,noscript,template,textarea,input,select,button,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"]') ||
          !parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden') continue;
      const block = parent.closest('p,li,h1,h2,h3,h4,h5,h6,div,section,article,td,th,blockquote,pre') || document.body;
      if (!groups.has(block)) groups.set(block, []);
      groups.get(block).push(node);
    }
    const ranges = [];
    for (const nodes of groups.values()) {
      let offset = 0;
      const pieces = nodes.map(node => {
        const start = offset; offset += node.length;
        return { node, start, end: offset };
      });
      for (const match of findMatches(nodes.map(node => node.data).join(''), settings)) {
        const first = pieces.find(piece => piece.end > match.start);
        const last = pieces.find(piece => piece.end >= match.end);
        if (!first || !last) continue;
        const range = document.createRange();
        range.setStart(first.node, match.start - first.start);
        range.setEnd(last.node, match.end - last.start);
        ranges.push(range);
        if (ranges.length === 5000) break;
      }
      if (ranges.length === 5000) break;
    }
    CSS.highlights.set(name, new Highlight(...ranges));
  }
  function refresh() {
    if (!timer) timer = setTimeout(() => { timer = undefined; paint(); }, 120);
  }
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden'] });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[storageKey]) return;
    settings = normalize(changes[storageKey].newValue);
    paint();
  });
  void chrome.storage.local.get(storageKey).then(data => { settings = normalize(data[storageKey]); paint(); }).catch(clear);
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); });
  globalThis.AiAgentJobHighlights = { refresh };
})();
