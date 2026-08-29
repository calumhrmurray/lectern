// Copies a bundled example deck into a folder of its own (with reveal.js), ready to open and save:
//   node scripts/export-example.mjs whale-evolution ~/talks/whales
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [id, destArg] = process.argv.slice(2);
if (!id || !destArg) { console.error('usage: node scripts/export-example.mjs <example-id> <destination-folder>'); process.exit(1); }
const src = join('public', 'examples', id);
if (!existsSync(join(src, 'index.html'))) { console.error(`no example named ${id} (see public/examples/index.json)`); process.exit(1); }
const dest = resolve(destArg);
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
cpSync(join('public', 'reveal'), join(dest, 'reveal'), { recursive: true });
const html = readFileSync(join(dest, 'index.html'), 'utf8').replace(/(href|src)="\.\.\/\.\.\/reveal\//g, '$1="reveal/');
writeFileSync(join(dest, 'index.html'), html);
console.log(`exported ${id} → ${dest}\n  open it:  node cli/index.js "${join(dest, 'index.html')}"`);
