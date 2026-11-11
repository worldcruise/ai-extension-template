import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { generationPrompt } from '../src/generation-data.mjs';
import { exampleProfile } from '../src/resume-data.mjs';
import assert from 'node:assert/strict';

const folder = fileURLToPath(new URL('../artifacts/chatgpt-retention-research/', import.meta.url));
const modules = ['prosemirror-view', 'prosemirror-model', 'prosemirror-state', 'prosemirror-transform', 'orderedmap'];
for (const name of modules) await readFile(join(folder, 'node_modules', name, 'package.json')).catch(() => {
  throw new Error('Install the optional ProseMirror test packages first; see README.md, Real editor checks.');
});
const imports = Object.fromEntries(modules.map(name => [name, `/node_modules/${name}/dist/index.js`]));
const html = `<!doctype html><html><head><style>body{font:16px system-ui}.ProseMirror{white-space:pre-wrap;min-height:60px;border:1px solid;padding:12px}p{margin:0}</style><script type="importmap">${JSON.stringify({ imports })}</script></head><body><form id="f"><div id="mount"></div><button id="composer-submit-button" type="submit" aria-label="Send" disabled>Send</button></form><script type="module">
import { Schema } from 'prosemirror-model'; import { EditorState } from 'prosemirror-state'; import { EditorView } from 'prosemirror-view';
const schema = new Schema({ nodes: { doc: { content:'paragraph+' }, paragraph:{content:'inline*',group:'block',parseDOM:[{tag:'p'}],toDOM(){return ['p',0]}}, text:{group:'inline'}, hard_break:{inline:true,group:'inline',selectable:false,parseDOM:[{tag:'br'}],toDOM(){return ['br']}} } });
const send = document.getElementById('composer-submit-button'); document.getElementById('f').onsubmit = e => e.preventDefault();
window.sendCount=0; window.authorizeCount=0;
window.makeView = state => new EditorView(document.getElementById('mount'), { state, attributes:{id:'prompt-textarea'},
dispatchTransaction(tr){view.updateState(view.state.apply(tr)); send.disabled = !view.state.doc.textContent.trim();
  if(!view.state.doc.textContent.trim()) return;
  if(window.mode==='remount' && !window.remountTimer) window.remountTimer=setInterval(()=>{const state=view.state;view.destroy();window.view=makeView(state);view.focus();},70);
  if(window.mode==='alternate-composer' && !document.getElementById('alternate-form')) {const form=document.createElement('form');form.id='alternate-form';const field=document.createElement('textarea');field.id='prompt-textarea';form.append(field);document.body.prepend(form);}
  if(window.mode==='tampered' && !window.tampered) {window.tampered=true;setTimeout(()=>view.dispatch(view.state.tr.insertText('X',1,2)),40);}
},
handleKeyDown(view,event){if(event.key==='Enter'&&!event.shiftKey){window.sendCount++; clearInterval(window.remountTimer); return true;}return false;}});
window.view = makeView(EditorState.create({schema}));
window.ready=true;</script></body></html>`;
const server = createServer(async (req,res) => {
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const path=resolve(folder,'.'+req.url);
  if(!path.startsWith(join(folder,'node_modules')+sep)){res.writeHead(404);res.end();return;}
  try{res.setHeader('Content-Type','text/javascript');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(folder,'chrome-profile-'));
const chrome=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let launchError;chrome.on('error',e=>{launchError=e;});
let socket;const pending=new Map();let sequence=0;
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});}
async function until(fn){for(let i=0;i<100;i++){const value=await fn();if(value)return value;await delay(100);}throw Error('Probe setup timed out');}
try{
  const port=await until(async()=>{if(launchError)throw launchError;try{return(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);}catch{return null;}});
  socket=new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  socket.addEventListener('message',e=>{const data=JSON.parse(e.data);const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);});
  const target=await send('Target.createTarget',{url:`http://127.0.0.1:${server.address().port}/`});
  const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const evaluate=async(expression,contextId)=>{const result=await send('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await until(()=>evaluate('Boolean(window.ready)'));
  const {frameTree}=await send('Page.getFrameTree',{},sessionId);
  const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'extension-adapter-probe'},sessionId);
  const adapter=await readFile(join(folder,'../../src/chatgpt-submit-adapter.js'),'utf8');await evaluate(adapter,executionContextId);
  const base=()=>({id:'synthetic-job',input:{profile:structuredClone(exampleProfile),job:{company:'Synthetic Research',role:'Engineer',description:'Build services.'}}});
  const long=base();long.input.job.description='TypeScript / SQL / C++ — projects, engineering. '.repeat(1000);
  const large=base();large.input.job.description='Long description. '.repeat(9000);
  const cases=[['short','Hello world'],['paragraphs','First line.\n\nSecond line.\nThird line.'],['generated',generationPrompt(base(),'research_run_001')],['long-generated',generationPrompt(long,'research_run_002')],['large-generated',generationPrompt(large,'research_run_003')],['unicode','A\r\nB\rC\nD\tE\u00a0F\u2028G\u2029H 👩‍💻 résumé'],['literal-tabs','First\tsecond\nThird\t\tfourth']];
  const rows=[];
  cases.push(...['layout-transform', 'remount', 'alternate-composer', 'already-prepared', 'tampered'].map(name => [name, generationPrompt(base(), 'research_run_extra')]));
  for(const [name,prompt] of cases){
    await evaluate('window.mode="";clearInterval(window.remountTimer);window.remountTimer=null;window.tampered=false;document.getElementById("alternate-form")?.remove();view.dom.style.textTransform="none";view.dispatch(view.state.tr.delete(0,view.state.doc.content.size));window.sendCount=0;');
    await evaluate(`window.mode=${JSON.stringify(name)};view.dom.style.textTransform=${JSON.stringify(name === 'layout-transform' ? 'uppercase' : 'none')}`);
    if (name === 'already-prepared') await evaluate(`view.dispatch(view.state.tr.insertText(${JSON.stringify(prompt)}));`);
    const result=await evaluate(`(async()=>{let authorizations=0;const a=new __techIntChatAdapterV2.ChatGPTAdapter();try{const result=await a.send(${JSON.stringify(prompt)},new AbortController().signal,{requestId:'research_'+${JSON.stringify(name)},replaceDraft:true,beforeSubmit:async()=>{authorizations++;}});return {ok:true,authorizations,diagnostics:result.diagnostics};}catch(e){return {ok:false,authorizations,code:e.code,error:e.message,diagnostics:e.diagnostics};}})()`,executionContextId);
    const state=await evaluate(String.raw`(()=>{const expected=${JSON.stringify(prompt)}, dom=view.dom,normalize=s=>s.replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\s+/g,' ').trim();const a=normalize(expected),b=normalize(dom.innerText);let i=0;while(i<Math.min(a.length,b.length)&&a[i]===b[i])i++;return{innerTextLength:dom.innerText.length,textContentLength:dom.textContent.length,modelLength:view.state.doc.textBetween(0,view.state.doc.content.size,'\n').length,sendEnabled:!document.getElementById('composer-submit-button').disabled,sendCount,normalizedEqual:a===b,firstDifference:i,expectedAround:a.slice(Math.max(0,i-25),i+50),actualAround:b.slice(Math.max(0,i-25),i+50),domPreview:dom.innerHTML.slice(0,450)};})()`);
    const row={name,expectedLength:prompt.length,...result,...state};rows.push(row);
    console.log(JSON.stringify({ name, ok: result.ok, code: result.code, authorizations: result.authorizations, sendCount: state.sendCount, replacements: result.diagnostics?.replacements }));
    if (name === 'tampered') {
      assert.equal(result.ok, false); assert.equal(result.code, 'prompt_text_mismatch');
      assert.equal(result.authorizations, 0); assert.equal(state.sendCount, 0);
      assert.equal(result.diagnostics.firstDifference, 0); assert.equal(result.diagnostics.sendEnabled, true);
    } else {
      assert.equal(result.ok, true, name + ': ' + result.error); assert.equal(result.authorizations, 1); assert.equal(state.sendCount, 1);
      if (name === 'layout-transform') { assert.equal(state.normalizedEqual, false); assert.equal(result.diagnostics.textMatches, true); }
      if (name === 'remount') assert.ok(result.diagnostics.replacements >= 2);
      if (name === 'already-prepared') { assert.equal(result.diagnostics.insertionMethod, 'existing_text'); assert.equal(result.diagnostics.inputEvents, 0); }
    }
  }
  const versions=Object.fromEntries(await Promise.all(modules.map(async name=>[name,JSON.parse(await readFile(join(folder,'node_modules',name,'package.json'),'utf8')).version])));
  await writeFile(join(folder,'verification-results.json'),JSON.stringify({syntheticOnly:true,versions,rows},null,2));
  console.log('Real ProseMirror checks passed: ' + rows.length);
}finally{if(socket){try{await send('Browser.close');}catch{}socket.close();}else chrome.kill();server.close();}
