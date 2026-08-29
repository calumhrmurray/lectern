/* Lectern service worker.
 *
 * Serves `<scope>fs/<workspace-id>/<path>` from either a File System Access
 * directory handle or an in-memory file map that the page registers via
 * postMessage. This lets the editor load a deck folder straight from disk —
 * with reveal.js, stylesheets, images and plugins resolving exactly as they
 * would on a web server — without any server at all.
 */

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf', wasm: 'application/wasm', map: 'application/json', xml: 'application/xml',
};

/** id → { kind: 'handle', handle } | { kind: 'memory', files: Map } */
const workspaces = new Map();
/** id → [{resolve, timer}] waiting for a registration */
const waiting = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'register' && msg.id && msg.handle) {
    workspaces.set(msg.id, { kind: 'handle', handle: msg.handle });
    resolveWaiting(msg.id);
  } else if (msg.type === 'register-memory' && msg.id && msg.files) {
    const files = new Map(Object.entries(msg.files));
    workspaces.set(msg.id, { kind: 'memory', files });
    resolveWaiting(msg.id);
  } else if (msg.type === 'update-memory' && msg.id && msg.path) {
    const ws = workspaces.get(msg.id);
    if (ws && ws.kind === 'memory') ws.files.set(msg.path, msg.file);
  }
});

function resolveWaiting(id) {
  const list = waiting.get(id);
  if (!list) return;
  waiting.delete(id);
  for (const w of list) { clearTimeout(w.timer); w.resolve(workspaces.get(id)); }
}

async function requestWorkspace(id) {
  const existing = workspaces.get(id);
  if (existing) return existing;
  // Ask every window client to (re)send the registration, then wait briefly.
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: 'need-workspace', id });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const list = waiting.get(id) || [];
      waiting.set(id, list.filter((w) => w.timer !== timer));
      resolve(null);
    }, 4000);
    const list = waiting.get(id) || [];
    list.push({ resolve, timer });
    waiting.set(id, list);
  });
}

function mimeFor(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

async function fileFromHandle(dir, segments) {
  let cur = dir;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = await cur.getDirectoryHandle(segments[i]);
  }
  const fh = await cur.getFileHandle(segments[segments.length - 1]);
  return fh.getFile();
}

const NO_CACHE = { 'Cache-Control': 'no-store' };

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope + 'fs/')) return;
  event.respondWith(serve(url, scope, event.request));
});

async function serve(url, scope, request) {
  const rest = url.pathname.slice((scope + 'fs/').length);
  const slash = rest.indexOf('/');
  const id = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
  const path = slash === -1 ? '' : rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/');

  if (path === '__lectern_ping') {
    return new Response(null, { status: workspaces.has(id) ? 204 : 404, headers: NO_CACHE });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const ws = await requestWorkspace(id);
  if (!ws) return new Response('Workspace not registered: ' + id, { status: 503, headers: NO_CACHE });

  const segments = path.split('/').filter(Boolean);
  if (segments.some((s) => s === '..')) return new Response('Bad path', { status: 400 });
  if (!segments.length) return new Response('Directory', { status: 403 });

  try {
    if (ws.kind === 'memory') {
      const f = ws.files.get(segments.join('/'));
      if (!f) return new Response('Not found: ' + path, { status: 404, headers: NO_CACHE });
      return new Response(request.method === 'HEAD' ? null : f.data, {
        status: 200,
        headers: { 'Content-Type': f.type || mimeFor(path), 'Content-Length': String(f.data.byteLength), ...NO_CACHE },
      });
    }
    const file = await fileFromHandle(ws.handle, segments);
    const type = file.type && file.type !== 'application/octet-stream' ? file.type : mimeFor(path);
    const headers = { 'Content-Type': type, 'Content-Length': String(file.size), ...NO_CACHE };
    // Byte ranges for media playback.
    const range = request.headers.get('range');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), file.size - 1) : file.size - 1;
        const blob = file.slice(start, end + 1);
        return new Response(blob, {
          status: 206,
          headers: { ...headers, 'Content-Length': String(blob.size), 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Accept-Ranges': 'bytes' },
        });
      }
    }
    return new Response(request.method === 'HEAD' ? null : file, { status: 200, headers: { ...headers, 'Accept-Ranges': 'bytes' } });
  } catch (err) {
    const notFound = err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError');
    return new Response((notFound ? 'Not found: ' : 'Error: ') + path + (notFound ? '' : ' — ' + (err && err.message)), {
      status: notFound ? 404 : 500,
      headers: NO_CACHE,
    });
  }
}
