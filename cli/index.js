#!/usr/bin/env node
/**
 * lectern — serve the visual editor for a reveal.js deck folder.
 *
 *   npx lectern                 # current folder
 *   npx lectern talk/           # a folder
 *   npx lectern talk/index.html # a file (opens it directly)
 *   options: --port 8765  --no-open  --host 127.0.0.1
 */

import { createServer } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { createWorkspaceHandler, safeJoin, send, serveFile } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '..', 'dist');

const args = process.argv.slice(2);
let target = '.';
let port = 8765;
let host = '127.0.0.1';
let open = true;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port' || a === '-p') port = Number(args[++i]);
  else if (a === '--host') host = args[++i];
  else if (a === '--no-open') open = false;
  else if (a === '--help' || a === '-h') {
    console.log('usage: lectern [folder|deck.html] [--port N] [--host H] [--no-open]');
    process.exit(0);
  } else target = a;
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
