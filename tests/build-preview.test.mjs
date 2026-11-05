import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import vm from 'node:vm';
import { buildPreview } from '../scripts/build-preview.mjs';

for (const ending of ['LF', 'CRLF', 'mixed']) test(`standalone preview builds and parses from ${ending} source`, async t => {
  const base = await mkdtemp(join(tmpdir(), 'agent-preview-build-'));
  t.after(async () => {
    assert.ok(relative(tmpdir(), base).startsWith('agent-preview-build-'));
    await rm(base, { recursive: true, force: true });
  });
  const files = ['src/definition.mjs', 'src/controller.mjs', 'src/agent-shell.mjs', 'src/agent-shell.css',
    'examples/agents.mjs', 'examples/preview-adapter.mjs', 'preview.mjs', 'examples/preview-page.html'];
  for (const path of files) {
    await cp(new URL('../' + path, import.meta.url), resolve(base, path), { recursive: true });
    let line = 0;
    const text = (await readFile(resolve(base, path), 'utf8')).replace(/\r?\n/g,
      () => ending === 'CRLF' || (ending === 'mixed' && ++line % 2) ? '\r\n' : '\n');
    await writeFile(resolve(base, path), text);
  }
  const html = await buildPreview(base);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotMatch(scripts[0][1], /^\s*(?:import|export)\s/m);
  new vm.Script(scripts[0][1]);
});
