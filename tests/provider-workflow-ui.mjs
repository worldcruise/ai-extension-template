import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkCaptureEligibilityUI } from './current-job-ui.mjs';

export async function checkProviderWorkflowUI({ cdp, panel, read, click, until, artifacts }) {
  const tabs = () => read('chrome.tabs.query({}).then(items=>items.map(({id,url,active,windowId})=>({id,url,active,windowId})))');
  const runs = () => read('chrome.runtime.sendMessage({type:"generation.list"}).then(reply=>{if(!reply.ok)throw Error(reply.error);return reply.value})');
  const initialRuns = (await runs()).length, checks = [];
  await read('globalThis.providerWorkflowFrames=[document.getElementById("chatgpt-frame"),document.getElementById("deepseek-frame")]');
  await click('#results-tab');
  for (const provider of ['deepseek','chatgpt']) {
    await read(`(()=>{const select=document.getElementById('dock-chat-provider');select.focus();select.value=${JSON.stringify(provider)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>read('!document.getElementById("dock-chat-provider").disabled'),'bottom provider selection settled');
    assert.deepEqual(await read('["dock-chat-provider","chat-provider","workflow-provider"].map(id=>document.getElementById(id).value)'),[provider,provider,provider]);
    assert.equal(await read('chrome.storage.local.get("chatProvider").then(value=>value.chatProvider)'),provider);
    assert.equal(await read(`document.getElementById('${provider}-pane').hidden`),false);
    assert.equal(await read('document.getElementById("chat-dock-toggle").getAttribute("aria-expanded")'),'true');
    assert.equal(await read('document.activeElement.id'),'dock-chat-provider');
    await click('#dock-chat-provider');
    assert.equal(await read('document.getElementById("chat-view").hidden'),false,'the selector does not collapse chat');
    assert.equal(await read('document.getElementById("chat-dock-toggle").contains(document.getElementById("dock-chat-provider"))'),false,'selector is separate from accordion button');
  }
  assert.equal(await read('providerWorkflowFrames[0]===document.getElementById("chatgpt-frame")&&providerWorkflowFrames[1]===document.getElementById("deepseek-frame")'),true);
  checks.push('bottom selector synchronizes menu/settings and persists both providers','switching opens chat without replacing provider frames','selector preserves expanded chat and regains focus');
  for (const width of [280,390,800]) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},panel);
    assert.equal(await read('(()=>{const bar=document.querySelector(".dock-status-bar"),select=document.getElementById("dock-chat-provider").getBoundingClientRect();return bar.scrollWidth<=bar.clientWidth&&select.left>=0&&select.right<=innerWidth})()'),true,`provider selector fits at ${width}px`);
  }
  checks.push('bottom selector fits narrow and wide dock widths');
  const seeded = await read(`(async()=>{
    const {createJobQueue}=await import(chrome.runtime.getURL('src/job-queue.mjs'));
    const {exampleProfile}=await import(chrome.runtime.getURL('src/resume-data.mjs'));
    const queue=createJobQueue();await queue.ready;const candidate=await queue.importProfile(JSON.stringify(exampleProfile),'Provider workflow fixture.json');
    const jobs=[];for(const provider of ['chatgpt','deepseek',null]){
      const name=provider||'unlinked',url='https://jobs.example.test/provider-'+name;
      const chat=provider==='chatgpt'?'https://chatgpt.com/c/apply-chatgpt':provider==='deepseek'?'https://chat.deepseek.com/a/chat/s/apply-deepseek':null;
      const id=await queue.add({candidateId:candidate,profile:exampleProfile,tailor:true,resumeTemplate:'kakuna',promptTemplate:'focused',job:{company:'Provider '+name,role:'Engineer',description:'Build services.',url}});
      if(chat)await queue.connect(id,chat);jobs.push({id,url,chat,provider});
    }await queue.selectCandidate(candidate);queue.dispose();return{candidate,jobs};
  })()`);
  await until(()=>read(`Boolean(document.querySelector('#candidate option[value="${seeded.candidate}"]'))`),'workflow candidate available');
  await read(`document.getElementById('candidate').value=${JSON.stringify(seeded.candidate)};document.getElementById('candidate').dispatchEvent(new Event('change'));`);
  await click('#results-tab');
  for (const job of seeded.jobs.filter(job=>job.chat)) {
    const existing = await read(`chrome.tabs.create({url:${JSON.stringify(job.chat)},active:false}).then(tab=>tab.id)`);
    await until(async()=> (await tabs()).some(tab=>tab.id===existing&&tab.url===job.chat),'saved provider tab opened');
    const card = `[data-request-id="${job.id}"]`;
    await until(()=>read(`Boolean(document.querySelector('${card} a[data-action="apply"]'))`),'Go to apply card ready');
    await click(`${card} a[data-action="apply"]`);
    await until(async()=> (await tabs()).some(tab=>tab.url===job.url&&tab.active),'job listing is foreground');
    let all = await tabs(), listing = all.find(tab=>tab.url===job.url);
    assert.deepEqual(all.filter(tab=>tab.url===job.chat).map(tab=>tab.id),[existing],'existing saved conversation reused');
    assert.equal(all.find(tab=>tab.id===existing).active,false,'saved AI chat stays in background');
    await click(`${card} a[data-action="apply"]`);
    all=await tabs();assert.equal(all.filter(tab=>tab.url===job.url).length,1);assert.equal(all.filter(tab=>tab.url===job.chat).length,1);
    assert.equal(all.find(tab=>tab.id===listing.id).active,true);
    checks.push(`${job.provider} Go to apply reuses listing and saved AI tabs`);
    await read(`chrome.tabs.remove(${existing})`);
    await click(`${card} [data-action="details"]`);
    await click('#request-job-link');
    all=await tabs();assert.equal(all.some(tab=>tab.url===job.chat),false,'application never opens the saved AI conversation');assert.equal(all.find(tab=>tab.id===listing.id).active,true);
    await click('#request-job-link');
    all=await tabs();assert.equal(all.filter(tab=>tab.url===job.url).length,1);assert.equal(all.filter(tab=>tab.url===job.chat).length,0);
    assert.equal(all.find(tab=>tab.id===listing.id).active,true);
    await click('#request-dialog [data-close-dialog]');
    checks.push(`${job.provider} application link opens only the listing from Details`);
    await read(`chrome.tabs.remove(${JSON.stringify([listing.id])})`);
  }
  const unlinked=seeded.jobs.find(job=>!job.chat), beforeAI=(await tabs()).filter(tab=>/^https:\/\/(chatgpt\.com|chat\.deepseek\.com)\//.test(tab.url)).map(tab=>tab.id);
  await click(`[data-request-id="${unlinked.id}"] a[data-action="apply"]`);
  await until(async()=> (await tabs()).some(tab=>tab.url===unlinked.url&&tab.active),'unlinked job opens normally');
  assert.deepEqual((await tabs()).filter(tab=>/^https:\/\/(chatgpt\.com|chat\.deepseek\.com)\//.test(tab.url)).map(tab=>tab.id),beforeAI,'unlinked job does not open an unrelated AI chat');
  assert.equal((await runs()).length,initialRuns,'Go to apply does not start generation');
  checks.push('unlinked job opens only its listing','Go to apply never starts document generation');
  await checkCaptureEligibilityUI({ read, until });
  checks.push('AI and mail tabs disable one-click capture in both dock states and reject direct activation; job tabs restore it');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false},panel);
  await cdp.send('Page.bringToFront',{},panel);
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'},panel);
  await writeFile(join(artifacts,'provider-workflow.png'),Buffer.from(shot.data,'base64'));
  return {checks};
}
