import {ProtocolError as ContractError} from './protocol.mjs';
import {strictJson} from './protocol.mjs';
import {isSessionExpired} from './controller.mjs';

export function agentUrl(value) {
  let url; try { url = new URL(value); } catch { throw new ContractError('invalid_agent_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ContractError('invalid_agent_url');
  return url.origin;
}
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const digest = async text => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export class AgentClient {
  constructor({browser,baseUrl='',fetchImpl=fetch}) { this.browser=browser;this.baseUrl=baseUrl?agentUrl(baseUrl):'';this.fetch=fetchImpl.bind(globalThis);this.token=null;this.generation=0; }
  configure(url) { this.baseUrl=agentUrl(url);this.token=null;++this.generation; }
  async request(path,{body,signal}={}) {
    if (!this.baseUrl) throw new ContractError('hosted_deployment_not_configured');
    const generation=this.generation,token=this.token;
    const current=()=>generation===this.generation&&token===this.token&&!signal?.aborted;
    const fail=(code,status)=>Object.assign(new ContractError(code),status?{status}:{});
    const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
    let response;
    try {response=await this.fetch(this.baseUrl+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(this.token?{Authorization:'Bearer '+this.token}:{})},body:body?JSON.stringify({schemaVersion:1,requestId:crypto.randomUUID(),...body}):undefined,signal:requestSignal,redirect:'error',credentials:'omit',cache:'no-store'});}
    catch {throw new ContractError(signal?.aborted?'cancelled':requestSignal.aborted?'request_timeout':'agent_connection_error');}
    if(!current()){await response.body?.cancel();throw fail('cancelled');}
    if(response.status===401){this.token=null;++this.generation;await response.body?.cancel();throw fail('SESSION_EXPIRED',401);}
    let bytes=0;const chunks=[];
    if(!response.body)throw new ContractError('invalid_agent_response');
    try{for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw new ContractError('invalid_agent_response');chunks.push(chunk);}}
    catch(error){throw new ContractError(signal?.aborted?'cancelled':requestSignal.aborted?'request_timeout':error.code==='invalid_agent_response'?error.code:'agent_connection_error');}
    const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
    if(!current())throw fail('cancelled');
    let data;try{data=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{throw new ContractError('invalid_agent_response');}
    if(data?.schemaVersion!==1)throw new ContractError('invalid_agent_response');
    const code=data.error?.code||data.report?.error?.code;
    if(isSessionExpired({code,status:data.report?.response_diagnostics?.http_status})){this.token=null;++this.generation;throw fail(code||'SESSION_EXPIRED',401);}
    if(!response.ok&&!data.report)throw fail(data.error?.code||'agent_request_failed',response.status);
    if(path==='/v1/status'&&data.signedIn===false&&token){this.token=null;++this.generation;}
    return data;
  }
  async status(options){if(!this.baseUrl)return {reachable:false,signedIn:false,signInAvailable:false,reason:'hosted_deployment_not_configured',session:null};return this.request('/v1/status',options);}
  async connect(){
    const generation=++this.generation;
    const status=await this.status();if(!status.signInAvailable)throw new ContractError(status.reason||'hosted_plan_registration_required');
    const verifier=random(),state=random(),redirect=this.browser.identity.getRedirectURL('agent');
    const url=new URL(this.baseUrl+'/auth/start');url.search=new URLSearchParams({redirect_uri:redirect,state,code_challenge:await digest(verifier)});
    let callback;try{callback=await this.browser.identity.launchWebAuthFlow({url:url.href,interactive:true});}catch{throw new ContractError('authorization_cancelled');}
    if(generation!==this.generation)throw new ContractError('cancelled');
    let returned;try{returned=new URL(callback);}catch{throw new ContractError('invalid_callback');}
    if(returned.origin+returned.pathname!==redirect||returned.hash||returned.searchParams.getAll('state').length!==1||returned.searchParams.get('state')!==state||returned.searchParams.getAll('code').length!==1||[...returned.searchParams.keys()].some(key=>!['code','state'].includes(key)))throw new ContractError('invalid_callback');
    const exchanged=await this.request('/auth/exchange',{body:{code:returned.searchParams.get('code'),verifier}});
    if(generation!==this.generation)throw new ContractError('cancelled');
    if(typeof exchanged.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(exchanged.token))throw new ContractError('invalid_agent_response');
    this.token=exchanged.token;++this.generation;
    const connected=await this.status();if(!connected.signedIn){this.token=null;throw new ContractError('agent_authentication_required');}
    return connected;
  }
  async disconnect(){const generation=this.generation;const result=await this.request('/v1/disconnect',{body:{}});if(generation===this.generation){this.token=null;++this.generation;}return result;}
}
