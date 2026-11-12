// Persist only bounded metadata. Never retain prompt excerpts, HTML, URLs or event data.
export function generationDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = { schemaVersion: 1 };
  const counts = ['elapsedMs', 'expectedChars', 'actualChars', 'normalizedExpectedChars', 'normalizedActualChars', 'renderedChars',
    'editorIdentity', 'formIdentity', 'longestStableMs', 'samples', 'knownEditorCandidates', 'inputEvents', 'trustedInputs', 'replacements',
    'assistantCandidates', 'boundedCandidates', 'codeBlocks', 'replyChars', 'replyParts', 'stableMs'];
  for (const key of counts) if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 1000000) result[key] = value[key];
  if (Number.isSafeInteger(value.firstDifference) && value.firstDifference >= -1 && value.firstDifference <= 205000) result.firstDifference = value.firstDifference;
  for (const key of ['documentFocused', 'transientActivation', 'editorFound', 'activeInEditor', 'textMatches', 'renderedTextMatches',
    'sendFound', 'sendEnabled', 'generationActive', 'nativeReturned', 'dispatched', 'userMatched', 'responseMatched', 'completionControl', 'conversationFound']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  const choices = {
    code: ['received', 'editor_ready', 'native_insert_attempted', 'native_setter_attempted', 'existing_prompt_verified',
      'insertion_verified', 'send_ready', 'submitted', 'editor_lost', 'prompt_text_mismatch', 'prompt_unstable',
      'send_button_not_ready', 'insertion_not_accepted', 'editor_not_found', 'existing_attachment', 'prompt_changed',
      'existing_draft', 'generation_in_progress', 'page_changed', 'cancelled', 'adapter_error', 'uncertain', 'stopped', 'editor_replaced',
      'reply_not_found', 'code_block_missing', 'waiting_for_idle', 'reply_ready', 'waiting_for_completion', 'waiting_for_conversation', 'waiting_for_stability'],
    stage: ['editor_lookup', 'insertion', 'send_button', 'submission', 'complete', 'capture'],
    visibility: ['visible', 'hidden', 'prerender'], editorKind: ['none', 'native', 'prosemirror', 'lexical', 'contenteditable'],
    editorTag: ['NONE', 'DIV', 'P', 'SPAN', 'TEXTAREA', 'INPUT'],
    expectedKind: ['end', 'whitespace', 'letter', 'number', 'control', 'symbol'], actualKind: ['end', 'whitespace', 'letter', 'number', 'control', 'symbol'],
    insertionMethod: ['none', 'native_setter', 'native_insert', 'existing_text'], submissionMethod: ['enter'],
    extraction: ['pre', 'text'], busyReason: ['none', 'stop-control', 'streaming', 'loading'],
    completionBasis: ['none', 'response-controls', 'matching-json']
  };
  for (const [key, allowed] of Object.entries(choices)) if (allowed.includes(value[key])) result[key] = value[key];
  for (const key of ['version', 'extensionVersion']) {
    if (typeof value[key] === 'string' && /^(?:unknown|\d{1,5}\.\d{1,5}\.\d{1,5})$/.test(value[key])) result[key] = value[key];
  }
  if (typeof value.buildId === 'string' && /^(?:unknown|source-unbuilt|[a-f0-9]{64})$/.test(value.buildId)) result.buildId = value.buildId;
  if (typeof value.revision === 'string' && /^plain-text-\d{1,3}$/.test(value.revision)) result.revision = value.revision;
  return Object.keys(result).length > 1 ? result : null;
}
