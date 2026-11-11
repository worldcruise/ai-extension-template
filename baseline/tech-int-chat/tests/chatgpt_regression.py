"""Offline Chromium regressions for the submission adapter, with a controlled-editor fixture.
This is NOT authenticated ChatGPT. Native DOM/editing operations are real except where a
case explicitly simulates a rejected native command or asynchronous editor reconciliation.
Chrome messaging and clipboard writes are mocked. No admin policy changes are made.
Run: python tests/chatgpt_regression.py --report docs/chatgpt-regression-results.json
Requires Python playwright and Chromium. No test dependencies are needed by the extension.
"""
import argparse, json, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('google-chrome'))
p.add_argument('--report')
args=p.parse_args()
checks=[]; comparisons=[]; errors=[]
def ok(name):
    checks.append(name); print('PASS:',name,flush=True)

SETUP = r'''opts => {
    window.fixture={model:'',clicks:0,inputs:[],nativeCalls:0,pasteCalls:0,logs:[],listeners:[],copied:[],alerts:[]};
    window.alert=msg=>fixture.alerts.push(msg);
    if(!crypto.randomUUID)crypto.randomUUID=()=> 'request_'+Date.now()+'_'+Math.random().toString(16).slice(2);
    window.TechIntClipboard={copy:async text=>{fixture.copied.push(text);return {ok:true,method:'content'}}};
    window.chrome={runtime:{id:'fixture',onMessage:{addListener:fn=>fixture.listeners.push(fn)}}};
    window.invoke=message=>new Promise(resolve=>{
        for(const fn of fixture.listeners) fn(message,{id:'fixture'},resolve);
    });
    const originalExec=document.execCommand.bind(document);
    document.execCommand=(...args)=>{fixture.nativeCalls++;return opts.rejectNative?false:originalExec(...args)};
    const button=document.querySelector('button');
    function render(editor) {
        const p=document.createElement('p');p.textContent=fixture.model;editor.replaceChildren(p);
        button.disabled=!fixture.model || !!opts.disabledSend;
    }
    window.configureEditor=editor=>{
        editor.addEventListener('input',event=>{
            fixture.inputs.push({trusted:event.isTrusted,type:event.inputType||null});
            if(!opts.controlled || event.isTrusted) fixture.model=editor.innerText;
            if(opts.controlled) queueMicrotask(()=>render(editor));
            else button.disabled=!!opts.disabledSend || !fixture.model;
        });
        if(opts.paste!==false)editor.addEventListener('paste',event=>{
            fixture.pasteCalls++;
            event.preventDefault();
            const text=event.clipboardData.getData('text/plain');
            const apply=()=>{
                fixture.model=text;
                let live=editor;
                if(opts.replaceAfterPaste){live=editor.cloneNode(false);editor.replaceWith(live);configureEditor(live);}
                render(live);
            };
            if(opts.pasteDelay)setTimeout(apply,opts.pasteDelay);else apply();
        });
    };
    let editor=document.querySelector('[contenteditable]');configureEditor(editor);
    if(opts.replaceOnFocus)editor.addEventListener('focus',()=>{
        const fresh=editor.cloneNode(false);editor.replaceWith(fresh);configureEditor(fresh);
    },{once:true});
    button.onclick=()=>{
        fixture.clicks++;
        if(opts.noAck)return;
        const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=fixture.model;
        document.querySelector('#messages').append(user);
        fixture.model='';render(document.querySelector('[contenteditable]'));
    };
}'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    def page_for(version='new', **opts):
        page=browser.new_page()
        page.on('pageerror',lambda e: errors.append(str(e)))
        generic_submit = opts.pop('genericSubmit', False)
        page.set_content('''<html><body><form><div id="prompt-textarea" contenteditable="true"
            style="white-space:pre-wrap;min-height:40px"><p><br></p></div>
            <button type="button" data-testid="send-button" disabled>Send</button></form><div id="messages"></div></body></html>''')
        if generic_submit:
            page.evaluate('''() => { const b=document.querySelector('button'); b.type='submit'; b.removeAttribute('data-testid');
                document.querySelector('form').addEventListener('submit',event=>event.preventDefault()); }''')
        if opts.pop('wrapper',False):
            page.evaluate('''() => {const e=document.querySelector('[contenteditable]');e.removeAttribute('id');
                const w=document.createElement('div');w.id='prompt-textarea';e.before(w);w.append(e)}''')
        page.evaluate(SETUP,opts)
        for file in ['gptPrompts.js','shared/PromptBuilder.js']:
            page.add_script_tag(path=str(ROOT/file))
        page.add_script_tag(path=str(ROOT/('tests/fixtures/ChatGPTAdapter.v2.1.2.js' if version=='old' else 'adapters/ChatGPTAdapter.js')))
        page.add_script_tag(path=str(ROOT/'chatGPT.js'))
        return page
    def send(page,text=None,id='regression_request_01'):
        return page.evaluate(r'''async ({text,id}) => invoke({type:'to-chatgpt',requestId:id,payloadVersion:1,
            finalText:text||TechIntPromptBuilder.build(1,'Hello! Can you hear me? Tell me about yourself.','conversation'),
            clipboard:{ok:true,method:'panel',api:'writeText'},aiMode:'conversation',state:1})''',{'text':text,'id':id})

    # Same prepared normal payload, same fixture, only the adapter changes.
    for name,opts in [
        ('native insertion refused; controlled editor reverts direct DOM mutation',dict(controlled=True,rejectNative=True)),
        ('prompt ID belongs to a noneditable wrapper',dict(controlled=True,rejectNative=True,wrapper=True)),
        ('focus handler replaces the initial composer',dict(controlled=True,replaceOnFocus=True)),
        ('composer exposes only a form-local button[type=submit]',dict(controlled=True,genericSubmit=True))]:
        pair={}
        for version in ['old','new']:
            page=page_for(version,**opts)
            result=send(page)
            pair[version]={'status':result['status'],'error':result.get('error'),'clicks':page.evaluate('fixture.clicks'),
                'code':result.get('code'),'pasteCalls':page.evaluate('fixture.pasteCalls')}
            assert (result['status']=='Content sent') == (version=='new'),(name,version,result)
            assert page.evaluate('fixture.clicks') == (1 if version=='new' else 0)
            assert page.evaluate('fixture.copied.length')==0 # prepared requests never recopy
            page.close()
        comparisons.append({'case':name,'result':pair})
        ok('v2.1.2 failure reproduced and v2.1.5 passes: '+name)

    # Real native execCommand input events (no native rejection mock in this case).
    event_counts={}
    for version in ['old','new']:
        page=page_for(version,paste=False,controlled=False)
        result=send(page); assert result['status']=='Content sent',result
        event_counts[version]=page.evaluate('fixture.inputs')
        page.close()
    assert len(event_counts['old'])==2 and len(event_counts['new'])==1,event_counts
    comparisons.append({'case':'native input event duplication','result':event_counts})
    ok('native editing emits input once in v2.1.5, rather than native plus duplicate synthetic input')

    # Full ordinary and coding templates plus long multilingual/line-broken content.
    page=page_for(controlled=True,rejectNative=True)
    for mode in ['conversation','coding']:
        for state in [1,2,3]:
            payload=page.evaluate(r'''({state,mode})=>TechIntPromptBuilder.build(state,
                'INTERVIEWER:\nHello!\n\nINTERVIEWEE:\nCafé 🧪 漢字\n'+'Long transcript. '.repeat(1200),mode)''',{'state':state,'mode':mode})
            result=send(page,payload,f'regression_{mode}_{state}');assert result['status']=='Content sent',result
            assert page.locator('[data-message-author-role="user"]').last.text_content()==payload
    assert page.evaluate('fixture.clicks')==6
    assert page.evaluate('fixture.copied.length')==0
    ok('Normal/Detail/STAR in both modes send full long Unicode payloads without rebuilding or recopying')
    logs=page.evaluate('__techIntChatAdapterV2.getDiagnostics()')
    assert all(x['source']=='panel' for x in logs)
    assert 'Café' not in json.dumps(logs) and 'Long transcript' not in json.dumps(logs)
    assert len(logs)<=120
    ok('diagnostic history is bounded and contains counts/stages, not transcript/prompt content')
    for key in ['F8','F9','F10']:
        before=page.evaluate('fixture.clicks');page.keyboard.press(key)
        page.wait_for_function('(before)=>fixture.clicks===before+1',arg=before)
        page.wait_for_timeout(100)
        assert page.locator('[data-message-author-role="user"]').last.text_content()==page.evaluate('fixture.copied.at(-1)')
    assert page.evaluate('__techIntChatAdapterV2.getDiagnostics().at(-1).source')=='hotkey'
    ok('working F8/F9/F10 still use the same adapter and copy their own final text')
    page.close()

    page=page_for(controlled=True,pasteDelay=350,replaceAfterPaste=True,rejectNative=True)
    result=send(page);assert result['status']=='Content sent',result
    assert page.evaluate('fixture.clicks')==1 and page.evaluate('fixture.nativeCalls')==0
    assert result['diagnostics']['replacements']>=1
    ok('asynchronous handled paste and composer replacement are not mistaken for insertion failure or replayed')
    page.close()

    page=page_for(controlled=True,rejectNative=True,paste=False)
    result=send(page);assert result['code']=='insertion_not_accepted' and not result['uncertain'],result
    assert not page.locator('[contenteditable]').inner_text().strip() and page.evaluate('fixture.clicks')==0
    assert result['diagnostics']['stage']=='insertion'
    ok('unsupported native insertion gets an insertion-stage error, not fabricated DOM text or a send click')
    page.close()

    page=page_for(controlled=True,disabledSend=True)
    result=send(page);assert result['code']=='send_button_not_ready' and not result['uncertain'],result
    assert result['diagnostics']['textMatches'] and page.evaluate('fixture.clicks')==0
    ok('accepted text with disabled Send is distinguished from rejected insertion')
    page.close()

    page=page_for(controlled=True)
    page.evaluate('document.querySelector("[contenteditable]").remove()')
    result=send(page);assert result['code']=='editor_not_found' and not result['uncertain'],result
    assert result['diagnostics']['stage']=='editor_lookup'
    ok('missing editor is distinguished from insertion/send readiness failures')
    page.close()

    page=page_for(controlled=True,noAck=True)
    result=send(page);assert result['status']=='Content sent',result
    assert page.evaluate('fixture.clicks')==1
    ok('verified Send click completes immediately without waiting on conversation/generation DOM')
    page.close()

    # User log reproduction: an auxiliary visible ProseMirror exists outside the composer form.
    page=page_for(controlled=True,rejectNative=True)
    page.evaluate("""() => {
        const actual=document.querySelector('[contenteditable]');actual.removeAttribute('id');actual.setAttribute('role','textbox');actual.className='ProseMirror';
        const decoy=document.createElement('div');decoy.contentEditable='true';decoy.setAttribute('role','textbox');
        decoy.className='ProseMirror';decoy.textContent='x'.repeat(927);decoy.style.minHeight='20px';
        document.body.prepend(decoy);
    }""")
    result=send(page,'Exact prepared prompt','regression_two_editors')
    assert result['status']=='Content sent',result
    assert page.evaluate('fixture.clicks')==1
    assert page.locator('body > .ProseMirror').inner_text()=='x'*927
    ok('form-local composer wins over a second visible ProseMirror candidate with unrelated text')
    page.close()

    # ChatGPT may leave a zero-width placeholder in an otherwise empty composer.
    page=page_for(controlled=True,rejectNative=True)
    page.evaluate("() => {document.querySelector('[contenteditable]').textContent='\u200b'}")
    result=send(page,'Zero width placeholder test','regression_zero_width')
    assert result['status']=='Content sent',result
    assert page.evaluate('fixture.clicks')==1
    ok('zero-width editor placeholders are treated as empty, not as an existing draft')
    page.close()

    page=page_for(controlled=True)
    page.evaluate('''() => {fixture.model='Private existing draft';document.querySelector('[contenteditable]').textContent=fixture.model}''')
    result=send(page);assert result['code']=='existing_draft' and page.evaluate('fixture.clicks')==0
    assert page.locator('[contenteditable]').inner_text()=='Private existing draft'
    ok('existing draft is preserved exactly and never replaced or submitted')
    page.close()

    page=page_for(controlled=True,disabledSend=True)
    page.evaluate('''() => {window.resultPromise=invoke({type:'to-chatgpt',requestId:'regression_user_edit',payloadVersion:1,
        finalText:'Extension draft',clipboard:{ok:true}})}''')
    page.wait_for_function('__techIntChatAdapterV2.getDiagnostics().some(x=>x.code==="insertion_verified")')
    page.locator('[contenteditable]').fill('User changed the draft')
    result=page.evaluate('resultPromise')
    assert result['code']=='prompt_changed' and page.evaluate('fixture.clicks')==0,result
    assert page.locator('[contenteditable]').inner_text()=='User changed the draft'
    ok('trusted user edit while waiting for Send cancels without overwriting the user')
    page.close()

    page=page_for(controlled=True)
    page.evaluate('''() => {const b=document.querySelector('button');b.removeAttribute('data-testid');
        b.id='composer-submit-button';b.type='submit';b.setAttribute('aria-label','Send prompt');
        document.querySelector('form').onsubmit=e=>e.preventDefault()}''')
    result=send(page);assert result['status']=='Content sent' and page.evaluate('fixture.clicks')==1,result
    ok('explicit composer-submit Send control is supported without generic form-submit guessing')
    page.close()

    page=page_for(controlled=True)
    page.evaluate('''() => {const b=document.querySelector('button');b.removeAttribute('data-testid');
        b.id='composer-submit-button';b.setAttribute('aria-label','Start voice mode')}''')
    result=send(page);assert result['code']=='send_button_not_ready' and page.evaluate('fixture.clicks')==0,result
    ok('voice control reusing composer-submit ID is never clicked as Send')
    page.close()

    page=page_for(controlled=True,pasteDelay=700)
    result=page.evaluate('''async () => {
        const pending=invoke({type:'to-chatgpt',requestId:'regression_cancel',payloadVersion:1,finalText:'Never send',clipboard:{ok:true}});
        setTimeout(()=>invoke({type:'cancel-chatgpt',requestId:'regression_cancel'}),200);
        return pending;
    }''')
    assert result['status']=='Error' and not result['uncertain']
    page.wait_for_timeout(800);assert page.evaluate('fixture.clicks')==0
    ok('cancellation during delayed editor processing cannot later submit the prompt')
    page.close()
    assert not errors,errors
    ok('no uncaught JavaScript exceptions in adapter regression fixtures')
    report={'release':'2.1.5','browser':browser.version,'passed':len(checks),'checks':checks,'comparisons':comparisons,
        'scope':'Real Chromium DOM + native edit events; mocked Chrome messages and OS clipboard. Controlled-editor model is a fixture, not ChatGPT internals.',
        'limitations':['No authenticated ChatGPT or Google Meet','No native extension load or system clipboard validation','No proof that the simulated native-insertion rejection is the exact cause on the user machine']}
    browser.close()
if args.report: Path(args.report).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
