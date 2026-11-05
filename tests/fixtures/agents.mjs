import { defineAgent } from '../../src/definition.mjs';

export const fixedPromptAgent = defineAgent({
  id: 'fixed-prompt', title: 'Text summary',
  prompt: { value: 'Summarize the supplied text using only the information it contains.', editable: false },
  input: { label: 'Text to summarize' },
});

export const fixedInputAgent = defineAgent({
  id: 'fixed-input', title: 'Fixed input example',
  input: { value: 'Sample text for a UI demonstration.', editable: false, visible: false },
});

// An authenticated API may return { data } directly. No AI model selector is needed.
export const apiResultAgent = defineAgent({
  id: 'api-result', title: 'API lookup', provider: 'your service', modelSelection: false,
  prompt: { value: '', editable: false, visible: false, required: false },
  input: { label: 'Lookup input', placeholder: 'Enter the value to look up…' },
});
