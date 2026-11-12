import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const sources = await Promise.all(['generation-dom.js', 'generation-deepseek.js'].map(name => readFile(new URL('../src/' + name, import.meta.url), 'utf8')));
const run = { id: 'run-1', jobId: 'job-1', sendIntentAt: 1, baseline: { users: 0, answers: 0 } };
const output = (changes = {}) => ({ schemaVersion: 1, requestId: 'job-1', runId: 'run-1', resume: { company: 'Example' }, coverLetter: 'Correct reply', ...changes });

// A small deterministic DOM model exercises the actual adapter and shared DOM
// helpers. It supports their selector/order/visibility APIs, without a browser.
function fixture() {
  let body;
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  class Element {
    constructor(tag, attrs = {}, text = '') { this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.ownText = text; this.hidden = false; }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } return this; }
    remove() { const siblings = this.parentElement?.children; if (siblings) siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; }
    get textContent() { return this.ownText + this.children.map(node => node.textContent).join(''); }
    get innerText() { return this.textContent; }
    get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); }
    getClientRects() { for (let n = this; n; n = n.parentElement) if (n.hidden) return []; return this.isConnected ? [{}] : []; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) {
      return selector.split(',').some(part => {
        let target = part.trim();
        const descendantsMatch = target.match(/^(form|pre)\s+(.+)$/);
        if (descendantsMatch) return this.matches(descendantsMatch[2]) && Boolean(this.parentElement?.closest(descendantsMatch[1]));
        const negatives = [...target.matchAll(/:not\(([^)]+)\)/g)];
        if (negatives.some(match => this.matches(match[1]))) return false;
        target = target.replace(/:not\([^)]+\)/g, '');
        const tag = target.match(/^[a-z]+/i)?.[0];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        const id = target.match(/#([\w-]+)/)?.[1];
        if (id && this.attrs.id !== id) return false;
        const classes = [...target.replace(/\[[^\]]*\]/g, '').matchAll(/\.([\w-]+)/g)].map(match => match[1]);
        if (classes.some(name => !String(this.attrs.class || '').split(/\s+/).includes(name))) return false;
        for (const match of target.matchAll(/\[([\w-]+)(?:(\*=|\^=|\$=|=)"([^"]*)"(\s+i)?)?\]/g)) {
          let actual = this.attrs[match[1]], expected = match[3];
          if (actual == null) return false;
          actual = String(actual);
          if (match[4]) { actual = actual.toLowerCase(); expected = expected.toLowerCase(); }
          if (match[2] === '=' && actual !== expected || match[2] === '*=' && !actual.includes(expected) ||
              match[2] === '^=' && !actual.startsWith(expected) || match[2] === '$=' && !actual.endsWith(expected)) return false;
        }
        return true;
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) { return descendants(this).filter(node => node.matches(selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    compareDocumentPosition(node) { const all = [body, ...descendants(body)]; return all.indexOf(node) > all.indexOf(this) ? 4 : 2; }
  }
  const el = (tag, attrs, text) => new Element(tag, attrs, text);
  body = el('body'); const main = el('main'), form = el('form'), editor = el('textarea', { id: 'chat-input' }); editor.value = '';
  const send = el('button', { 'aria-label': 'Send' }); send.disabled = false;
  body.append(main, form.append(editor, send));
  const document = { body, querySelectorAll: selector => body.querySelectorAll(selector), querySelector: selector => body.querySelector(selector),
    createTreeWalker: root => {
      const text = [root, ...descendants(root)].filter(node => node.ownText).map(node => ({ parentElement: node, textContent: node.ownText }));
      let index = -1; return { nextNode() { this.currentNode = text[++index]; return this.currentNode || null; } };
    } };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }), location: { origin: 'https://chat.deepseek.com', pathname: '/a/chat/s/example' } });
  for (const source of sources) vm.runInContext(source, context);
  function user(id = run.id, { hidden = false, unlabelled = false } = {}) {
    const node = el('div', unlabelled ? { class: 'ds-message' } : { 'data-role': 'user' }, 'DOCUMENT_RUN:' + id + '\nPrompt');
    node.hidden = hidden; main.append(node); return node;
  }
  function reply(value = output(), { parent = main, reasoning = false, copy = true } = {}) {
    const row = el('article', { 'data-role': 'assistant', class: 'ds-message' }), node = el('div', { class: 'ds-markdown' });
    node.append(el('pre').append(el('code', {}, typeof value === 'string' ? value : JSON.stringify(value))));
    row.append(reasoning ? el('div', { class: 'ds-think-content' }).append(node) : node);
    if (copy) row.append(el('button', { 'aria-label': 'Copy response' }));
    parent.append(row); return { row, node };
  }
  return { api: context.AiAgentDeepSeekGeneration, el, body, main, form, editor, send, user, reply };
}

test('DeepSeek captures the answer following its posted prompt and requires that anchor', () => {
  const f = fixture(); f.reply();
  assert.equal(f.api.answer(run).node, null, 'matching JSON alone cannot select a reply');
  const user = f.user(), response = f.reply(), answer = f.api.answer(run);
  assert.equal(answer.user, user); assert.equal(answer.node, response.node); assert.equal(answer.responseMatched, true);
  assert.equal(answer.complete, true); assert.equal(answer.diagnostics.code, 'reply_ready');
  assert.equal(answer.diagnostics.userMatched, true); assert.equal(answer.diagnostics.responseMatched, true);
  assert.equal(answer.diagnostics.replyChars, answer.raw.length); assert.equal(answer.diagnostics.codeBlocks, 1);
  assert.equal(JSON.stringify(answer.diagnostics).includes('Correct reply'), false, 'diagnostics never expose result text');
});

test('hidden user anchors retain turn boundaries and later echoed JSON cannot replace this answer', () => {
  const f = fixture(), user = f.user(run.id, { hidden: true }); const expected = f.reply();
  f.user('other-run', { unlabelled: true }); f.reply(output({ coverLetter: 'WRONG_LATER_TURN' }));
  const answer = f.api.answer(run);
  assert.equal(answer.user, user); assert.equal(answer.node, expected.node); assert.equal(answer.responseMatched, true);
  assert.equal(JSON.parse(answer.raw).coverLetter, 'Correct reply');
});

test('existing history does not replace the first anchored answer with a later matching reply', () => {
  const f = fixture(); f.user('older', { unlabelled: true }); f.reply(output({ requestId: 'older-job', runId: 'older' }));
  assert.equal(f.api.baseline().users, 1, 'assistant ds-message wrappers are not user turns');
  f.user(); const expected = f.reply('The provider returned invalid output.');
  f.user('another-run'); f.reply();
  const answer = f.api.answer(run);
  assert.equal(answer.node, expected.node); assert.equal(answer.responseMatched, false);
  assert.equal(answer.raw, 'The provider returned invalid output.', 'the original invalid result stays available for validation/review');
});

test('DeepSeek ignores reasoning, real composer previews, and a marker prefix collision', () => {
  const f = fixture(); f.user('run-10'); f.reply(output(), { reasoning: true });
  f.reply(output(), { parent: f.form });
  const answer = f.api.answer(run);
  assert.equal(answer.user, null); assert.equal(answer.node, null); assert.equal(answer.responseMatched, false);
  f.user(); f.reply(output(), { reasoning: true }); f.reply(output(), { parent: f.form });
  assert.equal(f.api.answer(run).node, null);
  const expected = f.reply(); assert.equal(f.api.answer(run).node, expected.node);
});

test('DeepSeek does not treat a plain form preview as a posted prompt', () => {
  for (const attrs of [{}, { 'data-role': 'user' }]) {
    const f = fixture();
    f.form.append(f.el('div', attrs, 'DOCUMENT_RUN:' + run.id + '\nPrepared draft'));
    const answer = f.api.answer(run);
    assert.equal(answer.user, null);
    assert.equal(answer.diagnostics.userMatched, false);
  }
});

test('DeepSeek excludes draft previews in an editor wrapper without a form', () => {
  const f = fixture(); f.editor.remove();
  const wrapper = f.el('div').append(f.editor, f.el('div', {}, 'DOCUMENT_RUN:' + run.id + '\nPrepared draft'));
  f.body.append(wrapper);
  assert.equal(f.api.answer(run).user, null);
});

test('an unlabelled draft mirror outside the form cannot skip DeepSeek submission', () => {
  const f = fixture(), prompt = 'DOCUMENT_RUN:' + run.id + '\nPrepared draft';
  f.editor.value = prompt;
  const mirror = f.el('div', {}, prompt); f.body.append(mirror);
  assert.equal(f.api.answer(run).user, null, 'the full prompt is still in the composer');
  // A real send clears the editor and adds a transcript bubble. Older
  // DeepSeek layouts have no role, data attribute or stable user-bubble class.
  f.editor.value = ''; mirror.remove();
  const posted = f.el('div', {}, prompt); f.main.append(posted);
  const expected = f.reply(), answer = f.api.answer(run);
  assert.equal(answer.user, posted);
  assert.equal(answer.node, expected.node);
  assert.equal(answer.complete, true);
});

test('hidden unlabelled draft mirrors remain excluded after the composer clears', () => {
  for (const visibility of ['hidden', 'aria-hidden']) {
    const f = fixture(), mirror = f.el('div', {}, 'DOCUMENT_RUN:' + run.id + '\nPrepared draft');
    if (visibility === 'hidden') mirror.hidden = true; else mirror.attrs['aria-hidden'] = 'true';
    f.body.append(mirror);
    assert.equal(f.api.answer(run).user, null, visibility);
    const posted = f.el('div', {}, 'DOCUMENT_RUN:' + run.id + '\nPosted prompt'); f.main.append(posted);
    assert.equal(f.api.answer(run).user, posted, visibility);
  }
});

test('explicit posted user anchors survive a matching composer draft', () => {
  const f = fixture(); f.editor.value = 'DOCUMENT_RUN:' + run.id + '\nPrepared draft';
  const posted = f.user(run.id, { hidden: true }), expected = f.reply(), answer = f.api.answer(run);
  assert.equal(answer.user, posted);
  assert.equal(answer.node, expected.node);
  assert.equal(answer.complete, true);
});

test('known DeepSeek user bubbles take precedence over a stale visible draft mirror', () => {
  const f = fixture();
  f.main.append(f.el('div', {}, 'DOCUMENT_RUN:' + run.id + '\nStale draft preview'));
  const posted = f.user(run.id, { unlabelled: true }), expected = f.reply(), answer = f.api.answer(run);
  assert.equal(answer.user, posted, 'a rendered user bubble is stronger evidence than arbitrary text');
  assert.equal(answer.node, expected.node);
  assert.equal(answer.complete, true);
});

test('accessibility live regions are captured as ordinary transcripts', () => {
  for (const mode of ['polite', 'off']) {
    const f = fixture(); f.main.attrs['aria-live'] = mode;
    f.user(); const expected = f.reply(), answer = f.api.answer(run);
    assert.equal(answer.node, expected.node, mode); assert.equal(answer.complete, true);
    assert.equal(JSON.parse(answer.raw).coverLetter, 'Correct reply');
  }
});

test('visible and hidden copy-status children never discard an otherwise valid code block', () => {
  for (const hidden of [false, true]) {
    const f = fixture(); f.user(); const expected = f.reply();
    const status = f.el('span', { role: 'status', 'aria-live': 'polite' }, 'Copied'); status.hidden = hidden;
    expected.node.append(status);
    const answer = f.api.answer(run);
    assert.equal(answer.node, expected.node); assert.equal(answer.complete, true);
    assert.equal(JSON.parse(answer.raw).coverLetter, 'Correct reply');
  }
});

test('DeepSeek waits through streaming and composer/response loading but ignores sidebar spinners', () => {
  const f = fixture(); f.user(); const response = f.reply();
  const sidebar = f.el('aside').append(f.el('div', { class: 'ds-loading' })); f.body.append(sidebar);
  assert.equal(f.api.busy(f.api.answer(run)), false);
  const styling = f.el('div', { class: 'result-streaming' }); response.row.append(styling);
  assert.equal(f.api.busy(f.api.answer(run)), false, 'generic response styling is not a live generation signal');
  const streaming = f.el('div', { 'data-is-streaming': 'true' }); response.row.append(streaming);
  let answer = f.api.answer(run); assert.equal(answer.complete, false); assert.equal(answer.diagnostics.generationActive, true);
  assert.equal(answer.diagnostics.code, 'waiting_for_idle'); streaming.remove();
  const loading = f.el('div', { class: 'ds-loading' }); response.row.append(loading);
  assert.equal(f.api.busy(f.api.answer(run)), true); loading.remove(); f.form.append(loading);
  assert.equal(f.api.busy(), true); loading.remove();
  answer = f.api.answer(run); assert.equal(answer.complete, true); assert.equal(answer.diagnostics.generationActive, false);
});

test('DeepSeek reports thinking activity before a final answer node exists', () => {
  const f = fixture(); f.user();
  const thinking = f.el('div', { class: 'ds-think-content' }).append(f.el('div', { class: 'ds-loading' }));
  f.main.append(f.el('article', { class: 'ds-message' }).append(thinking));
  const answer = f.api.answer(run);
  assert.equal(answer.node, null); assert.equal(answer.diagnostics.generationActive, true);
  assert.equal(answer.diagnostics.code, 'waiting_for_idle');
});

test('native highlighted pre spans are extracted without code headers or hover toolbars', () => {
  for (const toolbar of ['absent', 'unlabelled', 'labelled']) {
    const f = fixture(); f.user();
    const turn = f.el('div'), row = f.el('div', { class:'ds-message' });
    const node = f.el('div', { class:'ds-assistant-message-main-content ds-markdown' });
    const panel = f.el('div', { class:'md-code-block' });
    panel.append(f.el('div', {}, 'json Copy Download'), f.el('pre').append(f.el('span', {class:'token'}, JSON.stringify(output()))));
    row.append(node.append(panel)); turn.append(row); f.main.append(turn);
    if (toolbar !== 'absent') turn.append(f.el('div').append(f.el('div', { role:'button', ...(toolbar === 'labelled' ? {'aria-label':'Copy response'} : {}) }, 'Copy')));
    const answer = f.api.answer(run);
    assert.equal(answer.raw, JSON.stringify(output()), toolbar);
    assert.equal(answer.responseMatched, true); assert.equal(answer.complete, true);
    assert.equal(answer.diagnostics.codeBlocks, 1);
    assert.equal(answer.diagnostics.completionControl, toolbar === 'labelled');
  }
});

test('collects markdown parts in the same response and prefers the dedicated final answer over thinking', () => {
  const f = fixture(); f.user();
  const row = f.el('div', { class:'ds-message' });
  const intro = f.el('div', { class:'ds-markdown' }, 'Here is the result.');
  const final = f.el('div', { class:'ds-markdown' }).append(f.el('pre').append(f.el('span', {}, JSON.stringify(output()))));
  row.append(intro, final); f.main.append(row);
  let answer = f.api.answer(run);
  assert.equal(answer.raw, JSON.stringify(output())); assert.equal(answer.complete, true);
  assert.equal(answer.diagnostics.replyParts, 2);
  intro.ownText = JSON.stringify(output({coverLetter:'Thinking draft, not final'}));
  final.attrs.class += ' ds-assistant-message-main-content';
  answer = f.api.answer(run);
  assert.equal(answer.raw, JSON.stringify(output())); assert.equal(answer.diagnostics.replyParts, 1);
  f.user('later-run'); f.reply(output({coverLetter:'Wrong later turn'}));
  assert.equal(f.api.answer(run).raw, JSON.stringify(output()));
});

test('unrelated audio and old streaming indicators do not block this reply; its own streaming does', () => {
  const f = fixture(); f.user(); const response = f.reply();
  f.body.append(f.el('button', {'aria-label':'Stop audio playback'}), f.el('div', {'data-is-streaming':'true'}));
  assert.equal(f.api.answer(run).complete, true);
  const streaming = f.el('div', {'data-is-streaming':'true'}); response.row.append(streaming);
  let answer = f.api.answer(run); assert.equal(answer.complete, false); assert.equal(answer.diagnostics.busyReason, 'streaming');
  streaming.remove();
  const stop = f.el('div', {role:'button','aria-label':'Stop generating'}); f.form.append(stop);
  answer = f.api.answer(run); assert.equal(answer.complete, false); assert.equal(answer.diagnostics.busyReason, 'stop-control');
});

test('a labelled sibling response toolbar can finish invalid output without borrowing another turn toolbar', () => {
  const f = fixture(); f.user();
  const turn = f.el('div'), response = f.reply('Invalid final response', {parent:turn,copy:false}); f.main.append(turn);
  assert.equal(f.api.answer(run).complete, false);
  turn.append(f.el('div').append(f.el('button', {'aria-label':'Copy response'})));
  let answer = f.api.answer(run); assert.equal(answer.complete, true); assert.equal(answer.responseMatched, false);
  assert.equal(answer.raw, 'Invalid final response');
  turn.children.at(-1).remove(); f.user('later'); f.reply();
  answer = f.api.answer(run); assert.equal(answer.node, response.node); assert.equal(answer.complete, false);
});
