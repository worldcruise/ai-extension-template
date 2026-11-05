import {isSessionExpired} from './controller.mjs';
import {ProtocolError as ContractError} from './protocol.mjs';

// Worker-owned account scope; the injected transport owns credentials and only
// verified public session/model/result data crosses the view boundary.
export class AgentRuntime {
  constructor(client, onInvalidate = () => {}) {
    this.client=client; this.onInvalidate=onInvalidate; this.session=null;
    this.catalog=[]; this.model=''; this.thinkingEffort=''; this.catalogAccountId=null;
    this.generation=0; this.modelEpoch=0; this.running=null;
    this.connection={signedIn:false,signInAvailable:false};
  }
  cancel(requestId) {
    if(this.running&&(!requestId||requestId===this.running.id)){
      this.running.controller.abort(); this.running=null;
    }
  }
  invalidate() { ++this.generation; ++this.modelEpoch; this.cancel(); this.onInvalidate(); }
  adopt(session) {
    if(session?.authenticated!==true)session=null;
    if(session&&(typeof session.user?.id!=='string'||!session.user.id.trim()||typeof session.user.name!=='string'))throw new ContractError('invalid_agent_identity');
    if(session)this.lastExpiry=null;
    if(this.session?.user.id!==session?.user.id){
      this.session=session; this.catalog=[]; this.catalogAccountId=null; this.model=''; this.thinkingEffort=''; this.invalidate();
    } else this.session=session;
  }
  expired(error,generation) {
    if(generation===this.generation&&isSessionExpired(error)){
      this.lastExpiry=error;
      this.client.token=null; this.adopt(null);
      this.connection={...this.connection,signedIn:false,session:null};
    }
  }
  async verify(signal) {
    if(this.connectTask?.generation===this.generation){
      const connection=await this.connectTask.promise;
      if(signal?.aborted)throw new ContractError('cancelled');
      return connection;
    }
    const generation=this.generation;
    if(!this.verification||this.verification.generation!==generation||this.verification.clientGeneration!==this.client.generation){
      const entry={generation,clientGeneration:this.client.generation};
      entry.promise=(async()=>{
        try{
          const connection=await this.client.status();
          if(generation!==this.generation)throw new ContractError('cancelled');
          if(connection.signedIn&&!connection.session)throw new ContractError('agent_identity_contract_required');
          this.adopt(connection.signedIn?connection.session:null);this.connection=connection;return connection;
        }catch(error){
          // Another panel may discover expiry while this status request is in
          // flight. Keep that expiry reason instead of showing "canceled".
          if(error.code==='cancelled'&&this.lastExpiry&&!this.session&&!this.client.token)throw this.lastExpiry;
          this.expired(error,generation);throw error;
        }
        finally{if(this.verification===entry)this.verification=null;}
      })();
      this.verification=entry;
    }
    const result=await this.verification.promise;
    if(signal?.aborted)throw new ContractError('cancelled');
    return result;
  }
  async connect() {
    if(this.connectTask?.generation===this.generation)return this.connectTask.promise;
    this.invalidate();const generation=this.generation,entry={generation};
    entry.promise=(async()=>{
      try{const status=await this.client.connect();if(generation!==this.generation)throw new ContractError('cancelled');this.adopt(status.session);this.connection=status;return status;}
      catch(error){this.expired(error,generation);throw error;}
      finally{if(this.connectTask===entry)this.connectTask=null;}
    })();
    this.connectTask=entry;return entry.promise;
  }
  configure(url) { this.lastExpiry=null;this.client.configure(url); this.adopt(null); this.catalog=[]; this.model=''; this.thinkingEffort=''; this.invalidate(); }
  async disconnect() {
    this.invalidate();const generation=this.generation;
    try{const result=await this.client.disconnect();if(generation!==this.generation&&(this.session||this.client.token))throw new ContractError('cancelled');await this.verify();return result;}
    catch(error){this.expired(error,generation);throw error;}
  }
  async models(accountId) {
    if(this.running)throw new ContractError('request_in_progress');
    await this.verify();
    if(!this.session)throw new ContractError('agent_authentication_required');
    if(accountId&&accountId!==this.session.user.id)throw new ContractError('account_changed');
    const generation=this.generation,id=this.session.user.id;
    if(this.modelLoad?.generation===generation&&this.modelLoad.accountId===id)return this.modelLoad.promise;
    const epoch=++this.modelEpoch,entry={generation,accountId:id};
    entry.promise=(async()=>{try{
      const result=await this.client.request('/v1/models');
      if(generation!==this.generation||epoch!==this.modelEpoch)throw new ContractError('cancelled');
      if(result.accountId!==id)throw new ContractError('account_changed');
      if(!Array.isArray(result.models)||result.models.some(model=>typeof model?.slug!=='string'||!Array.isArray(model.thinkingEfforts??[])))throw new ContractError('invalid_agent_response');
      this.catalog=result.models;this.catalogAccountId=id;
      if(!this.catalog.some(model=>model.slug===this.model)){this.model=this.catalog[0]?.slug||'';this.thinkingEffort='';}
      const selected=this.catalog.find(model=>model.slug===this.model),efforts=selected?.thinkingEfforts||[];
      if(!efforts.includes(this.thinkingEffort))this.thinkingEffort=efforts.includes(selected?.defaultThinkingEffort)?selected.defaultThinkingEffort:efforts[0]||'';
      return {accountId:id,models:this.catalog};
    }catch(error){this.expired(error,generation);throw error;}
    finally{if(this.modelLoad===entry)this.modelLoad=null;}})();
    this.modelLoad=entry;return entry.promise;
  }
  select({model,thinkingEffort,accountId}) {
    if(accountId!==this.session?.user.id||this.catalogAccountId!==accountId)throw new ContractError('account_changed');
    const selected=this.catalog.find(row=>row.slug===model);if(!selected)throw new ContractError('requested_model_not_available');
    if(thinkingEffort&&!selected.thinkingEfforts?.includes(thinkingEffort))throw new ContractError('unsupported_thinking_effort');
    if(this.model!==model||this.thinkingEffort!==(thinkingEffort||'')){this.model=model;this.thinkingEffort=thinkingEffort||'';this.invalidate();}
  }
  async request(path,body,{requestId,signal}={}) {
    if(this.running)throw new ContractError('request_in_progress');
    const task={id:requestId,controller:new AbortController()};this.running=task;
    const requestSignal=signal?AbortSignal.any([signal,task.controller.signal]):task.controller.signal;
    let generation=this.generation;
    try {
      await this.verify(requestSignal);
      generation=this.generation;
      if(this.running!==task||requestSignal.aborted)throw new ContractError('cancelled');
      if(!this.session)throw new ContractError('agent_authentication_required');
      if(body.accountId!==this.session.user.id)throw new ContractError('account_changed');
      if(this.catalogAccountId!==body.accountId)throw new ContractError('model_capabilities_changed');
      const selected=this.catalog.find(row=>row.slug===body.model);
      if(!selected)throw new ContractError('requested_model_not_available');
      if(body.thinkingEffort&&!selected.thinkingEfforts?.includes(body.thinkingEffort))throw new ContractError('unsupported_thinking_effort');
      const response=await this.client.request(path,{body,signal:requestSignal});
      if(generation!==this.generation||this.running!==task||requestSignal.aborted)throw new ContractError('cancelled');
      await this.verify(requestSignal);
      if(generation!==this.generation||this.running!==task||requestSignal.aborted)throw new ContractError('cancelled');
      return response;
    }catch(error){if(this.running===task&&!requestSignal.aborted)this.expired(error,generation);throw error;}
    finally{if(this.running===task)this.running=null;}
  }
}
