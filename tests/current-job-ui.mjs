import assert from 'node:assert/strict';

export async function checkCaptureEligibilityUI({ read, until }) {
  const tab = await read('chrome.tabs.create({url:"about:blank#capture-eligibility",active:true})');
  const expanded = await read('!document.getElementById("chat-view").hidden');
  const navigate = async url => {
    await read(`chrome.tabs.update(${tab.id},{url:${JSON.stringify(url)},active:true})`);
    await until(() => read(`chrome.tabs.get(${tab.id}).then(tab=>tab.status==="complete"&&tab.url===${JSON.stringify(url)})`), 'capture eligibility page loaded');
  };
  await read('globalThis.captureEligibilityPermissionRequest=chrome.permissions.request;globalThis.captureEligibilityRequests=0;chrome.permissions.request=()=>{captureEligibilityRequests++;return Promise.resolve(false)}');
  try {
    for (const url of [
      'https://chatgpt.com/', 'https://chatgpt.com/c/capture-exclusion',
      'https://chat.deepseek.com/', 'https://chat.deepseek.com/a/chat/s/capture-exclusion',
      'https://mail.google.com/mail/u/0/#inbox', 'https://outlook.office.com/mail/inbox'
    ]) {
      await navigate('https://jobs.example.test/capture-eligibility');
      await until(() => read('!document.getElementById("capture-current-job").hidden&&!document.getElementById("capture-current-job").disabled'), 'job page restores capture');
      await navigate(url);
      await until(() => read('document.getElementById("capture-current-job").hidden&&document.getElementById("capture-current-job").disabled'), 'AI and mail pages disable capture');
      for (const showChat of [false, true]) {
        await read(`if(document.getElementById('chat-view').hidden===${showChat})document.getElementById('chat-dock-toggle').click()`);
        assert.equal(await read('document.getElementById("capture-current-job").hidden&&document.getElementById("capture-current-job").disabled'), true, url);
      }
      await read('document.getElementById("job-url").value="https://jobs.example.test/manually-entered";document.getElementById("job-url").dispatchEvent(new Event("input",{bubbles:true}))');
      assert.equal(await read('document.getElementById("capture-current-job").hidden'), true, 'typing a job URL cannot bypass the selected tab exclusion');
      await read('(()=>{const b=document.getElementById("capture-current-job");b.disabled=false;b.click();b.disabled=true})()');
      assert.equal(await read('captureEligibilityRequests'), 0, 'direct activation must not ask for site access');
    }
    await navigate('https://jobs.example.test/capture-eligibility');
    await until(() => read('!document.getElementById("capture-current-job").hidden&&!document.getElementById("capture-current-job").disabled'), 'returning to a job restores capture');
  } finally {
    await read('chrome.permissions.request=captureEligibilityPermissionRequest;delete globalThis.captureEligibilityPermissionRequest;delete globalThis.captureEligibilityRequests');
    await read(`if(document.getElementById('chat-view').hidden===${expanded})document.getElementById('chat-dock-toggle').click();chrome.tabs.remove(${tab.id})`);
  }
}

export async function checkCurrentJobUI({ cdp, panel, read, click, until, screenshot, frameSession, evaluate, checkChatViewportAcrossCollapse }) {
  const url = 'https://jobs.example.test/extract/jsonld-graph';
  const rows = () => read('import(chrome.runtime.getURL("src/queue-store.mjs")).then(module=>module.createQueueStore().read()).then(state=>state.requests)');
  const visible = () => read('!document.getElementById("capture-current-job").hidden');
  const tab = await read('chrome.tabs.create({url:"about:blank#capture",active:true})');
  const candidate = await read('document.getElementById("candidate").value');
  const before = await rows();
  const navigate = async target => {
    await read(`chrome.tabs.update(${tab.id},{url:${JSON.stringify(target)},active:true})`);
    await until(() => read(`chrome.tabs.get(${tab.id}).then(tab=>tab.status==="complete" && tab.url===${JSON.stringify(target)})`), 'capture source page loaded');
  };
  await until(async () => !await visible(), 'non-web tab has no capture button');
  await read('document.getElementById("job-url").value="https://jobs.example.test/manual-only";document.getElementById("job-url").dispatchEvent(new Event("input",{bubbles:true}))');
  assert.equal(await visible(), false, 'typed job URL cannot make a non-web tab eligible');
  await navigate(url);
  await until(visible, 'valid tab URL shows capture before site access is granted');
  await cdp.send('Page.bringToFront', {}, panel);
  await read('globalThis.captureOriginalPermissionRequest=chrome.permissions.request;chrome.permissions.request=()=>Promise.resolve(false)');
  try {
    await click('#capture-current-job');
    assert.equal((await rows()).length, before.length, 'denied site access saves nothing');
    assert.equal(await visible(), true, 'denied capture can be retried');
    assert.equal(await read('document.getElementById("capture-current-job").disabled'), false);
    assert.equal(await read('document.getElementById("manual-job-dialog").open'), true);
    assert.match(await read('document.getElementById("manual-job-reason").textContent'), /not granted/);
    assert.equal(await read('document.getElementById("manual-job-url").value'), url);
    await click('#manual-job-dialog [data-close-dialog]');
    await read('if(document.getElementById("chat-view").hidden)document.getElementById("chat-dock-toggle").click()');
    await checkChatViewportAcrossCollapse(frameSession, '#prompt-textarea');

    // Keep Chrome's consent dialog deterministic; grant real temporary access
    // with its action before resolving the mocked permission response.
    const id = await read('chrome.runtime.id');
    const source = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(target => target.url === url);
    assert.ok(source);
    await cdp.send('Extensions.triggerAction', { id, targetId: source.targetId });
    await cdp.send('Page.bringToFront', {}, panel);
    await read('chrome.permissions.request=()=>new Promise(resolve=>{globalThis.captureApprove=resolve})');
    await read('document.getElementById("capture-current-job").click()');
    assert.equal(await read('document.getElementById("capture-current-job").disabled'), true);
    await navigate('about:blank#changed-during-capture');
    await read('captureApprove(true);delete globalThis.captureApprove');
    await until(() => read('document.documentElement.dataset.studioBusy!=="true"'), 'navigation cancels capture');
    assert.equal((await rows()).length, before.length, 'navigation during permission request cannot save the wrong page');
    assert.equal(await read('document.getElementById("manual-job-dialog").open'), true);
    assert.equal(await read('document.getElementById("manual-job-url").value'), url, 'cancelled navigation keeps the original listing URL');
    await click('#manual-job-dialog [data-close-dialog]');
    await navigate(url);
    await until(visible, 'capture returns on valid page');
    // Navigating away revokes activeTab, so grant access for the new document.
    const reloaded = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(target => target.url === url);
    await cdp.send('Extensions.triggerAction', { id, targetId: reloaded.targetId });
    await cdp.send('Page.bringToFront', {}, panel);
    await read('chrome.permissions.request=()=>Promise.resolve(true);if(document.getElementById("chat-view").hidden)document.getElementById("chat-dock-toggle").click()');
    await until(() => read('!document.getElementById("capture-current-job").disabled'), 'capture ready over expanded chat');
    for (const width of [280, 390, 800]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
      assert.equal(await read(`(() => {
        const button=document.getElementById('capture-current-job'), bounds=button.getBoundingClientRect();
        const bar=document.querySelector('.dock-status-bar').getBoundingClientRect(), chat=document.getElementById('chat-view').getBoundingClientRect();
        return bounds.height===60 && bounds.left===0 && bounds.right===innerWidth && bounds.bottom===bar.top &&
          bar.bottom===chat.top && document.elementFromPoint(bounds.width/2,bounds.top+bounds.height/2)?.closest('button')===button &&
          document.documentElement.scrollWidth<=innerWidth;
      })()`), true, 'capture stays visible and clickable above chat at '+width);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    await screenshot('workspace-one-click.png');
    await evaluate(frameSession, 'document.getElementById("prompt-textarea").value="Keep my unsent draft"');
    // A stale/manual form must never become the one-click job snapshot.
    await read('document.getElementById("job-company").value="Wrong draft company";document.getElementById("job-description").value="Wrong draft description"');
    await click('#capture-current-job');
    const added = (await rows()).filter(row => !before.some(old => old.id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].input.job.url, url);
    assert.equal(added[0].input.candidateId, candidate);
    assert.notEqual(added[0].input.job.company, 'Wrong draft company');
    assert.notEqual(added[0].input.job.description, 'Wrong draft description');
    assert.equal(added[0].state, 'queued');
    assert.equal(Boolean(added[0].capturePending), false, 'AI analysis defaults off and saves extraction directly');
    assert.equal(await read(`Boolean(document.querySelector('[data-request-id="${added[0].id}"]'))`),true);
    assert.equal(added[0].attempts, undefined);
    assert.equal(await visible(), false, 'saved URL hides capture immediately');
    assert.equal(await read('document.getElementById("chat-view").hidden'), false);
    assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep my unsent draft');
    await navigate(url+'?utm_source=mail');
    assert.equal(await visible(), false, 'tracking parameters do not offer to add an existing job');
    await read('document.getElementById("candidate").value="jordan";document.getElementById("candidate").dispatchEvent(new Event("change"))');
    await until(visible, 'candidate without this job can capture it');
    await read(`document.getElementById("candidate").value=${JSON.stringify(candidate)};document.getElementById("candidate").dispatchEvent(new Event("change"))`);
    await until(async () => !await visible(), 'returning to the saved candidate hides capture');
    await navigate('chrome://settings/');
    assert.equal(await visible(), false, 'Chrome pages never offer job capture');
  } finally {
    await read(`(async()=>{const reply=await chrome.runtime.sendMessage({type:'generation.list'});for(const run of reply.value || [])if(run.kind==='job-cleanup')await chrome.runtime.sendMessage({type:'generation.stop',id:run.id});const{createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));const queue=createJobQueue();await queue.ready;try{for(const request of queue.snapshot().requests)if(request.capturePending)await queue.cancel(request.id);}finally{queue.dispose();}})()`);
    await read('chrome.permissions.request=captureOriginalPermissionRequest;delete globalThis.captureOriginalPermissionRequest');
    await read(`chrome.tabs.remove(${tab.id})`);
  }
}
