export function createGenerationClient({ browser = chrome } = {}) {
  let runs = [], revision = 0, disposed = false;
  const listeners = new Set();
  async function call(type, args = {}) {
    const reply = await browser.runtime.sendMessage({ type: `generation.${type}`, ...args });
    if (!reply?.ok) throw new Error(reply?.error || 'Could not connect to document generation.');
    return reply.value;
  }
  async function refresh(reconnect = false) {
    const ticket = ++revision, value = await call('list', { reconnect });
    if (disposed || ticket !== revision) return;
    runs = value; for (const listener of listeners) listener(runs);
  }
  const onMessage = (message, sender) => {
    if (sender.id === browser.runtime.id && !sender.tab && message?.type === 'generation.changed') void refresh().catch(() => {});
  };
  browser.runtime.onMessage.addListener(onMessage);
  const ready = refresh(true);
  return { ready, refresh, forJob: id => runs.find(run => run.jobId === id),
    async start(jobId, provider) { const run = await call('start', { jobId, provider }); await refresh(); return run; },
    async open(id, resume = false) { const run = await call('open', { id, resume }); await refresh(); return run; },
    read: id => call('read', { id }),
    async stop(id) { await call('stop', { id }); await refresh(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; revision++; listeners.clear(); browser.runtime.onMessage.removeListener(onMessage); } };
}
