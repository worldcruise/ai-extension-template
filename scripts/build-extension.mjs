import { cp, mkdir, mkdtemp, rename, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeTemplates } from '../src/resume-templates.mjs';
import { checkVersion } from './version.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const extensionFiles = [
  'src/build-info.js', 'src/job-metadata.mjs', 'src/job-duplicates.mjs', 'src/job-capture-url.mjs','src/job-cleanup.mjs','src/job-apply-url.mjs','src/job-analysis-settings.mjs',
  'manifest.json', 'index.html',
  'document-preview.html', 'src/document-preview.mjs', 'src/document-preview.css',
  'src/document-settings.mjs', 'src/document-file-store.mjs', 'src/document-export.mjs', 'src/document-downloads.mjs',
  'vendor/document-libraries.mjs', 'vendor/DOCUMENT-LICENSES.txt', 'vendor/fontkit-LICENSE.txt',
  'assets/fonts/NotoSans-Regular.ttf', 'assets/fonts/NotoSans-Bold.ttf', 'assets/fonts/OFL.txt',
  'src/sidebar.css', 'src/theme.css', 'src/theme.js', 'src/apply-jobs.mjs', 'src/sidebar.mjs', 'src/sidebar-protocol.mjs',
  'src/workspace.mjs', 'src/studio.mjs', 'src/studio-examples.mjs', 'src/icons.mjs',
  'src/workspace-dock.mjs',
  'src/saved-chat.mjs',
  'src/manual-documents.mjs', 'src/queue-documents.mjs', 'src/manual-job-form.mjs', 'src/job-csv.mjs',
  'src/generation-data.mjs', 'src/generation-store.mjs', 'src/generation-service.mjs', 'src/generation-client.mjs', 'src/resume-batch.mjs',
  'src/generation-diagnostics.mjs',
  'src/generation-dom.js', 'src/generation-chatgpt.js', 'src/generation-deepseek.js', 'src/generation-tab.js',
  'src/chatgpt-submit-adapter.js',
  'src/chatgpt-tabs.mjs', 'src/ai-tabs.mjs', 'src/apply-tabs.mjs',
  'src/browser-tabs.mjs', 'src/read-page-commands.mjs', 'src/shortcut-settings.mjs', 'src/job-page-access.mjs',
  'src/workspace-shortcut-keys.js', 'src/workspace-shortcuts.mjs',
  'src/chat-toolbar.mjs',
  'src/chat-providers.mjs',
  'src/native-chat-search.js',
  'src/sidebar-history.js',
  'src/deepseek-toolbar.mjs', 'src/deepseek-protocol.mjs', 'src/deepseek-frame.js',
  'src/deepseek-recovery.mjs',
  'src/deepseek-routes.js',
  'src/deepseek-consent.js',
  'src/chat-history.js',
  'src/resume-templates.mjs',
  'src/resume-data.mjs', 'src/queue-store.mjs', 'src/job-queue.mjs',
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
  await checkVersion(root);
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
