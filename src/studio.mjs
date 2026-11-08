import { icon } from './icons.mjs';
import { profiles, prompts, createExamples } from './studio-examples.mjs';
import { savedCompanyChats } from './company-chats.mjs';
import { linkedConversationUrl } from './sidebar-protocol.mjs';
import { resumeTemplates, resumeTemplate } from './resume-templates.mjs';

export function createStudio({ openDialog, showStudio, showChat, moveTab,
  getCurrentChat = () => null, onCompanyChatsChange = () => {} }) {
  const q = selector => document.querySelector(selector);
  let requests = createExamples();
  let nextId = 4;
  let currentTabId = null;
  let previewId = null;
  let detailRequestId = null;
  let paused = false;
  const jobDrafts = new Map();
  const manualUrls = new Set();
  const jobFields = { company: '#job-company', role: '#job-title', url: '#job-url', description: '#job-description' };
  const jobDraft = () => Object.fromEntries(Object.entries(jobFields).map(([key, selector]) => [key, q(selector).value]));
  const status = text => { q('#workspace-status').textContent = text; q('.queue-bar').title = text; };
  const candidateId = () => q('#candidate').value;
  const profile = () => profiles[candidateId()];
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
    return button;
  }
  function clearPreview() {
    previewId = null;
    q('#resume-preview').hidden = true;
    q('#resume-preview').open = false;
    q('#resume-paper').replaceChildren();
  }
  function renderQueue() {
    const own = requests.filter(request => request.input.candidateId === candidateId());
    q('#review-count').textContent = own.length;
    q('#queue-owner').textContent = profile().name;
    q('#empty-queue').hidden = own.length > 0;
    q('#resume-queue').replaceChildren(...own.map(request => {
      const { input } = request;
      const company = input.tailor ? input.job.company : 'Base resume';
      const card = element('li', 'job-request');
      card.dataset.requestId = String(request.id);
      const top = element('div', 'request-top');
      const title = element('div', 'request-title');
      title.append(element('strong', '', company), element('p', '', input.job.role));
      const pill = element('span', 'state-pill');
      pill.dataset.state = request.state;
      pill.append(icon(request.state === 'ready' ? 'check' : 'clock'), document.createTextNode({ ready: 'Ready', saving: 'Save pending', queued: 'Queued' }[request.state]));
      top.append(element('span', 'company-mark', company[0]), title, pill);
      const meta = element('div', 'request-meta', `${input.profile.name.split(' ')[0]} · ${resumeTemplate(input.resumeTemplate).name} · #${String(request.id).padStart(3, '0')}`);
      if (request.state === 'ready') {
        const saved = element('span', 'example-saved');
        saved.append(icon('check'), document.createTextNode('Saved example'));
        meta.append(saved);
      }
      card.append(top, meta);
      if (request.state === 'saving') card.append(element('p', 'request-note', 'Example result retained · Try the save-retry interaction.'));
      if (request.state === 'queued') card.append(element('p', 'field-hint', 'Example queued · Generation is not connected.'));
      const actions = element('div', 'request-actions');
      actions.append(action('Review', 'chat', 'review', request.id));
      if (request.state === 'ready') actions.append(action('Preview', 'file', 'preview', request.id));
      if (request.state === 'saving') actions.append(action('Retry save', 'refresh', 'retry-save', request.id));
      if (request.state === 'queued') actions.append(action('Cancel', 'close', 'cancel', request.id));
      card.append(actions);
      return card;
    }));
    const counts = own.reduce((total, request) => { total[request.state]++; return total; }, { ready: 0, saving: 0, queued: 0 });
    const parts = [];
    if (counts.ready) parts.push(`${counts.ready} ready`);
    if (counts.saving) parts.push(`${counts.saving} save pending`);
    if (counts.queued) parts.push(`${counts.queued} queued`);
    q('#queue-summary').textContent = (paused ? 'Paused · ' : '') + (parts.join(' · ') || 'Example queue empty');
    const pause = q('#pause-queue');
    pause.setAttribute('aria-pressed', String(paused));
    pause.title = paused ? 'Resume queue' : 'Pause queue';
    pause.setAttribute('aria-label', pause.title);
    pause.replaceChildren(icon(paused ? 'play' : 'pause'));
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
  }
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
    const savedCompany = request.state === 'ready' && Boolean(request.resume) && request.input.tailor;
    q('#request-source-note').textContent = source ? `Connected chat · ${request.input.job.company}`
      : savedCompany ? 'Open this company’s conversation in Chat, then connect it here.'
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
    if (input.tailor && input.job.url) metadata.push(['Source URL', input.job.url]);
    q('#request-metadata').replaceChildren(...metadata.flatMap(([label, value]) => [element('dt', '', label), element('dd', '', value)]));
    q('#request-prompt').textContent = input.prompt;
    q('#request-job').textContent = input.tailor ? input.job.description : 'No job description attached to this base resume.';
    q('#request-output-section').hidden = !request.resume;
    q('#request-output').textContent = request.resume ? JSON.stringify(request.resume, null, 2) : '';
    renderSource(request);
    openDialog('request-dialog');
  }
  function preview(request) {
    if (request.state !== 'ready' || !request.resume) return;
    previewId = request.id;
    showStudio('results');
    q('#resume-preview').hidden = false;
    q('#resume-preview').open = true;
    q('#resume-preview-title').textContent = `${request.input.tailor ? request.input.job.company : 'Base resume'} · Example resume`;
    const paper = q('#resume-paper');
    const data = request.resume;
    paper.dataset.template = request.input.resumeTemplate;
    paper.replaceChildren(element('h2', '', request.input.profile.name), element('p', 'resume-title', data.title));
    paper.append(element('h3', '', 'Summary'), element('p', '', data.summary));
    paper.append(element('h3', '', 'Skills'), element('p', '', data.skills.flatMap(group => Object.values(group).flat()).join(' · ')));
    if (data.experience.length) {
      paper.append(element('h3', '', 'Experience'));
      for (const experience of data.experience) {
        paper.append(element('p', '', `${experience.title} · ${experience.company}`));
        const list = element('ul');
        list.append(...experience.sentences.map(text => element('li', '', text)));
        paper.append(list);
      }
    }
    if (data.education.length) paper.append(element('h3', '', 'Education'), ...data.education.map(item => element('p', '', item.degree)));
    q('#resume-preview').scrollIntoView({ block: 'start' });
    status(`Previewing the ${resumeTemplate(request.input.resumeTemplate).name} example · ${data.company}`);
  }

  q('#resume-queue').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const request = requests.find(item => item.id === Number(button.dataset.request) && item.input.candidateId === candidateId());
    if (!request) return;
    if (button.dataset.action === 'review') requestDetails(request);
    if (button.dataset.action === 'preview') preview(request);
    if (button.dataset.action === 'retry-save') {
      request.state = 'ready';
      renderQueue();
      status(`Example save completed · ${request.input.job.company}. No generation was started.`);
    }
    if (button.dataset.action === 'cancel') {
      requests = requests.filter(item => item.id !== request.id);
      if (previewId === request.id) clearPreview();
      renderQueue();
      status(`Example request cancelled · ${request.input.job.company}`);
    }
  });

  q('#candidate').addEventListener('change', () => {
    q('#candidate-avatar').textContent = profile().initials;
    q('#profile-filename').textContent = `${profile().filename} · Example profile`;
    clearPreview(); renderQueue(); renderTemplate();
    status(`Example candidate · ${profile().name}`);
  });
  q('#profile-details').addEventListener('click', () => {
    const current = profile();
    q('#profile-name').textContent = current.name;
    q('#profile-role').textContent = current.role;
    q('#profile-summary').textContent = current.summary;
    q('#profile-skills').replaceChildren(...current.skills.map(text => element('span', '', text)));
    openDialog('profile-dialog');
  });
  q('#tailor').addEventListener('change', () => {
    const checked = q('#tailor').checked;
    q('#prompt-template-field').hidden = !checked;
    q('#prompt-template').disabled = !checked;
    q('#tailor-description').textContent = checked ? 'Use the profile and job description.' : 'Prepare a base resume from this profile.';
    renderTemplate();
  });
  for (const selector of Object.values(jobFields)) q(selector).addEventListener('input', () => {
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
  q('#add-request').addEventListener('click', () => {
    const description = q('#job-description').value.trim();
    if (q('#tailor').checked && !description) {
      status('Add a job description before preparing a tailored example.');
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
    const input = structuredClone({ candidateId: candidateId(), profile: profile(),
      job: { company: tailor ? q('#job-company').value.trim() || 'Untitled company' : 'Base resume',
        role: tailor ? q('#job-title').value.trim() || profile().role : profile().role, url, tabId: currentTabId, description }, tailor,
      resumeTemplate: q('#resume-template').value, promptTemplate, prompt: prompts[promptTemplate].text });
    requests.push({ id: nextId++, state: 'queued', input, resume: null });
    clearPreview(); renderQueue(); showStudio('results');
    q('#studio-scroll').scrollTop = 0;
    status('Added to the example queue · Generation is not connected yet.');
  });

  for (const id of ['review-another', 'empty-prepare']) document.getElementById(id).addEventListener('click', () => showStudio('job'));
  for (const id of ['view-queue', 'open-queue']) document.getElementById(id).addEventListener('click', () => showStudio('results'));
  q('#pause-queue').addEventListener('click', () => {
    paused = !paused; renderQueue();
    status(paused ? 'Example queue paused · Existing drafts remain available.' : 'Example queue resumed · Generation is not connected yet.');
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
    if (!request || request.state !== 'ready' || !request.resume || !request.input.tailor || !url) return;
    request.sourceChatUrl = url;
    renderSource(request); renderQueue();
    status(`Chat connected · ${request.input.job.company}`);
  });
  q('#copy-json').addEventListener('click', async () => {
    const request = requests.find(item => item.id === previewId && item.input.candidateId === candidateId());
    if (!request?.resume) return;
    try { await navigator.clipboard.writeText(JSON.stringify(request.resume, null, 2)); status('Example resume JSON copied.'); }
    catch { status('Could not copy. Open Review to select the example JSON.'); }
  });
  q('#export-resume').addEventListener('click', () => openDialog('export-dialog'));
  q('#reset-examples').addEventListener('click', () => {
    q('#profile-dialog').close();
    requests = createExamples(); nextId = 4; paused = false;
    jobDrafts.clear();
    manualUrls.clear();
    for (const selector of Object.values(jobFields)) { q(selector).value = ''; q(selector).setCustomValidity(''); }
    q('#candidate').value = 'morgan';
    q('#candidate-avatar').textContent = profiles.morgan.initials;
    q('#profile-filename').textContent = `${profiles.morgan.filename} · Example profile`;
    q('#tailor').checked = true; q('#job-context').hidden = false;
    q('#tailor-description').textContent = 'Use the profile and job description.';
    q('#resume-template').value = resumeTemplates[0].id; q('#prompt-template').value = 'focused';
    q('#prompt-template').disabled = false; q('#prompt-template-field').hidden = false;
    clearPreview(); renderQueue(); renderTemplate(); showStudio('results');
    q('#studio-scroll').scrollTop = 0;
    status('Example workspace reset. Your ChatGPT conversation is unchanged.');
  });
  renderQueue(); renderTemplate();
  return { updateTabs, tabError, getCompanyChats: () => savedCompanyChats(requests, candidateId()) };
}
