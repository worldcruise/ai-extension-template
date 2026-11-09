// Shared isolated-world adapter for the extension iframe and its queue tab.
(() => {
  if (window !== window.top && location.ancestorOrigins[0] !== chrome.runtime.getURL('').replace(/\/$/, '')) return;
  if (globalThis.AiAgentChatQueue) return;
  const buildId = globalThis.AiAgentBuild?.id || 'unknown';
  function createPageAdapter(emit) {
    let active;
    const authorNodes = () => [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')];
    const error = (code, message) => Object.assign(new Error(message), { code });
    // The iframe remains mounted while Studio is selected. Check visibility
    // inside its document rather than the parent view's layout rectangles.
    const visible = node => {
      if (!node?.isConnected || node.closest('[hidden], [inert]')) return false;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    const first = selectors => [...document.querySelectorAll(selectors)].find(visible);
    const editor = () => first('#prompt-textarea, [data-composer-markdown][contenteditable="true"], textarea[data-mobile-composer-prompt]');
    function editorText(node) {
      if (!node) return '';
      if (node.matches('textarea, input')) return node.value;
      // ProseMirror uses paragraphs and trailing BRs. innerText depends on CSS
      // margins and whether the parent iframe is hidden, so it is not a stable
      // representation of the text that the editor will submit.
      function read(current) {
        if (current.nodeType === Node.TEXT_NODE) return current.nodeValue;
        if (current.nodeType !== Node.ELEMENT_NODE) return '';
        if (current.nodeName === 'BR') return '\n';
        let content = '';
        for (const child of current.childNodes) {
          if (/^(P|DIV|LI|PRE|BLOCKQUOTE)$/.test(child.nodeName) && content && !content.endsWith('\n')) content += '\n';
          content += read(child);
        }
        return /^(P|DIV|LI|PRE|BLOCKQUOTE)$/.test(current.nodeName) ? content + '\n' : content;
      }
      return read(node);
    }
    const comparable = value => value.replace(/\r\n?/g, '\n').replace(/[\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n').replace(/\n+/g, '\n').trim();
    const sameDraft = (node, prompt) => comparable(editorText(node)) === comparable(prompt);
    const stopButton = () => first('button[data-testid="stop-button"], button[aria-label*="stop generating" i], button[aria-label*="stop streaming" i]');
    const busy = () => Boolean(stopButton() || first('[data-is-streaming="true"]'));
    function inspectConnection() {
      const composer = editor();
      const login = first('form[data-logged-out], [data-testid="login-button"], [data-testid="signup-button"], [data-testid="sign-in-button"], [data-testid="logged-out"], a[href*="/auth/login"], a[href*="/auth/signup"]') ||
        [...document.querySelectorAll('button, a, [role="button"]')].find(node => visible(node) && /^(?:log in|sign in|sign up|create account)$/i.test((node.getAttribute('aria-label') || node.textContent).trim()));
      const account = document.querySelector('[data-testid="accounts-profile-button"], [data-testid="profile-button"], [data-testid="user-menu-button"], [data-testid="profile-menu-button"], [data-testid="account-menu-trigger"]') ||
        first('button[aria-label*="profile" i], button[aria-label*="account" i], button[aria-label*="user menu" i], [role="button"][aria-label*="profile" i], [role="button"][aria-label*="account" i]');
      const history = [...document.querySelectorAll('a[href]')].some(node => {
        try { const url = new URL(node.getAttribute('href'), location.href); return url.origin === location.origin && /^\/(?:g\/[\w-]+\/)?c\/[\w-]+\/?$/.test(url.pathname); }
        catch { return false; }
      });
      const conversation = /^\/(?:g\/[\w-]+\/)?c\/[\w-]+\/?$/.test(location.pathname) && authorNodes().length > 0;
      const evidence = [account && 'account-control', history && 'saved-conversations', conversation && 'loaded-conversation'].filter(Boolean);
      return { authState: login ? 'signed-out' : evidence.length ? 'signed-in' : 'unknown',
        composerReady: Boolean(composer && !composer.disabled && composer.getAttribute('contenteditable') !== 'false'),
        composerPresent: Boolean(composer), sendControl: Boolean(sendButton()), busy: busy(),
        hasDraft: Boolean(editorText(composer).trim()), evidence, buildId };
    }
    function blocked() {
      const notice = [...document.querySelectorAll('[role="alert"], [data-testid="conversation-error"]')].filter(visible).map(node => node.innerText).join(' ');
      if (/rate limit|too many requests|reached (?:your|the).*limit|try again (?:at|after)|unusual activity|verify you are human/i.test(notice)) {
        throw error('usage-limit', 'ChatGPT reports a usage limit or verification requirement. Inspect Chat before continuing.');
      }
    }
    function preflight({ allowBusy = false, allowDraft = false, sessionConfirmed = false } = {}) {
      blocked();
      const connection = inspectConnection();
      if (connection.authState === 'signed-out') {
        throw error('signed-out', 'Sign in to ChatGPT in a tab, then reload the sidebar.');
      }
      if (connection.authState === 'unknown' && !sessionConfirmed) throw error('login-unverified', 'ChatGPT’s account controls were not recognized. Use Check connection to confirm your signed-in session.');
      const composer = editor();
      if (!allowBusy && busy()) throw error('chat-busy', 'ChatGPT is already generating. Let it finish before starting the queue.');
      if (!composer || (!allowBusy && (composer.disabled || composer.getAttribute('contenteditable') === 'false'))) throw error('composer-unavailable', 'The ChatGPT composer is not ready. Open Chat and try again.');
      const attachments = composer.closest('form')?.querySelector('[data-testid="file-thumbnail"], [data-testid="attachment-preview"], [data-file-id]');
      if (!allowDraft && (editorText(composer).trim() || attachments)) throw error('existing-draft', 'Chat has an unsent draft or attachment. Send or clear it before starting the queue.');
      return { authenticated: connection.authState === 'signed-in', authState: connection.authState,
        sessionConfirmed: sessionConfirmed === true, busy: busy(), draft: Boolean(editorText(composer).trim()), url: location.origin + location.pathname };
    }
    function writeEditor(node, value) {
      if (!node?.isConnected || editor() !== node) throw error('composer-changed', 'The editor changed before insertion. No text was inserted.');
      if (editorText(node).trim()) throw error('existing-draft', 'Unexpected draft text appeared before insertion. It was preserved.');
      if (node.matches('textarea')) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, value);
      } else {
        node.focus();
        if (!node.isConnected || editor() !== node) throw error('composer-changed', 'The editor was replaced on focus. No reinsertion was attempted.');
        if (editorText(node).trim()) throw error('existing-draft', 'Unexpected draft text appeared on focus. It was preserved.');
        const range = document.createRange(); range.selectNodeContents(node);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        if (!node.isConnected || editor() !== node || editorText(node).trim()) throw error('composer-changed', 'The editor changed before insertion. The current draft was preserved.');
        if (!document.execCommand('insertText', false, value)) {
          if (!node.isConnected || editor() !== node) throw error('composer-changed', 'The editor was replaced during insertion. No reinsertion was attempted.');
          if (editorText(node).trim()) throw error('composer-changed', 'The editor retained unexpected text. It was preserved.');
          node.textContent = value;
        }
      }
      if (node.isConnected && editor() === node) node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }
    function sendButton() {
      const known = first('button#composer-submit-button, button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]');
      if (known) return known;
      const composer = editor();
      const roots = [composer?.closest('form'), composer?.closest('[data-testid="composer"], [data-testid="composer-root"], #composer-background, #thread-bottom-container'), composer?.parentElement].filter(Boolean);
      for (const root of roots) {
        const button = [...root.querySelectorAll('button, [role="button"]')].find(node => visible(node) &&
          (node.matches('button[type="submit"]') || /^(?:send|send prompt|send message)$/i.test((node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent).trim())));
        if (button) return button;
      }
      return null;
    }
    const canSend = button => Boolean(button && visible(button) && !button.disabled && !button.matches(':disabled') && button.getAttribute('aria-disabled') !== 'true');
    function messageId(node) {
      return node?.getAttribute('data-message-id') || node?.closest('[data-message-id]')?.getAttribute('data-message-id') || node?.closest('article')?.getAttribute('data-testid') || '';
    }
    function matchingReply(deliveryId) {
      const nodes = authorNodes();
      const index = nodes.findLastIndex(node => node.dataset.messageAuthorRole === 'user' && node.innerText.includes(`AI_AGENT_DELIVERY:${deliveryId}`));
      if (index < 0) return {};
      let assistant;
      for (let cursor = index + 1; cursor < nodes.length; cursor++) {
        if (nodes[cursor].dataset.messageAuthorRole === 'user') break;
        if (nodes[cursor].dataset.messageAuthorRole === 'assistant') assistant = nodes[cursor];
      }
      return { user: nodes[index], assistant };
    }
    function responseText(node) {
      if (!node) return '';
      const content = [...node.querySelectorAll('.markdown, [data-message-content]')].at(-1) || node;
      const code = content.querySelectorAll('pre code');
      return (code.length === 1 ? code[0].innerText : content.innerText).trim();
    }
    function wait(check, signal, timeout = 10000, timeoutError) {
      return new Promise((resolve, reject) => {
        let timer, deadline, observer, complete = false;
        const finish = (failure, value) => {
          if (complete) return; complete = true;
          clearInterval(timer); clearTimeout(deadline); observer?.disconnect();
          signal?.removeEventListener('abort', abort);
          failure ? reject(failure) : resolve(value);
        };
        const abort = () => finish(error('interrupted', 'ChatGPT navigation or manual interaction interrupted this request. Inspect its conversation before retrying.'));
        const inspect = () => {
          try { const result = check(); if (result) finish(null, result); }
          catch (failure) { finish(failure); }
        };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        observer = new MutationObserver(inspect);
        observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'data-is-streaming'] });
        timer = setInterval(inspect, 250);
        deadline = setTimeout(() => finish(timeoutError?.() || error('timeout', 'ChatGPT took too long. The request needs review; it will not be resent automatically.')), timeout);
        inspect();
      });
    }
    async function collect(data, operation, allowNewUrl) {
      operation.phase = 'collecting';
      let currentPath = location.pathname, raw = '', changedAt = performance.now(), sawBusy = busy(), lastProgress = '', registeredUrl = '';
      const acknowledgementDeadline = performance.now() + 15000;
      return wait(() => {
        if (location.pathname !== currentPath) {
          if (allowNewUrl && currentPath === '/' && /^\/c\/[\w-]+\/?$/.test(location.pathname)) { currentPath = location.pathname; allowNewUrl = false; }
          else throw error('navigation', 'The conversation changed. Open the recorded job chat before recovering this request.');
        }
        const { user, assistant } = matchingReply(data.deliveryId);
        if (!user) {
          blocked();
          if (performance.now() > acknowledgementDeadline) throw error('send-unacknowledged', 'Send was dispatched, but ChatGPT did not show the matching user message. Inspect the conversation before retrying; this attempt will not be sent twice.');
          return false;
        }
        if (!operation.acknowledged) { operation.acknowledged = true; operation.timestamps.acknowledgedAt = Date.now(); }
        const url = location.origin + location.pathname;
        if (/^\/(?:g\/[\w-]+\/)?c\/[\w-]+\/?$/.test(location.pathname) && registeredUrl !== url) {
          registeredUrl = url;
          emit({ type: 'queue.progress', operationId: operation.id, phase: 'registered', url, userMessageId: messageId(user), assistantMessageId: messageId(assistant), diagnostics: operation.diagnostic('acknowledged') });
        }
        const progress = { phase: assistant ? 'generating' : 'submitted', url, userMessageId: messageId(user), assistantMessageId: messageId(assistant) };
        const serialized = JSON.stringify(progress);
        if (serialized !== lastProgress) { lastProgress = serialized; emit({ type: 'queue.progress', operationId: operation.id, ...progress, diagnostics: operation.diagnostic('collecting') }); }
        const next = responseText(assistant);
        if (next.length > 500000) throw error('oversize', 'The ChatGPT response exceeds the local result size limit.');
        if (next !== raw) { raw = next; changedAt = performance.now(); }
        const generating = busy(); if (generating) sawBusy = true;
        const article = assistant?.closest('article') || assistant;
        const finalActions = article?.querySelector('[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], button[aria-label="Copy"]');
        if (!raw || generating || !finalActions || !visible(finalActions) || finalActions.disabled || performance.now() - changedAt < 1250) { blocked(); return false; }
        if (!/^\/(?:g\/[\w-]+\/)?c\/[\w-]+\/?$/.test(location.pathname)) throw error('conversation-url', 'The result has no saved conversation URL. Inspect ChatGPT before continuing.');
        const completedError = /^(?:i(?:'m| am) sorry|i (?:cannot|can't|won't) (?:help|assist|provide))/i.test(raw) ||
          Boolean(assistant?.querySelector('[data-testid="conversation-error"], [role="alert"]'));
        return { raw, url, deliveryId: data.deliveryId, userMessageId: messageId(user), assistantMessageId: messageId(assistant), buildId,
          completed: true, kind: completedError ? 'error' : 'response', diagnostics: operation.diagnostic('collecting') };
      }, operation.controller.signal, 600000);
    }
    async function execute(action, data, id) {
      if (action === 'inspect') return inspectConnection();
      if (action === 'inspect-prepared') {
        if (typeof data?.deliveryId !== 'string' || typeof data.prompt !== 'string' || data.prompt.length > 350000) throw error('invalid-prompt', 'The prepared draft reference is invalid.');
        const match = matchingReply(data.deliveryId);
        return { ...inspectConnection(), url: location.origin + location.pathname, existingDelivery: Boolean(match.user),
          preparedDraftMatches: sameDraft(editor(), data.prompt), userMessageId: messageId(match.user), assistantMessageId: messageId(match.assistant) };
      }
      if (['preflight', 'submit'].includes(action) && data?.hostBuildId && data.hostBuildId !== buildId) throw error('revision-mismatch', 'The host and ChatGPT adapter build fingerprints differ. No prompt was submitted.');
      if (action === 'preflight') return { ...preflight({ sessionConfirmed: data?.sessionConfirmed === true }), buildId };
      if (!['submit', 'recover'].includes(action) || active || typeof data?.deliveryId !== 'string' || !/^[\w-]{1,100}$/.test(data.deliveryId)) throw error('busy', 'The ChatGPT connection is busy or the request is invalid.');
      const operation = { id, controller: new AbortController(), authorizing: null, writing: false, phase: 'preflight',
        timestamps: { startedAt: Date.now() }, initialPath: location.pathname, initialEditor: null, identityChanged: false, intent: false, dispatched: false, acknowledged: false };
      operation.diagnostic = phase => {
        const current = editor(), expected = comparable(typeof data.prompt === 'string' ? data.prompt : ''), observed = comparable(editorText(current));
        if (operation.initialEditor && current !== operation.initialEditor) operation.identityChanged = true;
        let mismatchAt = 0; while (mismatchAt < Math.min(expected.length, observed.length) && expected[mismatchAt] === observed[mismatchAt]) mismatchAt++;
        return { schemaVersion: 1, requestId: data.requestId, deliveryId: data.deliveryId, operationId: id,
          phase: phase || operation.phase, buildId, timestamps: { ...operation.timestamps },
          editor: { type: !current ? 'missing' : current.matches('textarea') ? 'textarea' : current.isContentEditable ? 'contenteditable' : 'other',
            connected: current?.isConnected === true, identityChanged: operation.identityChanged,
            expectedLength: expected.length, observedLength: observed.length, mismatchAt: expected === observed ? -1 : mismatchAt },
          send: { intent: operation.intent, dispatched: operation.dispatched, acknowledged: operation.acknowledged } };
      };
      active = operation;
      const manualInput = event => { if (event.isTrusted && !operation.writing && (event.target === editor() || editor()?.contains(event.target))) operation.controller.abort(); };
      const manualStop = event => { if (event.isTrusted && event.target.closest('button') === stopButton()) operation.controller.abort(); };
      document.addEventListener('input', manualInput, true); document.addEventListener('click', manualStop, true);
      try {
        if (action === 'recover') {
          preflight({ allowBusy: true, allowDraft: true, sessionConfirmed: data.sessionConfirmed === true });
          await wait(() => matchingReply(data.deliveryId).user, operation.controller.signal, 10000);
          return await collect(data, operation, location.pathname === '/');
        }
        if (typeof data.prompt !== 'string' || data.prompt.length > 350000 || !data.prompt.includes(`AI_AGENT_DELIVERY:${data.deliveryId}`)) throw error('invalid-prompt', 'The queued prompt is invalid or too large.');
        if (data.resumePrepared && matchingReply(data.deliveryId).user) return await collect(data, operation, location.pathname === '/');
        preflight({ allowDraft: data.resumePrepared === true, sessionConfirmed: data.sessionConfirmed === true });
        const composer = editor(); operation.initialEditor = composer; operation.phase = 'inserting';
        if (!composer?.isConnected) throw error('composer-changed', 'The active editor is unavailable. No prompt was inserted.');
        if (!data.resumePrepared && (editorText(composer).trim() || composer.closest('form')?.querySelector('[data-testid="file-thumbnail"], [data-testid="attachment-preview"], [data-file-id]'))) {
          throw error('existing-draft', 'The active editor has an unexpected draft or attachment. It was preserved.');
        }
        operation.writing = true;
        try {
          if (data.resumePrepared) {
            if (!sameDraft(composer, data.prompt)) throw error('composer-changed', 'The saved prepared prompt does not match this draft. Your draft was preserved.');
          } else writeEditor(composer, data.prompt);
        } finally { operation.writing = false; }
        operation.timestamps.insertedAt = Date.now(); operation.phase = 'readback';
        const retained = () => {
          if (location.pathname !== operation.initialPath) throw error('navigation', 'The conversation changed before Send. The draft was preserved; no click was issued.');
          const current = editor(); if (current !== composer) operation.identityChanged = true;
          return Boolean(current?.isConnected && sameDraft(current, data.prompt));
        };
        await wait(retained, operation.controller.signal, 5000,
          () => error('composer-changed', 'The composer text changed. The queued prompt was not sent.'));
        operation.timestamps.retainedAt = Date.now(); operation.phase = 'waiting-send';
        await wait(() => {
          if (!retained()) throw error('composer-changed', 'The composer text changed. The queued prompt was not sent.');
          return canSend(sendButton());
        }, operation.controller.signal, 10000, () => error('send-unavailable', 'The prompt is prepared, but ChatGPT has not enabled its Send control. Check Chat before continuing.'));
        // The host persists send intent and checks Pause before granting this
        // one-shot authorization. No click occurs if local saving fails.
        if (!retained()) throw error('composer-changed', 'The active editor no longer retains the prompt. No authorization was requested.');
        operation.phase = 'prepared'; operation.timestamps.preparedAt = Date.now();
        const authorized = await new Promise((resolve, reject) => {
          operation.authorizing = resolve;
          operation.authorizationTimer = setTimeout(() => reject(error('authorization', 'The send could not be saved locally. The prompt was not submitted.')), 15000);
          operation.controller.signal.addEventListener('abort', () => reject(error('interrupted', 'The send was interrupted.')), { once: true });
          emit({ type: 'queue.progress', operationId: id, phase: 'prepared', url: location.origin + location.pathname, diagnostics: operation.diagnostic() });
        });
        clearTimeout(operation.authorizationTimer); operation.authorizing = null;
        if (!authorized) {
          throw error('paused', 'Queue paused before sending.');
        }
        operation.intent = true;
        const boundary = () => {
          if (inspectConnection().authState === 'signed-out') throw error('signed-out', 'ChatGPT signed out before submission.');
          if (operation.controller.signal.aborted || busy() || !retained()) throw error('composer-changed', 'The composer changed before submission. Inspect the draft.');
          if (editor()?.closest('form')?.querySelector('[data-testid="file-thumbnail"], [data-testid="attachment-preview"], [data-file-id]')) throw error('existing-draft', 'An unexpected attachment appeared. The draft was preserved.');
        };
        boundary();
        const button = sendButton();
        if (!canSend(button)) throw error('send-unavailable', 'The Send button is unavailable. Inspect ChatGPT before retrying.');
        button.focus({ preventScroll: true });
        boundary();
        if (!button.isConnected || sendButton() !== button || !canSend(button)) throw error('send-unavailable', 'The Send control changed before dispatch. No click was issued.');
        button.click();
        operation.dispatched = true; operation.phase = 'dispatched'; operation.timestamps.dispatchedAt = Date.now();
        emit({ type: 'queue.progress', operationId: id, phase: 'dispatched', url: location.origin + location.pathname, diagnostics: operation.diagnostic() });
        return await collect(data, operation, location.pathname === '/');
      } catch (failure) {
        operation.timestamps.failedAt = Date.now();
        failure.diagnostics = operation.diagnostic();
        throw failure;
      } finally {
        clearTimeout(operation.authorizationTimer);
        document.removeEventListener('input', manualInput, true); document.removeEventListener('click', manualStop, true);
        active = null;
      }
    }
    return { execute, inspectConnection, authorize(id, allowed) { if (active?.id === id) active.authorizing?.(allowed === true); }, dispose() { active?.controller.abort(); } };
  }
  globalThis.AiAgentChatQueue = { createPageAdapter };
})();
