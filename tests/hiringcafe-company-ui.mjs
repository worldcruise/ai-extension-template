import assert from 'node:assert/strict';
import { jobPageFixtures } from './fixtures/job-pages.mjs';

export async function checkHiringCafeCompany({cdp,read,evaluate,until,session}) {
  const id=await read('chrome.runtime.id'),checks=[];
  for(const fixture of jobPageFixtures.filter(item=>item.id.startsWith('hiringcafe'))) {
    const url=`https://${fixture.host}/extract/${fixture.id}`;
    const source=await cdp.send('Target.createTarget',{url}),sourceSession=await session(source.targetId);
    await until(async()=>{try{return await evaluate(sourceSession,`document.body?.dataset.extractionFixture===${JSON.stringify(fixture.id)}`);}catch{return false;}},'HiringCafe fixture loaded');
    const tab=await until(async()=>(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos.find(target=>target.url===url),'source browser tab');
    await cdp.send('Extensions.triggerAction',{id,targetId:tab.targetId});
    const tabId=await read(`chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===${JSON.stringify(url)}).id)`);
    const result=await read(`chrome.runtime.sendMessage({type:'job.extract',requestId:'company-check',tabId:${tabId}})`);
    assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.fields.company,fixture.company,fixture.id);
    assert.equal(result.fields.role,'Platform Engineer');assert.ok(result.fields.description.includes('TypeScript'));
    assert.ok(!JSON.stringify(result).includes('PRIVATE APPLICANT DATA'));
    checks.push(fixture.id);await cdp.send('Target.closeTarget',{targetId:source.targetId});
  }
  return {checks};
}
