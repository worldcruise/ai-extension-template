import test from 'node:test';
import assert from 'node:assert/strict';
import { generationDiagnostics } from '../src/generation-diagnostics.mjs';

test('submission diagnostics retain bounded measurements without prompt content or arbitrary fields', () => {
  const result = generationDiagnostics({ code: 'prompt_text_mismatch', stage: 'insertion', textMatches: false, sendEnabled: true,
    expectedChars: 2000, actualChars: 1990, firstDifference: 10, expectedKind: 'letter', actualKind: 'end',
    revision: 'plain-text-2', extensionVersion: '0.6.1', buildId: 'a'.repeat(64),
    prompt: 'PRIVATE', html: '<div>PRIVATE</div>', url: 'https://chatgpt.com/c/private', snippet: 'PRIVATE',
    replacements: Infinity, samples: -1, elapsedMs: 1000001, insertionMethod: 'PRIVATE', editorTag: 'PRIVATE' });
  assert.equal(result.expectedChars, 2000); assert.equal(result.sendEnabled, true);
  assert.equal(result.code, 'prompt_text_mismatch');
  assert.equal(result.firstDifference, 10); assert.equal(result.extensionVersion, '0.6.1');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|https|Infinity/);
  for (const key of ['replacements', 'samples', 'elapsedMs', 'insertionMethod', 'editorTag']) assert.equal(result[key], undefined);
  assert.equal(generationDiagnostics({ prompt: 'PRIVATE' }), null);
  assert.equal(generationDiagnostics({ code: 'PRIVATE' }), null);
  assert.equal(generationDiagnostics(null), null);
});

test('DeepSeek capture diagnostics identify the blocking gate without response text', () => {
  const value = generationDiagnostics({stage:'capture',code:'waiting_for_stability',replyParts:2,codeBlocks:1,
    extraction:'pre',busyReason:'none',completionBasis:'matching-json',stableMs:500,conversationFound:true,raw:'PRIVATE'});
  assert.equal(value.stableMs, 500); assert.equal(value.extraction, 'pre'); assert.equal(value.completionBasis, 'matching-json');
  assert.equal(value.replyParts, 2); assert.equal(value.conversationFound, true); assert.equal(value.raw, undefined);
  assert.equal(generationDiagnostics({busyReason:'PRIVATE',extraction:'PRIVATE',completionBasis:'PRIVATE',stableMs:-1}), null);
});
