"""Focused Chromium regression for the v2.1.5 failures observed in live logs.
No authenticated ChatGPT is used; only real Chromium DOM/events with mocked extension messaging.
"""
import json, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
chromium = shutil.which('chromium') or shutil.which('google-chrome')
checks=[]

def setup_page(browser, *, no_ack=False, navigate=False, decoy=False, zero_width=False):
    page=browser.new_page()
    page.set_content('''<!doctype html><html><body>
      <div id="messages"></div>
      <form id="composer-form">
        <div id="prompt-textarea" contenteditable="true" role="textbox" class="ProseMirror" style="min-height:40px"><p><br></p></div>
        <button type="submit">Send</button>
      </form>
    </body></html>''')
    page.evaluate('''opts => {
      window.fixture={clicks:0,model:'',listeners:[]};
      window.chrome={runtime:{id:'fixture',onMessage:{addListener:fn=>fixture.listeners.push(fn)}}};
      window.invoke=message=>new Promise(resolve=>{for(const fn of fixture.listeners)fn(message,{id:'fixture'},resolve)});
      window.TechIntClipboard={copy:async()=>({ok:true,method:'content'})};
      const form=document.querySelector('form');
      const editor=document.querySelector('[contenteditable]');
      const button=document.querySelector('button');
      const render=()=>{editor.replaceChildren(Object.assign(document.createElement('p'),{textContent:fixture.model}));button.disabled=!fixture.model};
      editor.addEventListener('paste',e=>{e.preventDefault();fixture.model=e.clipboardData.getData('text/plain');render()});
      editor.addEventListener('input',()=>{fixture.model=editor.innerText;button.disabled=!fixture.model});
      form.addEventListener('submit',e=>e.preventDefault());
      button.onclick=()=>{
        fixture.clicks++;
        if(opts.navigate){ document.body.replaceChildren(); return; }
        if(!opts.noAck){fixture.model='';render();}
      };
      if(opts.decoy){
        editor.removeAttribute('id');
        const d=document.createElement('div');d.contentEditable='true';d.setAttribute('role','textbox');d.className='ProseMirror';
        d.textContent='x'.repeat(927);d.style.minHeight='30px';document.body.prepend(d);
      }
      if(opts.zeroWidth){editor.textContent='\\u200b'}
    }''', {'noAck':no_ack,'navigate':navigate,'decoy':decoy,'zeroWidth':zero_width})
    for file in ['gptPrompts.js','shared/PromptBuilder.js','adapters/ChatGPTAdapter.js','chatGPT.js']:
        page.add_script_tag(path=str(ROOT/file))
    return page

def send(page, text='Prepared payload', request='focused_request_01'):
    return page.evaluate('''async ({text,request}) => invoke({type:'to-chatgpt',requestId:request,payloadVersion:1,
      finalText:text,clipboard:{ok:true,method:'panel',api:'writeText'},aiMode:'conversation',state:1})''',
      {'text':text,'request':request})

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=chromium,headless=True,args=['--no-sandbox'])

    page=setup_page(browser,no_ack=True)
    result=send(page)
    assert result['status']=='Content sent',result
    assert page.evaluate('fixture.clicks')==1
    checks.append('post-click success does not wait for user-message/Stop-button acknowledgment DOM')
    page.close()

    page=setup_page(browser,navigate=True)
    result=send(page,request='focused_nav_01')
    assert result['status']=='Content sent',result
    assert page.evaluate('fixture.clicks')==1
    assert page.evaluate('document.body.children.length')==0
    checks.append('synchronous post-submit DOM teardown does not invalidate a verified Send click')
    page.close()

    page=setup_page(browser,decoy=True)
    result=send(page,'Exact form-local prompt','focused_decoy_01')
    assert result['status']=='Content sent',result
    assert page.evaluate('fixture.clicks')==1
    assert page.locator('body > .ProseMirror').inner_text()=='x'*927
    checks.append('form-local composer is chosen over a second visible 927-character ProseMirror')
    page.close()

    page=setup_page(browser,zero_width=True)
    result=send(page,'Zero-width empty composer','focused_zero_01')
    assert result['status']=='Content sent',result
    assert page.evaluate('fixture.clicks')==1
    checks.append('zero-width placeholder is treated as empty, not an existing draft')
    page.close()

    browser.close()

report={'release':'2.1.5','passed':len(checks),'checks':checks,
        'scope':'Focused real-Chromium DOM regression; extension messaging and authenticated ChatGPT are mocked.'}
Path('docs/v2.1.5-submit-regression.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
