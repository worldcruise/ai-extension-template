import { runningPhases } from './generation-data.mjs';

export function createGenerationClient({ browser = chrome, pollMs = 10000,
  schedule = setInterval, unschedule = clearInterval } = {}) {
  let runs = [], revision = 0, disposed = false, timer = null, healthPending = false;
  const listeners = new Set();
  async function call(type, args = {}) {
    const reply = await browser.runtime.sendMessage({ type: `generation.${type}`, ...args });
    if (!reply?.ok) throw new Error(reply?.error || 'Could not connect to document generation.');
    return reply.value;
  }
  function updatePolling() {
    const active = runs.some(run => runningPhases.includes(run.phase) || run.phase === 'validating');
    if (!disposed && active && timer == null) timer = schedule(() => {
      if (disposed || healthPending) return;
      healthPending = true;
      void refresh(false, true).catch(() => {}).finally(() => { healthPending = false; });
    }, pollMs);
    else if ((!active || disposed) && timer != null) { unschedule(timer); timer = null; }
  }
  async function refresh(reconnect = false, health = false) {
    const ticket = ++revision, value = await call('list', { reconnect, health });
    if (disposed || ticket !== revision) return;
    runs = value; updatePolling(); for (const listener of listeners) listener(runs);
  }
  const onMessage = (message, sender) => {
    if (sender.id === browser.runtime.id && !sender.tab && message?.type === 'generation.changed') void refresh().catch(() => {});
  };
  browser.runtime.onMessage.addListener(onMessage);
  const ready = refresh(true);
  return { ready, refresh, forJob: id => runs.find(run => run.jobId === id && (!run.kind || run.kind === 'documents')),
    captures:()=>runs.filter(run=>run.kind === 'job-cleanup'),
    async capture(jobId,provider) {const run=await call('capture',{jobId,provider});await refresh();return run;},
    applyUrls:(tabId,sourceUrl)=>call('apply-urls',{tabId,sourceUrl}),
    async start(jobId, provider) { const run = await call('start', { jobId, provider }); await refresh(); return run; },
    async open(id, resume = false) { const run = await call('open', { id, resume }); await refresh(); return run; },
    read: id => call('read', { id }),
    download: id => call('download', { id }),
    downloadSaved: (jobId, kind) => call('download-saved', { jobId, kind }),
    async stop(id) { await call('stop', { id }); await refresh(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; revision++; updatePolling(); listeners.clear(); browser.runtime.onMessage.removeListener(onMessage); } };
}
