/**
 * Request handler shared by the `lectern` CLI and the Vite dev server:
 *   GET/HEAD/PUT /fs/local/<path>  files in the deck folder (PUT writes atomically)
 * Requests are refused unless their Host (and Origin) is the machine itself — see `requestAllowed`.
 *   GET  /api/workspace            { id, name, deck }
 *   GET  /api/list?path=           [{ name, kind }]
 *   POST /api/mkdir  { path }
 * Returns true when the request was handled.
 */
import { promises as fs } from 'node:fs';
import { isIP } from 'node:net';
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

/**
 * Resolves symlinks in a lexically-contained path and checks the real location is still inside
 * `root` (the folder is served to a browser: a link pointing at ~/.ssh must not be readable or
 * writable through it). Missing trailing segments — a file about to be written, a folder about to
 * be made — are checked against their nearest existing ancestor. Returns the real path or null.
 */
export async function realInside(root, p) {
  const realRoot = await fs.realpath(root);
  let existing = p;
  const rest = [];
  for (;;) {
    try { existing = await fs.realpath(existing); break; } catch { /* does not exist yet: go up */ }
    const parent = dirname(existing);
    if (parent === existing) return null;
    rest.unshift(basename(existing));
    existing = parent;
  }
  const real = join(existing, ...rest);
  const rel = relative(realRoot, real);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  return real;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const WILDCARD = new Set(['0.0.0.0', '::', '']);
export const isLoopbackHost = (h) => LOOPBACK.has(String(h ?? '').toLowerCase());

/** Hostname (without port or IPv6 brackets) from a Host/Origin-style `host:port` string, or from a URL. */
function hostnameOf(value) {
  const v = String(value ?? '').trim();
  try { return new URL(v.includes('://') ? v : `http://${v}`).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return null; }
}

/**
 * Whether a request may be served, given the address the server listens on: the `Host` must be
 * loopback, the bind address itself or (for a wildcard bind) an IP literal, and an `Origin` — sent
 * on cross-site fetches and every PUT/POST — must name one of the same hosts. A DNS-rebinding page
 * arrives with its own domain in both headers and is refused, so it cannot read or write the folder.
 * Returns null when allowed, otherwise the reason.
 */
export function requestAllowed(headers, bindHost = '127.0.0.1') {
  const bind = String(bindHost ?? '').toLowerCase();
  const ok = (name) => name !== null && (LOOPBACK.has(name) || name === bind || (WILDCARD.has(bind) && isIP(name) !== 0));
  const host = hostnameOf(headers.host);
  if (!ok(host)) return `host ${headers.host ?? '(none)'} not allowed`;
  if (headers.origin !== undefined && !ok(hostnameOf(headers.origin))) return `origin ${headers.origin} not allowed`;
  return null;
}

/**
 * `nosniff` on everything: the deck folder is served to a browser, and without it a page
 * elsewhere could get one of these files treated as a script it is allowed to run.
 */
export function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

export async function serveFile(res, filePath, head = false, extraHeaders = {}) {
  let st;
  try { st = await fs.stat(filePath); } catch { return send(res, 404, 'Not found'); }
  if (st.isDirectory()) return send(res, 403, 'Directory');
  res.writeHead(200, {
    'Content-Type': mime(filePath), 'Content-Length': st.size, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Last-Modified': st.mtime.toUTCString(), ...extraHeaders,
  });
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

/**
 * Creates a handler bound to a deck folder. `deckFile` (optional) is reported to the editor;
 * `host` is the address the server listens on (see `requestAllowed`).
 */
export function createWorkspaceHandler(rootDir, deckFile = null, log = () => {}, { host = '127.0.0.1' } = {}) {
  return async function handle(req, res) {
    const refused = requestAllowed(req.headers, host);
    if (refused) { send(res, 403, `Forbidden: ${refused}`); return true; }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    if (path === '/api/workspace') {
      send(res, 200, JSON.stringify({ id: 'local', name: basename(rootDir), deck: deckFile }), { 'Content-Type': 'application/json' });
      return true;
    }
    if (path === '/api/list') {
      const lexical = safeJoin(rootDir, url.searchParams.get('path') || '');
      const dir = lexical && await realInside(rootDir, lexical);
      if (!dir) { send(res, lexical ? 403 : 400, 'Bad path'); return true; }
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
      const lexical = safeJoin(rootDir, body.path || '');
      const dir = lexical && await realInside(rootDir, lexical);
      if (!dir) { send(res, lexical ? 403 : 400, 'Bad path'); return true; }
      await fs.mkdir(dir, { recursive: true });
      send(res, 200, '{}', { 'Content-Type': 'application/json' });
      return true;
    }
    if (path.startsWith('/fs/local/')) {
      const lexical = safeJoin(rootDir, path.slice('/fs/local/'.length));
      const filePath = lexical && await realInside(rootDir, lexical);
      if (!filePath) { send(res, lexical ? 403 : 400, 'Bad path'); return true; }
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
