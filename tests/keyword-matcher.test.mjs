import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/keyword-matcher.js';

const { normalize, parseInput, findMatches } = globalThis.AiAgentKeywords;
const matched = (text, settings) => findMatches(text, { enabled: true, ...settings }).map(match => text.slice(match.start, match.end));

test('keyword settings reject unsafe colors, limit records, and preserve literal terms', () => {
  assert.deepEqual(normalize({ enabled: true, color: 'red;display:none', keywords: [' React ', 'react', '', 'C++', '<img src=x>'] }), {
    enabled: true, keywords: ['React', 'C++', '<img src=x>'], color: '#fff2a8', caseSensitive: false, wholeWords: true
  });
  assert.equal(normalize({ keywords: Array.from({ length: 220 }, (_, index) => `word${index}`) }).keywords.length, 200);
  assert.throws(() => parseInput('x'.repeat(81)), /81 characters/);
  assert.throws(() => parseInput(Array(201).fill('term').join('\n')), /200 keywords/);
  assert.deepEqual(parseInput('SQL\n\n sql \nC#'), ['SQL', 'C#']);
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
