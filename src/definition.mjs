// Every agent shares this shell; change its definition and adapter, not its UI.
export function defineAgent(overrides = {}) {
  const agent = {
    id: 'chatgpt-template',
    title: 'AI agent template',
    provider: 'ChatGPT',
    modelSelection: true,
    preview: false,
    ...overrides,
    prompt: {
      label: 'Prompt template',
      value: 'Use the test input to complete the requested task.\nBe clear, accurate, and concise.\nUse only the information provided.',
      editable: true,
      visible: true,
      required: true,
      ...overrides.prompt,
    },
    input: {
      label: 'Test input',
      value: '',
      placeholder: 'Paste the information you want to test…',
      editable: true,
      visible: true,
      required: true,
      ...overrides.input,
    },
    result: {
      label: 'Result',
      placeholder: 'Your result will appear here.',
      ...overrides.result,
    },
  };
  if (!agent.id || !agent.title) throw new TypeError('An agent needs an id and title.');
  for (const key of ['prompt', 'input']) {
    if (typeof agent[key].value !== 'string') throw new TypeError(`${key}.value must be a string.`);
    if (!agent[key].visible && agent[key].editable) {
      throw new TypeError(`Hidden ${key} must be fixed (editable: false).`);
    }
  }
  return agent;
}

export function formatResult(result) {
  if (typeof result === 'string') return result;
  if (result && typeof result.text === 'string') return result.text;
  if (result && Object.hasOwn(result, 'data')) {
    const serialized = JSON.stringify(result.data, null, 2);
    if (typeof serialized === 'string') return serialized;
  }
  throw new TypeError('The agent must return a string, { text }, or { data }.');
}
