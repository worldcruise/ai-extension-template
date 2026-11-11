import test from 'node:test';
import assert from 'node:assert/strict';
import { generationPrompt, validateGeneration, jsonObjects, providerUrl } from '../src/generation-data.mjs';
import { createGenerationService } from '../src/generation-service.mjs';
import { exampleProfile } from '../src/resume-data.mjs';

const job = () => ({ id: 'job-1', state: 'queued', input: { candidateId: 'candidate-1', profile: structuredClone(exampleProfile), tailor: true,
  job: { company: 'Northstar', role: 'Software Engineer', description: 'Build reliable services.' } }, updatedAt: 1 });
const envelope = (item, id) => ({ schemaVersion: 1, requestId: item.id, runId: id, resume: { company: item.input.job.company,
  title: exampleProfile.role, summary: exampleProfile.summary, skills: [{ Skills: exampleProfile.skills }],
  experience: exampleProfile.experience, education: exampleProfile.education }, coverLetter: 'I am applying for the engineering position.' });
function memoryStore() {
  let state = { runs: [] }, chain = Promise.resolve();
  return { read: async () => structuredClone(state), change(edit) {
    const operation = chain.then(() => { const next = structuredClone(state), value = edit(next); state = next; return { state: structuredClone(state), value: structuredClone(value) }; });
    chain = operation.catch(() => {}); return operation;
  } };
}
function fixture() {
  const rows = [job()], tabs = new Map([[1, { id: 1, windowId: 1, active: true, lastAccessed: 1, url: 'https://chatgpt.com/' }]]), session = {}, injections = [], notifications = [], createdTabs = [], updates = [];
  let id = 0, clock = 1000, tabId = 1;
  const event = () => ({ addListener() {}, removeListener() {} });
  const browser = { runtime: { id: 'extension', sendMessage: async message => { notifications.push(message); } },
    storage: { session: { get: async key => ({ [key]: session[key] }), set: async values => Object.assign(session, values), remove: async key => { delete session[key]; } } },
    tabs: { onUpdated: event(), onRemoved: event(), query: async () => [...tabs.values()].filter(tab => tab.url?.startsWith('https://chatgpt.com/')),
      create: async values => { const tab = { id: ++tabId, windowId: 1, ...values }; tabs.set(tab.id, tab); createdTabs.push(tab); return tab; },
      get: async id => { if (!tabs.has(id)) throw new Error('Closed'); return tabs.get(id); }, update: async (id, values) => { updates.push({ id, ...values }); return Object.assign(tabs.get(id), values); },
      remove: async id => tabs.delete(id), sendMessage: async () => {} }, windows: { update: async () => {} },
    scripting: { executeScript: async options => { injections.push(options); } } };
  const store = memoryStore(), options = { browser, store, jobs: { read: async () => ({ requests: structuredClone(rows) }) }, now: () => ++clock, uuid: () => `run-${++id}` };
  const service = createGenerationService(options);
  const sender = run => ({ id: 'extension', tab: { id: run.tabId }, frameId: 0, documentId: 'document-1', url: tabs.get(run.tabId).url });
  const saved = async () => (await store.read()).runs[0];
  return { service, options, browser, rows, tabs, session, store, sender, saved, injections, notifications, createdTabs, updates };
}

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

test('before submission, explicit Resume uses the open ChatGPT conversation without navigating it', async () => {
  const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved();
  delete f.session[`document-generation-tab:${run.tabId}`];
  f.tabs.get(run.tabId).url = 'https://chatgpt.com/c/personal';
  await f.service.open(run.id, true);
  assert.equal(f.tabs.get(run.tabId).url, 'https://chatgpt.com/c/personal');
  assert.equal((await f.saved()).tabId, run.tabId); assert.equal(f.tabs.size, 1); assert.equal(f.createdTabs.length, 0);
  assert.equal((await f.saved()).url, 'https://chatgpt.com/c/personal');
});

test('cancelled jobs and nonempty baselines cannot authorize submission', async () => {
  const f = fixture(); await f.service.start('job-1', 'deepseek'); const run = await f.saved(), sender = f.sender(run);
  await f.service.attach(run.id, 'actor', sender);
  assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 1, answers: 0 } }, sender)).granted, false);
  f.rows[0].state = 'cancelled';
  await assert.rejects(f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender), /saved job/);
  assert.equal((await f.saved()).sendIntentAt, null);
});

test('a missing ChatGPT tab is never reopened automatically; Resume can bind a conversation the user opens', async () => {
  for (const hasUrl of [true, false]) {
    const f = fixture(); await f.service.start('job-1', 'chatgpt'); const run = await f.saved(), sender = f.sender(run);
    await f.service.attach(run.id, 'actor', sender);
    await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 0, answers: 0 } }, sender);
    if (hasUrl) {
      sender.url = 'https://chatgpt.com/c/generated'; f.tabs.get(run.tabId).url = sender.url;
      await f.service.event(run.id, 'actor', { kind: 'phase', phase: 'submitted', url: sender.url }, sender);
    }
    f.tabs.delete(run.tabId);
    await assert.rejects(f.service.open(run.id, true), /Nothing will be resent/);
    assert.equal(f.tabs.size, 0); assert.equal(f.createdTabs.length, 0); assert.equal((await f.saved()).phase, 'attention');
    if (!hasUrl) {
      assert.equal((await f.saved()).url, null);
    } else {
      f.tabs.set(9, { id: 9, windowId: 1, active: true, url: sender.url });
      await f.service.open(run.id, true);
      const reopened = await f.saved();
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
  await assert.rejects(f.service.open(run.id), /Open the original/);
  assert.equal((await f.saved()).phase, 'complete'); assert.equal(f.createdTabs.length, 0);
  f.tabs.set(9, { id: 9, windowId: 1, active: true, url: sender.url });
  await f.service.open(run.id);
  assert.equal(f.tabs.get(run.tabId).url, 'https://chatgpt.com/c/personal');
  const opened = await f.saved();
  assert.equal(opened.phase, 'complete'); assert.ok(opened.result);
  assert.equal(f.tabs.get(opened.tabId).url, sender.url);
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

test('ChatGPT requires an existing tab and never creates or navigates one during Start or Resume', async () => {
  const f = fixture(); f.tabs.clear();
  await assert.rejects(f.service.start('job-1', 'chatgpt'), /Open ChatGPT in a browser tab first/);
  assert.equal(f.createdTabs.length, 0);
  const run = await f.saved();
  f.tabs.set(9, { id: 9, windowId: 1, active: true, url: 'https://chatgpt.com/c/existing' });
  await f.service.open(run.id, true);
  const connected = await f.saved(); assert.equal(connected.tabId, 9); assert.equal(connected.url, 'https://chatgpt.com/c/existing');
  await f.service.attach(run.id, 'actor', f.sender(connected));
  assert.equal((await f.service.event(run.id, 'actor', { kind: 'authorize', baseline: { users: 4, answers: 4 } }, f.sender(connected))).granted, true);
  assert.equal(f.createdTabs.length, 0); assert.equal(f.updates.some(update => update.url), false);
});

test('ChatGPT prefers the active tab and serializes different jobs sharing it', async () => {
  const f = fixture(); f.tabs.get(1).active = false; f.tabs.get(1).lastAccessed = 1000;
  f.tabs.set(2, { id: 2, active: true, lastAccessed: 1, windowId: 1, url: 'https://chatgpt.com/' });
  f.rows.push({ ...job(), id: 'job-2' });
  const results = await Promise.allSettled([f.service.start('job-1', 'chatgpt'), f.service.start('job-2', 'chatgpt')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const runs = (await f.store.read()).runs;
  assert.equal(runs.find(run => run.phase === 'preparing').tabId, 2);
  assert.match(runs.find(run => run.phase === 'attention').error, /already processing another job/);
  assert.equal(f.createdTabs.length, 0);
});
