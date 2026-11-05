import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
