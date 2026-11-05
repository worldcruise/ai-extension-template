import {isSessionExpired} from './controller.mjs';

const messages={
  invalid_agent_url:'Enter an HTTPS origin without credentials, a path, query parameters, or a fragment.',
  invalid_agent_identity:'ChatGPT did not return a valid verified account identity.',
  agent_connection_error:'The ChatGPT connection could not be reached. Your account selection is retained.',
  provider_connection_error:'The provider could not be reached. Try again when the connection recovers.',
  authorization_cancelled:'Sign-in was canceled. Choose Sign in with ChatGPT to try again.',
  authorization_timeout:'Sign-in timed out. Choose Sign in with ChatGPT to try again.',
  callback_setup_failed:'Chrome could not prepare the sign-in callback. Reload the extension and approve its permissions.',
  callback_invalid:'This sign-in callback expired or did not belong to the pending sign-in. Try again.',
  state_mismatch:'The sign-in response did not match this request. Start sign-in again.',
  invalid_grant:'The sign-in code expired or could not be exchanged. Start sign-in again.',
  invalid_client:'ChatGPT rejected this client registration. Check the account’s integration access.',
  unauthorized_client:'This account has not authorized this client. Check its integration access.',
  access_denied:'ChatGPT sign-in or plan permission was declined.',
  selected_account_mismatch:'Choose the ChatGPT account previously registered for this extension.',
  chatgpt_plan_scope_not_granted:'Sign-in succeeded, but permission to use the ChatGPT plan was not granted.',
  id_token_verification_failed:'ChatGPT identity verification failed. No session was accepted.',
  unexpected_provider_configuration:'ChatGPT sign-in configuration changed. No session was accepted.',
  connection_error:'The connection to ChatGPT could not finish. Try again when the connection recovers.',
  provider_request_failed:'ChatGPT rejected the request. Reload models or check the account’s access.',
  account_changed:'Account changed. Reload this account’s models, review the settings, and choose Go again.',
  model_capabilities_changed:'Reload this account’s models before choosing Go again.',
  unsupported_thinking_effort:'This thinking effort is unavailable. Reload models and review the settings.',
  requested_model_not_available:'This model is unavailable for the current account. Reload models.',
  no_available_models:'No models are available for this account.',
  request_in_progress:'Another request is running. Cancel it before submitting again.',
  output_validation_failed:'Inference finished, but the output did not pass the required validation.',
  browser_window_unavailable:'The associated browser window is unavailable. Open the agent from its toolbar button in a browser window.',
  cancelled:'The request was canceled.',
};
export function errorMessage(error) {
  if(isSessionExpired(error))return 'Your session expired. Sign in with ChatGPT again.';
  if(error?.status===403)return 'This account cannot access that model. Choose an available model or reload models.';
  return messages[error?.code]||'The request could not finish. Check the ChatGPT connection and try again.';
}
export async function call(type,values={},signal) {
  const requestId=crypto.randomUUID();
  if(signal?.aborted)throw new DOMException('Canceled','AbortError');
  let abort;
  const pending=chrome.runtime.sendMessage({type,...values,requestId}).then(reply=>{
    if(!reply?.ok){const error=Object.assign(new Error(),reply?.error||{code:'engine_unavailable'});error.message=errorMessage(error);throw error;}
    return reply.data;
  });
  try {
    if(!signal)return await pending;
    return await Promise.race([pending,new Promise((_,reject)=>{
      abort=()=>{void chrome.runtime.sendMessage({type:'agent.cancel',requestId}).catch(()=>{});reject(new DOMException('Canceled','AbortError'));};
      signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    })]);
  } finally { if(abort)signal.removeEventListener('abort',abort); }
}
export function extensionAdapter() {
  return {
    getSession:({signal}={})=>call('agent.session',{},signal),
    signIn:({signal}={})=>call('agent.connect',{},signal),
    signOut:({signal}={})=>call('agent.disconnect',{},signal),
    async getModels({accountId,signal}) {
      const result=await call('agent.models',{accountId},signal);
      if(result.accountId!==accountId)throw Object.assign(new Error(messages.account_changed),{code:'account_changed'});
      return result.models.map(model=>({id:model.slug,label:model.display_name||model.slug,
        thinkingEfforts:model.thinkingEfforts??[],defaultThinkingEffort:model.defaultThinkingEffort}));
    },
    run:({agentId,prompt,input,model,thinkingEffort,accountId,signal})=>call('agent.run',{
      agentId,prompt,input,model,accountId,...(thinkingEffort?{thinkingEffort}:{})},signal),
  };
}
export const hostedAdapter=extensionAdapter;
