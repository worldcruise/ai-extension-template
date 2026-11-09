import assert from 'node:assert/strict';
import { exampleProfile } from '../src/resume-data.mjs';

export async function checkBulkQueue({ cdp, id, workerSession, sourceSession, dockSession, panelSession, evaluate, until, session }) {
  const dock = code => evaluate(dockSession, code);
  const state = () => dock('import(chrome.runtime.getURL("src/queue-store.mjs")).then(module => module.createQueueStore().read())');
  async function click(selector) {
    await dock(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(() => dock('document.documentElement.dataset.studioBusy !== "true"'), 'bulk action saved');
  }
  async function chat(code) {
    const { targetInfo } = await cdp.send('Target.getTargetInfo', {}, dockSession);
    const tree = await cdp.send('Page.getFrameTree', {}, dockSession);
    const childIds = tree.frameTree.childFrames?.map(child => child.frame.id) || [];
    const frame = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'iframe' &&
      (target.parentId === targetInfo.targetId || target.parentFrameId === tree.frameTree.frame.id || childIds.includes(target.targetId))), 'bulk ChatGPT frame');
    return evaluate(await session(frame.targetId), code);
  }
  const log = () => chat('JSON.parse(localStorage.getItem("fixtureSubmissionLog") || "[]")');
  async function addJob(company, description = 'Build supported TypeScript and SQL services.') {
    await click('#review-another');
    await dock(`for (const [key,value] of Object.entries(${JSON.stringify({ company, title: 'Platform Engineer', url: 'https://jobs.example.test/bulk/' + encodeURIComponent(company), description })})) {
      const field=document.getElementById('job-'+key); field.value=value; field.dispatchEvent(new Event('input',{bubbles:true}));
    }`);
    await click('#add-request');
  }
  async function candidateRequests(candidateId) { return (await state()).requests.filter(item => item.input.candidateId === candidateId && !item.isExample); }
  await until(() => dock('document.documentElement.dataset.studioReady === "true"'), 'bulk workspace ready');
  // Reproduce a signed-in layout that lacks every recognized account button.
  await chat('localStorage.setItem("fixtureAccountMenu","missing")');
  const originalDocument = await dock('performance.timeOrigin');
  await cdp.send('Page.reload', {}, dockSession);
  await until(() => dock(`performance.timeOrigin !== ${originalDocument} && document.documentElement.dataset.studioReady === "true"`), 'new sidebar without account menu selectors');
  await click('#studio-tab'); await click('#review-another'); await click('#profile-details');
  const profile = { ...exampleProfile, name: 'Synthetic Queue Candidate' };
  await dock(`(() => {
    const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify(JSON.stringify(profile))}], 'Synthetic_Profile.json', {type:'application/json'}));
    const field=document.getElementById('profile-file'); field.files=transfer.files; field.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await until(() => dock('document.getElementById("profile-import-status").textContent.includes("Imported Synthetic Queue Candidate")'), 'real profile file input import');
  const candidateId = await dock('document.getElementById("candidate").value');
  assert.ok(!['morgan', 'jordan'].includes(candidateId));
  await click('#profile-dialog [data-close-dialog]');
  await addJob('Bulk Alpha', 'FIXTURE_LONG FIXTURE_INVALID_ONCE. Build TypeScript services using supported candidate facts.');
  assert.equal((await log()).length, 0, 'Add does not send automatically');
  await click('#start-queue');
  await until(async () => (await candidateRequests(candidateId))[0].errorCode === 'login-unverified', 'unknown account layout remains explicit');
  assert.equal((await log()).length, 0, 'unverified layout does not submit a prompt');
  await click('#resume-queue [data-action="connection"]');
  await until(() => dock('!document.getElementById("chat-check-again").disabled'), 'in-extension connection check finishes');
  assert.equal(await dock('document.getElementById("chat-connection-title").textContent'), 'Authentication evidence unknown');
  const hostFingerprint = (await dock('document.getElementById("runtime-host-build").textContent')).match(/[a-f0-9]{64}/)?.[0];
  assert.ok(hostFingerprint);
  assert.equal(await dock('document.getElementById("runtime-adapter-build").textContent'), hostFingerprint, 'running host and adapter report the built fingerprint');
  assert.equal(await dock('document.getElementById("chat-confirm-session").hidden'), false);
  await click('#chat-confirm-session');
  await until(() => dock('document.getElementById("chat-connection-title").textContent === "ChatGPT session confirmed"'), 'user confirms an unknown signed-in layout');
  await click('#chat-check-again');
  await until(() => dock('!document.getElementById("chat-check-again").disabled'), 'confirmed session inspected without another confirmation');
  assert.equal(await dock('document.getElementById("chat-connection-title").textContent'), 'Session confirmed; authentication evidence unknown');
  assert.equal(await dock('document.getElementById("chat-confirm-session").hidden'), true);
  await until(async () => (await candidateRequests(candidateId))[0].state === 'queued', 'unsent account-blocked job restored automatically');
  await click('#chat-connection-back');
  assert.equal((await log()).length, 0, 'connection confirmation does not send');
  await chat('document.getElementById("prompt-textarea").value="My personal unsent draft";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await click('#start-queue');
  try { await until(async () => (await candidateRequests(candidateId))[0].state === 'unsent', 'unsent draft blocks Start'); }
  catch (error) {
    const current = await state();
    throw new Error(`${error.message}: ${JSON.stringify({control:current.control,requests:current.requests.filter(item=>item.input.candidateId===candidateId).map(item=>({state:item.state,error:item.error})),connection:await dock('document.getElementById("connection").dataset.state'),status:await dock('document.getElementById("workspace-status").textContent')})}`);
  }
  assert.equal(await chat('document.getElementById("prompt-textarea").value'), 'My personal unsent draft');
  assert.equal((await log()).length, 0);
  await chat('document.getElementById("prompt-textarea").value="";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}));localStorage.setItem("fixtureEditorKind","paragraphs");localStorage.setItem("fixtureSendControl","modern");localStorage.setItem("fixtureBlockSend","true")');
  await click('#resume-queue [data-action="regenerate"]'); await click('#regenerate-confirm');
  await click('#start-queue');
  await until(async () => (await candidateRequests(candidateId))[0].errorCode === 'send-unavailable', 'paragraph draft waits for an enabled Send control', 20000);
  const prepared = (await candidateRequests(candidateId))[0];
  assert.equal((await log()).length, 0, 'disabled Send leaves a prepared but unsent draft');
  assert.equal(await chat('Boolean(document.querySelector("#prompt-textarea p"))'), true, 'ProseMirror-style paragraphs are exercised');
  assert.notEqual(await chat('document.getElementById("prompt-textarea").innerText.trim()'), prepared.attempts.at(-1).prompt.trim(), 'layout-dependent innerText reproduces the original exact-comparison failure');
  await chat('localStorage.removeItem("fixtureBlockSend");localStorage.setItem("fixtureEditorKind","divs");document.getElementById("composer-submit-button").disabled=false');
  await dock('document.querySelector("#resume-queue [data-action=continue-send]").click()');
  await until(async () => (await candidateRequests(candidateId))[0].state === 'generating', 'prepared draft automatically sent and acknowledged');
  const registered = (await candidateRequests(candidateId))[0];
  assert.equal(registered.deliveryId, prepared.deliveryId, 'continuation uses the original delivery');
  assert.equal(registered.attempts.length, prepared.attempts.length, 'continuation does not create a second attempt');
  assert.ok(registered.sourceChatUrl?.includes('/c/'), 'conversation registered before the response finishes');
  await dock('document.getElementById("chat-toolbar-reveal").focus();document.getElementById("company-chat-search").focus()');
  assert.equal(await dock('document.querySelectorAll("#company-chat-list button").length'), 1, 'in-progress conversation is available in saved company chats');
  assert.equal(await dock('document.getElementById("add-request").disabled'), false, 'Add remains available during Continue');
  await addJob('Bulk Beta');
  await until(async () => (await candidateRequests(candidateId))[0].state === 'invalid-output', 'completed invalid output archived');
  await until(async () => !(await state()).control.ownerId, 'single-request reconciliation finishes');
  assert.equal((await candidateRequests(candidateId))[1].state, 'queued', 'Continue does not process another job');
  assert.equal(await dock('document.querySelectorAll("#failed-queue .job-request").length'), 1);
  await click('#start-queue');
  await until(async () => (await candidateRequests(candidateId))[1].state === 'ready', 'next queued job completes');
  await until(async () => !(await state()).control.ownerId, 'bulk runner releases lock');
  const completed = await candidateRequests(candidateId);
  assert.equal((await log()).length, 2, 'invalid output is not automatically resent');
  assert.equal((await log())[0].deliveryId, prepared.deliveryId, 'the prepared delivery was clicked only once');
  assert.equal(completed[0].repairCount, 0);
  assert.equal(completed[0].resume, null);
  assert.equal(completed[1].resume.company, 'Bulk Beta');
  assert.equal(completed[1].input.job.provenance.company.kind, 'user');
  assert.equal(completed[1].input.job.provenance.role.kind, 'user');
  assert.notEqual(completed[0].sourceChatUrl, completed[1].sourceChatUrl);
  assert.ok(completed.every(request => request.rawOutput && request.input.profile.name === profile.name));
  assert.equal(await chat('document.getElementById("prompt-textarea").isContentEditable'), true);
  assert.equal(await chat('document.getElementById("composer-submit-button").getAttribute("aria-label")'), 'Send');
  assert.equal(await dock('document.querySelectorAll(".state-pill[data-state=ready]").length'), 1);
  await click('#new-chat');
  await until(() => chat('location.pathname === "/"'), 'unrelated current chat before Review');
  await click('#resume-queue [data-action="review"]');
  await until(() => chat(`location.origin+location.pathname===${JSON.stringify(completed[1].sourceChatUrl)}`), 'Review opens the recorded originating conversation');
  assert.equal(await dock('document.getElementById("request-dialog").open'), false, 'Review is separate from Details');
  await click('#resume-queue [data-action="preview"]');
  assert.ok((await dock('document.getElementById("resume-paper").textContent')).includes(profile.name));
  await click('#chat-tab'); await dock('document.getElementById("chat-toolbar-reveal").focus();document.getElementById("company-chat-search").focus()');
  assert.equal(await dock('document.querySelectorAll("#company-chat-list button").length'), 2, 'company links are connected automatically');
  await click('#studio-tab');
  await chat('localStorage.removeItem("fixtureEditorKind")');
  await addJob('Bulk Gamma', 'FIXTURE_LONG. Build TypeScript services.');
  await chat('document.querySelector("form").dataset.loggedOut=""');
  await click('#start-queue');
  await until(async () => (await candidateRequests(candidateId))[2].errorCode === 'signed-out', 'explicit sign-out overrides prior confirmation');
  assert.equal((await log()).length, 2);
  await click('#account-toggle'); await click('#account-check');
  await until(() => dock('!document.getElementById("chat-check-again").disabled'), 'signed-out diagnosis finishes');
  assert.equal(await dock('document.getElementById("chat-connection-title").textContent'), 'Sign in required');
  assert.equal(await dock('document.getElementById("chat-confirm-session").hidden'), true, 'sign-out cannot be manually overridden');
  await chat('delete document.querySelector("form").dataset.loggedOut');
  await click('#chat-check-again');
  await until(() => dock('!document.getElementById("chat-check-again").disabled'), 'loaded-conversation session recognized');
  assert.equal(await dock('document.getElementById("chat-connection-title").textContent'), 'Authentication evidence recognized');
  await click('#chat-connection-back');
  await until(() => dock('!document.getElementById("start-queue").disabled'), 'connection-restored queue can start');
  await click('#start-queue');
  try { await until(async () => (await candidateRequests(candidateId))[2].state === 'generating', 'third job acknowledged before panel closes'); }
  catch (error) {
    const current = await state();
    throw new Error(`${error.message}: ${JSON.stringify({control:current.control,requests:current.requests.filter(item=>item.input.candidateId===candidateId).map(item=>({state:item.state,error:item.error,errorCode:item.errorCode})),connection:await dock('document.getElementById("connection").dataset.state'),status:await dock('document.getElementById("workspace-status").textContent')})}`);
  }
  assert.equal((await log()).length, 3);
  assert.equal(await chat('document.getElementById("prompt-textarea").matches("textarea")'), true, 'textarea submission is also exercised');
  for (const current of [dockSession, panelSession]) {
    assert.equal(await evaluate(current, 'navigator.locks.query().then(state => state.held.filter(lock => lock.name === "ai-agent-resume-runner").length)'), 1, 'one shared runner across extension surfaces');
  }
  const windowId = await dock('chrome.windows.getCurrent().then(window => window.id)');
  await evaluate(workerSession, `chrome.sidePanel.close({windowId:${windowId}})`);
  await until(() => evaluate(workerSession, 'chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]}).then(items => items.length === 0)'), 'close running native sidebar');
  const sourceUrl = await evaluate(sourceSession, 'location.href');
  const source = await until(async () => (await cdp.send('Target.getTargets', {filter:[{type:'tab',exclude:false}]})).targetInfos.find(target => target.url === sourceUrl), 'reopen action source');
  await cdp.send('Extensions.triggerAction', {id,targetId:source.targetId});
  await until(() => evaluate(workerSession, 'chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]}).then(items => items.length === 1)'), 'reopened sidebar context');
  dockSession = await until(async () => {
    for (const target of (await cdp.send('Target.getTargets')).targetInfos.filter(target => target.url === `chrome-extension://${id}/index.html`)) {
      const current = await session(target.targetId);
      if (await evaluate(current, 'Boolean(chrome.tabs?.getCurrent) && chrome.tabs.getCurrent().then(tab => !tab)')) return current;
    }
  }, 'reopened native bulk sidebar');
  await until(() => dock('document.documentElement.dataset.studioReady === "true"'), 'reopened queue initializes');
  assert.equal(await dock('document.getElementById("candidate").value'), candidateId, 'selected imported profile persists');
  await until(async () => (await candidateRequests(candidateId))[2].state === 'uncertain', 'interrupted delivery marked for recovery');
  assert.equal((await log()).length, 3, 'reopening does not submit automatically');
  await click('#resume-queue [data-action="recover"]');
  await until(async () => (await candidateRequests(candidateId))[2].state === 'ready', 'recovery captures existing response', 30000);
  assert.equal((await log()).length, 3, 'recovery never sends a duplicate prompt');
  await until(async () => !(await state()).control.ownerId, 'recovery runner finishes');
  await addJob('Bulk Limited', 'FIXTURE_RATE_LIMIT. Build TypeScript services.');
  await addJob('Bulk Waiting'); await click('#start-queue');
  await until(async () => (await candidateRequests(candidateId))[3].state === 'uncertain', 'usage limit pauses the queue');
  const limited = await candidateRequests(candidateId);
  assert.match(limited[3].error, /usage limit/);
  assert.equal(limited[4].state, 'queued');
  assert.equal((await log()).length, 4, 'usage limit does not trigger a repair or next job');
  await until(async () => !(await state()).control.ownerId, 'limited runner finishes');
  await click('#resume-queue [data-action="cancel"]');
  await chat('localStorage.removeItem("fixtureEditorKind");localStorage.removeItem("fixtureAccountMenu");localStorage.removeItem("fixtureSendControl");localStorage.removeItem("fixtureBlockSend")');
  await click('#new-chat');
  await until(() => dock('document.getElementById("connection").dataset.state === "ready"'), 'manual Chat navigation after pause');
  return { dockSession, checks: ['profile JSON import', 'explicit Start only', 'unsent draft preserved', 'textarea, paragraph and mixed text/div composers',
    'modern Send control', 'prepared draft continued with one click', 'conversation registered during generation',
    'missing account-menu layout handled inside the extension', 'one-panel session confirmation and safe requeue', 'visible sign-out overrides confirmation',
    'two jobs in separate conversations', 'completed invalid output archived without resending', 'validated saved results and company links',
    'one shared runner across windows', 'active queue survives sidebar close', 'read-only recovery without duplicate send', 'usage limit pauses remaining jobs'],
    fixtureOnly: true, liveAccount: false, submissions: 4 };
}
