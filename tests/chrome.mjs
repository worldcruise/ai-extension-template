// Exercise the installed extension with CDP and fixture ChatGPT documents.
// Node's built-in WebSocket keeps this starter free of package dependencies.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '../scripts/build-extension.mjs';
import { serveFixture } from './fixtures/https-server.mjs';
import { checkWorkspaceUI } from './workspace-ui.mjs';
import { checkDeepseekRecoveryUI } from './deepseek-recovery-ui.mjs';
import { checkJobReader } from './job-reader-ui.mjs';
import { checkReadPageShortcut } from './read-page-shortcut-ui.mjs';
import { jobPageFixtures, jobFixtureResponse } from './fixtures/job-pages.mjs';
import { chatFixtureScript } from './fixtures/chat-ui.mjs';
import { generationFixture } from './fixtures/generation-chat.mjs';
import { checkGenerationUI } from './generation-ui.mjs';
import { checkQueueCardsUI } from './queue-cards-ui.mjs';
import { checkProviderWorkflowUI } from './provider-workflow-ui.mjs';
import { checkManualJobUI } from './manual-job-ui.mjs';
import { checkDocumentDownloadUI } from './document-download-ui.mjs';
import { checkJobCleanupUI } from './job-cleanup-ui.mjs';

const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
const paths = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let executable;
for (const path of paths) { try { await access(path); executable = path; break; } catch {} }
if (!executable) throw new Error('Chrome not found. Set CHROME_PATH to your Chrome executable.');

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        clearTimeout(task.timer);
        if (message.error) { task.error.message = `${task.method}: ${message.error.message}`; task.reject(task.error); }
        else task.resolve(message.result);
      } else {
        for (const handler of this.listeners.get(message.method) || []) handler(message.params, message.sessionId);
      }
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const error = new Error(); Error.captureStackTrace(error, this.send);
      const timer = setTimeout(() => { this.pending.delete(id); error.message = `CDP timeout: ${method}`; reject(error); }, method === 'Runtime.evaluate' ? 30000 : 15000);
      this.pending.set(id, { resolve, reject, timer, method, error });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, callback) {
    const callbacks = this.listeners.get(method) || [];
    callbacks.push(callback);
    this.listeners.set(method, callbacks);
  }
}

async function until(check, description, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

let mode = 'ready';
let requests = 0;
const fixtureServer = await serveFixture((request, response) => {
  requests++;
  if (['mail.google.com', 'outlook.office.com'].includes(request.headers.host?.split(':')[0])) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Mail fixture</title><main>Private inbox fixture</main>');
    return;
  }
  if (request.headers.host?.startsWith('chat.deepseek.com')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
    response.end(`<!doctype html><html><head><style>body{font:16px system-ui}nav{display:flex;gap:20px}textarea{width:90%;margin-top:80px}</style></head><body><button type="button" aria-label="Search chats" onclick="document.getElementById('native-search-dialog').showModal()">Search chats</button><dialog id="native-search-dialog"><input placeholder="Search chats"></dialog><div id="history-open" role="button" tabindex="0" style="position:absolute;left:8px;top:8px;width:24px;height:24px"><svg width="20" height="20"><path d="M2 2h16v16H2z"/></svg></div><div id="history-close" role="button" tabindex="0" style="position:absolute;left:8px;top:8px;width:24px;height:24px" hidden><svg width="20" height="20"><path d="M2 2h16v16H2z"/></svg></div><nav id="history" hidden><div><h3>Pinned</h3><a href="/a/chat/s/pinned-old">Pinned older chat</a><h3>Recent</h3><a href="/a/chat/s/11111111-1111-4111-8111-111111111111">Recent DeepSeek chat</a><a href="/a/chat/s/22222222-2222-4222-8222-222222222222">Older DeepSeek chat</a></div></nav><section id="fixture-cookie-banner" role="dialog" style="position:fixed;top:110px;left:10px;right:10px;padding:20px;background:white;border:1px solid black;z-index:20"><p>We use cookies</p><button id="fixture-cookie-reject" onclick="document.getElementById('fixture-cookie-banner').hidden=true;document.body.dataset.cookieChoice='reject'">Reject all</button><button id="fixture-cookie-accept" onclick="document.getElementById('fixture-cookie-banner').hidden=true;document.body.dataset.cookieChoice='accept'">Accept all</button></section><h1>DeepSeek fixture</h1><textarea placeholder="Message DeepSeek"></textarea><script>const nav=document.getElementById('history'),saved=nav.innerHTML,open=document.getElementById('history-open'),close=document.getElementById('history-close');nav.replaceChildren();open.onclick=()=>{setTimeout(()=>{nav.innerHTML=saved;nav.hidden=false;open.hidden=true;close.hidden=false;nav.querySelectorAll('a').forEach(link=>link.onclick=event=>{event.preventDefault();setTimeout(()=>{history.pushState({},'',link.getAttribute('href'));nav.hidden=false;open.hidden=true;close.hidden=false;},150);});},250);};close.onclick=()=>{nav.hidden=true;nav.replaceChildren();open.hidden=false;close.hidden=true;};</script><script>(${generationFixture.toString()})();</script></body></html>`);
    return;
  }
  const extractionPage=jobFixtureResponse(request.headers.host?.split(':')[0],request.url);
  if (extractionPage) {
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'self'; script-src 'none'; style-src 'self'"});
    response.end(extractionPage);return;
  }
  if (request.headers.host?.startsWith('jobs.example.test')) {
    if (request.url === '/job.css') {
      response.writeHead(200, { 'Content-Type':'text/css' });
      response.end('body{font:16px/1.7 system-ui;color:#20292d;max-width:720px;margin:50px auto;padding:24px}h1{font-size:30px}textarea{width:100%;padding:12px}');
    } else {
      response.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'none'" });
      response.end('<!doctype html><html><head><title>Software Engineer · Job fixture</title><link rel="stylesheet" href="/job.css"></head><body><main><h1>Software Engineer</h1><p id="job-text">Build React apps with C++ and SQL. We value machine <strong>learning</strong>.</p><p>Treat &lt;img src=x onerror=alert(1)&gt; as a literal keyword.</p><p hidden>React SQL</p><textarea id="job-notes">React SQL private notes</textarea><div contenteditable="true">React draft</div><button type="button">React filter</button></main></body></html>');
    }
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'"
  });
  response.end(mode === 'slow' ? '<!doctype html><p>Loading fixture…</p>' : fixture(mode === 'guest'));
});
const profile = await mkdtemp(join(tmpdir(), 'sidebar-gpt-test-'));
const browser = spawn(executable, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  `--host-resolver-rules=${[...new Set(['chatgpt.com','chat.deepseek.com','mail.google.com','outlook.office.com','jobs.example.test','blocked.jobs.example.test',...jobPageFixtures.map(item=>item.host)])].map(host=>`MAP ${host} 127.0.0.1:${fixtureServer.port}`).join(', ')}`,
  '--no-proxy-server', '--ignore-certificate-errors',
  '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserError;
browser.on('error', error => { browserError = error; });
let cdp;
const sessions = new Map();
const activeSessions = new Set();
const errors = [];
const contexts = new Map();
const savedChats = [
  { title: 'Pinned older chat', url: '/c/pinned-old', pinned: true },
  { title: 'Resume planning', url: '/c/saved-resume' },
  { title: 'Interview notes', url: '/c/saved-interview' },
  { title: 'Resume <img src=x onerror=alert(1)>', url: '/c/saved-literal' },
  { title: 'Unrelated external link', url: 'https://example.test/c/not-a-chat' }
];
const fixture = guest => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#fff;color:#202526;font:15px system-ui;display:flex;flex-direction:column;min-height:100vh}main{flex:1;display:grid;place-content:center;text-align:center;padding:24px}h1{font-size:25px;font-weight:550}p{color:#727b7b;font-size:13px}form{margin:18px;border:1px solid #dce3df;border-radius:22px;padding:16px;background:#f6f8f7}textarea{border:0;resize:none;background:transparent;width:100%;font:14px system-ui;outline:none}button{border:0;background:#147d66;color:white;padding:8px 14px;border-radius:20px}</style>
</head><body><button type="button" aria-label="Search chats" onclick="document.getElementById('native-search-dialog').showModal()">Search chats</button><dialog id="native-search-dialog"><input placeholder="Search chats"></dialog><button id="sidebar-open" type="button" data-testid="open-sidebar-button" aria-label="Open sidebar" style="position:absolute;top:12px;left:12px">Chats</button><button id="sidebar-close" type="button" data-testid="close-sidebar-button" aria-label="Close sidebar" hidden style="position:absolute;top:12px;left:12px">Close chats</button><nav id="history" aria-label="Chat history" hidden style="position:absolute;top:50px;left:12px;max-width:250px;background:white;padding:12px;border:1px solid #ddd"></nav><main><h1>What can I help with?</h1><p>Local ChatGPT fixture · no live account</p></main><form ${guest ? 'data-logged-out' : ''}><textarea id="prompt-textarea" placeholder="Ask anything"></textarea>${guest ? '<button type="button" data-testid="login-button">Log in</button>' : ''}</form><script>
const sidebarHistory=document.getElementById('history'), sidebarOpen=document.getElementById('sidebar-open'), sidebarClose=document.getElementById('sidebar-close');
sidebarOpen.addEventListener('click',()=>{sidebarHistory.replaceChildren(...${JSON.stringify(savedChats)}.map(chat=>{const link=document.createElement('a');link.href=chat.url;link.textContent=chat.title;if(chat.pinned)link.dataset.pinned='true';link.style.display='block';link.addEventListener('click',event=>{if(link.origin===location.origin && /^\\/c\\//.test(link.pathname)){event.preventDefault();window.history.pushState({},'',link.pathname);dispatchEvent(new PopStateEvent('popstate'));}});return link}));sidebarHistory.hidden=false;sidebarOpen.hidden=true;sidebarClose.hidden=false;});
sidebarClose.addEventListener('click',()=>{sidebarHistory.hidden=true;sidebarHistory.replaceChildren();sidebarOpen.hidden=false;sidebarClose.hidden=true;});
</script><script>(${chatFixtureScript.toString()})();(${generationFixture.toString()})();</script></body></html>`;

try {
  const port = await until(async () => {
    if (browserError) throw browserError;
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); }
    catch { return null; }
  }, 'Chrome debugging port');
  const socket = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  cdp = new CDP(socket);
  cdp.on('Runtime.exceptionThrown', params => errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text));
  cdp.on('Runtime.executionContextCreated', ({ context }, sessionId) => {
    const current = contexts.get(sessionId) || new Map(); current.set(context.id, context); contexts.set(sessionId, current);
  });
  cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }, sessionId) => contexts.get(sessionId)?.delete(executionContextId));
  cdp.on('Runtime.executionContextsCleared', (_, sessionId) => contexts.delete(sessionId));
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => activeSessions.delete(sessionId));
  cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    activeSessions.add(sessionId);
    const configuring = (async () => {
      await cdp.send('Runtime.enable', {}, sessionId);
      if (['page', 'iframe', 'other'].includes(targetInfo.type)) {
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
      }
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
      return sessionId;
    })();
    sessions.set(targetInfo.targetId, configuring);
    configuring.catch(error => {
      // Navigation can discard a short-lived target while CDP configures it.
      if (activeSessions.has(sessionId) && !error.message.endsWith('Session with given id not found.')) errors.push(error.message);
    });
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const version = await cdp.send('Browser.getVersion');
  const output = await buildExtension();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: output });
  const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
  const worker = await until(async () => (await targets()).find(target => target.type === 'service_worker' && target.url.includes(id)), 'extension worker');
  async function session(targetId) {
    if (sessions.has(targetId)) return sessions.get(targetId);
    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    return sessions.get(targetId) || attached.sessionId;
  }
  const workerSession = await session(worker.targetId);
  async function evaluate(sessionId, expression, contextId) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, ...(contextId ? { contextId } : {}) }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  await until(() => evaluate(workerSession, 'typeof chrome !== "undefined" && Boolean(chrome.declarativeNetRequest) && chrome.declarativeNetRequest.getDynamicRules().then(rules => rules.length === 2)'), 'embed rules');
  // Older layout/generation fixtures assert tab counts and focus. Exercise
  // automatic downloads/previews in their dedicated real-download suite.
  if (!process.argv.includes('--documents-only')) await evaluate(workerSession, 'chrome.storage.local.set({documentSettings:{autoDownload:false}})');
  assert.equal(await evaluate(workerSession, '(async () => (await chrome.sidePanel.getPanelBehavior()).openPanelOnActionClick)()'), false);
  const rules = await evaluate(workerSession, 'chrome.declarativeNetRequest.getDynamicRules()');
  assert.deepEqual(rules[0].condition.initiatorDomains, [id]);
  // Chrome evaluates the actual installed rule against representative requests.
  for (const [initiator, type, count] of [[`chrome-extension://${id}`, 'sub_frame', 1], ['https://other.example', 'sub_frame', 0], [`chrome-extension://${id}`, 'main_frame', 0]]) {
    const result = await evaluate(workerSession, `chrome.declarativeNetRequest.testMatchOutcome(${JSON.stringify({ url: 'https://chatgpt.com/', initiator, type })})`);
    assert.equal(result.matchedRules.length, count);
  }

  const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${id}/index.html` });
  const panel = await session(targetId);
  const read = expression => evaluate(panel, expression);
  const click = async selector => {
    await read(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(() => read('document.documentElement.dataset.studioBusy !== "true"'), 'Studio action saved');
  };
  const state = () => read('document.getElementById("connection").dataset.state');
  await until(() => read('document.documentElement?.dataset.studioReady === "true"'), 'combined workspace startup');
  if (process.argv.includes('--memory-only')) {
    const {checkMemoryUI}=await import('./memory-ui.mjs');
    const report=await checkMemoryUI({cdp,panel,workerSession,read,evaluate});
    await writeFile(join(artifacts,process.argv.includes('--baseline')?'memory-baseline.json':'memory-current.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } else if (process.argv.includes('--hiringcafe-company-only')) {
    const {checkHiringCafeCompany}=await import('./hiringcafe-company-ui.mjs');
    const report=await checkHiringCafeCompany({cdp,read,evaluate,until,session});
    assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,'hiringcafe-company-results.json'),JSON.stringify({fixtureOnly:true,...report},null,2));
    console.log('HiringCafe company extraction browser checks passed.');
  } else if (process.argv.includes('--job-cleanup-only')) {
    const report=await checkJobCleanupUI({cdp,panel,read,click,evaluate,until,targets,session});
    assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,'job-cleanup-results.json'),JSON.stringify({fixtureOnly:true,...report},null,2));
    console.log('AI job cleanup browser checks passed.');
  } else if (process.argv.includes('--documents-only')) {
    const report = await checkDocumentDownloadUI({ cdp, panel, targetId, evaluate, until, targets, session, artifacts, workerSession });
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'document-download-results.json'), JSON.stringify({ fixtureOnly:true, ...report }, null, 2));
    console.log('Document download and settings browser checks passed.');
  } else if (process.argv.includes('--deepseek-single-only')) {
    const checks = await checkGenerationUI({ cdp, panel, read, click, evaluate, until, targets, session, artifacts, workerSession, deepseekSingle:true });
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'deepseek-single-results.json'), JSON.stringify({ fixtureOnly:true, checks }, null, 2));
    console.log('Single-tab DeepSeek browser checks passed.');
  } else if (process.argv.includes('--manual-job-only')) {
    const report = await checkManualJobUI({ cdp, panel, read, click, until, artifacts });
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'manual-job-results.json'), JSON.stringify({ fixtureOnly:true, ...report }, null, 2));
    console.log('Manual job fallback browser checks passed.');
  } else if (process.argv.includes('--provider-workflow-only')) {
    const report = await checkProviderWorkflowUI({ cdp, panel, read, click, until, artifacts });
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'provider-workflow-results.json'), JSON.stringify({ fixtureOnly:true, ...report }, null, 2));
    console.log('Provider workflow browser checks passed.');
  } else if (process.argv.includes('--csv-only')) {
    const { checkJobCsvUI } = await import('./job-csv-ui.mjs');
    const report = await checkJobCsvUI({read,click,until});
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts,'job-csv-results.json'),JSON.stringify({fixtureOnly:true,...report},null,2));
    console.log('CSV job import browser checks passed.');
  } else if (process.argv.includes('--batch-only')) {
    const { checkResumeBatchUI } = await import('./resume-batch-ui.mjs');
    const report = await checkResumeBatchUI({ cdp, panel, read, click, evaluate, until, session });
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'resume-batch-results.json'), JSON.stringify({fixtureOnly:true,...report},null,2));
    console.log('Sequential resume batch browser checks passed.');
  } else if (process.argv.includes('--cards-only')) {
    const report = await checkQueueCardsUI({ cdp, panel, read, click, until, artifacts });
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'queue-cards-results.json'), JSON.stringify({ fixtureOnly:true, ...report }, null, 2));
    console.log('Queue card browser checks passed.');
  } else if (process.argv.includes('--generation-only')) {
    const checks = await checkGenerationUI({ cdp, panel, read, click, evaluate, until, targets, session, artifacts, workerSession });
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'generation-results.json'), JSON.stringify({ fixtureOnly: true, checks }, null, 2));
    console.log('Document generation browser checks passed.');
  } else {
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 0, 'real queue starts empty');
  await click('#job-tab'); await click('#account-toggle'); await click('#profile-details'); await click('#reset-examples');
  await read('if (document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  await until(async () => await state() === 'ready', 'embedded ChatGPT readiness');
  assert.equal(await read('document.getElementById("connection").hidden'), true);
  assert.equal(await read('document.getElementById("deepseek-frame").hasAttribute("src")'), false, 'DeepSeek stays unloaded until selected');
  await read('globalThis.prematureDeepseekMessages=0;document.getElementById("deepseek-frame").contentWindow.postMessage=()=>{prematureDeepseekMessages++;throw new Error("DeepSeek command reached initial extension-origin document")};document.getElementById("deepseek-frame").dispatchEvent(new Event("load"))');
  assert.equal(await read('prematureDeepseekMessages'), 0, 'initial iframe load sends no DeepSeek window messages');
  await read('globalThis.originalChatFrame = document.getElementById("chatgpt-frame"); document.getElementById("chat-provider").value = "deepseek"; document.getElementById("chat-provider").dispatchEvent(new Event("change"))');
  await until(() => read('!document.getElementById("deepseek-pane").hidden'), 'DeepSeek provider selection');
  assert.equal(await read('document.getElementById("deepseek-frame").src'), 'https://chat.deepseek.com/');
  assert.equal(await read('document.getElementById("chatgpt-pane").hidden'), true);
  await until(() => read('!document.getElementById("deepseek-new-chat").disabled'), 'DeepSeek toolbar connected');
  const deepseekTarget = await until(async () => (await targets()).find(target => target.type === 'iframe' && target.url.startsWith('https://chat.deepseek.com/')), 'DeepSeek fixture frame');
  const deepseekSession = await session(deepseekTarget.targetId);
  await until(() => evaluate(deepseekSession, 'Boolean(document.getElementById("fixture-cookie-reject"))'), 'DeepSeek cookie fixture ready');
  assert.equal(await evaluate(deepseekSession, 'document.getElementById("fixture-cookie-banner").hidden'), false, 'cookie choice is left to the user on first use');
  await cdp.send('Page.bringToFront', {}, panel);
  await read('Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})))');
  await until(() => evaluate(deepseekSession, '!document.documentElement.inert'), 'DeepSeek cookie controls are interactive');
  await read('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await evaluate(deepseekSession, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const cookieButton = await evaluate(deepseekSession, '(()=>{const r=document.getElementById("fixture-cookie-reject").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
  const framePosition = await read('(()=>{const r=document.getElementById("deepseek-frame").getBoundingClientRect();return{x:r.x,y:r.y}})()');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: framePosition.x + cookieButton.x, y: framePosition.y + cookieButton.y }, panel);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: framePosition.x + cookieButton.x, y: framePosition.y + cookieButton.y, button: 'left', clickCount: 1 }, panel);
  await until(() => read('chrome.storage.local.get("deepseekCookieChoice").then(value=>value.deepseekCookieChoice?.kind==="reject-optional")'), 'trusted cookie choice remembered');
  await until(() => evaluate(deepseekSession, 'document.getElementById("fixture-cookie-banner").hidden'), 'cookie banner dismissed');
  const deepseekDocument = await evaluate(deepseekSession, 'performance.timeOrigin');
  await click('#deepseek-chat-toolbar-reveal');
  await click('#deepseek-chat-toolbar-pin');
  assert.equal(await read('document.getElementById("deepseek-chat-toolbar-shell").dataset.pinned'), 'true');
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.pinned'), 'false', 'provider pin preferences are independent');
  await read('document.getElementById("deepseek-company-chat-search").value="budget notes";document.getElementById("deepseek-native-search-form").requestSubmit()');
  await until(() => evaluate(deepseekSession, 'document.getElementById("native-search-dialog").open && document.querySelector("#native-search-dialog input").value === "budget notes"'), 'DeepSeek searches typed query in its native input');
  await until(() => read('!document.getElementById("deepseek-native-search-submit").disabled'), 'DeepSeek search readback finishes');
  assert.equal(await read('document.getElementById("deepseek-native-search-status").hidden'), true, 'DeepSeek query accepted without error');
  assert.equal(await read('document.querySelectorAll("#deepseek-company-chat-list").length'), 0);
  await evaluate(deepseekSession, 'document.getElementById("native-search-dialog").close()');
  await until(() => read('!document.getElementById("deepseek-chat-history-down").disabled'), 'DeepSeek history available with sidebar closed');
  assert.equal(await evaluate(deepseekSession, 'document.getElementById("history").hidden && !document.querySelectorAll("#history a").length'), true, 'DeepSeek history is unmounted while closed');
  await click('#deepseek-chat-history-down');
  await until(() => evaluate(deepseekSession, 'location.pathname === "/a/chat/s/11111111-1111-4111-8111-111111111111"'), 'DeepSeek native history navigation');
  await until(() => evaluate(deepseekSession, 'document.getElementById("history").hidden'), 'DeepSeek restores closed sidebar after first arrow');
  assert.equal(await evaluate(deepseekSession, 'performance.timeOrigin'), deepseekDocument, 'arrow navigation preserves the DeepSeek document');
  assert.equal(await evaluate(deepseekSession, 'document.getElementById("fixture-cookie-banner").hidden'), true, 'cookie banner stays dismissed between chats');
  await until(() => read('!document.getElementById("deepseek-chat-history-down").disabled'), 'DeepSeek first navigation acknowledged');
  await click('#deepseek-chat-history-down');
  await until(() => read('!document.getElementById("deepseek-chat-history-up").disabled'), 'older DeepSeek chat enables Up before opening a pin');
  await evaluate(deepseekSession, 'history.pushState({},"","/a/chat/s/pinned-old")');
  await until(() => read('document.getElementById("deepseek-chat-history-up").disabled && !document.getElementById("deepseek-chat-history-down").disabled'), 'pinned DeepSeek chat offers newest regular chat');
  await click('#deepseek-chat-history-down');
  await until(() => evaluate(deepseekSession, 'location.pathname === "/a/chat/s/11111111-1111-4111-8111-111111111111" && document.getElementById("history").hidden'), 'DeepSeek leaves a pinned chat for newest regular history');
  await evaluate(deepseekSession, 'document.querySelector("textarea").value="Keep my draft";document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('document.getElementById("deepseek-new-chat").disabled && document.getElementById("deepseek-reload").disabled && document.getElementById("deepseek-chat-history-down").disabled'), 'DeepSeek draft guards');
  await click('#deepseek-zoom-in');
  await until(() => evaluate(deepseekSession, 'getComputedStyle(document.querySelector("h1")).fontSize === "35.2px"'), 'DeepSeek text sizing');
  assert.equal(await evaluate(deepseekSession, 'document.querySelector("textarea").value'), 'Keep my draft');
  await evaluate(deepseekSession, 'document.querySelector("textarea").value="";document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('!document.getElementById("deepseek-chat-history-down").disabled'), 'DeepSeek draft cleared');
  await click('#deepseek-chat-history-down');
  await until(() => evaluate(deepseekSession, 'location.pathname === "/a/chat/s/22222222-2222-4222-8222-222222222222"'), 'DeepSeek older history navigation');
  await until(() => read('!document.getElementById("deepseek-chat-history-up").disabled'), 'DeepSeek newer arrow available with closed sidebar');
  await click('#deepseek-chat-history-up');
  await until(() => evaluate(deepseekSession, 'location.pathname === "/a/chat/s/11111111-1111-4111-8111-111111111111" && document.getElementById("history").hidden'), 'DeepSeek newer navigation restores closed sidebar');
  await until(() => read('!document.getElementById("deepseek-chat-history-down").disabled'), 'DeepSeek older arrow restored');
  await click('#deepseek-chat-history-down');
  await until(() => evaluate(deepseekSession, 'location.pathname === "/a/chat/s/22222222-2222-4222-8222-222222222222" && document.getElementById("history").hidden'), 'DeepSeek older navigation from closed sidebar');
  assert.equal(await evaluate(deepseekSession, 'performance.timeOrigin'), deepseekDocument, 'repeated arrows do not reload DeepSeek');
  await click('#deepseek-open-tab');
  await until(async () => (await targets()).some(target => target.type === 'page' && target.url === 'https://chat.deepseek.com/a/chat/s/22222222-2222-4222-8222-222222222222'), 'DeepSeek current conversation opens in tab');
  const beforeDeepseekReload = await evaluate(deepseekSession, 'performance.timeOrigin');
  await click('#deepseek-reload');
  await until(async () => await evaluate(deepseekSession, 'performance.timeOrigin') !== beforeDeepseekReload && await evaluate(deepseekSession, 'location.pathname === "/a/chat/s/22222222-2222-4222-8222-222222222222"'), 'DeepSeek reload document');
  await until(() => read('!document.getElementById("deepseek-reload").disabled'), 'DeepSeek reload reconnects');
  assert.equal(await evaluate(deepseekSession, 'location.pathname'), '/a/chat/s/22222222-2222-4222-8222-222222222222', 'reload keeps DeepSeek conversation');
  await until(() => evaluate(deepseekSession, 'document.getElementById("fixture-cookie-banner").hidden && document.body.dataset.cookieChoice === "reject"'), 'explicit reload reuses the remembered cookie choice');
  await evaluate(deepseekSession, 'const stop=document.createElement("button");stop.dataset.testid="stop-button";stop.textContent="Stop";document.body.append(stop)');
  await until(() => read('document.getElementById("deepseek-new-chat").disabled'), 'DeepSeek generation blocks new chat');
  await evaluate(deepseekSession, 'document.querySelector("[data-testid=stop-button]").remove()');
  await until(() => read('!document.getElementById("deepseek-new-chat").disabled'), 'DeepSeek generation ends');
  await click('#deepseek-new-chat');
  await until(() => evaluate(deepseekSession, 'location.pathname === "/"'), 'DeepSeek new chat opens home');
  await until(() => read('!document.getElementById("deepseek-reload").disabled'), 'DeepSeek fresh chat reconnects');
  for (const width of [280, 390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true, 'DeepSeek toolbar fits narrow panel');
    assert.equal(await read('document.getElementById("deepseek-frame").getBoundingClientRect().top >= document.getElementById("deepseek-chat-toolbar").getBoundingClientRect().bottom'), true, 'DeepSeek pinned toolbar reserves space');
  }
  await cdp.send('Page.captureScreenshot', { format: 'png' }, panel).then(shot => writeFile(join(artifacts, 'deepseek-toolbar.png'), Buffer.from(shot.data, 'base64')));
  await read('document.getElementById("chat-provider").value = "chatgpt"; document.getElementById("chat-provider").dispatchEvent(new Event("change"))');
  await until(() => read('!document.getElementById("chatgpt-pane").hidden && !document.getElementById("chat-provider").disabled'), 'return to ChatGPT');
  assert.equal(await read('globalThis.originalChatFrame === document.getElementById("chatgpt-frame")'), true, 'switching retains ChatGPT frame identity');
  const iframeTarget = await until(async () => (await targets()).find(target => target.type === 'iframe' && target.url.startsWith('https://chatgpt.com/')), 'ChatGPT frame');
  const frameSession = await session(iframeTarget.targetId);
  const workspace = await checkWorkspaceUI({ cdp, panel, read, click, frameSession, deepseekSession, evaluate, artifacts, until });
  if (process.argv.includes('--workspace-only') || process.argv.includes('--dock-only')) {
    if (process.argv.includes('--workspace-only')) {
      workspace.checks.push(...await checkDeepseekRecoveryUI({ cdp, panel, read, click, evaluate, until, frameSession, targets, session }));
      workspace.checks.push(...await checkGenerationUI({ cdp, panel, read, click, evaluate, until, targets, session, artifacts, workerSession }));
    }
    assert.deepEqual(errors, []);
    const report = { fixtureOnly: true, workspaceOnly: true, workspace };
    await writeFile(join(artifacts, 'workspace-results.json'), JSON.stringify(report, null, 2));
    console.log('Workspace browser checks passed.');
  } else {
  await evaluate(frameSession, 'history.pushState({}, "", "/c/fixture-chat?secret=do-not-relay"); dispatchEvent(new PopStateEvent("popstate"))');
  await delay(200);
  await click('#open-tab');
  await until(async () => (await targets()).some(target => target.type === 'page' && target.url === 'https://chatgpt.com/c/fixture-chat'), 'open current conversation');
  await click('#chat-toolbar-pin');
  await click('#reload');
  await until(async () => await read('document.getElementById("chatgpt-frame").src') === 'https://chatgpt.com/c/fixture-chat', 'reload conversation route');
  await until(async () => await state() === 'ready', 'reload readiness');
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'true', 'toolbar remains pinned after frame reload');
  assert.equal(await read('document.getElementById("chat-toolbar-pin").getAttribute("aria-pressed")'), 'true');
  assert.equal(await read('document.getElementById("chatgpt-frame").getBoundingClientRect().top >= document.getElementById("chat-toolbar").getBoundingClientRect().bottom'), true, 'pinned toolbar reserves space after reloading the chat');
  // A second extension page starts with the stored pin preference. Closing this
  // isolated page leaves the original fixture panel and conversation mounted.
  const restoredToolbar = await cdp.send('Target.createTarget', { url: `chrome-extension://${id}/index.html` });
  try {
    const restoredSession = await session(restoredToolbar.targetId);
    await until(() => evaluate(restoredSession, 'document.getElementById("chat-toolbar-pin")?.getAttribute("aria-pressed") === "true"'), 'saved toolbar pin restored in a new panel');
    assert.equal(await evaluate(restoredSession, 'document.getElementById("chat-toolbar-shell").dataset.open'), 'true');
    await evaluate(restoredSession, 'if (document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
    assert.equal(await evaluate(restoredSession, 'document.getElementById("chatgpt-frame").getBoundingClientRect().top >= document.getElementById("chat-toolbar").getBoundingClientRect().bottom'), true, 'restored pin reserves space in the new panel');
  } finally {
    await cdp.send('Target.closeTarget', { targetId: restoredToolbar.targetId });
    await cdp.send('Page.bringToFront', {}, panel);
  }
  await click('#chat-toolbar-pin');
  await click('#new-chat');
  await until(async () => await read('document.getElementById("chatgpt-frame").src') === 'https://chatgpt.com/', 'new chat');
  await until(async () => await state() === 'ready', 'new chat readiness');

  mode = 'guest';
  await click('#reload');
  await until(async () => await state() === 'guest', 'guest recovery');
  assert.equal(await read('document.getElementById("recovery").hidden'), false);
  await click('#chat-toolbar-reveal');
  await read('document.getElementById("company-chat-search").focus()');
  await until(async () => (await read('document.getElementById("company-chat-status").textContent')).includes('Sign in to ChatGPT'), 'saved ChatGPT chats clear when signed out');
  assert.equal(await read('document.querySelectorAll("#company-chat-list button").length'), 0);
  await read('document.getElementById("company-chat-search").blur()');
  await until(() => read('document.getElementById("company-chat-menu").hidden'), 'company search closes on blur');
  await click('#sign-in');
  await until(async () => (await targets()).some(target => target.type === 'page' && target.url === 'https://chatgpt.com/auth/login'), 'first-party sign-in tab');
  const loginTabs = (await targets()).filter(target => target.type === 'page' && target.url === 'https://chatgpt.com/auth/login').length;
  await evaluate(frameSession, 'document.querySelector("[data-testid=login-button]").click()');
  await until(async () => (await targets()).filter(target => target.type === 'page' && target.url === 'https://chatgpt.com/auth/login').length === loginTabs + 1, 'embedded sign-in handoff');
  mode = 'slow';
  await click('#retry');
  await until(async () => await state() === 'slow', 'slow frame recovery without claiming logout', 35000);
  assert.equal(await read('document.getElementById("chatgpt-frame").hidden'), false);
  assert.equal(await read('document.getElementById("status").textContent.includes("Sign in")'), false);
  assert.equal(await read('document.getElementById("sign-in").textContent'), 'Open ChatGPT');
  mode = 'ready';
  await click('#retry');
  await until(async () => await state() === 'ready', 'retry after sign-in');

  const layouts = [];
  for (const width of [280, 360, 480, 800]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    const layout = await read('({width: innerWidth, noOverflow: document.documentElement.scrollWidth <= innerWidth, frameHeight: document.querySelector("iframe").getBoundingClientRect().height})');
    assert.equal(layout.noOverflow, true);
    assert.ok(layout.frameHeight > 500);
    layouts.push(layout);
  }
  await mkdir(artifacts, { recursive: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
  await cdp.send('Page.bringToFront', {}, panel);
  await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, panel);
  await writeFile(join(artifacts, 'sidebar-gpt.png'), Buffer.from(screenshot.data, 'base64'));

  // Exercise Chrome's real dock, separately from the extension page in a tab.
  const sourceUrl = 'https://jobs.example.test/engineering';
  const source = await cdp.send('Target.createTarget', { url: sourceUrl });
  const sourceSession = await session(source.targetId);
  await until(() => evaluate(sourceSession, 'Boolean(document.getElementById("job-text"))'), 'job page fixture loaded');
  const jobMarkup = await evaluate(sourceSession, 'document.body.innerHTML');
  const tab = await until(async () => (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(target => target.url === sourceUrl), 'source tab');
  await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
  await until(() => evaluate(workerSession, 'chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]}).then(items => items.length === 1)'), 'native side panel');
  const dock = await until(async () => (await targets()).find(target => target.targetId !== targetId && target.url === `chrome-extension://${id}/index.html`), 'native dock target');
  let dockSession = await session(dock.targetId);
  await until(() => evaluate(dockSession, 'Boolean(document.querySelector("#resume-queue .job-request"))'), 'native workspace startup');
  const totalHighlights = () => evaluate(sourceSession, '[...CSS.highlights].filter(([name]) => name.startsWith("ai-agent-job-keywords-")).reduce((count, [, ranges]) => count + ranges.size, 0)');
  try {
    await until(async () => await totalHighlights() === 5, 'job page keyword highlights');
  } catch (error) {
    const details = await evaluate(dockSession, `(async () => ({hint:document.getElementById('highlight-keywords').title,
      enabled:document.getElementById('highlight-keywords').checked,
      settings:await chrome.storage.local.get('keywordHighlights'),
      tabs:await chrome.tabs.query({currentWindow:true,active:true})}))()`);
    details.page = await evaluate(sourceSession, '({highlights:[...CSS.highlights.keys()]})');
    throw new Error(`${error.message}: ${JSON.stringify(details)}`);
  }
  assert.equal(await evaluate(sourceSession, 'document.body.innerHTML'), jobMarkup);
  assert.equal(await evaluate(sourceSession, 'document.getElementById("job-notes").value'), 'React SQL private notes');
  assert.deepEqual(await evaluate(sourceSession, 'Object.fromEntries([...CSS.highlights].filter(([name]) => name.startsWith("ai-agent-job-keywords-")).map(([name, ranges]) => [name.replace("ai-agent-job-keywords-", ""), [...ranges].map(range => range.toString())]))'), {
    yellow:['C++'], green:['React'], blue:['machine learning'], red:['SQL'], purple:['<img src=x onerror=alert(1)>']
  });
  assert.equal(await evaluate(sourceSession, 'getComputedStyle(document.documentElement).getPropertyValue("--ai-agent-keyword-color-red").trim()'), '#ff5252');
  assert.equal(await evaluate(sourceSession, 'getComputedStyle(document.documentElement).getPropertyValue("--ai-agent-keyword-color-green").trim()'), '#b7e4ca');
  assert.equal(await evaluate(dockSession, '[...CSS.highlights.keys()].some(name => name.startsWith("ai-agent-job-keywords"))'), false);
  await evaluate(sourceSession, 'const extra=document.createElement("p"); extra.textContent="React SQL ReactNative AWS Kubernetes"; document.querySelector("main").append(extra)');
  await until(async () => await totalHighlights() === 9, 'new job content highlighted in all seven colors');
  assert.deepEqual(await evaluate(sourceSession, '[...CSS.highlights.get("ai-agent-job-keywords-orange")].map(range => range.toString())'), ['AWS']);
  assert.deepEqual(await evaluate(sourceSession, '[...CSS.highlights.get("ai-agent-job-keywords-custom")].map(range => range.toString())'), ['Kubernetes']);
  assert.equal(await evaluate(sourceSession, 'getComputedStyle(document.documentElement).getPropertyValue("--ai-agent-keyword-color-custom").trim()'), '#c7f0ed');
  const storedHighlights = await evaluate(dockSession, 'chrome.storage.local.get("keywordHighlights").then(data => data.keywordHighlights)');
  const withoutOrange = structuredClone(storedHighlights);
  withoutOrange.groups.find(group => group.id === 'orange').keywords = [];
  await evaluate(dockSession, `chrome.storage.local.set({keywordHighlights:${JSON.stringify(withoutOrange)}})`);
  await until(async () => await totalHighlights() === 8, 'clearing one list removes only that color');
  assert.equal(await evaluate(sourceSession, 'CSS.highlights.has("ai-agent-job-keywords-orange")'), false);
  const emptyHighlights = structuredClone(storedHighlights);
  for (const group of emptyHighlights.groups) group.keywords = [];
  await evaluate(dockSession, `chrome.storage.local.set({keywordHighlights:${JSON.stringify(emptyHighlights)}})`);
  await until(async () => await totalHighlights() === 0, 'clearing every list removes all highlights while enabled');
  await evaluate(dockSession, `chrome.storage.local.set({keywordHighlights:${JSON.stringify(storedHighlights)}})`);
  await until(async () => await totalHighlights() === 9, 'saved color groups restored');
  await evaluate(dockSession, 'document.getElementById("job-tab").click()');
  await until(() => evaluate(dockSession, 'document.getElementById("job-url").value === "https://jobs.example.test/engineering"'), 'accessible page URL autofills');
  await until(() => evaluate(dockSession, '!document.getElementById("highlight-keywords").disabled'), 'native keyword toggle loaded');
  assert.equal(await evaluate(dockSession, 'document.getElementById("highlight-keywords").checked'), true);
  await evaluate(dockSession, 'document.getElementById("highlight-keywords").click()');
  await until(async () => await totalHighlights() === 0, 'turn off page highlights');
  await evaluate(dockSession, 'document.getElementById("highlight-keywords").click()');
  await until(async () => await totalHighlights() === 9, 'turn on page highlights');
  await cdp.send('Page.bringToFront', {}, sourceSession);
  const jobShot = await cdp.send('Page.captureScreenshot', {format:'png'}, sourceSession);
  await writeFile(join(artifacts, 'job-page-highlights.png'), Buffer.from(jobShot.data, 'base64'));
  await cdp.send('Page.navigate', {url:'https://jobs.example.test/another-job'}, sourceSession);
  await until(async () => await totalHighlights() === 5, 'highlighting survives same-site job navigation');
  const extraction=await checkJobReader({cdp,id,sourceSession,dockSession,evaluate,until});
  const shortcut = await checkReadPageShortcut({cdp,id,workerSession,sourceSession,dockSession,evaluate,until,session});
  dockSession = shortcut.dockSession;
  await evaluate(dockSession, 'if (document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  await until(async () => await evaluate(dockSession, 'document.getElementById("connection")?.dataset.state') === 'ready', 'native dock ChatGPT readiness');
  const dockContexts = await evaluate(workerSession, 'chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]})');
  await cdp.send('Page.navigate', { url: 'about:blank#another-page' }, await session(source.targetId));
  assert.equal((await evaluate(workerSession, 'chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]})'))[0].documentId, dockContexts[0].documentId);
  assert.equal(await evaluate(workerSession, 'chrome.windows.getAll().then(items => items.some(win => win.type === "popup"))'), false);
  assert.deepEqual(errors, []);
  const report = { browser: version.product, fixtureOnly: true, liveAuthentication: false, requests, layouts, workspace, extraction,
    shortcut: { assigned: shortcut.shortcut, warmDock: shortcut.warmDock, coldDock: shortcut.coldDock, physicalKeyboard: shortcut.physicalKeyboard },
    checks: ['unpacked extension loads', 'native dock opens from toolbar', 'dock survives tab navigation', 'installed header rule scope', 'embedding with restrictive response headers',
      'frame readiness', 'current conversation in new tab', 'reload keeps conversation', 'new chat', 'guest sign-in tab', 'embedded sign-in handoff',
      'job-page-only keyword highlighting with temporary page access', 'literal and cross-element phrases preserve page markup',
      'stored settings load in a new dock', 'dynamic job content and toggle removal', 'same-site job navigation retains highlights',
      'slow-loading recovery', 'retry', 'narrow layouts', 'no runtime errors'] };
  await writeFile(join(artifacts, 'chrome-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  }
  }
} catch (error) {
  await mkdir(artifacts, { recursive: true });
  const targetInfos = cdp ? (await cdp.send('Target.getTargets')).targetInfos : [];
  await writeFile(join(artifacts, 'chrome-failure.json'), JSON.stringify({ error: error.message, errors, requests, targets: targetInfos }, null, 2));
  throw error;
} finally {
  if (cdp) { try { await cdp.send('Browser.close'); } catch {} cdp.socket.close(); }
  if (browser.exitCode === null) {
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(5000)]);
    if (browser.exitCode === null) browser.kill();
  }
  const absoluteProfile = resolve(profile);
  if (dirname(absoluteProfile) !== resolve(tmpdir()) || !absoluteProfile.startsWith(join(resolve(tmpdir()), 'sidebar-gpt-test-'))) {
    throw new Error('Refusing to remove an unexpected browser profile path.');
  }
  await rm(absoluteProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fixtureServer.close();
}
