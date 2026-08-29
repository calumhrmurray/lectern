/**
 * A Workspace is a folder containing a deck. The editor needs two things from
 * it: file access (read/write/list) and a URL prefix from which the deck can
 * be *served* into the editing iframe, so that reveal.js, the theme, images
 * and plugins all load exactly as they would in a browser.
 *
 * Implementations:
 *  - `FsaWorkspace`   — File System Access API directory handle, served by the
 *                       service worker (online / no server needed; Chromium).
 *  - `HttpWorkspace`  — the `lectern` CLI server (any browser).
 *  - `MemoryWorkspace`— in-memory files served by the service worker (demo, tests).
 */

export interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

export interface Workspace {
  /** Identifier used in served URLs: `<base>fs/<id>/<path>`. */
  readonly id: string;
  /** Display name (usually the folder name). */
  readonly name: string;
  readonly kind: 'fsa' | 'http' | 'memory';
  /** Whether writes are possible. */
  readonly writable: boolean;

  list(dir: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, data: Uint8Array | Blob): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Absolute URL that serves `path`. */
  urlFor(path: string): string;
  /** Last-modified time of a file in ms, or null when unknown. Used to notice edits made by other tools. */
  mtime(path: string): Promise<number | null>;
  /** URL usable for <img>/loading right now (may be a blob: URL created on demand). Defaults to urlFor. */
  assetUrl?(path: string): Promise<string>;
}

/** Absolute URL of the editor's base (where index.html and sw.js live). */
export function editorBaseUrl(): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
  return new URL(base, location.href).href;
}

export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

export function dirname(path: string): string {
  const p = normalizePath(path);
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

export function basename(path: string): string {
  const p = normalizePath(path);
  return p.slice(p.lastIndexOf('/') + 1);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

/** Resolves `rel` (as written in an `src` attribute) against the deck file's directory. */
export function resolveRelative(deckPath: string, rel: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(rel) || rel.startsWith('data:') || rel.startsWith('/')) return rel;
  return joinPath(dirname(deckPath), rel);
}

/** Path of `target` relative to the deck file's directory (for writing `src` attributes). */
export function relativeTo(deckPath: string, target: string): string {
  const from = dirname(deckPath).split('/').filter(Boolean);
  const to = normalizePath(target).split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => '..');
  return [...up, ...to.slice(i)].join('/');
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf', wasm: 'application/wasm', map: 'application/json', xml: 'application/xml',
};

export function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp']);
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase());
}
