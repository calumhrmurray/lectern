#!/usr/bin/env node
/**
 * lectern — the visual editor for HTML slide decks, and a few commands an AI
 * assistant can use without the GUI.
 *
 *   npx lectern-editor                     # serve the editor on the current folder
 *   npx lectern-editor talk/               # a folder
 *   npx lectern-editor talk/index.html     # a file (opens it directly)
 *   npx lectern-editor new talk/           # scaffold a new deck (index.html, theme.css, reveal/)
 *   npx lectern-editor notes talk/index.html   # list the pending notes for AI as a prompt
 *   npx lectern-editor guide               # print AGENTS.md: instructions for AI assistants
 */

import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exec } from 'node:child_process';
import { createWorkspaceHandler, safeJoin, send, serveFile } from './server.js';
import { notesPrompt } from './notes.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const distDir = join(pkgRoot, 'dist');
const REVEAL_CDN = 'https://cdn.jsdelivr.net/npm/reveal.js@5';

const HELP = `usage: lectern [folder|deck.html] [--port N] [--host H] [--no-open]
       lectern new <folder> [--title "…"] [--author "…"] [--theme paper|ink|academic|aquarelle] [--size 1280x720] [--no-reveal] [--force]
       lectern notes <deck.html>
       lectern guide

  (no command)   serve the visual editor for a deck folder or file and open it in the browser
  new            create a deck: index.html, theme.css and a local copy of reveal.js
  notes          print the deck's pending notes for AI as a prompt (elements marked data-ai-note)
  guide          instructions for AI assistants: the deck format, the notes protocol, the workflow (AGENTS.md)

  options for serve:  --port N (default 8765)  --host H (default 127.0.0.1)  --no-open
  options for new:    --title, --author, --theme (default paper), --size WxH (default 1280x720),
                      --no-reveal (load reveal.js from the jsDelivr CDN instead of copying it), --force (overwrite)`;

const args = process.argv.slice(2);
if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') { console.log(HELP); process.exit(0); }

const command = ['new', 'notes', 'guide'].includes(args[0]) ? args.shift() : 'serve';

if (command === 'guide') {
  const file = join(pkgRoot, 'AGENTS.md');
  if (!existsSync(file)) { console.error(`lectern: ${file} is missing (see https://github.com/calumhrmurray/lectern/blob/main/AGENTS.md)`); process.exit(1); }
  process.stdout.write(readFileSync(file, 'utf8'));
  process.exit(0);
}

if (command === 'notes') {
  const file = args[0];
  if (!file) { console.error('usage: lectern notes <deck.html>'); process.exit(1); }
  const path = resolve(file);
  if (!existsSync(path)) { console.error(`lectern: ${path} does not exist`); process.exit(1); }
  console.log(notesPrompt(readFileSync(path, 'utf8'), file));
  process.exit(0);
}

if (command === 'new') {
  await newDeck(args);
  process.exit(0);
}

// ---------------------------------------------------------------- serve

let target = '.';
let port = 8765;
let host = '127.0.0.1';
let open = true;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port' || a === '-p') port = Number(args[++i]);
  else if (a === '--host') host = args[++i];
  else if (a === '--no-open') open = false;
  else target = a;
}

const targetPath = resolve(target);
if (!existsSync(targetPath)) {
  console.error(`lectern: ${targetPath} does not exist`);
  process.exit(1);
}
const isFile = statSync(targetPath).isFile();
const rootDir = isFile ? dirname(targetPath) : targetPath;
const deckFile = isFile ? basename(targetPath) : null;

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('lectern: editor build not found (dist/index.html). Run `npm run build` first.');
  process.exit(1);
}

const workspace = createWorkspaceHandler(rootDir, deckFile, (m) => console.log('  ' + m));

const server = createServer(async (req, res) => {
  try {
    if (await workspace(req, res)) return;
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath = safeJoin(distDir, url.pathname === '/' ? '/index.html' : url.pathname);
    if (!filePath) return send(res, 400, 'Bad path');
    if (!existsSync(filePath)) filePath = join(distDir, 'index.html');
    return serveFile(res, filePath, req.method === 'HEAD');
  } catch (err) {
    console.error(err);
    return send(res, 500, String(err && err.message));
  }
});

server.listen(port, host, () => {
  const query = deckFile ? `?ws=local&deck=${encodeURIComponent(deckFile)}` : '?ws=local';
  const url = `http://${host}:${port}/${query}`;
  console.log(`\n  lectern · editing ${rootDir}\n  ${url}\n`);
  if (open) {
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`lectern: port ${port} is in use (try --port ${port + 1})`);
  else console.error(err);
  process.exit(1);
});

// ---------------------------------------------------------------- new

async function newDeck(argv) {
  let folder = null;
  const opts = { title: '', author: '', theme: 'paper', width: 1280, height: 720, reveal: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') opts.title = argv[++i] ?? '';
    else if (a === '--author') opts.author = argv[++i] ?? '';
    else if (a === '--theme') opts.theme = argv[++i] ?? 'paper';
    else if (a === '--size') {
      const m = /^(\d+)x(\d+)$/i.exec(argv[++i] ?? '');
      if (!m) { console.error('lectern new: --size expects WIDTHxHEIGHT, e.g. 1280x720'); process.exit(1); }
      opts.width = Number(m[1]); opts.height = Number(m[2]);
    }
    else if (a === '--no-reveal') opts.reveal = false;
    else if (a === '--force') opts.force = true;
    else if (a.startsWith('-')) { console.error(`lectern new: unknown option ${a}\n\n${HELP}`); process.exit(1); }
    else if (folder === null) folder = a;
    else { console.error(`lectern new: unexpected argument ${a}`); process.exit(1); }
  }
  if (!folder) { console.error('usage: lectern new <folder> [--title "…"] [--author "…"] [--theme paper|ink|academic|aquarelle] [--size 1280x720] [--no-reveal]'); process.exit(1); }

  const lib = join(distDir, 'lib', 'templates.js');
  if (!existsSync(lib)) {
    console.error(`lectern new: ${lib} is missing. In a source checkout run \`node scripts/build-cli-lib.mjs\` (or \`npm run build\`).`);
    process.exit(1);
  }
  const { starterDeckHtml, themeById } = await import(pathToFileURL(lib).href);
  const theme = themeById(opts.theme);
  if (theme.id !== opts.theme) { console.error(`lectern new: unknown theme "${opts.theme}" (paper, ink, academic, aquarelle)`); process.exit(1); }

  const dir = resolve(folder);
  const indexFile = join(dir, 'index.html');
  if (existsSync(indexFile) && !opts.force) { console.error(`lectern new: ${indexFile} already exists (use --force to overwrite)`); process.exit(1); }
  mkdirSync(dir, { recursive: true });

  let revealPath = REVEAL_CDN;
  const created = [];
  if (opts.reveal) {
    const source = [join(distDir, 'reveal'), join(pkgRoot, 'public', 'reveal')].find((p) => existsSync(join(p, 'dist', 'reveal.js')));
    if (!source) {
      console.error('lectern new: no copy of reveal.js found (dist/reveal or public/reveal). Run `npm run build`, or pass --no-reveal to load it from the CDN.');
      process.exit(1);
    }
    cpSync(source, join(dir, 'reveal'), { recursive: true });
    revealPath = 'reveal';
    created.push('reveal/  (reveal.js, local copy — the deck works offline)');
  }
  const title = opts.title || basename(dir).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || 'Untitled';
  writeFileSync(join(dir, 'theme.css'), theme.css.endsWith('\n') ? theme.css : theme.css + '\n');
  created.unshift(`theme.css  (${theme.name} theme — ${theme.description})`);
  writeFileSync(indexFile, starterDeckHtml({ title, author: opts.author, width: opts.width, height: opts.height, revealPath, theme }));
  created.unshift(`index.html  (${opts.width}×${opts.height}, "${title}")`);

  console.log(`\n  lectern · created ${dir}\n`);
  for (const c of created) console.log(`    ${c}`);
  console.log(`\n  Slides are <section> elements inside <div class="slides">; edit index.html directly or run:\n\n    lectern ${folder}\n\n  Run \`lectern guide\` for the deck format and the notes-for-AI protocol.\n`);
}
