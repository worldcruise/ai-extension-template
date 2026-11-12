import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_SETTINGS_KEY, normalizeDocumentSettings, readDocumentSettings, createDocumentSettings } from '../src/document-settings.mjs';

const defaults = { includeCoverLetter:true, autoDownload:true, autoPreview:true, formats:['pdf'] };
function eventSource() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) { const list = listeners.get(name) || new Set(); list.add(fn); listeners.set(name, list); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name, value = {}) { for (const fn of listeners.get(name) || []) fn(value); }
  };
}
function fixture(stored, { failRead = false } = {}) {
  const nodes = Object.fromEntries(['document-settings-form','document-settings-status','document-include-cover-letter','document-auto-download','document-auto-preview','document-format-pdf','document-format-docx','document-format-json']
    .map(id => [id, { ...eventSource(), checked:false, disabled:false, textContent:'' }]));
  const root = { querySelector: selector => nodes[selector.slice(1)] }, events = eventSource(), changed = new Set(), writes = [];
  let value = stored, readError = failRead, saveError = false;
  const publish = next => { value = structuredClone(next); for (const fn of changed) fn({ [DOCUMENT_SETTINGS_KEY]:{ newValue:next } }, 'local'); };
  const browser = { storage: { local: {
    async get() { if (readError) throw Error('Read failed'); return { [DOCUMENT_SETTINGS_KEY]:structuredClone(value) }; },
    async set(next) { if (saveError) throw Error('Write failed'); writes.push(structuredClone(next[DOCUMENT_SETTINGS_KEY])); publish(next[DOCUMENT_SETTINGS_KEY]); }
  }, onChanged: { addListener: fn => changed.add(fn), removeListener: fn => changed.delete(fn) } } };
  const ui = createDocumentSettings({ browser, root, events });
  const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
  return { browser, nodes, ui, writes, publish, changed, flush, value: () => value,
    failRead: () => { readError = true; }, failSave: () => { saveError = true; },
    toggle(id, checked) { nodes[id].checked = checked; nodes['document-settings-form'].fire('change'); }
  };
}

test('all document options default on and only explicit false opts out', async () => {
  assert.deepEqual(normalizeDocumentSettings(), defaults);
  assert.deepEqual(normalizeDocumentSettings({ includeCoverLetter:false, autoDownload:0, autoPreview:null, extra:true }), { ...defaults, includeCoverLetter:false });
  const f = fixture(); await f.ui.ready;
  assert.deepEqual(await readDocumentSettings(f.browser), defaults);
  for (const id of ['document-include-cover-letter','document-auto-download','document-auto-preview']) assert.equal(f.nodes[id].checked, true);
  assert.equal(f.nodes['document-auto-preview'].disabled, false);
  assert.equal(f.nodes['document-format-pdf'].checked, true);
  assert.equal(f.nodes['document-format-pdf'].disabled, true, 'the last selected format cannot be deselected');
  assert.equal(f.writes.length, 0, 'opening Settings does not overwrite existing preferences');
  f.ui.dispose();
});

test('multiple download formats persist, normalize safely, and stay selected when downloads are disabled', async () => {
  assert.deepEqual(normalizeDocumentSettings({ formats:['json','docx','unknown','json'] }).formats, ['docx','json']);
  for (const formats of [undefined, [], ['unknown'], 'pdf']) assert.deepEqual(normalizeDocumentSettings({ formats }).formats, ['pdf']);
  const f = fixture(); await f.ui.ready;
  f.toggle('document-format-docx', true); await f.flush();
  assert.equal(f.nodes['document-format-pdf'].disabled, false);
  f.toggle('document-format-json', true); await f.flush();
  assert.deepEqual(f.value().formats, ['pdf','docx','json']);
  f.toggle('document-auto-download', false); await f.flush();
  for (const format of ['pdf','docx','json']) {
    assert.equal(f.nodes['document-format-' + format].disabled, true);
    assert.equal(f.nodes['document-format-' + format].checked, true);
  }
  f.toggle('document-auto-download', true); await f.flush();
  assert.deepEqual(f.value().formats, ['pdf','docx','json']);
  f.ui.dispose();
});

test('auto preview follows download availability without losing the saved preference', async () => {
  const f = fixture({ ...defaults, autoPreview:false }); await f.ui.ready;
  f.toggle('document-auto-download', false); await f.flush();
  assert.equal(f.nodes['document-auto-preview'].disabled, true);
  assert.equal(f.nodes['document-auto-preview'].checked, false);
  assert.deepEqual(f.value(), { ...defaults, autoDownload:false, autoPreview:false });
  f.toggle('document-auto-download', true); await f.flush();
  assert.equal(f.nodes['document-auto-preview'].disabled, false);
  assert.equal(f.nodes['document-auto-preview'].checked, false);
  const reopened = fixture(f.value()); await reopened.ui.ready;
  assert.equal(reopened.nodes['document-auto-preview'].checked, false);
  f.ui.dispose(); reopened.ui.dispose();
});

test('rapid changes persist in order and external changes update open settings', async () => {
  const f = fixture(); await f.ui.ready;
  f.toggle('document-include-cover-letter', false);
  f.toggle('document-auto-download', false);
  f.toggle('document-auto-download', true);
  await f.flush();
  assert.deepEqual(f.value(), { ...defaults, includeCoverLetter:false });
  assert.equal(f.writes.length, 3);
  f.publish({ ...defaults, autoDownload:false });
  assert.equal(f.nodes['document-include-cover-letter'].checked, true);
  assert.equal(f.nodes['document-auto-preview'].disabled, true);
  f.ui.dispose(); assert.equal(f.changed.size, 0);
});

test('storage failures are reported without claiming settings were saved', async () => {
  const f = fixture(); await f.ui.ready; f.failSave();
  f.toggle('document-auto-download', false); await f.flush();
  assert.match(f.nodes['document-settings-status'].textContent, /Could not save/);
  assert.equal(f.nodes['document-settings-form'].inert, false);
  f.ui.dispose();
  const bad = fixture(undefined, { failRead:true });
  await assert.rejects(readDocumentSettings(bad.browser), /Read failed/);
  await bad.ui.ready;
  assert.match(bad.nodes['document-settings-status'].textContent, /Could not load/);
  assert.equal(bad.nodes['document-settings-form'].inert, false);
  bad.ui.dispose();
});
