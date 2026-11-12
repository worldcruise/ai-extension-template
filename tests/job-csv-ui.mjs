import assert from 'node:assert/strict';
export async function checkJobCsvUI({read,click,until}) {
  await click('#job-tab');
  const source='company,title,description,url,salary\n"CSV One, Inc.",Engineer,"Build APIs, tools\nand services.",https://jobs.example.test/csv1,USD 100000\nCSV Two,Engineer,Build SQL services,https://jobs.example.test/csv2,\nCSV Two,Engineer,Duplicate,https://jobs.example.test/csv3,\nInvalid,,Missing title,,';
  const rows=()=>read("import(chrome.runtime.getURL('src/queue-store.mjs')).then(m=>m.createQueueStore().read()).then(state=>state.requests)");
  const candidate=await read("document.getElementById('candidate').value");
  const upload=async text=>{
    await click('#import-job-csv');
    await read(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(text)}],'jobs.csv',{type:'text/csv'}));const input=document.getElementById('job-csv-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>read("document.getElementById('job-csv-dialog').open&&!document.getElementById('job-csv-dialog').querySelector('button').disabled"),'CSV import finished');
  };
  await upload(source);
  assert.equal(await read("document.getElementById('job-csv-status').textContent"),'2 added · 1 duplicates skipped · 1 invalid rows');
  const jobs=await rows();assert.equal(jobs.length,2);assert.ok(jobs.every(job=>job.input.candidateId===candidate&&job.state==='queued'));
  assert.equal(jobs.find(job=>job.input.job.company==='CSV One, Inc.').input.job.description,'Build APIs, tools\nand services.');
  await click('#job-csv-dialog [data-close-dialog]');await upload(source);
  assert.equal(await read("document.getElementById('job-csv-status').textContent"),'0 added · 3 duplicates skipped · 1 invalid rows');
  assert.equal((await rows()).length,2);
  assert.equal(await read("chrome.runtime.sendMessage({type:'generation.list'}).then(reply=>reply.value.length)"),0);
  await click('#job-csv-dialog [data-close-dialog]');
  return {checks:['CSV button imports multiline job rows under the selected candidate','duplicates and invalid rows are reported and reimport does not duplicate jobs','CSV import queues jobs without sending prompts']};
}
