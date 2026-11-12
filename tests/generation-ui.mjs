import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkGenerationUI({ cdp, panel, read, click, evaluate, until, targets, session, artifacts, workerSession, deepseekSingle = false }) {
  const extensionUrl = await read('chrome.runtime.getURL("index.html")');
  const rpc = (type, args = {}) => read(`chrome.runtime.sendMessage(${JSON.stringify({ type: 'generation.' + type, ...args })}).then(reply=>{if(!reply.ok)throw Error(reply.error);return reply.value})`);
  const storedRuns = () => evaluate(workerSession, `new Promise((resolve,reject)=>{
    const opening=indexedDB.open('ai-agent-document-runs',1);
    opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('runs'),request=tx.objectStore('runs').getAll();
      tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>{db.close();reject(tx.error)};};
  })`);
  const findRun = async jobId => (await storedRuns()).find(run => run.jobId === jobId);
  const singleCases = [
    { provider:'deepseek', mode:'keyboard', reload:true },
    { provider:'deepseek', mode:'deepseek-live-transcript', reuse:true, retainTab:true },
    { provider:'deepseek', mode:'deepseek-copy-status', reuse:true, reusePrevious:true },
    { provider:'deepseek', mode:'deepseek-result-class', reuse:true },
    { provider:'deepseek', mode:'deepseek-existing', reuse:true, savedChat:true },
    { provider:'deepseek', mode:'deepseek-existing-next-turn', reuse:true, savedChat:true },
    { provider:'deepseek', mode:'deepseek-draft-mirror', reuse:true },
    ...['span','parts','thinking','streaming','audio','invalid'].map(layout => ({provider:'deepseek',mode:'deepseek-native-'+layout,reuse:true})),
    {provider:'deepseek',mode:'deepseek-native-pause',reuse:true,pauseTracking:true},
    { provider:'deepseek', mode:'invalid' }
  ];
  const cases = deepseekSingle ? singleCases : [{ provider: 'chatgpt', mode: 'rich-current', autoOpen: true, closeResume: true },
    { provider:'chatgpt', mode:'job-enrichment' }, { provider:'deepseek', mode:'job-enrichment', reuse:true },
    { provider: 'chatgpt', mode: 'wrapper' }, { provider: 'chatgpt', mode: 'rich', reopen: true },
    { provider: 'chatgpt', mode: 'wrapper-draft' }, { provider: 'chatgpt', mode: 'rich-draft' }, { provider: 'chatgpt', mode: 'rich-paste' },
    { provider: 'chatgpt', mode: 'rich-draft-preview' }, { provider: 'chatgpt', mode: 'rich-no-link' },
    { provider: 'chatgpt', mode: 'rich-no-user' }, { provider: 'chatgpt', mode: 'rich-manual-no-link' },
    { provider: 'chatgpt', mode: 'rich-existing', savedChat: true },
    { provider: 'chatgpt', mode: 'rich-remount' }, { provider: 'chatgpt', mode: 'rich-keyboard' }, { provider: 'chatgpt', mode: 'rich-manual' },
    { provider: 'chatgpt', mode: 'rich-current', reload: true }, { provider: 'chatgpt', mode: 'rich-search' },
    { provider: 'chatgpt', mode: 'rich-current-no-user' }, { provider: 'chatgpt', mode: 'rich-current-streaming' },
    { provider: 'chatgpt', mode: 'rich-current-next-turn' }, { provider: 'chatgpt', mode: 'rich-current-multi-code' },
    { provider: 'deepseek', mode: 'keyboard', reload: true }, { provider: 'deepseek', mode: 'invalid' },
    { provider: 'deepseek', mode: 'deepseek-draft-mirror', reuse: true },
    { provider: 'chatgpt', mode: 'rich-current', busyActive: true },
    { provider: 'deepseek', mode: 'deepseek-existing', reuse: true, savedChat: true },
    { provider: 'deepseek', mode: 'deepseek-existing-next-turn', reuse: true, busyActive: true, savedChat: true },
    { provider: 'deepseek', mode: 'keyboard', allBusy: true },
    { provider: 'chatgpt', mode: 'rich-existing', freshChat: true, busyActive: true },
    { provider: 'deepseek', mode: 'deepseek-existing', reuse: true, freshChat: true, busyActive: true },
    ...singleCases.slice(1, 4).map(({ retainTab, reusePrevious, ...scenario }) => scenario),
    ...singleCases.filter(scenario => scenario.mode.startsWith('deepseek-native'))];
  let total = 0, retainedTab = null;
  for (const scenario of cases) {
    const currentLayout = scenario.mode.startsWith('rich-current') || scenario.mode.startsWith('rich-search');
    const invalid = scenario.mode === 'invalid' || scenario.mode === 'deepseek-native-invalid' || scenario.mode === 'rich-current-multi-code';
    const home = scenario.provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://chat.deepseek.com/';
    const existingUrl = home + (scenario.provider === 'chatgpt' ? 'c/existing-thread' : 'a/chat/s/existing-thread');
    const usesExisting = !scenario.autoOpen && !scenario.allBusy && (scenario.provider === 'chatgpt' || scenario.reuse);
    const busyTabs = [];
    const composerReady = tabSession => until(async () => {
      try { return await evaluate(tabSession, `(()=>{
        const editor=document.querySelector('#chat-input, #prompt-textarea[contenteditable], #prompt-textarea textarea, #actual-editor');
        return document.body?.dataset.generationFixtureMode === ${JSON.stringify(scenario.mode)} && document.readyState === 'complete' && Boolean(editor?.getClientRects().length) && getComputedStyle(editor).visibility!=='hidden';
      })()`); }
      catch { return false; }
    }, 'user-opened provider composer ready');
    const busySnapshot = tabSession => evaluate(tabSession, `(()=>{
      const editor=document.querySelector('#chat-input, #prompt-textarea[contenteditable], #prompt-textarea textarea, #actual-editor');
      return {url:location.href,text:editor?.value??editor?.textContent,body:document.body.textContent,busy:document.body.dataset.fixtureBusy,sent:document.body.dataset.runMarkersSent||null};
    })()`);
    const markBusy = async (tab, tabSession) => {
      const path = scenario.provider === 'chatgpt' ? '/c/' : '/a/chat/s/';
      await evaluate(tabSession, `history.replaceState({},'',${JSON.stringify(path + 'busy-fixture-' + total)});generationFixtureSetBusy(true);`);
      busyTabs.push({ targetId:tab.targetId, session:tabSession, snapshot:await busySnapshot(tabSession) });
    };
    if (scenario.reusePrevious) assert.ok(retainedTab, 'the next job reuses the preceding completed job tab');
    const setup = scenario.reusePrevious ? retainedTab : await cdp.send('Target.createTarget', { url: home });
    const setupSession = await session(setup.targetId); retainedTab = null;
    await until(async () => {
      try { return await evaluate(setupSession, `location.origin === ${JSON.stringify(new URL(home).origin)} && document.readyState === "complete"`); }
      catch { return false; } // Target.createTarget can initially expose its about:blank document.
    }, 'fixture setup');
    await evaluate(setupSession, `localStorage.setItem('generationFixtureEnabled','yes');localStorage.setItem('generationFixtureMode',${JSON.stringify(scenario.mode)});localStorage.setItem('generationFixtureDelay',${JSON.stringify(scenario.reopen || scenario.reload || scenario.closeResume || scenario.pauseTracking ? '5000' : '900')});`);
    const beforeCount = await evaluate(setupSession, 'Number(localStorage.getItem("generationSendCount")||0)');
    if (usesExisting || scenario.allBusy) {
      await evaluate(setupSession, `localStorage.removeItem(${JSON.stringify('generationThread:' + new URL(existingUrl).pathname)})`);
      await cdp.send('Page.navigate', { url: scenario.savedChat || scenario.freshChat ? existingUrl : `${home}?fixture=${total}` }, setupSession);
      await composerReady(setupSession);
      if (scenario.freshChat) assert.equal(await evaluate(setupSession, 'document.querySelector("main").textContent.includes("Earlier unrelated answer")'), true);
      if (scenario.allBusy) await markBusy(setup, setupSession);
      await cdp.send('Page.bringToFront', {}, setupSession);
    } else await cdp.send('Target.closeTarget', { targetId: setup.targetId });
    if (!usesExisting) {
      // The full workspace suite can leave fixture chat tabs open. This case
      // specifically exercises the missing-tab fallback in the isolated profile.
      for (const tab of (await targets()).filter(item => item.type === 'page' && item.url.startsWith(home) && !busyTabs.some(busy=>busy.targetId===item.targetId))) await cdp.send('Target.closeTarget', { targetId: tab.targetId });
      await until(() => evaluate(workerSession, `chrome.tabs.query({url:${JSON.stringify(home + '*')}}).then(tabs=>tabs.length===${busyTabs.length})`), 'only expected provider fixture tabs remain');
    }
    if (scenario.busyActive) {
      const busy = await cdp.send('Target.createTarget', { url:`${home}?fixture-busy=${total}` }), busySession = await session(busy.targetId);
      await composerReady(busySession); await markBusy(busy, busySession);
    }
    const jobId = await read(`(async()=>{
      const {createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));
      const {exampleProfile}=await import(chrome.runtime.getURL('src/resume-data.mjs'));
      const queue=createJobQueue();await queue.ready;
      const candidate=await queue.importProfile(JSON.stringify(exampleProfile),'Generation fixture.json');
      const id=await queue.add({candidateId:candidate,profile:exampleProfile,tailor:true,resumeTemplate:'kakuna',promptTemplate:'focused',
        job:{company:'Generation Test ${++total}',role:'Engineer',url:'https://jobs.example.test/generation-${total}',description:'Build services.\\nQuotes " and <literal> characters.\\n'.repeat(350)}});
      ${scenario.savedChat ? `await queue.connect(id, ${JSON.stringify(existingUrl)});` : ''}
      await queue.selectCandidate(candidate);queue.dispose();return id;
    })()`);
    await read(`document.getElementById('chat-provider').value=${JSON.stringify(scenario.provider)};document.getElementById('chat-provider').dispatchEvent(new Event('change'));`);
    await until(() => read('!document.getElementById("chat-provider").disabled'), 'provider selected');
    // Reopening the dock may preserve a different candidate; explicitly select the new job's candidate.
    const candidate = await read(`import(chrome.runtime.getURL('src/queue-store.mjs')).then(m=>m.createQueueStore().read()).then(s=>s.requests.find(j=>j.id===${JSON.stringify(jobId)}).input.candidateId)`);
    await until(() => read(`Boolean(document.querySelector('#candidate option[value="${candidate}"]'))`), 'candidate imported');
    await read(`document.getElementById('candidate').value=${JSON.stringify(candidate)};document.getElementById('candidate').dispatchEvent(new Event('change'));document.getElementById('open-queue').click();`);
    const selector = `[data-request-id="${jobId}"] [data-action="generate"]`;
    await until(() => read(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), 'Generate documents button');
    if (busyTabs.length) await cdp.send('Page.bringToFront', {}, busyTabs.at(-1).session);
    const beforeTabs = await evaluate(workerSession, 'chrome.tabs.query({}).then(tabs=>tabs.length)');
    await click(selector);
    await until(async () => Boolean((await findRun(jobId))?.submittedAt) || ['attention','invalid'].includes((await findRun(jobId))?.phase), 'submission confirmed', 22000).catch(async error => {
      const run = await findRun(jobId);
      throw new Error(`${scenario.provider}/${scenario.mode}: ${error.message}; phase=${run?.phase}; code=${run?.code}; error=${run?.error}; url=${run?.url}`);
    });
    let run = await findRun(jobId);
    if (scenario.mode.startsWith('rich-manual')) {
      assert.equal(run.phase, 'attention'); assert.equal(run.sendIntentAt, null, 'disabled Send is never bypassed with Enter');
      assert.match(run.error, /enable its Send button/);
      assert.equal(run.diagnostics.stage, 'send_button');
      assert.equal(run.diagnostics.textMatches, true);
      assert.equal(run.diagnostics.dispatched, false);
      await click(`[data-request-id="${jobId}"] [data-action="details"]`);
      assert.equal(await read('document.querySelector("#request-generation-section, #copy-generation-diagnostics")'), null);
      await click('#request-dialog [data-close-dialog]');
      const manualSession = setupSession;
      await cdp.send('Page.bringToFront', {}, manualSession);
      await evaluate(manualSession, 'generationFixtureEnableSend();document.getElementById("prompt-textarea").focus()');
      for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, manualSession);
      await evaluate(workerSession, `chrome.storage.session.remove(${JSON.stringify('document-generation-tab:')} + ${run.tabId})`);
      await rpc('open', { id: run.id, resume: true });
      await until(async () => Boolean((await findRun(jobId))?.submittedAt), 'manual send recovered');
      run = await findRun(jobId);
      assert.equal(run.submissionSource, 'observed');
      const actualUrl = await evaluate(workerSession, `chrome.tabs.get(${run.tabId}).then(tab=>tab.url)`);
      assert.equal((await targets()).filter(item => item.type === 'page' && item.url === actualUrl).length, 1, 'Resume reclaims the existing tab after session bindings are cleared');
    }
    if (!run.submittedAt) {
      const target = (await targets()).find(target => target.type === 'page' && target.url === home);
      const details = target ? await evaluate(await session(target.targetId), `(()=>{const e=document.querySelector('#prompt-textarea, #chat-input');return {editor:e?.outerHTML,input:e?.value,text:e?.innerText,sendDisabled:document.querySelector('#composer-submit-button')?.disabled}})()`) : null;
      await writeFile(join(artifacts, 'generation-failure.json'), JSON.stringify({ phase:run.phase, error:run.error, expected:run.prompt, details }, null, 2));
    }
    assert.ok(run.submittedAt, `${scenario.provider}/${scenario.mode}: ${run.phase}: ${run.error || ''}`);
    const noLink = scenario.mode.includes('no-link') || scenario.mode === 'rich-no-user';
    if (noLink) assert.equal(run.url, null, 'submission succeeds without a conversation link');
    else assert.ok(run.url, `${scenario.provider}/${scenario.mode}: conversation URL saved after fixture submission`);
    const actualUrl = await evaluate(workerSession, `chrome.tabs.get(${run.tabId}).then(tab=>tab.url)`);
    let target = await until(async () => (await targets()).find(target => target.type === 'page' && target.url === actualUrl), 'generation browser tab');
    let tabSession = await session(target.targetId);
    if (usesExisting) assert.equal(target.targetId, setup.targetId, 'generation selects the existing idle tab');
    else assert.notEqual(target.targetId, setup.targetId, 'generation opens a new provider tab when no idle tab is available');
    assert.equal(await evaluate(workerSession, 'chrome.tabs.query({}).then(tabs=>tabs.length)'), beforeTabs + Number(!usesExisting), 'only create a tab when needed');
    if (deepseekSingle) assert.equal((await targets()).filter(item => item.type === 'page' && item.url.startsWith(home)).length, 1, 'only one DeepSeek tab participates');
    if (scenario.provider === 'chatgpt') {
      assert.equal(await evaluate(tabSession, 'Number(document.body.dataset.pasteCount || 0)'), 0, 'no paste event that could create a text attachment');
      assert.equal(await evaluate(tabSession, 'document.querySelectorAll("[data-testid=attachment-preview]").length'), 0);
      assert.equal(await evaluate(tabSession, 'Number(document.body.dataset.sendClicks || 0)'), 0, 'submission uses Enter');
      assert.equal(await evaluate(tabSession, 'Number(document.body.dataset.enterCount || 0)'), 1);
    }
    if (scenario.mode === 'deepseek-draft-mirror') {
      assert.equal(await evaluate(tabSession, 'document.body.dataset.draftMirrorCreated'), 'true', 'fixture renders a plain draft mirror outside the composer form');
      assert.equal(await evaluate(tabSession, 'Number(document.body.dataset.sendClicks || 0)'), 0, 'no labelled send control exists');
      assert.equal(await evaluate(tabSession, 'Number(document.body.dataset.enterCount || 0)'), 1, 'the draft mirror cannot bypass the actual Enter submission');
      assert.ok(run.sendIntentAt, 'submission authorization is persisted before Enter');
      assert.notEqual(run.submissionSource, 'observed', 'the draft is not recorded as a manually observed submission');
    }
    if (scenario.mode === 'rich-existing' && scenario.savedChat) {
      assert.equal(run.url, 'https://chatgpt.com/c/existing-thread');
      assert.deepEqual(run.baseline, { users: 1, answers: 1 });
    }
    if (scenario.mode.startsWith('deepseek-existing') && scenario.savedChat) {
      assert.equal(run.url, 'https://chat.deepseek.com/a/chat/s/existing-thread');
      assert.deepEqual(run.baseline, { users:1, answers:1 }); assert.equal(run.usesExistingTab, true);
      assert.equal(await evaluate(tabSession, 'document.querySelector("main").textContent.includes("Earlier unrelated answer")'), true, 'reusing DeepSeek keeps previous history');
    }
    if (scenario.freshChat) {
      assert.equal(await evaluate(tabSession, 'document.body.dataset.submittedFrom'), home, 'new jobs submit only after the idle tab loads the home page');
      assert.equal(run.url, home + (scenario.provider === 'chatgpt' ? 'c/' : 'a/chat/s/') + run.id);
      assert.deepEqual(run.baseline, { users: 0, answers: 0 }); assert.equal(run.usesExistingTab, false);
      assert.equal(await evaluate(tabSession, 'document.querySelector("main").textContent.includes("Earlier unrelated answer")'), false);
    }
    assert.equal(await evaluate(tabSession, 'document.body.dataset.sentOldDraft'), 'false', 'old draft text is never appended to the job prompt');
    assert.equal(await evaluate(tabSession, 'document.body.dataset.runMarkersSent'), '1', 'only one complete prompt is inserted');
    if (scenario.mode === 'rich-remount') assert.equal(await evaluate(tabSession, 'document.body.dataset.editorReplaced'), 'true');
    if (currentLayout) assert.equal(await evaluate(tabSession, 'document.querySelectorAll("[data-message-author-role]").length'), 0, 'new-layout capture cannot depend on legacy role markers');
    else assert.equal(await evaluate(tabSession, 'document.querySelector("#composer-submit-button, #chat-input, #prompt-textarea")'), null, 'capture continues after composer removal');
    await rpc('start', { jobId, provider: scenario.provider }); // A repeated request only opens the bound tab.
    if (scenario.closeResume) {
      const oldTabId = run.tabId;
      await cdp.send('Target.closeTarget', { targetId: target.targetId });
      await until(async () => (await findRun(jobId))?.code === 'tab-closed', 'closed run awaits Resume');
      await Promise.all([rpc('open', { id: run.id, resume: true }), rpc('open', { id: run.id, resume: true })]);
      assert.notEqual((await findRun(jobId)).tabId, oldTabId, 'Resume binds a new tab');
      target = await until(async () => (await targets()).find(item => item.type === 'page' && item.url === actualUrl), 'saved conversation reopened');
      tabSession = await session(target.targetId);
      assert.equal((await targets()).filter(item => item.type === 'page' && item.url === actualUrl).length, 1, 'concurrent Resume creates one saved-chat tab');
    }
    if (scenario.reload) await cdp.send('Page.reload', {}, tabSession);
    if (scenario.pauseTracking) {
      // Model an observer that exited without delivering its error, while the
      // provider still owns and finishes the original submitted prompt.
      await evaluate(workerSession, `chrome.tabs.sendMessage(${run.tabId},{type:'generation.stop',id:${JSON.stringify(run.id)}})`);
      await evaluate(workerSession, `new Promise((resolve,reject)=>{
        const opening=indexedDB.open('ai-agent-document-runs',1);
        opening.onerror=()=>reject(opening.error);
        opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('runs','readwrite'),store=tx.objectStore('runs'),get=store.get(${JSON.stringify(run.id)});
          get.onsuccess=()=>store.put({...get.result,lastSeenAt:Date.now()-60000});
          tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)};};
      })`);
      await rpc('list',{health:true});
      await until(() => read(`document.querySelector('[data-request-id="${jobId}"] .generation-status')?.textContent.includes('Tracking paused')`), 'expired DeepSeek heartbeat is visible');
      const oldIntent = run.sendIntentAt, oldTab = run.tabId;
      await click(`[data-request-id="${jobId}"] [data-action="resume-generation"]`);
      run = await findRun(jobId);
      assert.equal(run.sendIntentAt, oldIntent); assert.equal(run.tabId, oldTab);
    }
    if (scenario.reopen) await cdp.send('Page.navigate', { url: 'about:blank' }, panel);
    await until(async () => ['complete', 'invalid', 'attention'].includes((await findRun(jobId))?.phase), 'generation result saved');
    run = await findRun(jobId);
    assert.equal(run.phase, invalid ? 'invalid' : 'complete', `${scenario.provider}/${scenario.mode}: ${run.error || ''}`);
    if (scenario.reopen) {
      await cdp.send('Page.navigate', { url: extensionUrl }, panel);
      await until(() => read('document.documentElement.dataset.studioReady === "true"'), 'dock reopened');
    }
    if (currentLayout) {
      assert.equal(run.captureDiagnostics.stage, 'capture'); assert.equal(run.captureDiagnostics.generationActive, false);
      assert.equal(run.captureDiagnostics.codeBlocks, invalid ? 2 : 1);
      assert.equal(run.captureDiagnostics.sendEnabled, !scenario.mode.startsWith('rich-search'));
      assert.equal(await evaluate(tabSession, 'JSON.parse(localStorage.getItem("generationThread:" + location.pathname + location.search)).complete'), true, 'complete JSON during streaming cannot finish the run early');
      if (scenario.mode === 'rich-current-no-user') assert.equal(run.captureDiagnostics.userMatched, false);
    }
    assert.ok(run.raw.includes(run.id));
    if (scenario.mode.startsWith('deepseek-native')) {
      assert.equal(await evaluate(tabSession, 'document.querySelectorAll(".md-code-block pre code").length'), 0);
      assert.equal(run.captureDiagnostics.extraction, 'pre'); assert.equal(run.captureDiagnostics.codeBlocks, 1);
      assert.equal(run.captureDiagnostics.conversationFound, true);
      assert.equal(run.captureDiagnostics.completionControl, scenario.mode === 'deepseek-native-invalid');
      assert.equal(run.captureDiagnostics.replyParts, scenario.mode === 'deepseek-native-parts' ? 2 : 1);
      assert.equal(run.captureDiagnostics.generationActive, false);
      assert.equal(await evaluate(tabSession, 'JSON.parse(localStorage.getItem("generationThread:"+location.pathname+location.search)).complete'), true, 'final capture waits for native streaming to end');
      assert.doesNotThrow(() => JSON.parse(run.raw), 'only code content is captured, without banner or reasoning text');
    }
    if (!invalid) {
      const company = scenario.mode === 'job-enrichment' ? 'Verified Employer' : `Generation Test ${total}`;
      assert.equal(run.result.resume.company, company);
      assert.equal(run.result.coverLetter, `A generated cover letter for ${company}`);
      await until(()=>read(`document.querySelector('[data-request-id="${jobId}"] .request-title strong')?.textContent===${JSON.stringify(company)}`),'card updates from AI before document approval');
      const enriched = await read(`import(chrome.runtime.getURL('src/queue-store.mjs')).then(m=>m.createQueueStore().read()).then(s=>s.requests.find(j=>j.id===${JSON.stringify(jobId)}))`);
      assert.equal(enriched.input.job.company, company); assert.equal(enriched.input.job.salarySource, 'estimated');
      if (scenario.mode === 'job-enrichment') {
        assert.equal(enriched.input.job.role,'Platform Engineer');
        assert.equal(enriched.input.job.description,'Build reliable TypeScript services. Requirements: TypeScript and SQL.');
      }
    }
    if (scenario.mode === 'deepseek-live-transcript') assert.equal(await evaluate(tabSession, 'document.querySelector("main").getAttribute("aria-live")'), 'polite');
    if (scenario.mode === 'deepseek-copy-status') assert.equal(await evaluate(tabSession, 'Boolean(document.querySelector(".ds-markdown [role=status]"))'), true);
    if (scenario.mode === 'deepseek-result-class') {
      assert.equal(await evaluate(tabSession, 'Boolean(document.querySelector(".result-streaming"))'), true, 'a persistent styling class does not block final capture');
      assert.equal(await evaluate(tabSession, 'JSON.parse(localStorage.getItem("generationThread:" + location.pathname + location.search)).complete'), true, 'complete JSON is not captured until real streaming stops');
    }
    if (scenario.mode === 'deepseek-existing-next-turn') assert.notEqual(run.result.coverLetter, 'WRONG_NEXT_TURN', 'a later user turn cannot replace this run’s response');
    assert.equal(await evaluate(tabSession, 'Number(localStorage.getItem("generationSendCount"))'), beforeCount + 1, 'exactly one fixture submission through duplicate click and reload');
    await until(() => read(`Boolean(document.querySelector('[data-request-id="${jobId}"] [data-action="review-generation"]'))`), 'Review documents action');
    if (!await read('document.getElementById("documents-dialog").open')) await click(`[data-request-id="${jobId}"] [data-action="review-generation"]`);
    assert.equal(await read('document.getElementById("documents-dialog").open'), true);
    if (invalid) {
      assert.match(run.error, scenario.mode === 'invalid' || scenario.mode === 'deepseek-native-invalid' ? /company does not match/ : /exactly one complete JSON object/);
      assert.equal(await read('document.getElementById("documents-save").disabled'), true);
      await click('#documents-dialog [data-close-dialog]');
    } else {
      assert.equal(await read('document.getElementById("documents-save").disabled'), false);
      assert.ok((await read('document.getElementById("documents-cover-letter").value')).includes(scenario.mode === 'job-enrichment' ? 'Verified Employer' : 'Generation Test'));
      await click('#documents-save');
      await until(() => read('!document.getElementById("documents-dialog").open'), 'documents approved');
      const saved = await read(`import(chrome.runtime.getURL('src/queue-store.mjs')).then(m=>m.createQueueStore().read()).then(s=>s.requests.find(j=>j.id===${JSON.stringify(jobId)}))`);
      assert.equal(saved.state, 'ready'); assert.equal(saved.documentRunId, run.id); assert.equal(saved.manualChatUrl || null, run.url || null);
    }
    for (const busy of busyTabs) {
      assert.deepEqual(await busySnapshot(busy.session), busy.snapshot, 'busy chat URL, draft and response are untouched');
      await cdp.send('Target.closeTarget', { targetId:busy.targetId });
    }
    if (scenario.retainTab) retainedTab = target;
    else await cdp.send('Target.closeTarget', { targetId: target.targetId });
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, panel);
  await writeFile(join(artifacts, 'document-generation.png'), Buffer.from(shot.data, 'base64'));
  if (deepseekSingle) return [
    'single DeepSeek tab submits once and captures the matching job reply, including after reload',
    'DeepSeek composer draft mirrors do not bypass Enter or become posted-message receipts',
    'accessible aria-live transcripts and code-copy status descendants retain final answers',
    'complete JSON waits for actual streaming to stop while a persistent styling class cannot block capture',
    'two sequential jobs reuse the same tab without mixing replies',
    'saved conversation capture excludes earlier history, reasoning and later user turns',
    'native pre/span code with absent or unlabelled sibling toolbars is captured without banner text',
    'response parts and dedicated final-answer containers exclude reasoning and unrelated audio activity',
    'expired DeepSeek tracking shows Resume and captures the original response without a second send',
    'invalid output remains reviewable and cannot replace approved documents'
  ];
  return ['ChatGPT wrapper and rich editors accept long multiline prompts', 'DeepSeek keyboard submission and reasoning exclusion',
    'DeepSeek submits once with Enter despite an unlabelled draft mirror outside its composer',
    'DeepSeek native pre/span layouts and missing hover controls capture after streaming; lost tracking resumes without resending',
    'ChatGPT opens a home tab when absent and Resume reopens the saved conversation to capture without resending',
    'both providers skip the active busy chat and reuse another idle tab without modifying the busy chat',
    'both providers start new jobs at home in the reused idle tab and preserve explicitly saved conversations',
    'DeepSeek reuses saved history, captures before the next user turn, and creates a new tab when all chats are busy',
    'DeepSeek captures accessible transcripts and code-copy status descendants, ignoring a persistent styling class after real streaming ends',
    'ChatGPT current turn/search layouts and CodeMirror JSON panels captured without legacy message markers',
    'ready Send or final reply controls trigger code-block capture only after streaming stops',
    'thinking JSON, later replies and duplicate code blocks cannot replace the requested final result',
    'ChatGPT replaces textarea and rich-editor drafts with native plain text, without paste or attachments',
    'ChatGPT uses the user-opened tab and sends once with Enter, including saved conversations',
    'draft preview text is not a submitted-message receipt', 'ChatGPT automatic and manual reply capture without a conversation URL',
    'verified ChatGPT sending and capture without a rendered user-message row',
    'ChatGPT editor remounts, external Send controls, and Enter submission', 'manual submission recovered after session binding loss without another send',
    'ChatGPT final reply chosen after thinking and before another user turn',
    'submission acknowledged after Send and composer disappear', 'duplicate actions and tab reload do not resend',
    'results survive closing and reopening the dock', 'invalid replies retained; documents require review before saving'];
}
