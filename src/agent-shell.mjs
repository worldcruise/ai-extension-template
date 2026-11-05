import { AgentController } from './controller.mjs';

const mode = field => !field.visible ? 'hidden' : field.editable ? 'editable' : 'fixed';
const friendly = text => text.charAt(0).toUpperCase() + text.slice(1);
let nextId = 0;

export function mountAgent(root, { definition, adapter, clipboard = globalThis.navigator?.clipboard }) {
  const controller = new AgentController({ definition, adapter });
  const uid = `at-agent-${++nextId}`;
  root.classList.add('at-agent');
  // Only static markup is inserted as HTML. All provider and user text uses textContent/value.
  root.innerHTML = `
    <header class="agent-topbar">
      <div class="agent-account">
        <button type="button" class="agent-signin" data-el="signin"><span class="account-mark" aria-hidden="true">↗</span><span data-el="signin-label"></span></button>
        <span class="account-name" data-el="account" hidden></span>
        <button type="button" class="agent-text-button" data-el="signout" hidden>Sign out</button>
      </div>
      <div class="agent-selectors" data-el="selectors">
        <label class="compact-picker" for="${uid}-model"><span>Model</span><select id="${uid}-model" data-el="model"></select></label>
        <label class="compact-picker effort-picker" for="${uid}-effort"><span>Thinking effort</span><select id="${uid}-effort" data-el="effort"></select></label>
      </div>
    </header>
    <nav class="agent-tabs" role="tablist" aria-label="Agent workspace">
      <button type="button" id="${uid}-agent-tab" role="tab" aria-selected="true" aria-controls="${uid}-workspace" data-tab="workspace">Agent</button>
      <button type="button" id="${uid}-settings-tab" role="tab" aria-selected="false" aria-controls="${uid}-settings" tabindex="-1" data-tab="settings">Settings</button>
    </nav>
    <div class="agent-status" data-el="status" data-tone="busy" role="status" aria-live="polite" aria-atomic="true">
      <span class="status-light" aria-hidden="true"></span><span data-el="status-message"></span>
    </div>
    <section id="${uid}-workspace" class="agent-workspace" role="tabpanel" aria-labelledby="${uid}-agent-tab" data-panel="workspace">
      <div class="agent-heading"><div><p class="agent-eyebrow">APPLICATION TRACKER</p><h1 data-el="title"></h1></div><span class="agent-version">BASE TEMPLATE</span></div>
      <div class="agent-grid">
        <div class="agent-inputs">
          <section class="agent-panel prompt-panel" data-el="prompt-panel">
            <div class="panel-heading"><label for="${uid}-prompt" data-el="prompt-label"></label><span class="field-mode" data-el="prompt-mode"></span></div>
            <textarea id="${uid}-prompt" data-el="prompt" spellcheck="false"></textarea>
          </section>
          <section class="agent-panel input-panel" data-el="input-panel">
            <div class="panel-heading"><label for="${uid}-input" data-el="input-label"></label><span class="field-mode" data-el="input-mode"></span></div>
            <textarea id="${uid}-input" data-el="input" spellcheck="false"></textarea>
          </section>
          <div class="agent-runbar"><span class="keyboard-hint">Ctrl / ⌘ + Enter to run</span><div><button type="button" class="agent-secondary" data-el="cancel" hidden>Cancel</button><button type="button" class="agent-go" data-el="go">Go <span aria-hidden="true">↗</span></button></div></div>
        </div>
        <section class="agent-panel result-panel" aria-labelledby="${uid}-result-heading">
          <div class="panel-heading"><h2 id="${uid}-result-heading" data-el="result-label"></h2><button type="button" class="agent-text-button" data-el="copy" disabled>Copy result</button></div>
          <div class="result-body"><p class="result-placeholder" data-el="result-empty"></p><pre data-el="result" tabindex="0" hidden></pre></div>
        </section>
      </div>
    </section>
    <section id="${uid}-settings" class="agent-settings" role="tabpanel" aria-labelledby="${uid}-settings-tab" data-panel="settings" hidden>
      <div class="agent-heading"><div><p class="agent-eyebrow">REUSABLE BASELINE</p><h1>Template settings</h1></div></div>
      <form class="agent-panel settings-form" data-el="settings-form" novalidate>
        <label for="${uid}-title">Template name</label><input id="${uid}-title" data-el="settings-title" maxlength="100" required>
        <div class="settings-columns">
          <div><label for="${uid}-prompt-mode">Prompt template</label><select id="${uid}-prompt-mode" data-el="settings-prompt"><option value="editable">Editable</option><option value="fixed">Fixed · read only</option><option value="hidden">Fixed · hidden</option></select></div>
          <div><label for="${uid}-input-mode">Test input</label><select id="${uid}-input-mode" data-el="settings-input"><option value="editable">Editable</option><option value="fixed">Fixed · read only</option><option value="hidden">Fixed · hidden</option></select></div>
        </div>
        <p class="settings-help">Fixed fields use their current value. Changes apply to this session.</p>
        <div class="settings-actions"><button type="submit" class="agent-go">Apply changes</button><button type="button" class="agent-secondary" data-el="reload-models">Reload models</button></div>
      </form>
    </section>`;

  const el = Object.fromEntries([...root.querySelectorAll('[data-el]')].map(node => [node.dataset.el, node]));
  const tabs = [...root.querySelectorAll('[data-tab]')];
  const panels = [...root.querySelectorAll('[data-panel]')];
  const events = new AbortController();
  const on = (node, event, fn) => node.addEventListener(event, fn, { signal: events.signal });
  const options = (select, values, selected, empty) => {
    const items = values.length ? values : [{ value: '', label: empty }];
    const signature = JSON.stringify(items);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...items.map(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        return option;
      }));
      select.dataset.options = signature;
    }
    select.value = selected;
  };
  const syncSettings = () => {
    const d = controller.state.definition;
    el['settings-title'].value = d.title;
    el['settings-prompt'].value = mode(d.prompt);
    el['settings-input'].value = mode(d.input);
  };
  const selectTab = name => {
    for (const tab of tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
    if (name === 'settings') syncSettings();
  };
  for (const tab of tabs) {
    on(tab, 'click', () => selectTab(tab.dataset.tab));
    on(tab, 'keydown', event => {
      const index = tabs.indexOf(tab);
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
      if (target >= 0) {
        event.preventDefault();
        selectTab(tabs[target].dataset.tab);
        tabs[target].focus();
      }
    });
  }

  controller.subscribe(state => {
    const d = state.definition;
    const account = state.session?.user.name;
    const authBusy = Boolean(state.busy && state.busy !== 'running');
    el.signin.hidden = Boolean(account);
    el.signin.disabled = authBusy;
    el['signin-label'].textContent = d.preview ? 'Preview sign in' : `Sign in with ${d.provider}`;
    el.account.hidden = !account;
    el.account.textContent = account || '';
    el.signout.hidden = !account;
    el.signout.disabled = authBusy;
    el.selectors.hidden = !d.modelSelection;
    options(el.model, state.models.map(model => ({ value: model.id, label: model.label })), state.model,
      account ? 'No models available' : 'Sign in to select');
    const model = state.models.find(model => model.id === state.model);
    options(el.effort, (model?.thinkingEfforts || []).map(value => ({ value, label: friendly(value) })),
      state.thinkingEffort, model ? 'Not available' : '—');
    el.model.disabled = authBusy || state.models.length === 0;
    el.effort.disabled = authBusy || !model?.thinkingEfforts.length;
    el.status.dataset.tone = state.status.tone;
    el['status-message'].textContent = `${d.preview ? 'Preview only · ' : ''}${state.status.message}${d.preview ? ' No live connection.' : ''}`;
    el.title.textContent = d.title;
    for (const field of ['prompt', 'input']) {
      el[`${field}-panel`].hidden = !d[field].visible;
      el[`${field}-label`].textContent = d[field].label;
      el[field].readOnly = !d[field].editable;
      el[field].placeholder = d[field].placeholder || '';
      if (el[field].value !== d[field].value) el[field].value = d[field].value;
      el[`${field}-mode`].textContent = d[field].editable ? '' : 'FIXED';
    }
    el['result-label'].textContent = d.result.label;
    el['result-empty'].textContent = d.result.placeholder;
    el['result-empty'].hidden = state.result !== null;
    el.result.hidden = state.result === null;
    el.result.textContent = state.result ?? '';
    el.copy.disabled = state.result === null || state.busy === 'running';
    el.go.disabled = !controller.ready;
    el.cancel.hidden = state.busy !== 'running';
    el['reload-models'].hidden = !d.modelSelection;
    el['reload-models'].disabled = !account || Boolean(state.busy);
    root.querySelector('.result-panel').setAttribute('aria-busy', String(state.busy === 'running'));
  });
  syncSettings();
  on(el.signin, 'click', () => controller.signIn());
  on(el.signout, 'click', () => controller.signOut());
  on(el.model, 'change', () => controller.setModel(el.model.value));
  on(el.effort, 'change', () => controller.setEffort(el.effort.value));
  on(el.prompt, 'input', () => controller.setValue('prompt', el.prompt.value));
  on(el.input, 'input', () => controller.setValue('input', el.input.value));
  on(el.go, 'click', () => controller.run());
  on(el.cancel, 'click', () => controller.cancel());
  on(el['reload-models'], 'click', () => controller.reloadModels());
  on(el.copy, 'click', async () => {
    const result = controller.state.result;
    const epoch = controller.runEpoch;
    try {
      if (!clipboard?.writeText) throw new Error('Copy is unavailable here. Select the result text to copy it.');
      await clipboard.writeText(result);
      if (controller.alive && epoch === controller.runEpoch) controller.status('success', 'Result copied.');
    } catch (error) {
      if (controller.alive && epoch === controller.runEpoch) controller.status('error', error?.message || 'Could not copy the result.');
    }
  });
  on(el['settings-form'], 'submit', event => {
    event.preventDefault();
    if (controller.configure({ title: el['settings-title'].value,
      promptMode: el['settings-prompt'].value, inputMode: el['settings-input'].value })) selectTab('workspace');
  });
  on(root, 'keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !panels[0].hidden) {
      event.preventDefault();
      if (controller.ready) controller.run();
    }
  });
  const ready = controller.start();
  return { controller, ready, destroy() { events.abort(); controller.destroy(); root.replaceChildren(); root.classList.remove('at-agent'); } };
}
