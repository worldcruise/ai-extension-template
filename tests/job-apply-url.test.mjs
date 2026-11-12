import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApplicationUrls } from '../src/job-apply-url.mjs';

function fixture({urls=[],clickable=true,click}={}) {
  const listeners=()=>{const items=new Set();return {addListener:fn=>items.add(fn),removeListener:fn=>items.delete(fn),emit:(...args)=>{for(const fn of items)fn(...args);},items};};
  const created=listeners(),updated=listeners(),calls=[];
  const browser={tabs:{get:async()=>({url:'https://hiring.cafe/?jobId=1'}),onCreated:created,onUpdated:updated},
    scripting:{executeScript:async options=>{calls.push(options);if(options.args[0])await click?.({created,updated});return [{result:{urls,clickable}}];}}};
  return {browser,calls,created,updated};
}
test('HiringCafe stores the observed external Apply href without clicking or returning its aggregator URL',async()=>{
  const f=fixture({urls:['https://jobs.example.test/apply/1?utm_source=cafe']});
  assert.deepEqual(await resolveApplicationUrls(1,'https://hiring.cafe/?jobId=1',f.browser),['https://jobs.example.test/apply/1']);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[0],false);
});
test('JavaScript Apply destinations must belong to that source tab, with observers cleaned up',async()=>{
  const f=fixture({click:async({created,updated})=>{
    created.emit({id:9,openerTabId:88,url:'https://unrelated.example/'});
    created.emit({id:2,openerTabId:1,url:'about:blank'});
    updated.emit(2,{url:'https://jobs.example.test/apply/2'},{id:2,openerTabId:1});
  }});
  assert.deepEqual(await resolveApplicationUrls(1,'https://hiring.cafe/?jobId=1',f.browser),['https://jobs.example.test/apply/2']);
  assert.equal(f.created.items.size,0);assert.equal(f.updated.items.size,0);
});
test('ambiguous and missing Apply destinations fail instead of saving a HiringCafe URL',async()=>{
  const many=fixture({urls:['https://jobs.example/1','https://jobs.example/2']});
  await assert.rejects(resolveApplicationUrls(1,'https://hiring.cafe/?jobId=1',many.browser),/ambiguous/);
  const absent=fixture();await assert.rejects(resolveApplicationUrls(1,'https://hiring.cafe/?jobId=1',absent.browser,{timeoutMs:5}),/did not reveal/);
  assert.equal(absent.created.items.size,0);assert.equal(absent.updated.items.size,0);
});
