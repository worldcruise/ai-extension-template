import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

export async function buildPreview(base = fileURLToPath(new URL('../', import.meta.url))) {
const modules = ['src/definition.mjs', 'src/controller.mjs', 'src/agent-shell.mjs',
  'examples/preview-adapter.mjs', 'examples/agents.mjs', 'preview.mjs'];
const script = (await Promise.all(modules.map(path => readFile(resolve(base, path), 'utf8'))))
  .map(text => text.replace(/\r\n?/g, '\n').replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).join('\n');
new vm.Script(script, { filename: 'preview.html' });
const css = await readFile(resolve(base, 'src/agent-shell.css'), 'utf8');
const html = (await readFile(resolve(base, 'examples/preview-page.html'), 'utf8'))
  .replace(/\r\n?/g, '\n')
  .replace('<link rel="stylesheet" href="../src/agent-shell.css">', `<style>\n${css}\n</style>`)
  .replace('  <script type="module" src="../preview.mjs"></script>\n', '')
  .replace('</body>', `<script>\n${script}\n</script></body>`);
await writeFile(resolve(base, 'preview.html'), html);
return html;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
await buildPreview();
console.log('Created preview.html (standalone, sample responses only).');
}
