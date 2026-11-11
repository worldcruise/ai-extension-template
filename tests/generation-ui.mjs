import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkGenerationUI({ cdp, panel, read, click, evaluate, until, targets, session, artifacts, workerSession }) {
  const extensionUrl = await read('chrome.runtime.getURL("index.html")');
  const rpc = (type, args = {}) => read(`chrome.runtime.sendMessage(${JSON.stringify({ type: 'generation.' + type, ...args })}).then(reply=>{if(!reply.ok)throw Error(reply.error);return reply.value})`);
  const storedRuns = () => evaluate(workerSession, `new Promise((resolve,reject)=>{
    const opening=indexedDB.open('ai-agent-document-runs',1);
    opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('runs'),request=tx.objectStore('runs').getAll();
      tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>{db.close();reject(tx.error)};};
  })`);
  const findRun = async jobId => (await storedRuns()).find(run => run.jobId === jobId);
  const cases = [{ provider: 'chatgpt', mode: 'wrapper' }, { provider: 'chatgpt', mode: 'rich', reopen: true },
    { provider: 'chatgpt', mode: 'wrapper-draft' }, { provider: 'chatgpt', mode: 'rich-draft' }, { provider: 'chatgpt', mode: 'rich-paste' },
    { provider: 'chatgpt', mode: 'rich-draft-preview' }, { provider: 'chatgpt', mode: 'rich-no-link' },
    { provider: 'chatgpt', mode: 'rich-no-user' }, { provider: 'chatgpt', mode: 'rich-manual-no-link' },
    { provider: 'chatgpt', mode: 'rich-existing' },
    { provider: 'chatgpt', mode: 'rich-remount' }, { provider: 'chatgpt', mode: 'rich-keyboard' }, { provider: 'chatgpt', mode: 'rich-manual' },
    { provider: 'chatgpt', mode: 'rich-current', reload: true }, { provider: 'chatgpt', mode: 'rich-search' },
    { provider: 'chatgpt', mode: 'rich-current-no-user' }, { provider: 'chatgpt', mode: 'rich-current-streaming' },
    { provider: 'chatgpt', mode: 'rich-current-next-turn' }, { provider: 'chatgpt', mode: 'rich-current-multi-code' },
    { provider: 'deepseek', mode: 'keyboard', reload: true }, { provider: 'deepseek', mode: 'invalid' }];
  let total = 0;
  for (const scenario of cases) {
    const currentLayout = scenario.mode.startsWith('rich-current') || scenario.mode.startsWith('rich-search');
    const invalid = scenario.mode === 'invalid' || scenario.mode === 'rich-current-multi-code';
    const home = scenario.provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://chat.deepseek.com/';
    const setup = await cdp.send('Target.createTarget', { url: home }), setupSession = await session(setup.targetId);
    await until(async () => {
      try { return await evaluate(setupSession, `location.origin === ${JSON.stringify(new URL(home).origin)} && document.readyState === "complete"`); }
      catch { return false; } // Target.createTarget can initially expose its about:blank document.
    }, 'fixture setup');
    await evaluate(setupSession, `localStorage.setItem('generationFixtureEnabled','yes');localStorage.setItem('generationFixtureMode',${JSON.stringify(scenario.mode)});localStorage.setItem('generationFixtureDelay',${JSON.stringify(scenario.reopen || scenario.reload ? '5000' : '900')});`);
    const beforeCount = await evaluate(setupSession, 'Number(localStorage.getItem("generationSendCount")||0)');
    if (scenario.provider === 'chatgpt') {
      await cdp.send('Page.navigate', { url: `${home}?fixture=${total}` }, setupSession);
      await until(async () => {
        try { return await evaluate(setupSession, `document.body?.dataset.generationFixtureMode === ${JSON.stringify(scenario.mode)} && document.readyState === 'complete'`); }
        catch { return false; }
      }, 'user-opened ChatGPT tab ready');
      await cdp.send('Page.bringToFront', {}, setupSession);
    } else await cdp.send('Target.closeTarget', { targetId: setup.targetId });
    const jobId = await read(`(async()=>{
      const {createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));
      const {exampleProfile}=await import(chrome.runtime.getURL('src/resume-data.mjs'));
      const queue=createJobQueue();await queue.ready;
      const candidate=await queue.importProfile(JSON.stringify(exampleProfile),'Generation fixture.json');
      const id=await queue.add({candidateId:candidate,profile:exampleProfile,tailor:true,resumeTemplate:'kakuna',promptTemplate:'focused',
        job:{company:'Generation Test ${++total}',role:'Engineer',url:'https://jobs.example.test/generation-${total}',description:'Build services.\\nQuotes " and <literal> characters.\\n'.repeat(350)}});
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
      await read('document.getElementById("request-generation-section").open = true');
      await until(() => read('document.getElementById("request-generation-diagnostics").textContent.includes("send_button")'), 'submission diagnostics displayed');
      assert.equal(await read('document.getElementById("copy-generation-diagnostics").hidden'), false);
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
    const target = await until(async () => (await targets()).find(target => target.type === 'page' && target.url === actualUrl), 'generation browser tab');
    const tabSession = await session(target.targetId);
    if (scenario.provider === 'chatgpt') {
      assert.equal(target.targetId, setup.targetId, 'generation uses the tab opened by the user');
      assert.equal(await evaluate(workerSession, 'chrome.tabs.query({}).then(tabs=>tabs.length)'), beforeTabs, 'ChatGPT generation never opens an extra tab');
      assert.equal(await evaluate(tabSession, 'Number(document.body.dataset.pasteCount || 0)'), 0, 'no paste event that could create a text attachment');
      assert.equal(await evaluate(tabSession, 'document.querySelectorAll("[data-testid=attachment-preview]").length'), 0);
      assert.equal(await evaluate(tabSession, 'Number(document.body.dataset.sendClicks || 0)'), 0, 'submission uses Enter');
      assert.equal(await evaluate(tabSession, 'Number(document.body.dataset.enterCount || 0)'), 1);
    }
    if (scenario.mode === 'rich-existing') {
      assert.equal(run.url, 'https://chatgpt.com/c/existing-thread');
      assert.deepEqual(run.baseline, { users: 1, answers: 1 });
    }
    assert.equal(await evaluate(tabSession, 'document.body.dataset.sentOldDraft'), 'false', 'old draft text is never appended to the job prompt');
    assert.equal(await evaluate(tabSession, 'document.body.dataset.runMarkersSent'), '1', 'only one complete prompt is inserted');
    if (scenario.mode === 'rich-remount') assert.equal(await evaluate(tabSession, 'document.body.dataset.editorReplaced'), 'true');
    if (currentLayout) assert.equal(await evaluate(tabSession, 'document.querySelectorAll("[data-message-author-role]").length'), 0, 'new-layout capture cannot depend on legacy role markers');
    else assert.equal(await evaluate(tabSession, 'document.querySelector("#composer-submit-button, #chat-input, #prompt-textarea")'), null, 'capture continues after composer removal');
    await rpc('start', { jobId, provider: scenario.provider }); // A repeated request only opens the bound tab.
    if (scenario.reload) await cdp.send('Page.reload', {}, tabSession);
    if (scenario.reopen) await cdp.send('Page.navigate', { url: 'about:blank' }, panel);
    await until(async () => ['complete', 'invalid', 'attention'].includes((await findRun(jobId))?.phase), 'generation result saved');
    run = await findRun(jobId);
    assert.equal(run.phase, invalid ? 'invalid' : 'complete', `${scenario.provider}/${scenario.mode}: ${run.error || ''}`);
    if (currentLayout) {
      assert.equal(run.captureDiagnostics.stage, 'capture'); assert.equal(run.captureDiagnostics.generationActive, false);
      assert.equal(run.captureDiagnostics.codeBlocks, invalid ? 2 : 1);
      assert.equal(run.captureDiagnostics.sendEnabled, !scenario.mode.startsWith('rich-search'));
      assert.equal(await evaluate(tabSession, 'JSON.parse(localStorage.getItem("generationThread:" + location.pathname + location.search)).complete'), true, 'complete JSON during streaming cannot finish the run early');
      if (scenario.mode === 'rich-current-no-user') assert.equal(run.captureDiagnostics.userMatched, false);
    }
    assert.ok(run.raw.includes(run.id));
    assert.equal(await evaluate(tabSession, 'Number(localStorage.getItem("generationSendCount"))'), beforeCount + 1, 'exactly one fixture submission through duplicate click and reload');
    if (scenario.reopen) {
      await cdp.send('Page.navigate', { url: extensionUrl }, panel);
      await until(() => read('document.documentElement.dataset.studioReady === "true"'), 'dock reopened');
    }
    await until(() => read(`Boolean(document.querySelector('[data-request-id="${jobId}"] [data-action="review-generation"]'))`), 'Review documents action');
    if (!await read('document.getElementById("documents-dialog").open')) await click(`[data-request-id="${jobId}"] [data-action="review-generation"]`);
    assert.equal(await read('document.getElementById("documents-dialog").open'), true);
    if (invalid) {
      assert.match(run.error, scenario.mode === 'invalid' ? /company does not match/ : /exactly one complete JSON object/);
      assert.equal(await read('document.getElementById("documents-save").disabled'), true);
      await click('#documents-dialog [data-close-dialog]');
    } else {
      assert.equal(await read('document.getElementById("documents-save").disabled'), false);
      assert.ok((await read('document.getElementById("documents-cover-letter").value')).includes('Generation Test'));
      await click('#documents-save');
      await until(() => read('!document.getElementById("documents-dialog").open'), 'documents approved');
      const saved = await read(`import(chrome.runtime.getURL('src/queue-store.mjs')).then(m=>m.createQueueStore().read()).then(s=>s.requests.find(j=>j.id===${JSON.stringify(jobId)}))`);
      assert.equal(saved.state, 'ready'); assert.equal(saved.documentRunId, run.id); assert.equal(saved.manualChatUrl || null, run.url || null);
    }
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, panel);
  await writeFile(join(artifacts, 'document-generation.png'), Buffer.from(shot.data, 'base64'));
  return ['ChatGPT wrapper and rich editors accept long multiline prompts', 'DeepSeek keyboard submission and reasoning exclusion',
    'ChatGPT current turn/search layouts and CodeMirror JSON panels captured without legacy message markers',
    'ready Send or final reply controls trigger code-block capture only after streaming stops',
    'thinking JSON, later replies and duplicate code blocks cannot replace the requested final result',
    'ChatGPT replaces textarea and rich-editor drafts with native plain text, without paste or attachments',
    'ChatGPT uses the user-opened tab and sends once with Enter, including existing conversations',
    'draft preview text is not a submitted-message receipt', 'ChatGPT automatic and manual reply capture without a conversation URL',
    'verified ChatGPT sending and capture without a rendered user-message row',
    'ChatGPT editor remounts, external Send controls, and Enter submission', 'manual submission recovered after session binding loss without another send',
    'ChatGPT final reply chosen after thinking and before another user turn',
    'submission acknowledged after Send and composer disappear', 'duplicate actions and tab reload do not resend',
    'results survive closing and reopening the dock', 'invalid replies retained; documents require review before saving'];
}
