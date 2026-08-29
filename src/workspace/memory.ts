/**
 * In-memory workspace, served by the service worker. Used for the built-in
 * demo deck and in tests. Nothing is persisted; "Save" updates the in-memory
 * file (and the served copy), and the user can download the result.
 */

import { fsUrl, serveMemory, updateMemoryFile, type MemoryFile } from './serviceWorker';
import { mimeFor, normalizePath, type DirEntry, type Workspace } from './Workspace';

let counter = 0;

export class MemoryWorkspace implements Workspace {
  readonly kind = 'memory' as const;
  readonly writable = true;
  readonly id: string;
  readonly name: string;
  readonly files = new Map<string, MemoryFile>();

  constructor(name = 'demo', id?: string) {
    this.name = name;
    this.id = id ?? `m${Date.now().toString(36)}${(counter++).toString(36)}`;
  }

  addText(path: string, text: string): void {
    this.files.set(normalizePath(path), { type: mimeFor(path), data: new TextEncoder().encode(text) });
  }

  addBytes(path: string, data: Uint8Array, type?: string): void {
    this.files.set(normalizePath(path), { type: type ?? mimeFor(path), data });
  }

  async serve(): Promise<boolean> {
    return serveMemory(this.id, this.files);
  }

  async list(dir: string): Promise<DirEntry[]> {
    const prefix = normalizePath(dir);
    const seen = new Map<string, DirEntry>();
    for (const key of this.files.keys()) {
      if (prefix && !key.startsWith(prefix + '/')) continue;
      const rest = prefix ? key.slice(prefix.length + 1) : key;
      const first = rest.split('/')[0];
      if (!first) continue;
      const kind = rest.includes('/') ? 'directory' : 'file';
      if (!seen.has(first)) seen.set(first, { name: first, kind });
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    if (this.files.has(p)) return true;
    for (const key of this.files.keys()) if (key.startsWith(p + '/')) return true;
    return false;
  }

  async readText(path: string): Promise<string> {
    const f = this.files.get(normalizePath(path));
    if (!f) throw new Error(`Not found: ${path}`);
    return new TextDecoder().decode(f.data);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const f = this.files.get(normalizePath(path));
    if (!f) throw new Error(`Not found: ${path}`);
    return f.data;
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async writeBytes(path: string, data: Uint8Array | Blob): Promise<void> {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    const p = normalizePath(path);
    const file = { type: data instanceof Blob && data.type ? data.type : mimeFor(p), data: bytes };
    this.files.set(p, file);
    await updateMemoryFile(this.id, p, file);
  }

  async mkdir(): Promise<void> { /* directories are implicit */ }

  urlFor(path: string): string {
    return fsUrl(this.id, normalizePath(path));
  }
}
