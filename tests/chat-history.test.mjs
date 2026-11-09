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

function readerFixture(t) {
  const before = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({visibility:'visible'});
  t.after(() => { globalThis.getComputedStyle = before; });
  const clicked = [];
  const links = ['a','b','c'].map(id => ({href:url(id),target:'',isConnected:true,click:()=>clicked.push(id)}));
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
