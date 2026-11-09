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
  async function shortcut(key, { inChat = false, repeat = false } = {}) {
    await cdp.send('Page.bringToFront', {}, panel);
    if (inChat) await evaluate(frameSession, 'document.getElementById("prompt-textarea").focus()');
    const codes = {ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Enter:13};
    const event = {key,code:key,modifiers:2,windowsVirtualKeyCode:codes[key]};
    await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',...event}, panel);
    if (repeat) await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',...event,autoRepeat:true}, panel);
    await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',...event}, panel);
  }
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
  assert.match(await text('#results-tab'), /^Job Queues/);
  await evaluate(frameSession, `globalThis.nativeCtrlEnterForTest = 0;
    document.getElementById('prompt-textarea').value = 'Keep my shortcut draft';
    document.getElementById('prompt-textarea').dispatchEvent(new Event('input',{bubbles:true}));
    document.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter') nativeCtrlEnterForTest++; });`);
  await shortcut('ArrowUp', {inChat:true});
  await until(() => read('!document.getElementById("studio-view").hidden'), 'Ctrl+Up from Chat opens Resume Studio');
  await shortcut('ArrowDown');
  await until(() => read('!document.getElementById("chat-view").hidden'), 'Ctrl+Down opens Chat');
  await shortcut('Enter', {inChat:true,repeat:true});
  await until(() => read('!document.getElementById("job-panel").hidden && document.getElementById("job-description").validationMessage.length > 0'), 'Ctrl+Enter brings invalid job fields into view');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 3, 'invalid job shortcuts do not create requests');
  assert.equal(await evaluate(frameSession, 'nativeCtrlEnterForTest'), 0, 'Ctrl+Enter does not reach ChatGPT send handlers');
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep my shortcut draft');
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value="";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await click('#results-tab');
  await shortcut('ArrowDown');
  const chatBounds = await read('(() => { const rect=document.getElementById("chat-view").getBoundingClientRect(); return {x:rect.x,y:rect.y,width:rect.width,height:rect.height}; })()');
  const iframeHeight = await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y + 3 }, panel);
  await until(() => read('document.getElementById("chat-toolbar-shell").dataset.open === "true" && getComputedStyle(document.getElementById("chat-toolbar")).opacity === "1"'), 'hover toolbar reveal');
  assert.equal(await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height'), iframeHeight);
  assert.equal(await read(`(() => {
    const ids = ['new-chat', 'reload', 'company-chat-search', 'chat-history-up', 'zoom-in', 'zoom-out', 'open-tab', 'chat-toolbar-pin'];
    const bounds = ids.map(id => document.getElementById(id).getBoundingClientRect());
    return bounds.every((rect, index) => !index || rect.left >= bounds[index - 1].right);
  })()`), true, 'new chat and refresh are on the left; pin is on the far right');
  assert.equal(await read(`(() => { const up=document.getElementById('chat-history-up').getBoundingClientRect(), down=document.getElementById('chat-history-down').getBoundingClientRect(); return up.left===down.left && up.bottom<=down.top; })()`), true, 'history arrows are stacked immediately beside the search');
  await until(() => read('!document.getElementById("chat-history-down").disabled'), 'native ChatGPT history loaded');
  assert.equal(await read('document.getElementById("chat-history-up").disabled'), true, 'new chat has no newer conversation');
  const path = () => evaluate(frameSession, 'location.pathname');
  async function historyStep(selector, expected) {
    await until(() => read(`!document.querySelector(${JSON.stringify(selector)}).disabled`), 'history control ready');
    await read(`(() => { const button=document.querySelector(${JSON.stringify(selector)}); button.click(); button.click(); })()`);
    await until(async () => await path() === expected, `history opens ${expected}`);
    await until(() => read('!document.getElementById("chat-history-up").title.includes("Loading")'), 'history navigation acknowledged by URL');
  }
  await historyStep('#chat-history-down','/c/saved-resume');
  assert.equal(await read('document.getElementById("chat-history-up").disabled'), true, 'most recent chat disables Up');
  await click('#chat-history-up');
  assert.equal(await path(), '/c/saved-resume', 'Up never wraps to a new chat');
  await historyStep('#chat-history-down','/c/saved-interview');
  await historyStep('#chat-history-up','/c/saved-resume');
  await historyStep('#chat-history-down','/c/saved-interview');
  await historyStep('#chat-history-down','/c/saved-literal');
  assert.equal(await read('document.getElementById("chat-history-down").disabled'), true, 'oldest loaded chat does not wrap');
  await historyStep('#chat-history-up','/c/saved-interview');
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value="Keep my history draft";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await click('#chat-history-down');
  await until(() => read('document.getElementById("chat-history-up").disabled && document.getElementById("chat-history-down").disabled'), 'draft blocks history navigation');
  assert.equal(await path(), '/c/saved-interview');
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep my history draft');
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value="";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true})); const stop=document.createElement("button");stop.id="history-stream-test";stop.dataset.testid="stop-button";stop.textContent="Stop generating";document.body.append(stop)');
  await until(() => read('document.getElementById("chat-history-down").title.includes("response")'), 'generation blocks history navigation');
  await evaluate(frameSession, 'document.getElementById("history-stream-test").remove()');
  await until(() => read('!document.getElementById("chat-history-up").disabled'), 'history navigation restored after generation');
  await historyStep('#chat-history-up','/c/saved-resume');
  await screenshot('workspace-chat-history.png');
  assert.equal(await evaluate(frameSession, 'document.getElementById("history").hidden'), true, 'native sidebar returns to its original closed state');
  await click('#new-chat');
  await until(async () => await path() === '/' && await read('document.getElementById("connection").dataset.state === "ready"'), 'new chat restored after history checks');
  await read('document.getElementById("chat-toolbar-reveal").focus()');
  await until(() => read('document.getElementById("chat-history-up").disabled && !document.getElementById("chat-history-down").disabled'), 'new-chat history boundaries restored');
  assert.equal(await read('document.getElementById("chat-toolbar-pin").getAttribute("aria-pressed")'), 'false');
  await click('#chat-toolbar-pin');
  await until(() => read('chrome.storage.local.get("chatToolbarPinned").then(data => data.chatToolbarPinned === true)'), 'toolbar pin preference saved');
  assert.equal(await read('document.getElementById("chat-toolbar-pin").getAttribute("aria-pressed")'), 'true');
  assert.equal(await read('document.getElementById("chat-toolbar-pin").title'), 'Unpin toolbar');
  await read('globalThis.frameBeforePinLayout = document.getElementById("chatgpt-frame")');
  for (const width of [280, 390, 800]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    const layout = await read(`(() => {
      const toolbar=document.getElementById('chat-toolbar').getBoundingClientRect();
      const frame=document.getElementById('chatgpt-frame').getBoundingClientRect();
      const view=document.getElementById('chat-view').getBoundingClientRect();
      return { noOverlap: Math.abs(frame.top-toolbar.bottom)<1, fullHeight: Math.abs(frame.bottom-view.bottom)<1,
        reserved: Math.abs(frame.height+toolbar.height-view.height)<1, widthFits: Math.abs(frame.width-view.width)<1,
        sameFrame: frameBeforePinLayout===document.getElementById('chatgpt-frame'), noOverflow: document.documentElement.scrollWidth<=innerWidth };
    })()`);
    assert.deepEqual(layout, {noOverlap:true,fullHeight:true,reserved:true,widthFits:true,sameFrame:true,noOverflow:true}, `pinned toolbar reserves its own row at ${width}px`);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
  // Move to the host header: CDP can leave a stale :hover chain when it moves
  // directly from a transformed overlay into a cross-origin iframe.
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y - 20 }, panel);
  await read('new Promise(resolve => setTimeout(resolve, 240))');
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'true', 'pin prevents pointer-leave dismissal');
  await read('document.getElementById("chat-view").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))');
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'true', 'outside clicks preserve the pin');
  await read('document.getElementById("company-chat-search").focus()');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  assert.equal(await read('document.getElementById("company-chat-menu").hidden'), true, 'Escape closes pinned toolbar suggestions');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'true', 'Escape does not undo the pin');
  await click('#studio-tab');
  await click('#chat-tab');
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'true', 'pin survives view switches');
  assert.equal(await read('Math.abs(document.getElementById("chatgpt-frame").getBoundingClientRect().top-document.getElementById("chat-toolbar").getBoundingClientRect().bottom)<1'), true, 'pinned toolbar does not cover the iframe after switching views');
  await screenshot('workspace-chat-pinned.png');
  await click('#chat-toolbar-pin');
  await until(() => read('chrome.storage.local.get("chatToolbarPinned").then(data => data.chatToolbarPinned === false)'), 'unpin preference saved');
  assert.equal(await read('document.getElementById("chat-toolbar-pin").getAttribute("aria-pressed")'), 'false');
  assert.equal(await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height'), iframeHeight, 'unpin returns all toolbar space to the iframe');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y + 3 }, panel);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y - 20 }, panel);
  try { await until(() => read('document.getElementById("chat-toolbar-shell").dataset.open === "false"'), 'unpin restores pointer-leave dismissal'); }
  catch (error) {
    const state = await read(`({ active: document.activeElement?.id, hovered: document.getElementById('chat-toolbar-shell').matches(':hover'), shell: {...document.getElementById('chat-toolbar-shell').dataset}, searchExpanded: document.getElementById('company-chat-search').getAttribute('aria-expanded'), hit: document.elementFromPoint(${chatBounds.width / 2}, ${chatBounds.y + 180})?.id })`);
    throw new Error(error.message + ': ' + JSON.stringify(state));
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y + 3 }, panel);
  await until(() => read('document.getElementById("chat-toolbar-shell").dataset.open === "true" && getComputedStyle(document.getElementById("chat-toolbar")).opacity === "1"'), 'unpin restores hover reveal');
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
  const nativeToolbarFont = await read('getComputedStyle(document.getElementById("company-chat-search")).fontSize');
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
    assert.equal(await read('getComputedStyle(document.getElementById("company-chat-search")).fontSize'), nativeToolbarFont);
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
  const compactSearchWidth = await read('document.querySelector(".company-chat-searchbox").getBoundingClientRect().width');
  const toolsBeforeSearch = await read('document.querySelector(".chat-tools-right").getBoundingClientRect().left');
  await read('document.getElementById("company-chat-search").focus()');
  await until(() => read(`!document.getElementById("company-chat-menu").hidden && document.querySelector(".company-chat-searchbox").getBoundingClientRect().width > ${compactSearchWidth + 10}`), 'company search expands on focus');
  assert.equal(await read('document.getElementById("company-chat-search").getAttribute("aria-expanded")'), 'true');
  assert.equal(await read('document.querySelector(".chat-tools-right").getBoundingClientRect().left'), toolsBeforeSearch, 'search expansion preserves the other toolbar controls');
  assert.equal(await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height'), iframeHeight);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y + 180 }, panel);
  await read('new Promise(resolve => setTimeout(resolve, 220))');
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'true', 'focused search remains open when the pointer leaves');
  assert.equal(await read('document.querySelectorAll("#company-chat-list button").length'), 0);
  assert.match(await text('#company-chat-status'), /No connected company chats/);
  assert.equal(await evaluate(frameSession, 'document.getElementById("history").hidden'), true, 'company search does not leave ChatGPT history open');
  await click('#studio-tab');
  assert.equal(await read('document.querySelector(\'[data-request-id="1"] [data-action="review"]\').disabled'), true, 'a result without a source cannot open an unrelated chat');
  await click('[data-request-id="1"] [data-action="details"]');
  assert.equal(await read('document.getElementById("request-connect-chat").disabled'), true);
  assert.equal(await read('document.getElementById("request-open-chat").disabled'), true);
  await closeDialog('request-dialog');
  await evaluate(frameSession, 'history.pushState({}, "", "/c/company-northstar"); dispatchEvent(new PopStateEvent("popstate"))');
  await click('[data-request-id="1"] [data-action="details"]');
  assert.equal(await read('document.getElementById("request-connect-chat").disabled'), false);
  await click('#request-connect-chat');
  assert.match(await text('#request-source-note'), /Connected chat.*Northstar/);
  await closeDialog('request-dialog');
  await evaluate(frameSession, 'history.pushState({}, "", "/c/company-aster"); dispatchEvent(new PopStateEvent("popstate"))');
  await click('[data-request-id="2"] [data-action="details"]');
  await click('#request-connect-chat');
  await closeDialog('request-dialog');
  await click('#chat-tab');
  await read('document.getElementById("chat-toolbar-reveal").focus()');
  await read('document.getElementById("company-chat-search").focus()');
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
  assert.match(await read('document.getElementById("company-chat-search").title'), /Northstar/);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: chatBounds.width / 2, y: chatBounds.y + 180 }, panel);
  await until(() => read('document.getElementById("chat-toolbar-shell").dataset.open === "false"'), 'toolbar hides away from top edge');
  assert.equal(await read('getComputedStyle(document.querySelector(".chat-toolbar-handle")).visibility'), 'visible');
  await read('document.getElementById("chat-toolbar-reveal").focus()');
  assert.equal(await read('document.getElementById("chat-toolbar").inert'), false);
  await read('document.getElementById("company-chat-search").focus()');
  await setValue('#company-chat-search', 'Unknown company', 'input');
  assert.match(await text('#company-chat-status'), /No companies match/);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  await until(() => read(`document.getElementById("company-chat-menu").hidden && document.querySelector(".company-chat-searchbox").getBoundingClientRect().width <= ${compactSearchWidth + 1}`), 'Escape collapses the search and closes suggestions');
  await read('document.getElementById("company-chat-search").focus()');
  await setValue('#company-chat-search', 'Aster', 'input');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }, panel);
  assert.equal(await read('document.getElementById("company-chat-search").getAttribute("aria-activedescendant")'), 'company-chat-option-0');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, panel);
  await until(() => read('document.getElementById("chatgpt-frame").src === "https://chatgpt.com/c/company-aster" && document.getElementById("connection").dataset.state === "ready"'), 'keyboard selection opens the saved company chat');
  for (const width of [280, 360, 800]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    await read('document.getElementById("chat-toolbar-reveal").focus()');
    const heightBeforeFocus = await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height');
    await read('document.getElementById("company-chat-search").focus()');
    await until(() => read('document.getElementById("company-chat-search").getAttribute("aria-expanded")==="true" && getComputedStyle(document.getElementById("chat-toolbar")).opacity === "1" && Math.abs(document.querySelector(".company-chat-searchbox").getBoundingClientRect().width - Math.min(320, document.querySelector(".company-chat-picker").getBoundingClientRect().width)) < 1'), 'expanded search animation settles at varied widths');
    assert.equal(await read('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".chat-tools-left").getBoundingClientRect().right <= document.querySelector(".company-chat-searchbox").getBoundingClientRect().left && document.querySelector(".company-chat-searchbox").getBoundingClientRect().right <= document.querySelector(".chat-tools-right").getBoundingClientRect().left && document.getElementById("chat-toolbar-pin").getBoundingClientRect().right <= innerWidth && document.getElementById("company-chat-menu").getBoundingClientRect().right <= innerWidth'), true, `expanded company search and pin fit at ${width}px`);
    assert.equal(await read('document.getElementById("chatgpt-frame").getBoundingClientRect().height'), heightBeforeFocus);
    if (width === 280) await screenshot('workspace-company-search-narrow.png');
    await read('document.getElementById("company-chat-search").blur();document.getElementById("chat-toolbar-reveal").focus()');
    await until(() => read('document.getElementById("company-chat-menu").hidden'), 'suggestions close when search loses focus');
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
  await read('document.getElementById("chat-toolbar-reveal").focus();document.getElementById("company-chat-search").focus()');
  await setValue('#company-chat-search', 'Northstar', 'input');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, panel);
  await until(() => read('document.getElementById("chatgpt-frame").src === "https://chatgpt.com/c/company-northstar" && document.getElementById("connection").dataset.state === "ready"'), 'single-result Enter restores the original conversation before draft-preservation checks');
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
  await click('[data-request-id="1"] [data-action="details"]');
  assert.equal(await read('document.getElementById("request-dialog").open'), true);
  assert.match(await text('#request-metadata'), /Morgan Taylor/);
  assert.equal(Object.keys(JSON.parse(await text('#request-output'))).length, 6);
  await screenshot('workspace-request.png');
  await click('#request-open-chat');
  await until(() => read('!document.getElementById("chat-view").hidden'), 'connected chat opens after queue pause');
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft');
  await click('#studio-tab');
  await click('[data-request-id="1"] [data-action="details"]');
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
  await shortcut('ArrowRight');
  await until(async () => await activeSource() === nextTab, 'next open browser tab');
  await until(() => read('!document.getElementById("previous-job").disabled'), 'tab navigation ready');
  assert.equal(await value('#job-description'), '');
  assert.equal(await value('#job-company'), '');
  assert.equal(await value('#job-title'), '');
  assert.equal(await value('#job-url'), '');
  await shortcut('ArrowDown');
  await shortcut('ArrowLeft', {inChat:true});
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
  await read('document.getElementById("company-chat-search").focus()');
  assert.equal(await read('document.querySelectorAll("#company-chat-list button").length'), 0);
  await click('#studio-tab');
  await click('#profile-details');
  assert.equal(await text('#profile-name'), 'Jordan Lee');
  assert.equal(await read('document.getElementById("import-profile").disabled'), false);
  await closeDialog('profile-dialog');
  await click('#view-queue');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 0);
  assert.equal(await read('document.getElementById("empty-queue").hidden'), false);
  await click('#empty-prepare');
  await shortcut('ArrowDown');
  await evaluate(frameSession, `globalThis.nativeCtrlEnterForTest = 0;
    document.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter') nativeCtrlEnterForTest++; });`);
  await shortcut('Enter', {inChat:true,repeat:true});
  await until(() => read('document.documentElement.dataset.studioBusy !== "true" && !document.getElementById("studio-view").hidden && document.getElementById("results-tab").getAttribute("aria-selected") === "true"'), 'Ctrl+Enter adds once and opens Job Queues');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 1);
  assert.equal(await evaluate(frameSession, 'nativeCtrlEnterForTest'), 0);
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft');
  assert.match(await text('#resume-queue .job-request'), /Queued/);
  await click('#resume-queue .job-request [data-action="details"]');
  await read('document.getElementById("request-full-prompt").focus()');
  await shortcut('Enter');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 1, 'modal shortcuts cannot add jobs');
  assert.equal(await read('document.getElementById("request-dialog").open'), true);
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
  await click('#resume-queue .job-request [data-action="details"]');
  assert.equal(await text('#request-job'), literalJob);
  await closeDialog('request-dialog');
  await click('#resume-queue .job-request [data-action="cancel"]');
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
  await click('#resume-queue .job-request [data-action="details"]');
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
  await click('#shortcut-settings-tab');
  for (const label of ['Ctrl+Up','Ctrl+Down','Ctrl+Left','Ctrl+Right','Ctrl+Enter']) assert.ok((await text('#workspace-shortcut-list')).includes(label));
  assert.equal(await read('document.getElementById("add-request").getAttribute("aria-keyshortcuts")'), 'Control+Enter');
  const readShortcut = await read('chrome.commands.getAll().then(commands => commands.find(command => command.name === "read-job-page").shortcut)');
  await until(async () => (await text('#read-page-shortcut')) === readShortcut, 'Read page assignment in settings');
  assert.equal(await read('document.getElementById("shortcut-settings-panel").hidden'), false);
  assert.match(await text('#read-page-shortcut-default'), /Shift\+F/);
  assert.ok((await read('document.getElementById("read-page").title')).includes(readShortcut));
  // These API replacements affect only this isolated fixture panel. Do not change
  // Chrome's real shortcut assignments or open a real settings tab during tests.
  await read(`globalThis.shortcutApisForTest = { getAll: chrome.commands.getAll, create: chrome.tabs.create };
    globalThis.openedShortcutSettingsForTest = [];
    chrome.tabs.create = async options => { openedShortcutSettingsForTest.push(options); };
    chrome.commands.getAll = async () => [{ name: 'read-job-page', shortcut: 'Ctrl+Shift+S' }];`);
  try {
    await click('#shortcut-settings-refresh');
    await until(async () => (await text('#read-page-shortcut')) === 'Ctrl+Shift+S', 'existing assignment overrides default display');
    assert.equal(await read('document.getElementById("read-page").getAttribute("aria-keyshortcuts")'), 'Control+Shift+S');
    await click('#shortcut-settings-open');
    assert.deepEqual(await read('openedShortcutSettingsForTest'), [{ url: 'chrome://extensions/shortcuts' }]);
    await read('chrome.commands.getAll = async () => [{ name: "read-job-page", shortcut: "" }]; window.dispatchEvent(new Event("focus"));');
    await until(async () => (await text('#read-page-shortcut')) === 'Not assigned', 'unassigned shortcut after returning to sidebar');
    assert.equal(await read('document.getElementById("read-page").hasAttribute("aria-keyshortcuts")'), false);
    await read('chrome.commands.getAll = async () => { throw new Error("Fixture API unavailable"); };');
    await click('#shortcut-settings-refresh');
    await until(async () => (await text('#read-page-shortcut')) === 'Unknown', 'unknown shortcut is not presented as active');
  } finally {
    await read('chrome.commands.getAll = shortcutApisForTest.getAll; chrome.tabs.create = shortcutApisForTest.create; delete globalThis.shortcutApisForTest; delete globalThis.openedShortcutSettingsForTest;');
    await click('#shortcut-settings-refresh');
    await until(async () => (await text('#read-page-shortcut')) === readShortcut, 'real fixture shortcut restored');
  }
  await screenshot('workspace-shortcut-settings.png');
  for (const width of [280,390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
    assert.equal(await read('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".settings-scroll").scrollWidth <= document.querySelector(".settings-scroll").clientWidth'), true, `shortcut settings at ${width}px`);
  }
  await click('#keyword-settings-tab');
  await until(() => read('!document.getElementById("keyword-settings-form").inert'), 'keyword settings loaded');
  await read('chrome.storage.local.set({keywordHighlights:{enabled:false,color:"#ffcfe0",keywords:["Previously saved"],caseSensitive:false,wholeWords:true}})');
  await click('[name="keyword-color-preset"][value="red"]');
  await until(async () => (await value('#keyword-list')) === 'Previously saved', 'legacy Pink keywords are available in Red');
  assert.ok(!(await text('.keyword-color-presets')).includes('Pink'));
  const colorLists = { yellow:'C++', green:'React', blue:'machine learning', red:'SQL', purple:'<img src=x onerror=alert(1)>', orange:'AWS', custom:'Kubernetes' };
  for (const [id, keywords] of Object.entries(colorLists)) {
    await click(`[name="keyword-color-preset"][value="${id}"]`);
    await setValue('#keyword-list', keywords, 'input');
  }
  await setValue('#keyword-color', '#c7f0ed', 'input');
  await click('[name="keyword-color-preset"][value="blue"]');
  assert.equal(await value('#keyword-list'), 'machine learning', 'switching colors preserves unsaved keywords');
  await setValue('#keyword-list', Array(201).fill('too-many').join('\n'), 'input');
  await click('[name="keyword-color-preset"][value="red"]');
  await click('#keyword-enabled');
  await click('#keyword-save');
  assert.match(await text('#keyword-save-status'), /Blue: Use up to 200/);
  assert.equal(await text('#keyword-list-label'), 'Blue keywords', 'invalid hidden lists are brought into view');
  assert.equal(await read('chrome.storage.local.get("keywordHighlights").then(data => data.keywordHighlights.version)'), undefined, 'an invalid group prevents saving every list');
  await setValue('#keyword-list', colorLists.blue, 'input');
  await click('#keyword-save');
  await until(async () => (await text('#keyword-save-status')).includes('saved on this device'), 'keyword settings saved');
  const savedColors = await read('chrome.storage.local.get("keywordHighlights").then(data => data.keywordHighlights)');
  assert.equal(savedColors.version, 2);
  assert.deepEqual(Object.fromEntries(savedColors.groups.map(group => [group.id, group.keywords.join('\n')])), colorLists);
  for (const [id, keywords] of Object.entries(colorLists)) {
    await click(`[name="keyword-color-preset"][value="${id}"]`);
    assert.equal(await value('#keyword-list'), keywords, `${id} has its own saved list`);
  }
  await click('[name="keyword-color-preset"][value="red"]');
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
  assert.equal(await read('[...CSS.highlights.keys()].some(name => name.startsWith("ai-agent-job-keywords"))'), false);
  assert.equal(await value('#job-description'), 'React and SQL should stay plain in the dock.');
  assert.equal(await evaluate(frameSession, '[...CSS.highlights.keys()].some(name => name.startsWith("ai-agent-job-keywords"))'), false);
  await click('#highlight-keywords');
  await until(() => read('chrome.storage.local.get("keywordHighlights").then(data => !data.keywordHighlights.enabled)'), 'keyword highlighting disabled');
  await click('#highlight-keywords');
  await until(() => read('chrome.storage.local.get("keywordHighlights").then(data => data.keywordHighlights.enabled)'), 'keyword highlighting enabled');
  await click('#account-toggle');
  await click('#account-settings');
  assert.equal(await value('#keyword-list'), 'SQL');
  await click('[name="keyword-color-preset"][value="blue"]');
  assert.equal(await value('#keyword-list'), 'machine learning');
  assert.equal(await value('#keyword-color'), '#c7f0ed');
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
    'vertical ChatGPT history arrows follow native order from the top', 'Up disabled on new and most recent chats with no boundary wrapping', 'history navigation blocks drafts and generation and restores native sidebar visibility',
    'Job Queues label and sidebar shortcuts in Settings', 'trusted Ctrl+Up/Down and Ctrl+Left/Right work in the host and ChatGPT iframe', 'Ctrl+Enter adds a validated job once while preserving the ChatGPT draft and blocking native send handlers', 'dialogs preserve their own keyboard controls',
    'live open-tab navigation and per-tab drafts', 'hover toolbar reveal and dismissal without resizing chat',
    'new chat and refresh on the left with a far-right pin', 'pin saves its preference and survives pointer leave, outside clicks, Escape and view switches', 'pinned toolbar reserves its own row without covering the iframe at narrow and wide widths', 'unpin restores hover behavior and full iframe height',
    'text sizing preserves iframe size, viewport, layout spacing, and drafts', 'new and nested messages scale without compounding',
    'all eight baseline resume thumbnails load',
    'compact tab controls and side-by-side job fields', 'base resume keeps job extraction visible while hiding the prompt template',
    'keyword settings persistence and far-right Read page control', 'dock and ChatGPT never receive keyword highlights',
    'separate color lists retain unsaved edits and save together', 'legacy Pink keywords migrate to Red', 'hidden invalid lists block saving and receive focus',
    'per-tab job URLs and immutable source URL snapshots', 'compact footer without visible status rows',
    'saved-company chat connection, search, and navigation', 'search expands on focus and collapses on Escape', 'focused search stays open without moving chat controls or resizing iframe', 'keyboard suggestion selection', 'general ChatGPT history untouched', 'empty company-chat guidance',
    'Chat has no Studio footer', 'fixed Studio action buttons',
    'candidate isolation and empty state', 'template and prompt previews', 'immutable request snapshots', 'queued example cancellation',
    'save-retry example without generation', 'base resume example', 'resume preview and JSON copy', 'export availability',
    'literal job text rendering', 'account panel', 'dialog Escape and keyboard tabs', 'fixed controls and narrow layouts', 'light and dark themes'] };
}
