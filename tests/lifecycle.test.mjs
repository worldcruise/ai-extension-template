import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentController } from '../src/controller.mjs';

const A = { authenticated: true, user: { id: 'account-A', name: 'Identical name' } };
const B = { authenticated: true, user: { id: 'account-B', name: 'Identical name' } };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup() {
  let session = A;
  const calls = [], hooks = {};
  const adapter = {
    async getSession() { if (hooks.session) return hooks.session(); return session; },
    async signIn() { if (hooks.signIn) return hooks.signIn(); session = A; },
    async signOut() { if (hooks.signOut) return hooks.signOut(); session = null; },
    async getModels(request) { if (hooks.models) return hooks.models(request); return [{ id: 'shared-model', thinkingEfforts: session.user.id === A.user.id ? ['low', 'high'] : ['medium'], defaultThinkingEffort: session.user.id === A.user.id ? 'high' : 'medium' }]; },
    async run(request) { calls.push(request); if (hooks.run) return hooks.run(request); return { data: { reviewed: true } }; },
  };
  const controller = new AgentController({ definition: { input: { value: 'Input' } }, adapter });
  return { controller, calls, hooks, setSession(value) { session = value; } };
}
function disconnected(c) {
  assert.equal(c.state.session, null); assert.deepEqual(c.state.models, []);
  assert.equal(c.state.model, ''); assert.equal(c.state.thinkingEffort, '');
  assert.equal(c.state.result, null); assert.equal(c.state.output, null); assert.equal(c.state.busy, null);
}
for (const failure of [{ status: 401 }, { code: 'SESSION_EXPIRED' }]) {
  for (const operation of ['initial-session', 'session-check', 'run-session', 'initial-models', 'reload', 'inference', 'sign-out', 'sign-out-check']) {
    test(`${JSON.stringify(failure)} clears all session state during ${operation}`, async () => {
      const { controller: c, hooks } = setup();
      const reject = async () => { throw Object.assign(new Error('Expired'), failure); };
      if (operation === 'initial-session') { hooks.session = reject; await c.start(); }
      else if (operation === 'initial-models') { hooks.models = reject; await c.start(); }
      else {
        await c.start(); await c.run(); assert.notEqual(c.state.result, null);
        if (operation === 'session-check') { hooks.session = reject; await c.refreshSession(); }
        if (operation === 'run-session') { hooks.session = reject; await c.run(); }
        if (operation === 'reload') { hooks.models = reject; await c.reloadModels(); }
        if (operation === 'inference') { hooks.run = reject; await c.run(); }
        if (operation === 'sign-out') { hooks.signOut = reject; await c.signOut(); }
        if (operation === 'sign-out-check') { hooks.session = reject; await c.signOut(); }
      }
      disconnected(c);
    });
  }
}
for (const failure of [{ status: 403 }, { code: 'agent_connection_error' }]) {
  for (const operation of ['session', 'models', 'run', 'signOut']) test(`ordinary ${JSON.stringify(failure)} preserves identity during ${operation}`, async () => {
    const { controller: c, hooks } = setup(); await c.start();
    hooks[operation] = async () => { throw Object.assign(new Error('Unavailable'), failure); };
    await (operation === 'session' ? c.refreshSession() : operation === 'models' ? c.reloadModels() : operation === 'run' ? c.run() : c.signOut());
    assert.equal(c.state.session.user.id, A.user.id); assert.equal(c.state.model, 'shared-model'); assert.equal(c.state.busy, null);
  });
}
test('same name and same model id do not reuse another account’s effort; switching Go never infers', async () => {
  const f = setup(), c = f.controller; await c.start(); await c.run();
  assert.equal(f.calls[0].thinkingEffort, 'high');
  f.setSession(B); await c.run();
  assert.equal(f.calls.length, 1); assert.equal(c.state.result, null);
  assert.equal(c.state.session.user.id, B.user.id); assert.equal(c.state.thinkingEffort, 'medium');
  await c.run(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].accountId, B.user.id); assert.equal(f.calls[1].thinkingEffort, 'medium');
});
for (const late of ['response', '401']) test(`account switch ignores superseded inference ${late}`, async () => {
  const f = setup(), c = f.controller; await c.start();
  const pending = deferred(); f.hooks.run = () => pending.promise;
  const running = c.run(); await Promise.resolve();
  f.setSession(B); await c.refreshSession();
  assert.equal(f.calls[0].signal.aborted, true);
  if (late === '401') pending.reject(Object.assign(new Error('A expired'), { status: 401 })); else pending.resolve('A output');
  await running; assert.equal(c.state.session.user.id, B.user.id); assert.equal(c.state.result, null); assert.equal(c.state.thinkingEffort, 'medium');
});
test('old model failures after reinitialization cannot expire the new account', async () => {
  const f = setup(), c = f.controller, pending = deferred();
  f.hooks.models = () => pending.promise; const starting = c.start(); await Promise.resolve();
  f.setSession(B); delete f.hooks.models; await c.start();
  pending.reject(Object.assign(new Error('A expired'), { code: 'SESSION_EXPIRED' })); await starting;
  assert.equal(c.state.session.user.id, B.user.id); assert.equal(c.state.thinkingEffort, 'medium');
});
test('context changes, cancellation, and repeated Go cannot accept late output', async () => {
  const f = setup(), c = f.controller; await c.start(); const pending = deferred(); f.hooks.run = () => pending.promise;
  const running = c.run(); await Promise.resolve(); await c.run(); assert.equal(f.calls.length, 1);
  c.setContext('candidate-B'); pending.resolve('Old candidate'); await running;
  assert.equal(c.state.result, null); assert.equal(f.calls[0].signal.aborted, true);
});
test('a display name without stable identity cannot establish a session', async () => {
  const f = setup(); f.setSession({ authenticated: true, user: { name: A.user.name } }); await f.controller.start();
  disconnected(f.controller); assert.match(f.controller.state.status.message, /stable account id/);
});
for (const operation of ['session','signOut']) test(`late ${operation} expiry cannot clear a newer signed-in account`, async () => {
  const f=setup(),c=f.controller;await c.start();const pending=deferred();f.hooks[operation]=()=>pending.promise;
  const old=operation==='session'?c.refreshSession():c.signOut();await Promise.resolve();
  delete f.hooks[operation];f.setSession(B);await c.start();
  pending.reject(Object.assign(new Error('Old account expired'),{status:401}));await old;
  assert.equal(c.state.session.user.id,B.user.id);assert.equal(c.state.thinkingEffort,'medium');assert.equal(c.state.busy,null);
});
test('an authenticated API agent needs no catalog or model request fields', async () => {
  const f=setup();f.controller.destroy();let request;
  const controller=new AgentController({definition:{modelSelection:false,input:{value:'Lookup'},prompt:{value:'',required:false,visible:false,editable:false}},adapter:{
    getSession:async()=>A,signIn:async()=>{},signOut:async()=>{},run:async value=>{request=value;return {data:{found:1}};},
  }});
  await controller.start();await controller.run();assert.deepEqual(JSON.parse(controller.state.result),{found:1});
  assert.equal(Object.hasOwn(request,'model'),false);assert.equal(Object.hasOwn(request,'thinkingEffort'),false);
});
