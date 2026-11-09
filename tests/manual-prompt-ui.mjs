import assert from 'node:assert/strict';
import { exampleProfile } from '../src/resume-data.mjs';
import { promptForManualCopy } from '../src/manual-prompt.mjs';

export async function checkManualPromptUI({ cdp, dockSession, evaluate, until, session }) {
  const dock = code => evaluate(dockSession, code);
  const click = async selector => {
    await dock(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(() => dock('document.documentElement.dataset.studioBusy !== "true"'), 'manual action finishes');
  };
  const state = () => dock('import(chrome.runtime.getURL("src/queue-store.mjs")).then(module=>module.createQueueStore().read())');
  const { targetInfo } = await cdp.send('Target.getTargetInfo', {}, dockSession);
  const tree = await cdp.send('Page.getFrameTree', {}, dockSession);
  const childIds = tree.frameTree.childFrames?.map(child => child.frame.id) || [];
  const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'iframe' &&
    (target.parentId === targetInfo.targetId || target.parentFrameId === tree.frameTree.frame.id || childIds.includes(target.targetId))), 'manual fixture Chat frame');
  const frame = await session(target.targetId), chat = code => evaluate(frame, code);
  await until(() => chat('Boolean(document.getElementById("prompt-textarea"))'), 'fixture composer ready');
  await chat('document.getElementById("prompt-textarea").value="Synthetic personal draft to preserve";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  const submissions = await chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]").length');
  await click('#studio-tab'); await click('#review-another'); await click('#profile-details');
  const profile = { ...exampleProfile, name: 'Manual Copy Candidate' };
  await dock(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(profile))}], 'Manual_Profile.json',{type:'application/json'}));
    const field=document.getElementById('profile-file');field.files=transfer.files;field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => dock('document.getElementById("profile-import-status").textContent.includes("Imported Manual Copy Candidate")'), 'manual profile imported');
  await click('#profile-dialog [data-close-dialog]');
  const candidateId = await dock('document.getElementById("candidate").value');
  await dock(`for(const [key,value] of Object.entries(${JSON.stringify({company:'Manual Company',title:'Platform Engineer',url:'https://jobs.example.test/manual',description:'Synthetic original TypeScript job description.'})})){
    const field=document.getElementById('job-'+key);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await dock('globalThis.manualClipboardWrites=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{manualClipboardWrites.push(value)}}})');
  await click('#add-request');
  await until(async () => (await state()).requests.some(item => item.input.candidateId === candidateId && item.state === 'unsent') && !(await state()).control.ownerId, 'Add preserves the personal draft and records the unsent handoff');
  assert.equal(await dock('document.getElementById("chat-view").hidden'), false);
  const request = (await state()).requests.find(item => item.input.candidateId === candidateId);
  assert.ok(request);
  const expected = promptForManualCopy(request);
  const before = await state();
  assert.equal(await dock('manualClipboardWrites.at(-1)'), expected);
  await click('#studio-tab'); await click('#view-queue');
  const card = `#resume-queue [data-request-id="${request.id}"]`;
  assert.equal(await dock('document.getElementById("start-queue").disabled && document.getElementById("start-queue").hidden'), true);
  assert.equal(await dock('document.getElementById("pause-queue").disabled'), true);
  assert.equal(await dock('document.getElementById("manual-queue-note").hidden'), false);
  await click(`${card} [data-action="copy-prompt"]`);
  assert.equal(await dock('manualClipboardWrites.at(-1)'), expected);
  assert.equal(await dock(`document.querySelector(${JSON.stringify(card + ' [data-action="copy-prompt"]')}).textContent`), 'Copied');
  assert.deepEqual(await state(), before, 'copy does not change requests, profiles, control, or attempt history');
  await click('#review-another');
  await dock('document.getElementById("job-description").value="Edited draft after queueing";document.getElementById("job-description").dispatchEvent(new Event("input",{bubbles:true}))');
  await click('#view-queue'); await click(`${card} [data-action="details"]`);
  assert.equal(await dock('document.getElementById("request-full-prompt").value'), expected);
  assert.equal(await dock('document.getElementById("request-full-prompt").readOnly'), true);
  await click('#request-copy-prompt');
  assert.equal(await dock('manualClipboardWrites.at(-1)'), expected, 'Details copies the queued snapshot rather than current form edits');
  await click('#request-dialog [data-close-dialog]');
  await dock('globalThis.manualPendingWrites=0;Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:value=>new Promise(resolve=>{manualPendingWrites++;globalThis.releaseManualCopy=resolve})}})');
  await dock(`document.querySelector(${JSON.stringify(card + ' [data-action="copy-prompt"]')}).click();document.querySelector(${JSON.stringify(card + ' [data-action="copy-prompt"]')}).click()`);
  assert.equal(await dock('manualPendingWrites'), 1, 'duplicate clicks do not start overlapping clipboard actions');
  assert.equal(await dock('document.getElementById("add-request").disabled'), false);
  await dock('releaseManualCopy()');
  await until(() => dock('document.documentElement.dataset.studioBusy!=="true"'), 'pending copy finishes');
  await dock('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw Error("Synthetic clipboard denial")}}})');
  await click(`${card} [data-action="copy-prompt"]`);
  assert.equal(await dock('document.getElementById("request-dialog").open'), true);
  assert.equal(await dock('document.getElementById("request-full-prompt").value'), expected);
  assert.equal(await dock('document.getElementById("request-full-prompt").selectionEnd-document.getElementById("request-full-prompt").selectionStart'), expected.length);
  assert.match(await dock('document.getElementById("request-copy-status").textContent'), /copy it manually/);
  assert.equal(await dock('document.getElementById("request-copy-prompt").textContent'), 'Copy prompt');
  await click('#request-dialog [data-close-dialog]');
  await dock('document.getElementById("start-queue").dispatchEvent(new Event("click",{bubbles:true}));document.getElementById("pause-queue").dispatchEvent(new Event("click",{bubbles:true}))');
  assert.deepEqual(await state(), before, 'manual mode controls do not mutate delivery state');
  assert.equal(await chat('document.getElementById("prompt-textarea").value'), 'Synthetic personal draft to preserve');
  assert.equal(await chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]").length'), submissions, 'manual copy never clicks Send');
  return { fixtureOnly: true, liveAccount: false, clipboardMocked: true, submissions: 0,
    checks: ['complete prompt copied from immutable request', 'card and Details copy actions', 'copy retains the existing delivery without recording another attempt',
      'clipboard failure offers selected readonly prompt', 'duplicate copy guard', 'Add remains available', 'bulk sending controls remain paused',
      'existing composer draft and request state unchanged'] };
}
