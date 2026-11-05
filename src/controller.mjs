import { defineAgent, formatResult } from './definition.mjs';

function verifiedSession(value, now) {
  if (!value || value.authenticated !== true || typeof value.user?.name !== 'string' || !value.user.name.trim()) return null;
  if (value.expiresAt != null) {
    const expiry = typeof value.expiresAt === 'number' ? value.expiresAt : Date.parse(value.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) return null;
  }
  return value;
}

function normalizeModels(values) {
  if (!Array.isArray(values)) throw new TypeError('Model list is unavailable.');
  const ids = new Set();
  return values.map(model => {
    if (!model?.id || typeof model.id !== 'string' || ids.has(model.id)) {
      throw new TypeError('Models must have unique string ids.');
    }
    ids.add(model.id);
    const efforts = [...new Set(model.thinkingEfforts ?? [])];
    if (efforts.some(value => typeof value !== 'string' || !value)) {
      throw new TypeError('Thinking efforts must be nonempty strings.');
    }
    return { ...model, label: model.label || model.id, thinkingEfforts: efforts };
  });
}

export class AgentController {
  constructor({ definition, adapter, now = Date.now }) {
    for (const method of ['getSession', 'signIn', 'signOut', 'run']) {
      if (typeof adapter?.[method] !== 'function') throw new TypeError(`Adapter needs ${method}().`);
    }
    this.adapter = adapter;
    this.now = now;
    this.listeners = new Set();
    this.authEpoch = 0;
    this.runEpoch = 0;
    this.alive = true;
    this.state = {
      definition: defineAgent(definition),
      session: null,
      models: [],
      model: '',
      thinkingEffort: '',
      busy: 'checking',
      result: null,
      status: { tone: 'busy', message: 'Checking sign-in…' },
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  emit() { if (this.alive) for (const listener of this.listeners) listener(this.state); }

  status(tone, message) {
    this.state.status = { tone, message };
    this.emit();
  }

  get ready() {
    const s = this.state;
    return this.alive && !s.busy && Boolean(s.session) &&
      (!s.definition.modelSelection || Boolean(s.model));
  }

  async start() { await this.authenticate(false); }

  async signIn() {
    if (this.state.busy && this.state.busy !== 'running') return;
    await this.authenticate(true);
  }

  async authenticate(connect) {
    const epoch = ++this.authEpoch;
    this.invalidateRun();
    this.authAbort?.abort();
    const abort = this.authAbort = new AbortController();
    this.state.busy = connect ? 'signing-in' : 'checking';
    this.status('busy', connect ? 'Completing sign-in…' : 'Checking sign-in…');
    try {
      if (connect) await this.adapter.signIn({ signal: abort.signal });
      // Opening/closing a login window is not evidence of a successful sign-in.
      const session = verifiedSession(await this.adapter.getSession({ signal: abort.signal }), this.now());
      if (!this.alive || epoch !== this.authEpoch) return;
      this.state.session = session;
      this.state.models = [];
      this.state.model = '';
      this.state.thinkingEffort = '';
      if (!session) {
        this.state.busy = null;
        this.status(connect ? 'warning' : 'neutral', connect
          ? 'Sign-in was not completed. Try again.'
          : 'Sign in to test your agent.');
        return;
      }
      await this.loadModels(abort.signal);
      if (!this.alive || epoch !== this.authEpoch) return;
      this.state.busy = null;
      const hasModels = !this.state.definition.modelSelection || this.state.models.length > 0;
      this.status(hasModels ? 'success' : 'warning', hasModels
        ? `Signed in as ${session.user.name}. Ready to test.`
        : 'Signed in, but no models are available. Use Reload models in Settings.');
    } catch (error) {
      if (!this.alive || epoch !== this.authEpoch) return;
      this.state.busy = null;
      this.status('error', error?.message || 'Sign-in could not be checked. Try again.');
    }
  }

  async loadModels(signal) {
    if (!this.state.definition.modelSelection) return;
    if (typeof this.adapter.getModels !== 'function') throw new TypeError('Adapter needs getModels().');
    const models = normalizeModels(await this.adapter.getModels({ signal }));
    if (signal?.aborted || !this.alive) return;
    this.state.models = models;
    this.state.model = models.some(model => model.id === this.state.model) ? this.state.model : models[0]?.id || '';
    this.chooseEffort();
  }

  async reloadModels() {
    if (!this.state.session || this.state.busy) return;
    this.state.busy = 'models';
    this.invalidateRun();
    this.status('busy', 'Loading available models…');
    const epoch = this.authEpoch;
    try {
      await this.loadModels(this.authAbort?.signal);
      if (!this.alive || epoch !== this.authEpoch) return;
      this.state.busy = null;
      this.status(this.state.models.length ? 'success' : 'warning', this.state.models.length
        ? 'Models updated. Ready to test.' : 'No models are available for this account.');
    } catch (error) {
      if (!this.alive || epoch !== this.authEpoch) return;
      this.state.busy = null;
      this.status('error', error?.message || 'Could not load models.');
    }
  }

  chooseEffort() {
    const model = this.state.models.find(model => model.id === this.state.model);
    const efforts = model?.thinkingEfforts || [];
    this.state.thinkingEffort = efforts.includes(this.state.thinkingEffort) ? this.state.thinkingEffort
      : efforts.includes(model?.defaultThinkingEffort) ? model.defaultThinkingEffort : efforts[0] || '';
  }

  setModel(id) {
    if (!this.state.models.some(model => model.id === id) || this.state.model === id) return;
    this.state.model = id;
    this.chooseEffort();
    this.changed('Model changed.');
  }

  setEffort(value) {
    const model = this.state.models.find(model => model.id === this.state.model);
    if (!model?.thinkingEfforts.includes(value) || value === this.state.thinkingEffort) return;
    this.state.thinkingEffort = value;
    this.changed('Thinking effort changed.');
  }

  setValue(field, value) {
    if (!['prompt', 'input'].includes(field) || !this.state.definition[field].editable) return;
    if (this.state.definition[field].value === value) return;
    this.state.definition = defineAgent({ ...this.state.definition,
      [field]: { ...this.state.definition[field], value } });
    this.changed(`${this.state.definition[field].label} changed.`);
  }

  configure({ title, promptMode, inputMode }) {
    if (this.state.busy && this.state.busy !== 'running') return;
    const modes = { editable: { editable: true, visible: true },
      fixed: { editable: false, visible: true }, hidden: { editable: false, visible: false } };
    if (!title?.trim() || !modes[promptMode] || !modes[inputMode]) {
      this.status('error', 'Enter a template name and choose valid field modes.');
      return false;
    }
    for (const [key, mode] of [['prompt', promptMode], ['input', inputMode]]) {
      if (mode !== 'editable' && this.state.definition[key].required && !this.state.definition[key].value.trim()) {
        this.status('warning', `Add ${this.state.definition[key].label.toLowerCase()} before making it fixed or hidden.`);
        return false;
      }
    }
    this.state.definition = defineAgent({ ...this.state.definition, title: title.trim(),
      prompt: { ...this.state.definition.prompt, ...modes[promptMode] },
      input: { ...this.state.definition.input, ...modes[inputMode] } });
    this.changed('Template updated for this session.');
    return true;
  }

  changed(message) {
    const stale = this.state.result !== null || this.state.busy === 'running';
    this.invalidateRun();
    if (stale) this.status('warning', `${message} Run again for a current result.`);
    else if (!this.state.busy) this.status('neutral',
      this.state.session ? message : `${message} Sign in to test.`);
    else this.emit();
  }

  invalidateRun() {
    ++this.runEpoch;
    this.runAbort?.abort();
    this.runAbort = null;
    this.state.result = null;
    if (this.state.busy === 'running') this.state.busy = null;
  }

  cancel() {
    if (this.state.busy !== 'running') return;
    this.invalidateRun();
    this.status('warning', 'Test canceled. Ready to try again.');
  }

  async run() {
    if (!this.ready) {
      if (!this.state.busy) this.status('warning', this.state.session
        ? 'Choose an available model first.' : 'Sign in before running a test.');
      return;
    }
    const d = this.state.definition;
    for (const field of ['prompt', 'input']) {
      if (d[field].required && !d[field].value.trim()) {
        this.status('warning', `Add ${d[field].label.toLowerCase()} before running a test.`);
        return;
      }
    }
    this.invalidateRun();
    const epoch = this.runEpoch;
    const abort = this.runAbort = new AbortController();
    const request = { agentId: d.id, prompt: d.prompt.value, input: d.input.value, signal: abort.signal };
    if (d.modelSelection) {
      request.model = this.state.model;
      if (this.state.thinkingEffort) request.thinkingEffort = this.state.thinkingEffort;
    }
    this.state.busy = 'running';
    this.status('busy', 'Running your test…');
    try {
      const session = verifiedSession(await this.adapter.getSession({ signal: abort.signal }), this.now());
      if (!this.alive || epoch !== this.runEpoch) return;
      if (!session) {
        this.state.session = null;
        this.state.models = [];
        this.state.model = '';
        this.state.thinkingEffort = '';
        this.state.busy = null;
        this.status('warning', 'Your session expired. Sign in again to test.');
        return;
      }
      this.state.session = session;
      const result = await this.adapter.run(request);
      if (!this.alive || epoch !== this.runEpoch || abort.signal.aborted) return;
      this.state.result = formatResult(result);
      this.state.busy = null;
      this.status('success', 'Test complete. Your result is ready.');
    } catch (error) {
      if (!this.alive || epoch !== this.runEpoch) return;
      this.state.busy = null;
      if (error?.status === 401 || error?.code === 'SESSION_EXPIRED') {
        this.state.session = null;
        this.state.models = [];
        this.state.model = '';
        this.state.thinkingEffort = '';
        this.status('warning', 'Your session expired. Sign in again to test.');
      } else this.status('error', error?.message || 'The test failed. Try again.');
    }
  }

  async signOut() {
    if (!this.state.session || (this.state.busy && this.state.busy !== 'running')) return;
    ++this.authEpoch;
    this.invalidateRun();
    this.state.busy = 'signing-out';
    this.status('busy', 'Signing out…');
    try {
      await this.adapter.signOut();
      const session = verifiedSession(await this.adapter.getSession({}), this.now());
      if (!this.alive) return;
      this.state.session = session;
      this.state.busy = null;
      if (session) this.status('error', 'Sign-out was not completed. Try again.');
      else {
        this.state.models = [];
        this.state.model = '';
        this.state.thinkingEffort = '';
        this.status('neutral', 'Signed out. Sign in to test your agent.');
      }
    } catch (error) {
      if (!this.alive) return;
      this.state.busy = null;
      this.status('error', error?.message || 'Could not sign out. Try again.');
    }
  }

  destroy() {
    this.alive = false;
    ++this.authEpoch;
    this.invalidateRun();
    this.authAbort?.abort();
    this.listeners.clear();
  }
}
