// Executed only by the HTTPS fixture server in a clean, isolated browser.
export function queueFixtureScript() {
  if (document.querySelector('form[data-logged-out]')) return;
  if (localStorage.getItem('fixtureAccountMenu') !== 'missing') {
    const account = document.createElement('button'); account.type = 'button'; account.dataset.testid = 'accounts-profile-button';
    account.setAttribute('aria-label', 'Open profile menu'); account.textContent = 'Fixture account'; document.body.prepend(account);
  }
  const form = document.querySelector('form');
  let composer = document.getElementById('prompt-textarea');
  const editorKind = localStorage.getItem('fixtureEditorKind');
  if (['contenteditable', 'paragraphs', 'divs'].includes(editorKind)) {
    const replacement = document.createElement('div'); replacement.id = composer.id; replacement.contentEditable = 'true'; replacement.setAttribute('data-composer-markdown', '');
    replacement.style.cssText = 'white-space:pre-wrap;max-height:160px;overflow:auto;min-height:35px;text-align:left';
    composer.replaceWith(replacement); composer = replacement;
  }
  const send = document.createElement('button'); send.type = 'button';
  if (localStorage.getItem('fixtureSendControl') === 'modern') { send.id = 'composer-submit-button'; send.setAttribute('aria-label', 'Send'); }
  else { send.dataset.testid = 'send-button'; send.setAttribute('aria-label', 'Send prompt'); }
  send.textContent = 'Send'; send.disabled = true; form.append(send);
  let documentValue = '';
  const structured = ['paragraphs', 'divs'].includes(editorKind);
  const value = () => structured ? documentValue : composer.matches('textarea') ? composer.value : composer.innerText;
  const threads = () => JSON.parse(localStorage.getItem('fixtureThreads') || '{}');
  function render(thread, streaming = false) {
    document.querySelectorAll('article[data-fixture-turn]').forEach(node => node.remove());
    thread.forEach((entry, index) => {
      const article = document.createElement('article'); article.dataset.fixtureTurn = ''; article.dataset.testid = `conversation-turn-${index}`;
      const node = document.createElement('div'); node.dataset.messageAuthorRole = entry.role; node.dataset.messageId = entry.id;
      if (entry.role === 'assistant') {
        const markdown = document.createElement('div'); markdown.className = 'markdown';
        const pre = document.createElement('pre'), code = document.createElement('code'); code.textContent = streaming && index === thread.length - 1 ? entry.text.slice(0, 45) : entry.text;
        pre.append(code); markdown.append(pre); node.append(markdown);
        if ((!streaming || index !== thread.length - 1) && !document.documentElement.dataset.fixtureNoFinalActions) {
          const copy = document.createElement('button'); copy.type = 'button'; copy.dataset.testid = 'copy-turn-action-button'; copy.textContent = 'Copy'; article.append(copy);
        }
      } else node.textContent = entry.text;
      article.prepend(node); document.querySelector('main').append(article);
    });
  }
  const threadId = location.pathname.split('/c/')[1];
  if (threadId && threads()[threadId]) render(threads()[threadId]);
  const changed = () => { send.disabled = localStorage.getItem('fixtureBlockSend') === 'true' || !value().trim() || Boolean(document.querySelector('[data-testid="stop-button"]')); };
  function onInput(event) {
    document.documentElement.dataset.fixtureInputs = String(Number(document.documentElement.dataset.fixtureInputs || 0) + 1);
    if (structured && typeof event.data === 'string') {
      documentValue = event.data;
      composer.replaceChildren(...documentValue.split('\n').map((text, index) => {
        if (editorKind === 'divs' && index === 0) return document.createTextNode(text);
        const paragraph = document.createElement(editorKind === 'divs' ? 'div' : 'p');
        if (text) paragraph.textContent = text; else paragraph.append(document.createElement('br'));
        return paragraph;
      }));
    }
    const remount = document.documentElement.dataset.fixtureRemount;
    if (remount) {
      delete document.documentElement.dataset.fixtureRemount;
      const replacement = composer.cloneNode(true);
      if (replacement.matches('textarea')) replacement.value = remount === 'retained' ? value() : remount === 'unexpected' ? 'Synthetic unrelated draft' : '';
      else if (remount !== 'retained') replacement.textContent = remount === 'unexpected' ? 'Synthetic unrelated draft' : '';
      composer.replaceWith(replacement); composer = replacement; composer.addEventListener('input', onInput);
    }
    changed();
    if (document.documentElement.dataset.fixtureEditWhileWaiting) {
      delete document.documentElement.dataset.fixtureEditWhileWaiting;
      setTimeout(() => { composer.value = 'Synthetic draft changed while waiting'; composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: composer.value })); }, 150);
    }
  }
  composer.addEventListener('input', onInput);
  send.addEventListener('click', () => {
    const prompt = value(); if (!prompt.trim() || send.disabled) return;
    const requestId = prompt.match(/AI_AGENT_REQUEST:([\w-]+)/)?.[1];
    const deliveryId = prompt.match(/AI_AGENT_DELIVERY:([\w-]+)/)?.[1];
    const shape = prompt.split('\n\n').find(part => part.startsWith('{"schemaVersion":1,"requestId":'));
    if (!requestId || !deliveryId || !shape) return;
    const log = JSON.parse(localStorage.getItem('fixtureSubmissionLog') || '[]');
    const count = log.filter(item => item.requestId === requestId).length;
    log.push({ requestId, deliveryId, url: location.pathname }); localStorage.setItem('fixtureSubmissionLog', JSON.stringify(log));
    const deliver = () => {
    const id = location.pathname.split('/c/')[1] || 'fixture-' + crypto.randomUUID();
    if (!location.pathname.includes('/c/')) { history.pushState({}, '', '/c/' + id); dispatchEvent(new PopStateEvent('popstate')); }
    let raw = JSON.stringify(JSON.parse(shape));
    if (prompt.includes('FIXTURE_INVALID_ALWAYS') || (prompt.includes('FIXTURE_INVALID_ONCE') && count === 0)) raw = 'Invalid JSON fixture response';
    if (prompt.includes('FIXTURE_WRONG_REQUEST')) { const data = JSON.parse(shape); data.requestId = 'unrelated-request'; raw = JSON.stringify(data); }
    if (prompt.includes('FIXTURE_REFUSAL')) raw = 'I cannot help with this synthetic fixture request.';
    const all = threads(), thread = all[id] || [];
    thread.push({ role: 'user', id: 'user-' + deliveryId, text: prompt }, { role: 'assistant', id: 'assistant-' + deliveryId, text: raw });
    all[id] = thread; localStorage.setItem('fixtureThreads', JSON.stringify(all));
    documentValue = '';
    if (composer.matches('textarea')) composer.value = ''; else composer.textContent = '';
    const stop = document.createElement('button'); stop.type = 'button'; stop.dataset.testid = 'stop-button'; stop.textContent = 'Stop'; form.append(stop); changed();
    render(thread, true);
    if (prompt.includes('FIXTURE_RATE_LIMIT')) {
      const alert = document.createElement('p'); alert.setAttribute('role', 'alert'); alert.textContent = 'You have reached your usage limit. Try again after 10 minutes.'; form.append(alert);
      return;
    }
    const timer = setTimeout(() => { render(thread); stop.remove(); changed(); }, prompt.includes('FIXTURE_LONG') ? 3000 : 350);
    stop.addEventListener('click', () => { clearTimeout(timer); stop.remove(); changed(); });
    };
    const ackDelay = Number(document.documentElement.dataset.fixtureAckDelay || 0);
    if (document.documentElement.dataset.fixtureDropAck) { send.disabled = true; return; }
    if (ackDelay) { send.disabled = true; setTimeout(deliver, ackDelay); }
    else deliver();
  });
}
