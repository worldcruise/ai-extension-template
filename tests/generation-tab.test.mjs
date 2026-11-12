import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { phaseLabel } from '../src/generation-data.mjs';

const source = await readFile(new URL('../src/generation-tab.js', import.meta.url), 'utf8');
async function fixture({ provider = 'deepseek', prepare = false, transport = async () => undefined } = {}) {
  let time = 1000, sequence = 0, sends = 0;
  const timers = new Map(), events = [], listeners = new Map();
  const run = { id: 'run-1', jobId: 'job-1', provider, prompt: 'prompt', mode: prepare ? 'prepare' : 'observe',
    sendIntentAt: prepare ? null : 900, submittedAt: prepare ? null : 950,
    url: provider === 'chatgpt' ? 'https://chatgpt.com/c/run-1' : 'https://chat.deepseek.com/a/chat/s/run-1',
    baseline: prepare ? undefined : { users: 0, answers: 0 }, usesExistingTab: false };
  const reply = { user: prepare ? null : {}, node: prepare ? null : {}, raw: '', complete: false,
    responseMatched: false, diagnostics: { stage: 'capture', code: 'waiting_for_idle' } };
  let busy = !prepare, actor;
  const on = (name, fn) => { const list = listeners.get(name) || new Set(); list.add(fn); listeners.set(name, list); };
  const off = (name, fn) => listeners.get(name)?.delete(fn);
  const document = { hidden: false, documentElement: {}, querySelectorAll: () => [], addEventListener: on, removeEventListener: off };
  const window = { addEventListener: on, removeEventListener: off }; window.top = window;
  const setTimer = (fn, ms, interval = 0) => { const id = ++sequence; timers.set(id, { fn, at: time + ms, interval }); return id; };
  const adapter = { conversation: () => run.url, answer: current => {
    if (reply.responseMatched) assert.deepEqual(JSON.parse(JSON.stringify(current.baseline)), { users:0, answers:0 });
    return reply;
  }, busy: () => busy, login: () => false, editor: () => ({}), baseline: () => ({ users:0, answers:0 }),
  send: async (_run, options) => { await options.beforeSubmit(); sends++; return { diagnostics:{} }; } };
  const context = vm.createContext({ window, document, location: { origin: new URL(run.url).origin },
    crypto: { randomUUID: () => 'actor-1' }, AbortController, Date: { now: () => time },
    setTimeout: (fn, ms) => setTimer(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => setTimer(fn, ms, ms), clearInterval: id => timers.delete(id),
    MutationObserver: class { observe() {} disconnect() {} },
    AiAgentGenerationDOM: { visible: () => true, text: () => '', normal: value => value, completedJSON: raw => raw === 'RESULT' },
    AiAgentDeepSeekGeneration: adapter, AiAgentChatGPTGeneration: adapter,
    chrome: { runtime: { id: 'extension', onMessage: { addListener: fn => { actor = fn; } }, sendMessage: async message => {
      if (message.type === 'generation.attach') return { ok:true, value:structuredClone(run) };
      events.push(structuredClone(message.data));
      const result = await transport(message.data);
      if (result !== undefined) return result;
      return { ok:true, value: message.data.kind === 'authorize' ? { granted:true } : { ok:true } };
    } } }
  });
  const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
  async function tick(ms) {
    const end = time + ms;
    while (true) {
      await flush();
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next; time = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn();
    }
    time = end; await flush();
  }
  vm.runInContext(source, context); context.AiAgentGenerationTab.start(run.id); await flush();
  return { run, reply, events, timers, tick, flush, sends: () => sends, setBusy: value => { busy = value; },
    start: () => context.AiAgentGenerationTab.start(run.id),
    fire: name => { for (const fn of listeners.get(name) || []) fn(); },
    jump: ms => { time += ms; for (const timer of timers.values()) timer.at = Math.max(timer.at, time); },
    stop: () => actor({ type:'generation.stop', id:run.id }, { id:'extension' }) };
}

test('one rejected heartbeat leaves the observer running and a later reply is captured once', async () => {
  let rejected = false;
  const f = await fixture({ transport: async data => {
    if (data.kind === 'heartbeat' && !rejected) { rejected = true; throw new Error('Temporary disconnect'); }
  } });
  await f.tick(11000); assert.equal(rejected, true);
  assert.ok(f.events.some(event => event.kind === 'phase' && event.phase === 'generating'));
  assert.equal(f.events.some(event => event.kind === 'error'), false);
  f.reply.raw = 'RESULT'; f.reply.complete = true; f.setBusy(false);
  await f.tick(2000);
  assert.equal(f.events.filter(event => event.kind === 'result').length, 1);
  assert.equal(f.sends(), 0);
});

test('DeepSeek requires its posted prompt and does not recover from an unanchored matching response', async () => {
  const f = await fixture(); f.reply.user = null; f.reply.node = null;
  f.reply.responseMatched = true; f.reply.node = {}; f.reply.raw = 'RESULT'; f.reply.complete = true;
  await f.tick(2000);
  assert.equal(f.events.filter(event => event.kind === 'result').length, 0);
  assert.ok(f.events.some(event => event.kind === 'error' && event.code === 'conversation-changed'));
  assert.equal(f.sends(), 0);
});

test('thinking activity reports generation before an answer node exists', async () => {
  const f = await fixture(); f.reply.node = null;
  await f.tick(500);
  assert.ok(f.events.some(event => event.kind === 'phase' && event.phase === 'generating'));
  f.stop(); await f.tick(500); assert.equal(f.timers.size, 0);
});

test('prolonged DeepSeek heartbeat loss requests explicit Resume instead of silently stopping', async () => {
  const f = await fixture({ transport: async data => { if (data.kind === 'heartbeat') throw new Error('Disconnected'); } });
  await f.tick(41000);
  assert.ok(f.events.some(event => event.kind === 'error' && event.code === 'transport-disconnected'));
  assert.match(f.events.find(event => event.kind === 'error').message, /Use Resume/);
  assert.equal(f.timers.size, 0);
});

test('explicit service denial is fatal and is never retried as a transport outage', async () => {
  const f = await fixture({ transport: async data => data.kind === 'heartbeat' ? { ok:false, error:'Ownership changed', code:'generation-denied' } : undefined });
  await f.tick(11000);
  assert.equal(f.events.filter(event => event.kind === 'heartbeat').length, 1);
  assert.ok(f.events.some(event => event.kind === 'error' && event.code === 'generation-denied'));
  assert.equal(f.timers.size, 0);
});

test('an uncertain authorization is never repeated and dispatches no prompt', async () => {
  const f = await fixture({ provider:'chatgpt', prepare:true, transport: async data => { if (data.kind === 'authorize') throw new Error('Ack lost after persistence'); } });
  await f.tick(35000);
  assert.equal(f.events.filter(event => event.kind === 'authorize').length, 1);
  assert.equal(f.sends(), 0);
  assert.ok(f.events.some(event => event.kind === 'error' && event.code === 'connection'));
});

test('prepared runs retain their baseline for later missing-user matching', async () => {
  const f = await fixture({ provider:'chatgpt', prepare:true });
  f.reply.responseMatched = true; f.reply.raw = 'RESULT'; f.reply.complete = true;
  await f.tick(2000);
  assert.equal(f.sends(), 1); assert.equal(f.events.filter(event => event.kind === 'result').length, 1);
});

test('freeze/resume does not spend the reply timeout and wakes observation without resending', async () => {
  const f = await fixture(); await f.tick(1000);
  f.fire('freeze'); f.jump(360000); f.fire('resume'); await f.flush();
  f.reply.raw = 'RESULT'; f.reply.complete = true; f.setBusy(false);
  await f.tick(2500);
  assert.equal(f.events.some(event => event.kind === 'error'), false);
  assert.equal(f.events.filter(event => event.kind === 'result').length, 1);
  assert.equal(f.sends(), 0);
});

test('freezing after a transient disconnect does not exhaust the transport recovery budget', async () => {
  let failures = 0;
  const f = await fixture({ transport: async data => { if (data.kind === 'heartbeat' && ++failures <= 2) throw new Error('Temporary disconnect'); } });
  await f.tick(11000); f.fire('freeze'); f.jump(360000); f.fire('resume'); await f.flush();
  f.reply.raw = 'RESULT'; f.reply.complete = true; f.setBusy(false);
  await f.tick(2500);
  assert.equal(f.events.some(event => event.kind === 'error'), false);
  assert.equal(f.events.filter(event => event.kind === 'result').length, 1);
});

test('tracking health labels leave terminal results unchanged', () => {
  assert.equal(phaseLabel({ phase:'generating', trackingState:'reconnecting' }), 'Reconnecting to chat');
  assert.match(phaseLabel({ phase:'submitted', trackingState:'suspended' }), /Tracking paused/);
  assert.equal(phaseLabel({ phase:'complete', trackingState:'reconnecting' }), 'Ready to review');
  assert.equal(phaseLabel({provider:'deepseek',phase:'generating',trackingState:'suspended'}), 'Tracking paused · use Resume');
});

test('capture reports stable code content and a recognized conversation independently of submission', async () => {
  const f = await fixture(); f.reply.raw = 'RESULT'; f.reply.complete = true; f.setBusy(false);
  await f.tick(1000); assert.equal(f.events.some(event => event.kind === 'result'), false);
  await f.tick(1000);
  const result = f.events.find(event => event.kind === 'result');
  assert.ok(result.diagnostics.stableMs >= 1500); assert.equal(result.diagnostics.conversationFound, true);
  assert.equal(f.sends(), 0);
});

test('a finished but unrecognized DeepSeek answer gets a capture-specific timeout without resending', async () => {
  const f = await fixture(); f.reply.raw = 'Unrecognized final output'; f.setBusy(false);
  f.reply.diagnostics = {stage:'capture',code:'waiting_for_completion',replyChars:26,generationActive:false};
  await f.tick(301000);
  const error = f.events.find(event => event.kind === 'error');
  assert.equal(error.code, 'reply-timeout'); assert.match(error.message, /has a reply.*final document output/);
  assert.equal(f.sends(), 0); assert.equal(f.timers.size, 0);
});
