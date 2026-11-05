import { defineAgent } from './definition.mjs';

// Replace this definition and the adapter at the composition root for another agent.
export const agentDefinition = defineAgent({
  id: 'ai-agent-template', title: 'AI agent',
  prompt: { value: 'Use the input to answer the request clearly and concisely.' },
  input: { label: 'Input', placeholder: 'Enter the information to send to the agent…' },
  result: { label: 'Output', placeholder: 'The returned result will appear here.' },
});
