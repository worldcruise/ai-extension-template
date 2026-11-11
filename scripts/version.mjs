import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const files = ['package.json', 'package-lock.json', 'manifest.json', 'README.md', 'CHANGELOG.md'];
const readmeVersion = /Current version: \*\*([^*]+)\*\*/;

export function parseVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Use exactly MAJOR.MINOR.PATCH, with no leading zeros or suffixes.');
  }
  const parts = version.split('.').map(Number);
  if (parts.some(part => part > 65535) || parts.every(part => part === 0)) {
    throw new Error('Chrome version components must be 0–65535 and cannot all be zero.');
  }
  return parts;
}

export function nextVersion(version, kind) {
  const parts = parseVersion(version);
  const index = { major: 0, minor: 1, patch: 2, misc: 2 }[kind];
  if (!Number.isInteger(index)) throw new Error('Choose major, minor, misc, or patch.');
  parts[index]++;
  parts.fill(0, index + 1);
  const next = parts.join('.');
  parseVersion(next);
  return next;
}

async function readProject(root) {
  const source = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(join(root, file), 'utf8')])));
  const pkg = JSON.parse(source['package.json']), lock = JSON.parse(source['package-lock.json']), manifest = JSON.parse(source['manifest.json']);
  parseVersion(pkg.version);
  if (!lock.packages?.['']) throw new Error('The lockfile is missing its root package.');
  if (!readmeVersion.test(source['README.md'])) throw new Error('README.md is missing its Current version field.');
  return { source, pkg, lock, manifest };
}

export async function checkVersion(root = projectRoot) {
  const { source, pkg, lock, manifest } = await readProject(root);
  const copies = {
    'manifest.json': manifest.version,
    'package-lock.json': lock.version,
    'package-lock.json root package': lock.packages[''].version,
    'README.md': source['README.md'].match(readmeVersion)[1],
    'CHANGELOG.md latest release': source['CHANGELOG.md'].match(/^## (\d+\.\d+\.\d+)(?:\s|$)/m)?.[1]
  };
  for (const [name, version] of Object.entries(copies)) {
    if (version !== pkg.version) throw new Error(`Version mismatch: ${name} has ${version ?? 'no version'}; package.json has ${pkg.version}.`);
  }
  return pkg.version;
}

export async function bumpVersion(kind, { root = projectRoot, date = new Date().toISOString().slice(0, 10) } = {}) {
  const { source, pkg, lock, manifest } = await readProject(root);
  const version = nextVersion(pkg.version, kind);
  const changelog = source['CHANGELOG.md'].replace(/\r\n/g, '\n');
  const headings = [...changelog.matchAll(/^## Unreleased$/gm)];
  if (headings.length !== 1) throw new Error('CHANGELOG.md must have one Unreleased section.');
  const start = headings[0].index, notesStart = start + headings[0][0].length;
  const nextHeading = changelog.indexOf('\n## ', notesStart);
  const end = nextHeading < 0 ? changelog.length : nextHeading;
  const notes = changelog.slice(notesStart, end).trim();
  if (!notes) throw new Error('Add release notes under Unreleased before changing the version.');
  if ([...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?:\s|$)/gm)].some(match => match[1] === version)) {
    throw new Error(`CHANGELOG.md already contains version ${version}.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Use a valid release date in YYYY-MM-DD format.');
  }
  pkg.version = manifest.version = lock.version = lock.packages[''].version = version;
  const changes = {
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    'package-lock.json': JSON.stringify(lock, null, 2) + '\n',
    // Keep the manifest's intentional compact arrays and other formatting.
    'manifest.json': source['manifest.json'].replace(/("version"\s*:\s*")[^"]+"/, (_, prefix) => `${prefix}${version}"`),
    'README.md': source['README.md'].replace(readmeVersion, `Current version: **${version}**`),
    'CHANGELOG.md': `${changelog.slice(0, start)}## Unreleased\n\n## ${version} — ${date}\n\n${notes}\n\n${changelog.slice(end).trimStart()}`
  };
  // Validate every input before writing, and restore completed writes if a later one fails.
  const written = [];
  try {
    for (const [file, text] of Object.entries(changes)) {
      written.push(file);
      await writeFile(join(root, file), text);
    }
    await checkVersion(root);
  } catch (error) {
    const rollback = await Promise.allSettled(written.map(file => writeFile(join(root, file), source[file])));
    const failures = rollback.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError([error, ...failures], 'Version update failed; some files could not be restored. Check the version files.');
    throw error;
  }
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/version.mjs <check|major|minor|misc|patch>');
    const action = process.argv[2];
    const version = action === 'check' ? await checkVersion() : await bumpVersion(action);
    console.log(action === 'check' ? `Versions match: ${version}` : `Version updated to ${version}. No commit or tag was created.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
