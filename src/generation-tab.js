(() => {
  if (window !== window.top || globalThis.AiAgentGenerationTab) return;
  if (!['https://chatgpt.com', 'https://chat.deepseek.com'].includes(location.origin)) return;
  const d = globalThis.AiAgentGenerationDOM;
  let active = null;
  const failure = (code, message) => Object.assign(new Error(message), { code });
  async function request(message) {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw failure('connection', reply?.error || 'The extension connection was interrupted. Use Resume to check this run.');
    return reply.value;
  }
  function start(id) {
    if (active) return;
    const task = { id, actorId: crypto.randomUUID(), stopped: false, wake: new Set(), controller: new AbortController() };
    active = task;
    void execute(task).finally(() => { if (active === task) active = null; });
  }
  async function execute(task) {
    let adapter, run, pulse, observer, captureDiagnostics;
    const wake = () => { for (const resolve of task.wake) resolve(); task.wake.clear(); };
    const pause = () => new Promise(resolve => {
      const done = () => { clearTimeout(timer); task.wake.delete(done); resolve(); };
      const timer = setTimeout(done, 250); task.wake.add(done);
    });
    const check = () => {
      if (task.stopped) throw failure('stopped', 'Tracking stopped.');
      if (run?.url && adapter.conversation() !== run.url) throw failure('navigated', 'The AI tab moved away from this job’s conversation. Return to it and use Resume.');
    };
    const emit = data => request({ type: 'generation.event', id: task.id, actorId: task.actorId, data: { url: adapter?.conversation(), ...data } }).then(value => {
      if (value?.stopped) { task.stopped = true; throw failure('stopped', 'Tracking stopped.'); }
      return value;
    });
    async function until(probe, timeout, code, message) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { check(); const value = await probe(); if (value) return value; await pause(); }
      throw failure(code, typeof message === 'function' ? message() : message);
    }
    try {
      run = await request({ type: 'generation.attach', id: task.id, actorId: task.actorId });
      if (run.done) return;
      adapter = run.provider === 'chatgpt' ? globalThis.AiAgentChatGPTGeneration : globalThis.AiAgentDeepSeekGeneration;
      const matchesPrompt = editor => adapter.matchesPrompt ? adapter.matchesPrompt(editor, run.prompt) : d.normal(d.text(editor)) === d.normal(run.prompt);
      observer = new MutationObserver(wake); observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      for (const event of ['input', 'change', 'popstate', 'online']) window.addEventListener(event, wake, true);
      pulse = setInterval(() => { void emit({ kind: 'heartbeat', diagnostics: captureDiagnostics }).catch(() => { task.stopped = true; task.controller.abort(failure('stopped', 'Tracking disconnected.')); wake(); }); }, 10000);
      async function prepare() {
        let loginReported = false;
        const prepared = await until(async () => {
          if (adapter.answer(run).user) return { posted: true };
          if (adapter.login()) {
            if (!loginReported) { await emit({ kind: 'phase', phase: 'waiting-login' }); loginReported = true; }
            return null;
          }
          const current = adapter.editor();
          if (current && !adapter.busy()) return { editor: current };
          return null;
        }, 180000, 'not-ready', 'The chat is not ready. Sign in or finish loading in the AI tab, then use Resume.');
        if (prepared.posted) return;
        let editor = prepared.editor;
        await emit({ kind: 'phase', phase: 'preparing' });
        const baseline = adapter.baseline();
        if (run.provider !== 'chatgpt' && (baseline.users || baseline.answers)) throw failure('existing-chat', 'This tab already contains a conversation. The extension will not add a job prompt to it.');
        if (adapter.send) {
          const submission = await adapter.send(run, { signal: task.controller.signal, beforeSubmit: async () => {
            check();
            const permit = await emit({ kind: 'authorize', baseline });
            if (!permit.granted) throw failure('uncertain', 'Submission is already recorded or the run changed. Resume will check the conversation without resending.');
            run.sendIntentAt = Date.now();
          } });
          // The reference adapter returns immediately after its verified send action.
          // Receipt DOM and conversation links belong to capture, not submission success.
          await emit({ kind: 'phase', phase: 'submitted', diagnostics: submission.diagnostics });
          run.submittedAt = Date.now();
          return;
        }
        if (!matchesPrompt(editor)) d.fill(editor, run.prompt);
        let stableAt = null;
        const control = await until(() => {
          if (adapter.answer(run).user) return { posted: true };
          const current = adapter.editor();
          if (!current || adapter.login() || adapter.busy()) return null;
          // React/ProseMirror can replace the composer after handling input. Follow the
          // current editor only when it still contains this run's complete prompt.
          if (current !== editor) { editor = current; stableAt = null; }
          if (!matchesPrompt(current) || d.hasAttachment(current)) {
            stableAt = null; return null;
          }
          stableAt ||= Date.now();
          const button = adapter.control(current);
          if (Date.now() - stableAt < 500 || button && d.disabled(button)) return null;
          return button || (Date.now() - stableAt >= 1000 && adapter.canEnter(current) ? { keyboard: true } : null);
        }, 15000, 'input-not-accepted', () => {
          const current = adapter.editor(), button = current && adapter.control(current);
          const problem = !current ? 'The message editor disappeared.' : !matchesPrompt(current) ? 'The editor did not retain the complete prompt.' :
            button && d.disabled(button) ? 'The provider kept Send disabled.' : 'No ready Send control or supported Enter action was found.';
          return `${problem} Inspect the AI tab, then use Resume. If you send the prepared prompt yourself, Resume will collect its reply.`;
        });
        if (control.posted) return;
        const permit = await emit({ kind: 'authorize', baseline });
        if (!permit.granted) throw failure('uncertain', 'Submission is already recorded or the run changed. Use Resume to check the conversation; it will not resend.');
        // From this point onward, every recovery path observes only. A lost receipt cannot cause a second submission.
        run.sendIntentAt = Date.now();
        check();
        const current = adapter.editor();
        if (adapter.answer(run).user) return;
        if (current !== editor || adapter.busy() || adapter.login() || d.hasAttachment(editor) || !matchesPrompt(editor)) {
          throw failure('uncertain', 'The editor changed at submission. Inspect the AI tab; automatic submission will not be repeated.');
        }
        if (control.keyboard) {
          editor.focus({ preventScroll: true });
          for (const type of ['keydown', 'keyup']) editor.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        } else {
          if (!control.isConnected || adapter.control(editor) !== control || d.disabled(control)) throw failure('uncertain', 'The Send control changed at submission. Inspect the AI tab before continuing.');
          control.click();
        }
      }
      if (run.mode === 'prepare') await prepare();
      // A verified ChatGPT send does not depend on its receipt DOM. Manual sending
      // and DeepSeek still use the posted user turn to establish submission.
      if (run.provider !== 'chatgpt' || !run.sendIntentAt) await until(() => adapter.answer(run).user, 45000, 'uncertain', 'Could not confirm the submitted message. Inspect the AI tab, then use Resume to check again. Nothing will be resent.');
      if (!run.sendIntentAt) {
        if (run.provider !== 'chatgpt') await until(() => adapter.conversation(), 15000, 'missing-conversation', 'The posted prompt has no conversation link yet. Use Resume after the page finishes loading.');
        await emit({ kind: 'observed', marker: `DOCUMENT_RUN:${run.id}` });
        run.sendIntentAt = Date.now();
      } else if (!run.submittedAt) await emit({ kind: 'phase', phase: 'submitted' });
      run.url ||= adapter.conversation();
      let previous = '', changedAt = Date.now(), generatingReported = false;
      const reply = await until(async () => {
        const answer = adapter.answer(run);
        captureDiagnostics = answer.diagnostics;
        if (!answer.user && run.provider !== 'chatgpt') throw failure('conversation-changed', 'The submitted message is no longer visible. Return to this job’s conversation and use Resume.');
        const alert = [...document.querySelectorAll('[role="alert"]')].find(node => d.visible(node) && /network error|something went wrong|rate limit|too many requests|server busy/i.test(d.text(node)));
        if (alert) throw failure('provider-error', 'The provider reported a connection, usage, or generation error. Inspect the AI tab; use Resume after resolving it.');
        if (answer.node && !generatingReported) { await emit({ kind: 'phase', phase: 'generating', diagnostics: captureDiagnostics }); generatingReported = true; }
        if (answer.raw !== previous) { previous = answer.raw; changedAt = Date.now(); }
        const url = adapter.conversation();
        if (url && !run.url) { await emit({ kind: 'phase', phase: generatingReported ? 'generating' : 'submitted' }); run.url = url; }
        const completed = answer.complete || run.outputFormat !== 'json-code-block' && d.completedJSON(answer.raw, run);
        return answer.raw && (url || run.provider === 'chatgpt') && !adapter.busy(answer) && Date.now() - changedAt >= 1500 && completed ? answer : null;
      }, 300000, 'reply-timeout', 'The reply did not finish within five minutes. Use Resume to continue observing the same conversation; the prompt will not be sent again.');
      await emit({ kind: 'result', raw: reply.raw, diagnostics: captureDiagnostics });
    } catch (error) {
      if (error.code !== 'stopped') {
        try { await emit({ kind: 'error', code: error.code || 'page-error', message: error.message, diagnostics: error.diagnostics || captureDiagnostics }); }
        catch { /* The persistent intent remains authoritative if the extension or page disconnected. */ }
      }
    } finally {
      clearInterval(pulse); observer?.disconnect();
      for (const event of ['input', 'change', 'popstate', 'online']) window.removeEventListener(event, wake, true);
      wake();
    }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'generation.stop' && active?.id === message.id) {
      active.stopped = true; for (const resolve of active.wake) resolve();
      active.controller.abort(failure('stopped', 'Tracking stopped.'));
    }
  });
  globalThis.AiAgentGenerationTab = { start };
})();
