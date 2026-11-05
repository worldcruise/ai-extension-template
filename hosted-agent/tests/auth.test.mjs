import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {ProtectedStore} from '../src/secrets.mjs';
import {HostedSignIn,ISSUER,challenge} from '../src/siwc.mjs';
const extensionId='a'.repeat(32),clientId='approved-test-client';
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
function jwt(claims){const head=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url'),body=Buffer.from(JSON.stringify(claims)).toString('base64url');return head+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(head+'.'+body),pair.privateKey).toString('base64url');}
async function setup(t,overrides={}){
  const directory=await mkdtemp(path.join(tmpdir(),'hosted-agent-auth-'));t.after(()=>{assert.ok(path.relative(tmpdir(),directory).startsWith('hosted-agent-auth-'));return rm(directory,{recursive:true,force:true});});
  const store=new ProtectedStore({directory,key:randomBytes(32).toString('base64')});let now=Date.now(),claims,exchangeCount=0,refreshCount=0;
  const config={publicUrl:'https://agent.test',redirectUri:'https://agent.test/auth/callback',clientId,tokenAuthMethod:'none',hostId:'urn:uuid:12345678-1234-1234-1234-123456789abc',planUsageApproved:true,extensionIds:[extensionId],...overrides};
  const requests=[];
  const auth=new HostedSignIn({configuration:config,store,clock:()=>now,fetchImpl:async(url,options={})=>{
    requests.push({url,options});
    if(url.endsWith('/jwks.json'))return Response.json({keys:[jwk]});
    if(url.endsWith('openid-configuration'))return Response.json({revocation_endpoint:ISSUER+'/revoke'});
    if(url.endsWith('/revoke'))return new Response('');
    exchangeCount++;const body=new URLSearchParams(options.body),refresh=body.get('grant_type')==='refresh_token';if(refresh)refreshCount++;
    return Response.json({access_token:refresh?'PRIVATE_ROTATED_ACCESS':'PRIVATE_ACCESS',refresh_token:refresh?'PRIVATE_ROTATED_REFRESH':'PRIVATE_REFRESH',token_type:'Bearer',scope:'openid chatgpt.tokens.use.direct',expires_in:3600,...(!refresh?{id_token:jwt(claims)}:{})});
  }});
  async function begin(){const verifier='v'.repeat(43),state='s'.repeat(43);const url=new URL(auth.start({redirectUri:`https://${extensionId}.chromiumapp.org/agent`,state,codeChallenge:challenge(verifier)}));claims={iss:ISSUER,aud:clientId,sub:'synthetic-user',exp:Math.floor(now/1000)+3600,iat:Math.floor(now/1000),nonce:url.searchParams.get('nonce')};return {url,verifier,state};}
  async function callback(start){return new URL(await auth.callback(new URLSearchParams({code:'PROVIDER_CODE',state:start.url.searchParams.get('state')})));}
  async function login(){const start=await begin(),redirect=await callback(start);return auth.complete({code:redirect.searchParams.get('code'),verifier:start.verifier});}
  return {auth,store,directory,requests,begin,callback,login,setClaims:values=>{claims={...claims,...values};},advance:ms=>{now+=ms;},get exchangeCount(){return exchangeCount;},get refreshCount(){return refreshCount;}};
}
test('default and OSS loopback client remain unavailable with zero provider requests',async t=>{
  for(const config of [{publicUrl:''},{clientId:'dynamic_agent_client'},{planUsageApproved:false},{redirectUri:'http://127.0.0.1:5555/auth/callback'}]){const s=await setup(t,config);assert.equal(s.auth.availability().available,false);assert.throws(()=>s.auth.start({}));assert.equal(s.requests.length,0);}
});
test('hosted PKCE + verified provider identity returns an agent-only single-use code',async t=>{
  const s=await setup(t),start=await s.begin();assert.equal(start.url.searchParams.get('redirect_uri'),'https://agent.test/auth/callback');assert.equal(start.url.searchParams.get('code_challenge_method'),'S256');
  const redirect=await s.callback(start);assert.equal(redirect.searchParams.get('state'),start.state);assert.ok(!redirect.href.includes('PRIVATE_'));assert.ok(!redirect.href.includes('PROVIDER_CODE'));
  const result=await s.auth.complete({code:redirect.searchParams.get('code'),verifier:start.verifier});assert.match(result.token,/^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(s.auth.complete({code:redirect.searchParams.get('code'),verifier:start.verifier}),{code:'invalid_agent_code'});
  assert.equal((await s.auth.account(result.token)).access_token,'PRIVATE_ACCESS');
  const files=await readdir(s.directory);for(const file of files){const text=await readFile(path.join(s.directory,file),'utf8');assert.ok(!text.includes('PRIVATE_'));assert.ok(!text.includes('synthetic-user'));assert.ok(!text.includes(result.token));}
});
test('wrong state, nonce, issuer, audience, signature binding, and Chrome callback are rejected',async t=>{
  const s=await setup(t);assert.throws(()=>s.auth.start({redirectUri:'https://attacker.test/agent',state:'s'.repeat(43),codeChallenge:'v'.repeat(43)}),{code:'invalid_extension_callback'});
  await assert.rejects(s.auth.callback(new URLSearchParams({state:'wrong',code:'x'})),{code:'authorization_expired'});
  for(const changes of [{nonce:'wrong'},{iss:'https://attacker.test'},{aud:'wrong'},{at_hash:'wrong'},{exp:0}]){const begin=await s.begin();s.setClaims(changes);await assert.rejects(s.callback(begin),{code:'id_token_verification_failed'});}
});
test('agent authorization code is bound to Chrome PKCE verifier',async t=>{const s=await setup(t),start=await s.begin(),redirect=await s.callback(start);await assert.rejects(s.auth.complete({code:redirect.searchParams.get('code'),verifier:'incorrect'}),{code:'invalid_agent_code'});});
test('concurrent model requests serialize refresh rotation and revoke on disconnect',async t=>{
  const s=await setup(t),session=await s.login();s.advance(3550000);const [first,second]=await Promise.all([s.auth.account(session.token),s.auth.account(session.token)]);assert.equal(s.refreshCount,1);assert.equal(first.refresh_token,'PRIVATE_ROTATED_REFRESH');assert.deepEqual(second,first);
  const disconnected=await s.auth.disconnect(session.token);assert.equal(disconnected.remoteRevocationConfirmed,true);await assert.rejects(s.auth.session(session.token),{code:'agent_authentication_required'});assert.equal((await readdir(s.directory)).length,0);
});
test('encrypted store detects tampering and binds ciphertext to its record name',async t=>{
  const s=await setup(t);await s.store.write('one',{private:'DO_NOT_EXPOSE'});const raw=await readFile(path.join(s.directory,'one.enc'),'utf8');await writeFile(path.join(s.directory,'two.enc'),raw);await assert.rejects(s.store.read('two'),{code:'credential_storage_unavailable'});const value=JSON.parse(raw);value.data=Buffer.from('tampered').toString('base64');await writeFile(path.join(s.directory,'one.enc'),JSON.stringify(value));await assert.rejects(s.store.read('one'),{code:'credential_storage_unavailable'});
});
test('identity-only scope and non-rotating invalid refresh response are not accepted',async t=>{
  const s=await setup(t);assert.throws(()=>s.auth.tokens({access_token:'x',refresh_token:'r',token_type:'Bearer',scope:'openid profile',expires_in:3600}),{code:'chatgpt_plan_scope_not_granted'});assert.throws(()=>s.auth.tokens({access_token:'x',token_type:'Bearer',scope:'chatgpt.tokens.use.direct',expires_in:3600}),{code:'invalid_token_response'});
});
test('public sessions use the verified stable key even when account display names match',async t=>{
  const s=await setup(t),first=await s.login(),a=await s.auth.publicSession(first.token);
  const start=await s.begin();s.setClaims({sub:'different-user',name:a.user.name});
  const redirect=await s.callback(start),second=await s.auth.complete({code:redirect.searchParams.get('code'),verifier:start.verifier}),b=await s.auth.publicSession(second.token);
  assert.equal(a.user.name,b.user.name);assert.notEqual(a.user.id,b.user.id);assert.match(a.user.id,/^account_[A-Za-z0-9_-]{43}$/);
  const again=await s.auth.publicSession(first.token);assert.equal(again.user.id,a.user.id);
  assert.ok(!JSON.stringify(a).includes('synthetic-user'));assert.ok(!JSON.stringify(a).includes('PRIVATE_'));assert.equal(Object.hasOwn(a,'token'),false);
});
