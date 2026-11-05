import { defineAgent } from '../src/definition.mjs';

export const chatgptTemplate = defineAgent({ id: 'chatgpt-template', title: 'AI agent template' });

export const fixedPromptAgent = defineAgent({
  id: 'job-summary', title: 'Job summary',
  prompt: { value: 'Summarize the supplied job description using only its stated requirements.', editable: false },
  input: { label: 'Job description' },
});

export const fixedInputAgent = defineAgent({
  id: 'profile-review', title: 'Profile review',
  input: { value: 'Sample profile for a UI demonstration.', editable: false, visible: false },
});

// An authenticated API may return { data } directly. No AI model selector is needed.
export const apiResultAgent = defineAgent({
  id: 'api-result', title: 'API lookup', provider: 'your service', modelSelection: false,
  prompt: { value: '', editable: false, visible: false, required: false },
  input: { label: 'Lookup input', placeholder: 'Enter the value to look up…' },
});
