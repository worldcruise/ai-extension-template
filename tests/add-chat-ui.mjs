import assert from 'node:assert/strict';
import { exampleProfile } from '../src/resume-data.mjs';
import { promptForManualCopy } from '../src/manual-prompt.mjs';

// Uses only the disposable HTTPS ChatGPT fixture, never a signed-in account.
export async function checkAddChatUI({ cdp, dockSession, evaluate, until, session }) {
  const dock = code => evaluate(dockSession, code);
  const state = () => dock('import(chrome.runtime.getURL("src/queue-store.mjs")).then(module=>module.createQueueStore().read())');
  const click = async selector => {
    await dock(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(() => dock('document.documentElement.dataset.studioBusy!=="true"'), 'Add UI action finishes');
  };
  async function chat(code) {
    const tree = await cdp.send('Page.getFrameTree', {}, dockSession);
    const { targetInfo } = await cdp.send('Target.getTargetInfo', {}, dockSession);
    const children = tree.frameTree.childFrames?.map(item => item.frame.id) || [];
    const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(item => item.type === 'iframe' &&
      (item.parentId === targetInfo.targetId || item.parentFrameId === tree.frameTree.frame.id || children.includes(item.targetId))), 'Add fixture frame');
    return evaluate(await session(target.targetId), code);
  }
  await chat('document.getElementById("prompt-textarea").value="";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  const beforeLog = await chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]").length');
  const originalChatDocument = await chat('performance.timeOrigin');
  await click('#studio-tab'); await click('#review-another'); await click('#profile-details');
  const profile = { ...exampleProfile, name: 'Add Handoff Candidate' };
  await dock(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(profile))}], 'Add_Profile.json',{type:'application/json'}));
    const field=document.getElementById('profile-file');field.files=transfer.files;field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => dock('document.getElementById("profile-import-status").textContent.includes("Imported Add Handoff Candidate")'), 'Add profile imported');
  const candidateId = await dock('document.getElementById("candidate").value');
  await click('#profile-dialog [data-close-dialog]');
  await dock('globalThis.addPromptCopies=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{addPromptCopies.push(text)}}})');
  // Add always targets Sidebar Chat even if the retained recovery selector is Tab.
  await dock('document.getElementById("queue-connection").value="tab";document.getElementById("queue-connection").dispatchEvent(new Event("change",{bubbles:true}))');
  await until(() => dock('chrome.storage.local.get("resumeQueueConnection").then(value=>value.resumeQueueConnection==="tab")'), 'retained connection selection saved');
  const jobs = async () => (await state()).requests.filter(item => item.input.candidateId === candidateId);
  async function addJob(company, description) {
    await click('#studio-tab'); await click('#review-another');
    await dock(`for(const [key,value] of Object.entries(${JSON.stringify({ company, title: 'Platform Engineer', url: 'https://jobs.example.test/add/' + company, description })})){
      const field=document.getElementById('job-'+key);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await dock('document.getElementById("add-request").click();document.getElementById("add-request").click()');
    await until(() => dock('document.documentElement.dataset.studioBusy!=="true" && !document.getElementById("chat-view").hidden'), 'Add opens Chat without selecting Job Queues');
    assert.equal(await dock('document.getElementById("job-tab").getAttribute("aria-selected")'), 'true');
  }
  await addJob('Add Alpha', 'FIXTURE_LONG. Build TypeScript and SQL services.');
  await until(async () => (await jobs())[0]?.state === 'generating', 'new conversation submitted and registered');
  const first = (await jobs())[0];
  assert.ok(first.sourceChatUrl?.includes('/c/'));
  assert.equal(first.attempts.at(-1).submitted, true);
  assert.equal(first.attempts.at(-1).connection, 'sidebar');
  assert.equal(await dock('addPromptCopies[0]'), promptForManualCopy(first), 'clipboard matches exact submitted delivery');
  assert.equal(await chat('document.getElementById("prompt-textarea").value'), '', 'fixture clears the submitted composer');
  assert.equal(await dock('document.getElementById("add-request").disabled'), false, 'Add stays available during response');
  await addJob('Add Beta', 'Build reliable TypeScript APIs.');
  const pending = await jobs();
  assert.equal(pending.length, 2, 'double clicks do not create duplicate queue entries');
  assert.equal(await dock('addPromptCopies.length'), 2);
  await until(async () => (await jobs()).every(item => item.state === 'ready') && !(await state()).control.ownerId, 'serialized Add responses saved');
  const completed = await jobs();
  const log = await chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]")');
  assert.equal(log.length - beforeLog, 2);
  assert.deepEqual(log.slice(beforeLog).map(item => item.requestId), completed.map(item => item.id));
  assert.ok(log.slice(beforeLog).every(item => item.url === '/'), 'every Add uses a fresh conversation');
  assert.notEqual(completed[0].sourceChatUrl, completed[1].sourceChatUrl);
  assert.ok(completed.every(item => item.resume && item.rawOutput && item.attempts.length === 1));
  assert.equal(await chat('performance.timeOrigin'), originalChatDocument, 'empty chat reuse and native New chat do not reload the iframe');
  const latency = completed.map(item => {
    const diagnostic = item.attempts[0].diagnostics.at(-1);
    const times = diagnostic.timestamps;
    assert.ok(times.capturedAt - times.completionObservedAt >= 170);
    assert.ok(times.capturedAt - times.completionObservedAt < 1000, 'strong completed JSON is captured without the old 1.25s wait');
    return { prepareToDispatchMs: times.dispatchedAt - times.startedAt, completedToCaptureMs: times.capturedAt - times.completionObservedAt,
      captureToReadyMs: item.completedAt - times.capturedAt };
  });
  const beforeDuplicateChat = await chat('location.origin+location.pathname');
  await click('#studio-tab'); await click('#review-another');
  await dock(`for(const [id,value] of Object.entries(${JSON.stringify({ 'job-company': 'Different Company', 'job-url': completed[0].input.job.url + '?utm_source=fixture' })})){
    const field=document.getElementById(id);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await click('#add-request');
  assert.equal(await dock('document.getElementById("queue-notice").hidden'), false);
  assert.equal(await dock('document.getElementById("queue-notice-title").textContent'), 'Already applied');
  assert.match(await dock('document.getElementById("queue-notice-message").textContent'), /Job URL.*saved results/);
  assert.equal((await jobs()).length, 2); assert.equal(await dock('addPromptCopies.length'), 2);
  assert.equal(await chat('location.origin+location.pathname'), beforeDuplicateChat);
  assert.equal((await chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]")')).length, log.length);
  await click('#queue-notice-dismiss');
  await click('#studio-tab'); await click('#view-queue');
  await click(`#resume-queue [data-request-id="${first.id}"] [data-action="review"]`);
  await until(() => chat(`location.origin+location.pathname===${JSON.stringify(first.sourceChatUrl)}`), 'Review opens original sidebar chat despite Tab preference');
  assert.equal(await dock('document.getElementById("request-dialog").open'), false);
  await until(() => dock('!document.getElementById("queue-connection").disabled'), 'connection settings unlock');
  await dock('document.getElementById("queue-connection").value="sidebar";document.getElementById("queue-connection").dispatchEvent(new Event("change",{bubbles:true}))');
  const priorChat = await chat('location.origin+location.pathname');
  await dock('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw Error("Fixture clipboard denied")}}})');
  await addJob('Add Clipboard Denied', 'Synthetic job with denied clipboard access.');
  assert.equal(await dock('document.getElementById("request-dialog").open'), true);
  assert.match(await dock('document.getElementById("request-copy-status").textContent'), /Nothing was sent/);
  const denied = (await jobs()).at(-1);
  assert.equal(denied.state, 'queued'); assert.equal(denied.attempts[0].sendIntent, undefined);
  assert.equal(await chat('location.origin+location.pathname'), priorChat, 'clipboard failure does not open or submit another conversation');
  assert.equal((await chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]")')).length, log.length);
  await click('#request-dialog [data-close-dialog]');
  await dock('document.getElementById("check-existing-jobs").checked=false;document.getElementById("check-existing-jobs").dispatchEvent(new Event("change",{bubbles:true}))');
  await until(() => dock('chrome.storage.local.get("checkExistingJobs").then(value=>value.checkExistingJobs===false)'), 'duplicate preference saved');
  const previousDocument = await dock('performance.timeOrigin');
  await cdp.send('Page.reload', {}, dockSession);
  await until(() => dock(`performance.timeOrigin!==${previousDocument}&&document.documentElement.dataset.studioReady==="true"`), 'duplicate preference restored in a new panel document');
  assert.equal(await dock('document.getElementById("check-existing-jobs").checked'), false);
  await dock('document.getElementById("check-existing-jobs").checked=true;document.getElementById("check-existing-jobs").dispatchEvent(new Event("change",{bubbles:true}))');
  await until(() => dock('chrome.storage.local.get("checkExistingJobs").then(value=>value.checkExistingJobs===true)'), 'duplicate check restored');
  return { fixtureOnly: true, liveAccount: false, submissions: 2, latency, checks: [
    'Add saves and copies the exact persisted prompt', 'Chat opens without switching Studio tabs',
    'fresh Sidebar Chat per added request', 'one Send and matching acknowledgement per delivery',
    'duplicate Add guard', 'Add remains enabled during response', 'additional Adds serialize',
    'valid JSON saved before Ready', 'Review opens recorded sidebar conversation regardless of recovery preference',
    'clipboard failure saves the request and selects a readonly prompt without navigating or sending',
    'saved-result URL duplicates stop before copying or sending', 'duplicate check preference survives panel reload',
    'fresh chats avoid full iframe reloads', 'strong completed JSON capture latency is below one second'
  ] };
}
