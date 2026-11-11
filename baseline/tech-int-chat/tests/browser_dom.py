"""Offline real-Chromium DOM tests using mocked Chrome messages (no navigation/login).
Run: python tests/browser_dom.py [--chromium /path/to/chromium] [--report file.json]
Requires Python 3 and playwright. Does not exercise real IndexedDB or MV3 lifecycles.
"""
import argparse, json, shutil, re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('google-chrome'))
parser.add_argument('--report')
args = parser.parse_args()
passed = []
def ok(name):
    passed.append(name)
    print('PASS:', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content('''<html><body><div class="iOzk7"><div class="nMcdL bj4p3b">
        <span class="jxFHg">Alice</span><span class="ygicle VbkSUe">Hello world</span>
        </div></div></body></html>''')
    page.evaluate('''() => {
        window.fixture = {sent:[], epoch:0, delay:0, stored:new Map(), listeners:[], intervals:[], dialogs:[]};
        const originalInterval = window.setInterval;
        window.setInterval = (fn, ms, ...args) => {fixture.intervals.push(ms);return originalInterval(fn,ms,...args)};
        window.alert = message => fixture.dialogs.push(message);
        // about:blank is not a secure context, so supply test-only IDs. Runtime Chrome is secure.
        if(!crypto.randomUUID) crypto.randomUUID = () => 'test-'+Date.now()+'-'+Math.random().toString(16).slice(2);
        window.chrome = {runtime:{id:'fixture',onMessage:{addListener(fn){fixture.listeners.push(fn)},removeListener(fn){fixture.listeners=fixture.listeners.filter(f=>f!==fn)}},
            sendMessage(message, callback) {
                fixture.sent.push(structuredClone(message));
                if(message.type==='REGISTER_MEETING') {queueMicrotask(()=>callback({status:'ready',protocol:2,epoch:fixture.epoch}));return;}
                if(message.type==='CHAT_PATCH') {
                    const data=structuredClone(message.data);
                    if(data.epoch!==fixture.epoch) {queueMicrotask(()=>callback({status:'STALE_EPOCH',epoch:fixture.epoch}));return;}
                    for(const group of data.groups) {
                        const previous=fixture.stored.get(group.rawTicId);
                        if(!previous || group.revision>previous.revision) fixture.stored.set(group.rawTicId,group);
                    }
                    setTimeout(()=>callback({status:'Patch applied',epoch:fixture.epoch,patchId:data.patchId}), fixture.delay);
                }
            }
        }};
    }''')
    page.add_script_tag(path=str(ROOT / 'meeting.js'))
    page.wait_for_function("fixture.stored.size === 1")
    first = page.evaluate("[...fixture.stored.values()][0]")
    assert first['chunks'][0]['content'] == 'Hello world' and first['chunks'][0]['role'] == 'Alice'
    assert page.evaluate('fixture.intervals') == [10000]
    ok('unchanged Meet selectors/parser capture captions; 450 ms polling is absent')

    page.evaluate("fixture.delay=600;document.querySelector('.ygicle').textContent='First revision'")
    page.wait_for_function("[...fixture.stored.values()][0].chunks[0].content === 'First revision'")
    page.evaluate("document.querySelector('.ygicle').firstChild.data='Second revision'")
    page.wait_for_function("[...fixture.stored.values()][0].chunks[0].content === 'Second revision'")
    assert page.evaluate("[...fixture.stored.values()][0].revision") == 3
    page.evaluate('fixture.delay=0')
    ok('characterData updates and late ACKs preserve the newest caption revision')

    page.evaluate("document.querySelector('.jxFHg').textContent='Bob'")
    page.wait_for_function("[...fixture.stored.values()][0].chunks[0].role === 'Bob'")
    ok('speaker-only changes produce a new complete caption revision')

    long_text = ' '.join(['word']*20) + '? more text'
    page.locator('.ygicle').evaluate('(node,text)=>node.textContent=text', long_text)
    page.wait_for_function("[...fixture.stored.values()][0].chunks.length===2")
    page.locator('.ygicle').evaluate('(node,text)=>node.textContent=text', long_text.replace('?', ''))
    page.wait_for_function("[...fixture.stored.values()][0].chunks.length===1")
    ok('original sentence-splitting behavior is preserved, with whole-revision replacement')

    page.evaluate('''() => {
        fixture.stored.clear(); fixture.epoch=1;
        for(const fn of fixture.listeners)fn({type:'TRANSCRIPT_EPOCH',epoch:1},{},()=>{});
    }''')
    page.wait_for_timeout(200)
    assert page.evaluate('fixture.stored.size') == 0
    page.locator('.ygicle').evaluate("node=>node.textContent='Post-clear text'")
    page.wait_for_function("fixture.stored.size===1 && [...fixture.stored.values()][0].chunks[0].content==='Post-clear text'")
    assert page.evaluate("fixture.sent.filter(m=>m.type==='CHAT_PATCH').at(-1).data.epoch") == 1
    ok('Clear invalidates pending work without re-adding unchanged visible captions')

    page.evaluate('''() => {
        document.querySelector('.iOzk7').remove();
        const root=document.createElement('div');root.className='iOzk7';
        root.innerHTML='<div class="nMcdL bj4p3b"><span class="jxFHg">Carol</span><span class="ygicle VbkSUe">New container</span></div>';
        document.body.appendChild(root);
    }''')
    page.wait_for_function("fixture.stored.size===2", timeout=3000)
    ok('removed/replaced caption containers are rediscovered by DOM events')
    before = page.evaluate('fixture.listeners.length')
    page.add_script_tag(path=str(ROOT / 'meeting.js'))
    assert page.evaluate('fixture.listeners.length') == before
    page.evaluate('window.__techIntChatOldBaseMonitor.stop()')
    assert page.evaluate('fixture.listeners.length') == 0
    ok('duplicate content injection is guarded and stop removes the runtime listener')
    # Same production delivery logic with a deliberately tiny test buffer to exercise backpressure.
    page.evaluate("fixture.stored.clear();fixture.delay=650;fixture.dialogs=[]")
    limited_source = (ROOT/'meeting.js').read_text().replace('const MAX_PENDING_GROUPS = 800;', 'const MAX_PENDING_GROUPS = 1;')
    page.add_script_tag(content=limited_source)
    page.wait_for_function("fixture.stored.size === 1")
    page.evaluate("document.querySelector('.iOzk7').insertAdjacentHTML('beforeend','<div class=\"nMcdL bj4p3b\"><span class=\"jxFHg\">Dana</span><span class=\"ygicle VbkSUe\">Buffered second row</span></div>')")
    page.wait_for_function("window.__techIntChatOldBaseMonitor.diagnostics().capturePaused")
    page.wait_for_function("fixture.stored.size===2", timeout=4000)
    page.wait_for_function("window.__techIntChatOldBaseMonitor.diagnostics().pendingGroups===0", timeout=4000)
    assert not page.evaluate("window.__techIntChatOldBaseMonitor.diagnostics().capturePaused")
    page.evaluate("window.__techIntChatOldBaseMonitor.stop()")
    ok('full retry buffer pauses capture, retains unsent captions, and resumes after acknowledgment')
    assert not errors, errors
    page.close()

    # ChatGPT content controller and DOM adapter in a separate real document.
    page = browser.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content('''<html><body><textarea id="prompt-textarea"></textarea>
        <button data-testid="send-button">Send</button><div id="messages"></div></body></html>''')
    page.evaluate('''() => {
        window.fixture={listeners:[],sent:0,observers:0,dialogs:[],copies:[],received:[],copyOK:true};
        if(!crypto.randomUUID)crypto.randomUUID=()=> 'fixture_id_'+Date.now()+'_'+Math.random().toString(16).slice(2);
        window.alert=message=>fixture.dialogs.push(message);
        const Observer=window.MutationObserver;
        window.MutationObserver=class {
            constructor(callback){this.inner=new Observer(callback);this.active=false;this.owned=!new Error().stack.includes('InjectedScript');}
            observe(...args){if(!this.active){if(this.owned)fixture.observers++;this.active=true}this.inner.observe(...args)}
            disconnect(){if(this.active){if(this.owned)fixture.observers--;this.active=false}this.inner.disconnect()}
        };
        window.chrome={runtime:{id:'fixture',onMessage:{addListener(fn){fixture.listeners.push(fn)}},
            sendMessage(message,callback){
                if(message.type!=='COPY_CHATGPT_PAYLOAD')throw new Error('Unexpected message');
                fixture.copies.push(structuredClone(message));
                queueMicrotask(()=>callback({ok:fixture.copyOK}));
            }
        }};
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){
            fixture.copies.push({text});return Promise.resolve();
        }}});
        window.sendFixture=message=>new Promise(resolve=>{
            // Model the PREPARED message supplied by the panel, not legacy production input.
            if(message.type==='to-chatgpt') {
                message={...message,payloadVersion:1,
                    finalText:TechIntPromptBuilder.build(message.state,message.content,message.aiMode),
                    clipboard:{ok:fixture.copyOK,method:'panel',code:'copy_command_failed'}};
                fixture.received.push(message);
            }
            fixture.listeners[0](message,{id:'fixture'},resolve);
        });
        document.querySelector('button').onclick=()=>{
            fixture.sent++;
            const user=document.createElement('div');user.dataset.messageAuthorRole='user';
            user.textContent=document.querySelector('#prompt-textarea').value;
            document.querySelector('#messages').appendChild(user);
            document.querySelector('#prompt-textarea').value='';
        };
    }''')
    for file in ['gptPrompts.js', 'shared/PromptBuilder.js', 'shared/ClipboardWriter.js', 'adapters/ChatGPTAdapter.js', 'chatGPT.js']:
        page.add_script_tag(path=str(ROOT / file))
    response = page.evaluate("sendFixture({type:'ping'})")
    assert response['protocol'] == 2 and response['version'] == '2.1.5' and response['preparedPayload']
    ok('ChatGPT content script announces protocol compatibility and clipboard capability')
    responses = page.evaluate('''() => {
        const request={type:'to-chatgpt',requestId:'request_duplicate_1',state:5,content:'A test prompt'};
        return Promise.all([sendFixture(request),sendFixture(request)]);
    }''')
    assert all(r['status'] == 'Content sent' for r in responses)
    assert page.evaluate('fixture.sent') == 1
    response = page.evaluate("sendFixture({type:'to-chatgpt',requestId:'request_duplicate_1',state:5,content:'A test prompt'})")
    assert response['status'] == 'Content sent' and page.evaluate('fixture.sent') == 1
    assert page.evaluate('fixture.observers') == 0
    ok('in-flight and completed request replay never clicks Send twice')
    assert page.evaluate('fixture.copies.length') == 0
    assert page.evaluate('fixture.received[0].finalText') == 'A test prompt'
    ok('prepared requests never trigger a second clipboard write in the ChatGPT tab')

    page.locator('#prompt-textarea').fill('My private draft')
    response = page.evaluate("sendFixture({type:'to-chatgpt',requestId:'request_draft_2',state:5,content:'Do not replace draft'})")
    assert response['status'] == 'Error' and not response['uncertain']
    assert page.locator('#prompt-textarea').input_value() == 'My private draft'
    assert page.evaluate('fixture.sent') == 1
    ok('existing drafts remain intact and report a safe pre-submission failure')
    page.locator('#prompt-textarea').fill('')

    # Busy generation is never stopped; cancellation cleans the pending observer.
    response = page.evaluate('''async () => {
        const stop=document.createElement('button');stop.dataset.testid='stop-button';stop.textContent='Stop';
        stop.onclick=()=>fixture.stopClicks=(fixture.stopClicks||0)+1;document.body.appendChild(stop);
        const pending=sendFixture({type:'to-chatgpt',requestId:'request_cancel_3',state:5,content:'Wait until idle'});
        setTimeout(()=>sendFixture({type:'cancel-chatgpt',requestId:'request_cancel_3'}),100);
        const result=await pending;stop.remove();return result;
    }''')
    assert response['status'] == 'Error' and not response['uncertain']
    assert page.evaluate('fixture.stopClicks || 0') == 0
    assert page.evaluate('fixture.observers') == 0
    ok('active generation is never auto-stopped; cancellation disconnects observers')

    # A verified Send click is terminal; do not wait on fragile ChatGPT conversation/generation DOM.
    page.evaluate("document.querySelector('[data-testid=send-button]').onclick=()=>{fixture.sent++}")
    response = page.evaluate("sendFixture({type:'to-chatgpt',requestId:'request_submit_4',state:5,content:'Submitted prompt'})")
    assert response['status'] == 'Content sent'
    before = page.evaluate('fixture.sent')
    replay = page.evaluate("sendFixture({type:'to-chatgpt',requestId:'request_submit_4',state:5,content:'Submitted prompt'})")
    assert replay['status'] == 'Content sent' and page.evaluate('fixture.sent') == before
    assert page.evaluate('fixture.observers') == 0
    ok('verified Send click completes without post-submit DOM acknowledgment and request replay does not click twice')

    # Native contenteditable path (ChatGPT commonly uses an editable DIV).
    page.evaluate('''() => {
        document.querySelector('#prompt-textarea').remove();
        const editor=document.createElement('div');editor.id='prompt-textarea';editor.contentEditable='true';
        editor.style.minHeight='30px';editor.style.border='1px solid';document.body.prepend(editor);
        document.querySelector('[data-testid=send-button]').onclick=()=>{
            fixture.sent++;const user=document.createElement('div');user.dataset.messageAuthorRole='user';
            user.textContent=editor.innerText;document.querySelector('#messages').appendChild(user);editor.textContent='';
        };
    }''')
    response = page.evaluate("sendFixture({type:'to-chatgpt',requestId:'request_editable_5',state:5,content:'Editable div prompt'})")
    assert response['status'] == 'Content sent'
    ok('contenteditable editor insertion and submission acknowledgment work')

    # Full template + selected transcript, not merely raw transcript, is copied.
    response = page.evaluate(r"sendFixture({type:'to-chatgpt',requestId:'request_full_copy_6',state:2,aiMode:'coding',content:'Alice: Why?\nBob: 🧪'})")
    assert response['status'] == 'Content sent' and response['clipboard']['ok']
    assert page.evaluate("fixture.received.at(-1).finalText === window.TECH_INT_GPT_PROMPTS.coding.detail + 'Alice: Why?\\nBob: 🧪'")
    copied=page.evaluate("fixture.received.at(-1).finalText")
    submitted=page.evaluate("[...document.querySelectorAll('[data-message-author-role=user]')].at(-1).textContent")
    assert " ".join(copied.split()) == " ".join(submitted.split()), (copied, submitted)
    # Existing contenteditable insertion may normalize line breaks. The exact
    # clipboard string above is checked against the original prompt template.

    ok('prepared coding payload reaches the adapter intact with no content-side rebuild')

    page.evaluate('fixture.copyOK=false')
    response = page.evaluate("sendFixture({type:'to-chatgpt',requestId:'request_copy_fail_7',state:5,content:'Still send this prompt'})")
    assert response['status'] == 'Content sent' and not response['clipboard']['ok']
    assert page.evaluate("[...document.querySelectorAll('[data-message-author-role=user]')].at(-1).textContent") == 'Still send this prompt'
    ok('a denied clipboard write does not block real DOM submission')
    page.evaluate('fixture.copyOK=true')

    for key, prompt in [('F8','detail'),('F9','technical'),('F10','star')]:
        before=page.evaluate('fixture.sent')
        page.keyboard.press(key)
        page.wait_for_function('(n)=>fixture.sent===n+1', arg=before)
        assert page.evaluate(f'fixture.copies.at(-1).text === window.TECH_INT_GPT_PROMPTS.followUp.{prompt}')
    ok('ChatGPT F8/F9/F10 hotkeys also copy their exact follow-up text')
    assert not errors, errors
    page.close()

    # Actual helper DOM; clipboard system calls and Chrome sender metadata are mocked.
    page=browser.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<html><body></body></html>')
    page.evaluate('''() => {
        window.fixture={listeners:[],writes:[],mode:'success'};
        window.chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,
            onMessage:{addListener(fn){fixture.listeners.push(fn)}}}};
        document.execCommand=command=>{
            if(command!=='copy')throw new Error('Unexpected command');
            if(fixture.mode==='throw')throw new Error('denied');
            if(fixture.mode==='false')return false;
            if(fixture.mode==='no-event')return true;
            const event=new ClipboardEvent('copy',{clipboardData:new DataTransfer(),cancelable:true});
            document.dispatchEvent(event);
            fixture.writes.push(event.clipboardData.getData('text/plain'));
            return true;
        };
        window.copyFixture=(text,extra={},sender={id:'fixture',url:chrome.runtime.getURL('background.js')})=>{
            let response;
            const handled=fixture.listeners[0]({type:'WRITE_CLIPBOARD_TEXT',target:'tech-int-chat-clipboard',
                requestId:'helper_request_1',text,expiresAt:Date.now()+2000,...extra},sender,r=>response=r);
            return {response,handled};
        };
    }''')
    page.add_script_tag(path=str(ROOT/'offscreen/clipboard.js'))
    exact='  Full prompt\r\n\nAlice: 🧪\n    const x = "<b>not HTML</b>";  '
    response=page.evaluate('(text)=>copyFixture(text)',exact)
    assert response['response']['ok'] and not response['handled']
    assert page.evaluate('fixture.writes[0]')==exact
    assert page.locator('textarea').count()==0
    assert page.evaluate('''() => {
        const e=new ClipboardEvent('copy',{clipboardData:new DataTransfer(),cancelable:true});
        document.dispatchEvent(e);return e.clipboardData.types.length===0;
    }''')
    ok('offscreen helper preserves plain-text payload and removes its textarea/copy listener')
    for mode in ['false','throw','no-event']:
        page.evaluate('(mode)=>fixture.mode=mode',mode)
        response=page.evaluate("copyFixture('copy denied')")
        assert not response['response']['ok'] and page.locator('textarea').count()==0
    ok('offscreen false-return, exception and missing-copy-event paths cannot claim success')
    page.evaluate("fixture.mode='success'")
    assert page.evaluate("copyFixture('worker root',{}, {id:'fixture',url:chrome.runtime.getURL('')}).response.ok")
    assert page.evaluate("copyFixture('worker without URL',{}, {id:'fixture'}).response.ok")
    ok('offscreen sender validation accepts trusted extension-root and omitted-URL metadata')
    before=page.evaluate('fixture.writes.length')
    response=page.evaluate("copyFixture('stale',{expiresAt:Date.now()-1})")
    assert not response['response']['ok']
    response=page.evaluate("copyFixture('forbidden',{}, {id:'fixture',tab:{id:7},url:'https://chatgpt.com/'})")
    assert response.get('response') is None and not response['handled']
    response=page.evaluate("copyFixture('forbidden',{}, {id:'foreign',url:chrome.runtime.getURL('background.js')})")
    assert response.get('response') is None and not response['handled']
    assert page.evaluate('fixture.writes.length')==before
    ok('offscreen helper rejects expired jobs and direct content-script/foreign senders')
    assert not errors, errors
    page.close()

    # Actual panel markup/controller. Chrome messaging and OS writes are mocked;
    # click/key events, selections, temporary fields and DOM updates are real Chromium.
    page = browser.new_page(viewport={'width':750,'height':900})
    page.on('pageerror', lambda e: errors.append(str(e)))
    html = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', (ROOT/'index.html').read_text(), flags=re.I)
    page.set_content(html)
    page.evaluate('''() => {
        window.fixture={clientMessages:[],receivers:[],runtime:[],dialogs:[],clipboardWrites:[],
            nativeReject:false,legacyOK:false,offscreenOK:false,sendError:null,deferCopy:false,
            events:[],retryOnce:false};
        window.alert=message=>fixture.dialogs.push(message);window.confirm=()=>true;
        if(!crypto.randomUUID)crypto.randomUUID=()=> 'fixture_id_'+Date.now()+'_'+Math.random().toString(16).slice(2);
        const send=message=>fixture.receivers.forEach(fn=>fn(message));
        window.fixtureSend=send;
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){
            fixture.events.push('native');
            if(fixture.nativeReject)return Promise.reject(new DOMException('Document is not focused.','NotAllowedError'));
            if(fixture.deferCopy)return new Promise(resolve=>{fixture.releaseCopy=()=>{fixture.clipboardWrites.push(text);resolve()}});
            fixture.clipboardWrites.push(text);return Promise.resolve();
        }}});
        document.execCommand=command=>{
            fixture.events.push('legacy');
            if(!fixture.legacyOK)return false;
            const event=new ClipboardEvent('copy',{clipboardData:new DataTransfer(),cancelable:true,bubbles:true});
            document.activeElement.dispatchEvent(event);
            fixture.clipboardWrites.push(event.clipboardData.getData('text/plain'));
            return true;
        };
        window.chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,
        onMessage:{addListener(){},removeListener(){}},
        connect:()=>({
            onMessage:{addListener(fn){fixture.receivers.push(fn)}},onDisconnect:{addListener(){}},disconnect(){},
            postMessage(message){fixture.clientMessages.push(message);queueMicrotask(()=>{
                send({type:'SNAPSHOT_START',epoch:0,version:0});
                send({type:'SNAPSHOT_PAGE',speakers:['Alice'],chats:[
                    {ticId:'first',content:'First row',role:'Alice',revision:1},
                    {ticId:'second',content:'Second row',role:'Alice',revision:1}]});
                send({type:'SNAPSHOT_END',epoch:0,version:0});
            })}
        }),sendMessage(message,callback){
            fixture.runtime.push(structuredClone(message));
            if(message.type==='COPY_CHATGPT_PAYLOAD') {
                fixture.events.push('offscreen');
                if(fixture.offscreenOK)fixture.clipboardWrites.push(message.text);
                callback({ok:fixture.offscreenOK,method:'offscreen',code:'copy_command_failed'});
            } else if(message.type==='SEND_CHAT_GPT') {
                fixture.events.push('send');
                if(fixture.retryOnce){fixture.retryOnce=false;chrome.runtime.lastError={message:'Channel lost'};callback();delete chrome.runtime.lastError;return;}
                if(fixture.sendError){callback({status:'Error',error:fixture.sendError});return;}
                callback({jobId:message.requestId,job:{status:'succeeded',clipboard:message.clipboard}});
            } else if(message.type==='CLEAR_TRANSCRIPT'){
                send({type:'TRANSCRIPT_CLEARED',epoch:1,version:20});
                send({type:'CHAT_PATCH_UPDATE',epoch:1,version:21,changes:[{ticId:'new',content:'New after clear',role:'Alice',revision:1}],removals:[],speakers:['Alice']});
                callback({status:'Transcript cleared',cleared:true,epoch:1,version:20});
            } else callback({status:'ok'});
        }}};
    }''')
    for file in ['gptPrompts.js','shared/PromptBuilder.js','shared/ClipboardWriter.js','popup.js']:
        page.add_script_tag(path=str(ROOT/file))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_function("document.querySelectorAll('.chatMessage').length === 2")
    assert page.locator('#statusText').evaluate("e=>getComputedStyle(e).display")=='none'
    ok('same panel layout, hidden status line and original controls initialize normally')

    page.evaluate('''() => {
        window.firstNode=document.querySelector('.chatMessage');
        window.moves=0;window.watch=new MutationObserver(ms=>{for(const m of ms)moves+=m.addedNodes.length+m.removedNodes.length});
        watch.observe(document.querySelector('#chatList'),{childList:true});
        fixtureSend({type:'CHAT_PATCH_UPDATE',epoch:0,version:1,changes:[{ticId:'first',content:'First revised',role:'Alice',revision:2}],removals:[],speakers:['Alice']});
    }''')
    assert page.evaluate("firstNode===document.querySelector('.chatMessage') && moves===0")
    assert page.locator('.chatBubble').first.text_content() == 'First revised'
    ok('incremental transcript updates do not rebuild or move existing rows')

    page.locator('.chatMessage').first.click()
    page.locator('.chatMessage').last.click(button='right')
    page.wait_for_function("fixture.runtime.some(m=>m.type==='SEND_CHAT_GPT')")
    sent = page.evaluate("fixture.runtime.find(m=>m.type==='SEND_CHAT_GPT')")
    assert sent['payloadVersion']==1 and sent['requestId']
    assert sent['finalText']==page.evaluate("TECH_INT_GPT_PROMPTS.conversation.normal + 'First revised Second row'")
    assert sent['finalText']==page.evaluate('fixture.clipboardWrites.at(-1)')
    assert page.evaluate('fixture.events')==['native','send']
    assert not page.evaluate('fixture.runtime.some(m=>m.type==="COPY_CHATGPT_PAYLOAD")')
    assert page.evaluate('fixture.dialogs')==[]
    ok('left/right-click sends the selected range; native copy precedes the first send message')
    ok('clipboard and outgoing finalText are identical, with no background clipboard round-trip')

    for key,kind in [('F8','detail'),('F9','technical'),('F10','star')]:
        before=page.evaluate('fixture.clipboardWrites.length')
        page.keyboard.press(key)
        page.wait_for_function('(n)=>fixture.clipboardWrites.length===n+1',arg=before)
        assert page.evaluate(f'fixture.clipboardWrites.at(-1)===TECH_INT_GPT_PROMPTS.followUp.{kind}')
        assert page.evaluate('fixture.runtime.filter(m=>m.type==="SEND_CHAT_GPT").at(-1).finalText===fixture.clipboardWrites.at(-1)')
    ok('panel F8/F9/F10 copy and send the exact shared follow-up prompts')

    before=page.evaluate('fixture.clipboardWrites.length')
    page.locator('#train').click()
    page.wait_for_function('(n)=>fixture.clipboardWrites.length===n+1',arg=before)
    assert 'Above content is the full transcript' in page.evaluate('fixture.clipboardWrites.at(-1)')
    assert page.evaluate('fixture.runtime.filter(m=>m.type==="SEND_CHAT_GPT").at(-1).finalText===fixture.clipboardWrites.at(-1)')
    ok('full-transcript analysis is copied verbatim before submission')

    # Missing ChatGPT still results in successful local clipboard text.
    before=page.evaluate('fixture.clipboardWrites.length')
    page.evaluate("fixture.sendError='No ChatGPT tab found. Open chatgpt.com first.';fixture.dialogs=[]")
    page.keyboard.press('F8')
    page.wait_for_function("document.querySelector('#statusText').textContent.includes('Follow-up failed')")
    assert page.evaluate('fixture.clipboardWrites.length')==before+1
    assert page.evaluate('fixture.dialogs')==[]
    ok('missing ChatGPT tab no longer prevents copying and does not open a blocking alert')
    page.evaluate('fixture.sendError=null;fixture.dialogs=[]')

    # Rejected modern API: local legacy fallback runs without offscreen round-trip.
    page.evaluate('fixture.nativeReject=true;fixture.legacyOK=true;fixture.events=[];document.querySelector("#download").focus()')
    page.keyboard.press('F9')
    page.wait_for_function('fixture.events.includes("send")')
    assert page.evaluate('fixture.events')==['native','legacy','send']
    assert page.evaluate('fixture.runtime.filter(m=>m.type==="SEND_CHAT_GPT").at(-1).clipboard.api')=='execCommand'
    assert page.evaluate('fixture.clipboardWrites.at(-1)')==page.evaluate('TECH_INT_GPT_PROMPTS.followUp.technical')
    assert page.locator('textarea').count()==0
    assert page.evaluate('document.activeElement.id')=='download'
    assert page.evaluate('fixture.dialogs')==[]
    ok('native rejection now uses the local fallback, preserves exact text, and restores focus')

    # A usable offscreen fallback is still available, but not required on the happy path.
    page.evaluate('fixture.legacyOK=false;fixture.offscreenOK=true;fixture.events=[]')
    page.keyboard.press('F10')
    page.wait_for_function('fixture.events.includes("send")')
    assert page.evaluate('fixture.events')==['native','legacy','offscreen','send']
    assert page.evaluate('fixture.runtime.filter(m=>m.type==="SEND_CHAT_GPT").at(-1).clipboard.method')=='offscreen'
    ok('offscreen fallback is used only after both local clipboard methods fail')

    page.evaluate('fixture.offscreenOK=false;fixture.events=[];fixture.dialogs=[]')
    page.keyboard.press('F8')
    page.wait_for_function("document.querySelector('#statusText').textContent.includes('clipboard copy failed')")
    assert page.evaluate('fixture.events')==['native','legacy','offscreen','send']
    assert page.evaluate('fixture.dialogs')==[]
    ok('clipboard failure still sends once and no blocking alert is opened')

    # Copy in progress while live transcript revisions arrive: freeze what was clicked.
    page.evaluate('fixture.nativeReject=false;fixture.deferCopy=true;fixture.events=[];fixture.dialogs=[]')
    page.locator('.chatMessage').first.click()
    page.locator('.chatMessage').last.click(button='right',modifiers=['Control'])
    page.wait_for_function('typeof fixture.releaseCopy==="function"')
    assert page.evaluate('fixture.events')==['native']
    page.evaluate('''() => {
        fixtureSend({type:'CHAT_PATCH_UPDATE',epoch:0,version:2,
            changes:[{ticId:'first',content:'Changed AFTER click',role:'Alice',revision:3}],removals:[],speakers:['Alice']});
        fixture.releaseCopy();fixture.deferCopy=false;
    }''')
    page.wait_for_function('fixture.events.includes("send")')
    expected=page.evaluate("TECH_INT_GPT_PROMPTS.conversation.detail + 'First revised Second row'")
    assert page.evaluate('fixture.clipboardWrites.at(-1)')==expected
    assert page.evaluate('fixture.runtime.filter(m=>m.type==="SEND_CHAT_GPT").at(-1).finalText')==expected
    ok('live caption revisions during copying cannot change the frozen submitted payload')

    # Transport retries are send-only; do not recopy, rebuild, or assign a new request ID.
    before=page.evaluate('fixture.clipboardWrites.length')
    page.evaluate('fixture.events=[];fixture.retryOnce=true')
    page.keyboard.press('F9')
    page.wait_for_function('fixture.events.filter(x=>x==="send").length===2')
    attempts=page.evaluate('fixture.runtime.filter(m=>m.type==="SEND_CHAT_GPT").slice(-2)')
    assert attempts[0]==attempts[1]
    assert page.evaluate('fixture.clipboardWrites.length')==before+1
    assert page.evaluate('fixture.events')==['native','send','send']
    ok('send transport retries reuse the same payload/identity without a second clipboard write')

    page.locator('#clearTranscript').click()
    page.wait_for_function("document.querySelector('.chatBubble')?.textContent==='New after clear'")
    assert page.locator('.chatMessage').count()==1
    ok('late Clear response cannot erase newer post-clear panel updates')
    assert not errors, errors
    ok('no uncaught JavaScript errors across the DOM regression suite')
    version=browser.version
    browser.close()

report={'release':'2.1.5','browser':version,'passed':len(passed),'tests':passed,
        'scope':'Real Chromium DOM, clicks and keys; mocked Chrome messages and OS clipboard; no actual extension load, IndexedDB, MV3 suspension, or authenticated external sites'}
if args.report:Path(args.report).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
