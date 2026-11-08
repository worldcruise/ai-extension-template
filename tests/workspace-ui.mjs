import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkWorkspaceUI({ cdp, panel, read, click, frameSession, evaluate, artifacts, until }) {
  const text = selector => read(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const value = selector => read(`document.querySelector(${JSON.stringify(selector)}).value`);
  const setValue = (selector, value, event = 'change') => read(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  })()`);
  const closeDialog = id => click(`#${id} [data-close-dialog]`);
  await mkdir(artifacts, { recursive: true });
  async function screenshot(name) {
    await cdp.send('Page.bringToFront', {}, panel);
    // Let the browser paint after scrolling, view switches, or media changes.
    await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, panel);
    await writeFile(join(artifacts, name), Buffer.from(shot.data, 'base64'));
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, panel);
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'false');
  assert.equal(await read('document.querySelector(".studio-footer").getClientRects().length'), 0);
  assert.equal(await read('getComputedStyle(document.querySelector(".chat-toolbar-handle")).visibility'), 'visible');
  assert.equal(await read('document.querySelectorAll(".chat-toolbar-handle svg").length'), 1);
  await screenshot('workspace-chat-collapsed.png');
  const chatBounds = await read('(() => { const rect=document.getElementById("chat-view").getBoundingClientRect(); return {x:rect.x,y:rect.y,width:rect.width,height:rect.height}; })()');
  const iframeHeight = await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y + 3 }, panel);
  await until(() => read('document.getElementById("chat-toolbar-shell").dataset.open === "true" && getComputedStyle(document.getElementById("chat-toolbar")).opacity === "1"'), 'hover toolbar reveal');
  assert.equal(await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height'), iframeHeight);
  assert.equal(await read('document.getElementById("zoom-in").getBoundingClientRect().right <= document.getElementById("zoom-out").getBoundingClientRect().left && document.getElementById("zoom-out").getBoundingClientRect().right <= document.getElementById("new-chat").getBoundingClientRect().left'), true);
  const textMetrics = () => evaluate(frameSession, `(() => {
    const font = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
    return { heading:font('h1'), copy:font('main p'), composer:font('#prompt-textarea'),
      rootFont:font('html'), pageZoom:getComputedStyle(document.documentElement).zoom,
      viewportWidth:innerWidth, viewportHeight:innerHeight,
      padding:getComputedStyle(document.querySelector('main')).padding,
      border:getComputedStyle(document.querySelector('form')).borderRadius };
  })()`);
  const nativeText = await textMetrics();
  const frameSize = () => read('(() => { const rect=document.getElementById("chatgpt-frame").getBoundingClientRect(); return {width:rect.width,height:rect.height}; })()');
  const nativeFrame = await frameSize();
  const nativeToolbarFont = await read('getComputedStyle(document.getElementById("company-chat-toggle")).fontSize');
  async function expectTextSize(percent) {
    await until(async () => {
      const actual = await textMetrics();
      return ['heading','copy','composer'].every(key => Math.abs(actual[key] - nativeText[key] * percent / 100) < .02);
    }, `chat fonts at ${percent}%`);
    const actual = await textMetrics();
    for (const key of ['rootFont','pageZoom','viewportWidth','viewportHeight','padding','border']) {
      assert.equal(actual[key], nativeText[key], `${key} stays fixed at ${percent}%`);
    }
    assert.deepEqual(await frameSize(), nativeFrame);
    assert.equal(await read('getComputedStyle(document.getElementById("company-chat-toggle")).fontSize'), nativeToolbarFont);
  }
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value = "Zoom preserves my draft"');
  await click('#zoom-in');
  await expectTextSize(110);
  assert.match(await text('#chat-zoom-status'), /110%/);
  await evaluate(frameSession, `(() => {
    const answer=document.createElement('p'); answer.id='streamed-answer'; answer.style.fontSize='18px';
    answer.append(document.createTextNode('A new response '));
    const emphasis=document.createElement('strong'); emphasis.style.fontSize='.8em'; emphasis.textContent='with nested text';
    answer.append(emphasis); document.querySelector('main').append(answer);
  })()`);
  await until(async () => await evaluate(frameSession, 'Math.abs(parseFloat(getComputedStyle(document.getElementById("streamed-answer")).fontSize)-19.8)<.02 && Math.abs(parseFloat(getComputedStyle(document.querySelector("#streamed-answer strong")).fontSize)-15.84)<.02'), 'new and nested message fonts scale once');
  await click('#zoom-out');
  await expectTextSize(100);
  await read('for(let step=0;step<8;step++) document.getElementById("zoom-in").click()');
  await expectTextSize(150);
  await screenshot('workspace-chat-text-large.png');
  assert.equal(await read('document.getElementById("zoom-in").disabled'), true);
  await read('for(let step=0;step<12;step++) document.getElementById("zoom-out").click()');
  await expectTextSize(50);
  assert.equal(await read('document.getElementById("zoom-out").disabled'), true);
  await read('for(let step=0;step<5;step++) document.getElementById("zoom-in").click()');
  await expectTextSize(100);
  await evaluate(frameSession, 'document.getElementById("streamed-answer").remove()');
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Zoom preserves my draft');
  assert.equal(await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height'), iframeHeight);
  await screenshot('workspace-chat-expanded.png');
  const pickerBounds = await read('(() => { const rect=document.getElementById("company-chat-toggle").getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pickerBounds.x, y: pickerBounds.y }, panel);
  await until(() => read('!document.getElementById("company-chat-menu").hidden'), 'saved-chat hover dropdown');
  assert.equal(await read('document.querySelectorAll("#company-chat-list button").length'), 0);
  assert.match(await text('#company-chat-status'), /No connected company chats/);
  assert.equal(await evaluate(frameSession, 'document.getElementById("history").childElementCount'), 0);
  await click('#studio-tab');
  await click('[data-request-id="1"] [data-action="review"]');
  assert.equal(await read('document.getElementById("request-connect-chat").disabled'), true);
  assert.equal(await read('document.getElementById("request-open-chat").disabled'), true);
  await closeDialog('request-dialog');
  await evaluate(frameSession, 'history.pushState({}, "", "/c/company-northstar"); dispatchEvent(new PopStateEvent("popstate"))');
  await click('[data-request-id="1"] [data-action="review"]');
  assert.equal(await read('document.getElementById("request-connect-chat").disabled'), false);
  await click('#request-connect-chat');
  assert.match(await text('#request-source-note'), /Connected chat.*Northstar/);
  await closeDialog('request-dialog');
  await evaluate(frameSession, 'history.pushState({}, "", "/c/company-aster"); dispatchEvent(new PopStateEvent("popstate"))');
  await click('[data-request-id="2"] [data-action="review"]');
  await click('#request-connect-chat');
  await closeDialog('request-dialog');
  await click('#chat-tab');
  await read('document.getElementById("chat-toolbar-reveal").focus()');
  await click('#company-chat-toggle');
  assert.equal(await read('document.querySelectorAll("#company-chat-list button").length'), 2);
  assert.deepEqual(await read('[...document.querySelectorAll("#company-chat-list strong")].map(node => node.textContent)'), ['Northstar', 'Aster Labs']);
  assert.equal(await read('document.querySelectorAll("#company-chat-list img, #company-chat-list script").length'), 0);
  await until(() => read('getComputedStyle(document.getElementById("chat-toolbar")).opacity === "1"'), 'company picker fully revealed');
  const chatScroll = await read('({window:scrollY,body:document.body.scrollTop,view:document.getElementById("chat-view").scrollTop,headerTop:document.querySelector(".toolbar").getBoundingClientRect().top})');
  assert.deepEqual(chatScroll, {window:0,body:0,view:0,headerTop:0});
  await screenshot('workspace-company-chats.png');
  await setValue('#company-chat-search', 'Northstar', 'input');
  assert.equal(await read('document.querySelectorAll("#company-chat-list button").length'), 1);
  await click('#company-chat-refresh');
  assert.equal(await read('document.querySelectorAll("#company-chat-list button").length'), 1);
  await click('#company-chat-list button');
  await until(() => read('document.getElementById("chatgpt-frame").src === "https://chatgpt.com/c/company-northstar" && document.getElementById("connection").dataset.state === "ready"'), 'company source conversation navigation');
  assert.equal(await text('#company-chat-label'), 'Northstar');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y + 180 }, panel);
  await until(() => read('document.getElementById("chat-toolbar-shell").dataset.open === "false"'), 'toolbar hides away from top edge');
  assert.equal(await read('getComputedStyle(document.querySelector(".chat-toolbar-handle")).visibility'), 'visible');
  await read('document.getElementById("chat-toolbar-reveal").focus()');
  assert.equal(await read('document.getElementById("chat-toolbar").inert'), false);
  await click('#company-chat-toggle');
  await setValue('#company-chat-search', 'Unknown company', 'input');
  assert.match(await text('#company-chat-status'), /No companies match/);
  await click('#company-chat-toggle');
  const sourceWindow = await read('chrome.windows.getCurrent().then(window => window.id)');
  await cdp.send('Target.createTarget', { url: 'about:blank#job-two' });
  await cdp.send('Target.createTarget', { url: 'about:blank#job-three' });
  const sourceTabs = () => read(`chrome.tabs.query({windowId:${sourceWindow}}).then(tabs => tabs.filter(tab => !tab.url?.startsWith(chrome.runtime.getURL(''))).sort((a,b) => a.index-b.index).map(tab => ({id:tab.id,active:tab.active})))`);
  const activeSource = async () => (await sourceTabs()).find(tab => tab.active)?.id;
  await until(async () => Number((await text('#job-position')).split('/')[1]) === (await sourceTabs()).length, 'open-tab count');
  await read('globalThis.originalChatFrame = document.getElementById("chatgpt-frame")');
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value = "Keep this ChatGPT draft"');
  await click('#studio-tab');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 3);
  await screenshot('workspace-queue.png');

  await click('[data-request-id="3"] [data-action="retry-save"]');
  assert.equal(await read('document.querySelectorAll(".state-pill[data-state=ready]").length'), 3);
  assert.match(await text('#workspace-status'), /No generation was started/);
  await click('[data-request-id="1"] [data-action="review"]');
  assert.equal(await read('document.getElementById("request-dialog").open'), true);
  assert.match(await text('#request-metadata'), /Morgan Taylor/);
  assert.equal(Object.keys(JSON.parse(await text('#request-output'))).length, 6);
  await screenshot('workspace-request.png');
  await click('#request-open-chat');
  assert.equal(await read('document.getElementById("chat-view").hidden'), false);
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft');
  await click('#studio-tab');
  await click('[data-request-id="1"] [data-action="review"]');
  await cdp.send('Page.bringToFront', {}, panel);
  await read('document.querySelector("#request-dialog [data-close-dialog]").focus()');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  assert.equal(await read('document.getElementById("request-dialog").open'), false);

  await click('[data-request-id="1"] [data-action="preview"]');
  assert.match(await text('#resume-paper'), /Morgan Taylor/);
  assert.match(await text('#resume-paper'), /Education/);
  await screenshot('workspace-resume.png');
  await read('Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { globalThis.copiedResume = value; } } })');
  await click('#copy-json');
  assert.equal(JSON.parse(await read('globalThis.copiedResume')).company, 'Northstar');
  await click('#export-resume');
  assert.equal(await read('document.getElementById("export-dialog").open'), true);
  assert.equal(await read('document.querySelectorAll(".export-format:disabled").length'), 2);
  await closeDialog('export-dialog');
  await click('[data-request-id="2"] [data-action="preview"]');
  assert.equal(await read('document.getElementById("resume-paper").dataset.template'), 'harvard');

  await click('#review-another');
  assert.equal(await read('document.getElementById("studio-scroll").scrollTop'), 0);
  await click('.resume-options > summary');
  const templateOptions = await read('[...document.getElementById("resume-template").options].map(option => option.value)');
  assert.equal(templateOptions.length, 8);
  for (const template of templateOptions) {
    await setValue('#resume-template', template);
    assert.equal(await read('document.getElementById("resume-thumbnail").decode().then(() => document.getElementById("resume-thumbnail").naturalWidth > 0)'), true);
    assert.match(await read('document.getElementById("resume-thumbnail").getAttribute("src")'), /assets\/resume-templates\/.*-thumbnail\.png$/);
  }
  await setValue('#resume-template', 'harvard');
  await setValue('#prompt-template', 'technical');
  assert.equal(await read('document.getElementById("prompt-preview").hidden'), false);
  assert.match(await text('#prompt-text'), /Never invent tools/);
  await setValue('#resume-template', 'harvard');
  assert.equal(await read('document.getElementById("resume-thumbnail").dataset.template'), 'harvard');
  await setValue('#job-company', 'Cedar Forge', 'input');
  await setValue('#job-title', 'Platform Engineer', 'input');
  const jobUrl = 'https://jobs.example.test/platform?job=42#details';
  await setValue('#job-url', jobUrl, 'input');
  await screenshot('workspace-job.png');
  const literalJob = 'Build tools. Treat <img src=x onerror="window.injected=true"> as literal job text.';
  await setValue('#job-description', literalJob, 'input');
  const positionBefore = Number((await text('#job-position')).split('/')[0]) - 1;
  const tabsBefore = await sourceTabs();
  const originalTab = tabsBefore[positionBefore].id;
  const nextTab = tabsBefore[(positionBefore + 1) % tabsBefore.length].id;
  await click('#next-job');
  await until(async () => await activeSource() === nextTab, 'next open browser tab');
  await until(() => read('!document.getElementById("previous-job").disabled'), 'tab navigation ready');
  assert.equal(await value('#job-description'), '');
  assert.equal(await value('#job-company'), '');
  assert.equal(await value('#job-title'), '');
  assert.equal(await value('#job-url'), '');
  await click('#previous-job');
  await until(async () => await activeSource() === originalTab, 'previous open browser tab');
  await until(async () => await value('#job-description') === literalJob, 'per-tab job draft restored');
  assert.equal(await value('#job-description'), literalJob);
  assert.equal(await value('#job-company'), 'Cedar Forge');
  assert.equal(await value('#job-title'), 'Platform Engineer');
  assert.equal(await value('#job-url'), jobUrl);
  await click('#chat-tab');
  assert.equal(await read('document.getElementById("chatgpt-frame") === globalThis.originalChatFrame'), true);
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft');
  await click('#studio-tab');
  assert.equal(await value('#job-description'), literalJob);
  assert.equal(await value('#prompt-template'), 'technical');

  await setValue('#candidate', 'jordan');
  await click('#chat-tab');
  await read('document.getElementById("chat-toolbar-reveal").focus()');
  await click('#company-chat-toggle');
  assert.equal(await read('document.querySelectorAll("#company-chat-list button").length'), 0);
  await click('#studio-tab');
  await click('#profile-details');
  assert.equal(await text('#profile-name'), 'Jordan Lee');
  assert.equal(await read('document.querySelector("#profile-dialog button:disabled") !== null'), true);
  await closeDialog('profile-dialog');
  await click('#view-queue');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 0);
  assert.equal(await read('document.getElementById("empty-queue").hidden'), false);
  await click('#empty-prepare');
  await click('#add-request');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 1);
  assert.match(await text('[data-request-id="4"]'), /Queued/);
  await click('[data-request-id="4"] [data-action="review"]');
  assert.equal(await text('#request-job'), literalJob);
  assert.match(await text('#request-dialog-title'), /Cedar Forge/);
  assert.match(await text('#request-metadata'), /Platform Engineer/);
  assert.equal(await read(`document.getElementById('request-metadata').textContent.includes(${JSON.stringify(jobUrl)})`), true);
  assert.equal(await read('document.querySelectorAll("#request-dialog img, #request-dialog script").length'), 0);
  assert.equal(await read('globalThis.injected'), undefined);
  await closeDialog('request-dialog');
  await click('#review-another');
  await setValue('#job-description', 'Changed after queueing', 'input');
  await click('#view-queue');
  await click('[data-request-id="4"] [data-action="review"]');
  assert.equal(await text('#request-job'), literalJob);
  await closeDialog('request-dialog');
  await click('[data-request-id="4"] [data-action="cancel"]');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 0);
  await click('#pause-queue');
  assert.equal(await read('document.getElementById("pause-queue").getAttribute("aria-pressed")'), 'true');
  await click('#pause-queue');
  await click('#review-another');
  await click('#tailor');
  assert.equal(await read('document.getElementById("job-context").hidden'), false);
  assert.equal(await read('document.getElementById("job-description").getClientRects().length > 0 && document.getElementById("read-page").getClientRects().length > 0'), true);
  assert.equal(await text('.job-description-field > span'), 'Job Description');
  assert.equal(await read('document.getElementById("prompt-template-field").hidden'), true);
  assert.equal(await read('document.getElementById("prompt-template").disabled'), true);
  assert.equal(await read('document.getElementById("resume-thumbnail").hidden'), false);
  await screenshot('workspace-base-resume.png');
  await click('#tailor');
  assert.equal(await read('document.getElementById("prompt-template-field").hidden'), false);
  assert.equal(await value('#prompt-template'), 'technical');
  await click('#tailor');
  await setValue('#job-description', '', 'input');
  await click('#add-request');
  await click('[data-request-id="5"] [data-action="review"]');
  assert.match(await text('#request-metadata'), /Base resume/);
  assert.match(await text('#request-prompt'), /without tailoring to a job/);
  await closeDialog('request-dialog');

  await click('#review-another');
  await click('#profile-details');
  await click('#reset-examples');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 3);
  await click('#account-toggle');
  await click('#account-settings');
  assert.equal(await read('document.getElementById("settings-view").hidden'), false);
  assert.equal(await read('document.getElementById("keyword-settings-tab").getAttribute("aria-selected")'), 'true');
  await until(() => read('!document.getElementById("keyword-settings-form").inert'), 'keyword settings loaded');
  await setValue('#keyword-list', 'React\nC++\nSQL\nmachine learning\n<img src=x onerror=alert(1)>', 'input');
  await setValue('#keyword-color', '#b7e4ca', 'input');
  await click('#keyword-enabled');
  await click('#keyword-save');
  await until(async () => (await text('#keyword-save-status')).includes('saved on this device'), 'keyword settings saved');
  assert.equal(await read('chrome.storage.local.get("keywordHighlights").then(data => data.keywordHighlights.keywords.length)'), 5);
  assert.equal(await read('document.querySelectorAll("#keyword-settings-panel img, #keyword-settings-panel mark").length'), 0);
  await screenshot('workspace-keyword-settings.png');
  for (const width of [280,390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    assert.equal(await read('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".settings-scroll").scrollWidth <= document.querySelector(".settings-scroll").clientWidth'), true);
  }
  await click('#settings-back');
  await click('#review-another');
  await setValue('#job-description', 'React and SQL should stay plain in the dock.', 'input');
  assert.equal(await read('document.getElementById("highlight-keywords").checked'), true);
  assert.equal(await read('document.getElementById("keyword-page-status")'), null);
  assert.equal(await read('CSS.highlights.has("ai-agent-job-keywords")'), false);
  assert.equal(await value('#job-description'), 'React and SQL should stay plain in the dock.');
  assert.equal(await evaluate(frameSession, 'CSS.highlights.has("ai-agent-job-keywords")'), false);
  await click('#highlight-keywords');
  await until(() => read('chrome.storage.local.get("keywordHighlights").then(data => !data.keywordHighlights.enabled)'), 'keyword highlighting disabled');
  await click('#highlight-keywords');
  await until(() => read('chrome.storage.local.get("keywordHighlights").then(data => data.keywordHighlights.enabled)'), 'keyword highlighting enabled');
  await click('#account-toggle');
  await click('#account-settings');
  assert.match(await value('#keyword-list'), /machine learning/);
  assert.equal(await value('#keyword-color'), '#b7e4ca');
  await click('#settings-back');
  await click('#account-toggle');
  assert.equal(await read('document.getElementById("account-panel").hidden'), false);
  await click('#account-chat');
  assert.equal(await read('document.getElementById("account-panel").hidden'), true);
  assert.equal(await read('document.getElementById("chat-view").hidden'), false);
  await read('document.getElementById("chat-tab").focus()');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, panel);
  assert.equal(await read('document.getElementById("studio-tab").getAttribute("aria-selected")'), 'true');
  assert.equal(await read('document.activeElement.id'), 'studio-tab');

  const layouts = [];
  for (const width of [280, 360, 390, 480, 800]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    for (const view of ['results', 'job']) {
      await click(view === 'results' ? '#results-tab' : '#job-tab');
      const layout = await read(`({ width: innerWidth, view: ${JSON.stringify(view)},
        noOverflow: document.documentElement.scrollWidth <= innerWidth && document.getElementById('studio-scroll').scrollWidth <= document.getElementById('studio-scroll').clientWidth,
        scrollHeight: document.getElementById('studio-scroll').clientHeight,
        footerVisible: document.querySelector('.studio-footer').getBoundingClientRect().bottom <= innerHeight,
        actionsVisible: ${JSON.stringify(view)} !== 'job' || ['add-request','view-queue'].every(id => {
          const bounds=document.getElementById(id).getBoundingClientRect(); return bounds.top>=0 && bounds.bottom<=innerHeight;
        }) })`);
      assert.equal(layout.noOverflow, true, `${view} at ${width}px`);
      assert.equal(layout.footerVisible, true);
      assert.equal(layout.actionsVisible, true);
      assert.ok(layout.scrollHeight > 350);
      assert.equal(await read('document.querySelector(".studio-footer").getBoundingClientRect().height <= 90 && document.querySelector(".queue-bar").getBoundingClientRect().height <= 34'), true, `compact footer at ${width}px`);
      assert.equal(await read('getComputedStyle(document.getElementById("workspace-status")).position'), 'absolute');
      if (view === 'job') {
        assert.equal(await read('(() => { const nav=document.querySelector(".tab-navigation").getBoundingClientRect(), read=document.getElementById("read-page").getBoundingClientRect(), tools=document.querySelector(".job-tools").getBoundingClientRect(), toggle=document.querySelector(".keyword-page-toggle").getBoundingClientRect(), company=document.getElementById("job-company").getBoundingClientRect(), role=document.getElementById("job-title").getBoundingClientRect(), url=document.getElementById("job-url").getBoundingClientRect(), jd=document.getElementById("job-description").getBoundingClientRect(); const padding=parseFloat(getComputedStyle(document.querySelector(".job-tools")).paddingRight); return nav.width<120 && toggle.left>=nav.right && read.left>=toggle.right && Math.abs(tools.right-padding-read.right)<1 && read.top<company.top && company.right<jd.left && role.top>company.top && role.right<jd.left && url.top>role.top && url.right<jd.left; })()'), true, `job field layout at ${width}px`);
      }
      layouts.push(layout);
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
  await click('#results-tab');
  await read('document.getElementById("studio-scroll").scrollTop = 0');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, panel);
  await screenshot('workspace-dark.png');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, panel);
  await click('#chat-tab');
  return { layouts, checks: ['combined workspace tabs', 'ChatGPT frame and draft retained', 'Studio form retained',
    'live open-tab navigation and per-tab drafts', 'hover toolbar reveal and dismissal without resizing chat',
    'text sizing preserves iframe size, viewport, layout spacing, and drafts', 'new and nested messages scale without compounding',
    'all eight baseline resume thumbnails load',
    'compact tab controls and side-by-side job fields', 'base resume keeps job extraction visible while hiding the prompt template',
    'keyword settings persistence and far-right Read page control', 'dock and ChatGPT never receive keyword highlights',
    'per-tab job URLs and immutable source URL snapshots', 'compact footer without visible status rows',
    'saved-company chat connection, search, and navigation', 'general ChatGPT history untouched', 'empty company-chat guidance',
    'Chat has no Studio footer', 'fixed Studio action buttons',
    'candidate isolation and empty state', 'template and prompt previews', 'immutable request snapshots', 'queued example cancellation',
    'save-retry example without generation', 'base resume example', 'resume preview and JSON copy', 'export availability',
    'literal job text rendering', 'account panel', 'dialog Escape and keyboard tabs', 'fixed controls and narrow layouts', 'light and dark themes'] };
}
