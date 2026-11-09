import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function captureCommandHandler({ cdp, id, workerSession, dockSession, evaluate, until }) {
  // Service workers forbid dynamic import. Read the registered callback from its
  // module scope through the debugger, without adding a production test hook.
  const source = await readFile(new URL('../src/service-worker.mjs', import.meta.url), 'utf8');
  const lineNumber = source.split('\n').findIndex(line => line.includes('if (sender.id !=='));
  let paused;
  cdp.on('Debugger.paused', (event, current) => { if (current === workerSession) paused = event; });
  await cdp.send('Debugger.enable', {}, workerSession);
  const { breakpointId } = await cdp.send('Debugger.setBreakpointByUrl', {
    url: `chrome-extension://${id}/src/service-worker.mjs`, lineNumber
  }, workerSession);
  const probe = evaluate(dockSession, 'chrome.runtime.sendMessage({ type: "sidebar.initialize" })');
  try {
    await until(() => paused, 'worker message breakpoint');
    const result = await cdp.send('Debugger.evaluateOnCallFrame', {
      callFrameId: paused.callFrames[0].callFrameId,
      expression: 'globalThis.readJobCommandForTest = readPageCommands.handle; undefined'
    }, workerSession);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  } finally {
    await cdp.send('Debugger.removeBreakpoint', { breakpointId }, workerSession);
    await cdp.send('Debugger.resume', {}, workerSession);
    await cdp.send('Debugger.disable', {}, workerSession);
    await probe;
  }
}

// CDP cannot press browser accelerators. Verify Chrome's assigned shortcut and
// invoke its worker handler from a native extension action, preserving the
// user gesture and activeTab grant while exercising delivery to warm/cold docks.
export async function checkReadPageShortcut({ cdp, id, workerSession, sourceSession, dockSession, evaluate, until, session }) {
  const worker = code => evaluate(workerSession, code);
  const workerErrors = [];
  cdp.on('Runtime.consoleAPICalled', (event, current) => {
    if (current === workerSession && event.type === 'error') workerErrors.push(event.args.map(arg => arg.value || arg.description).join(' '));
  });
  const commands = await worker('chrome.commands.getAll()');
  const shortcut = commands.find(command => command.name === 'read-job-page')?.shortcut;
  assert.ok(['Ctrl+Shift+F', 'Command+Shift+F', '\u2318\u21e7F'].includes(shortcut), `Read page shortcut assigned: ${shortcut}`);
  const url = 'https://jobs.example.test/extract/jsonld-graph';
  await cdp.send('Page.navigate', { url }, sourceSession);
  await until(() => evaluate(sourceSession, 'document.body?.dataset.extractionFixture === "jsonld-graph"'), 'shortcut job fixture');
  const target = await until(async () => (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(item => item.url === url), 'shortcut source tab');
  // Grant temporary site access. Actual command events grant activeTab too;
  // invoking the JS listener directly cannot emulate Chrome's permission grant.
  await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
  await captureCommandHandler({ cdp, id, workerSession, dockSession, evaluate, until });
  await worker('chrome.action.onClicked.addListener(globalThis.commandFromActionForTest = tab => readJobCommandForTest("read-job-page", tab))');
  const tab = await worker('chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(tabs => tabs[0])');
  assert.equal(tab.url, url);
  await evaluate(dockSession, 'document.getElementById("chat-tab").click(); for (const key of ["company","title","description"]) document.getElementById("job-"+key).value=""');
  await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
  const readComplete = current => evaluate(current, 'document.getElementById("job-company").value === "Graph Works" && document.getElementById("read-page").getAttribute("aria-busy") === "false"');
  try { await until(() => readComplete(dockSession), 'warm dock shortcut reads job'); }
  catch (error) {
    const state = await evaluate(dockSession, '(async () => ({hint:document.getElementById("read-page").title,status:document.getElementById("workspace-status").textContent,company:document.getElementById("job-company").value,studio:!document.getElementById("studio-view").hidden,ownTab:await chrome.tabs.getCurrent()}))()');
    throw new Error(`${error.message}: ${JSON.stringify({ state, workerErrors })}`);
  }
  assert.equal(await evaluate(dockSession, '!document.getElementById("studio-view").hidden && !document.getElementById("job-panel").hidden'), true);
  assert.equal(await evaluate(dockSession, 'document.getElementById("job-title").value'), 'Platform Engineer');
  assert.ok((await evaluate(dockSession, 'document.getElementById("job-description").value')).includes('Responsibilities'));
  const oldDocument = (await worker('chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })'))[0].documentId;
  await worker(`chrome.sidePanel.close({ windowId: ${tab.windowId} })`);
  await until(() => worker('chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }).then(items => items.length === 0)'), 'close dock before command');
  await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
  await until(() => worker(`chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }).then(items => items.some(item => item.documentId !== ${JSON.stringify(oldDocument)}))`), 'shortcut opens a fresh dock');
  // The harness also has index.html in a regular tab; select the side-panel's
  // target using getCurrent() rather than accidentally inspecting that tab.
  const nextSession = await until(async () => {
    const targets = (await cdp.send('Target.getTargets')).targetInfos;
    for (const item of targets.filter(item => item.url === `chrome-extension://${id}/index.html`)) {
      const candidate = await session(item.targetId);
      if (await evaluate(candidate, 'chrome.tabs.getCurrent().then(tab => !tab)')) return candidate;
    }
  }, 'fresh shortcut dock target');
  await until(() => readComplete(nextSession), 'cold dock startup consumes queued read');
  assert.equal(await evaluate(nextSession, '!document.getElementById("studio-view").hidden && !document.getElementById("job-panel").hidden'), true);
  assert.equal(await evaluate(nextSession, 'document.getElementById("job-url").value'), url);
  await worker('chrome.action.onClicked.removeListener(commandFromActionForTest); delete globalThis.commandFromActionForTest; delete globalThis.readJobCommandForTest');
  return { dockSession: nextSession, shortcut, warmDock: true, coldDock: true, physicalKeyboard: false };
}
