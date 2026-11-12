import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkDocumentDownloadUI({ cdp, panel, targetId, evaluate, until, targets, session, artifacts, workerSession }) {
  let currentPanel = panel, currentTarget = targetId, sequence = 0;
  const ui = expression => evaluate(currentPanel, expression);
  const extension = await ui('chrome.runtime.id'), home = 'https://chat.deepseek.com/';
  const workspaceUrl = `chrome-extension://${extension}/index.html`;
  const previewPrefix = `chrome-extension://${extension}/document-preview.html`;
  await mkdir(artifacts, { recursive:true });
  const folder = await mkdtemp(join(artifacts, 'document-downloads-'));
  await cdp.send('Browser.setDownloadBehavior', { behavior:'allowAndName', downloadPath:folder, eventsEnabled:true });
  const storedRuns = () => evaluate(workerSession, `new Promise((resolve,reject)=>{
    const opening=indexedDB.open('ai-agent-document-runs',1);
    opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('runs'),request=tx.objectStore('runs').getAll();
      tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>{db.close();reject(tx.error)};};
  })`);
  const runFor = async jobId => (await storedRuns()).find(run => run.jobId === jobId);
  const savedJob = jobId => evaluate(workerSession, `new Promise((resolve,reject)=>{
    const opening=indexedDB.open('ai-agent-resume-studio',1);opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('requests'),request=tx.objectStore('requests').get(${JSON.stringify(jobId)});
      tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>{db.close();reject(tx.error)};};
  })`);
  const downloads = () => evaluate(workerSession, 'chrome.downloads.search({})');
  const previews = async () => (await targets()).filter(target => target.type === 'page' && target.url.startsWith(previewPrefix));
  const rpc = (type, args = {}) => ui(`chrome.runtime.sendMessage(${JSON.stringify({type:'generation.'+type,...args})}).then(reply=>{if(!reply.ok)throw Error(reply.error);return reply.value})`);
  const ready = () => until(async () => {
    try { return await ui('document.documentElement.dataset.studioReady==="true"&&!document.getElementById("document-settings-form").inert'); }
    catch { return false; }
  }, 'document settings ready');
  const settings = () => ui(`import(chrome.runtime.getURL('src/document-settings.mjs')).then(m=>m.readDocumentSettings())`);
  const toggle = async (id, checked) => {
    await ui(`(()=>{const input=document.getElementById(${JSON.stringify(id)});if(input.checked!==${checked})input.click()})()`);
    await until(() => ui(`!document.getElementById('document-settings-status').textContent.startsWith('Saving')`), 'document preference saved');
  };
  await ready();
  assert.deepEqual(await settings(), { includeCoverLetter:true, autoDownload:true, autoPreview:true, formats:['pdf'] });
  assert.equal(await ui(`['document-include-cover-letter','document-auto-download','document-auto-preview'].every(id=>document.getElementById(id).checked)`), true);

  const provider = await cdp.send('Target.createTarget', { url:home });
  const providerSession = await session(provider.targetId);
  await until(async () => {
    try { return await evaluate(providerSession, `location.origin==='https://chat.deepseek.com'&&document.readyState==='complete'`); }
    catch { return false; }
  }, 'document fixture provider ready');
  async function generate(mode = 'keyboard', { fromQueue = false } = {}) {
    const company = `Download Fixture ${++sequence}`;
    await evaluate(providerSession, `localStorage.setItem('generationFixtureEnabled','yes');localStorage.setItem('generationFixtureMode',${JSON.stringify(mode)});localStorage.setItem('generationFixtureDelay','2500')`);
    await cdp.send('Page.navigate', { url:`${home}?documents-case=${sequence}` }, providerSession);
    await until(async () => {
      try { return await evaluate(providerSession, `document.body?.dataset.generationFixtureMode===${JSON.stringify(mode)}&&Boolean(document.getElementById('chat-input')?.getClientRects().length)`); }
      catch { return false; }
    }, 'document fixture composer ready');
    const jobId = await ui(`(async()=>{
      const {createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));
      const {exampleProfile}=await import(chrome.runtime.getURL('src/resume-data.mjs'));
      const queue=createJobQueue();await queue.ready;
      const candidate=await queue.importProfile(JSON.stringify(exampleProfile),'Download fixture.json');
      const id=await queue.add({candidateId:candidate,profile:exampleProfile,tailor:true,resumeTemplate:'kakuna',promptTemplate:'focused',
        job:{company:${JSON.stringify(company)},role:'Engineer',url:${JSON.stringify(`https://jobs.example.test/download-${sequence}`)},description:'Build TypeScript services and SQL tools.'}});
      await queue.selectCandidate(candidate);queue.dispose();return id;
    })()`);
    await cdp.send('Page.bringToFront', {}, providerSession);
    if (fromQueue) {
      await ui(`document.getElementById('chat-provider').value='deepseek';document.getElementById('chat-provider').dispatchEvent(new Event('change'))`);
      await until(() => ui('!document.getElementById("chat-provider").disabled'), 'download test provider selected');
      const candidate = await ui(`import(chrome.runtime.getURL('src/queue-store.mjs')).then(m=>m.createQueueStore().read()).then(state=>state.requests.find(job=>job.id===${JSON.stringify(jobId)}).input.candidateId)`);
      await until(() => ui(`Boolean(document.querySelector('#candidate option[value="${candidate}"]'))`), 'download test candidate available');
      await ui(`document.getElementById('candidate').value=${JSON.stringify(candidate)};document.getElementById('candidate').dispatchEvent(new Event('change'));document.getElementById('open-queue').click()`);
      const selector = `[data-request-id="${jobId}"] [data-action="generate"]`;
      await until(() => ui(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), 'download test Generate button ready');
      await ui(`document.querySelector(${JSON.stringify(selector)}).click()`);
    } else await rpc('start', { jobId, provider:'deepseek' });
    await until(async () => {
      const run = await runFor(jobId);
      if (run?.phase === 'attention') throw new Error(`Download fixture submission: ${run.error}`);
      return Boolean(run?.submittedAt);
    }, 'document fixture submitted once');
    return { jobId, company };
  }
  async function capture(job, expected = 'complete') {
    return until(async () => {
      const run = await runFor(job.jobId);
      if (run?.phase === 'attention' || run?.phase === 'invalid' && expected !== 'invalid') throw new Error(`Download fixture capture: ${run.error}`);
      return run?.phase === expected && run;
    }, 'document fixture capture complete', 30000);
  }
  async function finishedFiles(job, count) {
    const run = await until(async () => {
      const run = await runFor(job.jobId);
      if (['failed','partial'].includes(run?.downloads?.state)) throw new Error(`Document export failed: ${JSON.stringify(run.downloads.errors)}`);
      return run?.downloads?.state === 'complete' && run;
    }, 'automatic document download complete', 45000);
    assert.equal(run.downloads.files.length, count);
    const saved = await savedJob(job.jobId);
    assert.ok(run.downloads.savedAt, 'automatic save finishes before downloading');
    assert.equal(saved.state, 'ready'); assert.deepEqual(saved.resume, run.result.resume);
    assert.equal(saved.coverLetter, run.result.coverLetter); assert.equal(saved.coverLetterEnabled, run.documentSettings.includeCoverLetter);
    assert.equal(saved.documentRunId, run.id); assert.equal(saved.manualChatUrl, run.url);
    assert.equal(saved.documentSaveSource, 'automatic');
    for (const file of run.downloads.files) {
      assert.equal(file.state, 'complete'); assert.ok(Number.isInteger(file.downloadId));
      const item = await until(async () => {
        const entry = (await downloads()).find(item => item.id === file.downloadId);
        return entry?.state === 'complete' && entry;
      }, 'Chrome confirms finished download');
      assert.equal(dirname(resolve(item.filename)), resolve(folder), 'test downloads stay in the dedicated artifact directory');
      const bytes = await readFile(item.filename);
      assert.ok(bytes.length > 10);
      const stored = await evaluate(workerSession, `(async()=>{
        const file=await new Promise((resolve,reject)=>{
          const opening=indexedDB.open('ai-agent-document-files',1);
          opening.onerror=()=>reject(opening.error);
          opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('files'),request=tx.objectStore('files').get(${JSON.stringify(file.key)});
            tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>{db.close();reject(tx.error)};};
        });
        if(!file)throw Error('Downloaded file missing from preview storage');
        const digest=await crypto.subtle.digest('SHA-256',file.bytes);
        return {state:file.state,size:file.bytes.byteLength,sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
      })()`);
      assert.equal(stored.state, 'complete'); assert.equal(stored.size, bytes.length);
      assert.equal(stored.sha256, createHash('sha256').update(bytes).digest('hex'), 'preview storage retains exactly the downloaded bytes');
      if (file.format === 'pdf') assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
      if (file.format === 'docx') assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK');
      if (file.format === 'json') assert.doesNotThrow(() => JSON.parse(bytes.toString('utf8')));
    }
    return run;
  }

  // Close the workspace after sending: collection and downloads belong to the
  // background service, not to a visible queue or open review dialog.
  const first = await generate();
  await cdp.send('Target.closeTarget', { targetId:currentTarget });
  await capture(first);
  const firstRun = await finishedFiles(first, 2);
  const firstSaved = await savedJob(first.jobId);
  assert.deepEqual(firstRun.downloads.files.map(file => file.kind).sort(), ['cover-letter', 'resume']);
  assert.ok(firstRun.downloads.files.every(file => file.format === 'pdf'));
  const firstPreviews = await until(async () => { const pages = await previews(); return pages.length === 2 && pages; }, 'PDF previews open after download');
  for (const preview of firstPreviews) {
    const previewSession = await session(preview.targetId);
    await until(async () => {
      try { return await evaluate(previewSession, 'document.documentElement.dataset.previewState === "ready"'); }
      catch { return false; }
    }, 'downloaded document preview ready');
    const file = firstRun.downloads.files.find(file => new URL(preview.url).searchParams.get('file') === file.key);
    assert.ok(file);
    await until(async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree', {}, previewSession);
      return frameTree.childFrames?.some(({ frame }) => frame.mimeType === 'application/pdf' && frame.url.startsWith('blob:chrome-extension://' + extension + '/'));
    }, 'downloaded PDF loaded in Chrome PDF viewer');
    await delay(500);
    const screenshot = await cdp.send('Page.captureScreenshot', {format:'png'}, previewSession);
    await writeFile(join(artifacts, `document-preview-${file.kind}.png`), Buffer.from(screenshot.data, 'base64'));
    await cdp.send('Target.closeTarget', { targetId:preview.targetId });
  }
  const reopened = await cdp.send('Target.createTarget', { url:workspaceUrl });
  currentTarget = reopened.targetId; currentPanel = await session(currentTarget); await ready();
  await rpc('list', { reconnect:true }); await delay(500);
  assert.deepEqual(await savedJob(first.jobId), firstSaved, 'reopening the workspace never repeats the automatic save');
  assert.equal((await downloads()).length, 2, 'reopening the workspace does not download completed runs again');
  assert.equal((await previews()).length, 0, 'reopening the workspace does not reopen previews');

  await ui('document.getElementById("account-settings").click();document.getElementById("queue-settings-tab").click()');
  await toggle('document-include-cover-letter', false);
  await toggle('document-auto-preview', false);
  await toggle('document-format-docx', true); await toggle('document-format-json', true); await toggle('document-format-pdf', false);
  const selected = { includeCoverLetter:false, autoDownload:true, autoPreview:false, formats:['docx','json'] };
  await until(async () => JSON.stringify(await settings()) === JSON.stringify(selected), 'multiple document formats saved');
  await cdp.send('Page.reload', {}, currentPanel); await ready();
  assert.deepEqual(await settings(), selected, 'document preferences survive workspace reload');
  assert.equal(await ui('document.getElementById("document-format-docx").checked&&document.getElementById("document-format-json").checked&&!document.getElementById("document-format-pdf").checked'), true);
  const second = await generate('keyboard', { fromQueue:true }); await capture(second); const secondRun = await finishedFiles(second, 2);
  assert.equal(secondRun.result.coverLetter, '');
  assert.ok(secondRun.downloads.files.every(file => file.kind === 'resume'));
  assert.deepEqual(secondRun.downloads.files.map(file => file.format).sort(), ['docx','json']);
  assert.equal((await previews()).length, 0); assert.equal((await downloads()).length, 4);
  await until(() => ui(`Boolean(document.querySelector('[data-request-id="${second.jobId}"] [data-action="review-generation"]'))`), 'completed download reflected in queue');
  await until(() => ui(`!document.querySelector('[data-request-id="${second.jobId}"] [data-action="preview"]').disabled`), 'automatically saved resume is available on the job card');
  assert.equal(await ui(`document.querySelector('[data-request-id="${second.jobId}"] [data-action="cover-letter"]').disabled`), true, 'resume-only auto-save has no cover letter');
  assert.equal(await ui('Boolean(document.querySelector("dialog[open]"))'), false, 'Auto download never opens the review popup automatically');
  await ui(`document.querySelector('[data-request-id="${second.jobId}"] [data-action="review-generation"]').click()`);
  await until(() => ui('document.getElementById("documents-dialog").open'), 'manual review remains available with Auto download on');
  await ui('document.querySelector("#documents-dialog [data-close-dialog]").click()');

  await toggle('document-auto-preview', true); await toggle('document-auto-download', false);
  assert.equal(await ui('document.getElementById("document-auto-preview").disabled&&document.getElementById("document-auto-preview").checked'), true, 'Auto preview follows download availability and remembers its own preference');
  const third = await generate('keyboard', { fromQueue:true }); await capture(third);
  await until(async () => (await runFor(third.jobId))?.downloads?.state === 'skipped', 'disabled automatic download is skipped');
  assert.equal((await downloads()).length, 4); assert.equal((await previews()).length, 0);
  assert.equal((await savedJob(third.jobId)).resume, null, 'Auto download off leaves saving to manual review');
  await until(() => ui('document.getElementById("documents-dialog").open'), 'Auto download off retains automatic document review');
  await ui('document.querySelector("#documents-dialog [data-close-dialog]").click()');

  await toggle('document-auto-download', true); await toggle('document-auto-preview', false);
  const invalid = await generate('invalid', { fromQueue:true }); const invalidRun = await capture(invalid, 'invalid');
  await delay(500);
  assert.equal(Boolean(invalidRun.downloads?.files?.length), false);
  assert.equal((await savedJob(invalid.jobId)).resume, null, 'invalid replies cannot be saved automatically');
  assert.equal((await downloads()).length, 4, 'invalid AI output never downloads');
  assert.equal((await previews()).length, 0);
  assert.equal(await ui('Boolean(document.querySelector("dialog[open]"))'), false, 'Auto download also keeps invalid-result review available without opening a popup');
  const changed = await generate('keyboard', {fromQueue:true});
  await ui(`(async()=>{
    const {createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));
    const queue=createJobQueue();await queue.ready;const job=queue.snapshot().requests.find(job=>job.id===${JSON.stringify(changed.jobId)}),profile=job.input.profile;
    try {await queue.saveDocuments(job.id,{expectedUpdatedAt:job.updatedAt,coverLetterEnabled:false,
      resume:JSON.stringify({company:job.input.job.company,title:profile.role,summary:'My manual summary.',skills:[{Skills:profile.skills}],experience:profile.experience,education:profile.education})});}
    finally {queue.dispose();}
  })()`);
  const manual = await savedJob(changed.jobId), failed = await capture(changed, 'invalid');
  assert.match(failed.error, /job changed while AI was working/);
  assert.ok(failed.raw && failed.result.resume, 'the conflicting result remains available for manual review');
  assert.equal(Boolean(failed.downloads?.files?.length), false);
  assert.deepEqual(await savedJob(changed.jobId), manual); assert.equal((await downloads()).length, 4);
  assert.equal(await ui('Boolean(document.querySelector("dialog[open]"))'), false);
  await cdp.send('Target.closeTarget', { targetId:provider.targetId });
  return { downloads:4, checks:[
    'all three document settings default on with PDF selected',
    'validated DeepSeek results download resume and cover-letter PDFs after the workspace closes',
    'Auto download saves validated documents to the job and marks it Ready before creating files, including with the workspace closed',
    'automatic saves preserve conversation links, honor optional cover letters, and never repeat after reopening',
    'completed downloads open previews using identical file bytes and workspace reopening does not repeat them',
    'resume-only generation downloads selected Word and JSON formats without cover letters or preview tabs',
    'Auto download suppresses automatic review popups while explicit Review documents still opens the form',
    'Auto download off retains automatic review; invalid output with Auto download on remains available without a popup',
    'settings persist across reload and Auto preview follows Auto download availability',
    'disabled automatic downloads and invalid AI output create no automatic saves or downloads',
    'newer manual document edits are preserved and conflicting AI job updates prevent automatic saves and downloads'
  ] };
}
