import assert from 'node:assert/strict';
import { exampleProfile } from '../src/resume-data.mjs';

export async function checkTabQueue({ cdp, id, workerSession, dockSession, evaluate, until, session }) {
  const dock = code => evaluate(dockSession, code);
  const state = () => dock('import(chrome.runtime.getURL("src/queue-store.mjs")).then(module=>module.createQueueStore().read())');
  const click = selector => dock(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const { targetId: personalTarget } = await cdp.send('Target.createTarget', { url: 'https://chatgpt.com/c/personal-tab-preserved' });
  const personalSession = await session(personalTarget);
  await until(() => evaluate(personalSession, 'Boolean(document.getElementById("prompt-textarea"))'), 'personal tab fixture loads');
  await evaluate(personalSession, 'document.getElementById("prompt-textarea").value="My personal tab draft";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  const submissions = () => evaluate(personalSession, 'JSON.parse(localStorage.getItem("fixtureSubmissionLog")||"[]")');
  const initialCount = (await submissions()).length;
  await click('#account-toggle'); await click('#account-settings'); await click('#queue-settings-tab');
  assert.equal(await dock('document.getElementById("queue-settings-panel").hidden'), false);
  await dock('document.getElementById("queue-connection").value="tab";document.getElementById("queue-connection").dispatchEvent(new Event("change",{bubbles:true}))');
  await until(() => dock('chrome.storage.local.get("resumeQueueConnection").then(value=>value.resumeQueueConnection==="tab")'), 'tab connection saved');
  await click('#queue-connection-open');
  const windowId = await dock('chrome.windows.getCurrent().then(window=>window.id)');
  const tabKey = 'resume-queue-tab:' + windowId;
  const tabId = await until(() => dock(`chrome.storage.session.get(${JSON.stringify(tabKey)}).then(value=>value[${JSON.stringify(tabKey)}])`), 'dedicated queue tab created');
  assert.equal((await submissions()).length, initialCount, 'choosing/opening a connection never sends');
  await click('#settings-back'); await click('#review-another'); await click('#account-toggle'); await click('#profile-details');
  const profile = { ...exampleProfile, name: 'Synthetic Tab Candidate' };
  await dock(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(profile))}],"Tab_Profile.json",{type:"application/json"}));
    const field=document.getElementById("profile-file");field.files=transfer.files;field.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await until(() => dock('document.getElementById("profile-import-status").textContent.includes("Imported Synthetic Tab Candidate")'), 'tab candidate imported');
  const candidateId = await dock('document.getElementById("candidate").value');
  const requests = async () => (await state()).requests.filter(request => request.input.candidateId === candidateId);
  await click('#profile-dialog [data-close-dialog]');
  async function addJob(company, description = 'Build TypeScript and SQL services.') {
    await click('#review-another');
    await dock(`for(const [key,value] of Object.entries(${JSON.stringify({ company, title: 'Platform Engineer', url: 'https://jobs.example.test/tab/' + encodeURIComponent(company), description })})) {
      const field=document.getElementById('job-'+key);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await click('#add-request'); await until(() => dock('document.documentElement.dataset.studioBusy!=="true"'), 'tab job saved');
  }
  await addJob('Tab Alpha', 'FIXTURE_LONG. Build TypeScript services.');
  await addJob('Tab Beta', 'Build SQL services.');
  await click('#start-queue');
  try { await until(async () => (await requests())[0].state === 'generating', 'normal-tab send acknowledged'); }
  catch (error) { throw new Error(error.message + ': ' + JSON.stringify((await requests()).map(request => ({state:request.state,error:request.error})))); }
  const first = (await requests())[0];
  assert.equal(first.attempts[0].connection, 'tab');
  assert.ok(first.sourceChatUrl?.includes('/c/'));
  assert.equal(await dock('document.getElementById("queue-connection").disabled'), true, 'connection cannot change during a run');
  await until(async () => (await requests()).every(request => request.state === 'ready'), 'two jobs generated through normal tabs', 30000);
  await until(async () => !(await state()).control.ownerId, 'tab runner finishes');
  const completed = await requests();
  assert.equal(completed[0].resume.company, 'Tab Alpha');
  assert.equal(completed[1].resume.company, 'Tab Beta');
  assert.notEqual(completed[0].sourceChatUrl, completed[1].sourceChatUrl);
  assert.equal(completed[1].repairCount, 0);
  assert.equal((await submissions()).length, initialCount + 2);
  assert.equal(await evaluate(personalSession, 'document.getElementById("prompt-textarea").value'), 'My personal tab draft');
  assert.equal(await evaluate(personalSession, 'location.pathname'), '/c/personal-tab-preserved');
  const top = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'page' && target.url === completed[1].sourceChatUrl), 'queue tab target');
  const topSession = await session(top.targetId);
  await evaluate(topSession, 'document.getElementById("prompt-textarea").value="Keep this queue-tab draft";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await addJob('Tab Gamma', 'FIXTURE_LONG. Build supported services.'); await click('#start-queue');
  await until(async () => (await requests())[2].errorCode === 'existing-draft', 'queue tab draft protected');
  assert.equal((await submissions()).length, initialCount + 2);
  assert.equal(await evaluate(topSession, 'document.getElementById("prompt-textarea").value'), 'Keep this queue-tab draft');
  await evaluate(topSession, 'document.getElementById("prompt-textarea").value="";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  const gammaId = (await requests())[2].id;
  await click(`#resume-queue [data-request-id="${gammaId}"] [data-action="regenerate"]`); await click('#regenerate-confirm');
  await until(() => dock('document.documentElement.dataset.studioBusy!=="true"'), 'tab retry queued');
  await click('#start-queue');
  await until(async () => (await requests())[2].state === 'generating', 'third tab job acknowledged');
  const originalDelivery = (await requests())[2].deliveryId;
  assert.equal((await submissions()).length, initialCount + 3);
  await evaluate(workerSession, `chrome.sidePanel.close({windowId:${windowId}})`);
  await until(() => evaluate(workerSession, 'chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]}).then(items=>items.length===0)'), 'tab runner sidebar closed');
  const personalTab = await until(async () => (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(target => target.url === 'https://chatgpt.com/c/personal-tab-preserved'), 'personal tab action target');
  await cdp.send('Extensions.triggerAction', { id, targetId: personalTab.targetId });
  await until(() => evaluate(workerSession, 'chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]}).then(items=>items.length===1)'), 'tab runner sidebar reopened');
  dockSession = await until(async () => {
    for (const target of (await cdp.send('Target.getTargets')).targetInfos.filter(target=>target.url===`chrome-extension://${id}/index.html`)) {
      const current=await session(target.targetId);
      if (await evaluate(current,'chrome.tabs.getCurrent().then(tab=>!tab)')) return current;
    }
  }, 'reopened tab queue panel');
  await until(() => dock('document.documentElement.dataset.studioReady==="true"'), 'reopened tab workspace ready');
  await until(async () => (await requests())[2].state === 'uncertain', 'tab delivery awaits recovery');
  assert.equal(await dock('document.getElementById("queue-connection").value'), 'tab', 'connection choice persists');
  assert.equal(await dock(`chrome.storage.session.get(${JSON.stringify(tabKey)}).then(value=>value[${JSON.stringify(tabKey)}])`), tabId, 'owned tab identity persists');
  await click('#resume-queue [data-action="recover"]');
  await until(async () => (await requests())[2].state === 'ready', 'tab result recovered without resubmission', 30000);
  assert.equal((await requests())[2].deliveryId, originalDelivery);
  assert.equal((await submissions()).length, initialCount + 3);
  await until(async () => !(await state()).control.ownerId, 'recovered tab runner finishes');
  await click('#review-another');
  await dock(`for(const [key,value] of Object.entries({company:'',title:'',url:'https://jobs.example.test/tab/missing',description:'Synthetic metadata-only job.'})){
    const field=document.getElementById('job-'+key);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await click('#add-request');
  await until(async () => (await requests()).length === 4, 'missing-metadata job saved');
  const missing = (await requests())[3];
  assert.equal(missing.input.job.company, '');
  assert.equal(missing.input.job.role, profile.role);
  assert.equal(missing.input.job.provenance.company.kind, 'missing');
  assert.equal(missing.input.job.provenance.role.kind, 'profile-fallback');
  assert.equal((await submissions()).length, initialCount + 3, 'metadata fallback does not generate anything');
  await click(`#resume-queue [data-request-id="${missing.id}"] [data-action="cancel"]`);
  await cdp.send('Target.closeTarget', { targetId: personalTarget });
  await click('#account-toggle'); await click('#account-settings'); await click('#queue-settings-tab');
  await dock('document.getElementById("queue-connection").value="sidebar";document.getElementById("queue-connection").dispatchEvent(new Event("change",{bubbles:true}))');
  await until(() => dock('chrome.storage.local.get("resumeQueueConnection").then(value=>value.resumeQueueConnection==="sidebar")'), 'original sidebar connection restored');
  await click('#settings-back');
  return { dockSession, checks: ['saved connection selection', 'dedicated window-scoped ChatGPT tab', 'explicit Start only', 'normal-tab automatic Send',
    'early conversation registration', 'separate job conversations', 'personal tabs untouched', 'queue-tab draft protected',
    'connection locked during generation', 'owned tab survives sidebar closure', 'recovery without duplicate send'], fixtureOnly: true, liveAccount: false, submissions: 3 };
}
