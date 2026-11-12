import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { providerTabs, providerTabState, inspectProviderTab, firstIdleProviderTab, openProviderTab } from '../src/ai-tabs.mjs';

function fixture(tabs = []) {
  const entries = new Map(tabs.map(tab => [tab.id, { status: 'complete', windowId: 1, ...tab }]));
  const states = new Map(), inspected = [], created = [], updated = [], focused = [];
  let nextId = Math.max(0, ...entries.keys());
  const browser = { tabs: {
    query: async () => [...entries.values()].map(tab => ({ ...tab })),
    get: async id => { const tab = entries.get(id); if (!tab) throw new Error('Closed'); return { ...tab }; },
    create: async values => { const tab = { id: ++nextId, windowId: 1, ...values }; entries.set(tab.id, tab); created.push({ ...tab }); return tab; },
    update: async (id, values) => { updated.push({ id, ...values }); return Object.assign(entries.get(id), values); }
  }, windows: { update: async (id, values) => focused.push({ id, ...values }) }, scripting: {
    executeScript: async ({ target, func, args }) => {
      inspected.push(target.tabId); assert.deepEqual(target.frameIds, [0]); assert.equal(func.name, 'providerTabState');
      assert.equal(args[1], new URL(entries.get(target.tabId).url).origin);
      const state = states.get(target.tabId);
      if (state instanceof Error) throw state;
      return [{ frameId: 0, result: state === null ? undefined : { ready: true, busy: false, url: entries.get(target.tabId).url, ...state } }];
    }
  } };
  return { browser, entries, states, inspected, created, updated, focused };
}

test('both providers search active then recent tabs with exact origin and pending destination checks', async () => {
  for (const [provider, origin, path] of [['chatgpt','https://chatgpt.com','/c/'],['deepseek','https://chat.deepseek.com','/a/chat/s/']]) {
    const f = fixture([
      { id: 1, url: origin + path + 'recent', lastAccessed: 100 },
      { id: 2, url: origin + '/', active: true, lastAccessed: 1 },
      { id: 3, url: 'about:blank', pendingUrl: origin + path + 'loading', lastAccessed: 50 },
      { id: 4, url: origin + '/sign_in', active: true },
      { id: 5, url: origin + '.evil.test/', active: true },
      { id: 6, url: origin + '/', pendingUrl: 'https://other.example/' },
      { id: 7, url: origin.replace('https://','https://user:secret@') + '/' }
    ]);
    assert.deepEqual((await providerTabs(provider, f.browser)).map(tab => tab.id), [2,1,3]);
  }
});

test('selection skips running, loading, inaccessible and reserved tabs before choosing an idle chat', async () => {
  for (const [provider, origin] of [['chatgpt','https://chatgpt.com'],['deepseek','https://chat.deepseek.com']]) {
    const f = fixture(Array.from({length:6}, (_, index) => ({ id:index+1,url:origin+'/',lastAccessed:100-index,active:index===0 })));
    f.states.set(1,{busy:true,ready:true}); f.entries.get(2).status='loading'; f.states.set(3,new Error('Unavailable'));
    const selected = await firstIdleProviderTab(provider,{browser:f.browser,excludeTabIds:[4]});
    assert.equal(selected.id,5); assert.deepEqual(f.inspected,[1,3,5]);
    assert.equal(f.created.length,0); assert.equal(f.updated.length,0,'selection never focuses or navigates candidates');
  }
});

test('unknown probe state and navigation during inspection never qualify as idle', async () => {
  const f = fixture([{id:1,url:'https://chatgpt.com/'}]), tab = f.entries.get(1);
  f.states.set(1,null); assert.equal((await inspectProviderTab(tab,'chatgpt',f.browser)).ready,false);
  f.browser.scripting.executeScript=async()=>{f.entries.get(1).url='https://chatgpt.com/c/changed';return [{result:{ready:true,busy:false,url:'https://chatgpt.com/'}}];};
  assert.equal((await inspectProviderTab(tab,'chatgpt',f.browser)).ready,false);
  f.entries.get(1).pendingUrl='https://chatgpt.com/c/pending';
  assert.equal((await inspectProviderTab(tab,'chatgpt',f.browser)).ready,false);
});

test('open selects an idle DeepSeek tab and creates home only when no usable tab exists', async () => {
  const f = fixture([{id:1,url:'https://chat.deepseek.com/a/chat/s/busy',active:true},{id:2,url:'https://chat.deepseek.com/a/chat/s/idle'}]);
  f.states.set(1,{busy:true,ready:false});
  assert.equal((await openProviderTab('deepseek',{browser:f.browser})).id,2);
  assert.equal(f.created.length,0); assert.ok(f.updated.every(value=>!value.url));
  f.states.set(1,{busy:true,ready:true}); f.states.set(2,{busy:true,ready:true});
  const [a,b]=await Promise.all([openProviderTab('deepseek',{browser:f.browser}),openProviderTab('deepseek',{browser:f.browser})]);
  assert.equal(a.id,b.id); assert.deepEqual(f.created.map(tab=>tab.url),['https://chat.deepseek.com/']);
});

test('opening a saved chat reuses the exact loaded or pending URL even while busy and never probes it for sending', async () => {
  for (const pending of [false,true]) {
    const url='https://chat.deepseek.com/a/chat/s/saved';
    const f=fixture([{id:1,url:'https://chat.deepseek.com/',active:true},{id:2,url:pending?'about:blank':url,...(pending?{pendingUrl:url,status:'loading'}:{})}]);
    f.states.set(2,{busy:true,ready:false});
    assert.equal((await openProviderTab('deepseek',{browser:f.browser,url:url+'?private=yes#draft'})).id,2);
    assert.equal(f.created.length,0); assert.equal(f.inspected.length,0); assert.ok(f.updated.every(value=>!value.url));
  }
});

test('missing saved chats create one exact destination and invalid links never open a tab', async () => {
  const f=fixture(), url='https://chatgpt.com/c/saved';
  await Promise.all([openProviderTab('chatgpt',{browser:f.browser,url}),openProviderTab('chatgpt',{browser:f.browser,url})]);
  assert.deepEqual(f.created.map(tab=>tab.url),[url]);
  for (const invalid of ['https://chatgpt.com.evil.test/c/saved','https://user:secret@chatgpt.com/c/saved','https://chat.deepseek.com/a/chat/s/saved','https://chatgpt.com/auth/login']) {
    await assert.rejects(openProviderTab('chatgpt',{browser:f.browser,url:invalid}),/invalid/);
  }
  assert.equal(f.created.length,1);
});

test('background AI opens and exact saved-tab reuse never change tab or window focus', async () => {
  for (const [provider,url] of [['chatgpt','https://chatgpt.com/c/saved'],['deepseek','https://chat.deepseek.com/a/chat/s/saved']]) {
    const f=fixture();
    const created=await openProviderTab(provider,{browser:f.browser,url,focus:false});
    assert.equal(created.active,false); assert.equal(f.created.length,1);
    assert.equal((await openProviderTab(provider,{browser:f.browser,url,focus:false})).id,created.id);
    assert.equal(f.created.length,1); assert.equal(f.updated.length,0); assert.equal(f.focused.length,0);
  }
});

test('a foreground caller can focus the same tab created by a concurrent background open', async () => {
  const f=fixture(),url='https://chatgpt.com/c/saved';
  const [background,foreground]=await Promise.all([
    openProviderTab('chatgpt',{browser:f.browser,url,focus:false}),
    openProviderTab('chatgpt',{browser:f.browser,url})
  ]);
  assert.equal(background.id,foreground.id); assert.equal(f.created.length,1); assert.equal(f.created[0].active,false);
  assert.deepEqual(f.updated,[{id:foreground.id,active:true}]); assert.deepEqual(f.focused,[{id:1,focused:true}]);
});

function probeFixture(provider='chatgpt') {
  const origin=provider==='chatgpt'?'https://chatgpt.com':'https://chat.deepseek.com';
  const nodes=new Map(), location={origin,pathname:'/'};
  const editor={isConnected:true,disabled:false,readOnly:false,value:'',textContent:'',getClientRects:()=>[{}],
    matches:()=>true,closest:()=>null,getAttribute:()=>null};
  nodes.set(provider==='chatgpt'?'#prompt-textarea':'#chat-input',[editor]);
  const window={};window.top=window;
  const context={window,location,document:{readyState:'complete',querySelectorAll:selector=>nodes.get(selector)||[],querySelector:selector=>nodes.get(selector)?.[0]||null},
    getComputedStyle:()=>({visibility:'visible',display:'block'})};
  const inspect=()=>JSON.parse(JSON.stringify(vm.runInNewContext(`(${providerTabState.toString()})(${JSON.stringify(provider)},${JSON.stringify(origin)})`,context)));
  return {editor,nodes,context,inspect};
}

test('read-only DOM probes recognize native Stop/streaming signals and signed-out pages for both providers', () => {
  for (const provider of ['chatgpt','deepseek']) {
    const f=probeFixture(provider);assert.equal(f.inspect().ready,true);
    const stop={isConnected:true,getClientRects:()=>[{}]};
    const signals=['[data-is-streaming="true"]',...(provider === 'chatgpt' ? ['.result-streaming'] : []),'[data-testid="stop-button"]','button[aria-label*="Stop" i]','[role="button"][title*="Stop" i]','[role="button"][aria-label*="停止"]'];
    for (const selector of signals) {f.nodes.set(selector,[stop]);assert.equal(f.inspect().busy,true,selector);f.nodes.delete(selector);}
    if (provider === 'deepseek') { f.nodes.set('.result-streaming',[stop]); assert.equal(f.inspect().busy,false,'generic styling alone does not indicate DeepSeek generation'); }
    f.nodes.set('[data-testid="stop-button"]',[{...stop,getClientRects:()=>[]}]);assert.equal(f.inspect().ready,true,'hidden historical controls are ignored');
    f.nodes.set('input[type="password"]',[stop]);assert.equal(f.inspect().ready,false);
  }
});

test('DeepSeek ignores unrelated loading spinners but excludes a loading composer or response', () => {
  const f=probeFixture('deepseek');
  const spinner={isConnected:true,getClientRects:()=>[{}],closest:()=>null};
  f.nodes.set('.ds-loading',[spinner]);
  assert.equal(f.inspect().busy,false,'an unscoped page loader is not proof of generation');
  const composer={contains:node=>node===spinner};f.editor.parentElement=composer;
  assert.equal(f.inspect().busy,true,'composer loading prevents reusing the tab');
  spinner.closest=()=>({});
  assert.equal(f.inspect().busy,false,'a sidebar spinner is ignored even inside a broad layout container');
  spinner.closest=()=>null;delete f.editor.parentElement;
  const row={contains:node=>node===spinner};
  const answer={isConnected:true,getClientRects:()=>[{}],closest:selector=>selector.startsWith('[data-message-author-role="assistant"]')?row:null};
  f.nodes.set('[data-message-author-role="assistant"], [data-role="assistant"], .ds-markdown, [data-testid="thinking"], [data-role="reasoning"], .ds-think-content, .ds-think-content-wrapper',[answer]);
  assert.equal(f.inspect().busy,true,'current response loading prevents reusing the tab');
});

test('DeepSeek draft protection and disabled/missing editors make a page ineligible without exposing text', () => {
  const f=probeFixture('deepseek');f.editor.value='PRIVATE DRAFT';
  assert.deepEqual(f.inspect(),{ready:false,busy:false,url:'https://chat.deepseek.com/'});
  f.editor.value='';f.editor.readOnly=true;assert.equal(f.inspect().ready,false);
  f.editor.readOnly=false;f.nodes.clear();assert.equal(f.inspect().ready,false);
  const gpt=probeFixture();gpt.editor.value='REPLACEABLE DRAFT';assert.equal(gpt.inspect().ready,true);
  assert.equal(JSON.stringify(gpt.inspect()).includes('DRAFT'),false);
});
