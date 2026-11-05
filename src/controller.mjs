import { defineAgent, formatResult } from './definition.mjs';

export function isSessionExpired(error) {
  return error?.status === 401 || ['SESSION_EXPIRED', 'session_expired', 'agent_authentication_required',
    'provider_authorization_expired', 'authentication_error'].includes(error?.code);
}
function verifiedSession(value, now) {
  if (!value || value.authenticated !== true) return null;
  if (typeof value.user?.id !== 'string' || !value.user.id.trim()) throw new TypeError('The verified session needs a stable account id.');
  if (typeof value.user.name !== 'string' || !value.user.name.trim()) throw new TypeError('The verified session needs an account label.');
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
    if (typeof model?.id !== 'string' || !model.id.trim() || ids.has(model.id)) throw new TypeError('Models must have unique string ids.');
    ids.add(model.id);
    if (!Array.isArray(model.thinkingEfforts ?? [])) throw new TypeError('Thinking efforts must be an array.');
    const efforts = [...new Set(model.thinkingEfforts ?? [])];
    if (efforts.some(value => typeof value !== 'string' || !value.trim())) throw new TypeError('Thinking efforts must be nonempty strings.');
    return { ...model, label: model.label || model.id, thinkingEfforts: efforts };
  });
}

// Reusable lifecycle. Identity verification and transport belong to the adapter.
export class AgentController {
  constructor({ definition, adapter, now = Date.now }) {
    for (const method of ['getSession', 'signIn', 'signOut', 'run']) {
      if (typeof adapter?.[method] !== 'function') throw new TypeError(`Adapter needs ${method}().`);
    }
    this.adapter = adapter; this.now = now; this.listeners = new Set();
    this.authEpoch = 0; this.runEpoch = 0; this.checkEpoch = 0; this.alive = true;
    this.modelsAccountId = null; this.contextKey = null;
    this.state = { definition: defineAgent(definition), session: null, models: [], model: '', thinkingEffort: '',
      busy: 'checking', result: null, output: null, status: { tone: 'busy', message: 'Checking sign-in…' } };
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  emit() { if (this.alive) for (const listener of this.listeners) listener(this.state); }
  status(tone, message) { this.state.status = { tone, message }; this.emit(); }
  get ready() {
    const s = this.state;
    return this.alive && !s.busy && Boolean(s.session) && (!s.definition.modelSelection ||
      (this.modelsAccountId === s.session.user.id && s.models.some(model => model.id === s.model)));
  }
  currentAuth(epoch) { return this.alive && epoch === this.authEpoch; }
  beginAuth(busy) {
    ++this.authEpoch; ++this.checkEpoch;
    this.authAbort?.abort(); this.authAbort = new AbortController();
    this.invalidateRun(); this.state.busy = busy;
    return this.authEpoch;
  }
  clearModels() { this.modelsAccountId = null; this.state.models = []; this.state.model = ''; this.state.thinkingEffort = ''; }
  adoptSession(session) {
    const changed = this.state.session?.user.id !== session?.user.id;
    if (changed) { this.invalidateRun(); this.clearModels(); }
    this.state.session = session; return changed;
  }
  signedOut(message = 'Your session expired. Sign in again to test.') {
    this.beginAuth(null); this.adoptSession(null); this.clearModels(); this.status('warning', message);
  }
  handleError(error, fallback) {
    if (isSessionExpired(error)) this.signedOut();
    else { this.state.busy = null; this.status('error', error?.message || fallback); }
  }
  async start() { await this.authenticate(false); }
  async signIn() {
    if (!this.alive || (this.state.busy && this.state.busy !== 'running')) return;
    await this.authenticate(true);
  }
  async authenticate(connect) {
    if (!this.alive) return;
    const epoch = this.beginAuth(connect ? 'signing-in' : 'checking'), { signal } = this.authAbort;
    this.status('busy', connect ? 'Completing sign-in…' : 'Checking sign-in…');
    try {
      if (connect) await this.adapter.signIn({ signal });
      if (!this.currentAuth(epoch)) return;
      const session = verifiedSession(await this.adapter.getSession({ signal }), this.now());
      if (!this.currentAuth(epoch)) return;
      this.adoptSession(session);
      if (!session) {
        this.state.busy = null;
        this.status(connect ? 'warning' : 'neutral', connect ? 'Sign-in was not completed. Try again.' : 'Sign in to test your agent.'); return;
      }
      await this.loadModels(signal, epoch);
      if (!this.currentAuth(epoch)) return;
      this.state.busy = null;
      const hasModels = !this.state.definition.modelSelection || this.state.models.length > 0;
      this.status(hasModels ? 'success' : 'warning', hasModels ? `Signed in as ${session.user.name}. Ready to test.`
        : 'Signed in, but no models are available. Use Reload models in Settings.');
    } catch (error) { if (this.currentAuth(epoch)) this.handleError(error, 'Sign-in could not be checked. Try again.'); }
  }
  async loadModels(signal, epoch) {
    const accountId = this.state.session?.user.id;
    if (!this.state.definition.modelSelection) { this.modelsAccountId = accountId; return; }
    if (typeof this.adapter.getModels !== 'function') throw new TypeError('Adapter needs getModels().');
    const models = normalizeModels(await this.adapter.getModels({ signal, accountId }));
    if (signal?.aborted || !this.currentAuth(epoch) || this.state.session?.user.id !== accountId) return;
    this.state.models = models; this.modelsAccountId = accountId;
    this.state.model = models.some(model => model.id === this.state.model) ? this.state.model : models[0]?.id || '';
    this.chooseEffort();
  }
  async reloadModels() {
    if (!this.alive || !this.state.session || this.state.busy) return;
    const epoch = this.beginAuth('models'), { signal } = this.authAbort;
    this.status('busy', 'Loading available models…');
    try {
      const session = verifiedSession(await this.adapter.getSession({ signal }), this.now());
      if (!this.currentAuth(epoch)) return;
      if (!session) { this.signedOut(); return; }
      const changed = this.adoptSession(session);
      await this.loadModels(signal, epoch);
      if (!this.currentAuth(epoch)) return;
      this.state.busy = null;
      this.status(changed || !this.state.models.length ? 'warning' : 'success', changed
        ? 'Account changed. Review the new model settings and choose Go again.'
        : this.state.models.length ? 'Models updated. Ready to test.' : 'No models are available for this account.');
    } catch (error) { if (this.currentAuth(epoch)) this.handleError(error, 'Could not load models.'); }
  }
  async switchAccount(session) {
    const epoch = this.beginAuth('models'), { signal } = this.authAbort;
    this.adoptSession(session); this.status('busy', 'Account changed. Loading this account’s models…');
    try {
      await this.loadModels(signal, epoch);
      if (!this.currentAuth(epoch)) return;
      this.state.busy = null; this.status('warning', 'Account changed. Review the new model settings and choose Go again.');
    } catch (error) { if (this.currentAuth(epoch)) this.handleError(error, 'Could not load this account’s models.'); }
  }
  async refreshSession() {
    if (!this.alive || (this.state.busy && this.state.busy !== 'running')) return;
    const auth = this.authEpoch, check = ++this.checkEpoch;
    try {
      const session = verifiedSession(await this.adapter.getSession({}), this.now());
      if (!this.currentAuth(auth) || check !== this.checkEpoch) return;
      if (!session) { if (this.state.session) this.signedOut(); return; }
      if (session.user.id !== this.state.session?.user.id) { await this.switchAccount(session); return; }
      this.state.session = session; this.emit();
    } catch (error) {
      if (!this.currentAuth(auth) || check !== this.checkEpoch) return;
      if (isSessionExpired(error)) this.signedOut();
      else if (!this.state.busy) this.status('error', error?.message || 'Could not check the session.');
    }
  }
  chooseEffort() {
    const model = this.state.models.find(model => model.id === this.state.model), efforts = model?.thinkingEfforts || [];
    this.state.thinkingEffort = efforts.includes(this.state.thinkingEffort) ? this.state.thinkingEffort
      : efforts.includes(model?.defaultThinkingEffort) ? model.defaultThinkingEffort : efforts[0] || '';
  }
  setModel(id) {
    if (!this.state.models.some(model => model.id === id) || this.state.model === id) return;
    this.state.model = id; this.chooseEffort(); this.changed('Model changed.');
  }
  setEffort(value) {
    const model = this.state.models.find(model => model.id === this.state.model);
    if (!model?.thinkingEfforts.includes(value) || value === this.state.thinkingEffort) return;
    this.state.thinkingEffort = value; this.changed('Thinking effort changed.');
  }
  setValue(field, value) {
    if (!['prompt', 'input'].includes(field) || !this.state.definition[field].editable || this.state.definition[field].value === value) return;
    this.state.definition = defineAgent({ ...this.state.definition, [field]: { ...this.state.definition[field], value } });
    this.changed(`${this.state.definition[field].label} changed.`);
  }
  setContext(key) {
    if (this.contextKey === key) return;
    this.contextKey = key;
    if (this.state.result !== null || this.state.busy === 'running') this.changed('Agent context changed.');
    else { this.invalidateRun(); this.emit(); }
  }
  configure({ title, promptMode, inputMode }) {
    if (this.state.busy && this.state.busy !== 'running') return false;
    const modes = { editable: { editable: true, visible: true }, fixed: { editable: false, visible: true }, hidden: { editable: false, visible: false } };
    if (!title?.trim() || !Object.hasOwn(modes, promptMode) || !Object.hasOwn(modes, inputMode)) {
      this.status('error', 'Enter a template name and choose valid field modes.'); return false;
    }
    for (const [key, fieldMode] of [['prompt', promptMode], ['input', inputMode]]) {
      if (fieldMode !== 'editable' && this.state.definition[key].required && !this.state.definition[key].value.trim()) {
        this.status('warning', `Add ${this.state.definition[key].label.toLowerCase()} before making it fixed or hidden.`); return false;
      }
    }
    this.state.definition = defineAgent({ ...this.state.definition, title: title.trim(),
      prompt: { ...this.state.definition.prompt, ...modes[promptMode] }, input: { ...this.state.definition.input, ...modes[inputMode] } });
    this.changed('Template updated for this session.'); return true;
  }
  changed(message) {
    const stale = this.state.result !== null || this.state.busy === 'running';
    this.invalidateRun();
    if (stale) this.status('warning', `${message} Run again for a current result.`);
    else if (!this.state.busy) this.status('neutral', this.state.session ? message : `${message} Sign in to test.`);
    else this.emit();
  }
  invalidateRun() {
    ++this.runEpoch; this.runAbort?.abort(); this.runAbort = null;
    this.state.result = null; this.state.output = null;
    if (this.state.busy === 'running') this.state.busy = null;
  }
  cancel() {
    if (this.state.busy !== 'running') return;
    this.invalidateRun(); this.status('warning', 'Test canceled. Ready to try again.');
  }
  async run() {
    if (!this.ready) {
      if (!this.state.busy) this.status('warning', this.state.session ? 'Choose an available model first.' : 'Sign in before running a test.'); return;
    }
    for (const field of ['prompt', 'input']) {
      if (this.state.definition[field].required && !this.state.definition[field].value.trim()) {
        this.status('warning', `Add ${this.state.definition[field].label.toLowerCase()} before running a test.`); return;
      }
    }
    this.invalidateRun();
    const epoch = this.runEpoch, auth = this.authEpoch, abort = this.runAbort = new AbortController();
    const current = () => this.currentAuth(auth) && epoch === this.runEpoch && !abort.signal.aborted;
    const accountId = this.state.session.user.id;
    this.state.busy = 'running'; this.status('busy', 'Running your test…');
    try {
      const session = verifiedSession(await this.adapter.getSession({ signal: abort.signal }), this.now());
      if (!current()) return;
      if (!session) { this.signedOut(); return; }
      if (session.user.id !== accountId) { await this.switchAccount(session); return; }
      this.state.session = session;
      // Construct only after account verification; edits invalidate this operation.
      const d = this.state.definition;
      const request = { agentId: d.id, prompt: d.prompt.value, input: d.input.value, accountId, contextKey: this.contextKey, signal: abort.signal };
      if (d.modelSelection) {
        if (this.modelsAccountId !== accountId) { await this.switchAccount(session); return; }
        const model = this.state.models.find(row => row.id === this.state.model);
        if (!model) throw new Error('Choose an available model first.');
        request.model = model.id;
        if (model.thinkingEfforts.includes(this.state.thinkingEffort)) request.thinkingEffort = this.state.thinkingEffort;
      }
      const output = await this.adapter.run(request);
      if (!current()) return;
      this.state.result = formatResult(output); this.state.output = output; this.state.busy = null;
      this.status('success', 'Test complete. Your result is ready.');
    } catch (error) { if (current()) this.handleError(error, 'The test failed. Try again.'); }
  }
  async signOut() {
    if (!this.alive || !this.state.session || (this.state.busy && this.state.busy !== 'running')) return;
    const epoch = this.beginAuth('signing-out'), { signal } = this.authAbort;
    this.status('busy', 'Signing out…');
    try {
      await this.adapter.signOut({ signal });
      if (!this.currentAuth(epoch)) return;
      const session = verifiedSession(await this.adapter.getSession({ signal }), this.now());
      if (!this.currentAuth(epoch)) return;
      const changed = this.adoptSession(session);
      if (session && changed) { await this.switchAccount(session); return; }
      this.state.busy = null;
      this.status(session ? 'error' : 'neutral', session ? 'Sign-out was not completed. Try again.' : 'Signed out. Sign in to test your agent.');
    } catch (error) { if (this.currentAuth(epoch)) this.handleError(error, 'Could not sign out. Try again.'); }
  }
  destroy() { this.alive = false; ++this.authEpoch; ++this.checkEpoch; this.invalidateRun(); this.authAbort?.abort(); this.listeners.clear(); }
}
