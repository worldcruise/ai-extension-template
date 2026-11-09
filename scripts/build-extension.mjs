import { cp, mkdir, mkdtemp, rename, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeTemplates } from '../src/resume-templates.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const extensionFiles = [
  'src/build-info.js', 'src/runtime-info.mjs', 'src/queue-diagnostics.mjs', 'src/queue-outcomes.mjs', 'src/job-metadata.mjs',
  'src/queue-mode.mjs', 'src/manual-prompt.mjs',
  'manifest.json', 'index.html',
  'src/sidebar.css', 'src/sidebar.mjs', 'src/sidebar-protocol.mjs',
  'src/workspace.mjs', 'src/studio.mjs', 'src/studio-examples.mjs', 'src/icons.mjs',
  'src/browser-tabs.mjs', 'src/read-page-commands.mjs', 'src/shortcut-settings.mjs', 'src/job-page-access.mjs',
  'src/workspace-shortcut-keys.js', 'src/workspace-shortcuts.mjs',
  'src/chat-toolbar.mjs',
  'src/chat-history.js',
  'src/company-chats.mjs',
  'src/resume-templates.mjs',
  'src/resume-data.mjs', 'src/queue-store.mjs', 'src/resume-queue.mjs', 'src/chatgpt-queue.js',
  'src/chatgpt-tab.js', 'src/chatgpt-tab-connection.mjs', 'src/queue-connection-settings.mjs',
  'src/keyword-matcher.js', 'src/job-page-highlighter.js', 'src/page-highlights.mjs', 'src/keyword-settings.mjs',
  'src/job-highlights.css',
  'src/job-site-adapters.mjs', 'src/job-page-evidence.mjs', 'src/job-extraction-core.mjs', 'src/job-extraction-service.mjs',
  'src/service-worker.mjs', 'src/chatgpt-frame.js',
  'assets/icon-16.png', 'assets/icon-32.png', 'assets/icon-48.png', 'assets/icon-128.png',
  ...resumeTemplates.map(template => template.thumbnail)
];

export async function runtimeFingerprint() {
  const hash = createHash('sha256');
  for (const file of extensionFiles.filter(file => file !== 'src/build-info.js').sort()) {
    hash.update(file + '\0'); hash.update(await readFile(join(root, file))); hash.update('\0');
  }
  return hash.digest('hex');
}

export async function buildExtension() {
  const outputRoot = join(root, 'dist');
  const output = join(outputRoot, 'extension');
  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(join(outputRoot, '.extension-'));
  try {
    for (const file of extensionFiles) {
      const target = join(staging, file);
      await mkdir(resolve(target, '..'), { recursive: true });
      await cp(join(root, file), target);
    }
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    await writeFile(join(staging, 'src/build-info.js'), `globalThis.AiAgentBuild = Object.freeze(${JSON.stringify({ id: await runtimeFingerprint(), version: manifest.version })});\n`);
    if (dirname(resolve(output)) !== resolve(outputRoot) || dirname(resolve(staging)) !== resolve(outputRoot)) {
      throw new Error('Build paths must stay inside the project dist directory.');
    }
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    return output;
  } finally {
    if (dirname(resolve(staging)) !== resolve(outputRoot)) throw new Error('Unexpected build staging path.');
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Extension built: ${await buildExtension()}`);
}
