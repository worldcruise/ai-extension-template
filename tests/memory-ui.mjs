export async function checkMemoryUI({cdp,panel,workerSession,read,evaluate}) {
  const heap=async session=>{await cdp.send('HeapProfiler.collectGarbage',{},session);const memory=await cdp.send('Runtime.getHeapUsage',{},session);return {usedMB:+(memory.usedSize/1048576).toFixed(2),totalMB:+(memory.totalSize/1048576).toFixed(2)};};
  const startup={panel:await heap(panel),worker:await heap(workerSession),frames:await read('[...document.querySelectorAll(".provider-pane iframe")].map(frame=>({id:frame.id,loaded:!!frame.getAttribute("src")}))')};
  await read(`(async()=>{const {createGenerationStore}=await import(chrome.runtime.getURL('src/generation-store.mjs'));const store=createGenerationStore();await store.change(state=>{for(let n=0;n<200;n++)state.runs.push({id:'memory-'+n,jobId:'job-'+n,kind:'documents',phase:'complete',job:{input:{profile:{summary:'Profile '+n+' '+ 'x'.repeat(50000)}}},prompt:'Prompt '+n+' '+ 'p'.repeat(100000),raw:'Reply '+n+' '+ 'r'.repeat(100000)});});})()`);
  const before=await heap(workerSession);
  const lookup=await read(`(async()=>{const {createGenerationStore}=await import(chrome.runtime.getURL('src/generation-store.mjs'));const store=createGenerationStore();const started=performance.now();for(let n=0;n<10;n++){const reply=await chrome.runtime.sendMessage({type:'generation.read',id:'memory-100'});if(!reply.ok)throw Error(reply.error);}return {durationMs:Math.round(performance.now()-started),keyed:!!store.get};})()`);
  const peak=await cdp.send('Runtime.getHeapUsage',{},workerSession),after=await heap(workerSession);
  const previewRouting=await read(`(async()=>{
    let route;try{route=(await import(chrome.runtime.getURL('src/document-preview-tabs.mjs'))).openDocumentPreview;}catch{}
    const {createDocumentFileStore}=await import(chrome.runtime.getURL('src/document-file-store.mjs'));const files=createDocumentFileStore();
    for(let n=0;n<12;n++){const key='memory-preview-'+n+'/resume.json';await files.put({key,bytes:new TextEncoder().encode('{}'),format:'json',kind:'resume',filename:'Memory test.json',state:'complete',downloadId:n});const item={key,format:'json',kind:'resume'};
      if(route)await route(chrome,item);else await chrome.tabs.create({url:chrome.runtime.getURL('document-preview.html')+'?file='+encodeURIComponent(key),active:true});}
    const previews=(await chrome.tabs.query({})).filter(tab=>(tab.pendingUrl||tab.url)?.startsWith(chrome.runtime.getURL('document-preview.html')));
    return {files:12,openTabs:previews.length};
  })()`);
  return {fixtureOnly:true,liveProviderMemory:false,startup,history:{records:200,approxPayloadMB:47.7,before,lookup,heapAfterLookupsMB:+(peak.usedSize/1048576).toFixed(2),afterGC:after},previewRouting};
}
