(() => {
  if (window !== window.top || globalThis.AiAgentGenerationTab) return;
  if (!['https://chatgpt.com', 'https://chat.deepseek.com'].includes(location.origin)) return;
  const d = globalThis.AiAgentGenerationDOM;
  let active = null;
  const failure = (code, message) => Object.assign(new Error(message), { code });
  async function request(message) {
    let timer;
    try {
      const reply = await Promise.race([chrome.runtime.sendMessage(message), new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure('connection', 'The extension did not respond.')), 8000);
      })]);
      if (!reply) throw failure('connection', 'The extension connection was interrupted.');
      // An explicit ownership/validation denial must never be retried as a
      // network failure. A missing transport reply has different semantics.
      if (!reply.ok) throw failure('generation-denied', reply.error || 'This generation can no longer use this page.');
      return reply.value;
    } catch (error) {
      if (['connection', 'generation-denied'].includes(error.code)) throw error;
      throw failure('connection', 'The extension connection was interrupted.');
    } finally { clearTimeout(timer); }
  }
  function start(id) {
    if (active) {
      if (active.id === id) for (const resolve of active.wake) resolve();
      return;
    }
    const task = { id, actorId: crypto.randomUUID(), stopped: false, wake: new Set(), controller: new AbortController(),
      disconnectedAt: null, failure: null, pausedMs: 0, frozenAt: null };
    active = task;
    void execute(task).finally(() => { if (active === task) active = null; });
  }
  async function execute(task) {
    let adapter, run, pulse, observer, captureDiagnostics, heartbeatPending = false;
    const connectionLostMessage = () => run?.provider === 'deepseek'
      ? 'Tracking lost its connection. Use Resume to keep checking this chat without sending again.'
      : 'Tracking lost its connection. Reconnecting to this chat without sending again.';
    const elapsedTime = () => Date.now() - task.pausedMs - (task.frozenAt == null ? 0 : Date.now() - task.frozenAt);
    const wake = () => { for (const resolve of task.wake) resolve(); task.wake.clear(); };
    const pause = () => new Promise(resolve => {
      const done = () => { clearTimeout(timer); task.wake.delete(done); resolve(); };
      const timer = setTimeout(done, 250); task.wake.add(done);
    });
    const check = () => {
      if (task.stopped) throw failure('stopped', 'Tracking stopped.');
      if (task.failure) throw task.failure;
      if (task.disconnectedAt != null && elapsedTime() - task.disconnectedAt >= 30000) {
        throw failure('transport-disconnected', connectionLostMessage());
      }
      if (run?.url && adapter.conversation() !== run.url) throw failure('navigated', 'The AI tab moved away from this job’s conversation. Return to it and use Resume.');
    };
    const emit = async (data, retry = data.kind !== 'authorize') => {
      // DeepSeek uses explicit Resume for connection recovery while its
      // single-tab workflow is restored. Never replay a failed event or send.
      if (run?.provider === 'deepseek') retry = false;
      const deadline = elapsedTime() + 30000;
      while (true) {
        if (data.kind !== 'error') {
          if (task.stopped) throw failure('stopped', 'Tracking stopped.');
          if (task.failure) throw task.failure;
        }
        try {
          const value = await request({ type: 'generation.event', id: task.id, actorId: task.actorId, data: { url: adapter?.conversation(), ...data } });
          if (value?.stopped) { task.stopped = true; throw failure('stopped', 'Tracking stopped.'); }
          task.disconnectedAt = null;
          return value;
        } catch (error) {
          if (error.code !== 'connection') throw error;
          task.disconnectedAt ??= elapsedTime();
          // Never repeat authorization: the service may have persisted send
          // intent before its acknowledgment was lost. Recovery observes only.
          if (!retry) throw error;
          if (elapsedTime() >= deadline || task.stopped) throw failure(task.stopped ? 'stopped' : 'transport-disconnected', connectionLostMessage());
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    };
    const heartbeat = async () => {
      if (heartbeatPending || task.stopped) return;
      heartbeatPending = true;
      try { await emit({ kind: 'heartbeat', diagnostics: captureDiagnostics }, false); }
      catch (error) {
        if (error.code !== 'connection') { task.failure = error; task.controller.abort(error); }
        // A transient transport failure leaves the observer alive. The service
        // watchdog reports stale status if the connection remains unavailable.
      } finally { heartbeatPending = false; wake(); }
    };
    const freeze = () => { task.frozenAt ??= Date.now(); };
    const resume = () => {
      if (task.frozenAt != null) { task.pausedMs += Date.now() - task.frozenAt; task.frozenAt = null; }
      wake(); if (run && !task.stopped) void heartbeat();
    };
    const visibility = () => { if (!document.hidden) resume(); };
    async function until(probe, timeout, code, message) {
      const started = Date.now(), paused = task.pausedMs;
      // Frozen pages do not consume the observation timeout. Probe once on
      // wake so a reply that finished in the background can be recognized.
      while (true) {
        check(); const value = await probe(); if (value) return value;
        if (Date.now() - started - (task.pausedMs - paused) >= timeout) break;
        await pause();
      }
      throw failure(code, typeof message === 'function' ? message() : message);
    }
    try {
      run = await request({ type: 'generation.attach', id: task.id, actorId: task.actorId });
      if (run.done) return;
      adapter = run.provider === 'chatgpt' ? globalThis.AiAgentChatGPTGeneration : globalThis.AiAgentDeepSeekGeneration;
      const matchesPrompt = editor => adapter.matchesPrompt ? adapter.matchesPrompt(editor, run.prompt) : d.normal(d.text(editor)) === d.normal(run.prompt);
      observer = new MutationObserver(wake); observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      for (const event of ['input', 'change', 'popstate', 'online']) window.addEventListener(event, wake, true);
      document.addEventListener('freeze', freeze); document.addEventListener('resume', resume);
      document.addEventListener('visibilitychange', visibility); window.addEventListener('pageshow', resume);
      pulse = setInterval(() => { void heartbeat(); }, 10000);
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
        run.baseline = baseline;
        if (!run.usesExistingTab && (baseline.users || baseline.answers)) throw failure('existing-chat', 'This tab already contains a conversation. Open a new chat and use Resume.');
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
      // Restore DeepSeek's posted-prompt anchor before observing its reply.
      // ChatGPT keeps its verified-submission path without requiring a bubble.
      if (run.provider === 'deepseek' || !run.submittedAt && !run.sendIntentAt) await until(() => {
        const answer = adapter.answer(run);
        captureDiagnostics = answer.diagnostics;
        return answer.user;
      }, 45000, 'uncertain', 'Could not confirm the submitted message. Inspect the AI tab, then use Resume to check again. Nothing will be resent.');
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
        if (!answer.user && run.provider === 'deepseek') throw failure('conversation-changed', 'The submitted message is no longer available. Return to this job’s conversation and use Resume.');
        const alert = [...document.querySelectorAll('[role="alert"]')].find(node => d.visible(node) && /network error|something went wrong|rate limit|too many requests|server busy/i.test(d.text(node)));
        if (alert) throw failure('provider-error', 'The provider reported a connection, usage, or generation error. Inspect the AI tab; use Resume after resolving it.');
        if ((answer.node || adapter.busy(answer)) && !generatingReported) { await emit({ kind: 'phase', phase: 'generating', diagnostics: captureDiagnostics }); generatingReported = true; }
        if (answer.raw !== previous) { previous = answer.raw; changedAt = Date.now(); }
        const url = adapter.conversation();
        if (url && !run.url) { await emit({ kind: 'phase', phase: generatingReported ? 'generating' : 'submitted' }); run.url = url; }
        const completed = answer.complete || run.outputFormat !== 'json-code-block' && d.completedJSON(answer.raw, run);
        const streaming = adapter.busy(answer), stableMs = Date.now() - changedAt;
        if (run.provider === 'deepseek') captureDiagnostics = { ...captureDiagnostics, conversationFound: Boolean(url), stableMs,
          code: streaming ? 'waiting_for_idle' : !url ? 'waiting_for_conversation' : completed && stableMs < 1500 ? 'waiting_for_stability' : captureDiagnostics?.code };
        return answer.raw && (url || run.provider === 'chatgpt') && !streaming && stableMs >= 1500 && completed ? answer : null;
      }, 300000, 'reply-timeout', () => {
        const problem = run.provider === 'deepseek' && captureDiagnostics?.replyChars && !captureDiagnostics.generationActive
          ? 'DeepSeek has a reply, but its final document output could not be confirmed. Open Details to inspect the capture diagnostics.'
          : 'The reply did not finish within five minutes.';
        return `${problem} Use Resume to continue observing the same conversation; the prompt will not be sent again.`;
      });
      await emit({ kind: 'result', raw: reply.raw, diagnostics: captureDiagnostics });
    } catch (error) {
      if (error.code !== 'stopped') {
        task.controller.abort(error);
        try { await emit({ kind: 'error', code: error.code || 'page-error', message: error.message, diagnostics: error.diagnostics || captureDiagnostics }, false); }
        catch { /* The persistent intent remains authoritative if the extension or page disconnected. */ }
      }
    } finally {
      clearInterval(pulse); observer?.disconnect();
      for (const event of ['input', 'change', 'popstate', 'online']) window.removeEventListener(event, wake, true);
      document.removeEventListener('freeze', freeze); document.removeEventListener('resume', resume);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pageshow', resume);
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
