// Runs only in the top-level web page selected through the extension action.
// CSS ranges paint text without inserting wrappers into a site's DOM.
(() => {
  if (window !== window.top || !/^https?:$/.test(location.protocol) ||
      /(^|\.)chatgpt\.com$/i.test(location.hostname)) return;
  if (globalThis.AiAgentJobHighlights?.version === 2) { globalThis.AiAgentJobHighlights.refresh(); return; }
  globalThis.AiAgentJobHighlights?.dispose?.();
  if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return;
  const { storageKey, palette, normalize, createMatcher } = globalThis.AiAgentKeywords;
  const name = id => `ai-agent-job-keywords-${id}`;
  const property = id => `--ai-agent-keyword-color-${id}`;
  let settings = normalize();
  let timer;
  function clear() {
    CSS.highlights.delete('ai-agent-job-keywords');
    document.documentElement.style.removeProperty('--ai-agent-keyword-color');
    for (const group of palette) {
      CSS.highlights.delete(name(group.id));
      document.documentElement.style.removeProperty(property(group.id));
    }
  }
  function paint() {
    if (!settings.enabled || !settings.groups.some(group => group.keywords.length) || !document.body) { clear(); return; }
    const matchText = createMatcher(settings);
    CSS.highlights.delete('ai-agent-job-keywords');
    document.documentElement.style.removeProperty('--ai-agent-keyword-color');
    for (const group of settings.groups) document.documentElement.style.setProperty(property(group.id), group.color);
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
    const ranges = new Map(settings.groups.map(group => [group.id, []]));
    let rangeCount = 0;
    for (const nodes of groups.values()) {
      let offset = 0;
      const pieces = nodes.map(node => {
        const start = offset; offset += node.length;
        return { node, start, end: offset };
      });
      for (const match of matchText(nodes.map(node => node.data).join(''))) {
        const first = pieces.find(piece => piece.end > match.start);
        const last = pieces.find(piece => piece.end >= match.end);
        if (!first || !last) continue;
        const range = document.createRange();
        range.setStart(first.node, match.start - first.start);
        range.setEnd(last.node, match.end - last.start);
        ranges.get(match.groupId).push(range);
        if (++rangeCount === 5000) break;
      }
      if (rangeCount === 5000) break;
    }
    for (const [id, values] of ranges) {
      if (values.length) CSS.highlights.set(name(id), new Highlight(...values));
      else CSS.highlights.delete(name(id));
    }
  }
  function refresh() {
    if (!timer) timer = setTimeout(() => { timer = undefined; paint(); }, 120);
  }
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden'] });
  const changed = (changes, area) => {
    if (area !== 'local' || !changes[storageKey]) return;
    settings = normalize(changes[storageKey].newValue);
    paint();
  };
  chrome.storage.onChanged.addListener(changed);
  void chrome.storage.local.get(storageKey).then(data => { settings = normalize(data[storageKey]); paint(); }).catch(clear);
  function dispose() { observer.disconnect(); clearTimeout(timer); chrome.storage.onChanged.removeListener(changed); clear(); }
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); });
  globalThis.AiAgentJobHighlights = { version: 2, refresh, dispose };
})();
