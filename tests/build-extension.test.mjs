import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { buildExtension, extensionFiles, root } from '../scripts/build-extension.mjs';
import { resumeTemplates } from '../src/resume-templates.mjs';

test('the unpacked build has every manifest resource and excludes the references and tooling', async () => {
  const output = await buildExtension();
  async function filesAt(folder, prefix = '') {
    const files = [];
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) files.push(...await filesAt(join(folder, entry.name), path + '/'));
      else files.push(path);
    }
    return files;
  }
  assert.deepEqual((await filesAt(output)).sort(), [...extensionFiles].sort());
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  const resources = [manifest.background.service_worker, manifest.side_panel.default_path,
    ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(script => script.js)];
  for (const resource of resources) assert.ok(extensionFiles.includes(resource), resource);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(!manifest.permissions.includes('tabs'));
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
  assert.ok(!Object.hasOwn(manifest, 'key'));
  for (const template of resumeTemplates) {
    const bundled = await readFile(join(output, template.thumbnail));
    const baseline = await readFile(join(root, 'baseline/thumbnails', basename(template.thumbnail)));
    assert.ok(bundled.equals(baseline), `${template.name} uses the baseline thumbnail`);
  }
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = await readFile(join(output, file));
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
});
