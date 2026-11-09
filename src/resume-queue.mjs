import { createQueueStore, QUEUE_LOCK } from './queue-store.mjs';
import { normalizeProfile, parseProfile, parseResume, buildResumePrompt } from './resume-data.mjs';
import { profiles as examples, createExamples } from './studio-examples.mjs';
import { linkedConversationUrl } from './sidebar-protocol.mjs';
import { compatibleRequest, deliveryEvidence, hasSubmissionEvidence, recoverableStates, terminalStates } from './queue-outcomes.mjs';
import { metadataProvenance } from './job-metadata.mjs';
import { redactedDiagnostic } from './queue-diagnostics.mjs';
import { MANUAL_QUEUE_MODE, MANUAL_QUEUE_MESSAGE } from './queue-mode.mjs';

const runningStates = ['preparing', 'sending', 'generating', 'validating'];
export const activeStates = [...runningStates, 'saving'];
const errorText = error => error?.message || 'The queue could not continue.';
const initials = name => name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const journalPrefix = 'resume-capture:';

export function createResumeQueue({ store = createQueueStore(), locks = globalThis.navigator?.locks,
  getChat, journal = globalThis.chrome?.storage?.session,
  channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ai-agent-resume-queue') : null,
  uuid = () => crypto.randomUUID(), now = Date.now, manualOnly = MANUAL_QUEUE_MODE } = {}) {
  let state = { requests: [], profiles: [], control: { paused: true } };
  let starting = false, disposed = false, lastError = '', activeChat;
  const listeners = new Set(), captures = new Map();
  const ownerId = uuid();
  const notify = () => { if (!disposed) for (const listener of listeners) listener(snapshot()); };
  function snapshot() {
    return { ...state, manualOnly, error: lastError, starting, requests: state.requests.map(request => captures.has(request.id)
      ? { ...request, state: 'saving', error: 'Result retained. Retry saving; keep this panel open.' } : request) };
  }
  async function refresh() {
    if (disposed) return;
    state = await store.read(); state.requests = state.requests.map(compatibleRequest); notify();
  }
  async function edit(mutator) {
    const result = await store.change(draft => { draft.requests = draft.requests.map(compatibleRequest); return mutator(draft); });
    state = result.state; notify(); if (!disposed) channel?.postMessage('changed');
    return result.value;
  }
  function replace(draft, id, patch) {
    const index = draft.requests.findIndex(request => request.id === id);
    if (index < 0) throw new Error('This request no longer exists.');
    draft.requests[index] = { ...draft.requests[index], ...patch, updatedAt: now() };
    return draft.requests[index];
  }
  async function patch(id, update) {
    return edit(draft => {
      const current = draft.requests.find(request => request.id === id);
      if (!current) throw new Error('This request no longer exists.');
      return replace(draft, id, typeof update === 'function' ? update(current) : update);
    });
  }
  async function finalize(id) {
    return edit(draft => {
      const request = draft.requests.find(item => item.id === id);
      if (!request?.rawOutput) throw new Error('No captured response is available. Open its source chat.');
      if (request.captureCompleted && request.captureKind === 'error') return replace(draft, id, {
        state: 'error-response', error: 'ChatGPT completed an error or refusal response. Captured output is retained in failure details.', completedAt: now() });
      let resume;
      try { resume = parseResume(request.rawOutput, request); }
      catch (error) {
        if (error.code !== 'invalid-resume') throw error;
        if (!request.captureCompleted) throw Object.assign(new Error('Captured output is invalid and completion is unverified. Reconcile this delivery before generating again.'), { code: 'unconfirmed-output' });
        return replace(draft, id, { state: 'invalid-output', error: 'The completed response failed resume JSON validation. Captured output is retained in failure details.', completedAt: now() });
      }
      return replace(draft, id, { resume, state: 'ready', error: '', completedAt: now() });
    });
  }
  async function acceptCapture(id, capture) {
    if (typeof capture?.raw !== 'string' || capture.raw.length > 500000 || typeof capture.deliveryId !== 'string') {
      throw Object.assign(new Error('The response capture is incomplete. Reconcile the recorded delivery; it will not be resent.'), { code: 'invalid-capture' });
    }
    if (state.requests.find(request => request.id === id)?.deliveryId !== capture.deliveryId) {
      throw Object.assign(new Error('A stale capture cannot replace the active delivery.'), { code: 'stale-capture' });
    }
    captures.set(id, capture); notify();
    try { await journal?.set({ [journalPrefix + id]: capture }); } catch { /* IndexedDB is the primary durable store. */ }
    await patch(id, request => {
      if (request.deliveryId !== capture.deliveryId) throw new Error('A stale reply cannot replace a newer attempt.');
      return { state: 'validating', rawOutput: capture.raw, captureCompleted: capture.completed === true,
        captureKind: capture.kind === 'error' ? 'error' : 'response', sourceChatUrl: linkedConversationUrl(capture.url) || request.sourceChatUrl,
        attempts: request.attempts.map(attempt => attempt.deliveryId === capture.deliveryId ? { ...attempt, raw: capture.raw,
          url: linkedConversationUrl(capture.url) || attempt.url, userMessageId: capture.userMessageId || attempt.userMessageId,
          assistantMessageId: capture.assistantMessageId || attempt.assistantMessageId, completed: capture.completed === true,
          kind: capture.kind === 'error' ? 'error' : 'response', capturedAt: now(),
          ...(redactedDiagnostic(capture.diagnostics) ? { diagnostics: [...(Array.isArray(attempt.diagnostics) ? attempt.diagnostics : []), redactedDiagnostic(capture.diagnostics)].slice(-16) } : {}) } : attempt) };
    });
    captures.delete(id);
    try { await journal?.remove(journalPrefix + id); } catch { /* A matching capture is safe to replay. */ }
    try { await finalize(id); return null; }
    catch (error) {
      // Preserve the original raw result even when parsing or the final write fails.
      await patch(id, { state: error.code === 'unconfirmed-output' ? 'uncertain' : 'saving', error: errorText(error), errorCode: error.code || 'save-failed' });
      return error;
    }
  }
  async function recoverJournals() {
    if (!journal) return;
    const entries = await journal.get(null);
    for (const [key, capture] of Object.entries(entries)) {
      if (!key.startsWith(journalPrefix)) continue;
      const id = key.slice(journalPrefix.length);
      const request = state.requests.find(item => item.id === id);
      if (request?.deliveryId === capture.deliveryId && request.state !== 'ready') await acceptCapture(id, capture);
      else await journal.remove(key);
    }
  }
  async function reconcileClosedOwner() {
    if (disposed || starting || !state.control.ownerId || !locks?.query) return;
    const info = await locks.query();
    if (info.held.some(lock => lock.name === QUEUE_LOCK)) return;
    await locks.request(QUEUE_LOCK, { ifAvailable: true }, async lock => {
      if (!lock) return;
      await edit(draft => {
        draft.control = { ...draft.control, ownerId: null, activeId: null, paused: true };
        draft.requests = draft.requests.map(request => runningStates.includes(request.state) && !request.isExample
          ? { ...request, state: deliveryEvidence(request).intent || deliveryEvidence(request).acknowledged ? 'uncertain' : 'interrupted', error: 'The running sidebar closed. Reconcile this request before continuing.' } : request);
      });
    });
  }
  const ownerWatcher = globalThis.window ? setInterval(() => { void reconcileClosedOwner().catch(() => {}); }, 3000) : null;
  const ready = (async () => {
    await edit(draft => {
      for (const [id, data] of Object.entries(examples)) if (!draft.profiles.some(profile => profile.id === id)) {
        draft.profiles.push({ id, data: normalizeProfile(data), filename: data.filename, isExample: true, createdAt: now() });
      }
    });
    // A lock disappears when its owning panel closes. Stored delivery receipts
    // remain, and are reconciled on an explicit Start rather than resent.
    if (locks) await locks.request(QUEUE_LOCK, { ifAvailable: true }, async lock => {
      if (!lock) return;
      await edit(draft => {
        draft.control = { ...draft.control, paused: true, ownerId: null, activeId: null };
        draft.requests = draft.requests.map(request => runningStates.includes(request.state) && !request.isExample
          ? { ...request, state: deliveryEvidence(request).intent || deliveryEvidence(request).acknowledged ? 'uncertain' : 'interrupted', error: 'The panel closed during this request. Reconcile its recorded conversation.' } : request);
      });
      await recoverJournals();
    });
    return snapshot();
  })().catch(error => { lastError = errorText(error); notify(); throw error; });
  ready.catch(() => {});
  channel?.addEventListener('message', () => { void refresh().catch(error => { lastError = errorText(error); notify(); }); });

  async function importProfile(source, filename = 'Candidate_Profile.json') {
    const data = parseProfile(source), id = uuid();
    await ready;
    await edit(draft => {
      draft.profiles.push({ id, data, filename: filename.slice(0, 250), isExample: false, createdAt: now() });
      draft.control = { ...draft.control, selectedCandidateId: id };
    });
    return id;
  }
  async function add(input) {
    await ready;
    const copy = structuredClone(input); copy.profile = normalizeProfile(copy.profile);
    copy.job = { ...copy.job, provenance: metadataProvenance(copy.job) };
    if (!copy.candidateId || !copy.job || typeof copy.job.company !== 'string' || typeof copy.job.role !== 'string' ||
        typeof copy.job.description !== 'string' || (copy.tailor && !copy.job.description.trim())) throw new Error('Choose a candidate and provide the job description.');
    if (JSON.stringify(copy).length > 300000) throw new Error('This request is too large. Shorten the job description.');
    const request = { id: uuid(), input: copy, state: 'queued', resume: null, attempts: [], createdAt: now(), updatedAt: now(), repairCount: 0 };
    if (buildResumePrompt(request, uuid()).length > 350000) throw new Error('The combined profile and job produce a prompt over 350 KB. Shorten the profile or job description.');
    await edit(draft => {
      if (!draft.profiles.some(profile => profile.id === copy.candidateId)) throw new Error('Import or select a candidate first.');
      draft.requests.push({ ...request, sequence: Math.max(0, ...draft.requests.map(item => item.sequence || 0)) + 1 });
    });
    return request.id;
  }
  async function pause() {
    await ready;
    await edit(draft => { draft.control = { ...draft.control, paused: true }; });
  }
  async function selectCandidate(id) {
    await ready;
    await edit(draft => { if (draft.profiles.some(profile => profile.id === id)) draft.control = { ...draft.control, selectedCandidateId: id }; });
  }
  async function canSubmit(id) {
    const latest = await store.read();
    const request = latest.requests.find(item => item.id === id);
    return !disposed && !latest.control.paused && latest.control.ownerId === ownerId && activeStates.includes(request?.state);
  }
  function deliveryProgress(requestId, deliveryId) {
    return async progress => {
      if (progress.phase === 'prepared' && !(await canSubmit(requestId))) return false;
      await patch(requestId, current => {
        if (current.deliveryId !== deliveryId) throw new Error('The active attempt changed.');
        const sourceChatUrl = linkedConversationUrl(progress.url) || current.sourceChatUrl;
        const acknowledged = ['registered', 'submitted', 'generating'].includes(progress.phase);
        const diagnostic = redactedDiagnostic(progress.diagnostics);
        return { state: acknowledged ? 'generating' : 'sending', sourceChatUrl,
          attempts: current.attempts.map(attempt => attempt.deliveryId === deliveryId ? { ...attempt,
            sendIntent: progress.phase === 'prepared' || attempt.sendIntent === true, submitted: acknowledged || attempt.submitted,
            ...(progress.phase === 'prepared' ? { preparedAt: now() } : {}),
            ...(progress.phase === 'dispatched' ? { dispatchedAt: now() } : {}),
            ...(acknowledged && !attempt.acknowledgedAt ? { acknowledgedAt: now() } : {}),
            userMessageId: progress.userMessageId || attempt.userMessageId,
            assistantMessageId: progress.assistantMessageId || attempt.assistantMessageId, url: sourceChatUrl,
            ...(diagnostic ? { diagnostics: [...(attempt.diagnostics || []), { ...diagnostic, send: {
              intent: progress.phase === 'prepared' || attempt.sendIntent === true,
              dispatched: progress.phase === 'dispatched' || Boolean(attempt.dispatchedAt), acknowledged: acknowledged || attempt.submitted === true } }].slice(-16) } : {}) } : attempt) };
      });
      return true;
    };
  }
  async function delivery(request, repairError = '', prepared = null) {
    const chat = activeChat;
    if (!chat?.queue) throw new Error('ChatGPT is still starting. Open Chat, then start the queue again.');
    const deliveryId = prepared?.deliveryId || uuid();
    const prompt = prepared?.prompt || buildResumePrompt(request, deliveryId, repairError);
    await patch(request.id, current => {
      if (current.state === 'cancelled') throw new Error('This request was cancelled.');
      return { state: 'preparing', deliveryId, rawOutput: '', captureCompleted: false, captureKind: null, regenerationAuthorized: false,
      sourceChatUrl: repairError || prepared ? current.sourceChatUrl : null,
      repairCount: repairError ? current.repairCount + 1 : current.repairCount,
      attempts: prepared ? current.attempts : [...current.attempts, { deliveryId, prompt, connection: chat.queue.kind || 'sidebar', startedAt: now(), repair: Boolean(repairError), submitted: false }] };
    });
    if (!(await canSubmit(request.id))) throw new Error('Queue paused before preparing the chat.');
    if (!repairError && !prepared) await chat.queue.newConversation();
    if (!(await canSubmit(request.id))) throw new Error('Queue paused before sending.');
    return chat.queue.submit({ requestId: request.id, deliveryId, prompt, resumePrepared: Boolean(prepared) }, deliveryProgress(request.id, deliveryId));
  }
  async function process(request) {
    let capture;
    if (request.state === 'interrupted') {
      const attempt = request.attempts.at(-1);
      if (!request.rawOutput && attempt && (attempt.connection || 'sidebar') !== (activeChat.queue.kind || 'sidebar')) {
        throw Object.assign(new Error(`This delivery used ${attempt.connection === 'tab' ? 'ChatGPT tab' : 'Sidebar Chat'}. Choose that connection in Settings before continuing or recovering it.`), { code: 'connection-mismatch' });
      }
      if (request.rawOutput) {
        capture = { raw: request.rawOutput, deliveryId: request.deliveryId, url: request.sourceChatUrl, completed: request.captureCompleted, kind: request.captureKind };
      } else if (!deliveryEvidence(request).intent && !deliveryEvidence(request).dispatched && !deliveryEvidence(request).acknowledged) {
        const attempt = request.attempts.at(-1);
        const prompt = attempt?.prompt || (attempt && !attempt.repair ? buildResumePrompt(request, attempt.deliveryId) : null);
        const data = prompt && { requestId: request.id, deliveryId: attempt.deliveryId, prompt };
        const inspection = data && await activeChat.queue.inspectPrepared?.(data);
        if (inspection?.existingDelivery) {
          const progress = deliveryProgress(request.id, attempt.deliveryId);
          await progress({ phase: 'submitted', ...inspection });
          capture = await activeChat.queue.monitor(data, progress);
        } else if (inspection?.preparedDraftMatches) {
          capture = await delivery(request, '', data);
        } else throw Object.assign(new Error('No matching prepared draft or submitted delivery was found. Nothing was inserted or sent. Use Generate again for a new attempt.'), { code: 'prepared-not-found' });
      } else {
        if (!request.sourceChatUrl) throw new Error('Delivery is uncertain. Inspect ChatGPT and connect its conversation before recovering. A retry requires an explicit new attempt.');
        capture = await activeChat.queue.recover({ url: request.sourceChatUrl, requestId: request.id, deliveryId: request.deliveryId });
      }
    } else capture = await delivery(request);
    const error = await acceptCapture(request.id, capture);
    if (error) throw error;
  }
  async function start(candidateId, onlyRequestId = null) {
    if (manualOnly) throw Object.assign(new Error(MANUAL_QUEUE_MESSAGE), { code: 'manual-mode' });
    await ready;
    if (starting) return;
    if (!locks) throw new Error('This browser cannot coordinate the queue safely. Use Chrome 116 or later.');
    starting = true; lastError = ''; notify();
    try {
      await locks.request(QUEUE_LOCK, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('The queue is running in another extension window. Pause it there first.');
        activeChat = await getChat();
        await refresh();
        if (!onlyRequestId && state.requests.some(item => !item.isExample && item.state === 'uncertain')) {
          throw new Error('Reconcile uncertain deliveries before starting more generation. No prompt was sent.');
        }
        await edit(draft => { draft.control = { ...draft.control, ownerId, candidateId, paused: false }; });
        try {
          while (!disposed) {
            await refresh();
            if (state.control.paused) break;
            const request = state.requests.find(item => item.input.candidateId === candidateId && !item.isExample &&
              (onlyRequestId ? item.id === onlyRequestId && recoverableStates.includes(item.state) : ['queued', 'interrupted', ...runningStates].includes(item.state)));
            if (!request) break;
            const work = onlyRequestId || runningStates.includes(request.state) ? { ...request, state: 'interrupted' } : request;
            const claimed = await edit(draft => {
              const current = draft.requests.find(item => item.id === request.id);
              if (draft.control.paused || !current || !(onlyRequestId ? recoverableStates.includes(current.state) : ['queued', 'interrupted', ...runningStates].includes(current.state))) return false;
              draft.control = { ...draft.control, activeId: request.id };
              replace(draft, request.id, { state: 'preparing' });
              return true;
            });
            if (!claimed) continue;
            try { await process(work); }
            catch (error) {
              lastError = errorText(error);
              if (state.requests.find(item => item.id === request.id)?.state !== 'saving' && !captures.has(request.id)) {
                await patch(request.id, current => {
                  const evidence = deliveryEvidence(current), diagnostic = redactedDiagnostic(error.diagnostics || {
                    phase: 'preflight', requestId: current.id, deliveryId: current.deliveryId, timestamps: { failedAt: now() }, editor: { type: 'other' } });
                  return { state: evidence.intent || evidence.dispatched || evidence.acknowledged || current.rawOutput ? 'uncertain' : error.code === 'interrupted' ? 'interrupted' : 'unsent',
                    error: lastError, errorCode: error.code || '', attempts: current.attempts.map(attempt => attempt.deliveryId === current.deliveryId && diagnostic ? {
                      ...attempt, failedAt: now(), failureCode: error.code || 'queue-error', diagnostics: [...(Array.isArray(attempt.diagnostics) ? attempt.diagnostics : []), { ...diagnostic, send: { intent: evidence.intent, dispatched: evidence.dispatched, acknowledged: evidence.acknowledged } }].slice(-16)
                    } : attempt) };
                }).catch(() => {});
              }
              break;
            }
            if (onlyRequestId) break;
          }
        } finally {
          await edit(draft => { draft.control = { ...draft.control, paused: true, ownerId: null, activeId: null }; });
        }
      });
    } finally { activeChat = null; starting = false; notify(); }
  }
  async function generateAgain(id, { confirmed = false, expectedDeliveryId, expectedUpdatedAt } = {}) {
    await ready;
    await patch(id, request => {
      if (![...recoverableStates, ...terminalStates, 'ready', 'cancelled'].includes(request.state)) throw new Error('Finish the current request before generating again.');
      if (expectedDeliveryId !== undefined && expectedDeliveryId !== (request.deliveryId || null) || expectedUpdatedAt !== undefined && expectedUpdatedAt !== request.updatedAt) throw new Error('The delivery changed while this dialog was open. Review it again.');
      const evidence = deliveryEvidence(request);
      if (!confirmed && (hasSubmissionEvidence(request) || request.rawOutput || request.state === 'ready')) throw new Error('Explicit regeneration confirmation is required. The previous delivery may already have generated a result.');
      return { state: 'queued', regenerationAuthorized: true, error: '', errorCode: '', repairCount: 0, rawOutput: '', resume: null,
        attempts: request.attempts.map(attempt => attempt.deliveryId === request.deliveryId ? { ...attempt,
          ...(request.rawOutput ? { raw: request.rawOutput } : {}), ...(request.resume ? { resume: request.resume } : {}), outcome: request.state } : attempt) };
    });
  }
  async function recover(id) {
    await patch(id, request => {
      if (!recoverableStates.includes(request.state)) throw new Error('This request does not need recovery.');
      return { state: 'interrupted', error: '' };
    });
  }
  async function continueRequest(id) {
    if (manualOnly) throw Object.assign(new Error(MANUAL_QUEUE_MESSAGE), { code: 'manual-mode' });
    await ready; await refresh();
    const request = state.requests.find(item => item.id === id);
    if (!request || !recoverableStates.includes(request.state)) throw new Error('This request does not need reconciliation.');
    return start(request.input.candidateId, id);
  }
  async function retryConnectionBlocked() {
    await ready;
    lastError = '';
    return edit(draft => {
      let count = 0;
      draft.requests = draft.requests.map(request => {
        const connectionError = ['login-unverified', 'signed-out', 'composer-unavailable'].includes(request.errorCode) ||
          /^(?:Could not verify a signed-in ChatGPT account|ChatGPT’s account controls were not recognized|Sign in to ChatGPT)/.test(request.error || '');
        if (!['attention', 'unsent'].includes(request.state) || request.isExample || !connectionError || request.attempts.some(attempt => attempt.sendIntent || attempt.submitted || attempt.dispatchedAt)) return request;
        count++;
        return { ...request, state: 'queued', error: '', errorCode: '', updatedAt: now() };
      });
      return count;
    });
  }
  async function cancel(id) {
    await patch(id, request => {
      if (activeStates.includes(request.state)) throw new Error('Pause after the current response, then cancel it.');
      return { state: 'cancelled', error: '' };
    });
  }
  async function retrySave(id) {
    await ready; await refresh();
    if (state.control.ownerId && state.control.activeId === id) throw new Error('Wait for the active capture to finish before retrying its save.');
    if (!captures.has(id) && state.requests.find(item => item.id === id)?.state !== 'saving') throw new Error('Only captured output awaiting persistence can be retried.');
    const capture = captures.get(id);
    if (capture) await acceptCapture(id, capture);
    else if (state.requests.find(item => item.id === id)?.isExample) await patch(id, { state: 'ready' });
    else await finalize(id);
  }
  async function connect(id, url) {
    const sourceChatUrl = linkedConversationUrl(url);
    if (!sourceChatUrl) throw new Error('Open the job conversation in Chat first.');
    await patch(id, { sourceChatUrl });
  }
  async function loadExamples() {
    await ready;
    if (state.control.ownerId) throw new Error('Pause the queue before loading examples.');
    await edit(draft => {
      draft.requests = draft.requests.filter(request => !request.isExample);
      let sequence = Math.max(0, ...draft.requests.map(item => item.sequence || 0));
      draft.requests.push(...createExamples().map(request => ({ ...request, sequence: ++sequence, isExample: true, createdAt: now(), updatedAt: now(), attempts: [], repairCount: 0 })));
    });
  }
  function dispose() { disposed = true; clearInterval(ownerWatcher); channel?.close(); listeners.clear(); }
  return { ready, snapshot, refresh, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    add, importProfile, selectCandidate, start, pause, generateAgain, retry: generateAgain, recover, continueRequest, retryConnectionBlocked, cancel, retrySave, connect, loadExamples, dispose,
    profileOptions: () => state.profiles.map(record => ({ ...record.data, id: record.id, filename: record.filename, isExample: record.isExample, initials: initials(record.data.name) })) };
}
