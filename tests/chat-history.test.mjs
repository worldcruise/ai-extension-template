import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/chat-history.js';

const { target, ordered, snapshot, createReader } = globalThis.AiAgentChatHistory;
const url = id => `https://chatgpt.com/c/${id}`;

test('chat history follows top-to-bottom order without wrapping past new, newest, or oldest chats', () => {
  const urls = [url('newest'),url('middle'),url('oldest')];
  assert.equal(target(urls,'https://chatgpt.com/',-1),null);
  assert.equal(target(urls,'https://chatgpt.com/',1),urls[0]);
  assert.equal(target(urls,urls[0],-1),null);
  assert.equal(target(urls,urls[0],1),urls[1]);
  assert.equal(target(urls,urls[1],-1),urls[0]);
  assert.equal(target(urls,urls[2],1),null);
  assert.equal(target(urls,url('not-loaded'),1),null);
  assert.equal(target([], 'https://chatgpt.com/',1),null);
  assert.equal(target(urls,urls[0],0),null);
});

test('history identities are bounded, deduplicated, and restricted to ChatGPT conversation routes', () => {
  assert.deepEqual(ordered([url('a')+'?private=query',url('a')+'#hash','https://evil.test/c/chat','https://chatgpt.com/auth/login','https://chatgpt.com/','https://chatgpt.com/g/team/c/b']), [url('a'),'https://chatgpt.com/g/team/c/b']);
  const value = {loaded:true,ready:true,hasDraft:false,busy:false,currentUrl:'https://chatgpt.com/',urls:[url('a')]};
  assert.ok(snapshot(value));
  for (const extra of [{urls:['https://evil.test/c/chat']},{urls:Array(301).fill(url('a'))},{currentUrl:'https://chatgpt.com/auth/login'},{hasDraft:'false'},{dispatched:true,target:url('missing')}]) assert.equal(snapshot({...value,...extra}),null);
});

test('history snapshots forward only bounded titles and known conversation references', () => {
  const value = {loaded:true,ready:true,hasDraft:false,busy:false,currentUrl:url('a'),urls:[url('a'),url('b')],
    chats:[{url:url('a')+'?private=query',title:'Resume <img src=x onerror=alert(1)>',messages:['private'],html:'private'},
      {url:url('a'),title:'Duplicate'}, {url:url('b'),title:'Interview prep'}]};
  assert.deepEqual(snapshot(value).chats, [
    {url:url('a'),title:'Resume <img src=x onerror=alert(1)>'}, {url:url('b'),title:'Interview prep'}
  ]);
  for (const chats of [[{url:url('missing'),title:'Missing'}],[{url:url('a'),title:'x'.repeat(201)}],
    [{url:'https://evil.test/c/a',title:'External'}], [{url:url('a'),title:123}],Array(301).fill({url:url('a'),title:'Large'})]) {
    assert.equal(snapshot({...value,chats}),null);
  }
});

function readerFixture(t) {
  const before = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({visibility:'visible'});
  t.after(() => { globalThis.getComputedStyle = before; });
  const clicked = [];
  const links = ['a','b','c'].map(id => ({href:url(id),textContent:` Chat ${id} `,target:'',isConnected:true,click:()=>clicked.push(id)}));
  const editor = {value:'',isConnected:true,disabled:false,matches:()=>true,getClientRects:()=>[{}]};
  const state = {composerReady:true,hasDraft:false,busy:false,authState:'unknown'};
  const page = {href:url('a')};
  const doc = {querySelectorAll:selector => selector.startsWith('nav a') ? links : [],
    querySelector:selector => selector.startsWith('#prompt-textarea') ? editor : null};
  return {clicked,links,editor,state,page,reader:createReader({getConnection:()=>state,document:doc,location:page})};
}

test('native history navigation rechecks drafts and generation immediately before clicking', async t => {
  const fixture = readerFixture(t), replies = [];
  const data = {currentUrl:url('a'),target:url('b'),direction:1};
  fixture.editor.value = 'Keep this unsent draft';
  await fixture.reader.open(data, value=>replies.push(value));
  assert.equal(replies.at(-1).reason,'draft'); assert.deepEqual(fixture.clicked,[]);
  fixture.editor.value = ''; fixture.state.busy = true;
  await fixture.reader.open(data, value=>replies.push(value));
  assert.equal(replies.at(-1).reason,'generation'); assert.deepEqual(fixture.clicked,[]);
  fixture.state.busy = false;
  await fixture.reader.open(data, value=>replies.push(value));
  assert.equal(replies.at(-1).dispatched,true); assert.deepEqual(fixture.clicked,['b']);
});

test('changed conversation or reordered history cannot click an outdated target', async t => {
  const fixture = readerFixture(t), replies = [];
  const data = {currentUrl:url('a'),target:url('b'),direction:1};
  fixture.page.href = url('c');
  await fixture.reader.open(data,value=>replies.push(value));
  assert.equal(replies.at(-1).reason,'conversation-changed');
  fixture.page.href = url('a'); fixture.links.reverse();
  await fixture.reader.open(data,value=>replies.push(value));
  assert.equal(replies.at(-1).reason,'history-changed'); assert.deepEqual(fixture.clicked,[]);
});

test('search selection opens any current native history entry without candidate or adjacency filtering', async t => {
  const fixture = readerFixture(t), replies = [];
  await fixture.reader.open({currentUrl:url('a'),target:url('c'),selection:true},value=>replies.push(value));
  assert.equal(replies.at(-1).dispatched,true); assert.deepEqual(fixture.clicked,['c']);
  fixture.links.pop();
  await fixture.reader.open({currentUrl:url('a'),target:url('c'),selection:true},value=>replies.push(value));
  assert.equal(replies.at(-1).reason,'history-changed'); assert.deepEqual(fixture.clicked,['c']);
});

test('saved titles are read without modifying drafts; opening still refuses drafts, generation and stale routes', async t => {
  const fixture = readerFixture(t), replies = [];
  fixture.links[0].textContent='  Planning\n notes  ';
  fixture.editor.value='Private unsent draft'; fixture.state.busy=true;
  const state=await fixture.reader.inspect({readOnly:true});
  assert.deepEqual(state.chats.map(chat=>chat.title),['Planning notes','Chat b','Chat c']);
  assert.equal(fixture.editor.value,'Private unsent draft');
  await fixture.reader.open({currentUrl:url('a'),target:url('c'),selection:true},value=>replies.push(value));
  assert.equal(replies.at(-1).reason,'draft');
  fixture.editor.value='';
  await fixture.reader.open({currentUrl:url('a'),target:url('c'),selection:true},value=>replies.push(value));
  assert.equal(replies.at(-1).reason,'generation');
  fixture.state.busy=false; fixture.page.href=url('b');
  await fixture.reader.open({currentUrl:url('a'),target:url('c'),selection:true},value=>replies.push(value));
  assert.equal(replies.at(-1).reason,'conversation-changed'); assert.deepEqual(fixture.clicked,[]);
});
