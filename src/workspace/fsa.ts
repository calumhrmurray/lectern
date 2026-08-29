/**
 * File System Access API workspace (Chromium browsers). The folder is served
 * into the editing iframe by the service worker.
 */

import { fsUrl, serveHandle } from './serviceWorker';
import { normalizePath, type DirEntry, type Workspace } from './Workspace';

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
}

export function fsaSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

let counter = 0;

export class FsaWorkspace implements Workspace {
  readonly kind = 'fsa' as const;
  readonly writable = true;
  readonly id: string;
  readonly name: string;

  constructor(readonly handle: FileSystemDirectoryHandle, id?: string) {
    this.id = id ?? `d${Date.now().toString(36)}${(counter++).toString(36)}`;
    this.name = handle.name;
  }

  /** Registers the handle with the service worker so URLs resolve. */
  async serve(): Promise<boolean> {
    return serveHandle(this.id, this.handle);
  }

  async ensurePermission(mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
    if (!this.handle.queryPermission) return true;
    if ((await this.handle.queryPermission({ mode })) === 'granted') return true;
    return (await this.handle.requestPermission?.({ mode })) === 'granted';
  }

  private async dirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let cur = this.handle;
    for (const seg of normalizePath(path).split('/').filter(Boolean)) {
      cur = await cur.getDirectoryHandle(seg, { create });
    }
    return cur;
  }

  private async fileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const p = normalizePath(path);
    const i = p.lastIndexOf('/');
    const dir = await this.dirHandle(i === -1 ? '' : p.slice(0, i), create);
    return dir.getFileHandle(p.slice(i + 1), { create });
  }

  async list(dir: string): Promise<DirEntry[]> {
    const h = await this.dirHandle(dir);
    const out: DirEntry[] = [];
    for await (const entry of h.values()) {
      out.push({ name: entry.name, kind: entry.kind === 'directory' ? 'directory' : 'file' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(path: string): Promise<boolean> {
    try { await this.fileHandle(path); return true; } catch { /* fallthrough */ }
    try { await this.dirHandle(path); return true; } catch { return false; }
  }

  async readText(path: string): Promise<string> {
    const f = await (await this.fileHandle(path)).getFile();
    return f.text();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const f = await (await this.fileHandle(path)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async writeBytes(path: string, data: Uint8Array | Blob): Promise<void> {
    const fh = await this.fileHandle(path, true);
    const w = await fh.createWritable();
    await w.write(data instanceof Blob ? data : new Blob([data as BlobPart]));
    await w.close();
  }

  async mkdir(path: string): Promise<void> {
    await this.dirHandle(path, true);
  }

  urlFor(path: string): string {
    return fsUrl(this.id, normalizePath(path));
  }
}

// ---------------------------------------------------------------- recents (IndexedDB)

const DB_NAME = 'lectern';
const STORE = 'recents';

export interface RecentEntry {
  id: string;
  name: string;
  deckPath: string;
  handle: FileSystemDirectoryHandle;
  openedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberRecent(entry: RecentEntry): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* recents are best-effort */ }
}

export async function listRecents(): Promise<RecentEntry[]> {
  try {
    const db = await openDb();
    return await new Promise<RecentEntry[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as RecentEntry[]).sort((a, b) => b.openedAt - a.openedAt).slice(0, 8));
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

export async function forgetRecent(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}
