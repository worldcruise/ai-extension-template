import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { parseVersion, nextVersion, checkVersion, bumpVersion } from '../scripts/version.mjs';

const files = ['package.json', 'package-lock.json', 'manifest.json', 'README.md', 'CHANGELOG.md'];
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ai-extension-version-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('ai-extension-version-'));
    await rm(root, { recursive: true, force: true });
  });
  const contents = {
    'package.json': JSON.stringify({ name: 'fixture', version: '1.2.3', scripts: { test: 'node --test' } }),
    'package-lock.json': JSON.stringify({ version: '1.2.3', lockfileVersion: 3, packages: { '': { version: '1.2.3' }, 'node_modules/example': { version: '9.8.7' } } }),
    'manifest.json': '{\n  "manifest_version": 3,\n  "version": "1.2.3",\n  "permissions": ["storage"]\n}\n',
    'README.md': '# Fixture\n\nCurrent version: **1.2.3**.\n\nKeep this text.\n',
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n- Keep multiline notes.\n  More detail.\n\n## 1.2.3 — 2026-11-10\n\n- Previous release.\n'
  };
  for (const [file, content] of Object.entries(contents)) await writeFile(join(root, file), content);
  return { root, contents };
}

test('major, minor and misc/patch increments reset only the lower components', () => {
  assert.equal(nextVersion('1.2.9', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.9', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.9', 'misc'), '1.2.10');
  assert.equal(nextVersion('1.2.9', 'patch'), '1.2.10');
  assert.equal(nextVersion('0.5.0', 'minor'), '0.6.0');
  assert.throws(() => nextVersion('1.2.3', 'feature'), /Choose/);
});

test('release versions reject formats Chrome cannot load and component overflow', () => {
  for (const version of ['0.0.0', '1.2', '1.2.3.4', '01.2.3', '-1.2.3', '1.2.3-beta', '1.2.3+build', '65536.0.0', '1.2.3\n', undefined]) {
    assert.throws(() => parseVersion(version), String(version));
  }
  assert.deepEqual(parseVersion('65535.65535.65535'), [65535, 65535, 65535]);
  assert.throws(() => nextVersion('1.2.65535', 'patch'), /65535/);
  assert.throws(() => nextVersion('1.65535.0', 'minor'), /65535/);
  assert.throws(() => nextVersion('65535.0.0', 'major'), /65535/);
});

test('a release synchronizes copies, preserves metadata and archives notes without rewriting history', async t => {
  const { root, contents } = await fixture(t);
  // Repair existing lockfile drift using package.json as the source of truth.
  await writeFile(join(root, 'package-lock.json'), contents['package-lock.json'].replaceAll('1.2.3', '1.1.0'));
  assert.equal(await bumpVersion('misc', { root, date: '2026-11-11' }), '1.2.4');
  assert.equal(await checkVersion(root), '1.2.4');
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/example'].version, '9.8.7');
  assert.deepEqual(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')).permissions, ['storage']);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).scripts, { test: 'node --test' });
  assert.match(await readFile(join(root, 'README.md'), 'utf8'), /Keep this text/);
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## Unreleased\n\n## 1\.2\.4 — 2026-11-11\n\n- Keep multiline notes\.\n  More detail\./);
  assert.ok(changelog.endsWith(contents['CHANGELOG.md'].slice(contents['CHANGELOG.md'].indexOf('## 1.2.3'))));
});

test('consistency checks catch every independently stale version', async t => {
  const { root, contents } = await fixture(t);
  assert.equal(await checkVersion(root), '1.2.3');
  for (const file of files.filter(file => file !== 'package.json')) {
    await writeFile(join(root, file), contents[file].replaceAll('1.2.3', '1.2.2'));
    await assert.rejects(checkVersion(root), /Version mismatch/);
    await writeFile(join(root, file), contents[file]);
  }
  const lock = JSON.parse(contents['package-lock.json']);
  lock.packages[''].version = '1.2.2';
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
  await assert.rejects(checkVersion(root), /root package/);
});

test('invalid input or an empty release leaves every file unchanged', async t => {
  const { root, contents } = await fixture(t);
  await assert.rejects(bumpVersion('patch', { root, date: '2026-02-30' }), /valid release date/);
  await assert.rejects(bumpVersion('unknown', { root }), /Choose/);
  for (const file of files) assert.equal(await readFile(join(root, file), 'utf8'), contents[file]);
  await bumpVersion('patch', { root, date: '2026-11-11' });
  const before = await Promise.all(files.map(file => readFile(join(root, file), 'utf8')));
  await assert.rejects(bumpVersion('patch', { root }), /Add release notes/);
  assert.deepEqual(await Promise.all(files.map(file => readFile(join(root, file), 'utf8'))), before);
});
