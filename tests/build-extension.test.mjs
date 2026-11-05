import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { buildExtension } from '../scripts/build-extension.mjs';

test('MV3 production build contains external extension modules and no preview or workflow assets', async t => {
  const base = await mkdtemp(join(tmpdir(), 'ai-extension-build-'));
  t.after(async () => { assert.ok(relative(tmpdir(), base).startsWith('ai-extension-build-')); await rm(base, { recursive: true, force: true }); });
  for (const name of ['src', 'assets', 'index.html', 'auth-callback.html', 'manifest.json']) await cp(new URL('../' + name, import.meta.url), resolve(base, name), { recursive: true });
  const dist = await buildExtension(base), files = await readdir(dist), manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
  assert.deepEqual(files.sort(), ['assets', 'auth-callback.html', 'index.html', 'manifest.json', 'src']);
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  for (const size of [16, 32, 48, 128]) {
    const png = await readFile(resolve(dist, manifest.icons[size]));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  assert.equal(manifest.manifest_version, 3); assert.equal(manifest.background.type, 'module');
  assert.deepEqual(manifest.permissions, ['storage', 'sidePanel', 'declarativeNetRequestWithHostAccess', 'alarms']);
  assert.deepEqual(manifest.host_permissions,['https://api.openai.com/*','https://auth.openai.com/*','http://127.0.0.1/*']);
  assert.deepEqual(manifest.side_panel, { default_path: 'index.html' });
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  assert.match(html, /<script type="module" src="src\/extension.mjs"><\/script>/);
  assert.doesNotMatch(html, /<style|\son[a-z]+=|<iframe|preview|candidate|question|resume|pdf/i);
  assert.deepEqual(manifest.web_accessible_resources[0].resources,['auth-callback.html']);
  const callback=await readFile(resolve(dist,'auth-callback.html'),'utf8');assert.match(callback,/src="src\/auth-callback.mjs"/);
  assert.equal(manifest.host_permissions.includes('https://agent.test/*'),false);
});

for (const ending of ['LF', 'CRLF', 'mixed']) test(`MV3 extension builds and its modules parse from ${ending} source`, async t => {
  const base = await mkdtemp(join(tmpdir(), 'ai-extension-build-'));
  t.after(async () => { assert.ok(relative(tmpdir(), base).startsWith('ai-extension-build-')); await rm(base, { recursive: true, force: true }); });
  for (const name of ['src', 'assets', 'index.html', 'auth-callback.html', 'manifest.json']) {
    await cp(new URL('../' + name, import.meta.url), resolve(base, name), { recursive: true });
  }
  const modules = (await readdir(resolve(base, 'src'))).filter(name => name.endsWith('.mjs'));
  for (const path of ['index.html', 'auth-callback.html', 'manifest.json', 'src/agent-shell.css', ...modules.map(name => 'src/' + name)]) {
    let line = 0;
    const text = (await readFile(resolve(base, path), 'utf8')).replace(/\r\n?|\n/g,
      () => ending === 'CRLF' || (ending === 'mixed' && ++line % 2) ? '\r\n' : '\n');
    await writeFile(resolve(base, path), text);
  }
  const dist = await buildExtension(base);
  for (const name of modules) execFileSync(process.execPath, ['--check', resolve(dist, 'src', name)], { stdio: 'pipe' });
  for (const page of ['index.html', 'auth-callback.html']) {
    const html = await readFile(resolve(dist, page), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    assert.match(scripts[0][1], /type="module"/); assert.match(scripts[0][1], /src="src\//);
    assert.equal(scripts[0][2].trim(), '');
  }
});
