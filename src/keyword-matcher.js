// Shared by the settings page and the isolated script on opted-in job pages.
(() => {
  if (globalThis.AiAgentKeywords) return;
  const storageKey = 'keywordHighlights';
  const defaults = { enabled: false, keywords: [], color: '#fff2a8', caseSensitive: false, wholeWords: true };
  function words(values, caseSensitive) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).flatMap(value => {
      if (typeof value !== 'string') return [];
      const word = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
      const key = caseSensitive ? word : word.toLowerCase();
      if (!word || seen.has(key)) return [];
      seen.add(key);
      return [word];
    }).slice(0, 200);
  }
  function normalize(value = {}) {
    const caseSensitive = value?.caseSensitive === true;
    return { enabled: value?.enabled === true, keywords: words(value?.keywords, caseSensitive),
      color: /^#[0-9a-f]{6}$/i.test(value?.color) ? value.color.toLowerCase() : defaults.color,
      caseSensitive, wholeWords: value?.wholeWords !== false };
  }
  function parseInput(text, caseSensitive = false) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length > 200) throw new Error('Use up to 200 keywords, one per line.');
    if (lines.some(line => line.length > 80)) throw new Error('Keep each keyword or phrase under 81 characters.');
    return words(lines, caseSensitive);
  }
  function findMatches(text, value) {
    const settings = normalize(value);
    if (!settings.enabled || !settings.keywords.length || typeof text !== 'string') return [];
    const alternatives = settings.keywords.sort((a, b) => b.length - a.length)
      .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const edge = '[\\p{L}\\p{N}_]';
    const pattern = settings.wholeWords ? `(?<!${edge})(?:${alternatives})(?!${edge})` : alternatives;
    const expression = new RegExp(pattern, settings.caseSensitive ? 'gu' : 'giu');
    const matches = [];
    for (const match of text.matchAll(expression)) {
      matches.push({ start: match.index, end: match.index + match[0].length });
      if (matches.length === 5000) break;
    }
    return matches;
  }
  globalThis.AiAgentKeywords = Object.freeze({ storageKey, normalize, parseInput, findMatches });
})();
