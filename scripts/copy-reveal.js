// Copies the reveal.js distribution into public/reveal so the editor can
// scaffold new decks (and so the demo/fixture decks can load it), and writes
// a manifest listing every file so the browser can copy them into a folder.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// KaTeX, next to reveal, so a deck with math typesets with no internet access.
// Only what the math plugin loads: the script, the stylesheet, auto-render, and the
// woff2 faces the stylesheet asks for first (every current browser reads woff2).
const katexSrc = join(root, 'node_modules', 'katex', 'dist');
if (!existsSync(katexSrc)) {
  console.error('katex not installed — run npm install first');
  process.exit(1);
}
const katexDest = join(dest, 'katex', 'dist');
mkdirSync(join(katexDest, 'contrib'), { recursive: true });
mkdirSync(join(katexDest, 'fonts'), { recursive: true });
for (const f of ['katex.min.js', 'katex.min.css']) cpSync(join(katexSrc, f), join(katexDest, f));
cpSync(join(katexSrc, 'contrib', 'auto-render.min.js'), join(katexDest, 'contrib', 'auto-render.min.js'));
for (const f of readdirSync(join(katexSrc, 'fonts')).filter((n) => n.endsWith('.woff2'))) {
  cpSync(join(katexSrc, 'fonts', f), join(katexDest, 'fonts', f));
}
cpSync(join(root, 'node_modules', 'katex', 'LICENSE'), join(dest, 'katex', 'LICENSE'));

// One more stylesheet, with the woff2 faces inlined as data URIs. Lectern.html has no
// folder to serve fonts from, so this is the copy it writes beside a deck it creates on
// file:// — maths then typesets with the network unplugged. The woff/ttf alternatives go:
// every browser that runs the editor reads woff2, and a missing file is a wasted request.
const katexCss = readFileSync(join(katexSrc, 'katex.min.css'), 'utf8');
const inlined = katexCss.replace(
  /url\(fonts\/([\w-]+)\.woff2\)\s*format\("woff2"\)(?:\s*,\s*url\(fonts\/[\w-]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\))*/g,
  (whole, face) => {
    const file = join(katexSrc, 'fonts', `${face}.woff2`);
    if (!existsSync(file)) return whole;
    return `url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format("woff2")`;
  },
);
if (inlined.includes('url(fonts/')) throw new Error('copy-reveal: some KaTeX fonts were not inlined');
writeFileSync(join(katexDest, 'katex.embedded.css'), inlined);

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
console.log(`copied reveal.js + katex → ${dest} (${files.length} files)`);
