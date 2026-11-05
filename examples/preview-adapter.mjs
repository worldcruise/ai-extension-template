function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Canceled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

// UI fixture only. No network calls, credentials, live models, or AI inference.
export function createPreviewAdapter({ latency = 650 } = {}) {
  let signedIn = false;
  return {
    async getSession() {
      return signedIn ? { authenticated: true, user: { id: 'preview', name: 'Preview account' } } : null;
    },
    async signIn({ signal } = {}) { await delay(220, signal); signedIn = true; },
    async signOut() { signedIn = false; },
    async getModels() {
      return [
        { id: 'sample-reasoning', label: 'Sample reasoning model', thinkingEfforts: ['low', 'medium', 'high'], defaultThinkingEffort: 'medium' },
        { id: 'sample-standard', label: 'Sample standard model', thinkingEfforts: [] },
      ];
    },
    async run({ prompt, input, model, thinkingEffort, signal }) {
      await delay(latency, signal);
      return { text: [
        'SAMPLE RESULT · UI PREVIEW', '',
        'This is a local sample response. No information was sent to ChatGPT or an API.', '',
        'Prompt template:', prompt, '', 'Test input:', input,
        ...(model ? ['', `Selected model: ${model}`, ...(thinkingEffort ? [`Thinking effort: ${thinkingEffort}`] : [])] : []),
      ].join('\n') };
    },
  };
}
