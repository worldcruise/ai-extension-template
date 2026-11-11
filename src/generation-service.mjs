import { createGenerationStore } from './generation-store.mjs';
import { createQueueStore } from './queue-store.mjs';
import { generationPrompt, providerHome, providerUrl, runMarker, runningPhases, validateGeneration } from './generation-data.mjs';
import { existingChatGPTTabs, focusChatGPTTab } from './chatgpt-tabs.mjs';
import { generationDiagnostics } from './generation-diagnostics.mjs';

const scripts = ['src/build-info.js', 'src/generation-dom.js', 'src/chatgpt-submit-adapter.js', 'src/generation-chatgpt.js', 'src/generation-deepseek.js', 'src/generation-tab.js'];
const summary = ({ job, prompt, raw, result, ...run }) => run;
export function createGenerationService({ browser = chrome, store = createGenerationStore(), jobs = createQueueStore(),
  now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  const notify = () => { void browser.runtime.sendMessage({ type: 'generation.changed' }).catch(() => {}); };
  const get = async id => (await store.read()).runs.find(run => run.id === id);
  const tabKey = id => `document-generation-tab:${id}`;
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
  async function inject(run) {
    if (!Number.isInteger(run.tabId) || ['complete', 'invalid', 'stopped'].includes(run.phase)) return;
    if (!await owned(run)) throw new Error('The browser session changed. Resume this run to reopen its conversation.');
    const tab = await browser.tabs.get(run.tabId);
    if (tab.status === 'loading') return; // onUpdated injects once the already-open tab finishes loading.
    if (!tab.url?.startsWith(providerHome(run.provider))) return;
    await browser.scripting.executeScript({ target: { tabId: run.tabId, frameIds: [0] }, files: scripts });
    await browser.scripting.executeScript({ target: { tabId: run.tabId, frameIds: [0] }, func: id => globalThis.AiAgentGenerationTab?.start(id), args: [run.id] });
  }
  async function provision(run) {
    if (run.provider === 'chatgpt') return connectChatGPT(run, true);
    const tab = await browser.tabs.create({ url: 'about:blank', active: true });
    // Bind the tab before navigating, so an immediately loaded provider can never attach to the wrong job.
    const bound = await patch(run.id, current => current.tabId == null ? { tabId: tab.id, phase: 'preparing' } : null);
    if (bound.tabId !== tab.id) { await browser.tabs.remove(tab.id); return bound; }
    await browser.storage.session.set({ [tabKey(tab.id)]: run.id });
    await browser.tabs.update(tab.id, { url: providerHome(run.provider), active: true });
    return bound;
  }
  async function connectChatGPT(run, resume) {
    const terminal = ['complete', 'invalid'].includes(run.phase);
    const tabs = await existingChatGPTTabs(browser);
    let tab = tabs.find(tab => tab.id === run.tabId && (!run.url || providerUrl(tab.url, 'chatgpt', true) === run.url));
    const previouslyOwned = tab && await owned(run);
    if (!previouslyOwned) {
      if (!run.sendIntentAt && !terminal) tab = tabs[0];
      else if (run.url) tab = tabs.find(tab => providerUrl(tab.url, 'chatgpt', true) === run.url);
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
    if (!tab) {
      const error = run.sendIntentAt ? 'Open this run’s ChatGPT conversation in a browser tab, then use Resume. Nothing will be resent.' :
        'Open ChatGPT in a browser tab first, then use Generate documents or Resume.';
      if (!terminal) await patch(run.id, () => ({ phase: 'attention', code: 'chatgpt-tab-missing', error }));
      throw new Error(terminal ? 'Open the original ChatGPT conversation in a tab. The captured documents are still available through Review documents.' : error);
    }
    const { value } = await store.change(state => {
      const index = state.runs.findIndex(item => item.id === run.id), current = state.runs[index];
      if (state.runs.some(item => item.id !== run.id && item.tabId === tab.id && [...runningPhases, 'validating'].includes(item.phase))) {
        throw new Error('That ChatGPT tab is already processing another job. Wait for it to finish or stop tracking that run.');
      }
      return state.runs[index] = { ...current, tabId: tab.id, usesExistingTab: true,
        ...(!previouslyOwned || current.tabId !== tab.id ? { documentId: null, actorId: null } : {}),
        ...(!current.sendIntentAt ? { url: providerUrl(tab.url, 'chatgpt', true) } : {}),
        ...(resume && !terminal ? { phase: current.sendIntentAt ? 'submitted' : 'preparing', error: '', code: '' } : {}), updatedAt: now() };
    });
    await browser.storage.session.set({ [tabKey(tab.id)]: run.id }); notify();
    await focusChatGPTTab(tab, browser);
    if (runningPhases.includes(value.phase)) await inject(value);
    return value;
  }
  async function start(jobId, provider) {
    if (!providerHome(provider)) throw new Error('Choose ChatGPT or DeepSeek.');
    const job = await availableJob(jobId), id = uuid();
    const { value } = await store.change(state => {
      const previous = state.runs.find(run => run.jobId === jobId);
      if (previous) return { run: previous, created: false };
      const run = { id, jobId, provider, outputFormat: provider === 'chatgpt' ? 'json-code-block' : null, job: structuredClone(job), prompt: generationPrompt(job, id), phase: 'opening',
        tabId: null, url: null, createdAt: now(), updatedAt: now(), lastSeenAt: null, sendIntentAt: null };
      state.runs.push(run); return { run, created: true };
    });
    notify();
    if (!value.created) return open(value.run.id);
    try { return summary(await provision(value.run)); }
    catch (error) { await patch(id, () => ({ phase: 'attention', error: error.message || 'Could not connect to the AI tab. Use Resume to try again.', code: 'connection-failed' })); throw error; }
  }
  async function open(id, resume = false) {
    let run = await get(id);
    if (!run) throw new Error('This generation no longer exists.');
    await availableJob(run.jobId);
    if (run.provider === 'chatgpt') {
      if (!resume && run.phase === 'opening' && run.tabId == null) return summary(run);
      return summary(await connectChatGPT(run, resume));
    }
    if (resume && !['complete', 'invalid'].includes(run.phase)) {
      run = await patch(id, current => ({ phase: current.sendIntentAt ? 'submitted' : 'preparing', error: '', code: '' }));
    }
    let tab;
    try {
      if (await owned(run)) tab = await browser.tabs.get(run.tabId);
      else if (resume && Number.isInteger(run.tabId) && !(await browser.storage.session.get(tabKey(run.tabId)))[tabKey(run.tabId)]) {
        const candidate = await browser.tabs.get(run.tabId), url = providerUrl(candidate.url, run.provider);
        if (url && (!run.url || url === run.url)) {
          // Extension reload clears session storage. A tab ID alone is not proof of
          // ownership; recover it only after a read-only check of this unique run marker.
          const proof = await browser.scripting.executeScript({ target: { tabId: run.tabId, frameIds: [0] },
            func: marker => Boolean(document.body?.innerText.includes(marker) ||
              [...document.querySelectorAll('#prompt-textarea, #chat-input, [data-testid="prompt-textarea"]')].some(node =>
                (node.value || node.innerText || '').includes(marker) || [...node.querySelectorAll('textarea')].some(input => input.value.includes(marker)))),
            args: [runMarker(run.id)] });
          if (proof?.[0]?.result === true) {
            await browser.storage.session.set({ [tabKey(run.tabId)]: run.id });
            run = await patch(id, () => ({ documentId: null, actorId: null })); tab = candidate;
          }
        }
      }
    } catch { /* A closed or unverified tab is recoverable only through the existing provision rules. */ }
    // Opening a finished result must not downgrade it or replace a tab the user has since reused.
    if (tab && ['complete', 'invalid'].includes(run.phase) && run.url && providerUrl(tab.url, run.provider, true) !== run.url) tab = null;
    if (!tab) {
      if (!run.sendIntentAt) {
        if (!resume && now() - run.updatedAt < 30000) return summary(run);
        // Only one explicit recovery may provision a missing tab at a time.
        const ticket = uuid();
        run = await patch(id, current => current.openLease > now() ? null : { tabId: null, openLease: now() + 30000, openTicket: ticket });
        if (run.openTicket !== ticket) return summary(run);
        run = await provision(run);
      } else {
        if (!run.url) {
          if (['complete', 'invalid'].includes(run.phase)) throw new Error('This chat has no saved link and its tab is closed. The captured documents are still available through Review documents.');
          const error = 'The AI tab closed before its conversation link was saved. Open the conversation manually and import its documents. Nothing will be resent.';
          await patch(id, () => ({ phase: 'attention', code: 'missing-conversation', error }));
          throw new Error(error);
        }
        const ticket = uuid();
        run = await patch(id, current => current.openLease > now() ? null : { openLease: now() + 30000, openTicket: ticket });
        if (run.openTicket !== ticket) return summary(run);
        const reopened = await browser.tabs.create({ url: 'about:blank', active: true });
        run = await patch(id, () => ({ tabId: reopened.id, documentId: null, actorId: null }));
        await browser.storage.session.set({ [tabKey(reopened.id)]: run.id });
        await browser.tabs.update(reopened.id, { url: run.url });
      }
    } else {
      if (run.url && providerUrl(tab.url, run.provider, true) !== run.url) {
        await patch(id, () => ({ phase: 'attention', code: 'navigated', error: 'This tab moved to another page. Return to the saved conversation before resuming.' }));
        throw new Error('Return the AI tab to its saved conversation before resuming.');
      }
      await browser.tabs.update(tab.id, { active: true });
      if (Number.isInteger(tab.windowId)) await browser.windows.update(tab.windowId, { focused: true });
      if (resume || runningPhases.includes(run.phase)) await inject(run);
    }
    return summary(run);
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
    if (['complete', 'invalid', 'stopped', 'validating'].includes(run.phase)) return { done: true };
    if (run.url && providerUrl((await browser.tabs.get(run.tabId)).url, run.provider, true) !== run.url) {
      await patch(id, () => ({ phase: 'attention', code: 'navigated', error: 'Return the AI tab to this job’s saved conversation before resuming.' }));
      throw new Error('The tab is no longer on this job’s conversation.');
    }
    const current = await patch(id, () => ({ documentId: sender.documentId, actorId, lastSeenAt: now() }), false);
    return { id, jobId: run.jobId, provider: run.provider, prompt: run.prompt, outputFormat: run.outputFormat, url: run.url,
      mode: !current.sendIntentAt && ['opening', 'preparing', 'waiting-login'].includes(current.phase) ? 'prepare' : 'observe',
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
    const owns = run => run.documentId === sender.documentId && run.actorId === actorId && !['stopped', 'complete', 'invalid', 'validating'].includes(run.phase);
    if (data.kind === 'authorize') {
      let granted = false;
      await patch(id, run => {
        if (!owns(run) || run.sendIntentAt || !['preparing', 'waiting-login'].includes(run.phase) || (!currentUrl && !canCaptureWithoutLink)) return null;
        const baseline = data.baseline;
        if (!baseline || !['users', 'answers'].every(key => Number.isInteger(baseline[key]) && baseline[key] >= 0 && baseline[key] <= 100000 &&
          (run.provider === 'chatgpt' && run.usesExistingTab || baseline[key] === 0))) return null;
        granted = true;
        return { sendIntentAt: now(), phase: 'sending', baseline, error: '', code: '' };
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
    if (data.kind === 'heartbeat') { await patch(id, run => owns(run) ? { lastSeenAt: now(), ...diagnosticUpdate(data.diagnostics) } : null, Boolean(data.diagnostics)); return { ok: true }; }
    if (data.kind === 'observed') {
      if ((!url && !canCaptureWithoutLink) || data.marker !== runMarker(original.id)) throw new Error('No matching posted prompt was observed in this conversation.');
      await patch(id, run => owns(run) ? { phase: 'submitted', ...(url ? { url } : {}), sendIntentAt: run.sendIntentAt || now(),
        submittedAt: run.submittedAt || now(), submissionSource: run.sendIntentAt ? run.submissionSource || 'extension' : 'observed', error: '', code: '', lastSeenAt: now() } : null);
    } else if (data.kind === 'phase') {
      const phases = original.sendIntentAt ? ['submitted', 'generating'] : ['preparing', 'waiting-login'];
      if (!phases.includes(data.phase)) throw new Error('Invalid generation phase.');
      await patch(id, run => owns(run) ? { phase: data.phase, ...(url ? { url } : {}), lastSeenAt: now(),
        ...diagnosticUpdate(data.diagnostics),
        ...(data.phase === 'submitted' && !run.submittedAt ? { submittedAt: now() } : {}) } : null);
    } else if (data.kind === 'error') {
      await patch(id, run => owns(run) ? { phase: 'attention', error: String(data.message || 'Open the AI tab to inspect this run.').slice(0, 500), code: String(data.code || 'page-error').slice(0, 60), ...diagnosticUpdate(data.diagnostics), ...(url ? { url } : {}) } : null);
    } else if (data.kind === 'result') {
      if (!original.sendIntentAt || !original.submittedAt || (!url && !canCaptureWithoutLink) || typeof data.raw !== 'string' || !data.raw.trim() || data.raw.length > 500000) throw new Error('No complete reply is bound to this run.');
      await patch(id, run => owns(run) ? { phase: 'validating', raw: data.raw, ...diagnosticUpdate(data.diagnostics), ...(url ? { url } : {}), capturedAt: now() } : null);
      await finalize(id);
    } else throw new Error('Unknown generation event.');
    return { ok: true };
  }
  async function finalize(id) {
    const run = await get(id);
    if (run?.phase !== 'validating') return;
    let result, error;
    try { result = validateGeneration(run.raw, run.job, run.id, run.outputFormat); } catch (failure) { error = failure.message; }
    await patch(id, current => current.phase === 'validating' ? { phase: error ? 'invalid' : 'complete', result: result || null, error: error || '', finishedAt: now() } : null);
  }
  async function list() {
    const { runs } = await store.read();
    for (const run of runs) if (run.phase === 'validating') await finalize(run.id);
    return (await store.read()).runs.map(summary);
  }
  async function reconnect() {
    const { runs } = await store.read();
    for (const run of runs) {
      if (run.phase === 'validating') { await finalize(run.id); continue; }
      if (runningPhases.includes(run.phase)) {
        try { await inject(run); }
        catch { await patch(run.id, current => runningPhases.includes(current.phase) ? { phase: 'attention', code: 'disconnected', error: 'The AI tab is unavailable. Open it and use Resume to continue checking this run.' } : null); }
      }
    }
  }
  async function stop(id) {
    const run = await patch(id, current => ['complete', 'invalid'].includes(current.phase) ? null : { phase: 'stopped', error: '', code: '' });
    if (run.tabId != null) void browser.tabs.sendMessage(run.tabId, { type: 'generation.stop', id }).catch(() => {});
    return summary(run);
  }
  const onUpdated = (tabId, info) => { if (info.status === 'complete') void store.read().then(async ({ runs }) => {
    for (const run of runs.filter(run => run.tabId === tabId && runningPhases.includes(run.phase))) await inject(run).catch(() => {});
  }).catch(() => {}); };
  const onRemoved = tabId => { void store.read().then(async ({ runs }) => {
    await browser.storage.session.remove(tabKey(tabId));
    for (const run of runs.filter(run => run.tabId === tabId && runningPhases.includes(run.phase))) await patch(run.id, () => ({ phase: 'attention', code: 'tab-closed', error: 'The AI tab was closed. Resume will check the saved conversation without resending.' }));
  }).catch(() => {}); };
  browser.tabs.onUpdated.addListener(onUpdated); browser.tabs.onRemoved.addListener(onRemoved);
  return { start, open, attach, event, list, reconnect, stop,
    async read(id) { const run = await get(id); if (!run) throw new Error('Run not found.'); const { job, prompt, ...value } = run; return value; },
    dispose() { browser.tabs.onUpdated.removeListener(onUpdated); browser.tabs.onRemoved.removeListener(onRemoved); } };
}
