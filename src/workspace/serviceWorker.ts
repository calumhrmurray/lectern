/**
 * Page-side companion to `public/sw.js`. Registers the worker and keeps it
 * supplied with directory handles / in-memory files so that it can serve
 * `<base>fs/<id>/...` URLs.
 */

import { editorBaseUrl } from './Workspace';

export interface MemoryFile { type: string; data: Uint8Array }

type Registration = { kind: 'handle'; handle: FileSystemDirectoryHandle } | { kind: 'memory'; files: Map<string, MemoryFile> };

const registrations = new Map<string, Registration>();
let ready: Promise<ServiceWorker | null> | null = null;

export function serviceWorkerSupported(): boolean {
  return 'serviceWorker' in navigator && location.protocol !== 'file:' && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (!serviceWorkerSupported()) return null;
  if (!ready) {
    ready = (async () => {
      const url = new URL('sw.js', editorBaseUrl());
      const scope = editorBaseUrl();
      const reg = await navigator.serviceWorker.register(url.href, { scope });
      await navigator.serviceWorker.ready;
      // Wait for a controller so fetches from this page go through the worker.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 3000);
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
      navigator.serviceWorker.addEventListener('message', onMessage);
      return reg.active ?? navigator.serviceWorker.controller;
    })();
  }
  return ready;
}

function onMessage(ev: MessageEvent): void {
  const msg = ev.data;
  if (msg?.type === 'need-workspace' && typeof msg.id === 'string') {
    const r = registrations.get(msg.id);
    if (r) void send(msg.id, r);
  }
}

async function send(id: string, r: Registration): Promise<void> {
  const sw = await activeWorker();
  if (!sw) return;
  if (r.kind === 'handle') {
    sw.postMessage({ type: 'register', id, handle: r.handle });
  } else {
    const files: Record<string, MemoryFile> = {};
    for (const [k, v] of r.files) files[k] = v;
    sw.postMessage({ type: 'register-memory', id, files });
  }
}

/** Makes a directory handle servable at `<base>fs/<id>/`. */
export async function serveHandle(id: string, handle: FileSystemDirectoryHandle): Promise<boolean> {
  registrations.set(id, { kind: 'handle', handle });
  const sw = await activeWorker();
  if (!sw) return false;
  await send(id, registrations.get(id)!);
  return ping(id);
}

/** Makes an in-memory file map servable at `<base>fs/<id>/`. */
export async function serveMemory(id: string, files: Map<string, MemoryFile>): Promise<boolean> {
  registrations.set(id, { kind: 'memory', files });
  const sw = await activeWorker();
  if (!sw) return false;
  await send(id, registrations.get(id)!);
  return ping(id);
}

/** Pushes a single updated in-memory file to the worker. */
export async function updateMemoryFile(id: string, path: string, file: MemoryFile): Promise<void> {
  const r = registrations.get(id);
  if (r?.kind === 'memory') r.files.set(path, file);
  const sw = await activeWorker();
  sw?.postMessage({ type: 'update-memory', id, path, file });
}

/** Verifies the worker answers for the workspace (it may have been restarted). */
async function ping(id: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(`fs/${id}/__lectern_ping`, editorBaseUrl()).href, { cache: 'no-store' });
    return res.status === 204;
  } catch {
    return false;
  }
}

export function fsUrl(id: string, path: string): string {
  return new URL(`fs/${id}/${path.split('/').map(encodeURIComponent).join('/')}`, editorBaseUrl()).href;
}
