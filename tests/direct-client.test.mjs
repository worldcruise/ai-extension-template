import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectClient } from '../src/direct-client.mjs';
import { AgentRuntime } from '../src/agent-runtime.mjs';

const credentials=(id='A')=>({clientId:'issued-'+id,subjectHash:'verified-subject-'+id,displayName:'Same name',accessToken:'PRIVATE_ACCESS_'+id,refreshToken:'PRIVATE_REFRESH_'+id,identityVerified:true,scope:'openid chatgpt.tokens.use.direct',expiresAt:Date.now()+3600000});
function setup(){
  const calls=[],hooks={};const auth={credentials:credentials(),ready:Promise.resolve(),clock:Date.now,async session(){return this.credentials;},async disconnect(){this.credentials=null;return {revocationConfirmed:true};}};
  const client=new DirectClient({browser:{},auth,fetchImpl:async function(url,options){
    assert.equal(this,globalThis);calls.push({url,options});
    if(hooks.fetch)return hooks.fetch(url,options);
    if(url.endsWith('/models'))return Response.json({models:[{slug:'same',display_name:'Available model',visibility:'list',supported_reasoning_levels:(auth.credentials.clientId==='issued-A'?['high']:['medium']).map(effort=>({effort}))},{slug:'plain',visibility:'list'}]});
    return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'<b>Literal result</b>'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[]}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }});return {client,auth,hooks,calls};
}
test('direct transport needs no hosted origin and exposes verified identity without credentials',async()=>{
  const f=setup(),status=await f.client.status();assert.equal(status.signedIn,true);assert.equal(status.signInAvailable,true);assert.equal(f.calls.length,0);
  assert.equal(status.session.user.name,'Same name');assert.match(status.session.user.id,/^account_/);assert.ok(!JSON.stringify(status).includes('PRIVATE_'));
  const models=await f.client.request('/v1/models');assert.equal(models.accountId,status.session.user.id);assert.deepEqual(models.models[0].thinkingEfforts,['high']);assert.deepEqual(models.models[1].thinkingEfforts,[]);
});
test('direct inference reuses Responses with separate prompt/input and supported effort only',async()=>{
  const f=setup(),status=await f.client.status();
  assert.deepEqual(await f.client.request('/v1/run',{body:{accountId:status.session.user.id,model:'same',thinkingEffort:'high',prompt:'Prompt',input:'Input'}}),{text:'<b>Literal result</b>'});
  const request=JSON.parse(f.calls.find(call=>call.url.endsWith('/responses')).options.body);
  assert.deepEqual(request,{model:'same',instructions:'Prompt',input:[{role:'user',content:'Input'}],reasoning:{effort:'high'},store:false,stream:true});
  await f.client.request('/v1/run',{body:{accountId:status.session.user.id,model:'plain',prompt:'Prompt',input:'Input'}});
  assert.equal(Object.hasOwn(JSON.parse(f.calls.at(-1).options.body),'reasoning'),false);
});
test('direct identity and efforts are scoped by verified subject/client, not display names or model IDs',async()=>{
  const f=setup(),runtime=new AgentRuntime(f.client);const a=await f.client.status();await runtime.models(a.session.user.id);
  f.auth.credentials=credentials('B');const b=await f.client.status();assert.notEqual(b.session.user.id,a.session.user.id);
  await runtime.models(b.session.user.id);assert.deepEqual(runtime.catalog[0].thinkingEfforts,['medium']);
  await assert.rejects(runtime.request('/v1/run',{accountId:a.session.user.id,model:'same',thinkingEffort:'high',prompt:'Prompt',input:'Input'}),{code:'account_changed'});
  assert.equal(f.calls.some(call=>call.url.endsWith('/responses')),false);
});
for(const status of [401,403])test(`direct model HTTP ${status} ${status===401?'expires':'retains'} the verified account`,async()=>{
  const f=setup();await f.client.status();f.hooks.fetch=async()=>new Response('Provider body never rendered',{status});
  await assert.rejects(f.client.request('/v1/models'),error=>error.status===status);
  assert.equal(f.auth.credentials===null,status===401);
});
test('a late direct HTTP 401 cannot clear a newer verified account',async()=>{
  const f=setup();let resolve;f.hooks.fetch=()=>new Promise(done=>{resolve=done;});const old=f.client.request('/v1/models');
  while(!resolve)await new Promise(done=>setImmediate(done));f.auth.credentials=credentials('B');const b=await f.client.status();
  resolve(new Response('',{status:401}));await assert.rejects(old,{code:'cancelled'});assert.equal((await f.client.status()).session.user.id,b.session.user.id);
});
test('direct transport retains credentials on ordinary connection failures',async()=>{
  const f=setup();f.hooks.fetch=async()=>{throw new Error('Internal details');};await assert.rejects(f.client.request('/v1/models'),{code:'connection_error'});assert.ok(f.auth.credentials);
});
test('direct session checks cannot restore an account cleared while hashing its public identity',async()=>{
  const f=setup();const pending=f.client.verified();await Promise.resolve();await f.client.disconnect();await assert.rejects(pending,{code:'cancelled'});assert.equal(f.auth.credentials,null);assert.equal((await f.client.status()).session,null);
});
for(const status of [200,403])test(`direct model expiry envelope on HTTP ${status} clears credentials`,async()=>{
  const f=setup();await f.client.status();f.hooks.fetch=async()=>Response.json({error:{code:'SESSION_EXPIRED'}},{status});
  await assert.rejects(f.client.request('/v1/models'),{code:'SESSION_EXPIRED',status:401});assert.equal(f.auth.credentials,null);
});
test('direct streamed inference expiry clears credentials instead of leaving old results usable',async()=>{
  const f=setup(),session=(await f.client.status()).session;
  f.hooks.fetch=async url=>url.endsWith('/models')?Response.json({models:[{slug:'plain',visibility:'list'}]}):new Response('data: '+JSON.stringify({type:'error',code:'SESSION_EXPIRED'})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
  await assert.rejects(f.client.request('/v1/run',{body:{accountId:session.user.id,model:'plain',prompt:'Prompt',input:'Input'}}),{code:'authentication_error'});
  assert.equal(f.auth.credentials,null);
});
