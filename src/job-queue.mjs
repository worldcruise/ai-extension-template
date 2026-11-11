import { createQueueStore } from './queue-store.mjs';
import { normalizeProfile, parseProfile } from './resume-data.mjs';
import { profiles as examples, createExamples } from './studio-examples.mjs';
import { savedChatUrl } from './saved-chat.mjs';
import { parseManualResume } from './manual-documents.mjs';
import { metadataProvenance } from './job-metadata.mjs';
import { findExistingJob, jobUrlInList } from './job-duplicates.mjs';

// Local job/profile/document storage only. No chat connection or runner exists.
export function createJobQueue({ store = createQueueStore(),
  channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ai-agent-resume-queue') : null,
  uuid = () => crypto.randomUUID(), now = Date.now } = {}) {
  let state = { requests: [], profiles: [], control: {} }, disposed = false;
  const listeners = new Set();
  const visibleJob = job => ({ ...job, state: job.state === 'cancelled' ? 'cancelled' : job.resume ? 'ready' : job.state === 'queued' ? 'queued' : 'attention' });
  const snapshot = () => ({ ...state, requests: state.requests.map(visibleJob) });
  const notify = () => { if (!disposed) for (const listener of listeners) listener(snapshot()); };
  async function refresh() { if (!disposed) { state = await store.read(); notify(); } }
  async function edit(mutator) {
    const result = await store.change(mutator); state = result.state; notify();
    if (!disposed) channel?.postMessage('changed');
    return result.value;
  }
  function replace(draft, id, patch) {
    const index = draft.requests.findIndex(job => job.id === id);
    if (index < 0) throw new Error('This job no longer exists.');
    draft.requests[index] = { ...draft.requests[index], ...patch, updatedAt: now() };
    return draft.requests[index];
  }
  const ready = edit(draft => {
    for (const [id, data] of Object.entries(examples)) if (!draft.profiles.some(profile => profile.id === id)) {
      draft.profiles.push({ id, data: normalizeProfile(data), filename: data.filename, isExample: true, createdAt: now() });
    }
  }).then(snapshot);
  channel?.addEventListener('message', () => { void refresh().catch(() => {}); });
  async function importProfile(source, filename = 'Candidate_Profile.json') {
    const data = parseProfile(source), id = uuid(); await ready;
    await edit(draft => {
      draft.profiles.push({ id, data, filename: filename.slice(0, 250), isExample: false, createdAt: now() });
      draft.control = { ...draft.control, selectedCandidateId: id };
    });
    return id;
  }
  async function add(input, { checkExisting = false, checkExistingUrl = false } = {}) {
    await ready;
    const copy = structuredClone(input); copy.profile = normalizeProfile(copy.profile);
    if (!copy.candidateId || !copy.job || typeof copy.job.company !== 'string' || typeof copy.job.role !== 'string' ||
      typeof copy.job.description !== 'string' || copy.tailor && !copy.job.description.trim()) throw new Error('Choose a candidate and provide the job description.');
    copy.job.provenance = metadataProvenance(copy.job);
    if (JSON.stringify(copy).length > 300000) throw new Error('This job is too large. Shorten the job description.');
    const id = uuid();
    await edit(draft => {
      if (!draft.profiles.some(profile => profile.id === copy.candidateId)) throw new Error('Import or select a candidate first.');
      if (checkExistingUrl && jobUrlInList(copy.job.url, copy.candidateId, draft.requests)) {
        throw Object.assign(new Error('Already applied'), { code: 'already-applied', duplicate: { matchedBy: ['url'], location: 'job list' } });
      }
      const duplicate = checkExisting && findExistingJob(copy, draft.requests);
      if (duplicate) throw Object.assign(new Error('Already applied'), { code: 'already-applied', duplicate });
      draft.requests.push({ id, input: copy, state: 'queued', resume: null, createdAt: now(), updatedAt: now(),
        sequence: Math.max(0, ...draft.requests.map(item => item.sequence || 0)) + 1 });
    });
    return id;
  }
  async function selectCandidate(id) {
    await ready;
    await edit(draft => { if (draft.profiles.some(profile => profile.id === id)) draft.control = { ...draft.control, selectedCandidateId: id }; });
  }
  async function cancel(id) { await ready; await edit(draft => replace(draft, id, { state: 'cancelled', error: '' })); }
  async function connect(id, value) {
    const url = savedChatUrl(value);
    if (!url) throw new Error('Open the job conversation in Chat first.');
    await ready; await edit(draft => replace(draft, id, { manualChatUrl: url }));
  }
  async function saveDocuments(id, { resume: raw, coverLetter = '', coverLetterEnabled = false, expectedUpdatedAt, generationId, sourceUrl }) {
    await ready;
    if (typeof coverLetter !== 'string' || coverLetter.length > 50000 || coverLetterEnabled && !coverLetter.trim()) throw new Error('Add a cover letter under 50,000 characters or turn it off.');
    await edit(draft => {
      const current = draft.requests.find(job => job.id === id);
      if (!current || current.state === 'cancelled') throw new Error('This job is no longer in the queue.');
      if (current.updatedAt !== expectedUpdatedAt) throw new Error('This job changed in another view. Reopen its document form before saving.');
      const resume = parseManualResume(raw, current);
      replace(draft, id, { resume, coverLetter: coverLetter.trim(), coverLetterEnabled: Boolean(coverLetterEnabled),
        ...(typeof generationId === 'string' ? { documentRunId: generationId } : {}),
        ...(savedChatUrl(sourceUrl) ? { manualChatUrl: savedChatUrl(sourceUrl) } : {}),
        state: 'ready', error: '', manualDocumentUpdatedAt: now(), completedAt: now() });
    });
  }
  async function loadExamples() {
    await ready;
    await edit(draft => {
      draft.requests = draft.requests.filter(job => !job.isExample);
      let sequence = Math.max(0, ...draft.requests.map(item => item.sequence || 0));
      draft.requests.push(...createExamples().map(job => ({ ...job, state: 'ready', sequence: ++sequence, isExample: true, createdAt: now(), updatedAt: now() })));
    });
  }
  return { ready, snapshot, refresh, add, importProfile, selectCandidate, cancel, connect, saveDocuments, loadExamples,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    profileOptions: () => state.profiles.map(record => ({ ...record.data, id: record.id, filename: record.filename, isExample: record.isExample,
      initials: record.data.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() })),
    dispose() { disposed = true; channel?.close(); listeners.clear(); } };
}
