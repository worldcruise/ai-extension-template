import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentRuntime} from '../src/agent-runtime.mjs';
const A={authenticated:true,user:{id:'A',name:'Same name'}},B={authenticated:true,user:{id:'B',name:'Same name'}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
function setup(){
  let session=A,invalidations=0;const hooks={},requests=[];
  const client={token:'session-A',async status(){return {signedIn:!!session,signInAvailable:true,session};},async request(path,{body}={}){
    requests.push({path,body});if(path==='/v1/models')return hooks.models?hooks.models():{accountId:session.user.id,models:[{slug:'same-model',thinkingEfforts:session===A?['high']:['medium']}]};
    return hooks.run?hooks.run():{data:{valid:true}};
  },async disconnect(){if(hooks.disconnect)return hooks.disconnect();session=null;return {};}};
  const runtime=new AgentRuntime(client,()=>++invalidations);
  return {runtime,client,hooks,requests,setSession(value){session=value;},get invalidations(){return invalidations;}};
}
test('worker refuses inference when the verified account changes, including identical names/model IDs',async()=>{
  const f=setup();await f.runtime.models('A');f.setSession(B);
  await assert.rejects(f.runtime.request('/v1/run',{accountId:'A',model:'same-model',thinkingEffort:'high'}),error=>['cancelled','account_changed'].includes(error.code));
  assert.deepEqual(f.runtime.catalog,[]);assert.equal(f.requests.some(row=>row.path==='/v1/run'),false);
  await f.runtime.models('B');assert.deepEqual(f.runtime.catalog[0].thinkingEfforts,['medium']);
  await assert.rejects(f.runtime.request('/v1/run',{accountId:'B',model:'same-model',thinkingEffort:'high'}),{code:'unsupported_thinking_effort'});
  await f.runtime.request('/v1/run',{accountId:'B',model:'same-model',thinkingEffort:'medium'});
  assert.equal(f.requests.filter(row=>row.path==='/v1/run').length,1);
});
for(const late of ['result','401'])test(`late worker ${late} cannot affect the new account`,async()=>{
  const f=setup();await f.runtime.models('A');const pending=deferred();f.hooks.run=()=>pending.promise;
  const request=f.runtime.request('/v1/run',{accountId:'A',model:'same-model',thinkingEffort:'high'},{requestId:'old'});
  while(!f.requests.some(row=>row.path==='/v1/run'))await new Promise(resolve=>setImmediate(resolve));
  f.setSession(B);await f.runtime.models('B').catch(async error=>{assert.equal(error.code,'request_in_progress');await f.runtime.verify();await f.runtime.models('B');});
  if(late==='401')pending.reject(Object.assign(new Error(),{status:401}));else pending.resolve({data:'A'});
  await assert.rejects(request);assert.equal(f.runtime.session.user.id,'B');assert.deepEqual(f.runtime.catalog[0].thinkingEfforts,['medium']);
});
test('cancel releases the worker slot immediately and ignores the old completion',async()=>{
  const f=setup();await f.runtime.models('A');const pending=deferred();f.hooks.run=()=>pending.promise;
  const first=f.runtime.request('/v1/run',{accountId:'A',model:'same-model'},{requestId:'first'});
  while(!f.requests.some(row=>row.path==='/v1/run'))await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.runtime.request('/v1/run',{accountId:'A',model:'same-model'}),{code:'request_in_progress'});
  f.runtime.cancel('first');delete f.hooks.run;
  await f.runtime.request('/v1/run',{accountId:'A',model:'same-model'},{requestId:'second'});
  pending.resolve({data:'OLD'});await assert.rejects(first,{code:'cancelled'});
});
test('a superseded model load cannot replace B capabilities with A data or expiry',async()=>{
  for(const expires of [false,true]){
    const f=setup(),pending=deferred();f.hooks.models=()=>pending.promise;
    const old=f.runtime.models('A');while(!f.requests.length)await new Promise(resolve=>setImmediate(resolve));
    f.setSession(B);delete f.hooks.models;await f.runtime.models('B');
    if(expires)pending.reject(Object.assign(new Error(),{code:'SESSION_EXPIRED'}));else pending.resolve({accountId:'A',models:[{slug:'same-model',thinkingEfforts:['high']}]});
    await assert.rejects(old);assert.equal(f.runtime.session.user.id,'B');assert.deepEqual(f.runtime.catalog[0].thinkingEfforts,['medium']);
  }
});
test('periodic status checks coalesce with inference verification without canceling it',async()=>{
  const f=setup();await f.runtime.models('A');const pending=deferred();f.client.status=()=>pending.promise;
  const a=f.runtime.verify(),b=f.runtime.verify();pending.resolve({signedIn:true,session:A});await Promise.all([a,b]);
  const c=f.runtime.request('/v1/run',{accountId:'A',model:'same-model'}),d=f.runtime.verify();await Promise.all([c,d]);
});
test('successful disconnect does not reuse a status check made with the old credential generation',async()=>{
  const f=setup();await f.runtime.models('A');
  f.client.generation=1;const pending=deferred();let calls=0;
  f.client.status=async()=>{calls++;if(calls===1)return pending.promise;return {signedIn:false,session:null};};
  f.client.disconnect=async()=>{const old=f.runtime.verify();old.catch(()=>{});f.client.generation++;return {};};
  await f.runtime.disconnect();assert.equal(f.runtime.session,null);assert.equal(calls,2);
  pending.reject(Object.assign(new Error(),{code:'cancelled'}));await Promise.resolve();assert.equal(f.runtime.session,null);
});
test('multiple docked views share one in-flight model load for the verified account',async()=>{
  const f=setup(),pending=deferred();f.hooks.models=()=>pending.promise;
  const first=f.runtime.models('A'),second=f.runtime.models('A');
  while(!f.requests.length)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.requests.length,1);pending.resolve({accountId:'A',models:[{slug:'same-model',thinkingEfforts:['high']}]});
  const results=await Promise.all([first,second]);assert.deepEqual(results[0],results[1]);assert.equal(f.runtime.session.user.id,'A');
});
test('status checks from another dock wait for sign-in instead of canceling the new account',async()=>{
  const f=setup(),pending=deferred();let checks=0;
  f.client.connect=()=>pending.promise;f.client.status=async()=>{checks++;return {signedIn:false,session:null};};
  const connecting=f.runtime.connect(),checking=f.runtime.verify();
  pending.resolve({signedIn:true,session:B});await Promise.all([connecting,checking]);
  assert.equal(checks,0);assert.equal(f.runtime.session.user.id,'B');
});
test('expiry discovered by one dock stays explicit when it supersedes another dock’s session check',async()=>{
  const f=setup();await f.runtime.models('A');const pending=deferred();f.client.status=()=>pending.promise;
  const checking=f.runtime.verify();f.runtime.expired(Object.assign(new Error(),{code:'SESSION_EXPIRED',status:401}),f.runtime.generation);
  pending.reject(Object.assign(new Error(),{code:'cancelled'}));await assert.rejects(checking,{code:'SESSION_EXPIRED',status:401});assert.equal(f.runtime.session,null);
});
test('sign-out remains successful if another dock observes the cleared direct session during revocation',async()=>{
  const f=setup();await f.runtime.models('A');
  f.client.disconnect=async()=>{f.client.token=null;f.setSession(null);await f.runtime.verify();return {revocationConfirmed:true};};
  assert.deepEqual(await f.runtime.disconnect(),{revocationConfirmed:true});assert.equal(f.runtime.session,null);
});
