import assert from 'node:assert/strict';

export async function checkDeepseekRecoveryUI({ cdp, panel, read, click, evaluate, until, frameSession, targets, session }) {
  const pause = () => read('new Promise(resolve=>setTimeout(resolve,2300))');
  const online = value => read(`globalThis.recoveryOnline=${value};dispatchEvent(new Event(${JSON.stringify(value ? 'online' : 'offline')}))`);
  const ready = () => read('document.getElementById("deepseek-status").hidden && !document.getElementById("deepseek-reload").disabled');
  const getFrame = async () => {
    const target = await until(async () => (await targets()).find(item => item.type === 'iframe' && item.url.startsWith('https://chat.deepseek.com/')), 'recovered DeepSeek frame');
    return session(target.targetId);
  };
  const store = () => read('import(chrome.runtime.getURL("src/queue-store.mjs")).then(module=>module.createQueueStore().read()).then(state=>JSON.stringify(state.requests))');
  const beforeQueue = await store(), hostDocument = await read('performance.timeOrigin');
  const chatgptDocument = await evaluate(frameSession, 'performance.timeOrigin');
  const url = 'https://chat.deepseek.com/a/chat/s/11111111-1111-4111-8111-111111111111';
  await read(`document.getElementById('chat-provider').value='deepseek';document.getElementById('chat-provider').dispatchEvent(new Event('change'));
    globalThis.recoveryOnline=true;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>recoveryOnline});
    globalThis.recoveryLoads=0;globalThis.recoveryLoadListener=()=>recoveryLoads++;document.getElementById('deepseek-frame').addEventListener('load',recoveryLoadListener);`);
  await until(ready, 'DeepSeek ready before network recovery checks');
  let deepseek = await getFrame();
  await evaluate(deepseek, `history.pushState({},'',${JSON.stringify(url)});dispatchEvent(new Event('input',{bubbles:true}))`);
  await until(() => read(`document.getElementById('deepseek-company-chat-search').value!==undefined && !document.getElementById('deepseek-reload').disabled`), 'DeepSeek guard ready');
  const initialDocument = await evaluate(deepseek, 'performance.timeOrigin');
  try {
    // A healthy chat never needs a reload just because the network returned.
    await online(false); await online(true); await pause();
    assert.equal(await evaluate(deepseek, 'performance.timeOrigin'), initialDocument);

    // Protect chat drafts, sign-in input (only a boolean leaves the frame), and
    // streaming responses even when the message box itself is unavailable.
    for (const guard of ['draft', 'sign-in', 'response']) {
      await evaluate(deepseek, `(() => {
        const editor=document.querySelector('textarea');editor.hidden=true;
        if(${JSON.stringify(guard)}==='draft')editor.value='Unsent recovery draft';
        else { const node=document.createElement(${JSON.stringify(guard === 'sign-in' ? 'input' : 'button')});node.id='recovery-guard';
          if(${JSON.stringify(guard)}==='sign-in'){node.type='password';node.value='fixture-only';}
          else {node.dataset.isStreaming='true';node.textContent='Generating';}document.body.append(node); }
        document.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await until(() => read('document.getElementById("deepseek-reload").disabled && !document.getElementById("deepseek-status").hidden'), 'reconnect protects '+guard);
      await online(false); await online(true); await pause();
      assert.equal(await evaluate(deepseek, 'performance.timeOrigin'), initialDocument, guard+' is not reloaded');
      if (guard === 'draft') assert.equal(await evaluate(deepseek, 'document.querySelector("textarea").value'), 'Unsent recovery draft');
      if (guard === 'sign-in') assert.equal(await evaluate(deepseek, 'document.getElementById("recovery-guard").value'), 'fixture-only');
      await evaluate(deepseek, '(()=>{document.getElementById("recovery-guard")?.remove();const editor=document.querySelector("textarea");editor.hidden=false;editor.value="";editor.dispatchEvent(new Event("input",{bubbles:true}))})()');
      await until(ready, 'DeepSeek input guard cleared');
    }

    // Reproduce a loaded site stuck at sign-in with a working content script.
    await evaluate(deepseek, 'document.querySelector("textarea").hidden=true;document.dispatchEvent(new Event("input",{bubbles:true}))');
    await until(() => read('!document.getElementById("deepseek-status").hidden && !document.getElementById("deepseek-reload").disabled'), 'Reload works before the composer is ready');
    await online(false); await online(true);
    await until(ready, 'stalled sign-in recovers after the internet returns');
    deepseek = await getFrame();
    assert.notEqual(await evaluate(deepseek, 'performance.timeOrigin'), initialDocument);
    assert.equal(await evaluate(deepseek, 'location.href'), url, 'recovery keeps the selected conversation');

    // Explicit reload also works if the browser never emitted an online event.
    const beforeManual = await evaluate(deepseek, 'performance.timeOrigin');
    await evaluate(deepseek, 'document.querySelector("textarea").hidden=true;document.dispatchEvent(new Event("input",{bubbles:true}))');
    await until(() => read('!document.getElementById("deepseek-status").hidden && !document.getElementById("deepseek-reload").disabled'), 'stalled page can be manually reloaded');
    await click('#deepseek-reload'); await until(ready, 'manual reload restores DeepSeek');
    deepseek = await getFrame();
    assert.notEqual(await evaluate(deepseek, 'performance.timeOrigin'), beforeManual);

    // Abort a real iframe document request, leaving Chrome's network-error page
    // without a content-script port. Recovery must replace that failed document.
    let failed = 0, interceptError;
    const intercepted = new Set([panel, deepseek]);
    cdp.on('Fetch.requestPaused', (event, current) => {
      if (!intercepted.has(current)) return;
      failed++;
      void cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'InternetDisconnected' }, current).catch(error => { interceptError = error; });
    });
    for (const current of intercepted) await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://chat.deepseek.com/*', resourceType: 'Document' }] }, current);
    const beforeErrorLoad = await read('recoveryLoads');
    await online(false);
    await read(`document.getElementById('deepseek-frame').src=${JSON.stringify(url)}`);
    await until(() => failed > 0, 'DeepSeek document request fails while offline');
    await until(() => read(`recoveryLoads>${beforeErrorLoad}`), 'Chrome network-error document loaded');
    assert.equal(interceptError, undefined);
    assert.equal(await read('document.getElementById("deepseek-reload").disabled'), true);
    assert.match(await read('document.getElementById("deepseek-status").textContent'), /offline/i);
    for (const current of intercepted) await cdp.send('Fetch.disable', {}, current).catch(() => {});
    intercepted.clear();
    await online(true);
    await until(ready, 'network-error iframe reconnects without reloading the extension');
    deepseek = await getFrame();
    assert.equal(await evaluate(deepseek, 'location.href'), url);
    assert.equal(await read('performance.timeOrigin'), hostDocument, 'extension document is retained');
    assert.equal(await evaluate(frameSession, 'performance.timeOrigin'), chatgptDocument, 'ChatGPT is untouched');
    assert.equal(await store(), beforeQueue, 'network recovery does not change or send queued jobs');
    const recoveredLoads = await read('recoveryLoads');
    await online(true); await pause();
    assert.equal(await read('recoveryLoads'), recoveredLoads, 'no reload loop after recovery');
  } finally {
    await read('delete navigator.onLine;delete globalThis.recoveryOnline;document.getElementById("deepseek-frame").removeEventListener("load",recoveryLoadListener);delete globalThis.recoveryLoadListener;delete globalThis.recoveryLoads');
  }
  return ['DeepSeek reconnects after a real offline iframe failure and a stalled sign-in page',
    'recovery preserves the extension, ChatGPT, current conversation and queue',
    'drafts, sign-in input and responses block recovery; healthy pages do not reload',
    'manual DeepSeek reload works before composer readiness without a reload loop'];
}
