(() => {
  const d = globalThis.AiAgentGenerationDOM, native = globalThis.__techIntChatAdapterV2;
  if (!native) throw new Error('The bundled ChatGPT submission adapter is missing. Reload the extension.');
  const submitter = new native.ChatGPTAdapter();
  const answers = '[data-message-author-role="assistant"], [data-role="assistant"], [data-conversation-role="assistant"], [data-turn="assistant"], [data-chatgpt-search-unit-key$=":assistant"]';
  const users = '[data-message-author-role="user"], [data-role="user"], [data-conversation-role="user"], [data-turn="user"], [data-user-message-bubble], [data-chatgpt-search-unit-key$=":user"]';
  const markdown = '[data-markdown-text-style="assistant-message"]';
  const turns = '[data-turn-key], [data-testid^="conversation-turn"], [data-turn-id], article';
  const reasoning = '[data-role="reasoning"], [data-message-type="reasoning"], [data-testid="reasoning"], [data-testid="thinking"], [data-markdown-text-tone="tertiary"], [data-conversation-role="tool"]';
  const codeSelector = 'pre, [data-markdown-copy="code-block"]';
  const outsideComposer = node => !node.closest('form, #prompt-textarea, [data-testid="prompt-textarea"], [contenteditable="true"], [contenteditable="plaintext-only"]');
  const eligible = node => outsideComposer(node) && !node.closest(reasoning);
  const outermost = nodes => [...new Set(nodes)].filter(node => !nodes.some(other => other !== node && other.contains(node)));
  function postedUsers() {
    const nodes = [...document.querySelectorAll(users)].filter(outsideComposer);
    return nodes.filter(node => !nodes.some(other => other !== node && node.contains(other)));
  }
  function replyRoots() {
    return outermost([...document.querySelectorAll(`${answers}, ${markdown}`)].filter(node =>
      eligible(node) && !node.closest(users)));
  }
  function codeBlocks(root) {
    const blocks = [...(root.matches(codeSelector) ? [root] : []), ...root.querySelectorAll(codeSelector)]
      .filter(node => !node.closest(reasoning));
    return outermost(blocks).map(node => {
      const lines = [...node.querySelectorAll('.cm-content .cm-line')];
      const code = node.querySelector('code');
      // CodeMirror panels render one DOM line per source line. Preserve boundaries
      // and exclude the language header, Copy button, and line-number gutter.
      const raw = lines.length ? lines.map(line => line.textContent || '').join('\n') :
        code ? code.textContent : node.querySelector('.cm-content')?.textContent || node.textContent;
      return { node, raw: String(raw || '').trim() };
    });
  }
  function matchesRun(raw, run) {
    try { const value = JSON.parse(raw); return value?.requestId === run.jobId && value?.runId === run.id; }
    catch { return false; }
  }
  function busy(reply) {
    const stop = native.isGenerating() || Boolean(d.firstVisible(['button[aria-label="Stop"]', 'button[aria-label="Stop response"]']));
    const scopes = reply?.parts?.length ? reply.parts : [reply?.node || document];
    return stop || scopes.some(scope => [...scope.querySelectorAll('[data-is-streaming="true"], .result-streaming')]
      .some(d.visible) || Boolean(scope.matches?.('[data-is-streaming="true"], .result-streaming'))) ||
      Boolean(reply?.turn?.matches('[data-is-streaming="true"], .result-streaming'));
  }
  function answer(run) {
    const posted = postedUsers(), user = posted.filter(node => d.text(node).includes(`DOCUMENT_RUN:${run.id}`)).at(-1);
    const nextUser = user && posted.find(node => d.after(node, user));
    const roots = replyRoots();
    const bounded = roots.filter(node => (!user || d.after(node, user)) && (!nextUser || d.after(nextUser, node)));
    const groups = new Map();
    for (const root of bounded) {
      const turn = root.closest(turns) || root;
      const group = groups.get(turn) || { node: root, turn, parts: [], blocks: [] };
      group.parts.push(root); group.blocks.push(...codeBlocks(root)); groups.set(turn, group);
    }
    const candidates = [...groups.values()];
    const matched = candidates.filter(candidate => candidate.blocks.some(block => matchesRun(block.raw, run)));
    // A missing/virtualized user bubble requires matching job/run IDs in an
    // assistant code block. Never search the whole page for a JSON result.
    let selected = matched.at(-1) || (user ? candidates.findLast(candidate => candidate.blocks.length) || candidates.at(-1) : null);
    if (!selected && run.sendIntentAt && run.outputFormat !== 'json-code-block') {
      selected = candidates.findLast(candidate => d.completedJSON(candidate.parts.map(d.answerText).join('\n\n'), run));
    }
    const blocks = selected?.blocks || [];
    const raw = blocks.length ? blocks.map(block => block.raw).join('\n\n') :
      selected && run.outputFormat !== 'json-code-block' ? selected.parts.map(d.answerText).join('\n\n') : '';
    const editor = native.findEditor(), send = native.findSend(editor), sendReady = native.enabled(send);
    const lastContent = blocks.at(-1)?.node || selected?.parts.at(-1);
    const completeControl = Boolean(selected && [...selected.turn.querySelectorAll(
      '[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], button[aria-label="Copy response"], button[aria-label="Copy message"], button[aria-label="Copy"]'
    )].some(button => d.visible(button) && !d.disabled(button) && !button.closest(`${codeSelector}, ${users}, ${reasoning}`) &&
      d.after(button, lastContent)));
    const streaming = busy(selected);
    const complete = !streaming && (sendReady || completeControl);
    const diagnostics = {
      stage: 'capture', code: !selected ? 'reply_not_found' : !raw ? 'code_block_missing' : streaming ? 'waiting_for_idle' : complete ? 'reply_ready' : 'waiting_for_completion',
      version: native.version, extensionVersion: globalThis.AiAgentBuild?.version || 'unknown', buildId: globalThis.AiAgentBuild?.id || 'unknown',
      assistantCandidates: roots.length, boundedCandidates: candidates.length, codeBlocks: blocks.length, replyChars: raw.length,
      userMatched: Boolean(user), responseMatched: blocks.some(block => matchesRun(block.raw, run)), sendFound: Boolean(send),
      sendEnabled: sendReady, generationActive: streaming, completionControl: completeControl
    };
    return { user, node: selected?.node || null, parts: selected?.parts, turn: selected?.turn, raw, complete, diagnostics };
  }
  globalThis.AiAgentChatGPTGeneration = {
    editor: native.findEditor,
    login: () => Boolean(d.firstVisible(['form[data-logged-out]', '[data-testid="login-button"]', '[data-testid="sign-in-button"]', 'input[type="password"]', 'a[href*="/auth/login"]'])),
    busy,
    baseline: () => ({ users: postedUsers().length, answers: replyRoots().length }),
    send: (run, { signal, beforeSubmit }) => submitter.send(run.prompt, signal, {
      requestId: run.id, source: 'panel', action: 'prepared', replaceDraft: true, beforeSubmit
    }),
    answer,
    conversation: () => /^\/(?:g\/[\w-]+\/)?c\/[\w-]+\/?$/.test(location.pathname) ? location.origin + location.pathname : null
  };
})();
