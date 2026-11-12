import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkManualJobUI({ cdp, panel, read, click, until, artifacts }) {
  const rows = () => read('import(chrome.runtime.getURL("src/queue-store.mjs")).then(m=>m.createQueueStore().read()).then(s=>s.requests)');
  const initial = await rows(), candidate = await read('document.getElementById("candidate").value');
  const source = 'https://jobs.example.test/manual-fallback';
  const tab = await read(`chrome.tabs.create({url:${JSON.stringify(source)},active:true})`);
  const navigate = async url => {
    await read(`chrome.tabs.update(${tab.id},{url:${JSON.stringify(url)},active:true})`);
    await until(() => read(`chrome.tabs.get(${tab.id}).then(tab=>tab.status==='complete'&&tab.url===${JSON.stringify(url)})`), 'manual fallback source loaded');
    await until(() => read('!document.getElementById("capture-current-job").hidden&&!document.getElementById("capture-current-job").disabled'), 'capture available');
  };
  await navigate(source);
  await read(`globalThis.manualFixturePermission=chrome.permissions.request;globalThis.manualFixtureSend=chrome.runtime.sendMessage;
    globalThis.manualFixtureMode='embedded';globalThis.manualFixtureUrl=${JSON.stringify(source)};
    chrome.permissions.request=()=>Promise.resolve(manualFixtureMode!=='denied');
    chrome.runtime.sendMessage=(...args)=>{
      const m=args[0];if(m?.type!=='job.extract'||manualFixtureMode==='real')return manualFixtureSend.apply(chrome.runtime,args);
      if(manualFixtureMode==='rejected')return Promise.reject(new Error('The connection was interrupted.'));
      if(manualFixtureMode==='missing')return Promise.resolve(undefined);
      if(manualFixtureMode==='partial')return Promise.resolve({ok:true,requestId:m.requestId,fields:{company:'Extracted company',role:'Platform Engineer',salary:'USD 100,000–130,000 per year',url:manualFixtureUrl,description:''},provenance:{company:{kind:'structured',source:'JobPosting'},role:{kind:'page',source:'Heading'}},missing:['description']});
      return Promise.resolve({ok:false,requestId:m.requestId,error:{code:'no-job',message:'The job may be in an embedded page. Open the listing in its own tab and try Read page again.'}});
    };`);
  const checks = [];
  try {
    await read('document.getElementById("job-company").value="Stale unrelated form";document.getElementById("job-description").value="Stale description";if(document.getElementById("chat-view").hidden)document.getElementById("chat-dock-toggle").click()');
    const embeddedUrl = 'https://jobs.example.test/extract/blocked-frame';
    await navigate(embeddedUrl); await read('manualFixtureMode="real"');
    const id = await read('chrome.runtime.id');
    const target = (await cdp.send('Target.getTargets', { filter:[{type:'tab',exclude:false}] })).targetInfos.find(item => item.url === embeddedUrl);
    assert.ok(target); await cdp.send('Extensions.triggerAction', { id, targetId:target.targetId });
    await cdp.send('Page.bringToFront', {}, panel);
    await click('#capture-current-job');
    assert.equal(await read('document.getElementById("manual-job-dialog").open'), true);
    assert.match(await read('document.getElementById("manual-job-reason").textContent'), /embedded page/);
    assert.equal(await read('document.getElementById("manual-job-url").value'), embeddedUrl);
    await click('#manual-job-dialog [data-close-dialog]'); await navigate(source);
    checks.push('real blocked-iframe extraction opens the manual form with the original listing URL');
    for (const [mode, reason] of [['embedded', /embedded page/], ['denied', /not granted/], ['rejected', /interrupted/], ['missing', /did not respond/]]) {
      await read(`manualFixtureMode=${JSON.stringify(mode)}`); await click('#capture-current-job');
      assert.equal(await read('document.getElementById("manual-job-dialog").open'), true);
      assert.match(await read('document.getElementById("manual-job-reason").textContent'), reason);
      assert.equal(await read('document.getElementById("manual-job-url").value'), source);
      assert.equal(await read('document.getElementById("manual-job-company").value'), '', 'unrelated manual form is never copied');
      assert.equal(await read('document.getElementById("manual-job-description").value'), '');
      assert.equal(await read('document.getElementById("chat-view").hidden'), false);
      await click('#manual-job-save');
      assert.equal((await rows()).length, initial.length, 'empty description cannot save');
      await click('#manual-job-dialog [data-close-dialog]');
      assert.equal((await rows()).length, initial.length, 'cancel saves nothing');
    }
    checks.push('embedded, permission, connection and malformed-response failures open the manual form over expanded chat; cancel saves nothing');
    await read('manualFixtureMode="partial"'); await click('#capture-current-job');
    assert.equal(await read('document.getElementById("manual-job-company").value'), 'Extracted company');
    assert.equal(await read('document.getElementById("manual-job-role").value'), 'Platform Engineer');
    assert.equal(await read('document.getElementById("manual-job-salary").value'), 'USD 100,000–130,000 per year');
    await navigate('https://jobs.example.test/another-tab-destination');
    assert.equal(await read('document.getElementById("manual-job-url").value'), source);
    await read(`document.getElementById('candidate').value=${JSON.stringify(candidate === 'jordan' ? 'morgan' : 'jordan')};document.getElementById('candidate').dispatchEvent(new Event('change'))`);
    await read('document.getElementById("manual-job-description").value="Build reliable services with TypeScript and SQL.";document.getElementById("manual-job-description").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("manual-job-url").value="javascript:alert(1)"');
    await click('#manual-job-save');
    assert.equal((await rows()).length, initial.length, 'invalid URL cannot save');
    await read(`document.getElementById('manual-job-url').value=${JSON.stringify(source)};document.getElementById('manual-job-url').dispatchEvent(new Event('input',{bubbles:true}))`);
    for (const width of [280, 390, 800]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height:900, deviceScaleFactor:1, mobile:false }, panel);
      assert.equal(await read('(()=>{const d=document.getElementById("manual-job-dialog"),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth})()'), true, `manual form fits at ${width}px`);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width:390, height:900, deviceScaleFactor:1, mobile:false }, panel);
    await cdp.send('Page.bringToFront', {}, panel);
    const shot = await cdp.send('Page.captureScreenshot', { format:'png' }, panel);
    await writeFile(join(artifacts, 'manual-job-form.png'), Buffer.from(shot.data,'base64'));
    await read('document.getElementById("manual-job-form").requestSubmit();document.getElementById("manual-job-form").requestSubmit()');
    await until(() => read('!document.getElementById("manual-job-dialog").open'), 'manual job saved').catch(async error => {
      const details = await read('({status:document.getElementById("manual-job-status").textContent,busy:document.getElementById("manual-job-dialog").getAttribute("aria-busy"),fields:[...document.querySelectorAll("#manual-job-form input,#manual-job-form textarea")].map(f=>({id:f.id,valid:f.validity.valid,message:f.validationMessage,disabled:f.disabled}))})');
      throw new Error(`${error.message}: ${JSON.stringify(details)}`);
    });
    const added = (await rows()).filter(item => !initial.some(old => old.id === item.id));
    assert.equal(added.length, 1); assert.equal(added[0].input.candidateId, candidate);
    assert.equal(added[0].input.job.url, source); assert.equal(added[0].input.job.company, 'Extracted company');
    assert.equal(added[0].input.job.salary, 'USD 100,000–130,000 per year');
    assert.equal(added[0].input.job.provenance.company.kind, 'structured');
    checks.push('partial fields and salary survive tab/profile changes; validation and repeated submission save once for the original candidate');
    await read(`document.getElementById('candidate').value=${JSON.stringify(candidate)};document.getElementById('candidate').dispatchEvent(new Event('change'));manualFixtureMode='embedded'`);
    await click('#capture-current-job');
    await read(`document.getElementById('manual-job-url').value=${JSON.stringify(source)};document.getElementById('manual-job-description').value='Keep this entered description after a duplicate save.'`);
    await click('#manual-job-save');
    await until(() => read('document.getElementById("manual-job-status").textContent.includes("already")'), 'duplicate save remains editable');
    assert.equal(await read('document.getElementById("manual-job-dialog").open'), true);
    assert.equal(await read('document.getElementById("manual-job-description").value'), 'Keep this entered description after a duplicate save.');
    assert.equal(await read('document.getElementById("manual-job-save").disabled'), false);
    assert.equal((await rows()).length, initial.length + 1);
    checks.push('duplicate save keeps the form open with all entries intact');
  } finally {
    await read('if(document.getElementById("manual-job-dialog").open)document.getElementById("manual-job-dialog").close();chrome.permissions.request=manualFixturePermission;chrome.runtime.sendMessage=manualFixtureSend;delete globalThis.manualFixturePermission;delete globalThis.manualFixtureSend;delete globalThis.manualFixtureMode;delete globalThis.manualFixtureUrl');
    await read(`chrome.tabs.remove(${tab.id})`);
  }
  return { checks };
}
