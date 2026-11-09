import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationUrl, embedRules, frameMessage, frameShortcutMessage, linkedConversationUrl, FRAME_CHANNEL } from '../src/sidebar-protocol.mjs';

test('conversation routes discard queries and reject unrelated or sensitive URLs', () => {
  assert.equal(conversationUrl('https://chatgpt.com/c/chat-123?token=secret#section'), 'https://chatgpt.com/c/chat-123');
  assert.equal(conversationUrl('https://chatgpt.com/g/g-example/c/chat-123'), 'https://chatgpt.com/g/g-example/c/chat-123');
  for (const url of ['javascript:alert(1)', 'https://chatgpt.com.evil.test/', 'https://user:pass@chatgpt.com/',
    'https://chatgpt.com/auth/login?code=secret', 'https://chatgpt.com/backend-api/conversation', '/c/chat-123']) {
    assert.equal(conversationUrl(url), null, url);
  }
});

test('company source links accept only real conversation routes', () => {
  assert.equal(linkedConversationUrl('https://chatgpt.com/c/company-one?discard=private'), 'https://chatgpt.com/c/company-one');
  assert.equal(linkedConversationUrl('https://chatgpt.com/g/project/c/company-two'), 'https://chatgpt.com/g/project/c/company-two');
  for (const url of [undefined, '', 'https://chatgpt.com/', 'https://chatgpt.com/g/project',
    'https://chatgpt.com/auth/login', 'https://evil.test/c/company-one']) assert.equal(linkedConversationUrl(url), null);
});

test('the embed rule is restricted to this extension and ChatGPT subframes', () => {
  const [rule] = embedRules('example-extension-id');
  assert.deepEqual(rule.condition.initiatorDomains, ['example-extension-id']);
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  const pattern = new RegExp(rule.condition.regexFilter);
  assert.ok(pattern.test('https://chatgpt.com/c/123'));
  for (const url of ['https://chatgpt.com.evil.test/', 'http://chatgpt.com/', 'https://other.test/?chatgpt.com']) {
    assert.equal(pattern.test(url), false);
  }
});

test('frame signals require the expected window, origin, channel and navigation nonce', () => {
  const source = {};
  const event = { source, origin: 'https://chatgpt.com', data: {
    channel: FRAME_CHANNEL, nonce: 'navigation-1', type: 'state', ready: true, guest: false,
    url: 'https://chatgpt.com/c/chat-123?private=query'
  } };
  assert.deepEqual(frameMessage(event, source, 'navigation-1'), {
    type: 'state', ready: true, guest: false, url: 'https://chatgpt.com/c/chat-123'
  });
  assert.equal(frameMessage(event, {}, 'navigation-1'), null);
  assert.equal(frameMessage({ ...event, origin: 'https://evil.test' }, source, 'navigation-1'), null);
  assert.equal(frameMessage(event, source, 'navigation-2'), null);
  assert.equal(frameMessage({ ...event, data: { ...event.data, channel: 'other' } }, source, 'navigation-1'), null);
  assert.equal(frameMessage({ ...event, data: { ...event.data, url: 'https://evil.test/' } }, source, 'navigation-1'), null);
  assert.equal(frameMessage({ ...event, data: { ...event.data, type: 'unknown' } }, source, 'navigation-1'), null);
});

test('frame shortcuts require an authenticated extension sender, current nonce, bounded identity and known action', () => {
  const message = {type:'workspace.shortcut',nonce:'navigation-1',pressId:'press-1',action:'queue.add'};
  const sender = {id:'this-extension',url:'https://chatgpt.com/c/example'};
  const read = (data=message, source=sender, nonce='navigation-1') => frameShortcutMessage(data,source,'this-extension',nonce);
  assert.deepEqual(read(), {action:'queue.add',pressId:'press-1'});
  assert.equal(read(message, {...sender,id:'another-extension'}), null);
  assert.equal(read(message, {...sender,url:'https://chatgpt.com.evil.test/'}), null);
  assert.equal(read(message, {...sender,url:'https://user:pass@chatgpt.com/'}), null);
  assert.equal(read(message, sender, 'old-navigation'), null);
  for (const extra of [{type:'state'},{action:'send'},{pressId:'x'.repeat(101)},{pressId:'invalid id'}]) assert.equal(read({...message,...extra}),null);
});

test('queue progress keeps a bounded operation identity and only supported phases and conversation URLs', () => {
  const source = {};
  const data = {channel:FRAME_CHANNEL,nonce:'navigation-1',type:'queue.progress',operationId:'operation-1',phase:'prepared',url:'https://chatgpt.com/'};
  const event = {source,origin:'https://chatgpt.com',data};
  assert.equal(frameMessage(event,source,'navigation-1').phase,'prepared');
  assert.equal(frameMessage(event,source,'wrong-navigation'),null);
  for (const extra of [{operationId:'bad request'}, {phase:'execute'}, {url:'https://evil.test/'}, {url:'https://chatgpt.com/auth/login'}]) {
    assert.equal(frameMessage({...event,data:{...data,...extra}},source,'navigation-1'),null);
  }
});

test('queue replies reject unbounded output and malformed success payloads', () => {
  const source = {};
  const data = {channel:FRAME_CHANNEL,nonce:'navigation-1',type:'queue.reply',operationId:'operation-1',ok:true,value:{raw:'{}'}};
  const event = {source,origin:'https://chatgpt.com',data};
  assert.equal(frameMessage(event,source,'navigation-1').value.raw,'{}');
  for (const extra of [{ok:'yes'}, {value:[]}, {value:null}, {value:{raw:'x'.repeat(500001)}}]) {
    assert.equal(frameMessage({...event,data:{...data,...extra}},source,'navigation-1'),null);
  }
});

test('history replies retain only bounded public conversation references and require the current frame nonce', () => {
  const source = {};
  const data = {channel:FRAME_CHANNEL,nonce:'navigation-1',type:'history.reply',operationId:'history-1',ok:true,
    value:{loaded:true,ready:true,hasDraft:false,busy:false,currentUrl:'https://chatgpt.com/',urls:['https://chatgpt.com/c/a'],
      chats:[{url:'https://chatgpt.com/c/a',title:'Planning',messages:'Not forwarded'}],title:'Not forwarded'}};
  const event = {source,origin:'https://chatgpt.com',data};
  const value = frameMessage(event,source,'navigation-1').value;
  assert.deepEqual(value.urls,['https://chatgpt.com/c/a']); assert.equal(value.title,undefined);
  assert.deepEqual(value.chats,[{url:'https://chatgpt.com/c/a',title:'Planning'}]);
  assert.equal(frameMessage(event,source,'old-navigation'),null);
  assert.equal(frameMessage({...event,data:{...data,value:{...data.value,urls:['https://evil.test/c/a']}}},source,'navigation-1'),null);
});
