/**
 * Workspace backed by the `lectern` CLI server (see cli/index.js).
 *   GET  <base>fs/local/<path>   → file
 *   PUT  <base>fs/local/<path>   → write file (creates directories)
 *   GET  <base>api/list?path=    → JSON directory listing
 *   POST <base>api/mkdir         → { path }
 */

import { editorBaseUrl, normalizePath, type DirEntry, type Workspace } from './Workspace';

export class HttpWorkspace implements Workspace {
  readonly kind = 'http' as const;
  readonly writable = true;
  readonly id: string;
  readonly name: string;

  constructor(id = 'local', name = 'local folder') {
    this.id = id;
    this.name = name;
  }

  static async detect(): Promise<HttpWorkspace | null> {
    try {
      const res = await fetch(new URL('api/workspace', editorBaseUrl()).href, { cache: 'no-store' });
      if (!res.ok) return null;
      const info = (await res.json()) as { id: string; name: string };
      return new HttpWorkspace(info.id, info.name);
    } catch {
      return null;
    }
  }

  urlFor(path: string): string {
    return new URL(`fs/${this.id}/${normalizePath(path).split('/').map(encodeURIComponent).join('/')}`, editorBaseUrl()).href;
  }

  async list(dir: string): Promise<DirEntry[]> {
    const res = await fetch(new URL(`api/list?path=${encodeURIComponent(normalizePath(dir))}`, editorBaseUrl()).href, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Cannot list ${dir}: ${res.status}`);
    return (await res.json()) as DirEntry[];
  }

  async exists(path: string): Promise<boolean> {
    const res = await fetch(this.urlFor(path), { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  }

  async readText(path: string): Promise<string> {
    const res = await fetch(this.urlFor(path), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Cannot read ${path}: ${res.status}`);
    return res.text();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const res = await fetch(this.urlFor(path), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Cannot read ${path}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async writeBytes(path: string, data: Uint8Array | Blob): Promise<void> {
    const res = await fetch(this.urlFor(path), { method: 'PUT', body: data as BodyInit });
    if (!res.ok) throw new Error(`Cannot write ${path}: ${res.status} ${await res.text()}`);
  }

  async mkdir(path: string): Promise<void> {
    const res = await fetch(new URL('api/mkdir', editorBaseUrl()).href, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: normalizePath(path) }),
    });
    if (!res.ok) throw new Error(`Cannot create ${path}: ${res.status}`);
  }
}
