import { AgentController } from './controller.mjs';

let nextId = 0;
export function mountAgent(root, { definition, adapter, navigation, connection, clipboard = globalThis.navigator?.clipboard }) {
  const controller = new AgentController({ definition, adapter });
  const uid = `ai-agent-${++nextId}`, doc = root.ownerDocument, events = new AbortController();
  const on = (node, event, handler) => node.addEventListener(event, handler, { signal: events.signal });
  root.classList.add('ai-agent');
  // Static markup only. User/provider content is always assigned as literal text.
  root.innerHTML = `
    <header class="agent-topbar">
      <div class="agent-account"><button type="button" data-el="signin">Sign in with ChatGPT</button><span data-el="account" hidden></span><button type="button" data-el="signout" hidden>Sign out</button></div>
      <div class="agent-selectors" data-el="selectors"><label for="${uid}-model">Model<select id="${uid}-model" data-el="model" disabled></select></label><label for="${uid}-effort">Thinking effort<select id="${uid}-effort" data-el="effort" disabled></select></label></div>
    </header>
    <div class="agent-navigation-group"><nav class="agent-navigation" data-el="navigation" aria-label="Agent navigation">
      <div class="browser-buttons"><button type="button" data-el="previous" disabled>Previous tab</button><button type="button" data-el="next" disabled>Next tab</button></div>
      <div class="agent-tabs" role="tablist" aria-label="Agent workspace"><button type="button" id="${uid}-agent-tab" role="tab" aria-selected="true" aria-controls="${uid}-workspace" data-tab="workspace">Agent</button><button type="button" id="${uid}-settings-tab" role="tab" aria-selected="false" aria-controls="${uid}-settings" tabindex="-1" data-tab="settings">Settings</button></div>
    </nav><div class="agent-status" data-el="status" data-tone="busy" role="status" aria-live="polite" aria-atomic="true"><span class="status-light" aria-hidden="true"></span><span data-el="status-message"></span></div></div>
    <section id="${uid}-workspace" role="tabpanel" aria-labelledby="${uid}-agent-tab" data-panel="workspace" class="agent-workspace">
      <h1 data-el="title"></h1>
      <section class="agent-panel" data-el="prompt-panel"><label for="${uid}-prompt" data-el="prompt-label"></label><textarea id="${uid}-prompt" data-el="prompt" spellcheck="false" rows="6"></textarea></section>
      <section class="agent-panel" data-el="input-panel"><label for="${uid}-input" data-el="input-label"></label><textarea id="${uid}-input" data-el="input" spellcheck="false" rows="6"></textarea></section>
      <div class="agent-runbar"><span class="keyboard-hint">Ctrl / ⌘ + Enter to run</span><div><button type="button" data-el="cancel" hidden>Cancel</button><button type="button" class="primary" data-el="go">Go</button></div></div>
      <section class="agent-panel result-panel" aria-labelledby="${uid}-result-label"><div class="result-heading"><h2 id="${uid}-result-label" data-el="result-label"></h2><button type="button" data-el="copy" disabled>Copy</button></div><p class="result-placeholder" data-el="result-empty"></p><div data-el="custom-result" hidden></div><pre data-el="result" tabindex="0" hidden></pre></section>
    </section>
    <section id="${uid}-settings" role="tabpanel" aria-labelledby="${uid}-settings-tab" data-panel="settings" class="agent-settings" hidden>
      <h2>Settings</h2><form data-el="connection-form" novalidate><label for="${uid}-url">Hosted agent HTTPS origin</label><div class="connection-row"><input type="url" id="${uid}-url" data-el="url" placeholder="https://your-agent.example" autocomplete="off" required><button type="submit" data-el="save">Save</button></div></form>
      <button type="button" data-el="reload-models">Reload models</button>
    </section>`;
  const el = Object.fromEntries([...root.querySelectorAll('[data-el]')].map(node => [node.dataset.el, node]));
  const tabs = [...root.querySelectorAll('[data-tab]')], panels = [...root.querySelectorAll('[data-panel]')];
  const options = (select, values, selected, empty) => {
    const items = values.length ? values : [{ value: '', label: empty }], signature = JSON.stringify(items);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...items.map(item => { const option = doc.createElement('option'); option.value = item.value; option.textContent = item.label; return option; }));
      select.dataset.options = signature;
    }
    select.value = selected;
  };
  function selectTab(name) {
    for (const tab of tabs) { const active = tab.dataset.tab === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
  }
  for (const tab of tabs) {
    on(tab, 'click', () => selectTab(tab.dataset.tab));
    on(tab, 'keydown', event => {
      const index = tabs.indexOf(tab), target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
      if (target >= 0) { event.preventDefault(); selectTab(tabs[target].dataset.tab); tabs[target].focus(); }
    });
  }
  let lastOutput, navigationEpoch = 0;
  controller.subscribe(state => {
    const d = state.definition, account = state.session?.user, authBusy = Boolean(state.busy && state.busy !== 'running');
    el.signin.hidden = Boolean(account); el.signin.disabled = authBusy;
    el.signin.textContent = d.preview ? 'Preview sign in' : `Sign in with ${d.provider}`;
    el.account.hidden = !account; el.account.textContent = account ? `${account.name} · ${account.id.slice(-8)}` : '';
    el.signout.hidden = !account; el.signout.disabled = authBusy; el.selectors.hidden = !d.modelSelection;
    options(el.model, state.models.map(model => ({ value: model.id, label: model.label })), state.model, account ? 'No models available' : 'Sign in to select');
    const model = state.models.find(model => model.id === state.model);
    options(el.effort, (model?.thinkingEfforts || []).map(value => ({ value, label: value })), state.thinkingEffort, 'Not available');
    el.model.disabled = authBusy || !state.models.length; el.effort.disabled = authBusy || !model?.thinkingEfforts.length;
    el.status.dataset.tone = state.status.tone;
    el['status-message'].textContent = `${d.preview ? 'Preview only · ' : ''}${state.status.message}${d.preview ? ' No live connection.' : ''}`;
    el.title.textContent = d.title;
    for (const field of ['prompt', 'input']) {
      el[`${field}-panel`].hidden = !d[field].visible; el[`${field}-label`].textContent = d[field].label;
      el[field].readOnly = !d[field].editable; el[field].placeholder = d[field].placeholder || '';
      if (el[field].value !== d[field].value) el[field].value = d[field].value;
    }
    el['result-label'].textContent = d.result.label; el['result-empty'].textContent = d.result.placeholder;
    el['result-empty'].hidden = state.result !== null; el.result.hidden = state.result === null; el.result.textContent = state.result ?? '';
    el['custom-result'].hidden = state.output === null || typeof d.result.render !== 'function';
    if (lastOutput !== state.output) { lastOutput = state.output; el['custom-result'].replaceChildren(); if (state.output && typeof d.result.render === 'function') d.result.render(el['custom-result'], state.output); }
    el.copy.disabled = state.result === null || Boolean(state.busy); el.go.disabled = !controller.ready; el.cancel.hidden = state.busy !== 'running';
    el['reload-models'].hidden = !d.modelSelection; el['reload-models'].disabled = !account || Boolean(state.busy);
    root.querySelector('.result-panel').setAttribute('aria-busy', String(state.busy === 'running'));
  });
  el['connection-form'].hidden = !connection;
  on(el['connection-form'], 'submit', async event => {
    event.preventDefault(); if (!connection) return; el.save.disabled = true;
    try { await connection.save(el.url.value, controller); }
    catch (error) { controller.status('error', error?.message || 'Could not configure the hosted agent.'); }
    finally { if (controller.alive) el.save.disabled = false; }
  });
  on(el.signin, 'click', () => controller.signIn()); on(el.signout, 'click', () => controller.signOut());
  on(el.model, 'change', () => controller.setModel(el.model.value)); on(el.effort, 'change', () => controller.setEffort(el.effort.value));
  for (const field of ['prompt', 'input']) on(el[field], 'input', () => controller.setValue(field, el[field].value));
  on(el.go, 'click', () => controller.run()); on(el.cancel, 'click', () => controller.cancel()); on(el['reload-models'], 'click', () => controller.reloadModels());
  on(root, 'keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !panels[0].hidden) { event.preventDefault(); if (controller.ready) controller.run(); } });
  on(el.copy, 'click', async () => {
    const epoch = controller.runEpoch;
    try { if (!clipboard?.writeText) throw new Error('Copy is unavailable. Select the output text to copy it.'); await clipboard.writeText(controller.state.result); if (controller.alive && epoch === controller.runEpoch) controller.status('success', 'Output copied.'); }
    catch { if (controller.alive && epoch === controller.runEpoch) controller.status('error', 'Could not copy. Select the output text to copy it.'); }
  });
  async function refreshNavigation() {
    const epoch = ++navigationEpoch;
    try { const state = await navigation?.status(); if (!controller.alive || epoch !== navigationEpoch) return; el.previous.disabled = el.next.disabled = !state?.available || state.count < 2; }
    catch { if (controller.alive && epoch === navigationEpoch) el.previous.disabled = el.next.disabled = true; }
  }
  for (const [name, direction] of [['previous', -1], ['next', 1]]) on(el[name], 'click', async () => {
    const auth = controller.authEpoch, run = controller.runEpoch;
    try { const result = await navigation.move(direction); if (controller.alive && auth === controller.authEpoch && run === controller.runEpoch) controller.status(controller.state.busy ? 'busy' : 'neutral', result.message); }
    catch (error) { if (controller.alive && auth === controller.authEpoch && run === controller.runEpoch) controller.status('error', error?.message || 'The browser tab could not be selected.'); }
    await refreshNavigation();
  });
  const ready = controller.start(); void refreshNavigation();
  return { controller, ready, refreshNavigation, setConnectionUrl(value) { if (doc.activeElement !== el.url) el.url.value = value; },
    destroy() { ++navigationEpoch; events.abort(); controller.destroy(); root.replaceChildren(); root.classList.remove('ai-agent'); } };
}
