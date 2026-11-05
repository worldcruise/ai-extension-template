import { mountAgent } from './src/agent-shell.mjs';
import { chatgptTemplate } from './examples/agents.mjs';
import { createPreviewAdapter } from './examples/preview-adapter.mjs';

mountAgent(document.querySelector('#agent'), {
  definition: { ...chatgptTemplate, preview: true, input: { ...chatgptTemplate.input,
    value: 'Explain how rain forms in three short points.' } },
  adapter: createPreviewAdapter(),
});
