// Copies the demo deck (src/demo, plus reveal.js) into a scratch folder so tests can
// save files without touching the source. Run before the CLI server.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const src = join(root, 'src', 'demo');
const dest = join(root, 'test', '.tmp', 'demo');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
const reveal = join(root, 'public', 'reveal');
if (!existsSync(reveal)) throw new Error('public/reveal missing — run `node scripts/copy-reveal.js`');
cpSync(reveal, join(dest, 'reveal'), { recursive: true });
const katex = join(root, 'node_modules', 'katex', 'dist');
if (existsSync(katex)) cpSync(katex, join(dest, 'katex', 'dist'), { recursive: true });
// A plain (non-reveal) deck with its own slide driver.
cpSync(join(root, 'test', 'fixtures', 'plain'), join(dest, 'plain'), { recursive: true });
// A multi-file deck lives in a sub-folder of the same workspace.
const partsSrc = join(root, 'test', 'fixtures', 'parts');
const partsDest = join(dest, 'parts');
cpSync(partsSrc, partsDest, { recursive: true });
cpSync(reveal, join(partsDest, 'reveal'), { recursive: true });
