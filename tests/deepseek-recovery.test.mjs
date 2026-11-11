import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepseekRecovery } from '../src/deepseek-recovery.mjs';

function setup(online = true) {
  const state = { mounted: true, ready: false, protected: false }, timers = new Map(), calls = [];
  let clock = 0, sequence = 0;
  const recovery = createDeepseekRecovery({ online, getState: () => state,
    probe: () => calls.push('probe'), reconnect: () => calls.push('reconnect'),
    schedule: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, at: clock + delay }); return id; },
    cancel: id => timers.delete(id) });
  return { state, calls, recovery, advance(ms) {
    clock += ms;
    for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
  } };
}

test('DeepSeek probes after internet returns and retries a stuck page only once per outage', () => {
  const f = setup();
  f.recovery.setOnline(false); f.advance(20000);
  assert.deepEqual(f.calls, []);
  assert.equal(f.recovery.offline, true);
  f.recovery.setOnline(true);
  assert.deepEqual(f.calls, ['probe']);
  f.advance(1999); assert.deepEqual(f.calls, ['probe']);
  f.advance(1); assert.deepEqual(f.calls, ['probe', 'reconnect']);
  f.recovery.setOnline(true); f.advance(60000);
  assert.deepEqual(f.calls, ['probe', 'reconnect'], 'no sign-in reload loop or retry on ordinary expansion');
  f.recovery.setOnline(false); f.recovery.setOnline(true); f.advance(2000);
  assert.deepEqual(f.calls, ['probe', 'reconnect', 'probe', 'reconnect']);
});

test('a page that recovers naturally or receives input during the grace period is preserved', () => {
  for (const key of ['ready', 'protected']) {
    const f = setup(false);
    f.recovery.setOnline(true);
    f.state[key] = true;
    f.advance(2000);
    assert.deepEqual(f.calls, ['probe'], key);
    f.state[key] = false; f.advance(30000);
    assert.deepEqual(f.calls, ['probe'], 'clearing input later cannot trigger an unexpected reload');
  }
});

test('internet recovery never initializes an unused DeepSeek provider', () => {
  const f = setup(false); f.state.mounted = false;
  f.recovery.setOnline(true); f.advance(2000);
  assert.deepEqual(f.calls, []);
  f.state.mounted = true; f.advance(30000);
  assert.deepEqual(f.calls, []);
});

test('another outage, explicit reload, or disposal cancels pending automatic recovery', () => {
  for (const stop of [f => f.recovery.setOnline(false), f => f.recovery.stop(), f => f.recovery.dispose()]) {
    const f = setup(false); f.recovery.setOnline(true);
    stop(f); f.advance(2000);
    assert.deepEqual(f.calls, ['probe']);
  }
  const f = setup(); f.recovery.dispose(); f.recovery.setOnline(false); f.recovery.setOnline(true); f.advance(2000);
  assert.deepEqual(f.calls, []);
});
