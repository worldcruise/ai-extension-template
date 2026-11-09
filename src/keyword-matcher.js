// Shared by the settings page and the isolated script on opted-in job pages.
(() => {
  if (globalThis.AiAgentKeywords?.version === 2) return;
  const storageKey = 'keywordHighlights';
  const palette = Object.freeze([
    { id: 'yellow', label: 'Yellow', color: '#fff2a8' },
    { id: 'green', label: 'Green', color: '#b7e4ca' },
    { id: 'blue', label: 'Blue', color: '#bde0fe' },
    { id: 'red', label: 'Red', color: '#ff5252' },
    { id: 'purple', label: 'Purple', color: '#ddd0f5' },
    { id: 'orange', label: 'Orange', color: '#ffd4a8' },
    { id: 'custom', label: 'Custom', color: '#e2e8f0' }
  ].map(Object.freeze));
  const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
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
    const stored = Array.isArray(value?.groups) ? value.groups : null;
    const groups = palette.map(entry => {
      const records = stored?.filter(group => group?.id === entry.id) || [];
      const color = entry.id === 'custom' && validColor(records[0]?.color) ? records[0].color.toLowerCase() : entry.color;
      return { id: entry.id, color, keywords: words(records.flatMap(group => Array.isArray(group.keywords) ? group.keywords : []), caseSensitive) };
    });
    if (!stored) {
      const color = validColor(value?.color) ? value.color.toLowerCase() : palette[0].color;
      // Previous Pink and pale Red presets follow Red; custom groups stay exact.
      const id = ['#ffcfe0', '#ffb3b3'].includes(color) ? 'red' : palette.find(entry => entry.id !== 'custom' && entry.color === color)?.id || 'custom';
      const group = groups.find(entry => entry.id === id);
      group.keywords = words(value?.keywords, caseSensitive);
      if (id === 'custom') group.color = color;
    }
    return { version: 2, enabled: value?.enabled === true, groups,
      caseSensitive, wholeWords: value?.wholeWords !== false };
  }
  function parseInput(text, caseSensitive = false) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length > 200) throw new Error('Use up to 200 keywords, one per line.');
    if (lines.some(line => line.length > 80)) throw new Error('Keep each keyword or phrase under 81 characters.');
    return words(lines, caseSensitive);
  }
  function createMatcher(value) {
    const settings = normalize(value);
    const entries = settings.groups.flatMap(group => group.keywords.map(word => ({ word, groupId: group.id })))
      .sort((a, b) => b.word.length - a.word.length);
    if (!settings.enabled || !entries.length) return () => [];
    // Capture the winning alternative rather than guessing its owner by casing
    // the matched text: Unicode /iu equivalence includes e.g. S and long s (ſ).
    const alternatives = entries.map(({ word }) => '(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')').join('|');
    const edge = '[\\p{L}\\p{N}_]';
    const pattern = settings.wholeWords ? `(?<!${edge})(?:${alternatives})(?!${edge})` : alternatives;
    const expression = new RegExp(pattern, settings.caseSensitive ? 'gu' : 'giu');
    return text => {
      if (typeof text !== 'string') return [];
      const matches = [];
      for (const match of text.matchAll(expression)) {
        const owner = entries[match.findIndex((value, index) => index > 0 && value !== undefined) - 1];
        matches.push({ start: match.index, end: match.index + match[0].length, groupId: owner.groupId });
        if (matches.length === 5000) break;
      }
      return matches;
    };
  }
  const findMatches = (text, value) => createMatcher(value)(text);
  globalThis.AiAgentKeywords = Object.freeze({ version: 2, storageKey, palette, normalize, parseInput, createMatcher, findMatches });
})();
