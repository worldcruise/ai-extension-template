import { icon } from './icons.mjs';
import { profiles as exampleProfiles, prompts } from './studio-examples.mjs';
import { exampleProfile } from './resume-data.mjs';
import { savedCompanyChats } from './company-chats.mjs';
import { linkedConversationUrl } from './sidebar-protocol.mjs';
import { resumeTemplates, resumeTemplate } from './resume-templates.mjs';
import { terminalStates, recoverableStates, deliveryEvidence } from './queue-outcomes.mjs';
import { metadataProvenance, provenanceLabel } from './job-metadata.mjs';
import { redactedDiagnostic } from './queue-diagnostics.mjs';
import { MANUAL_QUEUE_MODE, MANUAL_QUEUE_MESSAGE } from './queue-mode.mjs';
import { copyRequestPrompt, promptForManualCopy } from './manual-prompt.mjs';
import { updateReadPageHint } from './shortcut-settings.mjs';
import { requestJobPageAccess } from './job-page-access.mjs';

export function createStudio({ openDialog, showStudio, showChat, moveTab, queue,
  getCurrentChat = () => null, onCompanyChatsChange = () => {} }) {
  const q = selector => document.querySelector(selector);
  let requests = [];
  let profiles = { ...exampleProfiles };
  let queueState = { control: { paused: true }, requests: [] };
  let initialized = false;
  const pendingActions = new Set();
  let regenerationTarget = null;
  let copiedRequestId = null;
  let copyFeedbackTimer;
  const manualOnly = () => queueState.manualOnly ?? MANUAL_QUEUE_MODE;
  let selectionLoaded = false;
  let currentTabId = null;
  let previewId = null;
  let detailRequestId = null;
  let paused = true;
  let reading = null;
  const readFeedback = new Map();
  const jobDrafts = new Map();
  const provenanceDrafts = new Map();
  function rememberSource(key, value, descriptor) {
    const current = provenanceDrafts.get(currentTabId) || {};
    provenanceDrafts.set(currentTabId, { ...current, [key]: { ...descriptor, value: value.trim() } });
  }
  const manualUrls = new Set();
  const jobFields = { company: '#job-company', role: '#job-title', url: '#job-url', description: '#job-description' };
  const jobDraft = () => Object.fromEntries(Object.entries(jobFields).map(([key, selector]) => [key, q(selector).value]));
  const status = text => { q('#workspace-status').textContent = text; q('.queue-bar').title = text; };
  const candidateId = () => q('#candidate').value;
  const profile = () => profiles[candidateId()];
  async function perform(task, key = 'general') {
    if (pendingActions.has(key)) return;
    const reflectPending = () => { document.documentElement.dataset.studioBusy = String([...pendingActions].some(key => !key.startsWith('continue-send:') && !key.startsWith('recover:'))); };
    pendingActions.add(key); reflectPending(); renderQueue();
    try { return await task(); }
    catch (error) { status(error.message); q('#profile-import-status').textContent = error.message; }
    finally { pendingActions.delete(key); reflectPending(); renderQueue(); }
  }
  function renderCandidate() {
    const current = profile();
    q('#candidate-avatar').textContent = current.initials;
    q('#profile-filename').textContent = `${current.filename}${current.isExample !== false ? ' · Example profile' : ''}`;
    q('#profile-name').textContent = current.name;
    q('#profile-role').textContent = current.role;
    q('#profile-summary').textContent = current.summary;
    q('#profile-skills').replaceChildren(...current.skills.map(text => element('span', '', text)));
    q('#profile-kind').textContent = current.isExample !== false ? 'Example profile' : 'Imported profile';
  }
  function updateQueue(value) {
    queueState = value; requests = value.requests; paused = value.control.paused;
    const selected = selectionLoaded ? candidateId() : value.control.selectedCandidateId || candidateId();
    selectionLoaded = true;
    const options = queue.profileOptions();
    profiles = Object.fromEntries(options.map(item => [item.id, item]));
    const groups = [element('optgroup'), element('optgroup')]; groups[0].label = 'Your profiles'; groups[1].label = 'Example profiles';
    for (const item of options) {
      const option = element('option', '', item.name); option.value = item.id;
      groups[item.isExample ? 1 : 0].append(option);
    }
    q('#candidate').replaceChildren(...groups.filter(group => group.children.length));
    q('#candidate').value = profiles[selected] ? selected : options.find(item => !item.isExample)?.id || options[0]?.id;
    renderCandidate(); renderQueue();
  }
  q('#resume-template').replaceChildren(...resumeTemplates.map(template => {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = template.name;
    return option;
  }));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function action(text, glyph, name, id) {
    const button = element('button', 'button');
    button.type = 'button';
    button.dataset.action = name;
    button.dataset.request = String(id);
    if (glyph) button.append(icon(glyph));
    button.append(document.createTextNode(text));
    button.disabled = pendingActions.has(`${name}:${id}`) ||
      (['continue-send', 'recover', 'regenerate'].includes(name) && (queueState.starting || Boolean(queueState.control.ownerId)));
    return button;
  }
  function clearPreview() {
    previewId = null;
    q('#resume-preview').hidden = true;
    q('#resume-preview').open = false;
    q('#resume-paper').replaceChildren();
  }
  function renderQueue() {
    const all = requests.filter(request => request.input.candidateId === candidateId() && request.state !== 'cancelled');
    const own = all.filter(request => !terminalStates.includes(request.state));
    const failures = all.filter(request => terminalStates.includes(request.state));
    q('#add-request').disabled = !initialized || pendingActions.has('add');
    q('#review-count').textContent = own.length;
    q('#queue-owner').textContent = profile().name;
    q('#empty-queue').hidden = own.length > 0;
    const renderCard = request => {
      const { input } = request;
      const company = input.tailor ? input.job.company || 'Company not provided' : 'Base resume';
      const card = element('li', 'job-request');
      card.dataset.requestId = String(request.id);
      const top = element('div', 'request-top');
      const title = element('div', 'request-title');
      title.append(element('strong', '', company), element('p', '', input.job.role));
      const pill = element('span', 'state-pill');
      pill.dataset.state = request.state;
      const labels = { ready: request.isExample ? 'Ready' : 'Ready for review', saving: 'Save pending', queued: 'Queued', preparing: 'Preparing', sending: 'Sending', generating: 'Generating', validating: 'Validating', attention: 'Needs attention', interrupted: 'Interrupted', unsent: 'Not sent', uncertain: 'Reconcile delivery', 'invalid-output': 'Invalid completed output', 'error-response': 'Completed error response' };
      pill.append(icon(request.state === 'ready' ? 'check' : 'clock'), document.createTextNode(labels[request.state] || request.state));
      top.append(element('span', 'company-mark', company[0]), title, pill);
      const number = typeof request.id === 'number' ? String(request.id).padStart(3, '0') : request.id.slice(0, 8);
      const meta = element('div', 'request-meta', `${input.profile.name.split(' ')[0]} · ${resumeTemplate(input.resumeTemplate).name} · #${number}`);
      if (request.state === 'ready' && request.isExample) {
        const saved = element('span', 'example-saved');
        saved.append(icon('check'), document.createTextNode('Saved example'));
        meta.append(saved);
      }
      card.append(top, meta);
      const provenance = metadataProvenance(input.job);
      card.append(element('p', 'field-hint', `Company: ${provenanceLabel(provenance.company)} · Job title: ${provenanceLabel(provenance.role)}`));
      if (request.state === 'saving') card.append(element('p', 'request-note', request.isExample ? 'Example result retained · Try the save-retry interaction.' : 'Result retained. Retry saving before closing the panel.'));
      if (request.error) card.append(element('p', 'request-note request-error', request.error));
      if (request.isExample) card.append(element('p', 'field-hint', 'Example result · Not sent to ChatGPT'));
      const actions = element('div', 'request-actions');
      actions.append(action(pendingActions.has(`copy-prompt:${request.id}`) ? 'Copying…' : copiedRequestId === request.id ? 'Copied' : 'Copy prompt', 'copy', 'copy-prompt', request.id));
      actions.append(action('Details', 'file', 'details', request.id));
      if (request.state === 'ready') {
        const review = action('Review', 'chat', 'review', request.id);
        review.disabled = !linkedConversationUrl(request.sourceChatUrl);
        review.title = review.disabled ? 'No originating conversation is recorded. Open Details to inspect this result.' : 'Open this result’s originating conversation';
        actions.prepend(review);
      }
      if (request.state === 'ready') actions.append(action('Preview', 'file', 'preview', request.id));
      if (request.state === 'saving') actions.append(action('Retry save', 'refresh', 'retry-save', request.id));
      if (recoverableStates.includes(request.state)) {
        const attempt = request.attempts?.at(-1);
        if (!manualOnly() && attempt && !attempt.sendIntent && !attempt.submitted && !attempt.dispatchedAt) {
          actions.append(action('Continue sending', 'chat', 'continue-send', request.id));
        }
        if (['login-unverified', 'signed-out', 'composer-unavailable'].includes(request.errorCode) || /Could not verify a signed-in ChatGPT account/.test(request.error || '')) {
          actions.append(action('Check connection', 'scan', 'connection', request.id));
        }
        if (!manualOnly() && (request.state === 'uncertain' || request.sourceChatUrl || request.rawOutput)) actions.append(action('Reconcile delivery', 'refresh', 'recover', request.id));
      }
      if (!manualOnly() && !request.isExample && [...recoverableStates, ...terminalStates, 'ready'].includes(request.state)) actions.append(action('Generate again', 'plus', 'regenerate', request.id));
      if (['queued', ...recoverableStates].includes(request.state)) actions.append(action('Cancel', 'close', 'cancel', request.id));
      if (recoverableStates.includes(request.state) && !manualOnly()) card.append(element('p', 'field-hint', 'Continue/reconcile handles only this request. It does not resume other jobs.'));
      card.append(actions);
      return card;
    };
    q('#resume-queue').replaceChildren(...own.map(renderCard));
    q('#failed-queue').replaceChildren(...failures.map(renderCard));
    const detailCopyPending = Boolean(detailRequestId && pendingActions.has(`copy-prompt:${detailRequestId}`));
    q('#request-copy-prompt').disabled = detailCopyPending;
    q('#request-copy-prompt').textContent = detailCopyPending ? 'Copying…' : detailRequestId && copiedRequestId === detailRequestId ? 'Copied' : 'Copy prompt';
    q('#failed-results').hidden = failures.length === 0; q('#failed-count').textContent = failures.length;
    const counts = own.reduce((total, request) => { total[request.state] = (total[request.state] || 0) + 1; return total; }, {});
    const parts = [];
    if (counts.ready) parts.push(`${counts.ready} ready`);
    if (counts.saving) parts.push(`${counts.saving} save pending`);
    if (counts.queued) parts.push(`${counts.queued} queued`);
    const working = ['preparing', 'sending', 'generating', 'validating'].reduce((count, key) => count + (counts[key] || 0), 0);
    if (working) parts.unshift(`${working} working`);
    const needsAttention = recoverableStates.reduce((total, key) => total + (counts[key] || 0), 0);
    if (needsAttention) parts.push(`${needsAttention} need attention`);
    q('#queue-summary').textContent = (paused && queueState.control.ownerId ? 'Pausing · ' : '') + (parts.join(' · ') || 'Queue empty');
    const pause = q('#pause-queue');
    pause.setAttribute('aria-pressed', String(paused));
    pause.title = paused ? 'Start queue' : 'Pause after the current response';
    pause.setAttribute('aria-label', pause.title);
    pause.replaceChildren(icon(paused ? 'play' : 'pause'));
    const eligible = !requests.some(request => !request.isExample && request.state === 'uncertain') && own.some(request => !request.isExample && ['queued', 'interrupted'].includes(request.state));
    pause.disabled = manualOnly() || !initialized || (paused && (!eligible || Boolean(queueState.control.ownerId)));
    if (manualOnly()) { pause.title = MANUAL_QUEUE_MESSAGE; pause.setAttribute('aria-label', 'Automatic sending paused'); }
    q('#start-queue').disabled = manualOnly() || !initialized || !eligible || Boolean(queueState.control.ownerId) || queueState.starting;
    q('#start-queue').hidden = manualOnly();
    q('#manual-queue-note').hidden = !manualOnly();
    q('#start-queue').textContent = queueState.control.ownerId ? 'Queue running' : 'Start queue';
    onCompanyChatsChange();
  }

  function updateTabs({ count, index, tabId, url, busy }) {
    if (tabId !== currentTabId) {
      jobDrafts.set(currentTabId, jobDraft());
      currentTabId = tabId;
      const draft = jobDrafts.get(currentTabId);
      for (const [key, selector] of Object.entries(jobFields)) {
        q(selector).value = draft?.[key] || ''; q(selector).setCustomValidity('');
      }
    }
    if (!manualUrls.has(currentTabId) && /^https?:\/\//i.test(url || '')) {
      q('#job-url').value = url;
      jobDrafts.set(currentTabId, jobDraft());
    }
    q('#job-position').textContent = `${index} / ${count}`;
    q('#job-position').title = `${count} open tab${count === 1 ? '' : 's'} in this browser window`;
    q('#previous-job').disabled = q('#next-job').disabled = busy || count < 2;
    renderReadButton();
  }
  function renderReadButton() {
    const permissionPending = reading?.phase === 'permission';
    const busy = permissionPending || reading?.tabId===currentTabId;
    const button = q('#read-page');
    button.disabled = currentTabId===null || busy;
    button.setAttribute('aria-busy',String(busy));
    button.replaceChildren(icon(busy ? 'refresh' : 'scan'),document.createTextNode(permissionPending ? 'Allow access…' : busy ? 'Reading…' : 'Read page'));
    const feedback = readFeedback.get(currentTabId);
    updateReadPageHint(button, feedback?.message || '');
  }
  function readMessage(tabId, state, message) {
    readFeedback.set(tabId, { state, message });
    if (tabId === currentTabId) renderReadButton();
  }
  async function readPage(tabId = currentTabId, { askAccess = false } = {}) {
    if (!Number.isInteger(tabId) || reading?.tabId === tabId || reading?.phase === 'permission') return;
    const before = tabId === currentTabId ? jobDraft() : jobDrafts.get(tabId) ||
      Object.fromEntries(Object.keys(jobFields).map(key => [key, '']));
    const request = {id:crypto.randomUUID(),tabId,before,phase:askAccess ? 'permission' : 'extracting'};
    if (reading) readMessage(reading.tabId, 'notice', 'This read was interrupted. Click Read page to try again.');
    reading = request;
    readMessage(tabId, 'pending', askAccess ? 'Waiting for website access.' : 'Reading job details from this page…');
    renderReadButton();
    let timeout;
    try {
      if (askAccess) {
        // No awaits may precede this request: Chrome must receive the click's
        // user gesture. Approval resumes this same read, not a second click.
        await requestJobPageAccess(request.tabId);
        if (reading !== request) return;
        request.phase = 'extracting';
        readMessage(tabId, 'pending', 'Reading job details from this page…');
        renderReadButton();
      }
      const response = await Promise.race([
        chrome.runtime.sendMessage({type:'job.extract',requestId:request.id,tabId:request.tabId}),
        new Promise((_,reject) => { timeout=setTimeout(()=>reject(new Error('The page is taking too long to respond. Try Read page again.')),12000); })
      ]);
      if (reading!==request) return;
      if (!response || response.requestId!==request.id) throw new Error('The page did not respond. Try Read page again.');
      if (!response.ok) throw Object.assign(new Error(response.error?.message || 'Could not read this job page.'), { code: response.error?.code });
      const active = currentTabId===request.tabId;
      const current = active ? jobDraft() : jobDrafts.get(request.tabId) || request.before;
      const merged = {...current};
      let filled=0;
      for (const [key,selector] of Object.entries(jobFields)) {
        const value = response.fields?.[key];
        if (!value || current[key]!==request.before[key]) continue;
        merged[key] = value; filled++;
        if (active) { q(selector).value=value; q(selector).setCustomValidity(''); }
        if (['company', 'role'].includes(key)) {
          const currentSource = provenanceDrafts.get(request.tabId) || {};
          provenanceDrafts.set(request.tabId, { ...currentSource, [key]: { ...(response.provenance?.[key] || { kind: 'page', source: response.source || 'Page extraction' }), value: value.trim() } });
        }
        if (key==='url') manualUrls.delete(request.tabId);
      }
      jobDrafts.set(request.tabId,merged);
      const missing = response.missing?.filter(key=>key!=='url') || [];
      const names = {company:'company name',role:'job title',description:'Job Description'};
      const message = missing.length ? `Read ${filled} fields. Review missing ${missing.map(key=>names[key] || key).join(', ')}.` : 'Job details read. Review the fields before adding to queue.';
      readMessage(request.tabId, missing.length ? 'warning' : 'success', message);
      status(active ? message : 'Job details saved to the source tab’s draft.');
    } catch (error) {
      if (reading===request) {
        const message = error.message;
        readMessage(request.tabId, 'error', message);
        if (currentTabId===request.tabId) {
          status(message);
          if (error.code !== 'access-denied') {
            q('#read-page-error-message').textContent = message;
            if (!q('#read-page-error-dialog').open) openDialog('read-page-error-dialog');
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      if (reading===request) { reading=null; renderReadButton(); }
    }
  }
  q('#read-page').addEventListener('click', () => { void readPage(currentTabId, { askAccess: true }); });
  function tabError(message) {
    q('#previous-job').disabled = q('#next-job').disabled = true;
    status(message);
  }
  function renderTemplate(kind = 'resume') {
    const resume = kind === 'resume' || !q('#tailor').checked;
    const selection = q('#resume-template');
    const prompt = prompts[q('#prompt-template').value];
    q('#resume-thumbnail').hidden = !resume;
    q('#prompt-preview').hidden = resume;
    q('#resume-thumbnail').dataset.template = selection.value;
    const template = resumeTemplate(selection.value);
    q('#resume-thumbnail').src = template.thumbnail;
    q('#resume-thumbnail').alt = `${template.name} resume template preview`;
    q('#template-caption').textContent = resume ? `Resume · ${template.name}` : 'Prompt preview';
    q('#prompt-name').textContent = prompt.name;
    q('#prompt-text').textContent = prompt.text;
  }
  function renderSource(request) {
    const source = linkedConversationUrl(request.sourceChatUrl);
    const current = linkedConversationUrl(getCurrentChat());
    const savedCompany = request.input.tailor && ((request.state === 'ready' && Boolean(request.resume)) || recoverableStates.includes(request.state) || terminalStates.includes(request.state));
    q('#request-source-note').textContent = source ? `Connected chat · ${request.input.job.company}`
      : savedCompany ? 'Open this job’s conversation in Chat, then connect it here to recover its result.'
      : 'A company’s chat can be connected once its resume is saved.';
    q('#request-open-chat').disabled = !source;
    const connect = q('#request-connect-chat');
    connect.disabled = !savedCompany || !current || source === current;
    connect.title = !current ? 'Open a conversation in Chat first' : 'Connect the current conversation to this saved company';
    connect.replaceChildren(icon('link'), document.createTextNode(source ? 'Replace with current chat' : 'Connect current chat'));
  }
  function requestDetails(request) {
    detailRequestId = request.id;
    const { input } = request;
    q('#request-dialog-title').textContent = `${input.tailor ? input.job.company : 'Base resume'} · #${String(request.id).padStart(3, '0')}`;
    const metadata = [
      ['Candidate', input.profile.name], ['Job title', input.job.role],
      ['Resume template', resumeTemplate(input.resumeTemplate).name],
      ['Prompt template', prompts[input.promptTemplate].name], ['Mode', input.tailor ? 'Tailored resume' : 'Base resume']
    ];
    const provenance = metadataProvenance(input.job);
    metadata.push(['Company source', provenanceLabel(provenance.company)], ['Job title source', provenanceLabel(provenance.role)], ['Delivery evidence', deliveryEvidence(request).description]);
    if (input.tailor && input.job.url) metadata.push(['Source URL', input.job.url]);
    q('#request-metadata').replaceChildren(...metadata.flatMap(([label, value]) => [element('dt', '', label), element('dd', '', value)]));
    q('#request-prompt').textContent = input.prompt;
    q('#request-full-prompt').value = promptForManualCopy(request);
    q('#request-copy-prompt').textContent = copiedRequestId === request.id ? 'Copied' : 'Copy prompt';
    q('#request-copy-status').textContent = '';
    q('#request-job').textContent = input.tailor ? input.job.description : 'No job description attached to this base resume.';
    q('#request-output-section').hidden = !request.resume && !request.rawOutput;
    q('#request-output').textContent = request.resume ? JSON.stringify(request.resume, null, 2) : request.rawOutput || '';
    q('#request-diagnostics').textContent = JSON.stringify((request.attempts || []).map(attempt => ({ deliveryId: attempt.deliveryId,
      connection: attempt.connection || 'sidebar', startedAt: attempt.startedAt, preparedAt: attempt.preparedAt, dispatchedAt: attempt.dispatchedAt,
      acknowledgedAt: attempt.acknowledgedAt, sendIntent: attempt.sendIntent === true, submitted: attempt.submitted === true,
      diagnostics: (Array.isArray(attempt.diagnostics) ? attempt.diagnostics : []).map(redactedDiagnostic).filter(Boolean) })), null, 2);
    q('#request-capture-history').replaceChildren(...(request.attempts || []).filter(attempt => attempt.raw).map(attempt => {
      const details = element('details', 'request-section'); details.append(element('summary', '', `Captured delivery ${attempt.deliveryId}`), element('pre', '', attempt.raw)); return details;
    }));
    renderSource(request);
    openDialog('request-dialog');
  }
  function preview(request) {
    if (request.state !== 'ready' || !request.resume) return;
    previewId = request.id;
    showStudio('results');
    q('#resume-preview').hidden = false;
    q('#resume-preview').open = true;
    q('#resume-preview-title').textContent = `${request.input.tailor ? request.input.job.company : 'Base resume'} · ${request.isExample ? 'Example resume' : 'Resume'}`;
    const paper = q('#resume-paper');
    const data = request.resume;
    paper.dataset.template = request.input.resumeTemplate;
    paper.replaceChildren(element('h2', '', request.input.profile.name), element('p', 'resume-title', data.title));
    if (data.contact) paper.append(element('p', 'resume-contact', Object.values(data.contact).filter(Boolean).join(' · ')));
    paper.append(element('h3', '', 'Summary'), element('p', '', data.summary));
    paper.append(element('h3', '', 'Skills'), element('p', '', data.skills.flatMap(group => Object.values(group).flat()).join(' · ')));
    if (data.experience.length) {
      paper.append(element('h3', '', 'Experience'));
      for (const experience of data.experience) {
        paper.append(element('p', '', `${experience.title} · ${experience.company}`));
        const details = [experience.startDate && [experience.startDate, experience.endDate].filter(Boolean).join(' – '), experience.location].filter(Boolean);
        if (details.length) paper.append(element('p', 'resume-contact', details.join(' · ')));
        const list = element('ul');
        list.append(...experience.sentences.map(text => element('li', '', text)));
        paper.append(list);
      }
    }
    if (data.education.length) paper.append(element('h3', '', 'Education'), ...data.education.map(item => element('p', '', [item.degree, item.institution, [item.startDate, item.endDate].filter(Boolean).join(' – ')].filter(Boolean).join(' · '))));
    q('#resume-preview').scrollIntoView({ block: 'start' });
    status(`Previewing the ${resumeTemplate(request.input.resumeTemplate).name} resume · ${data.company}`);
  }

  function copyPrompt(request) {
    void perform(async () => {
      try { await copyRequestPrompt(request); }
      catch {
        copiedRequestId = null; clearTimeout(copyFeedbackTimer);
        requestDetails(request);
        q('#request-full-prompt').focus(); q('#request-full-prompt').select();
        q('#request-copy-status').textContent = 'Clipboard access failed. The full prompt is selected below; copy it manually.';
        status('Clipboard access failed. Copy the selected full prompt from Details.');
        return;
      }
      copiedRequestId = request.id;
      q('#request-copy-prompt').textContent = detailRequestId === request.id ? 'Copied' : 'Copy prompt';
      q('#request-copy-status').textContent = detailRequestId === request.id ? 'Prompt copied. Paste and send it in ChatGPT yourself.' : '';
      status('Prompt copied. Paste and send it in ChatGPT yourself. Delivery status was not changed.');
      clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = setTimeout(() => { if (copiedRequestId === request.id) { copiedRequestId = null; q('#request-copy-prompt').textContent = 'Copy prompt'; renderQueue(); } }, 2000);
    }, `copy-prompt:${request.id}`);
  }
  function requestAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const request = requests.find(item => String(item.id) === button.dataset.request && item.input.candidateId === candidateId());
    if (!request) return;
    if (button.dataset.action === 'copy-prompt') { copyPrompt(request); return; }
    if (manualOnly() && ['continue-send', 'recover', 'regenerate'].includes(button.dataset.action)) { status(MANUAL_QUEUE_MESSAGE); return; }
    if (button.dataset.action === 'details') requestDetails(request);
    if (button.dataset.action === 'review') {
      const url = linkedConversationUrl(request.sourceChatUrl);
      if (request.state === 'ready' && url) showChat(url);
    }
    if (button.dataset.action === 'connection') q('#account-check').click();
    if (button.dataset.action === 'preview') preview(request);
    if (button.dataset.action === 'retry-save') {
      void perform(async () => { await queue.retrySave(request.id); status(`Save completed · ${request.input.job.company}. No generation was started.`); }, `retry-save:${request.id}`);
    }
    if (button.dataset.action === 'cancel') {
      void perform(async () => { await queue.cancel(request.id); if (previewId === request.id) clearPreview(); status(`Request cancelled · ${request.input.job.company}`); }, `cancel:${request.id}`);
    }
    if (button.dataset.action === 'regenerate') {
      regenerationTarget = { id: request.id, deliveryId: request.deliveryId || null, updatedAt: request.updatedAt };
      q('#regenerate-evidence').textContent = `Previous state: ${request.state}. ${deliveryEvidence(request).description}.`;
      openDialog('regenerate-dialog');
    }
    if (['continue-send', 'recover'].includes(button.dataset.action)) void perform(async () => {
      await queue.continueRequest(request.id); status('Reconciliation finished for this request only. Other jobs were not started.');
    }, `${button.dataset.action}:${request.id}`);
  }
  q('#resume-queue').addEventListener('click', requestAction);
  q('#failed-queue').addEventListener('click', requestAction);
  q('#request-copy-prompt').addEventListener('click', () => {
    const request = requests.find(item => item.id === detailRequestId && item.input.candidateId === candidateId());
    if (request) copyPrompt(request);
  });
  q('#regenerate-confirm').addEventListener('click', () => {
    if (manualOnly()) { status(MANUAL_QUEUE_MESSAGE); return; }
    if (!regenerationTarget) return;
    const target = regenerationTarget; q('#regenerate-confirm').disabled = true;
    void perform(async () => {
      await queue.generateAgain(target.id, { confirmed: true, expectedDeliveryId: target.deliveryId, expectedUpdatedAt: target.updatedAt });
      regenerationTarget = null; q('#regenerate-dialog').close(); status('A new generation attempt is queued. Choose Start queue to send it.');
    }, `regenerate:${target.id}`).finally(() => { q('#regenerate-confirm').disabled = false; });
  });

  q('#candidate').addEventListener('change', () => {
    renderCandidate();
    void queue.selectCandidate(candidateId()).catch(error => status(error.message));
    clearPreview(); renderQueue(); renderTemplate();
    status(`Selected candidate · ${profile().name}`);
  });
  q('#profile-details').addEventListener('click', () => {
    renderCandidate();
    openDialog('profile-dialog');
  });
  q('#tailor').addEventListener('change', () => {
    const checked = q('#tailor').checked;
    q('#prompt-template-field').hidden = !checked;
    q('#prompt-template').disabled = !checked;
    q('#tailor-description').textContent = checked ? 'Use the profile and job description.' : 'Prepare a base resume from this profile.';
    renderTemplate();
  });
  for (const [key, selector] of Object.entries(jobFields)) q(selector).addEventListener('input', () => {
    if (['company', 'role'].includes(key)) rememberSource(key, q(selector).value, { kind: q(selector).value.trim() ? 'user' : 'missing' });
    if (selector === '#job-url') { manualUrls.add(currentTabId); q(selector).setCustomValidity(''); }
    if (selector === '#job-description') q(selector).setCustomValidity('');
    jobDrafts.set(currentTabId, jobDraft());
  });
  for (const [id, delta] of [['previous-job', -1], ['next-job', 1]]) {
    document.getElementById(id).addEventListener('click', () => { void moveTab(delta); });
  }
  for (const [id, kind] of [['resume-template', 'resume'], ['prompt-template', 'prompt']]) {
    document.getElementById(id).addEventListener('focus', () => renderTemplate(kind));
    document.getElementById(id).addEventListener('change', () => renderTemplate(kind));
  }
  q('#add-request').addEventListener('click', () => { void perform(async () => {
    const description = q('#job-description').value.trim();
    if (q('#tailor').checked && !description) {
      status('Add a job description before preparing a tailored resume.');
      q('#job-description').setCustomValidity('Add a job description before preparing a tailored resume.');
      q('#job-description').reportValidity();
      return;
    }
    const tailor = q('#tailor').checked;
    let url = '';
    if (tailor && q('#job-url').value.trim()) {
      try {
        const parsed = new URL(q('#job-url').value.trim());
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
        url = parsed.href;
      } catch {
        q('#job-url').setCustomValidity('Enter an http:// or https:// job URL.');
        q('#job-url').reportValidity(); return;
      }
    }
    const promptTemplate = tailor ? q('#prompt-template').value : 'base';
    const provenance = {};
    for (const key of ['company', 'role']) {
      const value = q(jobFields[key]).value.trim(), remembered = provenanceDrafts.get(currentTabId)?.[key];
      provenance[key] = value ? remembered?.value === value ? { kind: remembered.kind, source: remembered.source } : { kind: 'user' }
        : { kind: key === 'role' ? 'profile-fallback' : 'missing' };
    }
    const input = structuredClone({ candidateId: candidateId(), profile: profile(),
      job: { company: tailor ? q('#job-company').value.trim() : 'Base resume',
        role: tailor ? q('#job-title').value.trim() || profile().role : profile().role, url, tabId: currentTabId, description, provenance }, tailor,
      resumeTemplate: q('#resume-template').value, promptTemplate, prompt: prompts[promptTemplate].text });
    await queue.add(input);
    clearPreview(); renderQueue(); showStudio('results');
    q('#studio-scroll').scrollTop = 0;
    status(manualOnly() ? 'Added to queue. Copy its prompt, then paste and send it in ChatGPT yourself.' : 'Added to queue. Click Start queue to send the selected candidate’s jobs to ChatGPT.');
  }, 'add'); });

  for (const id of ['review-another', 'empty-prepare']) document.getElementById(id).addEventListener('click', () => showStudio('job'));
  for (const id of ['view-queue', 'open-queue']) document.getElementById(id).addEventListener('click', () => showStudio('results'));
  const startQueue = () => { if (manualOnly()) { status(MANUAL_QUEUE_MESSAGE); return; } void queue.start(candidateId()).catch(error => status(error.message)); };
  q('#start-queue').addEventListener('click', startQueue);
  q('#pause-queue').addEventListener('click', () => {
    if (manualOnly()) { status(MANUAL_QUEUE_MESSAGE); return; }
    if (paused) startQueue();
    else void perform(async () => { await queue.pause(); status('Queue will pause after the current response.'); }, 'pause');
  });
  q('#request-open-chat').addEventListener('click', () => {
    const request = requests.find(item => item.id === detailRequestId && item.input.candidateId === candidateId());
    const url = linkedConversationUrl(request?.sourceChatUrl);
    if (!url) return;
    q('#request-dialog').close(); showChat(url);
  });
  q('#request-connect-chat').addEventListener('click', () => {
    const request = requests.find(item => item.id === detailRequestId && item.input.candidateId === candidateId());
    const url = linkedConversationUrl(getCurrentChat());
    if (!request || !request.input.tailor || !url) return;
    void perform(async () => { await queue.connect(request.id, url); renderSource(requests.find(item => item.id === request.id)); status(`Chat connected · ${request.input.job.company}`); });
  });
  q('#copy-json').addEventListener('click', async () => {
    const request = requests.find(item => item.id === previewId && item.input.candidateId === candidateId());
    if (!request?.resume) return;
    try { await navigator.clipboard.writeText(JSON.stringify(request.resume, null, 2)); status('Resume JSON copied.'); }
    catch { status('Could not copy. Open Review to select the JSON.'); }
  });
  q('#export-resume').addEventListener('click', () => openDialog('export-dialog'));
  q('#reset-examples').addEventListener('click', () => { void perform(async () => {
    await queue.loadExamples(); q('#profile-dialog').close(); q('#candidate').value = 'morgan';
    renderCandidate(); clearPreview(); renderQueue(); showStudio('results');
    status('Example results loaded. Examples are never sent by the runner.');
  }); });
  function downloadProfile() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exampleProfile, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'Candidate_Profile.example.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  q('#download-profile-example').addEventListener('click', downloadProfile);
  q('#import-profile').addEventListener('click', () => q('#profile-file').click());
  q('#profile-file').addEventListener('change', event => {
    const file = event.target.files?.[0]; if (!file) return;
    void perform(async () => {
      if (file.size > 250000) throw new Error('Import a profile JSON file under 250 KB.');
      const id = await queue.importProfile(await file.text(), file.name);
      q('#candidate').value = id; renderCandidate(); clearPreview(); renderQueue();
      q('#profile-import-status').textContent = `Imported ${profile().name}. Saved on this device.`;
    });
    event.target.value = '';
  });
  const unsubscribe = queue.subscribe(updateQueue);
  const ready = queue.ready.then(() => {
    initialized = true; updateQueue(queue.snapshot());
    document.documentElement.dataset.studioReady = 'true';
  }).catch(error => { status(error.message); q('#empty-queue p').textContent = error.message; });
  window.addEventListener('pagehide', unsubscribe, { once: true });
  window.addEventListener('pagehide', () => clearTimeout(copyFeedbackTimer), { once: true });
  renderQueue(); renderTemplate();
  return { ready, updateTabs, tabError, readPage, getCompanyChats: () => savedCompanyChats(requests, candidateId()) };
}
