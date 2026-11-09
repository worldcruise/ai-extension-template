import assert from 'node:assert/strict';

// Executes the real isolated-world adapter against synthetic HTTPS documents.
// Every target is in the disposable Chrome test profile, never a user session.
export async function checkEditorBoundaries({ cdp, id, evaluate, until, session, contexts }) {
  const checks = [];
  async function page() {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const targetSession = await session(targetId);
    const context = await until(async () => {
      for (const context of contexts.get(targetSession)?.values() || []) {
        if (context.origin === `chrome-extension://${id}` || context.name?.includes(id)) {
          if (await evaluate(targetSession, 'Boolean(globalThis.AiAgentChatQueue)', context.id)) return context.id;
        }
      }
    }, 'isolated ChatGPT adapter context');
    const run = expression => evaluate(targetSession, expression, context);
    await until(() => run('Boolean(document.getElementById("prompt-textarea")) && Boolean(document.querySelector("button[data-testid=send-button],#composer-submit-button"))'), 'synthetic composer ready');
    return { targetId, targetSession, run };
  }
  async function executeCase(name, settings = {}, expectedCode = null) {
    const fixture = await page();
    const result = await fixture.run(`(async () => {
      const settings=${JSON.stringify(settings)};
      for(const key of ['fixtureBlockSend','fixtureEditorKind','fixtureSendControl','fixtureAccountMenu'])localStorage.removeItem(key);
      const initialLog=JSON.parse(localStorage.getItem('fixtureSubmissionLog')||'[]').length;
      Object.assign(document.documentElement.dataset,settings.dataset||{});
      if(settings.blockSend)localStorage.setItem('fixtureBlockSend','true');
      if(settings.personalDraft){document.getElementById('prompt-textarea').value='Synthetic unrelated draft';document.getElementById('prompt-textarea').dispatchEvent(new Event('input',{bubbles:true}));}
      const requestId=crypto.randomUUID(),deliveryId=crypto.randomUUID(),operationId=crypto.randomUUID();
      const prompt=['AI_AGENT_REQUEST:'+requestId,'AI_AGENT_DELIVERY:'+deliveryId,settings.refusal?'FIXTURE_REFUSAL':'Synthetic fixture',JSON.stringify({schemaVersion:1,requestId,resume:{synthetic:true}})].join('\\n\\n');
      let prepared=0, staleIgnored=false, adapter;
      adapter=AiAgentChatQueue.createPageAdapter(message=>{
        if(message.phase==='prepared'){
          prepared++;
          if(settings.navigateAtAuthorization)history.pushState({},'', '/c/unrelated-fixture');
          if(settings.cancelAtAuthorization){adapter.dispose();setTimeout(()=>adapter.authorize(operationId,true),30);return;}
          if(settings.changeAtAuthorization){document.getElementById('prompt-textarea').value='Synthetic changed draft';}
          if(settings.staleAuthorization){
            adapter.authorize('older-operation',true);
            setTimeout(()=>{staleIgnored=JSON.parse(localStorage.getItem('fixtureSubmissionLog')||'[]').length===initialLog;adapter.authorize(operationId,true);},100);
          }else adapter.authorize(operationId,true);
        }
      });
      if(settings.cancelAfterMs)setTimeout(()=>adapter.dispose(),settings.cancelAfterMs);
      let value,error;
      try{value=await adapter.execute('submit',{requestId,deliveryId,prompt,hostBuildId:AiAgentBuild.id},operationId);}
      catch(failure){error={code:failure.code,diagnostics:failure.diagnostics};}
      const current=document.getElementById('prompt-textarea');
      const result={code:error?.code||null,diagnostics:error?.diagnostics||value?.diagnostics,completed:value?.completed,kind:value?.kind,
        clicks:JSON.parse(localStorage.getItem('fixtureSubmissionLog')||'[]').length-initialLog,prepared,staleIgnored,
        preserved:current?.value==='Synthetic unrelated draft'||current?.value==='Synthetic changed draft'||current?.value==='Synthetic draft changed while waiting',
        inputs:Number(document.documentElement.dataset.fixtureInputs||0),
        captureTailMs:value?.diagnostics?.timestamps?.capturedAt-Number(document.documentElement.dataset.fixtureCompletedAt||0)};
      adapter.dispose();localStorage.removeItem('fixtureBlockSend');return result;
    })()`);
    assert.equal(result.code, expectedCode, name);
    assert.equal(result.clicks, settings.expectedClicks ?? (expectedCode ? 0 : 1), `${name}: no extra Send`);
    assert.ok(!JSON.stringify(result.diagnostics).includes('AI_AGENT_REQUEST:'), `${name}: diagnostics contain no prompt`);
    checks.push(name); await cdp.send('Target.closeTarget', { targetId: fixture.targetId });
    return result;
  }
  const retained = await executeCase('replacement editor retaining the exact prompt', { dataset: { fixtureRemount: 'retained' } });
  assert.equal(retained.diagnostics.editor.identityChanged, true); assert.equal(retained.inputs, 1);
  assert.ok(retained.captureTailMs >= 170 && retained.captureTailMs < 1000, 'confirmed JSON capture settles promptly');
  const discarded = await executeCase('detached old editor is not authoritative when insertion is discarded', { dataset: { fixtureRemount: 'discarded' } }, 'composer-changed');
  assert.equal(discarded.diagnostics.editor.identityChanged, true); assert.equal(discarded.diagnostics.editor.observedLength, 0); assert.equal(discarded.inputs, 1);
  const unexpected = await executeCase('replacement with an unexpected draft is preserved without reinsertion', { dataset: { fixtureRemount: 'unexpected' } }, 'composer-changed');
  assert.equal(unexpected.preserved, true); assert.equal(unexpected.inputs, 1);
  const personal = await executeCase('pre-existing unrelated draft is never overwritten', { personalDraft: true }, 'existing-draft');
  assert.equal(personal.preserved, true); assert.equal(personal.inputs, 1);
  const changed = await executeCase('draft changed while waiting for Send', { blockSend: true, dataset: { fixtureEditWhileWaiting: 'true' } }, 'composer-changed');
  assert.equal(changed.preserved, true); assert.equal(changed.prepared, 0);
  await executeCase('final authorization boundary rejects a changed draft', { changeAtAuthorization: true }, 'composer-changed');
  await executeCase('navigation before Send preserves the draft and issues no click', { navigateAtAuthorization: true }, 'navigation');
  await executeCase('cancellation ignores a delayed authorization callback', { cancelAtAuthorization: true }, 'interrupted');
  const stale = await executeCase('stale authorization cannot release a current operation', { staleAuthorization: true });
  assert.equal(stale.staleIgnored, true);
  await executeCase('delayed acknowledgement never causes another Send', { dataset: { fixtureAckDelay: '1800' } });
  const unacknowledged = await executeCase('missing acknowledgement is uncertain and never causes a second Send', { dataset: { fixtureDropAck: 'true' }, expectedClicks: 1 }, 'send-unacknowledged');
  assert.equal(unacknowledged.diagnostics.send.dispatched, true); assert.equal(unacknowledged.diagnostics.send.acknowledged, false);
  const refusal = await executeCase('only a completed owned refusal is classified as an error response', { refusal: true });
  assert.equal(refusal.completed, true); assert.equal(refusal.kind, 'error');
  assert.ok(refusal.captureTailMs >= 1200, 'invalid/non-JSON responses retain conservative settling');
  const unfinished = await executeCase('stable text without final controls is not a confirmed completed response', { dataset: { fixtureNoFinalActions: 'true' }, cancelAfterMs: 2600, expectedClicks: 1 }, 'interrupted');
  assert.equal(unfinished.completed, undefined);
  const auth = await page();
  const report = await auth.run(`(async()=>{
    document.querySelectorAll('[data-testid="accounts-profile-button"]').forEach(node=>node.remove());
    const adapter=AiAgentChatQueue.createPageAdapter(()=>{});
    const inspection=await adapter.execute('inspect',{},'inspect-auth');let rejected;
    try{await adapter.execute('preflight',{hostBuildId:AiAgentBuild.id},'unknown-auth');}catch(error){rejected=error.code;}
    const confirmed=await adapter.execute('preflight',{hostBuildId:AiAgentBuild.id,sessionConfirmed:true},'confirmed-auth');
    document.querySelector('form').dataset.loggedOut='';let signedOut;
    try{await adapter.execute('preflight',{hostBuildId:AiAgentBuild.id,sessionConfirmed:true},'signed-out');}catch(error){signedOut=error.code;}
    return{authState:inspection.authState,present:inspection.composerPresent,rejected,confirmed:confirmed.sessionConfirmed,authenticated:confirmed.authenticated,signedOut};
  })()`);
  assert.deepEqual(report, { authState: 'unknown', present: true, rejected: 'login-unverified', confirmed: true, authenticated: false, signedOut: 'signed-out' });
  checks.push('unknown authentication with and without confirmation; explicit sign-out wins');
  await cdp.send('Target.closeTarget', { targetId: auth.targetId });
  async function navigationCase(name, settings = {}) {
    const fixture = await page();
    const result = await fixture.run(`(async()=>{
      const settings=${JSON.stringify(settings)}, adapter=AiAgentChatQueue.createPageAdapter(()=>{});
      const started=performance.timeOrigin, initial=Number(localStorage.getItem('fixtureNewChatClicks')||0);
      if(!settings.empty)history.pushState({},'', '/c/navigation-fixture');
      if(settings.missing)document.querySelector('[data-testid="create-new-chat-button"]').remove();
      if(settings.draft)document.getElementById('prompt-textarea').value='Preserved personal draft';
      Object.assign(document.documentElement.dataset,settings.dataset||{});
      if(settings.cancel)setTimeout(()=>adapter.dispose(),30);
      let value,code;
      try{value=await adapter.execute('fresh-conversation',{hostBuildId:AiAgentBuild.id},crypto.randomUUID());}catch(error){code=error.code;}
      const result={fresh:value?.fresh,dispatched:value?.dispatched,method:value?.method,code:code||null,
        clicks:Number(localStorage.getItem('fixtureNewChatClicks')||0)-initial,sameDocument:started===performance.timeOrigin,
        draft:document.getElementById('prompt-textarea').value};
      adapter.dispose();return result;
    })()`);
    assert.equal(result.code, settings.code || null, name);
    assert.equal(result.clicks, settings.clicks ?? 1, name);
    assert.equal(result.sameDocument, true, name);
    checks.push(name); await cdp.send('Target.closeTarget', {targetId:fixture.targetId}); return result;
  }
  const empty = await navigationCase('verified empty Home is reused without clicking or reloading', {empty:true,clicks:0});
  assert.equal(empty.fresh,true); assert.equal(empty.method,'empty-chat');
  const native = await navigationCase('native New chat resolves from observed fresh editor without reload', {dataset:{fixtureNativeDelay:'75'}});
  assert.equal(native.fresh,true); assert.equal(native.method,'native');
  const missing = await navigationCase('missing native control explicitly permits the guarded full-load fallback', {missing:true,clicks:0});
  assert.equal(missing.dispatched,false); assert.equal(missing.fresh,false);
  const protectedDraft = await navigationCase('native fresh-chat preflight never clears a personal draft', {draft:true,clicks:0,code:'existing-draft'});
  assert.equal(protectedDraft.draft,'Preserved personal draft');
  await navigationCase('unexpected native navigation does not become send authorization', {dataset:{fixtureNativeUnexpectedRoute:'true'},code:'navigation'});
  const restored = await navigationCase('a draft restored by the new chat is preserved', {dataset:{fixtureNativeDraft:'true'},code:'existing-draft'});
  assert.equal(restored.draft,'Synthetic restored draft');
  await navigationCase('cancelled native navigation cannot trigger insertion or a delayed Send', {dataset:{fixtureNativeDelay:'100'},cancel:true,code:'interrupted'});
  return { checks, fixtureOnly: true, liveAccount: false };
}
