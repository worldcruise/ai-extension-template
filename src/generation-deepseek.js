(() => {
  const d = globalThis.AiAgentGenerationDOM;
  const finalAnswer = '.ds-assistant-message-main-content';
  const answers = `[data-message-author-role="assistant"], [data-role="assistant"], ${finalAnswer}, .ds-markdown`;
  const assistantRoles = '[data-message-author-role="assistant"], [data-role="assistant"]';
  const reasoning = '[data-testid="thinking"], [data-role="reasoning"], .ds-think-content, .ds-think-content-wrapper';
  const users = '[data-message-author-role="user"], [data-role="user"], [data-testid="user-message"], .user-message';
  const draft = 'textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],script,style';
  const outsideReply = `form,#chat-input,${draft},${users},${reasoning},nav,aside,[role="navigation"]`;
  const excluded = `${draft},pre,code,${answers},${reasoning}`;
  const editorSelectors = ['#chat-input', 'textarea[placeholder*="DeepSeek"]', 'textarea[placeholder*="发送"]', 'form textarea', '[contenteditable="true"][role="textbox"]'];
  const editor = () => d.editor(editorSelectors);
  const control = value => d.sendControl(value, ['[data-testid="send-button"]', 'button[aria-label="Send"]', '[role="button"][aria-label="Send"]', 'button[aria-label*="Send message" i]', '[role="button"][aria-label*="发送"]']);
  function userTurn(run) {
    // Require the full marker token: DOCUMENT_RUN:run-1 must not match run-10.
    const marker = `DOCUMENT_RUN:${run.id}`;
    const matches = value => String(value || '').split(/\s+/).includes(marker);
    const current = editor();
    const composer = current?.closest('form') || current?.parentElement;
    const inComposer = node => Boolean(composer && !composer.matches('body,html,main') && composer.contains(node));
    const excludedUser = `form,#chat-input,${draft},${assistantRoles},${reasoning},nav,aside,[role="navigation"]`;
    const explicit = [...document.querySelectorAll(users)].filter(node => !inComposer(node) && !node.closest(excludedUser) && matches(d.text(node)));
    if (explicit.length) return explicit.at(-1);
    // Textarea auto-size mirrors and draft previews also contain the run marker.
    // An unlabelled text leaf cannot prove submission while that marker remains
    // in the composer. Wait for the provider to consume the draft first.
    if (current && matches(d.text(current))) return null;
    const bubbles = userBubbles().filter(node => !inComposer(node) && !node.closest(excludedUser) && matches(d.text(node)));
    if (bubbles.length) return bubbles.at(-1);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const leaf = walker.currentNode, parent = leaf.parentElement;
      if (parent && !inComposer(parent) && d.visible(parent) && !parent.closest(`${excludedUser},${excluded},[aria-hidden="true"],[hidden]`) && matches(leaf.textContent)) return parent;
    }
    return null;
  }
  function userBubbles() {
    // DeepSeek also uses unlabelled .ds-message containers for user bubbles.
    const nodes = [...document.querySelectorAll(`${users}, .ds-message`)].filter(node =>
      !node.closest(`form,${draft},${assistantRoles},${reasoning}`) &&
      (node.matches(users) || !node.matches(answers) && !node.querySelector(`${answers},${reasoning},${draft}`)));
    return nodes.filter(node => !nodes.some(other => other !== node && node.contains(other)));
  }
  function responseRow(node) {
    if (!node) return null;
    const row = node.closest(`${assistantRoles}, .ds-message, article`);
    if (row) return row;
    const parent = node.parentElement;
    return parent && !parent.matches('body,html,main') ? parent : node;
  }
  function responseScope(row) {
    const parent = row?.parentElement;
    // Native action bars are siblings of .ds-message. Expand only within a
    // single response container, never into the transcript or another turn.
    if (!parent || parent.matches('body,html,main') || parent.querySelector(`${users},${draft}`)) return row;
    const messages = [...parent.querySelectorAll(`${assistantRoles},.ds-message,article`)];
    return messages.every(node => node === row || row.contains(node)) ? parent : row;
  }
  function activity(reply) {
    const current = editor(), composer = current?.closest('form') || current?.parentElement;
    const latest = [...document.querySelectorAll(`${answers},${reasoning}`)].filter(node => d.visible(node) && !node.closest(`form,${draft},${users},nav,aside,[role="navigation"]`)).at(-1);
    const scope = responseScope(reply?.row || responseRow(reply?.node || latest));
    const scopes = [!reply?.nextUser && composer, scope].filter(node => node && !node.matches('body,html,main'));
    const scoped = node => scopes.some(scope => scope === node || scope.contains(node));
    const eligible = node => d.visible(node) && !node.closest('nav,aside,[role="navigation"],pre,code,.md-code-block');
    const controls = [...document.querySelectorAll('[data-testid="stop-button"],button,[role="button"]')];
    const stop = controls.some(node => {
      if (!eligible(node) || d.disabled(node)) return false;
      const label = (node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
      const generationStop = node.matches('[data-testid="stop-button"]') || /^(?:stop generating|stop generation|stop response|停止生成|停止回答|停止响应)(?:\b|[ （(]|$)/i.test(label);
      // Audio playback's Stop is unrelated. An unqualified Stop is accepted
      // only inside the current composer/response.
      return generationStop && (scoped(node) || !reply?.nextUser && !node.closest(`${assistantRoles},.ds-message,article`)) ||
        scoped(node) && /^(?:stop|停止)[.…!]*$/i.test(label);
    });
    if (stop) return 'stop-control';
    if ([...document.querySelectorAll('[data-is-streaming="true"]')].some(node => eligible(node) && scoped(node))) return 'streaming';
    if ([...document.querySelectorAll('.ds-loading')].some(node => eligible(node) && scoped(node))) return 'loading';
    return 'none';
  }
  const busy = reply => activity(reply) !== 'none';
  function readReply(parts) {
    // DeepSeek syntax highlighting renders <pre><span> as well as <pre><code>.
    // Read only the code content; the surrounding language/copy/download bar
    // must never be prepended to JSON. Keep multiple blocks for validation.
    const blocks = [...new Set(parts.flatMap(node => [...node.querySelectorAll('pre')]))]
      .filter(node => d.visible(node) && !node.closest(outsideReply));
    const raw = blocks.length ? blocks.map(node => node.textContent.trim()).join('\n\n') : parts.map(node => d.text(node).trim()).filter(Boolean).join('\n\n');
    return { raw, codeBlocks: blocks.length, extraction: blocks.length ? 'pre' : 'text' };
  }
  function answer(run) {
    const user = userTurn(run), bubbles = userBubbles();
    const nextUser = user && bubbles.find(node => d.after(node, user));
    const roots = [...document.querySelectorAll(answers)].filter(node => d.visible(node) && !node.closest(outsideReply));
    const candidates = roots.filter(node => d.after(node, user) && (!nextUser || d.after(nextUser, node)));
    // Prefer the rendered answer inside an assistant wrapper, never concatenate nested copies.
    // Accessibility live regions and copy feedback are ordinary reply UI, not drafts.
    // Keep the original posted-prompt -> first answer capture path. Result IDs
    // are validated by the service; they are not a way to select another turn.
    const nodes = candidates.filter(node => !node.querySelector(reasoning) && !candidates.some(other => other !== node && node.contains(other)));
    const row = responseRow(nodes[0]);
    const sameResponse = nodes.filter(node => responseRow(node) === row);
    const dedicated = sameResponse.filter(node => node.matches(finalAnswer) || node.closest(finalAnswer));
    const parts = dedicated.length ? dedicated : sameResponse;
    const node = parts[0] || null, { raw, codeBlocks, extraction } = readReply(parts);
    const responseMatched = Boolean(node && d.completedJSON(raw, run));
    const scope = responseScope(row);
    const completionControl = Boolean(scope && [...scope.querySelectorAll('[data-testid="copy-response"], button[aria-label*="Copy" i], [role="button"][aria-label*="Copy" i], [role="button"][aria-label*="复制"]')].some(button => d.visible(button) && !d.disabled(button) &&
      !button.closest(`pre,code,.md-code-block,${users},${reasoning}`)));
    const busyReason = activity({ node, row, nextUser }), streaming = busyReason !== 'none';
    const send = control(editor()), complete = !streaming && (completionControl || responseMatched);
    const diagnostics = {
      stage: 'capture', code: streaming ? 'waiting_for_idle' : !node ? 'reply_not_found' : !raw ? 'code_block_missing' : complete || responseMatched ? 'reply_ready' : 'waiting_for_completion',
      extensionVersion: globalThis.AiAgentBuild?.version || 'unknown', buildId: globalThis.AiAgentBuild?.id || 'unknown',
      assistantCandidates: roots.length, boundedCandidates: nodes.length, replyParts: parts.length, codeBlocks, extraction, busyReason,
      completionBasis: completionControl ? 'response-controls' : responseMatched ? 'matching-json' : 'none',
      replyChars: raw.length, userMatched: Boolean(user), responseMatched, sendFound: Boolean(send), sendEnabled: Boolean(send && !d.disabled(send)),
      generationActive: streaming, completionControl
    };
    return { user, node, row, nextUser, raw, complete, responseMatched, diagnostics };
  }
  globalThis.AiAgentDeepSeekGeneration = {
    editor,
    login: () => /\/sign_in|\/login|\/auth/.test(location.pathname) || Boolean(d.firstVisible(['input[type="password"]', 'input[autocomplete="one-time-code"]', '[data-testid="login-button"]'])),
    busy,
    control,
    canEnter: editor => editor?.matches('#chat-input, textarea[placeholder*="DeepSeek"], textarea[placeholder*="发送"]'),
    baseline: () => ({ users: userBubbles().length, answers: document.querySelectorAll(answers).length }),
    answer,
    conversation: () => /^\/a\/chat\/s\/[\w-]+\/?$/.test(location.pathname) ? location.origin + location.pathname : null
  };
})();
