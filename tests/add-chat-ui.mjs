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
  await addJob('Manual Alpha', 'Build TypeScript and SQL services.');
  const first = (await jobs())[0];
  assert.equal(first.state, 'queued');
  assert.deepEqual(first.attempts, []);
  assert.equal(first.deliveryId, undefined);
  assert.equal(await dock('addPromptCopies[0]'), promptForManualCopy(first));
  assert.equal(await chat('performance.timeOrigin'), originalChatDocument);
  assert.equal(await chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]").length'), beforeLog);
  await addJob('Manual Beta', 'Build accessible interfaces.');
  assert.equal((await jobs()).length, 2);
  assert.ok((await jobs()).every(job => job.state === 'queued' && job.attempts.length === 0));
  assert.equal(await chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]").length'), beforeLog);
  return { fixtureOnly: true, liveAccount: false, submissions: 0,
    checks: ['Add saves and copies a prompt without sending', 'no delivery permission or attempt created',
      'chat document retained', 'additional Adds remain queued for manual sending'] };
}