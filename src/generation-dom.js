(() => {
  if (globalThis.AiAgentGenerationDOM) return;
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none');
  const text = node => node?.matches('textarea,input') ? node.value : node?.innerText || node?.textContent || '';
  // A rich editor's empty paragraph can expose three newlines through innerText.
  // Compare paragraph boundaries consistently without discarding words or single line breaks.
  const normal = value => String(value || '').replace(/\r\n?/g, '\n').replace(/[\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const writable = node => node?.matches('textarea:not([disabled]):not([readonly]), [contenteditable="true"], [contenteditable="plaintext-only"]') && visible(node) && !node.closest('[inert]') && node.getAttribute('aria-disabled') !== 'true';
  function editor(selectors) {
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].flatMap(node => node.matches('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]') ? [node] : [...node.querySelectorAll('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')]).filter(writable).filter(node => !node.closest('[data-message-author-role], [data-testid^="conversation-turn"]'));
      const unique = [...new Set(found)]; if (unique.length === 1) return unique[0];
    }
    return null;
  }
  const firstVisible = selectors => selectors.flatMap(selector => [...document.querySelectorAll(selector)]).find(visible);
  const disabled = node => node.disabled || node.getAttribute('aria-disabled') === 'true' || node.getAttribute('data-disabled') === 'true';
  function sendControl(editor, selectors) {
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter(visible);
      const form = editor?.closest('form');
      const scoped = form ? nodes.filter(node => form.contains(node)) : nodes;
      if (scoped.length === 1) return scoped[0];
    }
    const submits = [...(editor?.closest('form')?.querySelectorAll('button[type="submit"]') || [])].filter(visible);
    return submits.length === 1 ? submits[0] : null;
  }
  function hasAttachment(editor) {
    return Boolean(editor?.closest('form')?.querySelector('[data-testid="file-thumbnail"], [data-testid="attachment-preview"], [data-file-id]'));
  }
  function fill(editor, prompt) {
    if (!writable(editor) || normal(text(editor)) || hasAttachment(editor)) throw new Error('The message box contains a draft or attachment. It was preserved.');
    editor.focus({ preventScroll: true });
    if (editor.matches('textarea')) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, prompt);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
      // Browser editing keeps the rich editor's input/undo path intact. Never replace its innerHTML.
      if (!document.execCommand('insertText', false, prompt)) throw new Error('This editor did not accept text insertion. The prompt was not submitted.');
    }
  }
  const userNodes = () => [...document.querySelectorAll('[data-message-author-role="user"], [data-role="user"], [data-testid="user-message"], .user-message')];
  function userTurn(marker, answerSelector) {
    const explicit = userNodes().filter(node => normal(text(node)).includes(marker));
    if (explicit.length) return explicit.at(-1);
    // DeepSeek also renders unlabelled user bubbles. Locate the unique run marker in a text leaf,
    // excluding editors, answers, and reasoning so an echoed marker cannot become a user turn.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (node.textContent.includes(marker) && parent && !parent.closest(`textarea,input,[contenteditable],script,style,pre,code,${answerSelector}`)) return parent;
    }
    return null;
  }
  function after(node, earlier) { return Boolean(earlier && !node.contains(earlier) && !earlier.contains(node) && (earlier.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)); }
  function answerText(node) {
    const blocks = [...node.querySelectorAll('pre code')].map(code => code.textContent.trim()).filter(value => value.startsWith('{'));
    return blocks.length === 1 ? blocks[0] : text(node).trim();
  }
  function completedJSON(raw, run) {
    try {
      const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'));
      return value?.requestId === run.jobId && value?.runId === run.id && value.resume && typeof value.coverLetter === 'string';
    } catch { return false; }
  }
  globalThis.AiAgentGenerationDOM = { visible, text, normal, editor, firstVisible, disabled, sendControl, hasAttachment, fill, userNodes, userTurn, after, answerText, completedJSON };
})();
