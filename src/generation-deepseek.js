(() => {
  const d = globalThis.AiAgentGenerationDOM;
  const answers = '[data-message-author-role="assistant"], [data-role="assistant"], .ds-markdown';
  const reasoning = '[data-testid="thinking"], [data-role="reasoning"], .ds-think-content, .ds-think-content-wrapper';
  function answer(run) {
    const user = d.userTurn(`DOCUMENT_RUN:${run.id}`, `${answers},${reasoning}`);
    const candidates = [...document.querySelectorAll(answers)].filter(node => d.after(node, user) && !node.closest(reasoning));
    // Prefer the rendered answer inside an assistant wrapper, never concatenate nested copies.
    const nodes = candidates.filter(node => !candidates.some(other => other !== node && node.contains(other)));
    const node = nodes[0];
    if (!node) return { user, node: null, raw: '', complete: false };
    const row = node.closest('[data-message-author-role="assistant"], [data-role="assistant"], .ds-message, article') || node.parentElement;
    const complete = [...row.querySelectorAll('[data-testid="copy-response"], button[aria-label*="Copy" i], [role="button"][aria-label*="Copy" i], [role="button"][aria-label*="复制"]')].some(button => d.visible(button) && !d.disabled(button));
    return { user, node, raw: d.answerText(node), complete };
  }
  globalThis.AiAgentDeepSeekGeneration = {
    editor: () => d.editor(['#chat-input', 'textarea[placeholder*="DeepSeek"]', 'textarea[placeholder*="发送"]', 'form textarea', '[contenteditable="true"][role="textbox"]']),
    login: () => /\/sign_in|\/login|\/auth/.test(location.pathname) || Boolean(d.firstVisible(['input[type="password"]', 'input[autocomplete="one-time-code"]', '[data-testid="login-button"]'])),
    busy: () => Boolean(d.firstVisible(['[data-is-streaming="true"]', '[data-testid="stop-button"]', 'button[aria-label*="Stop" i]', '[role="button"][aria-label*="Stop" i]', '[role="button"][aria-label*="停止"]', '.ds-loading'])),
    control: editor => d.sendControl(editor, ['[data-testid="send-button"]', 'button[aria-label="Send"]', '[role="button"][aria-label="Send"]', 'button[aria-label*="Send message" i]', '[role="button"][aria-label*="发送"]']),
    canEnter: editor => editor?.matches('#chat-input, textarea[placeholder*="DeepSeek"], textarea[placeholder*="发送"]'),
    baseline: () => ({ users: d.userNodes().length, answers: document.querySelectorAll(answers).length }),
    answer,
    conversation: () => /^\/a\/chat\/s\/[\w-]+\/?$/.test(location.pathname) ? location.origin + location.pathname : null
  };
})();
