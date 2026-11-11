import { icon } from './icons.mjs';
import { profiles as exampleProfiles, prompts } from './studio-examples.mjs';
import { exampleProfile } from './resume-data.mjs';
import { savedChatUrl, requestChatUrl } from './saved-chat.mjs';
import { resumeTemplates, resumeTemplate } from './resume-templates.mjs';
import { metadataProvenance, provenanceLabel } from './job-metadata.mjs';
import { updateReadPageHint } from './shortcut-settings.mjs';
import { requestJobPageAccess } from './job-page-access.mjs';
import { duplicateCheckStorageKey, duplicateJobUrl, jobUrlInList } from './job-duplicates.mjs';
import { createQueueDocuments } from './queue-documents.mjs';
import { phaseLabel, runningPhases } from './generation-data.mjs';

export function createStudio({ openDialog, showStudio, showChat, moveTab, queue,
  generations, getChatProvider = () => 'chatgpt', getCurrentChat = () => null }) {
  const q = selector => document.querySelector(selector);
  let requests = [];
  const documents = createQueueDocuments({ queue, openDialog,
    getRequest: id => requests.find(item => item.id === id && item.input.candidateId === candidateId()),
    onSaved: () => { clearPreview(); showStudio('results'); status('Resume and cover letter saved on this job.'); }
  });
  let profiles = { ...exampleProfiles };
  let initialized = false;
  const pendingActions = new Set();
  const awaitingReview = new Set();
  let noticeTimer, duplicateOptionSaving = false;
  function showNotice(title, message) {
    clearTimeout(noticeTimer);
    q('#queue-notice-title').textContent = title;
    q('#queue-notice-message').textContent = message;
    q('#queue-notice').hidden = false;
    q('.queue-bar').title = `${title}. ${message}`;
    noticeTimer = setTimeout(() => { q('#queue-notice').hidden = true; }, 7000);
  }
  q('#queue-notice-dismiss').addEventListener('click', () => { clearTimeout(noticeTimer); q('#queue-notice').hidden = true; });
  const duplicateOptionReady = chrome.storage.local.get(duplicateCheckStorageKey)
    .then(value => { q('#check-existing-jobs').checked = value[duplicateCheckStorageKey] !== false; })
    .catch(() => { q('#check-existing-jobs').checked = true; })
    .finally(() => { q('#check-existing-jobs').disabled = false; });
  q('#check-existing-jobs').addEventListener('change', () => {
    if (duplicateOptionSaving) return;
    duplicateOptionSaving = true; q('#check-existing-jobs').disabled = true;
    void chrome.storage.local.set({ [duplicateCheckStorageKey]: q('#check-existing-jobs').checked }).catch(() => {
      q('#check-existing-jobs').checked = true;
      showNotice('Check option could not be saved', 'Duplicate checking stays on. Try changing the option again.');
    }).finally(() => { duplicateOptionSaving = false; q('#check-existing-jobs').disabled = false; });
  });
  const duplicateOptionChanged = (changes, area) => {
    if (area === 'local' && changes[duplicateCheckStorageKey] && !duplicateOptionSaving) q('#check-existing-jobs').checked = changes[duplicateCheckStorageKey].newValue !== false;
  };
  chrome.storage.onChanged.addListener(duplicateOptionChanged);
  let selectionLoaded = false;
  let currentTabId = null;
  let currentTabUrl = '', currentTabBusy = false;
  let previewId = null;
  let detailRequestId = null;
  let queueSearch = '', queueFilter = 'all';
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
    const reflectPending = () => { document.documentElement.dataset.studioBusy = String(pendingActions.size > 0); };
    pendingActions.add(key); reflectPending(); renderQueue();
    try { return await task(); }
    catch (error) {
      if (error.code === 'already-applied') {
        const field = error.duplicate.matchedBy.includes('company') ? 'Company' : 'Job URL';
        showNotice('Already applied', `${field} already exists in this candidate’s ${error.duplicate.location}. Nothing was added.`);
      } else { status(error.message); q('#profile-import-status').textContent = error.message; }
    }
    finally { pendingActions.delete(key); reflectPending(); renderQueue(); }
  }
  function renderCandidate() {
    const current = profile();
    q('#profile-filename').textContent = `${current.filename}${current.isExample !== false ? ' · Example profile' : ''}`;
    q('#profile-name').textContent = current.name;
    q('#profile-role').textContent = current.role;
    q('#profile-summary').textContent = current.summary;
    q('#profile-skills').replaceChildren(...current.skills.map(text => element('span', '', text)));
    q('#profile-kind').textContent = current.isExample !== false ? 'Example profile' : 'Imported profile';
  }
  function updateQueue(value) {
    requests = value.requests;
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
    button.disabled = pendingActions.has(`${name}:${id}`);
    return button;
  }
  function clearPreview() {
    previewId = null;
    q('#resume-preview').hidden = true;
    q('#resume-preview').open = false;
    q('#resume-paper').replaceChildren();
  }
  function renderQueue() {
    q('#studio-dock-toggle .preview-label').textContent = 'Saved jobs';
    const all = requests.filter(request => request.input.candidateId === candidateId() && request.state !== 'cancelled');
    const own = all;
    const matches = request => {
      const text = `${request.input.job.company} ${request.input.job.role}`.toLocaleLowerCase();
      return text.includes(queueSearch) && (queueFilter === 'all' || request.state === queueFilter);
    };
    const visible = own.filter(matches);
    q('#queue-no-matches').hidden = !all.length || visible.length > 0;
    q('#add-request').disabled = !initialized || pendingActions.has('add');
    q('#review-count').textContent = own.length;
    q('#queue-owner').textContent = profile().name;
    q('#empty-queue').hidden = all.length > 0;
    const renderCard = request => {
      const { input } = request;
      const company = input.tailor ? input.job.company || 'Company not provided' : 'Base resume';
      const card = element('li', 'job-request');
      card.dataset.requestId = String(request.id);
      const top = element('div', 'request-top');
      const title = element('div', 'request-title');
      const heading = action('', null, 'details', request.id);
      heading.className = 'request-title-button';
      heading.setAttribute('aria-label', `View job details for ${input.job.role} at ${company}`);
      heading.append(element('strong', '', company), element('p', '', input.job.role));
      title.append(heading);
      const pill = element('span', 'state-pill');
      pill.dataset.state = request.state;
      const labels = { ready: request.isExample ? 'Ready' : 'Ready for review', queued: 'Queued', attention: 'Needs attention' };
      pill.append(icon(request.state === 'ready' ? 'check' : 'clock'), document.createTextNode(labels[request.state] || request.state));
      top.append(element('span', 'company-mark', company[0]), title, pill);
      const number = typeof request.id === 'number' ? String(request.id).padStart(3, '0') : request.id.slice(0, 8);
      const meta = element('div', 'request-meta', `${input.profile.name.split(' ')[0]} · ${resumeTemplate(input.resumeTemplate).name} · #${number}`);
      if (request.updatedAt) {
        const date = new Date(request.updatedAt);
        if (Number.isFinite(date.getTime())) {
          const stamp = element('time', 'request-updated', date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
          stamp.dateTime = date.toISOString(); stamp.title = `Updated ${date.toLocaleString()}`; meta.append(stamp);
        }
      }
      if (request.state === 'ready' && request.isExample) {
        const saved = element('span', 'example-saved');
        saved.append(icon('check'), document.createTextNode('Saved example'));
        meta.append(saved);
      }
      card.append(top, meta);
      if (request.isExample) card.append(element('p', 'field-hint', 'Example result'));
      const actions = element('div', 'request-actions');
      if (!request.isExample) {
        const run = generations.forJob(request.id);
        const complete = run && ['complete', 'invalid'].includes(run.phase);
        const stopped = run && ['attention', 'stopped'].includes(run.phase);
        const name = !run ? 'generate' : complete ? 'review-generation' : stopped ? 'resume-generation' : 'open-generation';
        const label = !run ? 'Generate documents' : complete ? 'Review documents' : stopped ? 'Resume' : 'Open AI tab';
        const primary = action(label, 'sparkles', name, request.id); primary.classList.add('generation-action');
        actions.append(primary);
        if (run) {
          const note = element('p', 'generation-status', `${run.provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT'} · ${phaseLabel(run)}${run.error ? '. ' + run.error : ''}`);
          note.setAttribute('role', 'status'); card.append(note);
          if (complete || stopped) actions.append(action('Open AI tab', 'external', 'open-generation', request.id));
          if (runningPhases.includes(run.phase)) actions.append(action('Stop tracking', 'close', 'stop-generation', request.id));
        }
      }
      actions.append(action('Details', 'file', 'details', request.id));
      const jobUrl = safeJobUrl(input.job.url);
      if (jobUrl) {
        const link = element('a', 'button', 'Go to apply');
        link.href = jobUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
      }
      if (request.state === 'ready' || requestChatUrl(request)) {
        const review = action('Open chat', 'chat', 'review', request.id);
        review.disabled = !requestChatUrl(request);
        review.title = review.disabled ? 'No originating conversation is recorded. Open Details to inspect this result.' : 'Open this result’s originating conversation';
        actions.prepend(review);
      }
      if (request.state === 'ready') actions.append(action('View resume', 'file', 'preview', request.id));
      const editDocuments = action('Documents', 'file-pen', 'documents', request.id);
      actions.append(editDocuments);
      if (['queued', 'attention'].includes(request.state)) actions.append(action('Cancel', 'close', 'cancel', request.id));
      card.append(actions);
      return card;
    };
    q('#resume-queue').replaceChildren(...visible.map(renderCard));
    const counts = own.reduce((total, request) => { total[request.state] = (total[request.state] || 0) + 1; return total; }, {});
    const parts = [];
    if (counts.ready) parts.push(`${counts.ready} ready`);
    if (counts.queued) parts.push(`${counts.queued} queued`);
    if (counts.attention) parts.push(`${counts.attention} need attention`);
    q('#queue-summary').textContent = parts.join(' · ') || 'Queue empty';
    renderCurrentJob();
  }

  function safeJobUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  }
  function renderCurrentJob() {
    const button = q('#capture-current-job');
    button.hidden = !canCaptureCurrentJob();
    const busy = pendingActions.has('add') || Boolean(reading) || currentTabBusy;
    button.disabled = busy || button.hidden;
    button.setAttribute('aria-busy', String(busy));
    q('#capture-current-job-label').textContent = pendingActions.has('add')
      ? reading?.phase === 'permission' ? 'Allow website access…' : reading ? 'Reading job…' : 'Saving job…'
      : 'Add This Job in One Click';
  }
  function canCaptureCurrentJob() {
    return initialized && Number.isInteger(currentTabId) && currentTabId >= 0 && Boolean(safeJobUrl(currentTabUrl)) &&
      !jobUrlInList(currentTabUrl, candidateId(), requests);
  }
  q('#queue-search').addEventListener('input', event => { queueSearch = event.target.value.trim().toLocaleLowerCase(); renderQueue(); });
  q('#queue-filter').addEventListener('change', event => { queueFilter = event.target.value; renderQueue(); });
  q('#capture-current-job').addEventListener('click', () => {
    if (!canCaptureCurrentJob() || reading || currentTabBusy || pendingActions.has('add')) return;
    const tabId = currentTabId, url = currentTabUrl;
    const input = structuredClone({ candidateId: candidateId(), profile: profile(), tailor: true,
      resumeTemplate: q('#resume-template').value, promptTemplate: q('#prompt-template').value,
      prompt: prompts[q('#prompt-template').value].text });
    const checkExisting = q('#check-existing-jobs').checked;
    void perform(async () => {
      // Request site access in this click's gesture, before any other await.
      const response = await readPage(tabId, { askAccess: true, showErrorDialog: false });
      if (!response) {
        showNotice('Job was not added', readFeedback.get(tabId)?.message || 'Try again when the job page is ready.');
        return;
      }
      const latest = await chrome.tabs.get(tabId).catch(() => null);
      if (tabId !== currentTabId || currentTabUrl !== url || latest?.url !== url || candidateId() !== input.candidateId ||
          duplicateJobUrl(response.fields?.url) !== duplicateJobUrl(url)) {
        showNotice('Job was not added', 'The page or selected profile changed. Click Add This Job on the page you want to save.');
        return;
      }
      if (jobUrlInList(url, input.candidateId, queue.snapshot().requests)) return;
      const fields = response.fields;
      if (!fields.description?.trim()) {
        showStudio('job');
        showNotice('Add the job description', 'This page did not provide a job description. Review the form before saving.');
        q('#job-description').focus();
        return;
      }
      // Use the freshly read page, never a manually entered URL or another tab's draft.
      input.job = { company: fields.company?.trim() || '', role: fields.role?.trim() || input.profile.role,
        url: fields.url, description: fields.description.trim(), tabId, provenance: response.provenance };
      try { await saveRequest(input, { checkExisting, checkExistingUrl: true }); }
      catch (error) {
        if (error.code !== 'already-applied') showNotice('Job was not added', error.message);
        throw error;
      }
    }, 'add');
  });

  function updateTabs({ count, index, tabId, url, busy }) {
    currentTabUrl = url || ''; currentTabBusy = Boolean(busy);
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
    renderCurrentJob();
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
    renderCurrentJob();
  }
  function readMessage(tabId, state, message) {
    readFeedback.set(tabId, { state, message });
    if (tabId === currentTabId) renderReadButton();
  }
  async function readPage(tabId = currentTabId, { askAccess = false, showErrorDialog = true } = {}) {
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
      if (active) renderCurrentJob();
      const missing = response.missing?.filter(key=>key!=='url') || [];
      const names = {company:'company name',role:'job title',description:'Job Description'};
      const message = missing.length ? `Read ${filled} fields. Review missing ${missing.map(key=>names[key] || key).join(', ')}.` : 'Job details read. Review the fields before adding to queue.';
      readMessage(request.tabId, missing.length ? 'warning' : 'success', message);
      status(active ? message : 'Job details saved to the source tab’s draft.');
      return response;
    } catch (error) {
      if (reading===request) {
        const message = error.message;
        readMessage(request.tabId, 'error', message);
        if (currentTabId===request.tabId) {
          status(message);
          if (showErrorDialog && error.code !== 'access-denied') {
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
    const source = requestChatUrl(request);
    const current = savedChatUrl(getCurrentChat());
    const savedCompany = request.input.tailor;
    q('#request-source-note').textContent = source ? `Connected chat · ${request.input.job.company}`
      : savedCompany ? 'Open this job’s conversation in Chat, then connect it here to reopen it from the queue.'
      : 'Connect conversations from a job with a company attached.';
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
    metadata.push(['Company source', provenanceLabel(provenance.company)], ['Job title source', provenanceLabel(provenance.role)]);
    if (input.tailor && input.job.url) metadata.push(['Source URL', input.job.url]);
    q('#request-metadata').replaceChildren(...metadata.flatMap(([label, value]) => [element('dt', '', label), element('dd', '', value)]));
    q('#request-prompt').textContent = input.prompt;
    q('#request-job').textContent = input.tailor ? input.job.description : 'No job description attached to this base resume.';
    const listing = q('#request-job-link'), listingUrl = safeJobUrl(input.job.url);
    listing.hidden = !listingUrl;
    if (listingUrl) listing.href = listingUrl; else listing.removeAttribute('href');
    q('#request-output-section').hidden = !request.resume && !request.rawOutput;
    q('#request-output').textContent = request.resume ? JSON.stringify(request.resume, null, 2) : request.rawOutput || '';
    renderSource(request);
    renderGenerationDetails();
    openDialog('request-dialog');
  }
  function renderGenerationDetails() {
    const run = generations.forJob(detailRequestId);
    q('#request-generation-section').hidden = !run;
    q('#request-generation-status').textContent = run ? `${phaseLabel(run)}${run.error ? '. ' + run.error : ''}` : '';
    q('#request-generation-diagnostics').textContent = run?.diagnostics || run?.captureDiagnostics ? JSON.stringify({
      ...(run.diagnostics ? { submission: { checkedAt: new Date(run.diagnosticAt).toISOString(), ...run.diagnostics } } : {}),
      ...(run.captureDiagnostics ? { capture: { checkedAt: new Date(run.captureDiagnosticAt).toISOString(), ...run.captureDiagnostics } } : {})
    }, null, 2) : 'No AI diagnostics have been recorded for this run yet.';
    q('#copy-generation-diagnostics').hidden = !run?.diagnostics && !run?.captureDiagnostics;
  }
  q('#copy-generation-diagnostics').addEventListener('click', async () => {
    const text = q('#request-generation-diagnostics').textContent;
    try { await navigator.clipboard.writeText(text); status('Submission diagnostics copied.'); }
    catch {
      const range = document.createRange(); range.selectNodeContents(q('#request-generation-diagnostics'));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      status('Diagnostics selected. Press Ctrl+C or Command+C to copy.');
    }
  });
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

  function requestAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const request = requests.find(item => String(item.id) === button.dataset.request && item.input.candidateId === candidateId());
    if (!request) return;
    if (['generate', 'review-generation', 'resume-generation', 'open-generation', 'stop-generation'].includes(button.dataset.action)) {
      const name = button.dataset.action;
      void perform(async () => {
        const run = generations.forJob(request.id);
        if (name === 'generate') {
          awaitingReview.add(request.id);
          try { await generations.start(request.id, getChatProvider()); status('Document generation connected to the AI tab. Progress is saved while the dock is closed.'); }
          catch (error) { awaitingReview.delete(request.id); throw error; }
        } else if (name === 'review-generation') await reviewGeneration(request.id, run.id);
        else if (name === 'stop-generation') { awaitingReview.delete(request.id); await generations.stop(run.id); status('Tracking stopped. Any response already generating stays in the AI tab.'); }
        else { if (name === 'resume-generation') awaitingReview.add(request.id); await generations.open(run.id, name === 'resume-generation'); }
      }, `${name}:${request.id}`);
      return;
    }
    if (button.dataset.action === 'details') requestDetails(request);
    if (button.dataset.action === 'review') {
      const url = requestChatUrl(request);
      if (url) showChat(url);
    }
    if (button.dataset.action === 'preview') preview(request);
    if (button.dataset.action === 'documents') documents.open(request.id);
    if (button.dataset.action === 'cancel') {
      void perform(async () => {
        const run = generations.forJob(request.id);
        if (run) await generations.stop(run.id);
        awaitingReview.delete(request.id);
        await queue.cancel(request.id); if (previewId === request.id) clearPreview(); status(`Request cancelled · ${request.input.job.company}`);
      }, `cancel:${request.id}`);
    }
  }
  q('#resume-queue').addEventListener('click', requestAction);
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
    renderCurrentJob();
  });
  for (const [id, delta] of [['previous-job', -1], ['next-job', 1]]) {
    document.getElementById(id).addEventListener('click', () => { void moveTab(delta); });
  }
  for (const [id, kind] of [['resume-template', 'resume'], ['prompt-template', 'prompt']]) {
    document.getElementById(id).addEventListener('focus', () => renderTemplate(kind));
    document.getElementById(id).addEventListener('change', () => renderTemplate(kind));
  }
  q('#add-request').addEventListener('click', () => { void perform(async () => {
    q('#queue-notice').hidden = true; clearTimeout(noticeTimer);
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
    await saveRequest(input, { checkExisting: q('#check-existing-jobs').checked });
  }, 'add'); });

  async function saveRequest(input, options) {
    q('#queue-notice').hidden = true; clearTimeout(noticeTimer);
    await queue.add(input, options);
    clearPreview(); renderQueue();
    if (q('#chat-view').hidden) showStudio('results');
    status('Job saved to the queue.');
  }

  for (const id of ['review-another', 'empty-prepare']) document.getElementById(id).addEventListener('click', () => showStudio('job'));
  for (const id of ['view-queue', 'open-queue']) document.getElementById(id).addEventListener('click', () => showStudio('results'));
  q('#request-open-chat').addEventListener('click', () => {
    const request = requests.find(item => item.id === detailRequestId && item.input.candidateId === candidateId());
    const url = requestChatUrl(request);
    if (!url) return;
    q('#request-dialog').close(); showChat(url);
  });
  q('#request-connect-chat').addEventListener('click', () => {
    const request = requests.find(item => item.id === detailRequestId && item.input.candidateId === candidateId());
    const url = savedChatUrl(getCurrentChat());
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
    status('Example results loaded.');
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
  async function reviewGeneration(jobId, runId) {
    const generated = await generations.read(runId);
    const request = requests.find(item => item.id === jobId && item.state !== 'cancelled' && item.input.candidateId === candidateId());
    if (!request || generated.jobId !== jobId) return;
    if (q('dialog[open]')) { showNotice('Documents are ready', 'Close the current dialog, then choose Review documents on this job.'); return; }
    documents.open(jobId, { generated });
  }
  const unsubscribeRuns = generations.subscribe(runs => {
    renderQueue();
    if (q('#request-dialog').open) renderGenerationDetails();
    for (const run of runs) if (awaitingReview.has(run.jobId) && ['complete', 'invalid'].includes(run.phase)) {
      awaitingReview.delete(run.jobId);
      void reviewGeneration(run.jobId, run.id).catch(error => status(error.message));
    }
  });
  void generations.ready.catch(error => status(error.message));
  const ready = Promise.all([queue.ready, duplicateOptionReady]).then(() => {
    initialized = true; updateQueue(queue.snapshot());
    document.documentElement.dataset.studioReady = 'true';
  }).catch(error => { status(error.message); q('#empty-queue p').textContent = error.message; });
  window.addEventListener('pagehide', unsubscribe, { once: true });
  window.addEventListener('pagehide', unsubscribeRuns, { once: true });
  window.addEventListener('pagehide', () => { clearTimeout(noticeTimer); chrome.storage.onChanged.removeListener(duplicateOptionChanged); }, { once: true });
  renderQueue(); renderTemplate();
  return { ready, updateTabs, tabError, readPage,
    chatError(message) { status(message); showNotice('Chat could not open', message); }
  };
}
