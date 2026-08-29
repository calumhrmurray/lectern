// Copies the reveal.js distribution into public/reveal so the editor can
// scaffold new decks (and so the demo/fixture decks can load it), and writes
// a manifest listing every file so the browser can copy them into a folder.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'reveal.js');
const dest = join(root, 'public', 'reveal');
if (!existsSync(src)) {
  console.error('reveal.js not installed — run npm install first');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(src, 'dist'), join(dest, 'dist'), { recursive: true });
cpSync(join(src, 'plugin'), join(dest, 'plugin'), { recursive: true });
cpSync(join(src, 'LICENSE'), join(dest, 'LICENSE'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!name.endsWith('.map')) out.push(relative(dest, p).split('\\').join('/'));
  }
  return out;
}
const files = walk(dest).sort();
writeFileSync(join(dest, 'manifest.json'), JSON.stringify({ files }, null, 0));
console.log(`copied reveal.js → ${dest} (${files.length} files)`);
