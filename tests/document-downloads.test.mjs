import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentDownloads } from '../src/document-downloads.mjs';
import { exampleProfile } from '../src/resume-data.mjs';

const artifact = (kind = 'resume', format = 'pdf') => ({ kind, format, filename: `${kind}.${format}`,
  mime: format === 'pdf' ? 'application/pdf' : 'application/json', bytes: new Uint8Array([0, 1, 127, 128, 255]), previewText: 'Exact exported content' });
function fixture({ documentSettings = {}, phase = 'complete', exported = { files: [artifact()], errors: [] }, saveError } = {}) {
  let state = { runs: [{ id: 'run-1', jobId: 'job-1', phase, documentSettings,
    result: { resume: { company: 'Example' }, coverLetter: 'Letter' }, job: { id: 'job-1', input: { profile: { name: 'Taylor' }, job: { company: 'Example' } } } }] };
  const store = { read: async () => structuredClone(state), change: async edit => {
    const draft = structuredClone(state), value = edit(draft); state = structuredClone(draft);
    return { state: structuredClone(state), value: structuredClone(value) };
  } };
  const fileMap = new Map(), files = { get: async key => structuredClone(fileMap.get(key)), put: async file => { fileMap.set(file.key, structuredClone(file)); } };
  const listeners = new Set(), downloaded = new Map(), calls = { export: [], downloads: [], previews: [], notifications: [], saves: [] };
  let nextId = 10, clock = 1000, completionBeforeAck = false;
  const browser = {
    runtime: { getURL: path => 'chrome-extension://test/' + path, sendMessage: async message => { calls.notifications.push(message); } },
    storage: { local: { get: async () => ({ documentSettings }) } },
    tabs: { create: async options => { calls.previews.push(options); return { id: calls.previews.length }; } },
    downloads: {
      download: async options => { calls.downloads.push(options); const id = nextId++; downloaded.set(id, { id, state: completionBeforeAck ? 'complete' : 'in_progress' }); return id; },
      search: async ({ id }) => downloaded.has(id) ? [structuredClone(downloaded.get(id))] : [],
      onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
    }
  };
  let exporter = async () => structuredClone(exported);
  const options = { browser, store, files, now: () => ++clock,
    saveGenerated: async run => { calls.saves.push(structuredClone(run)); if (saveError) throw new Error(saveError); },
    exportFiles: async (run, options) => { calls.export.push(structuredClone(run)); return exporter(run, options); } };
  const manager = createDocumentDownloads(options);
  const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
  const finish = async (id, error) => {
    downloaded.set(id, { id, state: error ? 'interrupted' : 'complete', ...(error ? { error } : {}) });
    for (const fn of listeners) fn({ id, state: { current: error ? 'interrupted' : 'complete' } });
    await flush();
  };
  return { manager, options, browser, store, files, fileMap, calls, downloaded, listeners, flush, finish,
    read: async () => (await store.read()).runs[0], exporter: fn => { exporter = fn; }, completeBeforeAck: () => { completionBeforeAck = true; } };
}

test('automatic downloads honor disabled settings and never export invalid generations', async () => {
  const off = fixture({ documentSettings: { autoDownload: false } });
  await off.manager.start('run-1'); await off.manager.start('run-1');
  assert.equal((await off.read()).downloads.state, 'skipped'); assert.equal(off.calls.export.length, 0);
  assert.equal(off.calls.downloads.length, 0); assert.equal(off.calls.previews.length, 0); assert.equal(off.calls.saves.length, 0); off.manager.dispose();
  for (const phase of ['invalid', 'generating', 'stopped']) {
    const f = fixture({ phase }); await f.manager.start('run-1');
    assert.equal((await f.read()).downloads, undefined); assert.equal(f.calls.export.length, 0); assert.equal(f.calls.saves.length, 0); f.manager.dispose();
  }
});

test('simultaneous completion notifications export and download once', async () => {
  const f = fixture(); let release;
  f.exporter(() => new Promise(resolve => { release = resolve; }));
  const first = f.manager.start('run-1'), second = f.manager.start({ id: 'run-1' });
  await f.flush(); assert.equal(f.calls.export.length, 1); assert.equal(f.calls.saves.length, 1);
  assert.ok((await f.read()).downloads.savedAt, 'documents are saved before export/download starts');
  release({ files: [artifact()], errors: [] }); await Promise.all([first, second]);
  await f.manager.start('run-1');
  assert.equal(f.calls.saves.length, 1, 'repeated completion does not save twice');
  assert.equal(f.calls.downloads.length, 1); assert.equal((await f.read()).downloads.state, 'downloading');
  assert.equal(f.calls.downloads[0].saveAs, false); assert.equal(f.calls.downloads[0].conflictAction, 'uniquify');
  assert.deepEqual(new Uint8Array(Buffer.from(f.calls.downloads[0].url.split(',')[1], 'base64')), artifact().bytes);
  f.manager.dispose();
});

test('completion opens exactly one preview backed by the exact downloaded bytes', async () => {
  const f = fixture(); await f.manager.start('run-1');
  let run = await f.read(), item = run.downloads.files[0];
  assert.equal(f.calls.previews.length, 0, 'never preview a partial download');
  await Promise.all([f.finish(item.downloadId), f.finish(item.downloadId)]); await f.manager.reconnect();
  run = await f.read(); assert.equal(run.phase, 'complete'); assert.equal(run.downloads.state, 'complete');
  assert.equal(f.calls.previews.length, 1); assert.equal(run.downloads.files[0].previewOpened, true);
  const key = new URL(f.calls.previews[0].url).searchParams.get('file');
  const cached = await f.files.get(key);
  assert.equal(cached.downloadId, item.downloadId); assert.equal(cached.state, 'complete');
  assert.deepEqual(cached.bytes, artifact().bytes); assert.equal(cached.previewText, artifact().previewText);
  f.manager.dispose(); assert.equal(f.listeners.size, 0);
});

test('completion before download acknowledgment is observed and auto preview can be disabled', async () => {
  for (const autoPreview of [true, false]) {
    const f = fixture({ documentSettings: { autoPreview } }); f.completeBeforeAck();
    await f.manager.start('run-1');
    assert.equal((await f.read()).downloads.state, 'complete');
    assert.equal(f.calls.previews.length, Number(autoPreview)); f.manager.dispose();
  }
});

test('interrupted and rejected downloads preserve captured results and permit manual retry', async () => {
  const f = fixture(); const savedResult = (await f.read()).result;
  await f.manager.start('run-1'); const item = (await f.read()).downloads.files[0];
  await f.finish(item.downloadId, 'NETWORK_FAILED');
  let run = await f.read(); assert.equal(run.phase, 'complete'); assert.deepEqual(run.result, savedResult);
  assert.equal(run.downloads.state, 'failed'); assert.equal(run.downloads.files[0].error, 'NETWORK_FAILED');
  assert.equal(f.calls.previews.length, 0);
  f.completeBeforeAck(); await f.manager.start('run-1', { manual: true });
  assert.equal(f.calls.saves.length, 1, 'retrying a failed download does not overwrite saved documents');
  assert.equal(f.calls.downloads.length, 2); assert.equal((await f.read()).downloads.state, 'complete'); f.manager.dispose();
  const rejected = fixture(); rejected.browser.downloads.download = async () => { throw new Error('Disk full'); };
  await rejected.manager.start('run-1');
  run = await rejected.read(); assert.equal(run.phase, 'complete'); assert.equal(run.downloads.state, 'failed');
  assert.match(run.downloads.errors[0].message, /Disk full/); rejected.manager.dispose();
});

test('partial export failures download successful formats without marking generation invalid', async () => {
  const f = fixture({ exported: { files: [artifact('resume', 'json')], errors: [{ kind: 'resume', format: 'pdf', message: 'Unsupported font glyph' }] } });
  f.completeBeforeAck(); await f.manager.start('run-1');
  const run = await f.read(); assert.equal(run.phase, 'complete'); assert.equal(run.downloads.state, 'partial');
  assert.equal(f.calls.downloads.length, 1); assert.equal(run.downloads.files[0].format, 'json');
  assert.match(run.downloads.errors[0].message, /glyph/); f.manager.dispose();
});

test('worker reconnect reconciles existing downloads without exporting or downloading again', async () => {
  const f = fixture(); await f.manager.start('run-1'); const item = (await f.read()).downloads.files[0];
  f.manager.dispose(); f.downloaded.set(item.downloadId, { id: item.downloadId, state: 'complete' });
  const resumed = createDocumentDownloads(f.options); await resumed.reconnect(); await resumed.reconnect(); await resumed.start('run-1');
  assert.equal(f.calls.export.length, 1); assert.equal(f.calls.downloads.length, 1); assert.equal(f.calls.previews.length, 1);
  assert.equal((await f.read()).downloads.state, 'complete'); resumed.dispose();
});

test('an interrupted worker export is retryable without automatic duplicate downloads', async () => {
  const f = fixture();
  await f.store.change(state => { state.runs[0].downloads = { state: 'starting', startedAt: 2, autoPreview: true, formats: ['pdf'], files: [], errors: [], queued: false }; });
  await f.manager.reconnect(); await f.manager.start('run-1');
  assert.equal((await f.read()).downloads.state, 'failed'); assert.equal(f.calls.downloads.length, 0);
  assert.match((await f.read()).downloads.errors[0].message, /interrupted/);
  f.completeBeforeAck(); await f.manager.start('run-1', { manual: true });
  assert.equal((await f.read()).downloads.state, 'complete'); assert.equal(f.calls.downloads.length, 1); f.manager.dispose();
});

test('preview opening errors leave accurate partial download metadata', async () => {
  const f = fixture(); await f.manager.start('run-1');
  f.browser.tabs.create = async () => { throw new Error('Window unavailable'); };
  await f.finish((await f.read()).downloads.files[0].downloadId);
  const run = await f.read(); assert.equal(run.phase, 'complete');
  assert.equal(run.downloads.state, 'partial'); assert.match(run.downloads.errors[0].message, /preview could not open/);
  f.manager.dispose();
});

test('download status failures are retryable rather than permanently downloading', async () => {
  const f = fixture(); f.browser.downloads.search = async () => { throw new Error('Download status unavailable'); };
  await f.manager.start('run-1');
  const run = await f.read(); assert.equal(run.phase, 'complete'); assert.equal(run.downloads.state, 'failed');
  assert.match(run.downloads.files[0].error, /Download status unavailable/);
  f.manager.dispose();
});

test('manual retry uses current download preferences but preserves the run cover-letter choice', async () => {
  const settings = { includeCoverLetter: false, autoDownload: false, formats: ['pdf'] }, f = fixture({ documentSettings: settings });
  await f.manager.start('run-1');
  Object.assign(settings, { includeCoverLetter: true, formats: ['json'], autoPreview: false });
  await f.manager.start('run-1', { manual: true });
  assert.equal(f.calls.export.length, 1);
  assert.equal(f.calls.export[0].documentSettings.includeCoverLetter, false);
  assert.equal(f.calls.saves.length, 0, 'manual download with Auto download off does not approve documents');
  assert.deepEqual(f.calls.export[0].documentSettings.formats, ['json']);
  assert.equal((await f.read()).downloads.autoPreview, false); f.manager.dispose();
});

test('a missing cached file reports a retryable failure rather than remaining downloading', async () => {
  const f = fixture(); await f.manager.start('run-1'); const item = (await f.read()).downloads.files[0];
  f.fileMap.delete(item.key); await f.finish(item.downloadId);
  const run = await f.read(); assert.equal(run.phase, 'complete'); assert.equal(run.downloads.state, 'failed');
  assert.match(run.downloads.files[0].error, /cached|stored|unavailable/i); assert.equal(f.calls.previews.length, 0); f.manager.dispose();
});

test('failed automatic saves preserve the captured result and prevent export/download until review', async () => {
  const f = fixture({saveError:'This job changed in another view.'}), original = (await f.read()).result;
  await f.manager.start('run-1');
  const run = await f.read();
  assert.equal(run.phase, 'complete'); assert.deepEqual(run.result, original);
  assert.equal(run.downloads.state, 'failed'); assert.equal(run.downloads.autoSave, true);
  assert.equal(run.downloads.savedAt, undefined);
  assert.match(run.downloads.errors[0].message, /auto-save.*changed in another view.*Review documents/);
  assert.equal(f.calls.export.length, 0); assert.equal(f.calls.downloads.length, 0); f.manager.dispose();
});

test('retry after interrupted auto-save preserves the save requirement and saves before downloading', async () => {
  const f = fixture();
  await f.store.change(state => {state.runs[0].downloads = {state:'starting',autoSave:true,startedAt:2,files:[],errors:[],queued:false};});
  await f.manager.reconnect();
  f.completeBeforeAck(); await f.manager.start('run-1', {manual:true});
  assert.equal(f.calls.saves.length, 1); assert.ok((await f.read()).downloads.savedAt);
  assert.equal((await f.read()).downloads.state, 'complete'); f.manager.dispose();
});

test('document icons download the current saved document without changing job data or generating AI', async () => {
  const f=fixture({documentSettings:{formats:['json'],autoDownload:false,autoPreview:false}});f.manager.dispose();
  const job={id:'job-1',state:'ready',updatedAt:42,input:{candidateId:'candidate',profile:exampleProfile,job:{company:'Edited Employer',role:'Engineer'}},
    resume:{company:'Edited Employer',title:exampleProfile.role,summary:'My latest manual revision.',skills:[{Skills:exampleProfile.skills}],experience:exampleProfile.experience,education:exampleProfile.education},coverLetter:'My edited cover letter.',coverLetterEnabled:true};
  const manager=createDocumentDownloads({...f.options,jobs:{read:async()=>({requests:[structuredClone(job)]})},uuid:()=>String(f.calls.export.length)});
  f.exporter(async(run,options)=>{
    assert.equal(run.result.resume.summary,'My latest manual revision.');assert.equal(run.result.coverLetter,'My edited cover letter.');
    assert.deepEqual(run.documentSettings.formats,['json']);
    assert.equal(options.kinds.length,1);
    return {files:[artifact(options.kinds[0],'json')],errors:[]};
  });
  for(const kind of ['resume','cover-letter']) await manager.startSaved('job-1',kind);
  assert.equal(f.calls.downloads.length,2);assert.equal(f.calls.saves.length,0);assert.equal(job.updatedAt,42);
  assert.equal((await f.store.read()).runs.filter(run=>run.kind==='document-export').length,2);
  job.documentsStale=true;await assert.rejects(manager.startSaved('job-1','resume'),/current documents/);
  await assert.rejects(manager.startSaved('job-1','other'),/resume or cover letter/);
  manager.dispose();
});
