import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('../', import.meta.url));
const modules = ['src/definition.mjs', 'src/controller.mjs', 'src/agent-shell.mjs',
  'examples/preview-adapter.mjs', 'examples/agents.mjs', 'preview.mjs'];
const script = (await Promise.all(modules.map(path => readFile(resolve(base, path), 'utf8'))))
  .map(text => text.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).join('\n');
const css = await readFile(resolve(base, 'src/agent-shell.css'), 'utf8');
const html = (await readFile(resolve(base, 'index.html'), 'utf8'))
  .replace('<link rel="stylesheet" href="src/agent-shell.css">', `<style>\n${css}\n</style>`)
  .replace('  <script type="module" src="preview.mjs"></script>\n', '')
  .replace('</body>', `<script>\n${script}\n</script></body>`);
await writeFile(resolve(base, 'preview.html'), html);
console.log('Created preview.html (standalone, sample responses only).');
