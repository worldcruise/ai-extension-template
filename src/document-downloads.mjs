import { createGenerationStore } from './generation-store.mjs';
import { createDocumentFileStore } from './document-file-store.mjs';
import { normalizeDocumentSettings, readDocumentSettings } from './document-settings.mjs';
import { exportDocuments } from './document-export.mjs';
import { createJobQueue } from './job-queue.mjs';
import { createQueueStore } from './queue-store.mjs';
import { parseManualResume } from './manual-documents.mjs';
import { openDocumentPreview } from './document-preview-tabs.mjs';

async function saveGeneratedDocuments(run) {
  const queue = createJobQueue();
  try { await queue.saveGeneratedDocuments(run); }
  finally { queue.dispose(); }
}

function dataUrl(file) {
  let binary = '';
  for (let offset = 0; offset < file.bytes.length; offset += 16384) binary += String.fromCharCode(...file.bytes.subarray(offset, offset + 16384));
  return `data:${file.mime};base64,${btoa(binary)}`;
}

export function createDocumentDownloads({ browser = chrome, store = createGenerationStore(),
  files = createDocumentFileStore(), jobs = createQueueStore(), exportFiles = exportDocuments, saveGenerated = saveGeneratedDocuments,
  now = Date.now, uuid = () => crypto.randomUUID(), onChange = () => {} } = {}) {
  const pending = new Map(), updating = new Map();
  const notify = run => { void browser.runtime.sendMessage({ type: 'generation.changed' }).catch(() => {}); void Promise.resolve().then(()=>onChange(run)).catch(() => {}); };
  const read = async id => store.get ? store.get(id) : (await store.read()).runs.find(run => run.id === id);
  async function update(id, edit) {
    const editRun=run=>{if(!run)return null;const change=edit(run.downloads,run);return change?{...run,downloads:change}:run;};
    const { value } = store.update ? await store.update(id,editRun) : await store.change(state => {
      const index = state.runs.findIndex(run => run.id === id);
      if (index < 0) return null;
      return state.runs[index] = editRun(state.runs[index]);
    });
    if(value?.downloads?.state==='complete' && value.downloads.savedAt && typeof jobs.change==='function') {
      try {
        const needsClear=!jobs.getJob || (await jobs.getJob(value.jobId))?.needsAction;
        if(needsClear) {
        const cleared=await jobs.change(state=>{
          const index=state.requests.findIndex(job=>job.id===value.jobId);
          const job=state.requests[index];
          if(!job?.needsAction||job.state==='cancelled'||job.documentsStale||job.documentRunId!==id)return false;
          state.requests[index]={...job,needsAction:false,error:''};return true;
        });
        if(cleared.value && typeof BroadcastChannel==='function'){const channel=new BroadcastChannel('ai-agent-resume-queue');channel.postMessage('changed');channel.close();}
        }
      } catch { /* Preserve completed downloads if queue storage is temporarily unavailable. */ }
    }
    notify(value); return value;
  }
  function overall(delivery) {
    const unsettled = delivery.files.some(file => file.state === 'downloading');
    const failed = delivery.errors.length || delivery.files.some(file => file.state === 'failed');
    return !delivery.queued || unsettled ? 'downloading' : failed
      ? delivery.files.some(file => file.state === 'complete') ? 'partial' : 'failed' : 'complete';
  }
  async function inspect(runId, item) {
    if (!Number.isInteger(item.downloadId)) return;
    if (updating.has(item.downloadId)) return updating.get(item.downloadId);
    const work = (async () => {
      const [download] = await browser.downloads.search({ id: item.downloadId });
      const state = download?.state === 'complete' ? 'complete' : !download || download.state === 'interrupted' ? 'failed' : 'downloading';
      if (state === 'downloading') return;
      const file = await files.get(item.key);
      if (!file || file.downloadId !== item.downloadId) throw new Error('The cached document is unavailable. Use Download files to retry.');
      await files.put({ ...file, state, ...(state === 'failed' ? { error: download?.error || 'Download unavailable.' } : {}) });
      let preview = false;
      const current = await update(runId, delivery => {
        if (!delivery?.files.some(row => row.downloadId === item.downloadId)) return null;
        const rows = delivery.files.map(row => {
          if (row.downloadId !== item.downloadId) return row;
          preview = state === 'complete' && delivery.autoPreview && !row.previewOpened;
          return { ...row, state, error: state === 'failed' ? download?.error || 'Download unavailable.' : '',
            ...(preview ? { previewOpened: true } : {}) };
        });
        const next = { ...delivery, files: rows }; next.state = overall(next); return next;
      });
      if (preview && current) {
        try { await openDocumentPreview(browser,item); }
        catch (error) { await update(runId, delivery => {
          const next = { ...delivery, errors: [...delivery.errors, { message: 'Downloaded, but the preview could not open: ' + error.message }] };
          next.state = overall(next); return next;
        }); }
      }
    })();
    updating.set(item.downloadId, work);
    try { await work; }
    catch (error) {
      await update(runId, delivery => {
        if (!delivery?.files.some(row => row.downloadId === item.downloadId)) return null;
        const next = { ...delivery, files: delivery.files.map(row => row.downloadId === item.downloadId
          ? { ...row, state: 'failed', error: 'Could not confirm the download: ' + (error.message || 'Connection unavailable.') } : row) };
        next.state = overall(next); return next;
      });
    } finally { updating.delete(item.downloadId); }
  }
  async function perform(id, manual) {
    const original = await read(id);
    if (original?.phase !== 'complete' || original.kind === 'job-cleanup' || !original.result) return;
    const settings = manual ? await readDocumentSettings(browser) : normalizeDocumentSettings(original.documentSettings);
    let claimed = false;
    const run = await update(id, (previous, current) => {
      if (current.phase !== 'complete' || previous && !manual || previous && ['starting', 'downloading'].includes(previous.state)) return null;
      claimed = true;
      return { state: !manual && !settings.autoDownload ? 'skipped' : 'starting', startedAt: now(),
        autoPreview: settings.autoPreview, formats: settings.formats, files: [], errors: [], queued: false,
        autoSave: previous?.autoSave === true || !manual && settings.autoDownload,
        ...(previous?.savedAt ? { savedAt: previous.savedAt } : {}) };
    });
    if (!claimed || run.downloads.state === 'skipped') return;
    try {
      if (run.downloads.autoSave && !run.downloads.savedAt) {
        try { await saveGenerated(run); }
        catch (error) { throw new Error('Could not auto-save documents: ' + (error.message || 'Local storage is unavailable.') + ' Use Review documents to save them before retrying the download.'); }
        await update(id, current => ({ ...current, savedAt: now() }));
      }
      const exported = await exportFiles({ ...run, documentSettings: { ...settings,
        includeCoverLetter: normalizeDocumentSettings(run.documentSettings).includeCoverLetter } }, { kinds: run.exportKinds });
      await update(id, current => ({ ...current, state: 'downloading', errors: exported.errors }));
      for (const artifact of exported.files) {
        const key = `${id}/${run.downloads.startedAt}/${artifact.kind}.${artifact.format}`;
        try {
          await files.put({ ...artifact, key, runId: id, state: 'downloading' });
          const downloadId = await browser.downloads.download({ url: dataUrl(artifact), filename: 'AI Agent/' + artifact.filename,
            conflictAction: 'uniquify', saveAs: false });
          if (!Number.isInteger(downloadId)) throw new Error('Chrome did not start the download.');
          await files.put({ ...artifact, key, runId: id, downloadId, state: 'downloading' });
          const item = { key, kind: artifact.kind, format: artifact.format, filename: artifact.filename, downloadId, state: 'downloading' };
          await update(id, current => ({ ...current, files: [...current.files, item] }));
          // Completion can precede the download() acknowledgment and onChanged.
          await inspect(id, item);
        } catch (error) {
          await update(id, current => ({ ...current, errors: [...current.errors, { kind: artifact.kind, format: artifact.format, message: error.message || 'Download failed.' }] }));
        }
      }
      await update(id, current => { const next = { ...current, queued: true }; next.state = overall(next); return next; });
    } catch (error) {
      await update(id, current => ({ ...current, state: 'failed', queued: true, errors: [...current.errors, { message: error.message || 'Could not export documents.' }] }));
    }
  }
  async function start(runOrId, { manual = false } = {}) {
    const id = typeof runOrId === 'string' ? runOrId : runOrId.id;
    if (pending.has(id)) return pending.get(id);
    const task = perform(id, manual); pending.set(id, task);
    try { await task; } finally { pending.delete(id); }
  }
  async function startSaved(jobId, kind) {
    if (!['resume', 'cover-letter'].includes(kind)) throw new Error('Choose a resume or cover letter to download.');
    const job = jobs.getJob ? await jobs.getJob(jobId) : (await jobs.read()).requests.find(job => job.id === jobId);
    if (!job?.resume || job.state==='cancelled' || job.documentsStale) throw new Error('Save current documents for this job before downloading.');
    const resume = parseManualResume(JSON.stringify(job.resume), job);
    const hasLetter = job.coverLetterEnabled && !!job.coverLetter?.trim();
    if (kind === 'cover-letter' && !hasLetter) throw new Error('This job has no saved cover letter.');
    const id = `document-export-${uuid()}`, timestamp = now();
    await store.change(state => state.runs.push({ id, kind: 'document-export', jobId, phase: 'complete', job,
      exportKinds: [kind], result: { resume, coverLetter: hasLetter ? job.coverLetter : '' },
      documentSettings: { includeCoverLetter: !!hasLetter }, createdAt: timestamp, updatedAt: timestamp }));
    await start(id, { manual: true });
    const run = await read(id);
    if (run.downloads?.state === 'failed') throw new Error(run.downloads.errors.map(error => error.message).join(' ') || 'The document could not be downloaded.');
    return run.downloads;
  }
  const onChanged = delta => {
    if (!delta.state && !delta.error) return;
    void (store.summaries ? store.summaries() : store.read().then(state=>state.runs)).then(async runs => {
      for (const run of runs) for (const file of run.downloads?.files || []) if (file.downloadId === delta.id) await inspect(run.id, file);
    }).catch(() => {});
  };
  browser.downloads.onChanged.addListener(onChanged);
  async function reconnect() {
    for (const run of store.summaries ? await store.summaries() : (await store.read()).runs) {
      const delivery = run.downloads;
      if (!delivery || !['starting', 'downloading'].includes(delivery.state) || pending.has(run.id)) continue;
      for (const file of delivery.files) await inspect(run.id, file);
      if (!delivery.queued) await update(run.id, current => {
        const next = { ...current, queued: true, errors: [...current.errors, { message: 'Export was interrupted. Use Download files to try again.' }] };
        next.state = overall(next); return next;
      });
    }
  }
  return { start, startSaved, reconnect, dispose() { browser.downloads.onChanged.removeListener(onChanged); } };
}
