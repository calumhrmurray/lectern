/**
 * Request handler shared by the `lectern` CLI and the Vite dev server:
 *   GET/HEAD/PUT /fs/local/<path>  files in the deck folder (PUT writes atomically)
 *   GET  /api/workspace            { id, name, deck }
 *   GET  /api/list?path=           [{ name, kind }]
 *   POST /api/mkdir  { path }
 * Returns true when the request was handled.
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join, normalize, relative, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.map': 'application/json', '.xml': 'application/xml',
};
export const mime = (p) => MIME[extname(p).toLowerCase()] || 'application/octet-stream';

export function safeJoin(root, urlPath) {
  const decoded = urlPath.split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).join('/');
  const p = normalize(join(root, decoded));
  const rel = relative(root, p);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  return p;
}

export function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export async function serveFile(res, filePath, head = false) {
  let st;
  try { st = await fs.stat(filePath); } catch { return send(res, 404, 'Not found'); }
  if (st.isDirectory()) return send(res, 403, 'Directory');
  res.writeHead(200, { 'Content-Type': mime(filePath), 'Content-Length': st.size, 'Cache-Control': 'no-store' });
  if (head) return res.end();
  res.end(await fs.readFile(filePath));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Creates a handler bound to a deck folder. `deckFile` (optional) is reported to the editor. */
export function createWorkspaceHandler(rootDir, deckFile = null, log = () => {}) {
  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    if (path === '/api/workspace') {
      send(res, 200, JSON.stringify({ id: 'local', name: basename(rootDir), deck: deckFile }), { 'Content-Type': 'application/json' });
      return true;
    }
    if (path === '/api/list') {
      const dir = safeJoin(rootDir, url.searchParams.get('path') || '');
      if (!dir) { send(res, 400, 'Bad path'); return true; }
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { send(res, 404, 'Not found'); return true; }
      const out = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }))
        .sort((a, b) => a.name.localeCompare(b.name));
      send(res, 200, JSON.stringify(out), { 'Content-Type': 'application/json' });
      return true;
    }
    if (path === '/api/mkdir' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const dir = safeJoin(rootDir, body.path || '');
      if (!dir) { send(res, 400, 'Bad path'); return true; }
      await fs.mkdir(dir, { recursive: true });
      send(res, 200, '{}', { 'Content-Type': 'application/json' });
      return true;
    }
    if (path.startsWith('/fs/local/')) {
      const filePath = safeJoin(rootDir, path.slice('/fs/local/'.length));
      if (!filePath) { send(res, 400, 'Bad path'); return true; }
      if (req.method === 'PUT') {
        const data = await readBody(req);
        await fs.mkdir(dirname(filePath), { recursive: true });
        const tmp = filePath + '.lectern-tmp';
        await fs.writeFile(tmp, data);
        await fs.rename(tmp, filePath);
        log(`saved ${relative(rootDir, filePath)} (${data.length} bytes)`);
        send(res, 200, 'OK');
        return true;
      }
      if (req.method === 'GET' || req.method === 'HEAD') { await serveFile(res, filePath, req.method === 'HEAD'); return true; }
      send(res, 405, 'Method not allowed');
      return true;
    }
    return false;
  };
}
