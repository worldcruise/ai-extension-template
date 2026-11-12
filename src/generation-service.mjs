import { createGenerationStore } from './generation-store.mjs';
import { createQueueStore } from './queue-store.mjs';
import { generationPrompt, providerHome, providerUrl, runMarker, runningPhases, validateGeneration } from './generation-data.mjs';
import { providerTabs, inspectProviderTab, firstIdleProviderTab, focusProviderTab, tabUrl } from './ai-tabs.mjs';
import { requestChatUrl } from './saved-chat.mjs';
import { generationDiagnostics } from './generation-diagnostics.mjs';
import { readDocumentSettings } from './document-settings.mjs';
import { jobCleanupPrompt, validateJobCleanup } from './job-cleanup.mjs';
import { createJobQueue, applyGeneratedJobMetadata } from './job-queue.mjs';
import { readJobAnalysisSetting } from './job-analysis-settings.mjs';

async function saveCapturedJob(run, result) {
  const queue = createJobQueue();
  try { await queue.completeCapture(run.jobId,{...run.job.input,job:{...result,tabId:run.job.input.job.tabId}},
    {runId:run.id,sourceUrl:run.url,expectedUpdatedAt:run.job.updatedAt}); }
  finally {queue.dispose();}
}

const scripts = ['src/build-info.js', 'src/generation-dom.js', 'src/chatgpt-submit-adapter.js', 'src/generation-chatgpt.js', 'src/generation-deepseek.js', 'src/generation-tab.js'];
const summary = ({ job, prompt, raw, result, ...run }) => run;
const needsHome = run => !run.url && !run.sendIntentAt && !run.usesExistingTab;
const trackingStaleMs = 45000, recoveryRetryMs = 15000;
export function createGenerationService({ browser = chrome, store = createGenerationStore(), jobs = createQueueStore(),
  now = Date.now, uuid = () => crypto.randomUUID(), trackingTimeoutMs = 4000, onComplete = () => {}, saveCapture = saveCapturedJob } = {}) {
  const notify = () => { void browser.runtime.sendMessage({ type: 'generation.changed' }).catch(() => {}); };
  const get = async id => (await store.read()).runs.find(run => run.id === id);
  const tabKey = id => `document-generation-tab:${id}`;
  const connections = new Map();
  const providerConnections = new Map();
  const recovering = new Map(), recoveryAttempts = new Map();
  let disposed = false;
  const tracked = run => run && runningPhases.includes(run.phase);
  const deepseekActive = run => run?.provider === 'deepseek' && [...runningPhases, 'validating'].includes(run.phase);
  const deepseekBusy = (state, id) => state.runs.some(run => run.id !== id && deepseekActive(run));
  const singleDeepseekMessage = 'DeepSeek handles one job at a time. Finish or Stop tracking the current DeepSeek job before starting another.';
  async function bounded(operation) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The AI tab is not responding.')), trackingTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  function diagnosticUpdate(value) {
    const diagnostics = generationDiagnostics(value);
    if (!diagnostics) return {};
    return diagnostics.stage === 'capture' ? { captureDiagnostics: diagnostics, captureDiagnosticAt: now() } : { diagnostics, diagnosticAt: now() };
  }
  const owned = async run => Number.isInteger(run.tabId) && (await browser.storage.session.get(tabKey(run.tabId)))[tabKey(run.tabId)] === run.id;
  async function patch(id, edit, announce = true) {
    const { value } = await store.change(state => {
      const index = state.runs.findIndex(run => run.id === id);
      if (index < 0) throw new Error('This generation no longer exists.');
      const run = state.runs[index], delta = edit(run);
      if (!delta) return run;
      return state.runs[index] = { ...run, ...delta, updatedAt: now() };
    });
    if (announce) notify();
    return value;
  }
  async function availableJob(id) {
    const job = (await jobs.read()).requests.find(job => job.id === id);
    if (!job || job.state === 'cancelled' || job.isExample) throw new Error('Select a saved job to generate documents.');
    return job;
  }
  async function inject(run, { observeOnly = false } = {}) {
    const expectedTab = run.tabId;
    run = await get(run.id);
    if (disposed || !tracked(run) || !Number.isInteger(expectedTab) || run.tabId !== expectedTab || observeOnly && !run.sendIntentAt) return;
    if (!await bounded(owned(run))) throw new Error('The browser session changed. Resume this run to reopen its conversation.');
    const tab = await bounded(browser.tabs.get(run.tabId));
    if (tab.frozen || tab.discarded) return;
    if (tab.status === 'loading' || tab.pendingUrl) return; // onUpdated injects once the destination finishes loading.
    if (!tab.url?.startsWith(providerHome(run.provider))) return;
    if (run.url && providerUrl(tab.url, run.provider, true) !== run.url) return;
    if (needsHome(run) && providerUrl(tab.url, run.provider) !== providerHome(run.provider)) return;
    await bounded(browser.scripting.executeScript({ target: { tabId: run.tabId, frameIds: [0] }, files: scripts }));
    // Injection may wait on a renderer. A result, Stop, or a new tab binding can
    // arrive during that wait; never revive the obsolete task afterward.
    const current = await get(run.id);
    if (disposed || !tracked(current) || current.tabId !== expectedTab || observeOnly && !current.sendIntentAt || !await bounded(owned(current))) return;
    await bounded(browser.scripting.executeScript({ target: { tabId: current.tabId, frameIds: [0] }, func: id => globalThis.AiAgentGenerationTab?.start(id), args: [current.id] }));
  }
  async function provision(run) {
    // Record this attempt's binding so a delayed provisioning rejection cannot
    // downgrade a newer actor or a Resume that has already rebound the run.
    const binding = { tabId: run.tabId, documentId: run.documentId || null, actorId: run.actorId || null };
    try { return await connectProvider(run, true, binding); }
    catch (error) { error.generationBinding = binding; throw error; }
  }
  async function connectProvider(run, resume, binding = null) {
    // Double-clicks and simultaneous Open/Resume requests share one tab creation.
    if (connections.has(run.id)) {
      const connected = await connections.get(run.id);
      // A simultaneous Open must not swallow the caller's explicit Resume.
      if (resume && ![...runningPhases, 'complete', 'invalid'].includes(connected.phase)) return connectProvider(connected, true, binding);
      return connected;
    }
    // Select and reserve sequentially so two jobs cannot both take the same idle tab.
    const pending = (providerConnections.get(run.provider) || Promise.resolve()).catch(() => {}).then(() => connectProviderRun(run.id, resume, binding));
    providerConnections.set(run.provider, pending);
    connections.set(run.id, pending);
    try { return await pending; } finally {
      connections.delete(run.id);
      if (providerConnections.get(run.provider) === pending) providerConnections.delete(run.provider);
    }
  }
  async function connectProviderRun(id, resume, binding) {
    let run = await get(id);
    const provider = run.provider, name = provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT';
    if (provider === 'deepseek' && (resume || tracked(run)) && !['complete', 'invalid'].includes(run.phase) && deepseekBusy(await store.read(), id)) throw new Error(singleDeepseekMessage);
    const tabs = await providerTabs(provider, browser);
    run = await get(id); // A reply can finish while Chrome enumerates its tabs.
    const terminal = ['complete', 'invalid'].includes(run.phase);
    const savedUrl = providerUrl(run.url, provider, true);
    if (run.url && !savedUrl) throw new Error(`This run has an invalid ${name} conversation link.`);
    const conversation = tab => providerUrl(tabUrl(tab), provider, true);
    const reserved = new Set((await store.read()).runs.filter(item => item.id !== run.id && [...runningPhases, 'validating'].includes(item.phase)).map(item => item.tabId));
    let postedTab = null;
    if (resume && !run.sendIntentAt && !terminal && run.tabId != null) {
      // A user may have sent a prepared prompt while the extension was stopped.
      // Check posted user turns before idle selection so its streaming reply is
      // observed in place. Loading adapter definitions never starts automation.
      for (const candidate of tabs.filter(tab => !reserved.has(tab.id) && (!savedUrl || conversation(tab) === savedUrl))) {
        if (candidate.status === 'loading' || candidate.pendingUrl) continue;
        try {
          await browser.scripting.executeScript({ target: { tabId: candidate.id, frameIds: [0] }, files: scripts.slice(0, -1) });
          const proof = await browser.scripting.executeScript({ target: { tabId: candidate.id, frameIds: [0] },
            func: function hasPostedPrompt(provider, id) {
              const adapter = provider === 'chatgpt' ? globalThis.AiAgentChatGPTGeneration : globalThis.AiAgentDeepSeekGeneration;
              return Boolean(adapter?.answer({ id }).user);
            }, args: [provider, run.id] });
          if (proof?.[0]?.result === true) { postedTab = candidate; break; }
        } catch { /* An inaccessible page cannot prove a posted prompt. */ }
      }
    }
    let tab = postedTab || tabs.find(tab => tab.id === run.tabId && (!savedUrl || conversation(tab) === savedUrl));
    let previouslyOwned = tab?.id === run.tabId && await owned(run);
    if (!postedTab && !run.sendIntentAt && !terminal && previouslyOwned && !savedUrl && (reserved.has(tab.id) || (await inspectProviderTab(tab, provider, browser)).busy)) {
      tab = null; previouslyOwned = false;
    }
    if (!previouslyOwned && !postedTab) {
      if (savedUrl) tab = tabs.find(tab => conversation(tab) === savedUrl);
      else if (!run.sendIntentAt && !terminal) tab = await firstIdleProviderTab(provider, { browser, excludeTabIds: [...reserved] });
      else {
        tab = null;
        for (const candidate of tabs) {
          try {
            const proof = await browser.scripting.executeScript({ target: { tabId: candidate.id, frameIds: [0] },
              func: marker => Boolean(document.body?.innerText.includes(marker)), args: [runMarker(run.id)] });
            if (proof?.[0]?.result === true) { tab = candidate; break; }
          } catch { /* A loading or inaccessible page is not a verified conversation. */ }
        }
      }
    }
    // Opening/observing a saved reply is safe while it streams. A new submission
    // into that exact conversation must wait rather than target a different job.
    if (tab && savedUrl && !postedTab && !run.sendIntentAt && !terminal && (reserved.has(tab.id) || (await inspectProviderTab(tab, provider, browser)).busy)) {
      const error = `${name} is still working in this saved conversation. Use Resume after its reply finishes.`;
      await patch(run.id, () => ({ phase: 'attention', code: 'chat-busy', error }));
      throw new Error(error);
    }
    const freshChat = !savedUrl && !run.sendIntentAt && !postedTab && !terminal;
    const navigateHome = tab && freshChat && providerUrl(tabUrl(tab), provider) !== providerHome(provider);
    const createTab = !tab && (Boolean(savedUrl) || !run.sendIntentAt && !terminal);
    if (createTab) tab = await browser.tabs.create({ url: 'about:blank', active: true });
    if (!tab) {
      const error = `This run has no saved conversation link. Open its ${name} conversation in a browser tab, then use Resume. Nothing will be resent.`;
      if (!terminal) await patch(run.id, () => ({ phase: 'attention', code: 'chat-tab-missing', error }));
      throw new Error(terminal ? `Open the original ${name} conversation in a tab. The captured documents are still available through Review documents.` : error);
    }
    if (terminal) {
      // A completed job only views the conversation. It must not take the session
      // binding away from a newer job using that same tab.
      if (createTab) await browser.tabs.update(tab.id, { url: savedUrl, active: true });
      await focusProviderTab(tab, browser);
      return patch(run.id, () => ({ tabId: tab.id, documentId: null, actorId: null }));
    }
    let value;
    try { ({ value } = await store.change(state => {
      const index = state.runs.findIndex(item => item.id === run.id), current = state.runs[index];
      if (provider === 'deepseek' && (resume || tracked(current)) && !['complete', 'invalid'].includes(current.phase) && deepseekBusy(state, run.id)) throw new Error(singleDeepseekMessage);
      if (state.runs.some(item => item.id !== run.id && item.tabId === tab.id && [...runningPhases, 'validating'].includes(item.phase))) {
        throw new Error(`That ${name} tab is already processing another job. Wait for it to finish or stop tracking that run.`);
      }
      return state.runs[index] = { ...current, tabId: tab.id, usesExistingTab: !freshChat,
        ...(!previouslyOwned || navigateHome || current.tabId !== tab.id ? { documentId: null, actorId: null } : {}),
        ...(!current.sendIntentAt ? { url: freshChat ? null : savedUrl || conversation(tab) } : {}),
        ...(resume && !['complete', 'invalid'].includes(current.phase) ? { phase: current.sendIntentAt ? 'submitted' : 'preparing', trackingState: null, error: '', code: '' } : {}), updatedAt: now() };
    })); } catch (error) {
      if (createTab) await browser.tabs.remove(tab.id).catch(() => {});
      throw error;
    }
    if (binding) Object.assign(binding, { tabId: value.tabId, documentId: value.documentId || null, actorId: value.actorId || null });
    await browser.storage.session.set({ [tabKey(tab.id)]: run.id }); notify();
    // Reuse the idle browser tab, but start unlinked jobs on a fresh conversation.
    // Persist the run and session binding before navigating; the old page cannot
    // receive or authorize this prompt while the home page is still loading.
    if (createTab || navigateHome) await browser.tabs.update(tab.id, { url: savedUrl || providerHome(provider), active: true });
    await focusProviderTab(tab, browser);
    if (runningPhases.includes(value.phase)) await inject(value);
    return value;
  }
  async function start(jobId, provider, {kind = 'documents'} = {}) {
    if (!providerHome(provider)) throw new Error('Choose ChatGPT or DeepSeek.');
    const job = await availableJob(jobId), id = uuid();
    const existing = (await store.read()).runs.find(run => run.jobId === jobId && (run.kind || 'documents') === kind);
    if (existing) return open(existing.id);
    if (kind === 'job-cleanup' && !await readJobAnalysisSetting(browser)) throw new Error('Enable “Let AI analyze the job” in Chat settings before starting a new AI capture.');
    if (kind === 'job-cleanup' ? !job.capturePending : job.capturePending) throw new Error('Finish AI job cleanup before generating documents.');
    // A new run owns its preferences even if Settings changes before its reply.
    const documentSettings = await readDocumentSettings(browser);
    const { value } = await store.change(state => {
      const previous = state.runs.find(run => run.jobId === jobId && (run.kind || 'documents') === kind);
      if (previous) return { run: previous, created: false };
      if (provider === 'deepseek' && deepseekBusy(state, id)) throw new Error(singleDeepseekMessage);
      const run = { id, jobId, kind, provider, documentSettings, enrichJob: kind === 'documents' && job.input.tailor !== false, outputFormat: provider === 'chatgpt' ? 'json-code-block' : null, job: structuredClone(job), prompt: kind === 'job-cleanup' ? jobCleanupPrompt(job,id) : generationPrompt(job, id, documentSettings), phase: 'opening',
        tabId: null, url: providerUrl(requestChatUrl(job), provider, true),
        createdAt: now(), updatedAt: now(), lastSeenAt: null, sendIntentAt: null };
      state.runs.push(run); return { run, created: true };
    });
    notify();
    if (!value.created) return open(value.run.id);
    try { return summary(await provision(value.run)); }
    catch (error) {
      const binding = error.generationBinding;
      await patch(id, current => tracked(current) && !current.sendIntentAt && binding && current.tabId === binding.tabId &&
        (current.documentId || null) === binding.documentId && (current.actorId || null) === binding.actorId
        ? { phase: 'attention', trackingState: null, error: error.message || 'Could not connect to the AI tab. Use Resume to try again.', code: 'connection-failed' } : null);
      throw error;
    }
  }
  async function open(id, resume = false) {
    let run = await get(id);
    if (!run) throw new Error('This generation no longer exists.');
    await availableJob(run.jobId);
    if (!resume && run.phase === 'opening' && run.tabId == null) return summary(run);
    return summary(await connectProvider(run, resume));
  }
  function validSender(sender, run) {
    try { return sender.id === browser.runtime.id && sender.frameId === 0 && sender.tab?.id === run.tabId &&
      typeof sender.documentId === 'string' && new URL(sender.url).origin === new URL(providerHome(run.provider)).origin; }
    catch { return false; }
  }
  async function attach(id, actorId, sender) {
    const run = await get(id);
    if (!run || !validSender(sender, run) || !await owned(run) || typeof actorId !== 'string' || !/^[\w-]{1,100}$/.test(actorId)) throw new Error('Unrecognized generation tab.');
    await availableJob(run.jobId);
    if (['complete', 'invalid', 'stopped', 'validating'].includes(run.phase) || run.code === 'single-tab-paused') return { done: true };
    const tab = await browser.tabs.get(run.tabId);
    if (needsHome(run) && (tab.status === 'loading' || tab.pendingUrl || providerUrl(tab.url, run.provider) !== providerHome(run.provider))) {
      throw new Error('The new chat is still opening. Wait for its home page, then use Resume if needed.');
    }
    if (run.url && providerUrl(tab.url, run.provider, true) !== run.url) {
      await patch(id, latest => tracked(latest) && latest.tabId === run.tabId && latest.url === run.url &&
        latest.documentId === run.documentId && latest.actorId === run.actorId
        ? { phase: 'attention', trackingState: null, code: 'navigated', error: 'Return the AI tab to this job’s saved conversation before resuming.' } : null);
      throw new Error('The tab is no longer on this job’s conversation.');
    }
    const current = await patch(id, latest => !['complete', 'invalid', 'stopped', 'validating'].includes(latest.phase) && latest.code !== 'single-tab-paused'
      ? { documentId: sender.documentId, actorId, lastSeenAt: now(), trackingState: null } : null, Boolean(run.trackingState));
    if (['complete', 'invalid', 'stopped', 'validating'].includes(current.phase) || current.code === 'single-tab-paused') return { done: true };
    return { id, jobId: run.jobId, kind:run.kind,provider: run.provider, prompt: run.prompt, outputFormat: run.outputFormat, url: run.url,
      mode: !current.sendIntentAt && ['opening', 'preparing', 'waiting-login'].includes(current.phase) ? 'prepare' : 'observe',
      usesExistingTab: current.usesExistingTab === true,
      sendIntentAt: current.sendIntentAt, submittedAt: current.submittedAt, baseline: current.baseline };
  }
  async function event(id, actorId, data, sender) {
    const original = await get(id);
    if (!original || !validSender(sender, original) || !await owned(original) || original.documentId !== sender.documentId || original.actorId !== actorId) throw new Error('The generation page changed.');
    await availableJob(original.jobId);
    // Chrome may retain the document's original sender.url after an SPA pushState.
    // Check the browser's current top-level URL as well as the bound document/actor.
    const tab = await browser.tabs.get(original.tabId);
    const currentUrl = providerUrl(tab.url, original.provider);
    const canCaptureWithoutLink = original.provider === 'chatgpt' && tab.url?.startsWith(providerHome('chatgpt'));
    const owns = run => run.documentId === sender.documentId && run.actorId === actorId && !['stopped', 'complete', 'invalid', 'validating'].includes(run.phase) && run.code !== 'single-tab-paused';
    // Once DeepSeek enters attention, only an explicit Resume may take its
    // active slot again. A delayed phase receipt cannot revive that run after
    // another job started; an already-finished, bound result remains capturable.
    const canAdvance = run => owns(run) && (run.provider !== 'deepseek' || tracked(run));
    if (data.kind === 'authorize') {
      let granted = false;
      await patch(id, run => {
        if (!owns(run) || run.sendIntentAt || !['preparing', 'waiting-login'].includes(run.phase) || (!currentUrl && !canCaptureWithoutLink)) return null;
        if (needsHome(run) && (tab.status === 'loading' || tab.pendingUrl || currentUrl !== providerHome(run.provider))) return null;
        const baseline = data.baseline;
        if (!baseline || !['users', 'answers'].every(key => Number.isInteger(baseline[key]) && baseline[key] >= 0 && baseline[key] <= 100000 &&
          (run.usesExistingTab || baseline[key] === 0))) return null;
        granted = true;
        return { sendIntentAt: now(), phase: 'sending', baseline, error: '', code: '', lastSeenAt: now(), trackingState: null };
      });
      return { granted };
    }
    if (!owns(original)) return { stopped: true };
    const url = providerUrl(data.url, original.provider, true);
    if (original.url && currentUrl !== original.url && data.kind === 'error') {
      await patch(id, run => owns(run) ? { phase: 'attention', code: 'navigated', error: 'The AI tab moved away from the saved conversation. Return to it and use Resume.' } : null);
      return { ok: true };
    }
    if (original.url && currentUrl !== original.url) throw new Error('The tab moved away from the saved conversation.');
    if (url && url !== currentUrl) throw new Error('Conversation URL does not match the tab.');
    if (data.kind === 'heartbeat') { await patch(id, run => owns(run) ? { lastSeenAt: now(), trackingState: null, ...diagnosticUpdate(data.diagnostics) } : null, Boolean(data.diagnostics || original.trackingState)); return { ok: true }; }
    if (data.kind === 'observed') {
      if ((!url && !canCaptureWithoutLink) || data.marker !== runMarker(original.id)) throw new Error('No matching posted prompt was observed in this conversation.');
      await patch(id, run => canAdvance(run) ? { phase: 'submitted', ...(url ? { url } : {}), sendIntentAt: run.sendIntentAt || now(),
        submittedAt: run.submittedAt || now(), submissionSource: run.sendIntentAt ? run.submissionSource || 'extension' : 'observed', error: '', code: '', lastSeenAt: now(), trackingState: null } : null);
    } else if (data.kind === 'phase') {
      const phases = original.sendIntentAt ? ['submitted', 'generating'] : ['preparing', 'waiting-login'];
      if (!phases.includes(data.phase)) throw new Error('Invalid generation phase.');
      await patch(id, run => canAdvance(run) ? { phase: data.phase, ...(url ? { url } : {}), lastSeenAt: now(), trackingState: null,
        ...diagnosticUpdate(data.diagnostics),
        ...(data.phase === 'submitted' && !run.submittedAt ? { submittedAt: now() } : {}) } : null);
    } else if (data.kind === 'error') {
      await patch(id, run => owns(run) ? run.provider !== 'deepseek' && run.sendIntentAt && ['connection', 'transport-disconnected'].includes(data.code)
        ? { trackingState: 'reconnecting', ...diagnosticUpdate(data.diagnostics), ...(url ? { url } : {}) }
        : { phase: 'attention', trackingState: null, error: String(data.message || 'Open the AI tab to inspect this run.').slice(0, 500), code: String(data.code || 'page-error').slice(0, 60), ...diagnosticUpdate(data.diagnostics), ...(url ? { url } : {}) } : null);
    } else if (data.kind === 'result') {
      if (!original.sendIntentAt || !original.submittedAt || (!url && !canCaptureWithoutLink) || typeof data.raw !== 'string' || !data.raw.trim() || data.raw.length > 500000) throw new Error('No complete reply is bound to this run.');
      await patch(id, run => owns(run) ? { phase: 'validating', trackingState: null, raw: data.raw, ...diagnosticUpdate(data.diagnostics), ...(url ? { url } : {}), capturedAt: now() } : null);
      await finalize(id);
    } else throw new Error('Unknown generation event.');
    return { ok: true };
  }
  async function finalize(id) {
    const run = await get(id);
    if (run?.phase !== 'validating') return;
    let result, error, updatedJob, completedNow = false;
    try {
      result = run.kind === 'job-cleanup' ? validateJobCleanup(run.raw,run.job,run.id) : validateGeneration(run.raw, run.job, run.id, run.outputFormat, run.documentSettings, { requireJob: run.enrichJob === true });
      if (run.kind === 'job-cleanup') await saveCapture(run,result);
      else if (result.job) {
        const saved = await jobs.change(state => applyGeneratedJobMetadata(state, run, result.job, now()));
        updatedJob = saved.value;
        if (typeof BroadcastChannel === 'function') { const channel = new BroadcastChannel('ai-agent-resume-queue'); channel.postMessage('changed'); channel.close(); }
      }
    } catch (failure) { error = failure.message; }
    const saved = await patch(id, current => {
      if (current.phase !== 'validating') return null;
      completedNow = !error;
      return { phase: error ? 'invalid' : 'complete', trackingState: null, result: result || null, ...(updatedJob ? { job: updatedJob, jobDetailsUpdatedAt: updatedJob.jobDetailsUpdatedAt } : {}), error: error || '', finishedAt: now() };
    });
    // Post-capture actions cannot change document validity or delay the reply
    // acknowledgment. The consumer owns its persistent duplicate-download guard.
    if (completedNow && run.kind !== 'job-cleanup') void Promise.resolve().then(() => onComplete(saved)).catch(() => {});
  }
  async function trackingState(run, value) {
    let changed = false;
    const current = await patch(run.id, latest => {
      // A newer heartbeat, completion, Stop or rebinding wins over a late probe.
      if (disposed || !tracked(latest) || latest.tabId !== run.tabId ||
          (latest.lastSeenAt || 0) > (run.lastSeenAt || 0) || latest.trackingState === value) return null;
      changed = true; return { trackingState: value };
    }, false);
    if (changed) notify();
    return current;
  }
  async function checkTracking(run, { force = false, prepare = false } = {}) {
    if (disposed || !tracked(run) || !Number.isInteger(run.tabId)) return;
    if (run.provider === 'deepseek') {
      // Report a dead observer without restarting it, moving tabs, or sending.
      // Explicit Resume still owns DeepSeek recovery and its single active slot.
      if (now() - (run.lastSeenAt || run.sendIntentAt || run.createdAt) >= trackingStaleMs) await trackingState(run, 'suspended');
      return;
    }
    if (recovering.has(run.id)) return recovering.get(run.id);
    const task = (async () => {
      try {
        const tab = await bounded(browser.tabs.get(run.tabId));
        const current = await get(run.id);
        if (disposed || !tracked(current) || current.tabId !== run.tabId) return;
        run = current;
        if (tab.frozen || tab.discarded || !await bounded(owned(run))) {
          await trackingState(run, 'suspended'); return;
        }
        if (tab.status === 'loading' || tab.pendingUrl) {
          if (run.sendIntentAt) await trackingState(run, 'reconnecting');
          return;
        }
        if (!tab.url?.startsWith(providerHome(run.provider)) || run.url && providerUrl(tab.url, run.provider, true) !== run.url) {
          // Never navigate an existing tab or redirect a submitted job during recovery.
          await trackingState(run, 'suspended'); return;
        }
        const stale = now() - (run.lastSeenAt || run.sendIntentAt || run.createdAt) >= trackingStaleMs;
        if (!force && !stale && !run.trackingState) return;
        if (!run.sendIntentAt && !prepare) {
          if (stale) await trackingState(run, 'suspended');
          return;
        }
        const lastAttempt = recoveryAttempts.get(run.id) || 0;
        if (!force && lastAttempt && now() - lastAttempt < recoveryRetryMs) return;
        recoveryAttempts.set(run.id, now());
        if (stale || run.trackingState) run = await trackingState(run, 'reconnecting');
        if (!tracked(run)) return;
        await inject(run, { observeOnly: !prepare });
      } catch {
        await trackingState(run, 'reconnecting').catch(() => {});
      }
    })();
    recovering.set(run.id, task);
    try { await task; } finally { if (recovering.get(run.id) === task) recovering.delete(run.id); }
  }
  async function health({ tabId = null, force = false, prepare = false } = {}) {
    if (disposed) return;
    const pending = (await store.read()).runs.filter(run => tracked(run) && (tabId == null || run.tabId === tabId));
    // A hung renderer must not prevent other jobs from reporting or recovering.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (next < pending.length && !disposed) await checkTracking(pending[next++], { force, prepare });
    }));
  }
  async function list({ health: checkHealth = false } = {}) {
    const { runs } = await store.read();
    for (const run of runs) if (run.phase === 'validating') await finalize(run.id);
    if (checkHealth) await health();
    return (await store.read()).runs.filter(run => run.kind !== 'document-export').map(summary);
  }
  async function reconnect() {
    await list();
    // Upgrade old multi-tab state without deleting replies or re-sending. Keep
    // one deterministic run; the others can be explicitly resumed afterward.
    const { value: paused } = await store.change(state => {
      const active = state.runs.filter(deepseekActive).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      return active.slice(1).map(run => {
        const index = state.runs.findIndex(current => current.id === run.id);
        state.runs[index] = { ...run, phase: 'attention', trackingState: null, code: 'single-tab-paused',
          error: 'DeepSeek is limited to one job at a time. This run is paused. Finish or Stop tracking the current job, then use Resume here.', updatedAt: now() };
        return { id: run.id, tabId: run.tabId };
      });
    });
    for (const run of paused) if (run.tabId != null) void browser.tabs.sendMessage(run.tabId, { type: 'generation.stop', id: run.id }).catch(() => {});
    if (paused.length) notify();
    await reconnectDeepseek();
    await health({ force: true, prepare: true });
  }
  async function reconnectDeepseek(tabId = null) {
    const run = (await store.read()).runs.filter(run => run.provider === 'deepseek' && tracked(run))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
    if (!run || tabId != null && run.tabId !== tabId) return;
    try { await inject(run); }
    catch {
      await patch(run.id, current => tracked(current) && current.tabId === run.tabId &&
        current.documentId === run.documentId && current.actorId === run.actorId && (current.lastSeenAt || 0) <= (run.lastSeenAt || 0)
        ? { phase: 'attention', trackingState: null, code: 'disconnected', error: 'The DeepSeek tab is unavailable. Open it and use Resume to continue checking this run.' } : null);
    }
  }
  async function stop(id) {
    const run = await patch(id, current => ['complete', 'invalid'].includes(current.phase) ? null : { phase: 'stopped', trackingState: null, error: '', code: '' });
    if (run.tabId != null) void browser.tabs.sendMessage(run.tabId, { type: 'generation.stop', id }).catch(() => {});
    return summary(run);
  }
  const onUpdated = (tabId, info) => {
    if (info.status === 'complete') void reconnectDeepseek(tabId).catch(() => {});
    if (info.status === 'complete' || 'frozen' in info || 'discarded' in info) {
      void health({ tabId, force: true, prepare: info.status === 'complete' }).catch(() => {});
    }
  };
  const onActivated = ({ tabId }) => { void health({ tabId, force: true }).catch(() => {}); };
  const onRemoved = tabId => { void store.read().then(async ({ runs }) => {
    await browser.storage.session.remove(tabKey(tabId));
    for (const run of runs.filter(run => run.tabId === tabId && runningPhases.includes(run.phase))) await patch(run.id, current => tracked(current) && current.tabId === tabId ? { phase: 'attention', trackingState: null, code: 'tab-closed', error: 'The AI tab was closed. Resume will check the saved conversation without resending.' } : null);
  }).catch(() => {}); };
  browser.tabs.onUpdated.addListener(onUpdated); browser.tabs.onRemoved.addListener(onRemoved); browser.tabs.onActivated?.addListener(onActivated);
  return { start, startCapture:(jobId,provider)=>start(jobId,provider,{kind:'job-cleanup'}),open, attach, event, list, reconnect, health, stop,
    async read(id) { const run = await get(id); if (!run) throw new Error('Run not found.'); const { job, prompt, ...value } = run; return value; },
    dispose() { disposed = true; browser.tabs.onUpdated.removeListener(onUpdated); browser.tabs.onRemoved.removeListener(onRemoved); browser.tabs.onActivated?.removeListener(onActivated); } };
}
