import { mountAgent } from './src/agent-shell.mjs';
import { chatgptTemplate } from './examples/agents.mjs';
import { createPreviewAdapter } from './examples/preview-adapter.mjs';

mountAgent(document.querySelector('#agent'), {
  definition: { ...chatgptTemplate, preview: true, input: { ...chatgptTemplate.input,
    value: 'Summarize this role in three points:\nSenior engineer · remote · product development and cross-team collaboration.' } },
  adapter: createPreviewAdapter(),
});
