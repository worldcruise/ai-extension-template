import assert from 'node:assert/strict';
import { jobPageFixtures, jobText } from './fixtures/job-pages.mjs';

export async function checkJobReader({cdp,id,sourceSession,dockSession,evaluate,until}) {
  const dock = code => evaluate(dockSession,code);
  const web = code => evaluate(sourceSession,code);
  const fields = () => dock('Object.fromEntries(["company","title","url","description"].map(key=>[key,document.getElementById("job-"+key).value]))');
  const matrix=[];
  // Native consent UI is not automated. Stub only its decision, then use
  // Chrome's real action grant for fixture access before resolving approval.
  await dock(`globalThis.originalJobPermissionRequest = chrome.permissions.request;
    globalThis.jobPermissionDecisions = []; globalThis.jobPermissionRequests = [];
    chrome.permissions.request = options => { jobPermissionRequests.push(options); return new Promise(resolve => {
      if (jobPermissionDecisions.length) resolve(jobPermissionDecisions.shift());
      else resolve(true);
    }); };`);
  try {
  for (const fixture of jobPageFixtures) {
    const url=`https://${fixture.host}/extract/${fixture.id}${fixture.query || ''}`;
    await cdp.send('Page.navigate',{url},sourceSession);
    await until(()=>web(`document.body?.dataset.extractionFixture===${JSON.stringify(fixture.id)}`),`${fixture.id} fixture ready`);
    if (fixture.shadow) await web(`document.getElementById('shadow-host').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(fixture.shadow)}`);
    if (fixture.id==='iframe-parent') await until(()=>web('document.querySelector("iframe").contentDocument?.body?.dataset.extractionFixture==="iframe-child"'),'same-origin embedded job ready');
    if (fixture.id==='greenhouse') {
      const before=await fields();
      await dock('jobPermissionDecisions.push(false); document.getElementById("read-page").click()');
      await until(()=>dock('document.getElementById("read-page").getAttribute("aria-busy")==="false"'),'denied permission releases Read page');
      assert.deepEqual(await fields(),before,'canceling consent retains the draft');
      assert.match(await dock('document.getElementById("read-page").title'),/not granted/);
      assert.equal(await dock('document.getElementById("read-page-error-dialog").open'),false,'canceling consent does not open another dialog');
      await dock('document.getElementById("read-page").click()');
      await until(()=>dock('document.getElementById("read-page").getAttribute("aria-busy")==="false"'),'permission failure releases Read page');
      assert.deepEqual(await fields(),before,'permission failure retains the draft');
      assert.match(await dock('document.getElementById("read-page-error-message").textContent'),/Site access/);
      assert.equal(await dock('document.getElementById("read-page-error-dialog").open'),true,'a real access failure is actionable without an inline status');
      await dock('document.querySelector("#read-page-error-dialog [data-close-dialog]").click()');
      assert.equal(await dock('document.getElementById("read-page-feedback")'),null);
      matrix.push({fixture:'permission-denied',passed:true});
    }
    const target=await until(async()=>(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos.find(tab=>tab.url===url),'job tab action target');
    if (fixture.id !== 'greenhouse') await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});
    await dock('document.getElementById("review-another").click()');
    await until(()=>dock('!document.getElementById("read-page").disabled'),'Read page available');
    if (fixture.partial) await dock('document.getElementById("job-company").value="Keep existing company";document.getElementById("job-company").dispatchEvent(new Event("input",{bubbles:true}))');
    const before=await fields();
    if (fixture.delay) await web(`setTimeout(()=>{document.getElementById('loading-job').innerHTML=${JSON.stringify(`<h1 class="app-title">Platform Engineer</h1><span class="company-name">Delayed Works</span><div class="job__description">${jobText}</div>`)}},600)`);
    if (fixture.id === 'greenhouse') await dock('chrome.permissions.request = options => { jobPermissionRequests.push(options); return new Promise(resolve => { globalThis.approveJobPermission = resolve; }); };');
    const started = await dock('document.getElementById("read-page").click(); ({busy:document.getElementById("read-page").getAttribute("aria-busy"), status:document.getElementById("read-page-feedback"), label:document.getElementById("read-page").textContent.trim()})');
    assert.deepEqual(started, {busy:'true',status:null,label:'Allow access…'}, 'Read page requests permission directly without an inline status');
    if (fixture.id === 'greenhouse') {
      assert.deepEqual(await fields(), before, 'extraction waits for approval');
      await dock('document.getElementById("read-page").click()');
      await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});
      await dock('approveJobPermission(true); delete globalThis.approveJobPermission; chrome.permissions.request = options => { jobPermissionRequests.push(options); return Promise.resolve(true); };');
    }
    if (fixture.delay) await dock('document.getElementById("job-company").value="Typed while reading";document.getElementById("job-company").dispatchEvent(new Event("input",{bubbles:true}))');
    await until(()=>dock('document.getElementById("read-page").getAttribute("aria-busy")==="false"'),`${fixture.id} reading finished`);
    const actual=await fields();
    if (fixture.failure) {
      assert.deepEqual(actual,before,`${fixture.id} must retain existing draft`);
      assert.match(await dock('document.getElementById("read-page").title'), /No clear job|embedded page/);
      assert.equal(await dock('document.getElementById("read-page-error-dialog").open'), true);
      await dock('document.querySelector("#read-page-error-dialog [data-close-dialog]").click()');
    } else {
      assert.equal(actual.company,fixture.delay ? 'Typed while reading' : fixture.company,fixture.id);
      assert.equal(actual.title,'Platform Engineer',fixture.id);
      assert.equal(actual.url,url,fixture.id);
      for (const text of fixture.includes || ['Build reliable data services','Responsibilities','Requirements','Benefits']) assert.ok(actual.description.includes(text),`${fixture.id}: ${text}`);
      assert.ok(!actual.description.includes('PRIVATE APPLICANT DATA'),fixture.id);
      assert.ok(!actual.description.includes('PRIVATE EDITOR DATA'),fixture.id);
      if (fixture.id==='lever') assert.ok(actual.description.includes('Additional requirements'));
      assert.equal(await dock('document.getElementById("read-page-feedback")'), null, 'success does not add a status panel');
      if (fixture.id === 'jsonld-graph') {
        for (let repeat = 0; repeat < 2; repeat++) {
          await dock('for (const id of ["job-company","job-title","job-description"]) { const input=document.getElementById(id); input.value=""; input.dispatchEvent(new Event("input",{bubbles:true})); } document.getElementById("read-page").click()');
          await until(() => dock('document.getElementById("read-page").getAttribute("aria-busy") === "false"'), 'repeated Read page finishes');
          assert.equal((await fields()).company, fixture.company);
          assert.equal((await fields()).title, 'Platform Engineer');
          assert.equal(await dock('document.getElementById("read-page").disabled'), false);
        }
        matrix.push({fixture:'repeated-read-page',passed:true});
      }
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
  await dock('document.getElementById("read-page").click()');
  const other=await cdp.send('Target.createTarget',{url:'about:blank#other-job-draft'});
  await until(()=>dock('document.getElementById("job-company").value===""'),'new tab draft selected');
  assert.equal(await dock('document.getElementById("read-page-feedback")'), null);
  const otherDraft=await fields();
  await web(`document.getElementById('loading-job').innerHTML=${JSON.stringify(`<h1 class="app-title">Platform Engineer</h1><span class="company-name">${delayed.company}</span><div class="job__description">${jobText}</div>`)}`);
  await until(()=>dock('document.getElementById("workspace-status").textContent.includes("source tab")'),'source tab result saved');
  assert.deepEqual(await fields(),otherDraft,'background result must not populate a different tab');
  await dock(`chrome.tabs.update(${activeId},{active:true})`);
  await until(()=>dock('document.getElementById("job-company").value==="Delayed Works"'),'source tab extraction restored');
  assert.equal((await fields()).url,delayedUrl);
  assert.match(await dock('document.getElementById("read-page").title'), /Job details read/, 'source tooltip is restored with its draft');
  await cdp.send('Target.closeTarget',{targetId:other.targetId});
  matrix.push({fixture:'tab-switch-race',passed:true});
  assert.ok((await dock('jobPermissionRequests')).every(request => JSON.stringify(request.origins) === JSON.stringify(['http://*/*','https://*/*'])));
  matrix.push({fixture:'button-consent-resumes-same-read',passed:true,consentPromptMocked:true});
  return matrix;
  } finally {
    await dock('chrome.permissions.request = originalJobPermissionRequest; delete globalThis.originalJobPermissionRequest; delete globalThis.jobPermissionDecisions; delete globalThis.jobPermissionRequests;');
  }
}
