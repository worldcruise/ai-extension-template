// Executed only by the isolated HTTPS test server, never bundled with the extension.
export function generationFixture() {
  if (window !== window.top || localStorage.getItem('generationFixtureEnabled') !== 'yes') return;
  const provider = location.host === 'chatgpt.com' ? 'chatgpt' : 'deepseek';
  const mode = localStorage.getItem('generationFixtureMode') || 'wrapper';
  const currentLayout = mode.startsWith('rich-current') || mode.startsWith('rich-search');
  const noLink = mode.includes('no-link') || mode === 'rich-no-user';
  const delay = Number(localStorage.getItem('generationFixtureDelay') || 1500);
  document.body.replaceChildren(); document.body.style.display = 'block';
  document.body.dataset.generationFixtureMode = mode;
  const transcript = document.createElement('main'); transcript.style.display = 'block'; document.body.append(transcript);
  const account = document.createElement('button'); account.dataset.testid = 'accounts-profile-button'; account.textContent = 'Fixture account'; document.body.append(account);
  const threadKey = () => 'generationThread:' + location.pathname + location.search;
  function renderThread(thread) {
    transcript.replaceChildren();
    document.getElementById('finished-composer')?.remove();
    const row = document.createElement(currentLayout ? 'section' : 'article');
    if (currentLayout) { row.dataset.turnKey = 'fixture-turn'; row.contentEditable = 'false'; transcript.append(row); }
    const user = document.createElement('div');
    if (currentLayout) {
      if (mode.startsWith('rich-search')) user.dataset.chatgptSearchUnitKey = 'fixture:user';
      else user.dataset.userMessageBubble = '';
    } else if (provider === 'chatgpt') user.dataset.messageAuthorRole = 'user';
    user.textContent = thread.prompt; user.style.whiteSpace = 'pre-wrap';
    if (mode !== 'rich-no-user' && mode !== 'rich-current-no-user') (currentLayout ? row : transcript).append(user);
    if (provider === 'deepseek') {
      const think = document.createElement('div'); think.className = 'ds-think-content';
      const markdown = document.createElement('div'); markdown.className = 'ds-markdown'; markdown.textContent = 'Reasoning, not the final answer. ' + thread.prompt.slice(0, 65); think.append(markdown); transcript.append(think);
    }
    if (provider === 'chatgpt' && mode.startsWith('rich')) {
      const thinking = document.createElement('div');
      if (currentLayout) {
        thinking.dataset.markdownTextStyle = 'assistant-message'; thinking.dataset.markdownTextTone = 'tertiary';
        const pre = document.createElement('pre'), code = document.createElement('code');
        code.textContent = thread.raw; pre.append(code); thinking.append(pre); row.append(thinking);
      } else { thinking.dataset.messageAuthorRole = 'assistant'; thinking.textContent = 'Let me think about the candidate facts first.'; transcript.append(thinking); }
    }
    const answer = document.createElement('div'), pre = document.createElement('pre'), code = document.createElement('code');
    if (currentLayout) {
      if (mode.startsWith('rich-search')) answer.dataset.chatgptSearchUnitKey = 'fixture:assistant';
      else answer.dataset.markdownTextStyle = 'assistant-message';
    } else if (provider === 'chatgpt') answer.dataset.messageAuthorRole = 'assistant'; else answer.className = 'ds-markdown';
    let writeCode = value => { code.textContent = value; };
    if (mode.startsWith('rich-current')) {
      const panel = document.createElement('div'), header = document.createElement('div'), content = document.createElement('div'), copyCode = document.createElement('button');
      panel.dataset.markdownCopy = 'code-block'; header.textContent = 'json'; copyCode.textContent = 'Copy code'; copyCode.setAttribute('aria-label', 'Copy code');
      content.className = 'cm-content'; content.contentEditable = 'true'; content.setAttribute('role', 'textbox'); content.setAttribute('aria-label', 'Edit code');
      header.append(copyCode); panel.append(header, content); answer.append(panel);
      writeCode = value => content.replaceChildren(...value.split('\n').map(text => { const line = document.createElement('div'); line.className = 'cm-line'; line.textContent = text; return line; }));
    } else { pre.append(code); answer.append(pre); }
    row.append(answer); if (!currentLayout) transcript.append(row);
    let readySend;
    if (currentLayout) {
      const composer = document.createElement('form'), textarea = document.createElement('textarea'); readySend = document.createElement('button');
      composer.id = 'finished-composer'; composer.onsubmit = event => event.preventDefault(); textarea.id = 'prompt-textarea';
      readySend.id = 'composer-submit-button'; readySend.type = 'submit'; readySend.setAttribute('aria-label', 'Send'); readySend.textContent = 'Send'; readySend.disabled = true;
      composer.append(textarea, readySend); document.body.append(composer);
    }
    const renderedJSON = currentLayout ? JSON.stringify(JSON.parse(thread.raw), null, 2) : thread.raw;
    const stop = document.createElement('button'); stop.dataset.testid = 'stop-button'; stop.textContent = 'Stop'; row.append(stop);
    const finish = () => {
      writeCode(renderedJSON); stop.remove(); answer.removeAttribute('data-is-streaming');
      if (readySend) readySend.disabled = mode.startsWith('rich-search');
      if (!mode.startsWith('rich-current')) {
        const copy = document.createElement('button');
        if (!currentLayout) copy.dataset.testid = 'copy-turn-action-button';
        copy.setAttribute('aria-label', currentLayout ? 'Copy' : 'Copy response'); copy.textContent = 'Copy'; row.append(copy);
      }
      if (mode === 'rich-current-multi-code') {
        const extra = document.createElement('pre'), extraCode = document.createElement('code');
        extraCode.textContent = '{"unexpected":"second code block"}'; extra.append(extraCode); answer.append(extra);
      }
      thread.complete = true; localStorage.setItem(threadKey(), JSON.stringify(thread));
      if (mode === 'rich-remount') {
        const nextUser = document.createElement('div'), nextAnswer = document.createElement('div');
        nextUser.dataset.messageAuthorRole = 'user'; nextUser.textContent = 'A separate follow-up question.';
        nextAnswer.dataset.messageAuthorRole = 'assistant'; nextAnswer.textContent = '{"unrelated":true}';
        transcript.append(nextUser, nextAnswer);
      }
      if (mode === 'rich-current-next-turn') {
        const nextTurn = document.createElement('section'), nextUser = document.createElement('div'), nextAnswer = document.createElement('div'), extra = document.createElement('pre'), extraCode = document.createElement('code');
        nextTurn.dataset.turnKey = 'later-turn'; nextUser.dataset.userMessageBubble = ''; nextUser.textContent = 'A separate question';
        nextAnswer.dataset.markdownTextStyle = 'assistant-message'; extraCode.textContent = '{"requestId":"unrelated","runId":"unrelated"}';
        extra.append(extraCode); nextAnswer.append(extra); nextTurn.append(nextUser, nextAnswer); transcript.append(nextTurn);
      }
    };
    if (thread.complete) finish();
    else { answer.dataset.isStreaming = 'true'; writeCode(mode === 'rich-current-streaming' ? renderedJSON : renderedJSON.slice(0, 70)); setTimeout(finish, mode === 'rich-current-streaming' ? 3000 : delay); }
  }
  const old = localStorage.getItem(threadKey());
  if (old) { renderThread(JSON.parse(old)); return; }
  if (mode === 'rich-existing') {
    history.replaceState({}, '', '/c/existing-thread');
    const user = document.createElement('div'), answer = document.createElement('div');
    user.dataset.messageAuthorRole = 'user'; user.textContent = 'Earlier unrelated question';
    answer.dataset.messageAuthorRole = 'assistant'; answer.textContent = 'Earlier unrelated answer'; transcript.append(user, answer);
  }
  const form = document.createElement('form'); form.id = 'generation-composer'; form.onsubmit = event => event.preventDefault(); document.body.append(form);
  let editor;
  if (provider === 'chatgpt' && mode.startsWith('rich')) {
    editor = document.createElement('div'); editor.id = 'prompt-textarea'; editor.contentEditable = 'true';
    editor.className = 'ProseMirror'; editor.style.whiteSpace = 'pre-wrap'; form.append(editor);
  } else {
    editor = document.createElement('textarea'); editor.placeholder = provider === 'deepseek' ? 'Message DeepSeek' : 'Ask anything';
    editor.id = provider === 'deepseek' ? 'chat-input' : 'actual-editor';
    if (provider === 'chatgpt') { const wrapper = document.createElement('div'); wrapper.id = 'prompt-textarea'; wrapper.append(editor); form.append(wrapper); }
    else form.append(editor);
  }
  editor.style.minHeight = '80px';
  const draft = mode.includes('draft') || mode.includes('paste') ? 'OLD_DRAFT_TO_REPLACE: unfinished text that must never be sent.' : '';
  if (draft) { if (editor.matches('textarea')) editor.value = draft; else editor.textContent = draft; }
  if (mode.includes('paste')) editor.addEventListener('paste', event => {
    event.preventDefault();
    document.body.dataset.pasteCount = String(Number(document.body.dataset.pasteCount || 0) + 1);
    // Model ChatGPT's large-paste conversion. The extension must never invoke it.
    const attachment = document.createElement('div'); attachment.dataset.testid = 'attachment-preview'; attachment.textContent = 'pasted.txt'; form.append(attachment);
  });
  let accepted = '', ready = false;
  const send = document.createElement('button'); send.type = 'button'; send.id = 'composer-submit-button'; send.setAttribute('aria-label', 'Send'); send.textContent = 'Send'; send.disabled = true;
  if (provider === 'chatgpt' && mode !== 'rich-keyboard') {
    if (mode === 'rich-remount') {
      send.removeAttribute('id'); send.removeAttribute('aria-label'); send.dataset.testid = 'fruitjuice-send-button';
      send.setAttribute('form', form.id); document.body.append(send);
    } else form.append(send);
  }
  const submit = () => {
    if (!ready || !accepted || !document.body.contains(editor)) return;
    localStorage.setItem('generationSendCount', String(Number(localStorage.getItem('generationSendCount') || 0) + 1));
    const value = JSON.parse(accepted.split('\n\n').at(-1));
    document.body.dataset.sentOldDraft = String(accepted.includes('OLD_DRAFT_TO_REPLACE'));
    document.body.dataset.runMarkersSent = String((accepted.match(/DOCUMENT_RUN:/g) || []).length);
    value.coverLetter = 'A generated cover letter for ' + value.resume.company;
    if (mode === 'invalid') value.resume.company = 'Wrong company';
    const route = mode === 'rich-existing' ? location.pathname : noLink ? '/?temporary-chat=true' : provider === 'chatgpt' ? '/c/' + value.runId : '/a/chat/s/' + value.runId;
    history.pushState({}, '', route);
    const thread = { prompt: accepted, raw: JSON.stringify(value), complete: false };
    localStorage.setItem(threadKey(), JSON.stringify(thread));
    form.remove(); send.remove(); // Submission removes the composer and Send control immediately.
    renderThread(thread);
  };
  editor.addEventListener('input', () => {
    accepted = editor.matches('textarea') ? editor.value : editor.innerText;
    if (mode === 'rich-draft-preview') {
      let mirror = document.getElementById('draft-live-preview');
      if (!mirror) { mirror = document.createElement('div'); mirror.id = 'draft-live-preview'; mirror.setAttribute('aria-live', 'polite'); document.body.append(mirror); }
      mirror.textContent = accepted;
    }
    if (mode === 'rich-remount') setTimeout(() => {
      const replacement = editor.cloneNode(true); editor.replaceWith(replacement); editor = replacement;
      editor.addEventListener('keydown', enter); document.body.dataset.editorReplaced = 'true';
    }, 100);
    if (!mode.startsWith('rich-manual')) setTimeout(() => { ready = true; send.disabled = false; }, 300);
  });
  send.onclick = () => { document.body.dataset.sendClicks = String(Number(document.body.dataset.sendClicks || 0) + 1); submit(); };
  const enter = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.body.dataset.enterCount = String(Number(document.body.dataset.enterCount || 0) + 1); submit(); } };
  editor.addEventListener('keydown', enter);
  globalThis.generationFixtureEnableSend = () => { ready = true; send.disabled = false; };
  form.hidden = true; setTimeout(() => { form.hidden = false; }, 650);
}
