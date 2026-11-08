import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeTemplates } from '../src/resume-templates.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const extensionFiles = [
  'manifest.json', 'index.html',
  'src/sidebar.css', 'src/sidebar.mjs', 'src/sidebar-protocol.mjs',
  'src/workspace.mjs', 'src/studio.mjs', 'src/studio-examples.mjs', 'src/icons.mjs',
  'src/browser-tabs.mjs',
  'src/chat-toolbar.mjs',
  'src/company-chats.mjs',
  'src/resume-templates.mjs',
  'src/keyword-matcher.js', 'src/job-page-highlighter.js', 'src/page-highlights.mjs', 'src/keyword-settings.mjs',
  'src/job-highlights.css',
  'src/service-worker.mjs', 'src/chatgpt-frame.js',
  'assets/icon-16.png', 'assets/icon-32.png', 'assets/icon-48.png', 'assets/icon-128.png',
  ...resumeTemplates.map(template => template.thumbnail)
];

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
