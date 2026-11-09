import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/workspace-shortcut-keys.js';
import { createWorkspaceShortcuts } from '../src/workspace-shortcuts.mjs';

const keys = globalThis.AiAgentWorkspaceKeys;
const event = extra => ({ isTrusted: true, ctrlKey: true, key: 'Enter', ...extra });

test('sidebar shortcut chords map to the requested actions without claiming unrelated combinations', () => {
  assert.deepEqual(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].map(key => keys.action(event({key}))),
    ['view.studio','view.chat','tab.previous','tab.next','queue.add']);
  for (const extra of [{isTrusted:false},{ctrlKey:false},{altKey:true},{metaKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{keyCode:229},{key:'Escape'}]) {
    assert.equal(keys.action(event(extra)), null, JSON.stringify(extra));
  }
});

test('shortcut actions share existing buttons, preserve disabled guards, and respect modal and settings scope', () => {
  const calls = [];
  let modal = null;
  const controls = Object.fromEntries(['studio-view','chat-view',...keys.bindings.map(binding => binding.target),'chatgpt-frame'].map(id => [id, {
    hidden: id === 'studio-view', disabled:false, title:'', textContent:id,
    setAttribute() {}, focus() {calls.push(`focus:${id}`);}, click() {calls.push(`click:${id}`);}
  }]));
  const root = {getElementById:id=>controls[id], querySelector:selector=>selector==='dialog[open]' ? modal : controls[selector.slice(1)]};
  const listeners = new Map();
  const events = {addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:type=>listeners.delete(type)};
  const shortcuts = createWorkspaceShortcuts({root,events,selectView:id=>{calls.push(`view:${id}`);controls['studio-view'].hidden=id!=='studio';controls['chat-view'].hidden=id!=='chat';},selectJob:()=>calls.push('job')});
  assert.equal(shortcuts.run('queue.add'), true);
  assert.deepEqual(calls, ['view:studio','job','click:add-request']);
  calls.length = 0; controls['add-request'].disabled = true;
  shortcuts.run('queue.add'); assert.deepEqual(calls, []);
  shortcuts.run('tab.next'); assert.deepEqual(calls, ['click:next-job']);
  calls.length = 0; modal = {};
  assert.equal(shortcuts.run('queue.add'), false);
  assert.equal(shortcuts.run('view.chat'), false);
  assert.deepEqual(calls, []);
  modal = null; controls['studio-view'].hidden = controls['chat-view'].hidden = true;
  assert.equal(shortcuts.run('queue.add'), false);
  assert.equal(shortcuts.run('view.chat'), true);
  shortcuts.dispose(); assert.equal(listeners.size, 0);
});
