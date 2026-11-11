"""Real Chromium DOM/IndexedDB integration with a MOCKED Chrome extension API.
Does not log into Meet/ChatGPT and does not test actual MV3 process suspension.
Run: python tests/browser_smoke.py [--chromium /path/to/chromium]
Requires Python 3 + playwright; no test dependencies are shipped in the extension.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from functools import partial
import argparse, json, shutil, sys, time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

parser = argparse.ArgumentParser()
parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('google-chrome'))
parser.add_argument('--report')
args = parser.parse_args()
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
passed = []

def ok(name):
    passed.append(name)
    print('PASS:', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 750, 'height': 900}, accept_downloads=True)
    context.add_init_script(path=str(ROOT / 'tests/chrome-fixture.js'))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + '/index.html')
    page.wait_for_function("document.querySelector('#statusText').textContent === 'Transcript rows: 0'")
    ok('background bootstrap, sender checks, and empty panel snapshot')

    page.evaluate('''() => {
        const root = document.createElement('div'); root.className = 'iOzk7';
        root.innerHTML = '<div class="nMcdL bj4p3b"><span class="jxFHg">Alice</span><span class="ygicle VbkSUe">Hello world</span></div>';
        document.body.appendChild(root); fixture.stage = 'meeting';
    }''')
    page.add_script_tag(path=str(ROOT / 'meeting.js'))
    page.wait_for_function("document.querySelector('.chatBubble')?.textContent === 'Hello world'")
    ok('original Meet selectors extract a caption through storage into the unchanged panel')

    page.evaluate('''() => { fixture.delayPatchAck = 650;
        document.querySelector('.ygicle').textContent = 'Hello world revised once'; }''')
    page.wait_for_function("document.querySelector('.chatBubble').textContent === 'Hello world revised once'")
    page.evaluate("document.querySelector('.ygicle').textContent = 'Hello world revised twice'")
    page.wait_for_function("document.querySelector('.chatBubble').textContent === 'Hello world revised twice'")
    page.evaluate("fixture.delayPatchAck = 0")
    assert page.locator('.chatMessage').count() == 1
    ok('late acknowledgment does not discard a newer caption revision')

    page.evaluate('''() => {
        const node = document.querySelector('.chatMessage');
        window.preservedRow = node;
        window.rowMoves = 0;
        window.rowWatch = new MutationObserver(mutations => {
            for (const mutation of mutations) rowMoves += mutation.addedNodes.length + mutation.removedNodes.length;
        });
        rowWatch.observe(document.querySelector('#chatList'), { childList: true });
        document.querySelector('.ygicle').textContent = 'Hello world latest';
    }''')
    page.wait_for_function("document.querySelector('.chatBubble').textContent === 'Hello world latest'")
    assert page.evaluate("preservedRow === document.querySelector('.chatMessage') && rowMoves === 0")
    ok('one-row updates preserve DOM identity without rebuilding/moving the transcript list')

    # Force the SAME original splitting algorithm across a punctuation resegmentation.
    words = ' '.join(['word'] * 20)
    page.locator('.ygicle').evaluate('(node, value) => node.textContent = value', words + '? second part')
    page.wait_for_function("document.querySelectorAll('.chatMessage').length === 2")
    page.locator('.ygicle').evaluate('(node, value) => node.textContent = value', words + ' second part')
    page.wait_for_function("document.querySelectorAll('.chatMessage').length === 1")
    ok('live caption resegmentation removes stale chunk suffixes')

    # Dynamic container replacement must be discovered without the 10-second watchdog.
    page.evaluate('''() => {
        document.querySelector('.iOzk7').remove();
        const root = document.createElement('div'); root.className = 'iOzk7';
        root.innerHTML = '<div class="nMcdL bj4p3b"><span class="jxFHg">Bob</span><span class="ygicle VbkSUe">Replacement container</span></div>';
        document.body.appendChild(root);
    }''')
    page.wait_for_function("[...document.querySelectorAll('.chatBubble')].some(n => n.textContent === 'Replacement container')", timeout=4000)
    ok('caption container replacement reconnects capture via DOM events')

    page.locator('.chatMessage').first.click()
    first_id = page.locator('.chatMessage').first.get_attribute('ticId')
    # Set up a synthetic ChatGPT composer; product selectors/DOM behavior, not live service.
    page.evaluate('''() => {
        const area = document.createElement('div'); area.id = 'gpt-fixture';
        area.innerHTML = '<textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button><div id="messages"></div>';
        document.body.appendChild(area);
        area.querySelector('button').onclick = () => {
            fixture.submitted++;
            const message = document.createElement('div'); message.dataset.messageAuthorRole = 'user';
            message.textContent = area.querySelector('textarea').value;
            area.querySelector('#messages').appendChild(message);
            area.querySelector('textarea').value = '';
        };
        fixture.stage = 'gpt';
    }''')
    for file in ['gptPrompts.js', 'shared/PromptBuilder.js', 'shared/ClipboardWriter.js', 'adapters/ChatGPTAdapter.js', 'chatGPT.js']:
        page.add_script_tag(path=str(ROOT / file))
    page.locator('.chatMessage').last.click(button='right')
    page.wait_for_function("fixture.submitted === 1")
    page.wait_for_function("document.querySelector('#statusText').textContent === 'Content sent to ChatGPT'")
    assert page.evaluate("fixture.dialogs") == []
    ok('original left-click/right-click workflow submits exactly once through the durable job pipeline')

    # A new draft must remain intact, including failure propagation to the existing UI controller.
    page.locator('#prompt-textarea').fill('My unsent draft')
    page.keyboard.press('F8')
    page.wait_for_timeout(250)
    assert page.locator('#prompt-textarea').input_value() == 'My unsent draft'
    assert page.evaluate('fixture.submitted') == 1
    assert page.evaluate('fixture.dialogs') == []
    ok('unsent ChatGPT drafts are not overwritten and failure does not open a blocking alert')
    page.locator('#prompt-textarea').fill('')
    page.evaluate('fixture.dialogs = []')

    # Duplicate messages with an identical job ID, against real IndexedDB ledger.
    response = page.evaluate('''async () => {
        const message = { type: 'SEND_CHAT_GPT', requestId: 'browser_duplicate_123',
            state: 5, payloadVersion: 1, finalText: 'A unique duplicate-check prompt',
            clipboard: {ok:true,method:'panel'}, aiMode: 'conversation' };
        return Promise.all([chrome.runtime.sendMessage(message), chrome.runtime.sendMessage(message)]);
    }''')
    assert response[0]['jobId'] == response[1]['jobId']
    page.wait_for_function("fixture.submitted === 2")
    page.wait_for_function("async () => (await chrome.runtime.sendMessage({type:'GET_CHATGPT_JOB',jobId:'browser_duplicate_123'})).job.status === 'succeeded'")
    ok('duplicate runtime messages share one durable job and one composer click')

    # Page reload models fresh JS/module memory, while the browser-session token is retained.
    count = page.locator('.chatMessage').count()
    page.reload()
    page.wait_for_function('(count) => document.querySelectorAll(".chatMessage").length === count', arg=count)
    assert page.locator('.chatMessage').first.get_attribute('ticId') == first_id
    ok('fresh module initialization restores persisted chunks and stable row identities')

    with page.expect_download() as download:
        page.locator('#download').click()
    downloaded = Path(download.value.path()).read_text()
    assert 'INTERVIEWER:' in downloaded and 'Replacement container' in downloaded
    ok('original transcript download format still exports the restored history')

    # Privacy/mutation guard: arbitrary non-panel sender cannot clear.
    result = page.evaluate('''async () => new Promise(resolve => {
        const handler = fixture.listeners.message.find(item => item.stage === 'background').fn;
        handler({type:'CLEAR_TRANSCRIPT',epoch:0}, {id:chrome.runtime.id,url:'https://meet.google.com/abc',tab:{id:11}}, resolve);
    })''')
    assert result['status'] == 'Error'
    ok('content-script sender cannot clear transcript or invoke panel-only operations')

    # IndexedDB multi-page writes/reads and atomic rollback, using actual production classes.
    result = page.evaluate('''async () => {
        const { StorageService } = await import('./services/StorageService.js');
        const { TranscriptStore } = await import('./core/TranscriptStore.js');
        const token = (await chrome.storage.session.get('techIntChat.browserSession.v2'))['techIntChat.browserSession.v2'];
        const storage = await new StorageService().open(token);
        const model = new TranscriptStore();
        const meta = await storage.meta();
        const src = {tabId:22,instanceId:'test_bulk',sessionId:'22:test_bulk'};
        for(let batch=0;batch<20;batch++) {
            const data = {protocol:2,epoch:meta.epoch,patchId:'bulk_'+batch,groups:[]};
            for(let j=0;j<32;j++) data.groups.push({rawTicId:'bulk_'+(batch*32+j),revision:1,
                chunks:[{role:'Test',content:'Bulk row '+(batch*32+j)}]});
            const patch = model.normalizePatch(data,src);
            await storage.mutate(tx => model.apply(tx,patch));
        }
        let after=-1,rows=[];
        while(true) {const page = await storage.page(after);if(!page.length)break;rows.push(...page);after=page.at(-1).seq;}
        let rollback=false;
        try {await storage.mutate(async tx => {await tx.putRow({ticId:'rollback-id',seq:99999,content:'not committed'});throw new Error('intentional');});}
        catch {rollback = !(await storage.mutate(tx => tx.row('rollback-id')));}
        const tx = storage.db.transaction('chunks');
        const chunks = await new Promise((res,rej)=>{const r=tx.objectStore('chunks').count();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
        const version=(await storage.meta()).version;
        storage.db.close();
        const reopened = await new StorageService().open(token);
        const restored=(await reopened.meta()).version===version;
        reopened.db.close();
        return {count:rows.length, unique:new Set(rows.map(r=>r.ticId)).size, rollback, chunks,restored};
    }''')
    assert result['count'] == count + 640 and result['unique'] == result['count']
    assert result['chunks'] >= 5 and result['rollback'] and result['restored']
    ok('640-row multi-chunk write/pagination, durable reopen, and atomic rollback')

    # Force panel resubscription after the out-of-band storage test and then clear.
    page.reload()
    page.wait_for_function('(count)=>document.querySelectorAll(".chatMessage").length===count', arg=count+640)
    page.locator('#clearTranscript').click()
    page.wait_for_function("document.querySelectorAll('.chatMessage').length === 0")
    meta = page.evaluate("chrome.runtime.sendMessage({type:'GET_TRANSCRIPT_META'})")
    assert meta['rowCount'] == 0 and meta['epoch'] == 1
    result = page.evaluate('''async () => chrome.runtime.sendMessage({type:'CHAT_PATCH',data:{
        protocol:2,epoch:0,sourceInstanceId:'old_source',patchId:'old_patch',
        groups:[{rawTicId:'row',revision:1,chunks:[{role:'Alice',content:'Should not return'}]}]}})''')
    assert result['status'] == 'STALE_EPOCH'
    assert page.locator('.chatMessage').count() == 0
    ok('user Clear deletes durable chunks and blocks a delayed pre-clear patch')

    # A repeated Clear with an old epoch must not erase newly collected text.
    result = page.evaluate('''async () => {
        await chrome.runtime.sendMessage({type:'CHAT_PATCH',data:{protocol:2,epoch:1,sourceInstanceId:'new_source',patchId:'fresh_patch',
            groups:[{rawTicId:'row',revision:1,chunks:[{role:'Alice',content:'Keep new transcript'}]}]}});
        return chrome.runtime.sendMessage({type:'CLEAR_TRANSCRIPT',epoch:0});
    }''')
    assert result['cleared'] is False
    page.wait_for_function("document.querySelector('.chatBubble')?.textContent === 'Keep new transcript'")
    ok('stale/repeated Clear cannot delete new-generation transcript data')

    assert not errors, errors
    ok('no uncaught browser page errors across the fixture workflow')
    version = browser.version
    context.close(); browser.close()
server.shutdown()
report = {'browser': version, 'environment': 'Chromium with mocked Chrome extension API; real DOM and IndexedDB',
          'passed': len(passed), 'tests': passed,
          'not_tested': ['Live Google Meet', 'Live authenticated ChatGPT', 'Actual MV3 worker suspension', 'Chrome Web Store installation']}
if args.report:
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
