// Installed MV3 extension + the reused direct feasibility OAuth and streaming engine.
// No signed-in profile, provider login, or live inference is used.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '../scripts/build-extension.mjs';
import { ProtocolError } from '../src/protocol.mjs';

const root = new URL('../', import.meta.url), artifacts = new URL('../artifacts/', import.meta.url);
let extensionId, account='A', modelFailure, runFailure, delayNext=false, delayed, inferenceRequests=0, lastRequest, authorizationParams;
const errors=[],paths=[];
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'direct-fixture-key',alg:'RS256',use:'sig'};
function identity(){
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const payload=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:'https://auth.openai.com',aud:'issued-client-'+account,sub:'fixture-user-'+account,name:'Same display name',nonce:authorizationParams.get('nonce'),exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)});
 return payload+'.'+sign('RSA-SHA256',Buffer.from(payload),pair.privateKey).toString('base64url');
}
const json=(data,status=200)=>({status,contentType:'application/json',body:JSON.stringify(data)});
const event=data=>'data: '+JSON.stringify(data)+'\n\n';
async function transport(request){
 const url=new URL(request.url);paths.push(url.pathname);
 if(url.origin==='https://auth.openai.com'){
  if(url.pathname==='/.well-known/openid-configuration')return json({issuer:url.origin,authorization_endpoint:url.origin+'/api/accounts/authorize',token_endpoint:url.origin+'/api/accounts/oauth/token',jwks_uri:url.origin+'/.well-known/jwks.json',id_token_signing_alg_values_supported:['RS256'],revocation_endpoint:url.origin+'/oauth/revoke'});
  if(url.pathname==='/.well-known/jwks.json')return json({keys:[jwk]});
  if(url.pathname==='/api/accounts/oauth/token'){
   const form=new URLSearchParams(request.postData);assert.equal(form.get('client_id'),'issued-client-'+account);
   if(form.get('grant_type')==='authorization_code'){assert.equal(form.get('redirect_uri'),'http://127.0.0.1:1455/auth/callback');assert.ok(form.get('code_verifier'));}
   return json({access_token:'FIXTURE_ACCESS_NEVER_SHOW_'+account,refresh_token:'FIXTURE_REFRESH_NEVER_SHOW_'+account,token_type:'Bearer',scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',expires_in:3600,id_token:identity()});
  }
  if(url.pathname==='/oauth/revoke')return {status:200,contentType:'application/json',body:'{}'};
 }
 if(url.origin==='https://api.openai.com'){
  assert.match(request.headers.Authorization||request.headers.authorization,/^Bearer FIXTURE_ACCESS_NEVER_SHOW_[AB]$/);
  if(url.pathname==='/v1/models'){
   if(modelFailure){const failure=modelFailure;modelFailure=null;return json({error:{code:failure.code}},failure.status||401);}
   return json({models:[{slug:'shared-model',display_name:'Fixture model',visibility:'list',supported_reasoning_levels:(account==='A'?['low','high']:['medium']).map(effort=>({effort})),default_reasoning_level:account==='A'?'high':'medium'}, {slug:'plain-model',display_name:'Fixture model without effort',visibility:'list'}]});
  }
  if(url.pathname==='/v1/responses'){
   const body=JSON.parse(request.postData);assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(typeof body.input[0].content,'string');
   lastRequest={instructions:body.instructions,input:body.input[0].content,...(body.reasoning?{thinkingEffort:body.reasoning.effort}:{})};inferenceRequests++;
   const captured=account,reply=()=>{
    if(runFailure){const failure=runFailure;runFailure=null;return {status:200,contentType:'text/event-stream',body:event({type:'response.failed',response:{error:{code:failure.code}}})};}
    const output='Returned output for account '+captured+'\nPrompt: '+body.instructions+'\nInput: '+body.input[0].content;
    return {status:200,contentType:'text/event-stream',body:event({type:'response.output_text.delta',delta:output})+event({type:'response.completed',response:{status:'completed',output:[]}})};
   };
   if(delayNext){delayNext=false;return new Promise(resolve=>{delayed=()=>resolve(reply());});}return reply();
  }
 }
 throw Error('Unexpected network endpoint in isolated test: '+url.origin+url.pathname);
}
let context;
await buildExtension();
try {
  await mkdir(artifacts, { recursive: true });
  context = await chromium.launchPersistentContext('', { channel: 'chrome', headless: true, viewport: { width: 480, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const cdp = await context.browser().newBrowserCDPSession(), version = await cdp.send('Browser.getVersion');
  ({ id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: fileURLToPath(new URL('dist/', root)) }));
  await expect.poll(() => context.serviceWorkers().some(worker => worker.url().includes(extensionId))).toBe(true);
  const worker = context.serviceWorkers().find(worker => worker.url().includes(extensionId));
  let sequence=0;const pendingCommands=new Map();
  cdp.on('Target.receivedMessageFromTarget',event=>{const message=JSON.parse(event.message);const pending=pendingCommands.get(message.id);if(!pending)return;pendingCommands.delete(message.id);clearTimeout(pending.timer);if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result);});
  async function attachPanel(targetId){
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});
    const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pendingCommands.delete(id);reject(new Error('Panel CDP timeout: '+method));},5000);pendingCommands.set(id,{resolve,reject,timer});void cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});
    return {sessionId,command,async evaluate(expression){const response=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result.value;}};
  }

  const workerTarget=(await cdp.send('Target.getTargets')).targetInfos.find(target=>target.type==='service_worker'&&target.url.includes(extensionId));
  const workerPipe=await attachPanel(workerTarget.targetId);
  cdp.on('Target.receivedMessageFromTarget',event=>{
   if(event.sessionId!==workerPipe.sessionId)return;const message=JSON.parse(event.message);if(message.method!=='Fetch.requestPaused')return;
   void transport(message.params.request).then(response=>workerPipe.command('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:response.status,responseHeaders:[{name:'Content-Type',value:response.contentType}],body:Buffer.from(response.body).toString('base64')})).catch(error=>{if(!/Invalid InterceptionId|Invalid requestId|Session closed|Target closed/i.test(error.message))errors.push(error.message);});
  });
  await workerPipe.command('Fetch.enable',{patterns:[{urlPattern:'https://auth.openai.com/*'},{urlPattern:'https://api.openai.com/*'}]});
  await context.route('https://auth.openai.com/api/accounts/authorize*',async route=>{
   const url=new URL(route.request().url());authorizationParams=url.searchParams;assert.equal(authorizationParams.get('redirect_uri'),'http://127.0.0.1:1455/auth/callback');
   const callback=new URL(authorizationParams.get('redirect_uri'));callback.search=new URLSearchParams({code:'TEST_DIRECT_CODE',state:authorizationParams.get('state'),client_id:'issued-client-'+account});
   await route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><h1>Fixture authorization only</h1><a href="'+callback.href.replaceAll('&','&amp;')+'">Approve test sign-in</a></body></html>'});
  });

  const first = context.pages()[0] || await context.newPage(); await first.goto('about:blank#first');
  const second = await context.newPage(); await second.goto('about:blank#second');
  const third = await context.newPage(); await third.goto('about:blank#third'); await first.bringToFront();
  async function trigger(url) {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const target = targetInfos.find(target => target.url === url); assert.ok(target); await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
  }
  await trigger(first.url());
  await expect.poll(async () => (await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }))).length).toBe(1);
  const panelContexts = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
  const panelTarget = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url === `chrome-extension://${extensionId}/index.html`);
  assert.ok(panelTarget);assert.equal(panelContexts[0].tabId,-1);
  // Native side-panel targets are not exposed as Playwright pages. Exercise the
  // actual dock through CDP, then run the existing full UI suite on the same
  // packaged page in a tab (with its real extension CSP and worker).
  const native=await attachPanel(panelTarget.targetId);
  await expect.poll(()=>native.evaluate('Boolean(document.querySelector("[data-el=input]"))')).toBe(true);
  const sourceWindow=await native.evaluate('(async()=> (await chrome.windows.getCurrent()).id)()');
  assert.ok(Number.isInteger(sourceWindow)&&sourceWindow>=0);
  await native.evaluate('(()=>{for(const [field,value] of [["prompt","Docked prompt"],["input","Docked input"]]){const node=document.querySelector(`[data-el="${field}"]`);node.value=value;node.dispatchEvent(new Event("input",{bubbles:true}));}})()');
  await expect.poll(()=>native.evaluate('(async()=> (await chrome.runtime.sendMessage({type:"browser.status",windowId:(await chrome.windows.getCurrent()).id})).data?.count)()')).toBe(3);
  const nativeDocument=panelContexts[0].documentId;
  const nativeTabs=await worker.evaluate(windowId=>chrome.tabs.query({windowId}),sourceWindow);nativeTabs.sort((a,b)=>a.index-b.index);
  const nativeExpected=nativeTabs[(nativeTabs.findIndex(tab=>tab.active)+1)%nativeTabs.length].id;
  await expect.poll(()=>native.evaluate('!document.querySelector("[data-el=next]").disabled')).toBe(true);
  await native.evaluate('document.querySelector("[data-el=next]").click()');
  await expect.poll(()=>worker.evaluate(async windowId=>(await chrome.tabs.query({windowId,active:true}))[0].id,sourceWindow)).toBe(nativeExpected);
  assert.equal(await native.evaluate('document.querySelector("[data-el=input]").value'),'Docked input');
  assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']})))[0].documentId,nativeDocument);
  const page = await context.newPage();await page.goto(`chrome-extension://${extensionId}/index.html`);await page.waitForLoadState();
  await page.evaluate(() => { globalThis.cspErrors = []; document.addEventListener('securitypolicyviolation', event => globalThis.cspErrors.push(event.violatedDirective)); });
  const el = name => page.locator(`[data-el="${name}"]`), status = page.getByRole('status');
  async function approveSignIn(){
   const opened=context.waitForEvent('page');await el('signin').click();const authPage=await opened;
   await authPage.getByRole('link',{name:'Approve test sign-in'}).click();await expect(authPage.locator('#callback-status')).toContainText('Connected to ChatGPT');
   assert.equal(new URL(authPage.url()).search,'');await authPage.close();
  }
  await expect(status).toContainText('Sign in');await expect(page.locator('[data-el="connection-form"]')).toHaveCount(0);
  // The actual browser authorization tab, redirect rule, packaged callback, code exchange and JWT verification all run.
  const canceled=context.waitForEvent('page');await el('signin').click();const canceledPage=await canceled;await canceledPage.getByRole('link',{name:'Approve test sign-in'}).waitFor();await canceledPage.close();
  await expect(status).toContainText('canceled');await expect(el('signin')).toBeEnabled();
  await approveSignIn();await expect(el('account')).toContainText('Same display name');await expect(el('effort')).toHaveValue('high');
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await el('prompt').fill('Use only the input.'); await el('input').fill('<img src=x onerror="window.injected=true">');
  await el('go').click(); await expect(status).toContainText('Test complete');
  assert.equal(lastRequest.instructions, 'Use only the input.'); assert.equal(lastRequest.input, '<img src=x onerror="window.injected=true">'); assert.equal(lastRequest.thinkingEffort, 'high');
  assert.equal(await el('result').locator('img,script').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined); await expect(el('result')).toContainText('<img src=x');
  // Run the actual native dock too, including navigation while its request waits.
  await expect.poll(()=>native.evaluate('!document.querySelector("[data-el=go]").disabled')).toBe(true);
  delayNext=true;const beforeDock=inferenceRequests;await native.evaluate('document.querySelector("[data-el=go]").click()');
  await expect.poll(()=>inferenceRequests).toBe(beforeDock+1);
  await native.evaluate('document.querySelector("[data-el=next]").click()');
  assert.equal(await native.evaluate('document.querySelector("[data-el=input]").value'),'Docked input');
  assert.equal(await native.evaluate('document.querySelector("[data-el=cancel]").hidden'),false);
  delayed();await expect.poll(()=>native.evaluate('document.querySelector("[data-el=result]").textContent')).toContain('Docked input');
  const dockedOutput=await native.evaluate('document.querySelector("[data-el=result]").textContent');
  await native.evaluate('document.querySelector("[data-el=previous]").click()');
  assert.equal(await native.evaluate('document.querySelector("[data-el=result]").textContent'),dockedOutput);
  const dockedScreenshot=await native.command('Page.captureScreenshot',{format:'png'});await writeFile(new URL('extension-docked.png',artifacts),Buffer.from(dockedScreenshot.data,'base64'));
  const snapshot = async () => ({ prompt: await el('prompt').inputValue(), input: await el('input').inputValue(), model: await el('model').inputValue(), effort: await el('effort').inputValue(), output: await el('result').textContent() });
  const original = await snapshot();
  const browserState = await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'browser.status' })).data); assert.equal(browserState.count, 3);
  const activeUrl = () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, sourceWindow);
  const agentTabId=await page.evaluate(async()=> (await chrome.tabs.getCurrent()).id);
  const sourceTabs = (await worker.evaluate(windowId => chrome.tabs.query({ windowId }), sourceWindow)).filter(tab=>tab.id!==agentTabId);
  sourceTabs.sort((a, b) => a.index - b.index);
  const firstTabId = sourceTabs[0].id, lastTabId = sourceTabs.at(-1).id;
  await first.bringToFront();
  await el('previous').click(); await expect.poll(activeUrl).toBe(lastTabId); assert.deepEqual(await snapshot(), original);
  await el('next').click(); await expect.poll(activeUrl).toBe(firstTabId); assert.deepEqual(await snapshot(), original);
  // A second dock belongs to its own window and cannot retarget the first dock.
  const single = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank#single', type: 'normal' }));
  await trigger('about:blank#single');await expect.poll(async()=> (await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}))).length).toBe(2);
  const targets=(await cdp.send('Target.getTargets')).targetInfos.filter(target=>target.url===`chrome-extension://${extensionId}/index.html`&&target.targetId!==panelTarget.targetId&&!target.attached);
  assert.equal(targets.length,1);const singlePanel=await attachPanel(targets[0].targetId);
  await expect.poll(()=>singlePanel.evaluate('Boolean(document.querySelector("[data-el=previous]")?.disabled&&document.querySelector("[data-el=next]")?.disabled)')).toBe(true);
  assert.equal(await singlePanel.evaluate('(async()=> (await chrome.runtime.sendMessage({type:"browser.move",direction:1,windowId:(await chrome.windows.getCurrent()).id})).data.count)()'),1);
  assert.equal(await native.evaluate('(async()=> (await chrome.windows.getCurrent()).id)()'),sourceWindow);assert.deepEqual(await snapshot(),original);
  assert.equal((await worker.evaluate(()=>chrome.windows.getAll())).some(window=>window.type==='popup'),false);
  await worker.evaluate(id => chrome.windows.remove(id), single.id); await expect(el('next')).toBeEnabled();
  await trigger(first.url()); await expect(el('next')).toBeEnabled();
  // Browser navigation during inference keeps the request, prompt and selections intact.
  delayNext = true; const beforePending = inferenceRequests; await el('go').click(); await expect.poll(() => inferenceRequests).toBe(beforePending + 1);
  await el('input').press('Control+Enter'); assert.equal(inferenceRequests, beforePending + 1);
  await el('next').click(); assert.equal((await snapshot()).prompt, original.prompt); assert.equal((await snapshot()).effort, original.effort); await expect(el('cancel')).toBeVisible();
  delayed(); await expect(status).toContainText('Test complete'); assert.equal(inferenceRequests, beforePending + 1);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await page.bringToFront(); await el('copy').click(); await expect(status).toContainText('Output copied'); assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Returned output/);
  // Cancel and editing release the slot and discard late output.
  delayNext = true; await el('go').click(); await expect.poll(() => inferenceRequests).toBe(beforePending + 2); await el('cancel').click(); delayed(); await expect(el('result')).toBeHidden();
  delayNext = true; await el('go').click(); await expect.poll(() => inferenceRequests).toBe(beforePending + 3); await el('input').fill('New input'); delayed(); await expect(el('result')).toBeHidden();
  await el('model').selectOption('plain-model'); await expect(el('effort')).toBeDisabled(); await el('go').click(); await expect(status).toContainText('Test complete'); assert.equal(Object.hasOwn(lastRequest, 'thinkingEffort'), false);
  await el('model').selectOption('shared-model');
  // Register another selected account without reusing the first account's client registration or credentials.
  async function selectNewRegistration(next){await el('signout').click();await expect(el('signin')).toBeVisible();await worker.evaluate(async()=>{const key='chatgpt-agent.registration';const record=(await chrome.storage.local.get(key))[key];await chrome.storage.local.set({[key]:{hostId:record.hostId}});});account=next;await approveSignIn();}
  const beforeSwitch=inferenceRequests;await selectNewRegistration('B');await expect(el('effort')).toHaveValue('medium');assert.equal(inferenceRequests,beforeSwitch);
  await el('go').click();await expect(status).toContainText('Test complete');assert.equal(lastRequest.thinkingEffort,'medium');
  delayNext=true;await el('go').click();await expect.poll(()=>inferenceRequests).toBe(beforeSwitch+2);await selectNewRegistration('A');await expect(el('effort')).toHaveValue('high');delayed();await expect(el('result')).toBeHidden();
  // Discovery 403 preserves identity; discovery and inference expiry restore sign-in.
  await page.getByRole('tab', { name: 'Settings', exact: true }).click(); modelFailure = Object.assign(new ProtocolError('provider_request_failed'), { status: 403 }); await el('reload-models').click(); await expect(status).toContainText('cannot access'); await expect(el('signout')).toBeVisible();
  modelFailure = new ProtocolError('SESSION_EXPIRED'); await el('reload-models').click(); await expect(el('signin')).toBeVisible(); await expect(el('model')).toBeDisabled();
  modelFailure = Object.assign(new ProtocolError('provider_authorization_expired'), { status: 401 }); await approveSignIn(); await expect(status).toContainText('session expired'); await expect(el('signin')).toBeVisible();
  await approveSignIn(); await expect(el('effort')).toHaveValue('high'); await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  runFailure = new ProtocolError('SESSION_EXPIRED'); await el('go').click(); await expect(el('signin')).toBeVisible(); await expect(el('result')).toBeHidden();
  await approveSignIn(); await expect(el('effort')).toHaveValue('high');
  await el('go').click(); await expect(status).toContainText('Test complete');
  assert.equal(await page.locator('[role="status"], [role="alert"]').count(), 1); assert.equal(await page.locator('iframe, script:not([src])').count(), 0);
  const layouts = [];
  for (const width of [320, 390, 800, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    for (const y of [0, 200]) {
      const layout = await page.evaluate(y => { scrollTo(0, y); return { width: innerWidth, noOverflow: document.documentElement.scrollWidth <= innerWidth,
        statusAfterNavigation: document.querySelector('[data-el="navigation"]').nextElementSibling === document.querySelector('[role="status"]'),
        adjacent: Math.abs(document.querySelector('[data-el="navigation"]').getBoundingClientRect().bottom - document.querySelector('[role="status"]').getBoundingClientRect().top) < 1 }; }, y);
      assert.equal(layout.noOverflow, true); assert.equal(layout.statusAfterNavigation, true); assert.equal(layout.adjacent, true); layouts.push(layout);
    }
  }
  await page.setViewportSize({ width: 480, height: 1000 }); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: fileURLToPath(new URL('extension.png', artifacts)), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.screenshot({ path: fileURLToPath(new URL('extension-dark.png', artifacts)), fullPage: true });
  await page.getByRole('tab', { name: 'Agent', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true'); await page.keyboard.press('Home');
  await el('signout').click(); await expect(el('signin')).toBeVisible(); await expect(el('result')).toBeHidden(); await expect(el('go')).toBeDisabled();
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => globalThis.cspErrors), []);
  const storage=await worker.evaluate(async()=>({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null),rules:await chrome.declarativeNetRequest.getSessionRules()}));
  assert.deepEqual(storage.rules,[]);assert.ok(storage.local['chatgpt-agent.registration'].clientId);assert.ok(storage.local['chatgpt-agent.registration'].subjectHash);assert.ok(!JSON.stringify(storage).includes('FIXTURE_'));assert.ok(!(await page.locator('body').innerText()).includes('FIXTURE_'));

  const contexts = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'], documentUrls: [chrome.runtime.getURL('index.html')] })); assert.equal(contexts.length, 1);assert.equal(contexts[0].documentId,nativeDocument);
  const report = { mode: 'mock_direct_chatgpt', liveAuthentication: false, providerInference: false, browser: version.product, inferenceRequests, layouts,
    checks: ['MV3 external modules and CSP', 'direct OAuth callback/PKCE/RS256 sign-in and revocation', 'account models and effort', 'safe literal output', 'separate prompt/input', 'Previous/Next first-last wrapping', 'associated browser window', 'single/closed-window handling',
      'navigation preserves prompt/input/model/effort/output', 'navigation preserves pending inference', 'native docked side panel', 'native dock Go/output and navigation during inference', 'panel survives tab navigation', 'panels scoped to their own browser windows', 'no popup created', 'copy', 'cancel', 'duplicate Go', 'editing/stale output', 'unsupported effort omitted', 'same-name/model account changes', 'late account output discarded', '403 retains account', 'initial/reload/inference expiry', 'one shared status bar', 'narrow layouts and scrolling', 'keyboard tabs', 'dark/reduced-motion rendering', 'no runtime/CSP errors', 'no draft/result/token persistence'] };
  await writeFile(new URL('chrome-results.json', artifacts), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally {
  delayed?.(); await context?.close(); await buildExtension();
}
