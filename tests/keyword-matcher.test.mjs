import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/keyword-matcher.js';

const { palette, normalize, parseInput, findMatches, createMatcher } = globalThis.AiAgentKeywords;
const matched = (text, settings) => findMatches(text, { enabled: true, ...settings }).map(match => text.slice(match.start, match.end));

test('keyword settings reject unsafe colors, limit records, and preserve literal terms', () => {
  const settings = normalize({ enabled: true, color: 'red;display:none', keywords: [' React ', 'react', '', 'C++', '<img src=x>'] });
  assert.equal(settings.version, 2);
  assert.equal(settings.enabled, true);
  assert.deepEqual(settings.groups[0], { id: 'yellow', keywords: ['React', 'C++', '<img src=x>'], color: '#fff2a8' });
  assert.ok(settings.groups.slice(1).every(group => group.keywords.length === 0));
  assert.equal(settings.caseSensitive, false);
  assert.equal(settings.wholeWords, true);
  assert.equal(normalize({ keywords: Array.from({ length: 220 }, (_, index) => `word${index}`) }).groups[0].keywords.length, 200);
  assert.throws(() => parseInput('x'.repeat(81)), /81 characters/);
  assert.throws(() => parseInput(Array(201).fill('term').join('\n')), /200 keywords/);
  assert.deepEqual(parseInput('SQL\n\n sql \nC#'), ['SQL', 'C#']);
});

test('legacy settings keep their keywords in the matching color, move Pink to Red, and preserve exact custom colors', () => {
  for (const [color, id, expected] of [['#b7e4ca', 'green', '#b7e4ca'], ['#ffcfe0', 'red', '#ff5252'], ['#ffb3b3', 'red', '#ff5252'], ['#ABCDEF', 'custom', '#abcdef']]) {
    const legacy = { enabled: true, color, keywords: ['TypeScript', 'SQL'], caseSensitive: true, wholeWords: false };
    const before = structuredClone(legacy);
    const settings = normalize(legacy);
    assert.deepEqual(settings.groups.find(group => group.id === id), { id, color: expected, keywords: legacy.keywords });
    assert.equal(settings.groups.flatMap(group => group.keywords).length, 2);
    assert.equal(settings.caseSensitive, true);
    assert.equal(settings.wholeWords, false);
    assert.deepEqual(normalize(settings), settings, 'migration is idempotent');
    assert.deepEqual(legacy, before, 'normalizing never changes the original record');
  }
});

test('group settings retain independent lists and validate custom colors and group identities', () => {
  const settings = normalize({ groups: [
    { id: 'red', color: 'url(unsafe)', keywords: [' SQL ', 'sql'] },
    { id: 'custom', color: 'red;display:none', keywords: ['Python'] },
    { id: 'unknown', color: '#000000', keywords: ['Ignore'] }
  ] });
  assert.deepEqual(settings.groups.find(group => group.id === 'red'), { id: 'red', color: '#ff5252', keywords: ['SQL'] });
  assert.deepEqual(settings.groups.find(group => group.id === 'custom'), { id: 'custom', color: '#e2e8f0', keywords: ['Python'] });
  assert.equal(settings.groups.length, 7);
  assert.ok(!settings.groups.flatMap(group => group.keywords).includes('Ignore'));
});

test('matching assigns different colors, prefers longer phrases, and resolves duplicate keywords by palette order', () => {
  const text = 'React SQL machine learning ReactNative';
  const groups = [
    { id: 'red', keywords: ['machine learning'] },
    { id: 'green', keywords: ['React', 'SQL', 'ReactNative'] },
    { id: 'yellow', keywords: ['React', 'machine', 'learning'] }
  ];
  assert.deepEqual(findMatches(text, { enabled: true, groups }).map(match => [text.slice(match.start, match.end), match.groupId]), [
    ['React', 'yellow'], ['SQL', 'green'], ['machine learning', 'red'], ['ReactNative', 'green']
  ]);
  assert.deepEqual(findMatches('React react', { enabled: true, caseSensitive: true, groups: [
    { id: 'yellow', keywords: ['React'] }, { id: 'red', keywords: ['react'] }
  ] }).map(match => match.groupId), ['yellow', 'red']);
});

test('Unicode case-fold equivalents keep the winning color without text-identity guesses', () => {
  assert.deepEqual(findMatches('S \u03a3', { enabled: true, groups: [
    { id: 'yellow', keywords: ['\u017f', '\u03c2'] }, { id: 'green', keywords: ['s', '\u03a3'] }
  ] }).map(match => match.groupId), ['yellow', 'yellow']);
  assert.deepEqual(findMatches('\u0130 i\u0307', { enabled: true, groups: [
    { id: 'yellow', keywords: ['\u0130'] }, { id: 'green', keywords: ['i\u0307'] }
  ] }).map(match => match.groupId), ['yellow', 'green'], 'lowercasing distinct literals cannot discard a color’s keyword');
});

test('the matcher supports every full color list, is reusable, and bounds range collection', () => {
  const groups = palette.map(group => ({ id: group.id, keywords: Array.from({ length: 200 }, (_, index) => `${group.id}-${index}`) }));
  const matcher = createMatcher({ enabled: true, groups });
  assert.deepEqual(matcher('custom-199').map(match => match.groupId), ['custom']);
  assert.deepEqual(matcher('red-199').map(match => match.groupId), ['red']);
  assert.equal(findMatches('x '.repeat(6000), { enabled: true, groups: [{ id: 'red', keywords: ['x'] }] }).length, 5000);
  assert.deepEqual(findMatches('x', { enabled: false, groups: [{ id: 'red', keywords: ['x'] }] }), []);
});

test('literal matching handles technical punctuation, phrases, Unicode boundaries, and overlap', () => {
  const text = 'C++ and C# use .NET. machine learning beats learning. React ReactNative réactReact Reacté.';
  assert.deepEqual(matched(text, { keywords: ['C++', 'C#', '.NET', 'machine learning', 'learning', 'React'] }),
    ['C++', 'C#', '.NET', 'machine learning', 'learning', 'React']);
  assert.deepEqual(matched('a+b aab [SQL] SQL', { keywords: ['a+b', '[SQL]'] }), ['a+b', '[SQL]']);
});

test('matching can be disabled, case sensitive, or expanded to substrings', () => {
  assert.deepEqual(findMatches('React', { enabled: false, keywords: ['React'] }), []);
  assert.deepEqual(matched('React react REACT', { keywords: ['React'], caseSensitive: true }), ['React']);
  assert.deepEqual(matched('React react REACT', { keywords: ['React'] }), ['React', 'react', 'REACT']);
  assert.deepEqual(matched('ReactNative', { keywords: ['React'], wholeWords: false }), ['React']);
});
