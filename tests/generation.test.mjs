import test from 'node:test';
import assert from 'node:assert/strict';
import { generationPrompt, validateGeneration, jsonObjects, providerUrl } from '../src/generation-data.mjs';
import { createGenerationService } from '../src/generation-service.mjs';
import { createGenerationClient } from '../src/generation-client.mjs';
import { exampleProfile } from '../src/resume-data.mjs';
import { cleanupInput } from '../src/job-cleanup.mjs';

const job = () => ({ id: 'job-1', state: 'queued', input: { candidateId: 'candidate-1', profile: structuredClone(exampleProfile), tailor: true,
  job: { company: 'Northstar', role: 'Software Engineer', description: 'Build reliable services.' } }, updatedAt: 1 });
const envelope = (item, id) => ({ schemaVersion: 1, requestId: item.id, runId: id,
  job: { company: item.input.job.company, title: item.input.job.role, applyUrl: item.input.job.url || '', description: item.input.job.description,
    salary: { value: 'USD 100,000–130,000 / year', source: 'estimated', evidence: '', basis: 'Candidate engineering experience; assumed US annual salary.' } },
  resume: { company: item.input.job.company,
  title: exampleProfile.role, summary: exampleProfile.summary, skills: [{ Skills: exampleProfile.skills }],
  experience: exampleProfile.experience, education: exampleProfile.education }, coverLetter: 'I am applying for the engineering position.' });
function memoryStore() {
  let state = { runs: [] }, chain = Promise.resolve();
  return { read: async () => structuredClone(state), change(edit) {
    const operation = chain.then(() => { const next = structuredClone(state), value = edit(next); state = next; return { state: structuredClone(state), value: structuredClone(value) }; });
    chain = operation.catch(() => {}); return operation;
  } };
}
function fixture(config = {}) {
  const rows = [job()], tabs = new Map([[1, { id: 1, windowId: 1, active: true, lastAccessed: 1, url: 'https://chatgpt.com/' }]]), session = {}, local = {}, injections = [], probes = [], notifications = [], createdTabs = [], updates = [];
  let id = 0, clock = 1000, tabId = 1;
  const event = () => { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => listeners.forEach(fn => fn(...args)) }; };
  const browser = { runtime: { id: 'extension', sendMessage: async message => { notifications.push(message); } },
    storage: { local: { get: async key => ({ [key]: structuredClone(local[key]) }) }, session: { get: async key => ({ [key]: session[key] }), set: async values => Object.assign(session, values), remove: async key => { delete session[key]; } } },
    tabs: { onUpdated: event(), onRemoved: event(), onActivated: event(), query: async () => [...tabs.values()],
      create: async values => { while (tabs.has(++tabId)) {} const tab = { id: tabId, windowId: 1, ...values }; tabs.set(tab.id, tab); createdTabs.push(tab); return tab; },
      get: async id => { if (!tabs.has(id)) throw new Error('Closed'); return tabs.get(id); }, update: async (id, values) => { updates.push({ id, ...values }); return Object.assign(tabs.get(id), values); },
      remove: async id => tabs.delete(id), sendMessage: async () => {} }, windows: { update: async () => {} },
    scripting: { executeScript: async options => {
      if (options.func?.name === 'providerTabState') {
        probes.push(options.target.tabId); const tab = tabs.get(options.target.tabId);
        return [{ result: { ready: tab.ready !== false && !tab.busy, busy: Boolean(tab.busy), url: tab.url } }];
      }
      if (options.func?.name === 'hasPostedPrompt') return [{ result: tabs.get(options.target.tabId)?.postedRun === options.args[1] }];
      injections.push(options);
    } } };
  const store = memoryStore(), options = { browser, store, jobs: { read: async () => ({ requests: structuredClone(rows) }), change: async edit => {
    const state = { requests: structuredClone(rows) }, value = edit(state); rows.splice(0, rows.length, ...state.requests);
    return { state: structuredClone(state), value: structuredClone(value) };
  } }, now: () => ++clock, uuid: () => `run-${++id}`, ...config };
  const service = createGenerationService(options);
  const sender = run => ({ id: 'extension', tab: { id: run.tabId }, frameId: 0, documentId: 'document-1', url: tabs.get(run.tabId).url });
  const saved = async () => (await store.read()).runs[0];
  return { service, options, browser, rows, tabs, session, local, store, sender, saved, injections, probes, notifications, createdTabs, updates, advance: ms => { clock += ms; } };
}

async function submitted(f, jobId = 'job-1', provider = 'deepseek') {
  const run = await f.service.start(jobId, provider), sender = f.sender(run), actor = `actor-${run.id}`;
  await f.service.attach(run.id, actor, sender);
  await f.service.event(run.id, actor, { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
  const url = provider === 'deepseek' ? `https://chat.deepseek.com/a/chat/s/${run.id}` : `https://chatgpt.com/c/${run.id}`;
  f.tabs.get(run.tabId).url = url;
  await f.service.event(run.id, actor, { kind: 'phase', phase: 'submitted', url }, sender);
  await f.service.event(run.id, actor, { kind: 'phase', phase: 'generating', url }, sender);
  return { run: await f.service.read(run.id), sender, actor, url };
}

for(const provider of ['chatgpt','deepseek']) test(`${provider} fetch again observes a failed reply without authorizing another submission`,async()=>{
  const f=fixture(),first=await submitted(f,'job-1',provider);
  await f.service.event(first.run.id,first.actor,{kind:'result',raw:'invalid JSON',url:first.url},first.sender);
  assert.equal((await f.service.read(first.run.id)).phase,'invalid');
  const fresh=await f.service.refetch(first.run.id);
  assert.equal(fresh.sendIntentAt,first.run.sendIntentAt);assert.equal(fresh.phase,'submitted');
  const attach=await f.service.attach(first.run.id,'refetch-actor',f.sender(fresh));
  assert.equal(attach.mode,'observe');
  const authorization=await f.service.event(first.run.id,'refetch-actor',{kind:'authorize',baseline:{users:0,answers:0}},f.sender(fresh));
  assert.equal(authorization.granted,false);
  f.service.dispose();
});
test('fetch again cannot prepare an unsent prompt',async()=>{
  const f=fixture(),run=await f.service.start('job-1','chatgpt');
  await assert.rejects(f.service.refetch(run.id),/No submission attempt/);f.service.dispose();
});

test('prompts bind immutable candidate/job data and output validation preserves fixed facts', () => {
  const item = job(), data = envelope(item, 'run-1'), prompt = generationPrompt(item, 'run-1');
  assert.ok(prompt.startsWith('DOCUMENT_RUN:run-1'));
  assert.ok(prompt.includes('"runId":"run-1"'));
  assert.ok(prompt.includes('```json')); assert.ok(prompt.includes('perform three checks'));
  assert.equal(validateGeneration('```json\n' + JSON.stringify(data) + '\n```', item, 'run-1').resume.company, 'Northstar');
  assert.throws(() => validateGeneration(JSON.stringify(data), item, 'run-2'), /matching/);
  const changed = structuredClone(data); changed.resume.experience[0].company = 'Invented';
  assert.throws(() => validateGeneration(JSON.stringify(changed), item, 'run-1'), /profile fact/);
  assert.throws(() => validateGeneration(JSON.stringify({ ...data, coverLetter: '' }), item, 'run-1'), /cover letter/);
  assert.throws(() => validateGeneration(JSON.stringify(data) + JSON.stringify(data), item, 'run-1'), /one complete/);
  assert.deepEqual(jsonObjects('prefix {"text":"brace } and escaped \\\" quote"} tail'), [{ text: 'brace } and escaped " quote' }]);
  assert.deepEqual(jsonObjects('{"incomplete":'), []);
  assert.equal(providerUrl('https://chatgpt.com.evil.test/c/a', 'chatgpt'), null);
  assert.equal(providerUrl('https://chat.deepseek.com/a/chat/s/123?private=value', 'deepseek', true), 'https://chat.deepseek.com/a/chat/s/123');
});

test('code-panel results must pass JSON syntax, run/schema identity, and fixed-fact validation', () => {
  const item = job(), value = envelope(item, 'run-1'), raw = JSON.stringify(value);
  assert.equal(validateGeneration(raw, item, 'run-1', 'json-code-block').resume.company, 'Northstar');
  for (const invalid of [raw + '\n' + raw, '[ ' + raw + ' ]', 'Text outside\n' + raw, raw.slice(0, -1)]) {
    assert.throws(() => validateGeneration(invalid, item, 'run-1', 'json-code-block'), /exactly one complete JSON object/);
  }
  assert.throws(() => validateGeneration(JSON.stringify({ ...value, runId: 'wrong-run' }), item, 'run-1', 'json-code-block'), /matching this job and run/);
  assert.throws(() => validateGeneration(JSON.stringify({ ...value, schemaVersion: 9 }), item, 'run-1', 'json-code-block'));
  const invented = structuredClone(value); invented.resume.experience[0].company = 'Invented employer';
  assert.throws(() => validateGeneration(JSON.stringify(invented), item, 'run-1', 'json-code-block'), /profile fact/);
});

test('application replies correct job identity while preserving candidate facts and salary evidence', () => {
  const item = job(); item.input.job.url = 'https://jobs.example.test/role';
  const value = envelope(item, 'enrich'); value.job.company = 'Actual Employer'; value.job.title = 'Platform Engineer';
  value.job.description = 'Build TypeScript services. Requirements: SQL.'; value.resume.company = 'Actual Employer';
  const result = validateGeneration(JSON.stringify(value), item, 'enrich', 'json-code-block', {}, { requireJob: true });
  assert.equal(result.job.company, 'Actual Employer'); assert.equal(result.job.role, 'Platform Engineer');
  assert.equal(result.resume.company, result.job.company); assert.equal(result.job.salarySource, 'estimated');
  assert.match(generationPrompt(item, 'enrich'), /estimate a reasonable salary RANGE/);
  const missing = structuredClone(value); delete missing.job;
  assert.throws(() => validateGeneration(JSON.stringify(missing), item, 'enrich', null, {}, { requireJob: true }), /cleaned job details/);
  const invented = structuredClone(value); invented.job.applyUrl = 'https://invented.example/apply';
  assert.throws(() => validateGeneration(JSON.stringify(invented), item, 'enrich'), /unobserved/);
  const facts = structuredClone(value); facts.resume.experience[0].company = 'Invented employer';
  assert.throws(() => validateGeneration(JSON.stringify(facts), item, 'enrich'), /profile fact/);
  const listed = structuredClone(value); listed.job.salary = { value: '$120,000–150,000 / year', source: 'listed', evidence: '$120,000–150,000 / year', basis: '' };
  assert.throws(() => validateGeneration(JSON.stringify(listed), item, 'enrich'), /exact quote/);
  item.input.job.description += ' Salary: $120,000–150,000 / year.';
  assert.equal(validateGeneration(JSON.stringify(listed), item, 'enrich').job.salarySource, 'listed');
  item.input.job.description = 'Build services.'; item.input.job.salary = listed.job.salary.value; item.input.job.salarySource = 'estimated';
  assert.throws(() => validateGeneration(JSON.stringify(listed), item, 'enrich'), /exact quote/, 'previous estimates cannot become employer-listed pay');
});

for (const provider of ['chatgpt','deepseek']) test(`${provider} commits cleaned job data before document approval with auto download off`, async () => {
  const f = fixture(); f.local.documentSettings = { autoDownload: false };
  const first = await submitted(f, 'job-1', provider), value = envelope(f.rows[0], first.run.id);
  value.job.company = 'Verified Employer'; value.job.title = 'Platform Engineer'; value.job.description = 'A clean job description.';
  value.resume.company = value.job.company;
  await f.service.event(first.run.id, first.actor, { kind: 'result', raw: JSON.stringify(value), url: first.url }, first.sender);
  const run = await f.service.read(first.run.id);
  assert.equal(run.phase, 'complete'); assert.equal(f.rows[0].input.job.company, 'Verified Employer');
  assert.equal(f.rows[0].input.job.role, 'Platform Engineer'); assert.equal(f.rows[0].input.job.description, 'A clean job description.');
  assert.equal(f.rows[0].input.job.salarySource, 'estimated'); assert.equal(f.rows[0].resume, undefined, 'document approval remains separate');
  assert.equal((await f.saved()).job.updatedAt, f.rows[0].updatedAt); assert.equal(f.rows[0].manualChatUrl, first.url);
  assert.equal(run.documentSettings.autoDownload, false);
  const revision = f.rows[0].updatedAt;
  await f.service.event(first.run.id, first.actor, { kind: 'result', raw: JSON.stringify(value), url: first.url }, first.sender);
  assert.equal(f.rows[0].updatedAt, revision, 'duplicate completion does not repeat the job update');
  f.service.dispose();
});

test('a late job result preserves a newer edit and remains reviewable', async () => {
  const f = fixture(), first = await submitted(f), value = envelope(f.rows[0], first.run.id);
  f.rows[0].updatedAt = 99999; f.rows[0].input.job.company = 'My newer correction';
  await f.service.event(first.run.id, first.actor, { kind: 'result', raw: JSON.stringify(value), url: first.url }, first.sender);
  const run = await f.service.read(first.run.id);
  assert.equal(run.phase, 'invalid'); assert.match(run.error, /newer details and documents were preserved/);
  assert.equal(f.rows[0].input.job.company, 'My newer correction'); assert.ok(run.raw);
  f.service.dispose();
});

for(const provider of ['chatgpt','deepseek']) test(`${provider} cleanup validates JSON, creates the cleaned job, and keeps resume generation separate`,async()=>{
  const committed=[],completed=[];
  const f=fixture({onComplete:run=>completed.push(run),saveCapture:async(run,result)=>{
    committed.push(result);f.rows[0]={...f.rows[0],input:{...f.rows[0].input,job:result},capturePending:false,manualChatUrl:run.url};
  }});
  f.local.analyzeJobsWithAI=true;
  f.rows[0].capturePending=true;f.rows[0].input=cleanupInput({...f.rows[0].input,job:{...f.rows[0].input.job,url:'https://jobs.example.test/1'}});
  const run=await f.service.startCapture('job-1',provider),sender=f.sender(run),actor='cleanup-actor';
  const attached=await f.service.attach(run.id,actor,sender);assert.equal(attached.kind,'job-cleanup');assert.match(attached.prompt,/TASK: JOB_CLEANUP/);
  await f.service.event(run.id,actor,{kind:'authorize',baseline:{users:0,answers:0}},sender);
  const url=provider==='chatgpt'?'https://chatgpt.com/c/cleaned':'https://chat.deepseek.com/a/chat/s/cleaned';f.tabs.get(run.tabId).url=url;
  await f.service.event(run.id,actor,{kind:'phase',phase:'submitted',url},sender);
  const output={schemaVersion:1,kind:'job-cleanup',requestId:'job-1',runId:run.id,job:{company:'Clean Employer',title:'Platform Engineer',applyUrl:'https://jobs.example.test/1',description:'Build reliable services.',salary:{value:'USD 100,000–130,000 / year',source:'estimated',evidence:'',basis:'Candidate engineering experience, assumed US annual salary.'}}};
  await f.service.event(run.id,actor,{kind:'result',url,raw:JSON.stringify(output)},sender);
  assert.equal((await f.service.read(run.id)).phase,'complete');assert.equal(committed.length,1);assert.equal(completed.length,0,'cleanup never starts document export');
  await f.service.event(run.id,actor,{kind:'result',url,raw:JSON.stringify(output)},sender);assert.equal(committed.length,1);
  const documents=await f.service.start('job-1',provider);assert.notEqual(documents.id,run.id);assert.equal(documents.url,url);
  assert.match((await f.service.attach(documents.id,'documents',f.sender(documents))).prompt,/Prepare a resume/);
  f.service.dispose();
});

test('new AI captures require explicit opt-in, while an already-authorized capture can resume after opt-out',async()=>{
  const f=fixture();f.rows[0].capturePending=true;
  f.rows[0].input=cleanupInput({...f.rows[0].input,job:{...f.rows[0].input.job,url:'https://jobs.example.test/1'}});
  await assert.rejects(f.service.startCapture('job-1','chatgpt'),/Enable.*analyze the job/);
  assert.equal((await f.store.read()).runs.length,0);assert.equal(f.createdTabs.length,0);
  f.local.analyzeJobsWithAI=true;const run=await f.service.startCapture('job-1','chatgpt');
  const sender=f.sender(run);await f.service.attach(run.id,'actor',sender);
  await f.service.event(run.id,'actor',{kind:'authorize',baseline:{users:0,answers:0}},sender);
  f.local.analyzeJobsWithAI=false;
  await f.service.open(run.id,true);const attached=await f.service.attach(run.id,'resumed',sender);
  assert.equal(attached.mode,'observe');assert.ok(attached.sendIntentAt);
  f.service.dispose();
});

test('resume-only prompts keep an empty coverLetter field and validation discards unsolicited letters', () => {
  const item = job(), value = envelope(item, 'run-1'), settings = { includeCoverLetter: false };
  const prompt = generationPrompt(item, 'run-1', settings);
  assert.match(prompt, /Prepare a resume only/);
  assert.match(prompt, /Do not write a cover letter/);
  assert.equal(JSON.parse(prompt.split('\n\n').at(-1)).coverLetter, '');
  assert.doesNotMatch(prompt, /Write a factual cover letter/);
  for (const coverLetter of ['', undefined, 'An unsolicited letter.']) {
    const result = validateGeneration(JSON.stringify({ ...value, coverLetter }), item, 'run-1', 'json-code-block', settings);
    assert.equal(result.coverLetter, ''); assert.equal(result.resume.company, 'Northstar');
  }
  const wrong = structuredClone(value); wrong.resume.experience[0].company = 'Invented';
  assert.throws(() => validateGeneration(JSON.stringify(wrong), item, 'run-1', null, settings), /profile fact/);
  assert.throws(() => validateGeneration(JSON.stringify({ ...value, coverLetter: '' }), item, 'run-1', null, {}), /cover letter/);
});

test('new runs snapshot all document defaults and settings changes never alter an in-flight run', async () => {
  const f = fixture(); f.local.documentSettings = { includeCoverLetter: false, autoDownload: false, autoPreview: true, formats:['pdf', 'json'] };
  const first = await submitted(f), original = await f.saved();
  assert.deepEqual(original.documentSettings, f.local.documentSettings);
  assert.equal(JSON.parse(original.prompt.split('\n\n').at(-1)).coverLetter, '');
  f.local.documentSettings = { includeCoverLetter: true, autoDownload: true, autoPreview: false, formats:['docx'] };
  await f.service.open(first.run.id, true);
  const resumed = await f.saved();
  assert.deepEqual(resumed.documentSettings, original.documentSettings); assert.equal(resumed.prompt, original.prompt);
  const nextSender = f.sender(resumed); await f.service.attach(resumed.id, 'resumed', nextSender);
  await f.service.event(resumed.id, 'resumed', { kind:'result', raw:JSON.stringify({ ...envelope(f.rows[0], resumed.id), coverLetter:'' }), url:first.url }, nextSender);
  assert.equal((await f.saved()).phase, 'complete'); assert.equal((await f.saved()).result.coverLetter, '');
  f.rows.push({ ...job(), id:'job-2' });
  await f.service.start('job-2', 'deepseek');
  assert.deepEqual((await f.store.read()).runs[1].documentSettings, f.local.documentSettings);
  const defaults = fixture(); await defaults.service.start('job-1', 'chatgpt');
  assert.deepEqual((await defaults.saved()).documentSettings, { includeCoverLetter:true, autoDownload:true, autoPreview:true, formats:['pdf'] });
});

test('legacy runs still require their originally requested cover letter regardless of current preferences', async () => {
  const f = fixture(), first = await submitted(f);
  await f.store.change(state => { delete state.runs[0].documentSettings; });
  f.local.documentSettings = { includeCoverLetter:false };
  await f.service.event(first.run.id, first.actor, { kind:'result', raw:JSON.stringify({ ...envelope(f.rows[0], first.run.id), coverLetter:'' }), url:first.url }, first.sender);
  assert.equal((await f.saved()).phase, 'invalid'); assert.match((await f.saved()).error, /cover letter/);
});

test('completion hook runs only for freshly validated documents and cannot invalidate a successful capture', async () => {
  const completed = [], f = fixture({ onComplete: async run => { completed.push(run); throw new Error('Download failed'); } });
  const first = await submitted(f);
  await f.service.event(first.run.id, first.actor, { kind:'result', raw:JSON.stringify(envelope(f.rows[0], first.run.id)), url:first.url }, first.sender);
  await new Promise(setImmediate);
  assert.equal((await f.saved()).phase, 'complete'); assert.equal(completed.length, 1);
  assert.equal(completed[0].id, first.run.id); assert.equal(completed[0].job.id, f.rows[0].id);
  assert.deepEqual(completed[0].result.resume.company, 'Northstar');
  await f.service.list(); await f.service.open(first.run.id); await f.service.reconnect();
  assert.equal(completed.length, 1, 'listing, opening and reconnecting completed runs never trigger automatic exports');
  f.rows.push({ ...job(), id:'job-2' }); const second = await submitted(f, 'job-2');
  await f.service.event(second.run.id, second.actor, { kind:'result', raw:JSON.stringify({ ...envelope(f.rows[1], second.run.id), coverLetter:'' }), url:second.url }, second.sender);
  await new Promise(setImmediate);
  assert.equal((await f.service.read(second.run.id)).phase, 'invalid'); assert.equal(completed.length, 1);
});

test('capture diagnostics persist alongside submission diagnostics and Resume never reauthorizes a sent prompt', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved(), sender = f.sender(run);
  await f.service.attach(run.id, 'actor', sender);
  const authorize = { kind: 'authorize', baseline: { users: 0, answers: 0 } };
  await f.service.event(run.id, 'actor', authorize, sender);
  await f.service.event(run.id, 'actor', { kind: 'phase', phase: 'submitted', diagnostics: { stage: 'submission', dispatched: true } }, sender);
  await f.service.event(run.id, 'actor', { kind: 'heartbeat', diagnostics: { stage: 'capture', code: 'reply_not_found', assistantCandidates: 0, codeBlocks: 0, raw: 'PRIVATE' } }, sender);
  assert.equal((await f.saved()).captureDiagnostics.code, 'reply_not_found');
  assert.equal((await f.saved()).captureDiagnostics.raw, undefined);
  await f.service.open(run.id, true);
  assert.equal((await f.service.event(run.id, 'actor', authorize, sender)).granted, false);
  await f.service.event(run.id, 'actor', { kind: 'result', raw: JSON.stringify(envelope(f.rows[0], run.id)),
    diagnostics: { stage: 'capture', code: 'reply_ready', codeBlocks: 1, sendEnabled: true, generationActive: false } }, sender);
  const saved = await f.saved();
  assert.equal(saved.phase, 'complete'); assert.equal(saved.diagnostics.dispatched, true);
  assert.equal(saved.captureDiagnostics.code, 'reply_ready'); assert.equal(f.createdTabs.length, 0);
});

test('failed submission diagnostics survive a service restart without authorizing a send', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt');
  const run = await f.saved(), sender = f.sender(run);
  await f.service.attach(run.id, 'actor-1', sender);
  await f.service.event(run.id, 'actor-1', { kind: 'error', code: 'prompt_text_mismatch', message: 'Prompt verification failed.',
    diagnostics: { stage: 'insertion', expectedChars: 1000, actualChars: 990, firstDifference: 42, sendEnabled: true,
      textMatches: false, dispatched: false, prompt: 'PRIVATE' } }, sender);
  f.service.dispose();
  const restarted = createGenerationService(f.options), stored = await restarted.read(run.id);
  assert.equal(stored.phase, 'attention'); assert.equal(stored.sendIntentAt, null);
  assert.equal(stored.diagnostics.firstDifference, 42); assert.equal(stored.diagnostics.sendEnabled, true);
  assert.equal(stored.diagnostics.prompt, undefined); assert.ok(stored.diagnosticAt);
  await restarted.open(run.id, true);
  assert.equal((await restarted.read(run.id)).diagnostics.firstDifference, 42, 'last failure stays available during Resume');
  restarted.dispose();
});

test('simultaneous Generate actions create one run in the already-open ChatGPT tab', async () => {
  const f = fixture();
  await Promise.all([f.service.start('job-1', 'chatgpt'), f.service.start('job-1', 'deepseek')]);
  assert.equal((await f.store.read()).runs.length, 1); assert.equal(f.tabs.size, 1);
  assert.equal(f.createdTabs.length, 0); assert.equal(f.updates.some(update => update.url), false);
  const run = await f.saved();
  assert.equal(run.provider, 'chatgpt'); assert.equal(run.sendIntentAt, null);
  f.rows[0].input.job.description = 'Changed form';
  assert.equal(run.job.input.job.description, 'Build reliable services.');
  assert.equal(f.rows[0].state, 'queued');
});

test('persisted send intent grants submission once and survives service/page restarts', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt');
  const run = await f.saved(), sender = f.sender(run);
  assert.equal((await f.service.attach(run.id, 'actor-1', sender)).mode, 'prepare');
  const authorize = () => f.service.event(run.id, 'actor-1', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
  const permits = await Promise.all([authorize(), authorize()]);
  assert.equal(permits.filter(value => value.granted).length, 1);
  f.service.dispose(); const restarted = createGenerationService(f.options);
  const newSender = { ...sender, documentId: 'document-2' };
  assert.equal((await restarted.attach(run.id, 'actor-2', newSender)).mode, 'observe');
  await assert.rejects(restarted.event(run.id, 'actor-1', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender), /changed/);
  assert.equal((await restarted.event(run.id, 'actor-2', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, newSender)).granted, false);
});

test('wrong tabs, origins and frames cannot receive prompts or authorize sending', async () => {
  const f = fixture(); await f.service.start('job-1', 'deepseek'); const run = await f.saved(), sender = f.sender(run);
  for (const change of [{ tab: { id: 99 } }, { frameId: 2 }, { id: 'other-extension' }, { url: 'https://chat.deepseek.com.evil.test/' }]) {
    await assert.rejects(f.service.attach(run.id, 'actor', { ...sender, ...change }), /Unrecognized/);
  }
  await f.service.attach(run.id, 'actor', sender);
  await f.service.stop(run.id);
  assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender)).granted, false);
});

test('raw results survive validation errors and successful replies require user review', async () => {
  for (const valid of [true, false]) {
    const f = fixture(); await f.service.start('job-1', 'deepseek'); const run = await f.saved(), sender = f.sender(run);
    await f.service.attach(run.id, 'actor', sender);
    await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
    sender.url = 'https://chat.deepseek.com/a/chat/s/123'; f.tabs.get(run.tabId).url = sender.url;
    await f.service.event(run.id, 'actor', { kind: 'phase', phase: 'submitted', url: sender.url }, sender);
    const value = envelope(f.rows[0], run.id); if (!valid) value.resume.company = 'Other company';
    const raw = JSON.stringify(value);
    await f.service.event(run.id, 'actor', { kind: 'result', raw, url: sender.url }, sender);
    const result = await f.saved();
    assert.equal(result.raw, raw); assert.equal(result.phase, valid ? 'complete' : 'invalid');
    assert.equal(f.rows[0].resume, undefined, 'capture does not approve or overwrite job documents');
    assert.equal(f.rows[0].state, 'queued');
    assert.equal((await f.service.list())[0].raw, undefined, 'progress lists do not broadcast document text');
  }
});

test('before submission, explicit Resume starts a fresh ChatGPT chat after the tab moved to an unrelated conversation', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved();
  delete f.session[`document-generation-tab:${run.tabId}`];
  f.tabs.get(run.tabId).url = 'https://chatgpt.com/c/personal';
  await f.service.open(run.id, true);
  assert.equal(f.tabs.get(run.tabId).url, 'https://chatgpt.com/');
  assert.equal((await f.saved()).tabId, run.tabId); assert.equal(f.tabs.size, 1); assert.equal(f.createdTabs.length, 0);
  assert.equal((await f.saved()).url, null);
});

test('cancelled jobs and nonempty baselines cannot authorize submission', async () => {
  const f = fixture(); await f.service.start('job-1', 'deepseek'); const run = await f.saved(), sender = f.sender(run);
  await f.service.attach(run.id, 'actor', sender);
  assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 1, answers: 0 } }, sender)).granted, false);
  f.rows[0].state = 'cancelled';
  await assert.rejects(f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender), /saved job/);
  assert.equal((await f.saved()).sendIntentAt, null);
});

test('Resume reopens a saved ChatGPT conversation without resending, but cannot recreate a missing link', async () => {
  for (const hasUrl of [true, false]) {
    const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved(), sender = f.sender(run);
    await f.service.attach(run.id, 'actor', sender);
    await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
    if (hasUrl) {
      sender.url = 'https://chatgpt.com/c/generated'; f.tabs.get(run.tabId).url = sender.url;
      await f.service.event(run.id, 'actor', { kind: 'phase', phase: 'submitted', url: sender.url }, sender);
    }
    f.tabs.delete(run.tabId);
    if (!hasUrl) {
      await assert.rejects(f.service.open(run.id, true), /Nothing will be resent/);
      assert.equal(f.tabs.size, 0); assert.equal(f.createdTabs.length, 0); assert.equal((await f.saved()).phase, 'attention');
      assert.equal((await f.saved()).url, null);
    } else {
      await Promise.all([f.service.open(run.id, true), f.service.open(run.id, true)]);
      const reopened = await f.saved();
      assert.equal(f.createdTabs.length, 1); assert.equal(reopened.phase, 'submitted');
      assert.notEqual(reopened.tabId, run.tabId);
      assert.equal(f.tabs.get(reopened.tabId).url, sender.url);
      const nextSender = { ...f.sender(reopened), documentId: 'document-2' };
      assert.equal((await f.service.attach(run.id, 'actor-2', nextSender)).mode, 'observe');
      assert.equal((await f.service.event(run.id, 'actor-2', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, nextSender)).granted, false);
    }
  }
});

test('opening a finished run preserves its result and a tab the user has since reused', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved(), sender = f.sender(run);
  await f.service.attach(run.id, 'actor', sender);
  await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
  sender.url = 'https://chatgpt.com/c/generated'; f.tabs.get(run.tabId).url = sender.url;
  await f.service.event(run.id, 'actor', { kind: 'phase', phase: 'submitted', url: sender.url }, sender);
  await f.service.event(run.id, 'actor', { kind: 'result', raw: JSON.stringify(envelope(f.rows[0], run.id)), url: sender.url }, sender);
  assert.deepEqual(await f.service.event(run.id, 'actor', { kind: 'error', message: 'Late page error' }, sender), { stopped: true });
  f.tabs.get(run.tabId).url = 'https://chatgpt.com/c/personal';
  const injectionCount = f.injections.length;
  await f.service.open(run.id);
  assert.equal(f.tabs.get(run.tabId).url, 'https://chatgpt.com/c/personal');
  const opened = await f.saved();
  assert.equal(opened.phase, 'complete'); assert.ok(opened.result);
  assert.equal(f.createdTabs.length, 1); assert.equal(f.injections.length, injectionCount, 'finished runs only open the conversation');
  assert.equal(f.tabs.get(opened.tabId).url, sender.url);
  await f.service.open(run.id);
  assert.equal(f.createdTabs.length, 1, 'repeated Open focuses the reopened conversation');
});

test('SPA URL changes use the current tab URL even when sender.url retains the original home page', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved(), sender = f.sender(run);
  await f.service.attach(run.id, 'actor', sender);
  await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
  const url = 'https://chatgpt.com/c/spa-conversation';
  f.tabs.get(run.tabId).url = url;
  await f.service.event(run.id, 'actor', { kind: 'phase', phase: 'submitted', url }, sender);
  assert.equal((await f.saved()).url, url);
  assert.equal((await f.service.attach(run.id, 'next-actor', sender)).mode, 'observe');
  await assert.rejects(f.service.event(run.id, 'next-actor', { kind: 'result', raw: '{}', url: 'https://chatgpt.com/c/another' }, sender), /does not match/);
  await f.service.event(run.id, 'next-actor', { kind: 'result', raw: JSON.stringify(envelope(f.rows[0], run.id)), url }, sender);
  assert.equal((await f.saved()).phase, 'complete');
});

test('a matching manually posted prompt can be captured after preparation failed, without authorizing another send', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved(), sender = f.sender(run);
  await f.service.attach(run.id, 'actor', sender);
  await f.service.event(run.id, 'actor', { kind: 'error', code: 'input-not-accepted', message: 'Send stayed disabled.' }, sender);
  const url = 'https://chatgpt.com/c/manual-post'; f.tabs.get(run.tabId).url = url;
  f.tabs.get(run.tabId).postedRun = run.id;
  await f.service.open(run.id, true);
  assert.equal((await f.service.attach(run.id, 'resumed', sender)).mode, 'prepare');
  await assert.rejects(f.service.event(run.id, 'resumed', { kind: 'observed', url, marker: 'DOCUMENT_RUN:another-run' }, sender), /matching posted/);
  assert.equal((await f.saved()).sendIntentAt, null);
  await f.service.event(run.id, 'resumed', { kind: 'observed', url, marker: `DOCUMENT_RUN:${run.id}` }, sender);
  const observed = await f.saved();
  assert.ok(observed.submittedAt); assert.ok(observed.sendIntentAt); assert.equal(observed.submissionSource, 'observed');
  assert.equal((await f.service.event(run.id, 'resumed', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender)).granted, false);
  assert.equal((await f.service.attach(run.id, 'resumed-again', sender)).mode, 'observe');
  await f.service.event(run.id, 'resumed-again', { kind: 'result', raw: JSON.stringify(envelope(f.rows[0], run.id)), url }, sender);
  assert.equal((await f.saved()).phase, 'complete'); assert.equal(f.tabs.size, 1);
});

test('explicit Resume reclaims an unbound tab only after its unique run marker is verified', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved();
  const sender = f.sender(run); await f.service.attach(run.id, 'actor', sender);
  await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
  delete f.session[`document-generation-tab:${run.tabId}`];
  f.tabs.get(run.tabId).url = 'https://chatgpt.com/c/already-posted';
  f.browser.scripting.executeScript = async options => {
    if (options.args?.[0] === `DOCUMENT_RUN:${run.id}`) return [{ result: true }];
    return [];
  };
  await f.service.open(run.id, true);
  assert.equal((await f.saved()).tabId, run.tabId); assert.equal(f.tabs.size, 1);
  assert.equal(f.session[`document-generation-tab:${run.tabId}`], run.id);
  assert.ok((await f.saved()).sendIntentAt); assert.equal(f.createdTabs.length, 0);
});

test('ChatGPT can capture correlated replies without a conversation URL while keeping tab and origin binding', async () => {
  for (const manual of [false, true]) {
    const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved(), sender = f.sender(run);
    await f.service.attach(run.id, 'actor', sender);
    f.tabs.get(run.tabId).url = 'https://chatgpt.com/?temporary-chat=true';
    if (manual) await f.service.event(run.id, 'actor', { kind: 'observed', marker: `DOCUMENT_RUN:${run.id}` }, sender);
    else {
      await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
      await f.service.event(run.id, 'actor', { kind: 'phase', phase: 'submitted' }, sender);
    }
    f.tabs.get(run.tabId).url = 'https://other.example/';
    const result = { kind: 'result', raw: JSON.stringify(envelope(f.rows[0], run.id)) };
    await assert.rejects(f.service.event(run.id, 'actor', result, sender), /bound to this run/);
    f.tabs.get(run.tabId).url = 'https://chatgpt.com/?temporary-chat=true';
    await f.service.event(run.id, 'actor', result, sender);
    assert.equal((await f.saved()).phase, 'complete'); assert.equal((await f.saved()).url, null);
    f.tabs.delete(run.tabId);
    await assert.rejects(f.service.open(run.id), /captured documents are still available/);
    assert.equal((await f.saved()).phase, 'complete'); assert.ok((await f.saved()).result);
  }
});

test('ChatGPT creates one home tab when none is open and binds it before navigation', async () => {
  const f = fixture(); f.tabs.clear();
  const update = f.browser.tabs.update;
  f.browser.tabs.update = async (id, values) => {
    if (values.url) {
      const run = await f.saved();
      assert.equal(run.tabId, id); assert.equal(f.session[`document-generation-tab:${id}`], run.id);
      assert.equal(values.url, 'https://chatgpt.com/');
      return update(id, { ...values, status: 'loading' });
    }
    return update(id, values);
  };
  await Promise.all([f.service.start('job-1', 'chatgpt'), f.service.start('job-1', 'chatgpt')]);
  const run = await f.saved();
  assert.equal(f.createdTabs.length, 1); assert.equal(run.url, null); assert.equal(run.phase, 'preparing');
  assert.equal(f.injections.length, 0, 'loading tabs cannot receive a prompt');
  await f.service.open(run.id, true);
  assert.equal(f.createdTabs.length, 1, 'Resume reuses the loading tab');
  f.tabs.get(run.tabId).status = 'complete';
  f.browser.tabs.onUpdated.emit(run.tabId, { status: 'complete' });
  await new Promise(setImmediate);
  assert.equal(f.injections.length, 2, 'load completion attaches the generation actor');
  assert.equal((await f.service.attach(run.id, 'actor', f.sender(run))).mode, 'prepare');
  assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, f.sender(run))).granted, true);
});

test('a saved job conversation takes priority over an unrelated active ChatGPT tab', async () => {
  for (const alreadyOpen of [true, false]) {
    const f = fixture(), url = 'https://chatgpt.com/c/saved-job';
    f.rows[0].manualChatUrl = url + '?private=value#draft';
    if (alreadyOpen) f.tabs.set(9, { id: 9, active: false, windowId: 2, url });
    await f.service.start('job-1', 'chatgpt');
    const run = await f.saved();
    assert.equal(run.url, url); assert.equal(f.tabs.get(run.tabId).url, url);
    assert.equal(f.tabs.get(1).url, 'https://chatgpt.com/', 'unrelated tabs are not navigated');
    assert.equal(f.createdTabs.length, alreadyOpen ? 0 : 1);
    if (alreadyOpen) assert.equal(run.tabId, 9);
    assert.equal((await f.service.attach(run.id, 'actor', f.sender(run))).mode, 'prepare');
    assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 4, answers: 4 } }, f.sender(run))).granted, true);
  }
});

test('closed unsent ChatGPT runs open one fresh tab on concurrent Resume', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved();
  f.tabs.clear();
  await Promise.all([f.service.open(run.id, true), f.service.open(run.id, true)]);
  assert.equal(f.createdTabs.length, 1); assert.equal((await f.saved()).phase, 'preparing');
  assert.equal(f.tabs.get((await f.saved()).tabId).url, 'https://chatgpt.com/');
});

test('concurrent Open and Resume share a new tab without losing the Resume action', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved();
  f.tabs.clear();
  await f.store.change(state => { state.runs[0].phase = 'attention'; });
  await Promise.all([f.service.open(run.id), f.service.open(run.id, true)]);
  assert.equal(f.createdTabs.length, 1); assert.equal((await f.saved()).phase, 'preparing');
});

test('a reply completed during tab lookup cannot be downgraded by Resume', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved();
  const query = f.browser.tabs.query;
  f.browser.tabs.query = async () => {
    await f.store.change(state => { state.runs[0].phase = 'complete'; state.runs[0].result = { saved: true }; });
    return query();
  };
  const injectionCount = f.injections.length;
  await f.service.open(run.id, true);
  assert.equal((await f.saved()).phase, 'complete'); assert.deepEqual((await f.saved()).result, { saved: true });
  assert.equal(f.injections.length, injectionCount);
});

test('a pending saved conversation is reused and unrelated pending navigation is not taken over', async () => {
  const f = fixture(), url = 'https://chatgpt.com/c/pending';
  f.rows[0].manualChatUrl = url;
  f.tabs.get(1).pendingUrl = 'https://other.example/';
  f.tabs.set(9, { id: 9, url: 'about:blank', pendingUrl: url, status: 'loading', active: false });
  await f.service.start('job-1', 'chatgpt');
  assert.equal((await f.saved()).tabId, 9); assert.equal(f.createdTabs.length, 0); assert.equal(f.injections.length, 0);
});

test('invalid persisted ChatGPT links are never opened', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt');
  await f.store.change(state => { state.runs[0].url = 'https://chatgpt.com.evil.test/c/saved'; });
  f.tabs.clear();
  await assert.rejects(f.service.open((await f.saved()).id, true), /invalid ChatGPT conversation link/);
  assert.equal(f.createdTabs.length, 0);
});

test('concurrent ChatGPT jobs reserve different idle tabs, preferring the active tab first', async () => {
  const f = fixture(); f.tabs.get(1).active = false; f.tabs.get(1).lastAccessed = 1000;
  f.tabs.set(2, { id: 2, active: true, lastAccessed: 1, windowId: 1, url: 'https://chatgpt.com/' });
  f.rows.push({ ...job(), id: 'job-2' });
  const results = await Promise.allSettled([f.service.start('job-1', 'chatgpt'), f.service.start('job-2', 'chatgpt')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  const runs = (await f.store.read()).runs;
  assert.equal(runs.find(run => run.jobId === 'job-1').tabId, 2);
  assert.equal(runs.find(run => run.jobId === 'job-2').tabId, 1);
  assert.ok(runs.every(run => run.phase === 'preparing'));
  assert.equal(f.createdTabs.length, 0);
});

test('concurrent DeepSeek starts reserve only one job and repeated Start keeps that run', async () => {
  const f = fixture(); f.rows.push({ ...job(), id: 'job-2' });
  const actions = await Promise.allSettled([f.service.start('job-1', 'deepseek'), f.service.start('job-2', 'deepseek')]);
  assert.equal(actions.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(actions.find(result => result.status === 'rejected').reason.message, /Finish or Stop tracking/);
  const run = await f.saved();
  assert.equal((await f.store.read()).runs.length, 1);
  assert.equal((await f.service.start(run.jobId, 'deepseek')).id, run.id);
  assert.equal(f.createdTabs.length, 1);
});

test('stopped and completed DeepSeek runs release the single slot while Resume reserves it again', async () => {
  for (const finish of ['stop', 'complete']) {
    const f = fixture(); f.rows.push({ ...job(), id: 'job-2' });
    const first = await submitted(f);
    if (finish === 'stop') await f.service.stop(first.run.id);
    else await f.service.event(first.run.id, first.actor, { kind: 'result', raw: JSON.stringify(envelope(f.rows[0], first.run.id)), url: first.url }, first.sender);
    const second = await submitted(f, 'job-2');
    if (finish === 'stop') {
      await assert.rejects(f.service.open(first.run.id, true), /one job at a time/);
      await f.service.stop(second.run.id);
      await f.service.open(first.run.id, true);
      assert.equal((await f.service.attach(first.run.id, 'resumed', f.sender(await f.service.read(first.run.id)))).mode, 'observe');
      assert.equal((await f.service.read(first.run.id)).sendIntentAt, first.run.sendIntentAt);
    } else {
      await f.service.open(first.run.id);
      assert.equal((await f.service.read(first.run.id)).phase, 'complete', 'viewing saved results does not take the active slot');
      assert.equal((await f.service.read(second.run.id)).phase, 'generating');
    }
  }
});

test('two explicit DeepSeek Resumes cannot restart two stopped jobs together', async () => {
  const f = fixture(); f.rows.push({ ...job(), id: 'job-2' });
  const first = await submitted(f); await f.service.stop(first.run.id);
  const second = await submitted(f, 'job-2'); await f.service.stop(second.run.id);
  const actions = await Promise.allSettled([f.service.open(first.run.id, true), f.service.open(second.run.id, true)]);
  assert.equal(actions.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(actions.find(result => result.status === 'rejected').reason.message, /Finish or Stop tracking/);
  assert.equal((await f.store.read()).runs.filter(run => ['submitted', 'generating'].includes(run.phase)).length, 1);
});

test('a new DeepSeek Start and an old Resume atomically compete for the single active slot', async () => {
  for (const resumeFirst of [true, false]) {
    const f = fixture(); f.rows.push({ ...job(), id: 'job-2' });
    const first = await submitted(f); await f.service.stop(first.run.id);
    const actions = resumeFirst
      ? [f.service.open(first.run.id, true), f.service.start('job-2', 'deepseek')]
      : [f.service.start('job-2', 'deepseek'), f.service.open(first.run.id, true)];
    const results = await Promise.allSettled(actions);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /Finish or Stop tracking/);
    assert.equal((await f.store.read()).runs.filter(run => ['opening', 'preparing', 'submitted', 'generating'].includes(run.phase)).length, 1);
  }
});

test('late DeepSeek phases cannot revive an attention run, but its completed result remains capturable', async () => {
  for (const event of [{ kind: 'phase', phase: 'submitted' }, { kind: 'phase', phase: 'generating' }, { kind: 'observed' }]) {
    const f = fixture(); f.rows.push({ ...job(), id: 'job-2' });
    const first = await submitted(f), originalGet = f.browser.tabs.get;
    let release;
    f.browser.tabs.get = async id => {
      if (id === first.run.tabId && !release) return new Promise(resolve => { release = resolve; });
      return originalGet(id);
    };
    // Read the old generating phase before the failure and delay the browser
    // lookup so the event's write races with a different job taking the slot.
    const delayed = f.service.event(first.run.id, first.actor, { ...event, marker: `DOCUMENT_RUN:${first.run.id}`, url: first.url }, first.sender);
    await new Promise(setImmediate); assert.equal(typeof release, 'function');
    await f.service.event(first.run.id, first.actor, { kind: 'error', code: 'transport-disconnected', message: 'Use Resume.', url: first.url }, first.sender);
    f.tabs.get(first.run.tabId).busy = true;
    const second = await submitted(f, 'job-2');
    release(f.tabs.get(first.run.tabId)); await delayed;
    assert.equal((await f.service.read(first.run.id)).phase, 'attention');
    assert.equal((await f.service.read(second.run.id)).phase, 'generating');
    await f.service.event(first.run.id, first.actor, { kind: 'result', raw: JSON.stringify(envelope(f.rows[0], first.run.id)), url: first.url }, first.sender);
    assert.equal((await f.service.read(first.run.id)).phase, 'complete');
    assert.equal((await f.service.read(second.run.id)).phase, 'generating');
  }
});

test('DeepSeek reports stale tracking without periodic or activation recovery', async () => {
  const f = fixture(), item = await submitted(f), before = f.injections.length, updates = f.updates.length;
  f.advance(120000);
  await f.service.list({ health: true });
  f.browser.tabs.onActivated.emit({ tabId: item.run.tabId });
  f.browser.tabs.onUpdated.emit(item.run.tabId, { frozen: false });
  await new Promise(setImmediate);
  assert.equal(f.injections.length, before);
  assert.equal((await f.service.read(item.run.id)).trackingState, 'suspended');
  f.browser.tabs.onUpdated.emit(item.run.tabId, { status: 'complete' });
  await new Promise(setImmediate);
  assert.equal(f.injections.length, before + 2);
  await f.service.reconnect();
  assert.equal(f.injections.length, before + 4);
  assert.equal(f.updates.length, updates, 'observation never moves or focuses the tab');
  assert.equal((await f.service.attach(item.run.id, 'reloaded', item.sender)).mode, 'observe');
  assert.equal((await f.service.event(item.run.id, 'reloaded', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, item.sender)).granted, false);
});

test('DeepSeek heartbeat expiry preserves the slot, clears on heartbeat, and resumes observation without reauthorizing', async () => {
  const f = fixture(), item = await submitted(f), intent = item.run.sendIntentAt, before = f.injections.length;
  f.advance(44000); await f.service.health();
  assert.equal((await f.service.read(item.run.id)).trackingState, null);
  f.advance(2000); await f.service.health();
  assert.equal((await f.service.read(item.run.id)).trackingState, 'suspended');
  f.rows.push({...job(), id:'job-2'});
  await assert.rejects(f.service.start('job-2', 'deepseek'), /one job at a time/);
  assert.equal(f.injections.length, before, 'passive health never reinjects');
  await f.service.event(item.run.id, item.actor, {kind:'heartbeat',url:item.url}, item.sender);
  assert.equal((await f.service.read(item.run.id)).trackingState, null);
  f.advance(60000); await f.service.health();
  await f.service.open(item.run.id, true);
  const attached = await f.service.attach(item.run.id, 'resumed', item.sender);
  assert.equal(attached.mode, 'observe'); assert.equal(attached.sendIntentAt, intent);
  assert.equal((await f.service.event(item.run.id, 'resumed', {kind:'authorize',baseline:{users:0,answers:0}}, item.sender)).granted, false);
});

test('DeepSeek connection failures wait for explicit Resume and preserve the submitted prompt', async () => {
  const f = fixture(), item = await submitted(f);
  await f.service.event(item.run.id, item.actor, { kind: 'error', code: 'transport-disconnected', message: 'Use Resume.', url: item.url }, item.sender);
  assert.equal((await f.service.read(item.run.id)).phase, 'attention');
  assert.equal((await f.service.read(item.run.id)).trackingState, null);
  const before = f.injections.length;
  await f.service.health(); await f.service.reconnect();
  f.browser.tabs.onActivated.emit({ tabId: item.run.tabId });
  f.browser.tabs.onUpdated.emit(item.run.tabId, { status: 'complete' });
  await new Promise(setImmediate);
  assert.equal(f.injections.length, before);
  await f.service.open(item.run.id, true);
  assert.equal((await f.service.attach(item.run.id, 'resumed', item.sender)).mode, 'observe');
  assert.equal((await f.service.read(item.run.id)).sendIntentAt, item.run.sendIntentAt);
});

test('reconnect keeps the earliest legacy DeepSeek run and pauses other actors without losing their data', async () => {
  const f = fixture(); f.rows.push({ ...job(), id: 'job-2' });
  const first = await submitted(f), legacyId = 'legacy-second', legacyUrl = 'https://chat.deepseek.com/a/chat/s/legacy-second';
  f.tabs.set(99, { id: 99, active: false, url: legacyUrl });
  f.session['document-generation-tab:99'] = legacyId;
  await f.store.change(state => state.runs.push({ ...state.runs[0], id: legacyId, jobId: 'job-2', job: f.rows[1],
    tabId: 99, url: legacyUrl, actorId: 'legacy-actor', createdAt: state.runs[0].createdAt + 1, raw: 'preserve existing text' }));
  // The real IndexedDB store persists replaced records only. Model that here
  // so an in-place migration cannot pass while silently failing to save.
  const change = f.store.change;
  f.store.change = edit => change(state => {
    const previous = new Map(state.runs.map(run => [run.id, { reference:run, snapshot:structuredClone(run) }]));
    const value = edit(state);
    state.runs = state.runs.map(run => previous.get(run.id)?.reference === run ? previous.get(run.id).snapshot : run);
    return value;
  });
  const sender = f.sender(await f.service.read(legacyId)), before = f.injections.length, stopped = [];
  f.browser.tabs.sendMessage = async (tabId, message) => { stopped.push({ tabId, ...message }); };
  await f.service.reconnect();
  assert.deepEqual(f.injections.slice(before).map(item => item.target.tabId), [first.run.tabId, first.run.tabId]);
  const paused = await f.service.read(legacyId);
  assert.equal(paused.phase, 'attention'); assert.equal(paused.code, 'single-tab-paused');
  assert.equal(paused.raw, 'preserve existing text'); assert.equal(paused.sendIntentAt, first.run.sendIntentAt);
  assert.deepEqual(stopped, [{ tabId: 99, type: 'generation.stop', id: legacyId }]);
  assert.deepEqual(await f.service.attach(legacyId, 'late-attach', sender), { done: true });
  assert.deepEqual(await f.service.event(legacyId, 'legacy-actor', { kind: 'heartbeat', url: legacyUrl }, sender), { stopped: true });
  assert.deepEqual(await f.service.event(legacyId, 'legacy-actor', { kind: 'result', raw: JSON.stringify(envelope(f.rows[1], legacyId)), url: legacyUrl }, sender), { stopped: true });
  assert.equal((await f.service.read(legacyId)).raw, 'preserve existing text');
  await assert.rejects(f.service.open(legacyId, true), /one job at a time/);
  await f.service.stop(first.run.id); await f.service.open(legacyId, true);
  assert.equal((await f.service.attach(legacyId, 'resumed', sender)).mode, 'observe');
  await f.service.event(legacyId, 'resumed', { kind: 'result', raw: JSON.stringify(envelope(f.rows[1], legacyId)), url: legacyUrl }, sender);
  assert.equal((await f.service.read(legacyId)).phase, 'complete');
});

test('opening an older completed job never takes ownership from a new run using its conversation', async () => {
  const f = fixture(); f.tabs.get(1).url = 'https://chatgpt.com/c/shared';
  f.rows[0].manualChatUrl = f.tabs.get(1).url;
  await f.service.start('job-1', 'chatgpt'); const first = await f.saved();
  await f.store.change(state => { state.runs[0].phase = 'complete'; state.runs[0].result = { saved: true }; });
  f.rows.push({ ...job(), id: 'job-2', manualChatUrl: f.tabs.get(1).url });
  await f.service.start('job-2', 'chatgpt');
  const next = (await f.store.read()).runs.find(run => run.jobId === 'job-2');
  assert.equal(next.tabId, first.tabId);
  const injectionCount = f.injections.length;
  await f.service.open(first.id);
  assert.equal(f.session['document-generation-tab:1'], next.id);
  assert.equal(f.injections.length, injectionCount);
  assert.equal((await f.service.attach(next.id, 'actor', f.sender(next))).mode, 'prepare');
});

test('concurrent ChatGPT runs recover only stale tracking in the same tab without focusing, navigating or resending', async () => {
  const f = fixture(); f.tabs.clear();
  f.tabs.set(8, { id: 8, active: true, url: 'https://chatgpt.com/' });
  f.tabs.set(9, { id: 9, active: false, url: 'https://chatgpt.com/' });
  f.rows.push({ ...job(), id: 'job-2' });
  const [first, second] = await Promise.all([submitted(f, 'job-1', 'chatgpt'), submitted(f, 'job-2', 'chatgpt')]);
  assert.notEqual(first.run.tabId, second.run.tabId);
  f.advance(60000);
  await f.service.event(second.run.id, second.actor, { kind: 'heartbeat', url: second.url }, second.sender);
  const before = f.injections.length, updates = f.updates.length;
  await f.service.list({ health: true });
  assert.equal((await f.service.read(first.run.id)).trackingState, 'reconnecting');
  assert.equal((await f.service.read(second.run.id)).trackingState, null);
  assert.deepEqual(f.injections.slice(before).map(item => item.target.tabId), [first.run.tabId, first.run.tabId]);
  assert.equal(f.updates.length, updates); assert.equal(f.createdTabs.length, 0);
  assert.equal(f.tabs.get(first.run.tabId).url, first.url);
  const attached = await f.service.attach(first.run.id, 'recovered', first.sender);
  assert.equal(attached.mode, 'observe'); assert.equal((await f.service.read(first.run.id)).trackingState, null);
  assert.equal((await f.service.event(first.run.id, 'recovered', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, first.sender)).granted, false);
  for (const item of [first, second]) {
    const actor = item === first ? 'recovered' : item.actor;
    await f.service.event(item.run.id, actor, { kind: 'result', raw: JSON.stringify(envelope(f.rows.find(row => row.id === item.run.jobId), item.run.id)), url: item.url }, item.sender);
    assert.equal((await f.service.read(item.run.id)).phase, 'complete');
  }
});

test('frozen and discarded ChatGPT tabs are suspended, reserved and reattached on resume without opening another tab', async () => {
  for (const state of ['frozen', 'discarded']) {
    const f = fixture(), item = await submitted(f, 'job-1', 'chatgpt'), before = f.injections.length, updates = f.updates.length;
    f.tabs.get(item.run.tabId)[state] = true;
    await f.service.health();
    assert.equal((await f.service.read(item.run.id)).trackingState, 'suspended');
    assert.equal((await f.service.read(item.run.id)).phase, 'generating');
    assert.equal(f.injections.length, before);
    f.tabs.get(item.run.tabId)[state] = false;
    f.browser.tabs.onUpdated.emit(item.run.tabId, { [state]: false });
    await new Promise(setImmediate); await f.service.health();
    assert.equal(f.injections.length, before + 2);
    assert.equal(f.updates.length, updates);
    assert.equal((await f.service.attach(item.run.id, 'thawed', item.sender)).mode, 'observe');
    assert.equal((await f.service.read(item.run.id)).trackingState, null);
  }
});

test('ChatGPT posted transport failures keep reservations and can recover; unsent attention never retries automatically', async () => {
  const f = fixture(), item = await submitted(f, 'job-1', 'chatgpt'), intent = item.run.sendIntentAt;
  await f.service.event(item.run.id, item.actor, { kind: 'error', code: 'transport-disconnected', message: 'Disconnected', url: item.url }, item.sender);
  assert.equal((await f.service.read(item.run.id)).phase, 'generating');
  assert.equal((await f.service.read(item.run.id)).trackingState, 'reconnecting');
  const before = f.injections.length;
  await f.service.health();
  assert.equal(f.injections.length, before + 2);
  const notices = f.notifications.length;
  await f.service.health();
  assert.equal(f.injections.length, before + 2, 'repeated health reads are throttled');
  assert.equal(f.notifications.length, notices, 'unchanged health does not trigger changed/list loops');
  assert.equal((await f.service.read(item.run.id)).sendIntentAt, intent);
  await f.service.event(item.run.id, item.actor, { kind: 'heartbeat', url: item.url }, item.sender);
  assert.equal((await f.service.read(item.run.id)).trackingState, null);
  const unsent = fixture(); await unsent.service.start('job-1', 'deepseek'); const pending = await unsent.saved(), sender = unsent.sender(pending);
  await unsent.service.attach(pending.id, 'pending', sender);
  await unsent.service.event(pending.id, 'pending', { kind: 'error', code: 'connection', message: 'Not connected' }, sender);
  const count = unsent.injections.length; unsent.advance(120000);
  await unsent.service.health(); await unsent.service.reconnect();
  unsent.browser.tabs.onActivated.emit({ tabId: pending.tabId }); await new Promise(setImmediate);
  assert.equal(unsent.injections.length, count); assert.equal((await unsent.saved()).phase, 'attention');
});

test('late health probes cannot overwrite stopped or completed jobs', async () => {
  for (const phase of ['stopped', 'complete']) {
    const f = fixture(), item = await submitted(f, 'job-1', 'chatgpt'); f.advance(60000);
    let release; const originalGet = f.browser.tabs.get;
    f.browser.tabs.get = id => id === item.run.tabId ? new Promise(resolve => { release = resolve; }) : originalGet(id);
    const before = f.injections.length, checking = f.service.health(); await new Promise(setImmediate);
    if (phase === 'stopped') await f.service.stop(item.run.id);
    else await f.store.change(state => { state.runs[0] = { ...state.runs[0], phase, result: { preserved: true } }; });
    release(f.tabs.get(item.run.tabId)); await checking;
    assert.equal((await f.service.read(item.run.id)).phase, phase);
    assert.notEqual((await f.service.read(item.run.id)).trackingState, 'reconnecting');
    assert.equal(f.injections.length, before);
  }
});

test('a hung tab probe does not block another ChatGPT run and times out without taking focus', async () => {
  const f = fixture({ trackingTimeoutMs: 30 }); f.rows.push({ ...job(), id: 'job-2' });
  const [first, second] = await Promise.all([submitted(f, 'job-1', 'chatgpt'), submitted(f, 'job-2', 'chatgpt')]); f.advance(60000);
  const originalGet = f.browser.tabs.get, before = f.injections.length, updates = f.updates.length;
  f.browser.tabs.get = id => id === first.run.tabId ? new Promise(() => {}) : originalGet(id);
  const checking = f.service.health(); await new Promise(setImmediate); await new Promise(setImmediate);
  assert.ok(f.injections.slice(before).some(item => item.target.tabId === second.run.tabId), 'healthy renderer progresses before hung probe times out');
  await checking;
  assert.equal((await f.service.read(first.run.id)).trackingState, 'reconnecting');
  assert.equal(f.updates.length, updates);
});

test('Stop during delayed recovery script loading prevents restarting the completed injection', async () => {
  const f = fixture(), item = await submitted(f, 'job-1', 'chatgpt'); f.advance(60000);
  const originalExecute = f.browser.scripting.executeScript;
  let release, started = false;
  f.browser.scripting.executeScript = async options => {
    if (options.files) return new Promise(resolve => { release = resolve; });
    started = true; return originalExecute(options);
  };
  const checking = f.service.health(); await new Promise(setImmediate);
  assert.equal(typeof release, 'function');
  await f.service.stop(item.run.id); release([]); await checking;
  assert.equal(started, false);
  assert.equal((await f.service.read(item.run.id)).phase, 'stopped');
  assert.equal((await f.service.read(item.run.id)).trackingState, null);
});

test('a late attach URL mismatch cannot replace stopped, completed or rebound state', async () => {
  for (const state of ['stopped', 'complete', 'rebound']) {
    const f = fixture(), item = await submitted(f); let release;
    f.browser.tabs.get = async () => new Promise(resolve => { release = resolve; });
    const attaching = f.service.attach(item.run.id, 'late-actor', item.sender);
    const rejected = assert.rejects(attaching, /no longer on this job/);
    await new Promise(setImmediate);
    if (state === 'stopped') await f.service.stop(item.run.id);
    else await f.store.change(record => {
      record.runs[0] = state === 'complete'
        ? { ...record.runs[0], phase: 'complete', trackingState: null, result: { preserved: true } }
        : { ...record.runs[0], tabId: 99, documentId: 'new-document', actorId: 'new-actor' };
    });
    release({ ...f.tabs.get(item.run.tabId), url: 'https://chat.deepseek.com/a/chat/s/unrelated' });
    await rejected;
    const current = await f.service.read(item.run.id);
    assert.equal(current.phase, state === 'rebound' ? 'generating' : state);
    if (state === 'rebound') { assert.equal(current.tabId, 99); assert.equal(current.actorId, 'new-actor'); }
    if (state === 'complete') assert.deepEqual(current.result, { preserved: true });
  }
});

test('a delayed bootstrap rejection cannot replace terminal state, a new binding or recorded submission', async () => {
  for (const state of ['stopped', 'complete', 'rebound', 'submitted']) {
    const f = fixture(), execute = f.browser.scripting.executeScript; let rejectStart;
    f.browser.scripting.executeScript = async options => {
      if (!options.files && options.func?.name !== 'providerTabState') return new Promise((_, reject) => { rejectStart = reject; });
      return execute(options);
    };
    const starting = f.service.start('job-1', 'deepseek');
    const rejected = assert.rejects(starting, /Delayed bootstrap/);
    await new Promise(setImmediate); const run = await f.saved();
    assert.equal(typeof rejectStart, 'function');
    if (state === 'stopped') await f.service.stop(run.id);
    else await f.store.change(record => {
      record.runs[0] = { ...record.runs[0], ...(state === 'complete'
        ? { phase: 'complete', trackingState: null, result: { preserved: true } }
        : state === 'rebound' ? { tabId: 99, actorId: 'replacement', documentId: 'replacement-document' }
          : { phase: 'sending', sendIntentAt: 100000 }) };
    });
    rejectStart(new Error('Delayed bootstrap rejection')); await rejected;
    const current = await f.saved();
    assert.equal(current.phase, state === 'rebound' ? 'preparing' : state === 'submitted' ? 'sending' : state);
    if (state === 'complete') assert.deepEqual(current.result, { preserved: true });
    if (state === 'rebound') { assert.equal(current.tabId, 99); assert.equal(current.actorId, 'replacement'); }
    if (state === 'submitted') assert.equal(current.sendIntentAt, 100000);
  }
});

test('a current unsent bootstrap failure still reports attention', async () => {
  const f = fixture(); f.browser.scripting.executeScript = async options => {
    if (options.files) throw new Error('Could not load the generation script');
    return [];
  };
  await assert.rejects(f.service.start('job-1', 'deepseek'), /Could not load/);
  const run = await f.saved();
  assert.equal(run.phase, 'attention'); assert.equal(run.code, 'connection-failed'); assert.equal(run.sendIntentAt, null);
});

test('lost ownership and changed conversation suspend tracking instead of reclaiming, navigating or resending', async () => {
  for (const reason of ['ownership', 'url']) {
    const f = fixture(), item = await submitted(f, 'job-1', 'chatgpt'), before = f.injections.length, updates = f.updates.length;
    if (reason === 'ownership') f.session[`document-generation-tab:${item.run.tabId}`] = 'another-run';
    else f.tabs.get(item.run.tabId).url = 'https://chatgpt.com/c/unrelated';
    f.advance(60000); await f.service.health();
    assert.equal((await f.service.read(item.run.id)).trackingState, 'suspended');
    assert.equal(f.injections.length, before); assert.equal(f.updates.length, updates);
  }
});

test('generation client polls health only while active, coalesces polls and cleans up its timer', async () => {
  let runs = [], listener, nextTimer = 0, releaseHealth;
  const timers = new Map(), calls = [];
  const browser = { runtime: { id: 'extension', onMessage: { addListener: fn => { listener = fn; }, removeListener: () => { listener = null; } },
    sendMessage: async message => {
      calls.push(message);
      if (message.health && releaseHealth !== undefined) return new Promise(resolve => { releaseHealth = () => resolve({ ok: true, value: structuredClone(runs) }); });
      return { ok: true, value: structuredClone(runs) };
    } } };
  const client = createGenerationClient({ browser, schedule: fn => { timers.set(++nextTimer, fn); return nextTimer; }, unschedule: id => timers.delete(id) });
  await client.ready; assert.equal(timers.size, 0);
  runs = [{ id: 'one', jobId: 'job', phase: 'generating' }]; await client.refresh();
  assert.equal(timers.size, 1);
  releaseHealth = null; const poll = [...timers.values()][0]; poll(); poll(); await new Promise(setImmediate);
  assert.equal(calls.filter(call => call.health).length, 1);
  releaseHealth(); releaseHealth = undefined; await new Promise(setImmediate);
  listener({ type: 'generation.changed' }, { id: 'extension' }); await new Promise(setImmediate);
  assert.equal(calls.at(-1).health, false, 'changed notifications do not trigger another health pass');
  runs = [{ id: 'one', jobId: 'job', phase: 'complete' }]; await client.refresh(); assert.equal(timers.size, 0);
  runs = [{ id: 'two', jobId: 'next', phase: 'submitted' }]; await client.refresh(); assert.equal(timers.size, 1);
  client.dispose(); assert.equal(timers.size, 0); assert.equal(listener, null);
});

test('DeepSeek Resume retries an unsent missing-conversation run in its owned home tab', async () => {
  const f = fixture(); f.tabs.clear(); f.tabs.set(1, { id:1, active:true, url:'https://chat.deepseek.com/' });
  const initial = await f.service.start('job-1', 'deepseek'), sender = f.sender(initial);
  const prepared = await f.service.attach(initial.id, 'initial', sender);
  await f.service.event(initial.id, 'initial', { kind:'error', code:'missing-conversation', message:'The posted prompt has no conversation link yet.' }, sender);
  assert.equal((await f.saved()).sendIntentAt, null);
  await f.service.open(initial.id, true);
  const recovered = await f.service.attach(initial.id, 'recovered', sender);
  assert.equal(recovered.mode, 'prepare'); assert.equal(recovered.prompt, prepared.prompt);
  assert.equal((await f.saved()).tabId, initial.tabId); assert.equal(f.createdTabs.length, 0);
  const authorize = () => f.service.event(initial.id, 'recovered', { kind:'authorize', baseline:{ users:0, answers:0 } }, sender);
  assert.equal((await authorize()).granted, true);
  assert.equal((await authorize()).granted, false, 'recovery still grants only one submission');
});

for (const provider of ['chatgpt', 'deepseek']) {
  const home = provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://chat.deepseek.com/';
  const savedUrl = home + (provider === 'chatgpt' ? 'c/existing' : 'a/chat/s/existing');
  test(`${provider} recovers a manually posted prompt in a busy unbound tab before choosing an idle destination`, async () => {
    const f = fixture(); f.tabs.clear(); f.tabs.set(1, { id: 1, active: true, url: home });
    await f.service.start('job-1', provider); const run = await f.saved();
    await f.store.change(state => { state.runs[0].phase = 'attention'; });
    f.tabs.get(1).busy = true; f.tabs.get(1).postedRun = run.id;
    delete f.session['document-generation-tab:1'];
    f.tabs.set(2, { id: 2, url: home, active: false });
    await f.service.open(run.id, true);
    assert.equal((await f.saved()).tabId, 1); assert.equal(f.createdTabs.length, 0);
    const sender = f.sender(await f.saved()); await f.service.attach(run.id, 'recovered', sender);
    if (provider === 'deepseek') f.tabs.get(1).url = savedUrl;
    await f.service.event(run.id, 'recovered', { kind: 'observed', marker: `DOCUMENT_RUN:${run.id}`,
      ...(provider === 'deepseek' ? { url: savedUrl } : {}) }, sender);
    assert.equal((await f.saved()).submissionSource, 'observed');
    assert.equal((await f.service.event(run.id, 'recovered', { kind: 'authorize', baseline: { users: 1, answers: 1 } }, sender)).granted, false);
  });
  test(`${provider} skips the running chat and starts fresh in the first idle tab`, async () => {
    const f = fixture(); f.tabs.clear();
    f.tabs.set(1, { id: 1, windowId: 1, active: true, busy: true, url: home });
    f.tabs.set(2, { id: 2, windowId: 1, active: false, lastAccessed: 20, url: savedUrl });
    f.tabs.set(3, { id: 3, windowId: 1, active: false, lastAccessed: 10, url: home });
    await f.service.start('job-1', provider); const run = await f.saved();
    assert.equal(run.tabId, 2); assert.equal(run.url, null); assert.equal(run.usesExistingTab, false);
    assert.equal(f.tabs.get(2).url, home);
    assert.equal(f.createdTabs.length, 0); assert.equal(f.updates.some(item => item.id === 1), false);
    assert.equal((await f.service.attach(run.id, 'actor', f.sender(run))).usesExistingTab, false);
    assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 5, answers: 5 } }, f.sender(run))).granted, false);
    assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, f.sender(run))).granted, true);
  });
  test(`${provider} opens a fresh home tab when all open chats are busy or unreadable`, async () => {
    const f = fixture(); f.tabs.clear();
    f.tabs.set(1, { id: 1, active: true, busy: true, url: savedUrl });
    f.tabs.set(2, { id: 2, active: false, ready: false, url: home });
    await f.service.start('job-1', provider); const run = await f.saved();
    assert.equal(f.createdTabs.length, 1); assert.equal(f.tabs.get(run.tabId).url, home);
    assert.ok(run.tabId !== 1 && run.tabId !== 2); assert.equal(run.usesExistingTab, false);
    assert.ok(f.updates.every(item => item.id === run.tabId));
  });
  test(`${provider} Resume observes the saved conversation even while it is still generating`, async () => {
    const f = fixture(); f.tabs.clear(); f.tabs.set(1, { id: 1, url: savedUrl, active: true });
    f.rows[0].manualChatUrl = savedUrl;
    await f.service.start('job-1', provider); let run = await f.saved(); const sender = f.sender(run);
    await f.service.attach(run.id, 'actor', sender);
    await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
    f.tabs.get(1).busy = true; delete f.session['document-generation-tab:1'];
    await f.service.open(run.id, true); run = await f.saved();
    assert.equal(run.tabId, 1); assert.equal(f.createdTabs.length, 0);
    assert.equal((await f.service.attach(run.id, 'resumed', f.sender(run))).mode, 'observe');
    assert.equal((await f.service.event(run.id, 'resumed', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, f.sender(run))).granted, false);
  });
  test(`${provider} does not submit a new prompt into a busy saved job conversation`, async () => {
    const f = fixture(); f.rows[0].manualChatUrl = savedUrl;
    f.tabs.set(9, { id: 9, url: savedUrl, active: true, busy: true });
    await assert.rejects(f.service.start('job-1', provider), /still working in this saved conversation/);
    assert.equal((await f.saved()).sendIntentAt, null); assert.equal(f.createdTabs.length, 0);
  });
  test(`${provider} binds a fresh run before resetting the idle tab and waits for home to load`, async () => {
    const f = fixture(); f.tabs.get(1).url = savedUrl;
    const update = f.browser.tabs.update;
    f.browser.tabs.update = async (id, values) => {
      if (values.url) {
        const run = await f.saved();
        assert.equal(run.tabId, id); assert.equal(run.url, null); assert.equal(run.usesExistingTab, false);
        assert.equal(f.session[`document-generation-tab:${id}`], run.id);
        assert.equal(f.injections.length, 0, 'never inject the new prompt into the old conversation');
        assert.equal(values.url, home);
        return update(id, { pendingUrl: home, status: 'loading' });
      }
      return update(id, values);
    };
    await Promise.all([f.service.start('job-1', provider), f.service.start('job-1', provider)]);
    const run = await f.saved();
    assert.equal(f.createdTabs.length, 0); assert.equal(f.injections.length, 0);
    await assert.rejects(f.service.attach(run.id, 'old-page', f.sender(run)), /new chat is still opening/);
    await f.service.open(run.id, true);
    assert.equal(f.createdTabs.length, 0, 'Resume reuses the home page that is still loading');
    assert.equal(f.injections.length, 0);
    Object.assign(f.tabs.get(1), { url: home, pendingUrl: undefined, status: 'complete' });
    f.browser.tabs.onUpdated.emit(1, { status: 'complete' }); await new Promise(setImmediate);
    assert.equal(f.injections.length, 2);
    const sender = f.sender(run);
    await f.service.attach(run.id, 'home-page', sender);
    assert.equal((await f.service.event(run.id, 'home-page', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender)).granted, true);
    const generatedUrl = home + (provider === 'chatgpt' ? 'c/new-job' : 'a/chat/s/new-job');
    f.tabs.get(1).url = generatedUrl;
    await f.service.event(run.id, 'home-page', { kind: 'phase', phase: 'submitted', url: generatedUrl }, sender);
    await f.service.event(run.id, 'home-page', { kind: 'result', raw: JSON.stringify(envelope(f.rows[0], run.id)), url: generatedUrl }, sender);
    assert.equal((await f.saved()).phase, 'complete'); assert.equal((await f.saved()).url, generatedUrl);
  });
  test(`${provider} never prepares or submits in the old conversation if navigation fails`, async () => {
    const f = fixture(); f.tabs.get(1).url = savedUrl;
    const update = f.browser.tabs.update;
    f.browser.tabs.update = async (id, values) => {
      if (values.url) throw new Error('Navigation failed');
      return update(id, values);
    };
    await assert.rejects(f.service.start('job-1', provider), /Navigation failed/);
    const run = await f.saved();
    assert.equal(f.injections.length, 0); assert.equal(run.url, null); assert.equal(run.sendIntentAt, null);
    assert.equal(f.tabs.get(1).url, savedUrl);
    await assert.rejects(f.service.attach(run.id, 'old-page', f.sender(run)), /new chat is still opening/);
    await f.store.change(state => { state.runs[0].phase = 'preparing'; });
    await f.service.reconnect(); assert.equal(f.injections.length, 0, 'reconnect must also wait for the fresh page');
  });
  test(`${provider} reuses its home page without reloading and blocks a last-moment switch to another conversation`, async () => {
    const f = fixture(); f.tabs.get(1).url = home + '?model=selected';
    await f.service.start('job-1', provider); const run = await f.saved();
    assert.equal(f.updates.some(item => item.url), false); assert.equal(f.createdTabs.length, 0);
    assert.equal(run.url, null); assert.equal(run.usesExistingTab, false);
    const sender = f.sender(run); await f.service.attach(run.id, 'actor', sender);
    f.tabs.get(1).url = savedUrl;
    assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender)).granted, false);
    assert.equal((await f.saved()).sendIntentAt, null);
  });
}
