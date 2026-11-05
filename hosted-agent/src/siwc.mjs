import {randomBytes,createHash,createPublicKey,verify,timingSafeEqual} from 'node:crypto';
import {ProtocolError as ContractError} from '../../src/protocol.mjs';
export const ISSUER='https://auth.openai.com', RESOURCE='https://api.openai.com/v1';
const TOKEN=ISSUER+'/api/accounts/oauth/token';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random=()=>randomBytes(32).toString('base64url');
export const challenge=value=>createHash('sha256').update(value).digest('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const failure=code=>{throw new ContractError(code);};

export class HostedSignIn {
  constructor({configuration,store,fetchImpl=fetch,clock=Date.now}){this.config=configuration;this.store=store;this.fetch=fetchImpl;this.clock=clock;this.pending=new Map();this.codes=new Map();this.refreshes=new Map();}
  availability(){
    const c=this.config;
    if(!c.publicUrl)return {available:false,code:'hosted_deployment_not_configured'};
    if(c.planUsageApproved!==true||!c.clientId||c.clientId==='dynamic_agent_client')return {available:false,code:'hosted_plan_registration_required'};
    try{const base=new URL(c.publicUrl),redirect=new URL(c.redirectUri);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash||redirect.username||redirect.password||redirect.origin!==base.origin||redirect.pathname!=='/auth/callback'||redirect.search||redirect.hash)throw Error();}catch{return {available:false,code:'approved_https_callback_required'};}
    if(!this.store.configured)return {available:false,code:'credential_storage_unavailable'};
    if(!/^urn:uuid:[0-9a-f-]{36}$/i.test(c.hostId||''))return {available:false,code:'stable_host_id_required'};
    if(!['none','client_secret_post'].includes(c.tokenAuthMethod||'none')||(c.tokenAuthMethod==='client_secret_post'&&!c.clientSecret))return {available:false,code:'unsupported_client_configuration'};
    if(!c.extensionIds?.length)return {available:false,code:'extension_registration_required'};
    return {available:true,code:'ready'};
  }
  assertReady(){const status=this.availability();if(!status.available)failure(status.code);}
  async json(url,options={}){
    let response;try{response=await this.fetch(url,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(60000)});}catch{failure('provider_connection_error');}
    let size=0;const chunks=[];
    try{if(response.body)for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)failure('provider_response_too_large');chunks.push(chunk);}}
    catch(error){failure(error.code==='provider_response_too_large'?error.code:'provider_connection_error');}
    const raw=Buffer.concat(chunks).toString('utf8');
    if(!response.ok)throw Object.assign(new ContractError(response.status===401?'provider_authorization_expired':'provider_request_failed'),{status:response.status});
    if(!raw.trim())return {};try{return JSON.parse(raw);}catch{failure('provider_invalid_response');}
  }
  start({redirectUri,state,codeChallenge}){
    this.assertReady();
    let extension;try{extension=new URL(redirectUri);}catch{failure('invalid_extension_callback');}
    const id=extension.hostname.split('.')[0];
    if(extension.protocol!=='https:'||extension.hostname!==id+'.chromiumapp.org'||extension.pathname!=='/agent'||extension.search||extension.hash||!this.config.extensionIds.includes(id))failure('invalid_extension_callback');
    if(!/^[A-Za-z0-9_-]{32,128}$/.test(state||'')||!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge||''))failure('invalid_authorization_request');
    for(const [key,value]of this.pending)if(value.expires<this.clock())this.pending.delete(key);
    if(this.pending.size>=100)failure('authorization_capacity_reached');
    const providerState=random(),nonce=random(),verifier=random();
    this.pending.set(providerState,{nonce,verifier,redirectUri,state,codeChallenge,expires:this.clock()+300000});
    const url=new URL(ISSUER+'/api/accounts/authorize');
    Object.entries({client_id:this.config.clientId,response_type:'code',redirect_uri:this.config.redirectUri,scope:SCOPES,resource:RESOURCE,state:providerState,nonce,code_challenge:challenge(verifier),code_challenge_method:'S256',ext_agent_host_id:this.config.hostId}).forEach(([key,value])=>url.searchParams.set(key,value));
    return url.href;
  }
  async identity(token,nonce,expectedSubject,accessToken){
    try{
      const parts=token.split('.');if(parts.length!==3)throw Error();
      const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
      if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error();
      const keys=await this.json(ISSUER+'/.well-known/jwks.json');
      const matching=keys.keys.filter(key=>key.kid===header.kid&&key.kty==='RSA'&&(key.use||'sig')==='sig'&&(key.alg||'RS256')==='RS256');
      if(matching.length!==1||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:matching[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error();
      if(claims.iss!==ISSUER||!(Array.isArray(claims.aud)?claims.aud.includes(this.config.clientId):claims.aud===this.config.clientId)||typeof claims.exp!=='number'||claims.exp*1000<=this.clock()||typeof claims.iat!=='number'||claims.iat*1000>this.clock()+5000||typeof claims.sub!=='string'||!claims.sub)throw Error();
      if((claims.azp&&claims.azp!==this.config.clientId)||(Array.isArray(claims.aud)&&claims.aud.length>1&&claims.azp!==this.config.clientId))throw Error();
      if(nonce&&!equal(claims.nonce,nonce))throw Error();if(expectedSubject&&claims.sub!==expectedSubject)throw Error();
      if(claims.at_hash&&(!accessToken||!equal(claims.at_hash,createHash('sha256').update(accessToken).digest().subarray(0,16).toString('base64url'))))throw Error();
      return claims;
    }catch{failure('id_token_verification_failed');}
  }
  tokens(value,previous={}){
    if(typeof value.access_token!=='string'||!value.access_token||String(value.token_type).toLowerCase()!=='bearer')failure('invalid_token_response');
    const scope=value.scope??previous.scope;
    if(typeof scope!=='string'||!scope.split(/\s+/).includes('chatgpt.tokens.use.direct'))failure('chatgpt_plan_scope_not_granted');
    if(typeof value.refresh_token!=='string'||!value.refresh_token||!Number.isFinite(value.expires_in)||value.expires_in<=0||value.expires_in>86400)failure('invalid_token_response');
    return {...previous,...value,scope,expiresAt:this.clock()+value.expires_in*1000};
  }
  async exchange(form){
    if(this.config.tokenAuthMethod==='client_secret_post')form.client_secret=this.config.clientSecret;
    return this.json(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form)});
  }
  async callback(params){
    for(const key of ['state','code','error','client_id'])if(params.getAll(key).length>1)failure('invalid_callback');
    const transaction=this.pending.get(params.get('state'));this.pending.delete(params.get('state'));
    if(!transaction||transaction.expires<this.clock())failure('authorization_expired');
    if(params.has('error'))failure('authorization_declined');
    if(!params.get('code')||(params.has('client_id')&&params.get('client_id')!==this.config.clientId))failure('invalid_callback');
    const raw=await this.exchange({grant_type:'authorization_code',client_id:this.config.clientId,code:params.get('code'),code_verifier:transaction.verifier,redirect_uri:this.config.redirectUri,resource:RESOURCE});
    const tokens=this.tokens(raw);const identity=await this.identity(tokens.id_token,transaction.nonce,null,tokens.access_token);
    const account='account_'+challenge(this.config.clientId+'\0'+identity.sub);
    const displayName=typeof identity.name==='string'&&identity.name.trim()?identity.name.trim().slice(0,120):'ChatGPT account';
    await this.store.write(account,{...tokens,subject:identity.sub,clientId:this.config.clientId,displayName});
    for(const [key,value]of this.codes)if(value.expires<this.clock())this.codes.delete(key);
    if(this.codes.size>=1000)failure('authorization_capacity_reached');
    const code=random();this.codes.set(challenge(code),{account,challenge:transaction.codeChallenge,expires:this.clock()+60000});
    const redirect=new URL(transaction.redirectUri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',transaction.state);return redirect.href;
  }
  async complete({code,verifier}){
    const key=challenge(String(code||'')),entry=this.codes.get(key);this.codes.delete(key);
    if(!entry||entry.expires<this.clock()||!equal(challenge(String(verifier||'')),entry.challenge))failure('invalid_agent_code');
    const token=random();await this.store.write('session_'+challenge(token),{account:entry.account,expires:this.clock()+2*60*60*1000});
    return {token,expiresIn:7200};
  }
  async session(token){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))failure('agent_authentication_required');
    const session=await this.store.read('session_'+challenge(token));if(!session||session.expires<this.clock())failure('agent_authentication_required');return session;
  }
  async account(token){
    const session=await this.session(token);const key=session.account;
    const earlier=this.refreshes.get(key)||Promise.resolve();
    const operation=earlier.catch(()=>{}).then(async()=>{
      let record=await this.store.read(key);if(!record||record.clientId!==this.config.clientId)failure('agent_authentication_required');
      if(record.expiresAt<=this.clock()+60000){
        const refreshed=this.tokens(await this.exchange({grant_type:'refresh_token',client_id:record.clientId,refresh_token:record.refresh_token,resource:RESOURCE}),record);
        if(refreshed.id_token&&refreshed.id_token!==record.id_token)await this.identity(refreshed.id_token,null,record.subject,refreshed.access_token);
        record=refreshed;await this.store.write(key,record);
      }
      return record;
    });
    this.refreshes.set(key,operation);try{return await operation;}finally{if(this.refreshes.get(key)===operation)this.refreshes.delete(key);}
  }
  async publicSession(token){
    const session=await this.session(token),record=await this.account(token);
    // This opaque key is already derived from the verified issuer/client/subject.
    // Never substitute a display name, access token, or raw identity claims.
    return {authenticated:true,user:{id:session.account,name:record.displayName||'ChatGPT account'},expiresAt:session.expires};
  }
  async disconnect(token){
    const session=await this.session(token),key=session.account,earlier=this.refreshes.get(key)||Promise.resolve();
    const operation=earlier.catch(()=>{}).then(async()=>{
      const account=await this.store.read(key);let revoked=false;
      if(account){try{const configuration=await this.json(ISSUER+'/.well-known/openid-configuration');const endpoint=new URL(configuration.revocation_endpoint);if(endpoint.origin!==ISSUER)throw Error();await this.json(endpoint.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:account.refresh_token,token_type_hint:'refresh_token',client_id:account.clientId})});revoked=true;}catch{} await this.store.remove(key);}
      await this.store.remove('session_'+challenge(token));return {remoteRevocationConfirmed:revoked};
    });
    this.refreshes.set(key,operation);try{return await operation;}finally{if(this.refreshes.get(key)===operation)this.refreshes.delete(key);}
  }
}
