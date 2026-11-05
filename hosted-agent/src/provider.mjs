import {RESOURCE} from './siwc.mjs';
import {consumeResponse,outputDiagnostics} from './stream.mjs';
import {ProtocolError as ContractError} from '../../src/protocol.mjs';

export class ChatGPTPlanProvider {
  constructor(auth){this.auth=auth;}
  async models(token){
    const account=await this.auth.account(token);
    const data=await this.auth.json(RESOURCE+'/models',{headers:{Authorization:'Bearer '+account.access_token}});
    const models=(Array.isArray(data.models)?data.models:[]).filter(row=>row&&row.visibility==='list'&&typeof row.slug==='string'&&row.slug.length>0&&row.slug.length<=128)
      .map(row=>{
        // Optional catalog metadata only. No model-name heuristics or invented defaults.
        const levels=Array.isArray(row.supported_reasoning_levels)?row.supported_reasoning_levels:[];
        const thinkingEfforts=[...new Set(levels.map(level=>level?.effort).filter(effort=>typeof effort==='string'&&/^[a-z]{1,20}$/.test(effort)))];
        return {slug:row.slug,display_name:typeof row.display_name==='string'?row.display_name.slice(0,120):row.slug,thinkingEfforts,
          ...(thinkingEfforts.includes(row.default_reasoning_level)?{defaultThinkingEffort:row.default_reasoning_level}:{})};
      });
    if(!models.length)throw new ContractError('no_available_models');return models;
  }
  async infer(token,{model,instructions,input,thinkingEffort},report,signal){
    signal=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
    const account=await this.auth.account(token);
    report.response_diagnostics={};report.output_diagnostics=outputDiagnostics();
    report.counts.inference_requests=1;
    let response;
    try{response=await this.auth.fetch(RESOURCE+'/responses',{method:'POST',headers:{Authorization:'Bearer '+account.access_token,'Content-Type':'application/json',Accept:'text/event-stream'},
      body:JSON.stringify({model,instructions,input:[{role:'user',content:input}],...(thinkingEffort?{reasoning:{effort:thinkingEffort}}:{}),store:false,stream:true}),redirect:'error',signal});}
    catch{throw new ContractError(signal?.aborted?'cancelled':'provider_connection_error');}
    if(response.status===401){report.response_diagnostics.http_status=401;await response.body?.cancel();throw new ContractError('provider_authorization_expired');}
    return consumeResponse(response,report);
  }
}
