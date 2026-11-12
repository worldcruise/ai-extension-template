import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkQueueCardsUI({ cdp, panel, read, click, until, artifacts }) {
  const shot=async name=>{await cdp.send('Page.bringToFront',{},panel);await read('new Promise(resolve=>setTimeout(resolve,160))');const result=await cdp.send('Page.captureScreenshot',{format:'png'},panel);await writeFile(join(artifacts,name),Buffer.from(result.data,'base64'));};
  const change=(id,value)=>read(`(()=>{const node=document.getElementById(${JSON.stringify(id)});node.focus();node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const close=id=>click(`#${id} [data-close-dialog]`);
  assert.equal(await read('document.querySelector(".studio-tabs button").id'),'apply-tab');
  assert.equal(await read('document.getElementById("apply-tab").getAttribute("aria-selected")'),'true');
  assert.equal(await read('!document.getElementById("apply-empty").hidden'),true);
  assert.equal(await read('document.querySelector("#apply-actions button").disabled'),true);
  assert.equal(await read('document.getElementById("theme-toggle").closest("#account-panel")!==null'),true);
  await read('document.getElementById("apply-tab").focus()');
  for(const [key,id] of [['ArrowRight','results-tab'],['ArrowRight','job-tab'],['Home','apply-tab'],['End','job-tab']]) {
    for(const type of ['keyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',{type,key,code:key},panel);
    assert.equal(await read('document.activeElement.id'),id);
    assert.equal(await read(`document.getElementById('${id}').getAttribute('aria-selected')`),'true');
  }
  const letter='Dear hiring team,\n\nA saved cover letter with <literal> text.\n\nMorgan Taylor';
  const queuedId=await read(`(async()=>{
    const {createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));
    const {createQueueStore}=await import(chrome.runtime.getURL('src/queue-store.mjs'));
    const queue=createJobQueue();await queue.ready;await queue.loadExamples();await queue.selectCandidate('morgan');
    const saved=queue.snapshot().requests.find(item=>item.id===1);
    await queue.saveDocuments(1,{resume:JSON.stringify(saved.resume),coverLetter:${JSON.stringify(letter)},coverLetterEnabled:true,expectedUpdatedAt:saved.updatedAt});
    await queue.connect(1,'https://chatgpt.com/c/saved-resume');await queue.connect(2,'https://chat.deepseek.com/a/chat/s/side-application-two');await queue.connect(3,'https://chatgpt.com/c/saved-interview');
    const input=structuredClone(saved.input);input.job={company:'Long Company Name with Research & Development',role:'Senior Software Engineer, Infrastructure and Developer Experience',salary:'USD 120,000–160,000 / year',salarySource:'estimated',salaryBasis:'Candidate-based assumptions.',description:'Build reliable services.',url:'https://jobs.example.test/cards'};
    const id=await queue.add(input);queue.dispose();
    await createQueueStore().change(state=>{state.requests=state.requests.map(job=>job.id===1?{...job,input:{...job.input,job:{...job.input.job,url:'https://jobs.example.test/apply-prepared'}}}:job);});
    const channel=new BroadcastChannel('ai-agent-resume-queue');channel.postMessage('changed');channel.close();return id;
  })()`);
  await until(()=>read('document.querySelectorAll("#resume-queue .job-request").length===4'),'queue cards loaded');await click('#results-tab');
  assert.equal(await read('document.querySelectorAll(".request-tools, .request-controls summary").length'),0);
  assert.equal(await read('[...document.querySelectorAll(".request-detail-button")].every(button=>button.textContent==="View detail")'),true);
  assert.equal(await read(`document.querySelector('[data-request-id="${queuedId}"] .request-salary').textContent`),'USD 120,000–160,000 / year');
  await read('document.querySelector(\'[data-request-id="1"] .request-title-button\').focus()');
  for(const type of ['keyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})},panel);
  assert.equal(await read('document.querySelector(\'[data-request-id="1"] .request-tools-body\').hidden'),false);
  assert.equal(await read('document.getElementById("request-dialog").open'),false);
  await click('[data-request-id="2"] .request-title-button');
  assert.equal(await read('document.querySelector(\'[data-request-id="1"] .request-tools-body\').hidden'),true);
  assert.equal(await read('document.querySelector(\'[data-request-id="2"] .request-tools-body\').hidden'),false);
  await click('[data-request-id="2"] .request-title-button');
  assert.equal(await read('[...document.querySelectorAll(".request-tools-body")].every(body=>body.hidden)'),true);
  const layouts=[];
  for(const view of ['results','apply']) {
    await click('#'+(view==='results'?'results-tab':'apply-tab'));
    for(const theme of ['light','dark']) {
      await read(`chrome.storage.local.set({'ui-theme:v1':${JSON.stringify(theme)}})`);await until(()=>read(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'theme updated');
      for(const width of [280,360,390,480,800]) {
        await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},panel);
        const fit=await read('(()=>{const scroll=document.getElementById("studio-scroll"),header=document.querySelector(".studio-navigation");return scroll.scrollWidth<=scroll.clientWidth&&header.scrollWidth<=innerWidth;})()');
        assert.equal(fit,true,`${view}/${theme} at ${width}px`);layouts.push({view,theme,width,fit});
        if(view==='apply') assert.equal(await read('(()=>{const row=document.querySelector(".apply-document"),buttons=[...row.querySelectorAll(".icon-button")].map(button=>button.getBoundingClientRect());return buttons.every((rect,index)=>!index||rect.top===buttons[0].top&&rect.left>=buttons[index-1].right)&&buttons.at(-1).right<=row.getBoundingClientRect().right;})()'),true,`document actions stay beside each other at ${width}px`);
        if(width===390) await shot(`${view==='results'?'queue-cards':'apply-jobs'}-${theme}.png`);
        if(view==='results') {
          await click('[data-request-id="1"] .request-title-button');
          if(width===390) await shot(`queue-expanded-${theme}.png`);
          assert.equal(await read(`(()=>{const card=document.querySelector('[data-request-id="1"]'),bounds=card.getBoundingClientRect();return [...card.querySelector('.request-actions').children].every(button=>{const rect=button.getBoundingClientRect();return rect.width>40&&rect.height>=44&&rect.left>=bounds.left&&rect.right<=bounds.right;});})()`),true,`expanded actions at ${width}px`);
          await click('[data-request-id="1"] .request-title-button');
        }
      }
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false},panel);await click('#results-tab');
  await click('[data-request-id="1"] .request-detail-button');assert.equal(await read('document.getElementById("request-dialog").open'),true);assert.ok((await read('document.getElementById("request-job").textContent')).includes('TypeScript'));await close('request-dialog');
  await click('[data-request-id="1"] .request-title-button');await click('[data-request-id="1"] [data-action="preview"]');
  assert.equal(await read('document.getElementById("resume-preview-dialog").open'),true);assert.equal(await read('document.querySelectorAll("#studio-scroll .resume-paper").length'),0);await shot('resume-popup.png');await close('resume-preview-dialog');
  await click('[data-request-id="1"] [data-action="cover-letter"]');assert.equal(await read('document.getElementById("cover-letter-copy").textContent'),letter);assert.equal(await read('document.getElementById("cover-letter-copy").children.length'),0);await close('cover-letter-dialog');
  await click('[data-request-id="1"] [data-action="prepare-application"]');
  assert.equal(await read('document.getElementById("apply-job-select").value'),'1');assert.equal(await read('document.getElementById("apply-job-select").options.length'),3);
  await until(()=>read('document.getElementById("chatgpt-frame").src==="https://chatgpt.com/c/saved-resume"'),'Apply silently selects GPT chat');
  assert.equal(await read('document.getElementById("chat-view").hidden'),true);
  const active=await read('chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>tabs[0].id)');
  await change('apply-job-select','2');await until(()=>read('document.getElementById("deepseek-frame").src==="https://chat.deepseek.com/a/chat/s/side-application-two"'),'Apply silently selects DeepSeek chat');
  assert.equal(await read('document.getElementById("chat-view").hidden'),true);assert.equal(await read('document.activeElement.id'),'apply-job-select');assert.equal(await read('chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>tabs[0].id)'),active);
  await change('apply-job-select','1');await change('apply-job-select','3');await until(()=>read('document.getElementById("dock-chat-provider").value==="chatgpt"&&document.getElementById("chatgpt-frame").src==="https://chatgpt.com/c/saved-interview"'),'latest rapid selection wins');
  await change('apply-job-select','1');await click('#apply-job-card');assert.equal(await read('document.getElementById("request-dialog").open'),true);await close('request-dialog');
  assert.equal(await read('document.querySelectorAll("#apply-panel .document-icon-actions .icon-button").length'),6);assert.equal(await read('document.querySelectorAll("#apply-description, #apply-preview-slot").length'),0);
  await click('#apply-resume');assert.equal(await read('document.getElementById("resume-preview-dialog").open'),true);assert.equal(await read('document.getElementById("apply-panel").hidden'),false);await close('resume-preview-dialog');
  await click('#apply-letter-update');assert.equal(await read('document.activeElement.id'),'documents-cover-letter');await click('#documents-save');await until(()=>read('!document.getElementById("documents-dialog").open'),'edited documents saved');assert.equal(await read('document.getElementById("apply-tab").getAttribute("aria-selected")'),'true');
  await read("chrome.storage.local.set({documentSettings:{autoDownload:false,autoPreview:false,formats:['json']}})");
  for(const id of ['apply-download','apply-letter-download']) await click('#'+id);
  const exports=await read(`import(chrome.runtime.getURL('src/generation-store.mjs')).then(m=>m.createGenerationStore().read()).then(state=>state.runs.filter(run=>run.kind==='document-export'))`);
  assert.equal(exports.length,2);assert.deepEqual(exports.map(run=>run.exportKinds[0]).sort(),['cover-letter','resume']);
  assert.equal(await read("chrome.runtime.sendMessage({type:'generation.list'}).then(reply=>reply.value.some(run=>run.kind==='document-export'))"),false);
  assert.equal(await read('document.getElementById("apply-actions").getBoundingClientRect().bottom<=document.querySelector(".dock-status-bar").getBoundingClientRect().top'),true);
  await click('#apply-open-job');await until(()=>read('chrome.tabs.query({}).then(tabs=>tabs.some(tab=>tab.url==="https://jobs.example.test/apply-prepared"&&tab.active))'),'application opens');await click('#apply-open-job');assert.equal(await read('chrome.tabs.query({}).then(tabs=>tabs.filter(tab=>tab.url==="https://jobs.example.test/apply-prepared").length)'),1);
  await click('#account-toggle');await read("for(let index=0;index<3;index++)document.getElementById('theme-toggle').click()");await until(()=>read('chrome.storage.local.get("ui-theme:v1").then(value=>value["ui-theme:v1"]==="light")'),'theme menu persists last rapid choice');await click('#account-toggle');
  await click('#results-tab');await click('[data-request-id="3"] .request-title-button');await click('[data-request-id="3"] [data-action="cancel"]');await click('#apply-tab');assert.equal(await read('document.getElementById("apply-job-select").options.length'),2);
  await change('candidate','jordan');await until(()=>read('!document.getElementById("apply-empty").hidden'),'candidate isolation');await change('candidate','morgan');await click('#results-tab');
  await click(`[data-request-id="${queuedId}"] .request-title-button`);await click(`[data-request-id="${queuedId}"] [data-action="cancel"]`);assert.equal(await read(`Boolean(document.querySelector('[data-request-id="${queuedId}"]'))`),false);
  await cdp.send('Page.reload',{},panel);await until(async()=>{try{return await read('document.documentElement.dataset.studioReady==="true"');}catch{return false;}},'workspace reload');assert.equal(await read('document.documentElement.dataset.theme'),'light');assert.equal(await read('document.getElementById("apply-tab").getAttribute("aria-selected")'),'true');
  return {layouts,checks:['Apply first by default','single queue accordion and View detail popup','salary without AI estimate label','responsive light and dark themes','resume and JD only in popups','three icons per document with individual saved-file downloads','silent saved chat switching for both providers, latest selection wins','Autofill placeholder at bottom','theme in user menu','application tab reuse','candidate isolation and removal']};
}
