import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function buildExtension(base = fileURLToPath(new URL('../', import.meta.url))) {
  base = resolve(base);
  const dist = resolve(base, 'dist');
  if (dirname(dist) !== base) throw new Error('Invalid extension build destination.');
  const manifest = JSON.parse(await readFile(resolve(base, 'manifest.json'), 'utf8'));
  await readFile(resolve(base, 'index.html'));
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  for (const name of ['index.html', 'auth-callback.html', 'src', 'assets']) await cp(resolve(base, name), resolve(dist, name), { recursive: true });
  await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return dist;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log('Built extension:', await buildExtension());
}
