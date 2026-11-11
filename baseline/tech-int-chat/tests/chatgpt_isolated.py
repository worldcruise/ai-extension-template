"""Real Chromium isolated-world DOM-event test; no actual extension installation.
Uses CDP to separate the adapter's JavaScript globals from the fixture application's globals.
No live ChatGPT, OS clipboard or framework-specific private API is used.
"""
import argparse,json,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--report');p.add_argument('--chromium',default=shutil.which('chromium'))
args=p.parse_args();checks=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<form><div id="prompt-textarea" contenteditable="true" style="white-space:pre-wrap;min-height:30px"></div><button type="button" data-testid="send-button" disabled>Send</button></form><div id="messages"></div>')
    page.evaluate('''() => {
        window.application={text:'',pastes:0,clicks:0};
        const editor=document.querySelector('[contenteditable]'),button=document.querySelector('button');
        editor.addEventListener('paste',event=>{
            event.preventDefault();application.pastes++;
            application.text=event.clipboardData.getData('text/plain');
            const p=document.createElement('p');p.textContent=application.text;editor.replaceChildren(p);button.disabled=false;
        });
        button.onclick=()=>{application.clicks++;const m=document.createElement('div');m.dataset.messageAuthorRole='user';
            m.textContent=application.text;document.querySelector('#messages').append(m);editor.replaceChildren();button.disabled=true;};
    }''')
    cdp=page.context.new_cdp_session(page)
    frame=cdp.send('Page.getFrameTree')['frameTree']['frame']['id']
    world=cdp.send('Page.createIsolatedWorld',{'frameId':frame,'worldName':'tech-int-chat-test'})['executionContextId']
    def evaluate(code,await_promise=False):
        r=cdp.send('Runtime.evaluate',{'expression':code,'contextId':world,'returnByValue':True,
            'awaitPromise':await_promise,'userGesture':False})
        assert 'exceptionDetails' not in r,r
        return r.get('result',{}).get('value')
    evaluate((ROOT/'adapters/ChatGPTAdapter.js').read_text())
    assert evaluate('typeof window.application')=='undefined'
    assert page.evaluate('typeof window.__techIntChatAdapterV2')=='undefined'
    checks.append('application and adapter globals are isolated while the DOM is shared')
    # Let transient activation from fixture initialization expire; evaluation adds no gesture.
    page.wait_for_timeout(5500)
    assert evaluate('navigator.userActivation.isActive') is False
    text='Complete normal prompt  ->  Selected transcript\nUnicode 🧪\nSecond line'
    result=evaluate('new __techIntChatAdapterV2.ChatGPTAdapter().send('+json.dumps(text)+',new AbortController().signal,{requestId:"isolated_request",source:"panel"})',True)
    assert result['status']=='Content sent' and result['diagnostics']['insertionMethod']=='paste_event',result
    assert page.evaluate('application.text')==text and page.evaluate('application.clicks')==1
    checks.append('isolated adapter invokes the page paste handler with the complete exact string, without transient activation')
    assert not result['diagnostics']['transientActivation']
    assert not errors,errors
    checks.append('success is acknowledged from shared DOM without private framework state access or console errors')
    report={'release':'2.1.5','browser':browser.version,'passed':len(checks),'checks':checks,
        'scope':'Real Chromium CDP isolated world, native synthetic paste event crossing worlds; fixture page handler, not live ChatGPT',
        'limitations':['No actual installed extension or native OS clipboard','No authenticated ChatGPT','No claim that focus or user activation caused the reported live failure']}
    browser.close()
if args.report:Path(args.report).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
