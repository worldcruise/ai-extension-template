import assert from 'node:assert/strict';
import { jobPageFixtures, jobText } from './fixtures/job-pages.mjs';

export async function checkJobReader({cdp,id,sourceSession,dockSession,evaluate,until}) {
  const dock = code => evaluate(dockSession,code);
  const web = code => evaluate(sourceSession,code);
  const fields = () => dock('Object.fromEntries(["company","title","url","description"].map(key=>[key,document.getElementById("job-"+key).value]))');
  const matrix=[];
  for (const fixture of jobPageFixtures) {
    const url=`https://${fixture.host}/extract/${fixture.id}${fixture.query || ''}`;
    await cdp.send('Page.navigate',{url},sourceSession);
    await until(()=>web(`document.body?.dataset.extractionFixture===${JSON.stringify(fixture.id)}`),`${fixture.id} fixture ready`);
    if (fixture.shadow) await web(`document.getElementById('shadow-host').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(fixture.shadow)}`);
    if (fixture.id==='iframe-parent') await until(()=>web('document.querySelector("iframe").contentDocument?.body?.dataset.extractionFixture==="iframe-child"'),'same-origin embedded job ready');
    if (fixture.id==='greenhouse') {
      const before=await fields();
      await dock('document.getElementById("read-page").click()');
      await until(()=>dock('document.getElementById("read-page").getAttribute("aria-busy")==="false"'),'permission failure releases Read page');
      assert.deepEqual(await fields(),before,'permission failure retains the draft');
      assert.match(await dock('document.getElementById("read-page").title'),/extension icon/);
      matrix.push({fixture:'permission-denied',passed:true});
    }
    const target=await until(async()=>(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos.find(tab=>tab.url===url),'job tab action target');
    await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});
    await dock('document.getElementById("review-another").click()');
    await until(()=>dock('!document.getElementById("read-page").disabled'),'Read page available');
    if (fixture.partial) await dock('document.getElementById("job-company").value="Keep existing company";document.getElementById("job-company").dispatchEvent(new Event("input",{bubbles:true}))');
    const before=await fields();
    if (fixture.delay) await web(`setTimeout(()=>{document.getElementById('loading-job').innerHTML=${JSON.stringify(`<h1 class="app-title">Platform Engineer</h1><span class="company-name">Delayed Works</span><div class="job__description">${jobText}</div>`)}},600)`);
    await dock('document.getElementById("read-page").click()');
    if (fixture.delay) await dock('document.getElementById("job-company").value="Typed while reading";document.getElementById("job-company").dispatchEvent(new Event("input",{bubbles:true}))');
    await until(()=>dock('document.getElementById("read-page").getAttribute("aria-busy")==="false"'),`${fixture.id} reading finished`);
    const actual=await fields();
    if (fixture.failure) {
      assert.deepEqual(actual,before,`${fixture.id} must retain existing draft`);
      assert.match(await dock('document.getElementById("read-page").title'), /No clear job|embedded page/);
    } else {
      assert.equal(actual.company,fixture.delay ? 'Typed while reading' : fixture.company,fixture.id);
      assert.equal(actual.title,'Platform Engineer',fixture.id);
      assert.equal(actual.url,url,fixture.id);
      for (const text of fixture.includes || ['Build reliable data services','Responsibilities','Requirements','Benefits']) assert.ok(actual.description.includes(text),`${fixture.id}: ${text}`);
      assert.ok(!actual.description.includes('PRIVATE APPLICANT DATA'),fixture.id);
      assert.ok(!actual.description.includes('PRIVATE EDITOR DATA'),fixture.id);
      if (fixture.id==='lever') assert.ok(actual.description.includes('Additional requirements'));
    }
    matrix.push({fixture:fixture.id,passed:true});
  }
  // A read belongs to its source tab even when another tab becomes active.
  const delayed=jobPageFixtures.find(item=>item.id==='delayed');
  const delayedUrl='https://jobs.example.test/extract/delayed?race=tab-switch';
  await cdp.send('Page.navigate',{url:delayedUrl},sourceSession);
  await until(()=>web('document.body?.dataset.extractionFixture==="delayed"'),'tab race fixture ready');
  const activeId=await dock('chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>tabs[0].id)');
  const delayedTarget=await until(async()=>(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos.find(tab=>tab.url===delayedUrl),'tab race action target');
  await cdp.send('Extensions.triggerAction',{id,targetId:delayedTarget.targetId});
  await web(`setTimeout(()=>{document.getElementById('loading-job').innerHTML=${JSON.stringify(`<h1 class="app-title">Platform Engineer</h1><span class="company-name">${delayed.company}</span><div class="job__description">${jobText}</div>`)}},900)`);
  await dock('document.getElementById("read-page").click()');
  const other=await cdp.send('Target.createTarget',{url:'about:blank#other-job-draft'});
  await until(()=>dock('document.getElementById("job-company").value===""'),'new tab draft selected');
  const otherDraft=await fields();
  await until(()=>dock('document.getElementById("workspace-status").textContent.includes("source tab")'),'source tab result saved');
  assert.deepEqual(await fields(),otherDraft,'background result must not populate a different tab');
  await dock(`chrome.tabs.update(${activeId},{active:true})`);
  await until(()=>dock('document.getElementById("job-company").value==="Delayed Works"'),'source tab extraction restored');
  assert.equal((await fields()).url,delayedUrl);
  await cdp.send('Target.closeTarget',{targetId:other.targetId});
  matrix.push({fixture:'tab-switch-race',passed:true});
  return matrix;
}
