import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(new URL('../vendor/', import.meta.url), { recursive: true });
await build({
  stdin: { contents: `export { PDFDocument, rgb } from 'pdf-lib';
export { default as fontkit } from '@pdf-lib/fontkit';
export { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';`, resolveDir: root },
  outfile: fileURLToPath(new URL('../vendor/document-libraries.mjs', import.meta.url)),
  bundle: true, platform: 'browser', format: 'esm', target: 'chrome116', minify: true,
  legalComments: 'eof'
});
const licenses = [];
for (const [name, file] of [['pdf-lib 1.17.1', 'pdf-lib/LICENSE.md'], ['docx 9.5.1', 'docx/LICENSE'], ['buffer 6.0.3', 'buffer/LICENSE']]) {
  licenses.push(`${name}\n${await readFile(new URL('../node_modules/' + file, import.meta.url), 'utf8')}`);
}
licenses.push(`fontkit 1.1.1\n${await readFile(new URL('../vendor/fontkit-LICENSE.txt', import.meta.url), 'utf8')}`);
await writeFile(new URL('../vendor/DOCUMENT-LICENSES.txt', import.meta.url), licenses.join('\n\n'));
console.log('Document libraries bundled locally.');
