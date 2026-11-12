import assert from 'node:assert/strict';

export async function checkJobCleanupUI({cdp,panel,read,click,evaluate,until,targets,session}) {
  const rows = ()=>read(`import(chrome.runtime.getURL('src/queue-store.mjs')).then(m=>m.createQueueStore().read()).then(state=>state.requests)`);
  const runs = ()=>read(`chrome.runtime.sendMessage({type:'generation.list'}).then(reply=>reply.value)`);
  const id = await read('chrome.runtime.id');
  await read('globalThis.cleanupOriginalPermission=chrome.permissions.request;chrome.permissions.request=()=>Promise.resolve(true)');
  let sequence=0;
  try {
    await until(()=>read('!document.getElementById("job-ai-analysis").disabled'),'analysis preference loaded');
    assert.equal(await read('document.getElementById("job-ai-analysis").checked'),false,'AI job analysis defaults off');
    async function captureWithoutAI() {
      const sourceUrl=`https://jobs.example.test/extract/jsonld-graph?analysis-off=${++sequence}`;
      const source=await cdp.send('Target.createTarget',{url:sourceUrl});
      const sourceSession=await session(source.targetId);
      await until(async()=>{try{return await evaluate(sourceSession,'document.readyState==="complete"');}catch{return false;}},'direct capture source loaded');
      const target=await until(async()=>(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos.find(tab=>tab.url===sourceUrl),'direct source action target');
      await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});
      const candidate=await read(`(async()=>{const{createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));const{exampleProfile}=await import(chrome.runtime.getURL('src/resume-data.mjs'));const queue=createJobQueue();await queue.ready;try{return await queue.importProfile(JSON.stringify(exampleProfile),'Analysis off fixture.json');}finally{queue.dispose();}})()`);
      await until(()=>read(`Boolean(document.querySelector('#candidate option[value="${candidate}"]'))`),'direct capture candidate');
      await read(`document.getElementById('candidate').value=${JSON.stringify(candidate)};document.getElementById('candidate').dispatchEvent(new Event('change'))`);
      await cdp.send('Page.bringToFront',{},sourceSession);
      await until(()=>read('!document.getElementById("capture-current-job").hidden&&!document.getElementById("capture-current-job").disabled'),'direct one-click capture');
      const before=(await runs()).length;
      await click('#capture-current-job');
      const job=await until(async()=>{const row=(await rows()).find(row=>row.input.candidateId===candidate);return row&&!row.capturePending&&row;},'analysis off saves direct extraction');
      assert.equal(job.input.job.url,sourceUrl);assert.notEqual(job.input.job.salarySource,'estimated');
      assert.equal((await runs()).length,before,'analysis off never creates an AI run');
      assert.equal((await targets()).some(tab=>tab.type==='page'&&/^https:\/\/(chatgpt\.com|chat\.deepseek\.com)\//.test(tab.url)),false,'analysis off never opens an AI browser tab');
      await cdp.send('Target.closeTarget',{targetId:source.targetId});
    }
    await captureWithoutAI();
    await read('document.getElementById("account-settings").click();document.getElementById("queue-settings-tab").click();document.getElementById("job-ai-analysis").click()');
    await until(()=>read('chrome.storage.local.get("analyzeJobsWithAI").then(value=>value.analyzeJobsWithAI===true)'),'analysis opt-in saved');
    await cdp.send('Page.reload',{},panel);
    await until(()=>read('document.documentElement?.dataset.studioReady==="true"&&!document.getElementById("job-ai-analysis").disabled'),'analysis preference restored');
    assert.equal(await read('document.getElementById("job-ai-analysis").checked'),true,'analysis opt-in survives reload');
    await read('globalThis.cleanupOriginalPermission=chrome.permissions.request;chrome.permissions.request=()=>Promise.resolve(true)');
    for(const scenario of [{provider:'chatgpt',mode:'cleanup-listed',cafe:true,resume:true},{provider:'deepseek',mode:'cleanup-estimated',cafe:true,js:true},{provider:'chatgpt',mode:'cleanup-invalid',cafe:false}]) {
      const home=scenario.provider==='chatgpt'?'https://chatgpt.com/':'https://chat.deepseek.com/';
      const ai=await cdp.send('Target.createTarget',{url:home}),aiSession=await session(ai.targetId);
      await until(async()=>{try{return await evaluate(aiSession,`location.origin===${JSON.stringify(new URL(home).origin)}&&document.readyState==='complete'`);}catch{return false;}},'cleanup provider ready');
      await evaluate(aiSession,`localStorage.setItem('generationFixtureEnabled','yes');localStorage.setItem('generationFixtureMode',${JSON.stringify(scenario.mode)});localStorage.setItem('generationFixtureDelay','4500')`);
      await cdp.send('Page.navigate',{url:home+'?cleanup='+sequence},aiSession);
      await until(()=>evaluate(aiSession,`Boolean(document.querySelector('#chat-input,#actual-editor')?.getClientRects().length)`),'cleanup fixture composer');
      const sourceUrl=scenario.cafe?'https://hiring.cafe/extract/hiringcafe':'https://jobs.example.test/extract/generic';
      const source=await cdp.send('Target.createTarget',{url:sourceUrl}),sourceSession=await session(source.targetId);
      await until(async()=>{try{return await evaluate(sourceSession,`document.readyState==='complete'&&Boolean(document.querySelector('h1'))`);}catch{return false;}},'cleanup job page ready');
      const applyUrl=`https://jobs.example.test/actual-apply/${++sequence}`;
      await evaluate(sourceSession,`(()=>{
        document.querySelector('h1').textContent='Wrong navigation title';
        const description=document.createElement('div');description.dataset.testid='job-description';description.textContent='Navigation Recommended jobs Cookies. Platform Engineer at Clean Employer. Build TypeScript services and SQL tools. Responsibilities: maintain APIs. Requirements: TypeScript and SQL. '+${JSON.stringify(scenario.mode==='cleanup-listed'?'Salary USD 110,000–140,000 / year.':'No salary in this listing.')};document.body.append(description);
        const apply=document.createElement(${JSON.stringify(scenario.js?'button':'a')});apply.textContent='Apply Directly';
        ${scenario.js?`apply.onclick=()=>window.open(${JSON.stringify(applyUrl)},'_blank');`:`apply.href=${JSON.stringify(applyUrl)};apply.target='_blank';`}
        document.body.append(apply);
      })()`);
      const actionTarget=await until(async()=>(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos.find(tab=>tab.url===sourceUrl),'cleanup source action target');
      await cdp.send('Extensions.triggerAction',{id,targetId:actionTarget.targetId});
      const candidate=await read(`(async()=>{const{createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));const{exampleProfile}=await import(chrome.runtime.getURL('src/resume-data.mjs'));const queue=createJobQueue();await queue.ready;try{return await queue.importProfile(JSON.stringify(exampleProfile),'Cleanup fixture.json');}finally{queue.dispose();}})()`);
      await until(()=>read(`Boolean(document.querySelector('#candidate option[value="${candidate}"]'))`),'cleanup candidate ready');
      await read(`document.getElementById('candidate').value=${JSON.stringify(candidate)};document.getElementById('candidate').dispatchEvent(new Event('change'));document.getElementById('chat-provider').value=${JSON.stringify(scenario.provider)};document.getElementById('chat-provider').dispatchEvent(new Event('change'));chrome.storage.local.set({documentSettings:{autoDownload:true,autoPreview:false}})`);
      await until(()=>read('!document.getElementById("chat-provider").disabled'),'cleanup provider chosen');
      await evaluate(sourceSession,'window.focus()');await cdp.send('Page.bringToFront',{},sourceSession);
      await until(()=>read('!document.getElementById("capture-current-job").hidden&&!document.getElementById("capture-current-job").disabled'),'one-click cleanup enabled');
      await click('#capture-current-job');
      const pending=await until(async()=>{const row=(await rows()).find(row=>row.input.candidateId===candidate&&row.capturePending);return row;},'capture persists pending draft');
      assert.equal(await read(`Boolean(document.querySelector('[data-request-id="${pending.id}"]'))`),false,'raw extraction cannot appear as a final card');
      assert.equal(await read('document.getElementById("job-capture-progress").hidden'),false);
      await read('if(document.getElementById("chat-view").hidden)document.getElementById("chat-dock-toggle").click()');
      assert.equal(await read('document.getElementById("chat-view").getBoundingClientRect().top>=document.getElementById("job-capture-progress").getBoundingClientRect().bottom-1'),true,'pending cleanup stays above expanded chat');
      const run=await until(async()=>{const run=(await runs()).find(run=>run.jobId===pending.id&&run.kind==='job-cleanup');return run?.submittedAt&&run;},'cleanup prompt submitted');
      const boundTarget=await until(async()=>(await targets()).find(tab=>tab.type==='page'&&tab.url===run.url),'bound cleanup conversation');
      const boundSession=await session(boundTarget.targetId);
      assert.equal((await runs()).filter(run=>run.jobId===pending.id&&run.kind!=='job-cleanup').length,0);
      if(scenario.mode==='cleanup-invalid') {
        await until(()=>read('document.getElementById("manual-job-dialog").open'),'invalid cleanup opens editable manual fallback');
        assert.equal((await rows()).find(row=>row.id===pending.id).capturePending,true);
        assert.equal(await read(`Boolean(document.querySelector('[data-request-id="${pending.id}"]'))`),false);
        await click('#manual-job-dialog [data-close-dialog]');
        await read(`document.querySelector('[data-capture-job="${pending.id}"][data-capture-action="cancel"]').click()`);
      } else {
        const job=await until(async()=>{const row=(await rows()).find(row=>row.id===pending.id);return row&&!row.capturePending&&row;},'validated job becomes a card',25000);
        assert.equal(job.input.job.company,'Clean Employer');assert.equal(job.input.job.role,'Platform Engineer');
        assert.equal(job.input.job.url,applyUrl);assert.notEqual(job.input.job.url,sourceUrl);
        assert.doesNotMatch(job.input.job.description,/Navigation|Cookies|Recommended jobs/);
        assert.equal(job.input.job.salarySource,scenario.mode==='cleanup-listed'?'listed':'estimated');
        assert.equal(job.manualChatUrl,(await runs()).find(item=>item.id===run.id).url);
        await until(()=>read(`Boolean(document.querySelector('[data-request-id="${job.id}"]'))`),'cleaned card rendered');
        assert.equal(await read(`document.querySelector('[data-request-id="${job.id}"] .request-salary').textContent`),job.input.job.salary);
        assert.equal(await read('chrome.downloads.search({}).then(items=>items.length)'),0,'cleanup never generates or exports documents');
        if(scenario.resume) {
          await read('chrome.storage.local.set({documentSettings:{autoDownload:false}})');
          await cdp.send('Page.reload',{},boundSession);
          await until(()=>evaluate(boundSession,'Boolean(document.querySelector("#actual-editor")?.getClientRects().length)'),'saved cleanup conversation composer');
          await click(`[data-request-id="${job.id}"] [data-action="generate"]`);
          const documents=await until(async()=>{const doc=(await runs()).find(item=>item.jobId===job.id&&item.kind==='documents');if(doc&&['attention','invalid'].includes(doc.phase))throw new Error(`Resume after cleanup: ${JSON.stringify(doc)}`);return doc?.phase==='complete'&&doc;},'resume generation reuses the cleanup conversation',25000).catch(async error=>{throw new Error(error.message+'; runs='+JSON.stringify(await runs()));});
          assert.equal(documents.tabId,run.tabId);assert.equal(documents.url,job.manualChatUrl);
          if(await read('document.getElementById("documents-dialog").open'))await click('#documents-dialog [data-close-dialog]');
        }
      }
      await cdp.send('Target.closeTarget',{targetId:source.targetId});await cdp.send('Target.closeTarget',{targetId:ai.targetId});
      if(boundTarget.targetId!==ai.targetId)await cdp.send('Target.closeTarget',{targetId:boundTarget.targetId});
      for(const tab of (await targets()).filter(tab=>tab.type==='page'&&tab.url===applyUrl))await cdp.send('Target.closeTarget',{targetId:tab.targetId});
    }
    await read('document.getElementById("job-ai-analysis").click()');
    await until(()=>read('chrome.storage.local.get("analyzeJobsWithAI").then(value=>value.analyzeJobsWithAI===false)'),'analysis opt-out saved');
    await captureWithoutAI();
  } finally {await read('if(globalThis.cleanupOriginalPermission)chrome.permissions.request=cleanupOriginalPermission;delete globalThis.cleanupOriginalPermission');}
  return {checks:['AI job analysis defaults off and direct capture creates no AI run or browser tab','analysis opt-in persists through reload and opt-out restores direct capture','one-click capture cleans raw fields before creating a card in both providers when enabled','HiringCafe direct links and JavaScript Apply destinations become the saved employer URL','listed salary quotes and labelled candidate-based estimates are kept distinct','invalid AI JSON stays pending with manual fallback and no final card','resume generation reuses the saved cleanup conversation without another tab']};
}
