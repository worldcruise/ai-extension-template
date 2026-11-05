import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentController } from '../src/controller.mjs';
import { defineAgent, formatResult } from '../src/definition.mjs';
import { apiResultAgent, fixedPromptAgent, fixedInputAgent } from './fixtures/agents.mjs';

const account = { authenticated: true, user: { id: 'one', name: 'Test account' } };
const modelList = [
  { id: 'reasoning', label: 'Reasoning', thinkingEfforts: ['low', 'high'], defaultThinkingEffort: 'high' },
  { id: 'standard', label: 'Standard', thinkingEfforts: [] },
];
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture({ signedIn = false, definition = {}, ...overrides } = {}) {
  let session = signedIn ? account : null;
  const calls = [];
  const adapter = {
    async getSession() { return session; },
    async signIn() { session = account; },
    async signOut() { session = null; },
    async getModels() { return modelList; },
    async run(request) { calls.push(request); return { text: 'A real adapter response.' }; },
    ...overrides,
  };
  const controller = new AgentController({ definition: { input: { value: 'Test input' }, ...definition }, adapter });
  return { controller, calls, setSession(value) { session = value; } };
}

test('sign-in opening does not establish an account; only getSession verifies it', async () => {
  const { controller } = fixture({ async signIn() {} });
  await controller.start();
  assert.equal(controller.state.session, null);
  await controller.signIn();
  assert.equal(controller.state.session, null);
  assert.equal(controller.ready, false);
  assert.match(controller.state.status.message, /not completed/);
});

test('successful sign-in loads account models and supported default effort', async () => {
  const { controller } = fixture();
  await controller.start();
  await controller.signIn();
  assert.equal(controller.state.session.user.name, 'Test account');
  assert.equal(controller.state.model, 'reasoning');
  assert.equal(controller.state.thinkingEffort, 'high');
  assert.equal(controller.ready, true);
});

test('failed sign-in is retryable and does not present a signed-in account', async () => {
  const { controller } = fixture({ async signIn() { throw new Error('Provider unavailable.'); } });
  await controller.start();
  await controller.signIn();
  assert.equal(controller.state.session, null);
  assert.equal(controller.state.busy, null);
  assert.equal(controller.state.status.tone, 'error');
});

test('run carries prompt and input separately, with model and supported effort', async () => {
  const { controller, calls } = fixture({ signedIn: true });
  await controller.start();
  controller.setValue('prompt', 'Use exactly {{input}} literally.');
  await controller.run();
  assert.equal(calls[0].prompt, 'Use exactly {{input}} literally.');
  assert.equal(calls[0].input, 'Test input');
  assert.equal(calls[0].model, 'reasoning');
  assert.equal(calls[0].thinkingEffort, 'high');
  assert.equal(controller.state.result, 'A real adapter response.');
});

test('model changes clear stale output and omit unsupported thinking effort', async () => {
  const { controller, calls } = fixture({ signedIn: true });
  await controller.start();
  await controller.run();
  controller.setModel('standard');
  assert.equal(controller.state.result, null);
  assert.equal(controller.state.thinkingEffort, '');
  await controller.run();
  assert.equal(Object.hasOwn(calls[1], 'thinkingEffort'), false);
  controller.setEffort('high');
  assert.equal(controller.state.thinkingEffort, '');
});

test('editing during a run aborts and discards a late response even when transport ignores cancellation', async () => {
  const pending = deferred();
  let request;
  const { controller } = fixture({ signedIn: true, async run(value) { request = value; return pending.promise; } });
  await controller.start();
  const running = controller.run();
  await Promise.resolve();
  controller.setValue('input', 'New input');
  assert.equal(request.signal.aborted, true);
  pending.resolve({ text: 'Stale result' });
  await running;
  assert.equal(controller.state.result, null);
  assert.equal(controller.state.status.tone, 'warning');
  assert.equal(controller.ready, true);
});

test('cancel ignores late responses and permits another run', async () => {
  const pending = deferred();
  const { controller } = fixture({ signedIn: true, run: () => pending.promise });
  await controller.start();
  const running = controller.run();
  controller.cancel();
  pending.resolve({ text: 'Late' });
  await running;
  assert.equal(controller.state.result, null);
  assert.equal(controller.ready, true);
  assert.match(controller.state.status.message, /canceled/);
});

test('each run checks session expiry before invoking the provider', async () => {
  const { controller, calls, setSession } = fixture({ signedIn: true });
  await controller.start();
  setSession({ ...account, expiresAt: Date.now() - 100 });
  await controller.run();
  assert.equal(calls.length, 0);
  assert.equal(controller.state.session, null);
  assert.equal(controller.state.models.length, 0);
  assert.match(controller.state.status.message, /expired/);
});

test('provider session expiry also clears connection and model controls', async () => {
  const { controller } = fixture({ signedIn: true, run: async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); } });
  await controller.start();
  await controller.run();
  assert.equal(controller.state.session, null);
  assert.equal(controller.state.model, '');
  assert.equal(controller.state.status.tone, 'warning');
});

test('sign-out during a run clears output and discards the response', async () => {
  const pending = deferred();
  const { controller } = fixture({ signedIn: true, run: () => pending.promise });
  await controller.start();
  const running = controller.run();
  await Promise.resolve();
  await controller.signOut();
  pending.resolve({ text: 'Private result' });
  await running;
  assert.equal(controller.state.session, null);
  assert.equal(controller.state.result, null);
  assert.equal(controller.ready, false);
});

test('unsuccessful sign-out does not falsely claim a disconnected account', async () => {
  const { controller } = fixture({ signedIn: true, async signOut() {} });
  await controller.start();
  await controller.signOut();
  assert.equal(controller.state.session.user.name, 'Test account');
  assert.equal(controller.state.status.tone, 'error');
});

test('empty input is validated before calling the backend', async () => {
  const { controller, calls } = fixture({ signedIn: true });
  await controller.start();
  controller.setValue('input', '   ');
  await controller.run();
  assert.equal(calls.length, 0);
  assert.match(controller.state.status.message, /Add test input/);
});

test('fixed fields cannot be overwritten and variants do not share mutable state', () => {
  const { controller } = fixture({ definition: fixedPromptAgent });
  const original = controller.state.definition.prompt.value;
  controller.setValue('prompt', 'Overwrite');
  assert.equal(controller.state.definition.prompt.value, original);
  const { controller: other } = fixture({ definition: fixedInputAgent });
  other.setValue('input', 'Overwrite');
  assert.equal(other.state.definition.input.value, fixedInputAgent.input.value);
  assert.equal(fixedPromptAgent.input.value, '');
});

test('settings reject hiding empty required fields and allow fixed populated values', async () => {
  const { controller } = fixture({ definition: { input: { value: '' } } });
  await controller.start();
  assert.equal(controller.configure({ title: 'Agent', promptMode: 'fixed', inputMode: 'hidden' }), false);
  controller.setValue('input', 'Fixed content');
  assert.equal(controller.configure({ title: 'Agent', promptMode: 'fixed', inputMode: 'hidden' }), true);
  assert.equal(controller.state.definition.input.visible, false);
  assert.equal(controller.state.definition.prompt.editable, false);
});

test('API agent can run without model discovery and render structured data', async () => {
  let received;
  const { controller } = fixture({ signedIn: true,
    definition: { ...apiResultAgent, input: { ...apiResultAgent.input, value: 'Lookup' } },
    getModels: undefined,
    async run(request) { received = request; return { data: { matched: true, count: 2 } }; },
  });
  await controller.start();
  await controller.run();
  assert.equal(Object.hasOwn(received, 'model'), false);
  assert.equal(Object.hasOwn(received, 'thinkingEffort'), false);
  assert.deepEqual(JSON.parse(controller.state.result), { matched: true, count: 2 });
});

test('model discovery failure preserves verified identity and can be retried', async () => {
  let fail = true;
  const { controller } = fixture({ signedIn: true, async getModels() {
    if (fail) throw new Error('Model service unavailable');
    return modelList;
  } });
  await controller.start();
  assert.equal(controller.state.session.user.name, 'Test account');
  assert.equal(controller.ready, false);
  fail = false;
  await controller.reloadModels();
  assert.equal(controller.ready, true);
});

test('no models disables runs, and invalid model ids cannot be selected', async () => {
  const { controller } = fixture({ signedIn: true, async getModels() { return []; } });
  await controller.start();
  assert.equal(controller.ready, false);
  controller.setModel('unknown');
  assert.equal(controller.state.model, '');
  assert.equal(controller.state.status.tone, 'warning');
});

test('provider failures stay in the shared status and result is not an error dump', async () => {
  const { controller } = fixture({ signedIn: true, async run() { throw new Error('Test service offline.'); } });
  await controller.start();
  await controller.run();
  assert.equal(controller.state.result, null);
  assert.equal(controller.state.status.message, 'Test service offline.');
  assert.equal(controller.ready, true);
});

test('destroy suppresses late authentication results and removes listeners', async () => {
  const pending = deferred();
  const { controller } = fixture({ getSession: () => pending.promise });
  let updates = 0;
  controller.subscribe(() => ++updates);
  const starting = controller.start();
  controller.destroy();
  const count = updates;
  pending.resolve(account);
  await starting;
  assert.equal(updates, count);
  assert.equal(controller.state.session, null);
});

test('configurations and outputs reject unusable values', () => {
  assert.throws(() => defineAgent({ input: { visible: false, editable: true } }));
  assert.throws(() => formatResult({ wrong: true }));
  assert.throws(() => formatResult({ data: undefined }));
  assert.equal(formatResult({ text: '<script>danger()</script>' }), '<script>danger()</script>');
});
