import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkCurrentJobUI } from './current-job-ui.mjs';

export async function checkWorkspaceUI({ cdp, panel, read, click, frameSession, deepseekSession, evaluate, artifacts, until }) {
  const text = selector => read(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const value = selector => read(`document.querySelector(${JSON.stringify(selector)}).value`);
  const setValue = (selector, value, event = 'change') => read(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  })()`);
  const closeDialog = async id => {
    await cdp.send('Page.bringToFront', {}, panel);
    await read(`new Promise(resolve=>{const dialog=document.getElementById(${JSON.stringify(id)});if(!dialog.open){resolve();return;}dialog.addEventListener('close',resolve,{once:true});dialog.querySelector('[data-close-dialog]').click();})`);
  };
  async function checkChatViewportAcrossCollapse(session, editor) {
    const settleLayout = () => read('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await settleLayout();
    const dimensions = () => evaluate(session, '({width:innerWidth,height:innerHeight,document:performance.timeOrigin,url:location.href})');
    const before = await dimensions();
    await evaluate(session, 'globalThis.dockResizeEvents=[];globalThis.dockResizeListener=()=>dockResizeEvents.push([innerWidth,innerHeight]);addEventListener("resize",dockResizeListener)');
    for (let i = 0; i < 2; i++) {
      await until(() => evaluate(session, '!document.documentElement.inert'), 'chat input is restored before focusing');
      await evaluate(session, `document.querySelector(${JSON.stringify(editor)}).focus()`);
      await click('#chat-dock-toggle');
      await settleLayout();
      assert.deepEqual(await dimensions(), before, 'collapsed chat retains its document and full viewport');
      await until(() => evaluate(session, 'document.documentElement.inert'), 'parked frame disables its own input and focus');
      assert.equal(await read('(()=>{const pane=document.getElementById("chat-view");return pane.hidden && pane.inert && pane.getAttribute("aria-hidden")==="true" && pane.getBoundingClientRect().right<=0})()'), true, 'collapsed chat is off-screen and excluded from interaction');
      await evaluate(session, `document.querySelector(${JSON.stringify(editor)}).focus()`);
      await settleLayout();
      assert.equal(await read('document.activeElement.id'), 'chat-dock-toggle', 'collapsed iframe cannot retain focus');
      await click('#chat-dock-toggle');
      await settleLayout();
      assert.deepEqual(await dimensions(), before, 'expansion does not resize or reload the page');
      await until(() => evaluate(session, '!document.documentElement.inert'), 'expanded frame restores its input and focus');
      assert.equal(await read('!document.getElementById("chat-view").inert && document.getElementById("chat-view").getAttribute("aria-hidden")==="false"'), true);
    }
    assert.deepEqual(await evaluate(session, 'dockResizeEvents'), [], 'collapse and expand do not trigger native viewport rebuilds');
    await evaluate(session, 'removeEventListener("resize",dockResizeListener);delete globalThis.dockResizeListener;delete globalThis.dockResizeEvents');
  }
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
    await read('Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))');
    await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, panel);
    await writeFile(join(artifacts, name), Buffer.from(shot.data, 'base64'));
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, panel);
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'false');
  assert.equal(await read('document.querySelector(".studio-footer").getClientRects().length'), 0, 'job content and actions stay collapsed while chat is open');
  assert.equal(await read('getComputedStyle(document.querySelector(".chat-toolbar-handle")).visibility'), 'visible');
  assert.equal(await read('document.querySelectorAll("#chatgpt-pane .chat-toolbar-handle svg").length'), 1);
  await screenshot('workspace-chat-collapsed.png');
  assert.match(await text('#results-tab'), /^Queue/);
  await evaluate(frameSession, `globalThis.nativeCtrlEnterForTest = 0;
    document.getElementById('prompt-textarea').value = 'Keep my shortcut draft';
    document.getElementById('prompt-textarea').dispatchEvent(new Event('input',{bubbles:true}));
    document.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter') nativeCtrlEnterForTest++; });`);
  await shortcut('ArrowUp', {inChat:true});
  await until(() => read('!document.getElementById("studio-view").hidden && document.getElementById("chat-view").hidden'), 'Ctrl+Up collapses chat and reveals the tracker');
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
  const chatBounds = await read('(() => { const rect=document.getElementById("chatgpt-pane").getBoundingClientRect(); return {x:rect.x,y:rect.y,width:rect.width,height:rect.height}; })()');
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
  await until(() => read('!document.getElementById("chat-history-up").disabled'), 'older ChatGPT chat enables Up before opening a pin');
  await evaluate(frameSession, 'history.pushState({},"","/c/pinned-old");dispatchEvent(new PopStateEvent("popstate"))');
  await until(() => read('document.getElementById("chat-history-up").disabled && !document.getElementById("chat-history-down").disabled'), 'pinned ChatGPT chat starts navigation at newest regular chat');
  await historyStep('#chat-history-down','/c/saved-resume');
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
      const view=document.getElementById('chatgpt-pane').getBoundingClientRect();
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
  assert.equal(await read('document.getElementById("native-search-status").hidden'), true, 'Escape closes pinned toolbar suggestions');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  assert.equal(await read('document.getElementById("chat-toolbar-shell").dataset.open'), 'true', 'Escape does not undo the pin');
  await read('if (!document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  await read('if (document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
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
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value="";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await read('if (!document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
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
  await read('if (document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  await read('document.getElementById("chat-toolbar-reveal").focus()');
  await until(() => read('!document.getElementById("company-chat-search").disabled'), 'expanded ChatGPT restores search readiness');
  await until(() => evaluate(frameSession, '!document.documentElement.inert'), 'expanded ChatGPT restores native search interaction');
  await cdp.send('Page.bringToFront', {}, panel);
  await read('document.getElementById("company-chat-search").value="resume planning";document.getElementById("company-chat-search").focus()');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, panel);
  await until(() => evaluate(frameSession, 'Boolean(document.getElementById("native-search-dialog")?.open) && document.querySelector("#native-search-dialog input").value === "resume planning"'), 'ChatGPT searches the typed query after Enter').catch(async error => {
    const details = await read('({focus:document.activeElement.id,query:document.getElementById("company-chat-search").value,toolbar:document.getElementById("chat-toolbar-shell").dataset.open,status:document.getElementById("native-search-status").textContent,chatHidden:document.getElementById("chat-view").hidden})');
    throw new Error(`${error.message}: ${JSON.stringify(details)}`);
  });
  await until(() => read('!document.getElementById("native-search-submit").disabled'), 'ChatGPT search readback finishes');
  assert.equal(await read('document.getElementById("native-search-status").hidden'), true, 'ChatGPT query accepted without error');
  assert.equal(await read('document.querySelectorAll("#company-chat-list").length'), 0, 'custom saved chat results removed');
  await evaluate(frameSession, 'document.getElementById("native-search-dialog").close()');
  await evaluate(frameSession, 'history.pushState({},"","/c/company-northstar");dispatchEvent(new PopStateEvent("popstate"))');
  const sourceWindow = await read('chrome.windows.getCurrent().then(window => window.id)');
  await cdp.send('Target.createTarget', { url: 'about:blank#job-two' });
  await cdp.send('Target.createTarget', { url: 'about:blank#job-three' });
  const sourceTabs = () => read(`chrome.tabs.query({windowId:${sourceWindow}}).then(tabs => tabs.filter(tab => !tab.url?.startsWith(chrome.runtime.getURL(''))).sort((a,b) => a.index-b.index).map(tab => ({id:tab.id,active:tab.active})))`);
  const activeSource = async () => (await sourceTabs()).find(tab => tab.active)?.id;
  await until(async () => Number((await text('#job-position')).split('/')[1]) === (await sourceTabs()).length, 'open-tab count');
  await read('globalThis.originalChatFrame = document.getElementById("chatgpt-frame")');
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value = "Keep this ChatGPT draft"');
  await read('if (!document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 3);
  await screenshot('workspace-queue.png');
  assert.deepEqual(await read('[...document.querySelector(\'[data-request-id="1"] .request-actions\').children].map(button=>button.textContent)'), ['Resume', 'Cover letter', 'Update', 'Delete']);
  assert.equal(await read('document.querySelector(\'[data-request-id="1"] [data-action="cover-letter"]\').disabled'), true, 'missing cover letters cannot open an empty document');
  await setValue('#queue-search', 'northstar', 'input');
  assert.equal(await read('document.querySelectorAll("#resume-queue .job-request").length'), 1, 'queue search matches a saved company');
  await setValue('#queue-filter', 'queued');
  assert.equal(await read('document.getElementById("queue-no-matches").hidden'), false, 'combined filters show an honest empty result');
  await setValue('#queue-search', '', 'input');
  await setValue('#queue-filter', 'all');
  assert.equal(await read('document.querySelectorAll("#resume-queue .job-request").length'), 3, 'filters leave saved jobs intact');

  assert.equal(await read('document.querySelectorAll("#resume-queue .state-pill[data-state=ready]").length'), 3);
  await click('[data-request-id="1"] [data-action="details"]');
  assert.equal(await read('document.getElementById("request-dialog").open'), true);
  assert.match(await text('#request-metadata'), /Morgan Taylor/);
  assert.equal(Object.keys(JSON.parse(await text('#request-output'))).length, 6);
  await screenshot('workspace-request.png');
  await click('#request-open-chat');
  await until(() => read('!document.getElementById("chat-view").hidden'), 'connected chat opens without changing its draft');
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft');
  await read('if (!document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  await click('[data-request-id="1"] [data-action="details"]');
  await cdp.send('Page.bringToFront', {}, panel);
  await read('document.querySelector("#request-dialog [data-close-dialog]").focus()');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, panel);
  assert.equal(await read('document.getElementById("request-dialog").open'), false);

  await click('[data-request-id="1"] [data-action="preview"]');
  assert.equal(await read('document.getElementById("resume-preview-dialog").open'), true);
  assert.match(await text('#resume-paper'), /Morgan Taylor/);
  assert.match(await text('#resume-paper'), /Education/);
  await screenshot('workspace-resume.png');
  await read('Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { globalThis.copiedResume = value; } } })');
  await click('#copy-json');
  assert.equal(JSON.parse(await read('globalThis.copiedResume')).company, 'Northstar');
  await read("chrome.storage.local.set({documentSettings:{autoDownload:false,autoPreview:false,formats:['json']}})");
  await click('#export-resume');
  assert.equal(await read("import(chrome.runtime.getURL('src/generation-store.mjs')).then(m=>m.createGenerationStore().read()).then(state=>state.runs.some(run=>run.kind==='document-export'&&run.exportKinds[0]==='resume'))"), true);
  await closeDialog('resume-preview-dialog');
  await click('[data-request-id="2"] [data-action="preview"]');
  assert.equal(await read('document.getElementById("resume-paper").dataset.template'), 'harvard');
  await closeDialog('resume-preview-dialog');

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
  await read('if (document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  assert.equal(await read('document.getElementById("chatgpt-frame") === globalThis.originalChatFrame'), true);
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft');
  await read('if (!document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  assert.equal(await value('#job-description'), literalJob);
  assert.equal(await value('#prompt-template'), 'technical');

  await setValue('#candidate', 'jordan');
  await read('if (document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  await read('document.getElementById("chat-toolbar-reveal").focus()');
  await read('if (!document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  await click('#account-toggle'); await click('#profile-details');
  assert.equal(await text('#profile-name'), 'Jordan Lee');
  assert.equal(await read('document.getElementById("import-profile").disabled'), false);
  await closeDialog('profile-dialog');
  await click('#view-queue');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 0);
  assert.equal(await read('document.getElementById("empty-queue").hidden'), false);
  await click('#empty-prepare');
  await shortcut('ArrowDown');
  await read('globalThis.addClipboardWrites=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>addClipboardWrites.push(text)}})');
  await evaluate(frameSession, `globalThis.nativeCtrlEnterForTest = 0;
    document.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter') nativeCtrlEnterForTest++; });`);
  await shortcut('Enter', {inChat:true,repeat:true});
  await until(() => read('document.documentElement.dataset.studioBusy !== "true" && document.getElementById("chat-view").hidden'), 'Ctrl+Enter saves once and shows the queue');
  await until(() => read('Boolean(document.querySelector(".state-pill[data-state=queued]"))'), 'manual Add stays queued and preserves the Chat draft');
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 1);
  assert.equal(await evaluate(frameSession, 'nativeCtrlEnterForTest'), 0);
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft');
  assert.match(await text('#resume-queue .job-request'), /Queued/);
  assert.equal(await read('document.querySelectorAll("[data-action=prepare-chat], [data-action=capture-chat], [data-action=copy-prompt], #start-queue, #pause-queue, #queue-connection").length'), 0, 'AI automation controls are removed');
  assert.equal(await read('addClipboardWrites.length'), 0);
  assert.equal(await read('import(chrome.runtime.getURL("src/queue-store.mjs")).then(module => module.createQueueStore().read()).then(state => state.requests.filter(job => !job.isExample).every(job => !job.deliveryId && !job.attempts))'), true, 'manual Add creates no delivery attempt or send permission');
  assert.equal(await read('document.getElementById("check-existing-jobs").checked'), true);
  await shortcut('Enter', { repeat: true });
  await until(() => read('document.documentElement.dataset.studioBusy!=="true" && !document.getElementById("queue-notice").hidden'), 'Ctrl+Enter reports a duplicate already in the queue');
  assert.equal(await text('#queue-notice-title'), 'Already applied');
  assert.match(await text('#queue-notice-message'), /candidate.*queue/);
  assert.equal(await read('document.querySelectorAll(".job-request").length'), 1);
  assert.equal(await read('addClipboardWrites.length'), 0, 'saving jobs never changes the clipboard');
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft');
  assert.equal(await evaluate(frameSession, 'nativeCtrlEnterForTest'), 0);
  assert.equal(await read('(() => {const rect=document.getElementById("queue-notice").getBoundingClientRect();return rect.width>0&&rect.left>=0&&rect.right<=innerWidth;})()'), true);
  await screenshot('workspace-already-applied.png');
  await click('#queue-notice-dismiss');
  assert.equal(await read('document.getElementById("queue-notice").hidden'), true);
  await read('if (!document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()'); await click('#view-queue');
  await click('#resume-queue .job-request [data-action="details"]');
  await read('document.querySelector("#request-dialog [data-close-dialog]").focus()');
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
  await until(() => read('Boolean(document.querySelector(".state-pill[data-state=queued]")) && document.getElementById("chat-view").hidden'), 'base resume stays saved in the queue');
  await read('if (!document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()'); await click('#view-queue');
  await click('#resume-queue .job-request [data-action="details"]');
  assert.match(await text('#request-metadata'), /Base resume/);
  assert.match(await text('#request-prompt'), /without tailoring to a job/);
  await closeDialog('request-dialog');

  await click('#review-another');
  await click('#account-toggle'); await click('#profile-details');
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
  assert.equal(await read('document.getElementById("account-panel").contains(document.getElementById("chat-provider"))'), true);
  assert.equal(await read('document.getElementById("chat-view").contains(document.getElementById("chat-provider"))'), false);
  assert.equal(await read('document.getElementById("account-check")'), null);
  await screenshot('workspace-chat-settings.png');
  assert.equal(await read('document.getElementById("account-chat") === null'), true, 'redundant Open chat button removed');
  await setValue('#chat-provider', 'deepseek');
  await until(() => read('document.getElementById("account-panel").hidden && !document.getElementById("deepseek-pane").hidden && !document.getElementById("chat-provider").disabled'), 'provider selection opens chat and closes popup');
  assert.equal(await read('document.getElementById("account-toggle").getAttribute("aria-expanded")'), 'false');
  assert.equal(await read('document.activeElement.id'), 'account-toggle', 'closing the popup restores focus');
  const retainedDeepseekDocument = await evaluate(deepseekSession, 'performance.timeOrigin');
  const retainedDeepseekUrl = await evaluate(deepseekSession, 'location.href');
  await evaluate(deepseekSession, 'document.querySelector("textarea").value="Keep this DeepSeek draft across collapse";document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('document.getElementById("deepseek-new-chat").disabled && document.getElementById("deepseek-status").hidden'), 'DeepSeek draft is ready before collapse');
  await checkChatViewportAcrossCollapse(deepseekSession, 'textarea');
  await click('#chat-dock-toggle');
  await evaluate(deepseekSession, 'document.querySelector("textarea").hidden=true;document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('!document.getElementById("deepseek-status").hidden'), 'DeepSeek reports an unavailable composer while collapsed');
  await click('#chat-dock-toggle');
  assert.doesNotMatch(await text('#deepseek-status'), /sign[ -]?in|log[ -]?in/i, 'expanding an unavailable composer does not invent a sign-in requirement');
  assert.match(await text('#deepseek-status'), /message box/i);
  assert.equal(await read('document.getElementById("deepseek-new-chat").disabled'), true, 'loading does not bypass navigation guards');
  await evaluate(deepseekSession, 'document.querySelector("textarea").hidden=false');
  // No frame input event: expanding the selected provider must probe it.
  await click('#chat-dock-toggle');
  await click('#chat-dock-toggle');
  await until(() => read('document.getElementById("deepseek-status").hidden'), 'expanded DeepSeek refreshes its readiness');
  assert.equal(await evaluate(deepseekSession, 'performance.timeOrigin'), retainedDeepseekDocument, 'collapse and expand keep the same DeepSeek document');
  assert.equal(await evaluate(deepseekSession, 'location.href'), retainedDeepseekUrl, 'collapse and expand preserve the DeepSeek conversation');
  assert.equal(await evaluate(deepseekSession, 'document.querySelector("textarea").value'), 'Keep this DeepSeek draft across collapse');
  await evaluate(deepseekSession, 'document.querySelector("textarea").value="";document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('!document.getElementById("deepseek-new-chat").disabled'), 'DeepSeek controls recover after the draft is cleared');
  await click('#account-toggle');
  await setValue('#chat-provider', 'chatgpt');
  await until(() => read('document.getElementById("account-panel").hidden && !document.getElementById("chatgpt-pane").hidden && !document.getElementById("chat-provider").disabled'), 'switching back also closes popup');
  assert.equal(await read('document.getElementById("chat-view").hidden'), false);
  const retainedChatgptDocument = await evaluate(frameSession, 'performance.timeOrigin');
  const retainedChatgptUrl = await evaluate(frameSession, 'location.href');
  await checkChatViewportAcrossCollapse(frameSession, '#prompt-textarea');
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value="Keep this ChatGPT draft across collapse";document.getElementById("prompt-textarea").hidden=true;document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('document.getElementById("connection").dataset.state === "connected"'), 'signed-in ChatGPT remains connected with a hidden composer');
  assert.equal(await read('document.getElementById("connection").hidden'), true, 'connected page does not show Opening ChatGPT');
  assert.equal(await read('document.getElementById("chat-history-down").disabled'), true, 'connected does not mean ready for navigation');
  await click('#chat-dock-toggle');
  await click('#chat-dock-toggle');
  assert.equal(await read('document.getElementById("connection").hidden'), true, 'expanding connected ChatGPT keeps the loading banner hidden');
  await evaluate(frameSession, 'const login=document.createElement("button");login.id="lifecycle-login";login.dataset.testid="login-button";login.textContent="Log in";document.body.append(login)');
  await until(() => read('document.getElementById("connection").dataset.state === "guest"'), 'actual sign-out is reported even without a composer');
  assert.equal(await read('document.getElementById("connection").hidden'), false, 'a real sign-in requirement is still visible');
  await evaluate(frameSession, 'document.getElementById("lifecycle-login").remove();document.getElementById("prompt-textarea").hidden=false;document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('document.getElementById("connection").dataset.state === "ready" && document.getElementById("connection").hidden'), 'ChatGPT returns to ready without a reload');
  assert.equal(await evaluate(frameSession, 'performance.timeOrigin'), retainedChatgptDocument);
  assert.equal(await evaluate(frameSession, 'location.href'), retainedChatgptUrl);
  assert.equal(await evaluate(frameSession, 'document.getElementById("prompt-textarea").value'), 'Keep this ChatGPT draft across collapse');
  await evaluate(frameSession, 'document.getElementById("prompt-textarea").value="";document.getElementById("prompt-textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await cdp.send('Page.bringToFront', {}, panel);
  await read('document.getElementById("chat-dock-toggle").focus()');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }, panel);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, panel);
  assert.equal(await read('document.getElementById("chat-dock-toggle").getAttribute("aria-expanded")'), 'false');
  assert.equal(await read('document.getElementById("chat-view").hidden'), true);
  assert.equal(await read('document.activeElement.id'), 'chat-dock-toggle');
  assert.equal(await read('Math.abs(document.querySelector(".dock-status-bar").getBoundingClientRect().bottom-innerHeight)<1'), true, 'collapsed status bar returns to the bottom');
  assert.equal(await read('getComputedStyle(document.querySelector(".dock-status-bar"), "::before").display'), 'none', 'collapsed chat hides its top separator');

  assert.equal(await read('document.querySelectorAll(".tracker-heading, .tracker-monogram").length'), 0, 'branding header removed');
  assert.equal(await read('document.querySelectorAll(".profile-card").length'), 0, 'profile card removed from the workspace');
  const retainedJobDraft = await value('#job-description');
  await click('#studio-dock-toggle');
  assert.equal(await read('document.getElementById("studio-content").hidden && !document.getElementById("chat-view").hidden'), true, 'collapsing jobs expands chat');
  assert.equal(await read('document.getElementById("studio-dock-toggle").getAttribute("aria-expanded")'), 'false');
  assert.equal(await read('document.getElementById("chat-view").getBoundingClientRect().height > innerHeight * .8'), true, 'chat fills the space below the two headers');
  await screenshot('workspace-accordions.png');
  await click('#job-tab');
  assert.equal(await read('!document.getElementById("studio-content").hidden && !document.getElementById("job-panel").hidden && document.getElementById("chat-view").hidden'), true, 'Job form expands while chat collapses');
  assert.equal(await value('#job-description'), retainedJobDraft, 'accordion retains the job draft');
  await click('#chat-dock-toggle');
  assert.equal(await read('document.getElementById("studio-content").hidden && !document.getElementById("chat-view").hidden'), true, 'chat expands while jobs collapse');
  await click('#results-tab');
  assert.equal(await read('!document.getElementById("studio-content").hidden && !document.getElementById("results-panel").hidden && document.getElementById("chat-view").hidden'), true, 'Queue expands while chat collapses');

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
      assert.equal(await read(`(() => {
        const job=document.querySelector('.studio-navigation'), chat=document.querySelector('.dock-status-bar');
        const bars=[job,chat].map(element=>element.getBoundingClientRect());
        const fullHeight=(selector,bar)=>{const bounds=document.querySelector(selector).getBoundingClientRect();return bounds.top===bar.top && bounds.bottom===bar.bottom;};
        return bars.every(bar=>bar.height===40 && bar.left===0 && bar.right===innerWidth) &&
          getComputedStyle(job).backgroundColor===getComputedStyle(chat).backgroundColor &&
          ['#job-tab','#results-tab','#apply-tab','#studio-dock-toggle'].every(selector=>fullHeight(selector,bars[0])) &&
          ['.dock-provider-picker','#chat-dock-toggle','#open-queue','#account-toggle'].every(selector=>fullHeight(selector,bars[1])) &&
          document.getElementById('apply-tab').getBoundingClientRect().left===0 &&
          document.querySelector('.dock-provider-picker').getBoundingClientRect().left===0 &&
          document.getElementById('chat-dock-toggle').getBoundingClientRect().left===document.querySelector('.dock-provider-picker').getBoundingClientRect().right;
      })()`), true, 'compact headers and full-height buttons reach the dock edges at ' + width);
      assert.ok(layout.scrollHeight > 350);
      assert.equal(await read('document.querySelector(".studio-footer").getBoundingClientRect().height <= 90'), true, `compact footer at ${width}px`);
      assert.equal(await read('getComputedStyle(document.getElementById("workspace-status")).position'), 'absolute');
      if (view === 'job') {
        assert.equal(await read('(() => { const nav=document.querySelector(".tab-navigation").getBoundingClientRect(), read=document.getElementById("read-page").getBoundingClientRect(), tools=document.querySelector(".job-tools").getBoundingClientRect(), toggle=document.querySelector(".keyword-page-toggle").getBoundingClientRect(), company=document.getElementById("job-company").getBoundingClientRect(), role=document.getElementById("job-title").getBoundingClientRect(), url=document.getElementById("job-url").getBoundingClientRect(), jd=document.getElementById("job-description").getBoundingClientRect(); const padding=parseFloat(getComputedStyle(document.querySelector(".job-tools")).paddingRight); return nav.width<120 && toggle.left>=nav.right && read.left>=toggle.right && Math.abs(tools.right-padding-read.right)<1 && read.top<company.top && company.right<role.left && Math.abs(role.top-company.top)<1 && url.top>role.top && jd.top>url.bottom; })()'), true, `job field layout at ${width}px`);
      }
      layouts.push(layout);
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
  await click('#results-tab');
  await read('document.getElementById("studio-scroll").scrollTop = 0');
  await read("chrome.storage.local.set({'ui-theme:v1':'dark'})");
  await until(()=>read('document.documentElement.dataset.theme==="dark"'),'dark theme');
  await screenshot('workspace-dark.png');
  await read("chrome.storage.local.set({'ui-theme:v1':'light'})");
  await until(()=>read('document.documentElement.dataset.theme==="light"'),'light theme');
  await read('if (document.getElementById("chat-view").hidden) document.getElementById("chat-dock-toggle").click()');
  assert.equal(await read('document.querySelectorAll("#studio-tab, #chat-tab, #tracker-return, .chat-dock-heading").length'), 0, 'former tabs and duplicate chat header removed');
  assert.equal(await read('document.querySelectorAll(".dock-status-bar").length'), 1, 'one status bar serves both collapsed and expanded chat');
  assert.equal(await read('document.getElementById("chat-dock-toggle").getAttribute("aria-expanded")'), 'true');
  assert.equal(await read('getComputedStyle(document.querySelector(".dock-status-bar"), "::before").display'), 'block', 'expanded chat shows its top separator');
  assert.equal(await read('document.getElementById("studio-content").hidden && document.querySelector(".queue-filters").getClientRects().length === 0'), true, 'only the job header remains while chat is open');
  await click('#account-toggle');
  assert.equal(await read(`(() => {
    const bar=document.querySelector('.dock-status-bar').getBoundingClientRect(), account=document.getElementById('account-toggle').getBoundingClientRect(), popup=document.getElementById('account-panel').getBoundingClientRect();
    const chat=document.getElementById('chat-view').getBoundingClientRect();
    return account.top>=bar.top && account.bottom<=bar.bottom && Math.abs(bar.bottom-chat.top)<1 && popup.top>=0 && popup.bottom<=innerHeight && (popup.bottom<account.top || popup.top>account.bottom);
  })()`), true, 'account menu stays in view from the raised status bar');
  await click('#account-toggle');
  for (const width of [280, 390, 800]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: false }, panel);
    assert.equal(await read(`(() => {
      const studio=document.getElementById('studio-view').getBoundingClientRect(), chat=document.getElementById('chat-view').getBoundingClientRect(), bar=document.querySelector('.dock-status-bar').getBoundingClientRect();
      const capture=document.getElementById('capture-current-job').getBoundingClientRect();
      return studio.height===bar.height+capture.height && Math.abs(studio.bottom-bar.top)<1 && Math.abs(bar.bottom-chat.top)<1 && Math.abs(chat.bottom-innerHeight)<1 && document.documentElement.scrollWidth<=innerWidth;
    })()`), true, 'expanded chat and tracker fit a short dock at ' + width);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panel);
  await screenshot('workspace-dock.png');
  const savedDeepseek = 'https://chat.deepseek.com/a/chat/s/11111111-1111-4111-8111-111111111111';
  await click('#account-toggle');
  await setValue('#chat-provider', 'deepseek');
  await until(() => read('!document.getElementById("chat-provider").disabled && !document.getElementById("deepseek-pane").hidden'), 'DeepSeek selected for saved job');
  await evaluate(deepseekSession, `history.pushState({},'',${JSON.stringify(savedDeepseek)});dispatchEvent(new PopStateEvent('popstate'));`);
  await read('new Promise(resolve => setTimeout(resolve, 1700))');
  await click('#chat-dock-toggle');
  await click('[data-request-id="1"] [data-action="details"]');
  await click('#request-connect-chat');
  const savedRequest = () => read('import(chrome.runtime.getURL("src/queue-store.mjs")).then(module=>module.createQueueStore().read()).then(state=>state.requests.find(item=>item.id===1))');
  await until(async () => (await savedRequest())?.manualChatUrl === savedDeepseek, 'DeepSeek conversation saved on the job');
  await closeDialog('request-dialog');
  await evaluate(deepseekSession, 'history.pushState({},"","/a/chat/s/22222222-2222-4222-8222-222222222222");document.querySelector("textarea").value="Preserve saved-chat draft";document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('document.getElementById("deepseek-new-chat").disabled'), 'saved chat sees live DeepSeek draft guard');
  await click('[data-request-id="1"] [data-action="review"]');
  await until(() => text('#workspace-status').then(value => value.includes('Finish your DeepSeek draft')), 'saved chat reports the draft guard');
  assert.equal(await evaluate(deepseekSession, 'location.pathname'), '/a/chat/s/22222222-2222-4222-8222-222222222222');
  assert.equal(await evaluate(deepseekSession, 'document.querySelector("textarea").value'), 'Preserve saved-chat draft');
  await evaluate(deepseekSession, 'document.querySelector("textarea").value="";document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(() => read('!document.getElementById("deepseek-new-chat").disabled'), 'saved chat draft cleared');
  await click('[data-request-id="1"] [data-action="review"]');
  await until(() => evaluate(deepseekSession, `location.href === ${JSON.stringify(savedDeepseek)}`), 'saved job opens its DeepSeek conversation in the dock');
  await until(() => read('!document.getElementById("deepseek-new-chat").disabled'), 'saved DeepSeek conversation reconnects');
  await click('#account-toggle');
  await setValue('#chat-provider', 'chatgpt');
  await until(() => read('!document.getElementById("chat-provider").disabled && !document.getElementById("chatgpt-pane").hidden'), 'return to ChatGPT after saved link');
  await click('#chat-dock-toggle');
  await click('[data-request-id="1"] [data-action="documents"]');
  await setValue('#documents-resume', '{}', 'input');
  assert.equal(await read('document.getElementById("documents-save").disabled'), true, 'invalid resume cannot be saved');
  const documentRequest = await savedRequest();
  await read(`(() => { const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(documentRequest.resume))}], 'Resume.json', {type:'application/json'}));
    const field=document.getElementById('documents-file');field.files=transfer.files;field.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(() => read('!document.getElementById("documents-save").disabled'), 'imported resume validated against the saved job');
  await click('#documents-cover-enabled');
  await setValue('#documents-cover-letter', 'A reviewed cover letter for Northstar.', 'input');
  await screenshot('workspace-documents.png');
  await closeDialog('documents-dialog');
  assert.equal((await savedRequest()).coverLetter, undefined, 'cancel leaves saved documents unchanged');
  await click('[data-request-id="1"] [data-action="documents"]');
  await click('#documents-cover-enabled');
  await setValue('#documents-cover-letter', 'A reviewed cover letter for Northstar.', 'input');
  await click('#documents-save');
  await until(() => read('!document.getElementById("documents-dialog").open'), 'manual documents saved');
  assert.equal((await savedRequest()).coverLetter, 'A reviewed cover letter for Northstar.');
  assert.equal((await savedRequest()).state, 'ready');
  await click('[data-request-id="1"] [data-action="cover-letter"]');
  assert.equal(await read('document.getElementById("cover-letter-dialog").open'), true);
  assert.equal(await text('#cover-letter-copy'), 'A reviewed cover letter for Northstar.');
  await screenshot('workspace-cover-letter.png');
  await closeDialog('cover-letter-dialog');
  assert.equal((await savedRequest()).coverLetter, 'A reviewed cover letter for Northstar.', 'viewing a cover letter does not edit it');
  await click('#chat-dock-toggle');
  await checkCurrentJobUI({ cdp, panel, read, click, until, screenshot, frameSession, evaluate, checkChatViewportAcrossCollapse });
  return { layouts, checks: ['single dock with bottom chat accordion and account menu', 'ChatGPT frame and draft retained', 'Studio form retained',
    'one-click job capture stays available above expanded chat, hides for non-web and saved URLs, and never sends a prompt',
    'queue search and status filters preserve records', 'exclusive job and chat accordions with matching headers', 'one status bar rises above chat and returns to the bottom on collapse', 'account popup stays in view beside the raised status bar', 'expanded chat and tracker fit narrow and short panels',
    'saved jobs connect and reopen DeepSeek conversations with a live draft guard',
    'manual resume JSON import validation and optional cover letter persist; Cancel leaves stored documents unchanged',
    'vertical ChatGPT history arrows follow native order from the top', 'Up disabled on new and most recent chats with no boundary wrapping', 'history navigation blocks drafts and generation and restores native sidebar visibility',
    'Job Queues label and sidebar shortcuts in Settings', 'trusted Ctrl+Up/Down and Ctrl+Left/Right work in the host and ChatGPT iframe', 'Ctrl+Enter adds a validated job once while preserving the ChatGPT draft and blocking native send handlers', 'duplicate Ctrl+Enter shows Already applied without adding, copying or changing the Chat draft', 'dialogs preserve their own keyboard controls',
    'live open-tab navigation and per-tab drafts', 'hover toolbar reveal and dismissal without resizing chat',
    'new chat and refresh on the left with a far-right pin', 'pin saves its preference and survives pointer leave, outside clicks, Escape and view switches', 'pinned toolbar reserves its own row without covering the iframe at narrow and wide widths', 'unpin restores hover behavior and full iframe height',
    'text sizing preserves iframe size, viewport, layout spacing, and drafts', 'new and nested messages scale without compounding',
    'all eight baseline resume thumbnails load',
    'compact tab controls and side-by-side job fields', 'base resume keeps job extraction visible while hiding the prompt template',
    'keyword settings persistence and far-right Read page control', 'dock and ChatGPT never receive keyword highlights',
    'separate color lists retain unsaved edits and save together', 'legacy Pink keywords migrate to Red', 'hidden invalid lists block saving and receive focus',
    'per-tab job URLs and immutable source URL snapshots', 'compact footer without visible status rows',
    'saved company source links remain available in Details', 'Search chats opens the provider native dialog', 'custom saved-title search removed',
    'Chat has no Studio footer', 'fixed Studio action buttons',
    'candidate isolation and empty state', 'template and prompt previews', 'immutable request snapshots', 'queued example cancellation',
    'local saved documents', 'base resume example', 'resume preview and JSON copy', 'export availability',
    'literal job text rendering', 'account panel', 'dialog Escape and keyboard tabs', 'fixed controls and narrow layouts', 'light and dark themes'] };
}
