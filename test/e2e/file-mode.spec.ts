import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mod } from './helpers';

/**
 * The double-click experience: Lectern.html opened from file://, a folder
 * picked with the File System Access API, no server anywhere. The folder
 * picker cannot be automated, so it is replaced by a handle to the browser's
 * origin-private file system, filled with the demo deck (including reveal.js
 * and KaTeX) — the editor then runs the real FSA/blob-URL code path.
 */

function collect(dir: string, prefix = ''): { path: string; data: string }[] {
  const out: { path: string; data: string }[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(p).isDirectory()) out.push(...collect(p, rel));
    else out.push({ path: rel, data: readFileSync(p).toString('base64') });
  }
  return out;
}

async function openFolderFromFile(page: import('@playwright/test').Page, folder: string, filter: (p: string) => boolean): Promise<void> {
  const files = collect(folder).filter((f) => filter(f.path) && !f.path.includes('.map'));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + resolve('Lectern.html') + '?test=1');
  await expect(page.locator('.lec-welcome h1')).toContainText('Lectern');

  // An in-memory FileSystemDirectoryHandle look-alike filled with the deck; the picker returns it.
  await page.evaluate(() => {
    type Entry = { kind: 'file'; name: string; data: Uint8Array; mtime: number } | { kind: 'directory'; name: string; children: Map<string, Entry> };
    const root: Entry = { kind: 'directory', name: 'demo', children: new Map() };
    const fileHandle = (e: Extract<Entry, { kind: 'file' }>) => ({
      kind: 'file', name: e.name,
      getFile: async () => new File([e.data], e.name, { lastModified: e.mtime }),
      createWritable: async () => { const chunks: BlobPart[] = []; return { write: async (d: BlobPart) => { chunks.push(d); }, close: async () => { e.data = new Uint8Array(await new Blob(chunks).arrayBuffer()); e.mtime = Date.now(); } }; },
    });
    const dirHandle = (d: Extract<Entry, { kind: 'directory' }>): unknown => ({
      kind: 'directory', name: d.name,
      queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      values: async function* () { for (const c of d.children.values()) yield c.kind === 'file' ? fileHandle(c) : dirHandle(c); },
      getDirectoryHandle: async (name: string, o?: { create?: boolean }) => { let c = d.children.get(name); if (!c) { if (!o?.create) throw new DOMException('nope', 'NotFoundError'); c = { kind: 'directory', name, children: new Map() }; d.children.set(name, c); } if (c.kind !== 'directory') throw new DOMException('nope', 'TypeMismatchError'); return dirHandle(c); },
      getFileHandle: async (name: string, o?: { create?: boolean }) => { let c = d.children.get(name); if (!c) { if (!o?.create) throw new DOMException('nope', 'NotFoundError'); c = { kind: 'file', name, data: new Uint8Array(), mtime: Date.now() }; d.children.set(name, c); } if (c.kind !== 'file') throw new DOMException('nope', 'TypeMismatchError'); return fileHandle(c); },
    });
    (window as unknown as { __fsRoot: Entry; __addFile: (p: string, b64: string) => void; showDirectoryPicker: () => Promise<unknown> }).__fsRoot = root;
    (window as unknown as { __addFile: (p: string, b64: string) => void }).__addFile = (path, b64) => {
      const parts = path.split('/');
      let dir = root as Extract<Entry, { kind: 'directory' }>;
      for (const seg of parts.slice(0, -1)) { let c = dir.children.get(seg); if (!c) { c = { kind: 'directory', name: seg, children: new Map() }; dir.children.set(seg, c); } dir = c as typeof dir; }
      const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      dir.children.set(parts[parts.length - 1], { kind: 'file', name: parts[parts.length - 1], data: bytes, mtime: Date.now() - 60000 });
    };
    (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => dirHandle(root);
  });
  for (let i = 0; i < files.length; i += 20) {
    await page.evaluate((chunk) => { for (const f of chunk) (window as unknown as { __addFile: (p: string, b64: string) => void }).__addFile(f.path, f.data); }, files.slice(i, i + 20));
  }
  await page.locator('.lec-welcome-actions .lec-btn', { hasText: 'Open a folder' }).click();
}

test('Lectern.html works from file:// with a folder handle and no server', async ({ page }) => {
  await openFolderFromFile(page, join(process.cwd(), 'test', '.tmp', 'demo'), (p) => !p.startsWith('parts/') && !p.startsWith('plain/'));
  await page.waitForFunction(() => (window as unknown as { lectern: { editor: { ready: boolean } } }).lectern.editor.ready, null, { timeout: 30_000 });
  await expect(page.locator('.lec-slide-card')).toHaveCount(7);
  const frame = page.frameLocator('.lec-stage-frame');
  await expect(frame.locator('.reveal.ready')).toBeVisible();
  // the theme (blob CSS) applied, the figure (blob image) loaded, KaTeX (blob JS) typeset
  await expect(frame.locator('section.present h1')).toHaveCSS('font-family', /Iowan|Palatino|Georgia|serif/);
  await page.evaluate(() => (window as unknown as { lectern: { editor: { goTo: (r: { top: number; sub: null }) => void } } }).lectern.editor.goTo({ top: 2, sub: null }));
  const imgOk = await frame.locator('section.present img.fig').evaluate((img) => (img as HTMLImageElement).naturalWidth > 0);
  expect(imgOk).toBe(true);
  await page.evaluate(() => (window as unknown as { lectern: { editor: { goTo: (r: { top: number; sub: null }) => void } } }).lectern.editor.goTo({ top: 4, sub: null }));
  await expect(frame.locator('section.present .katex')).toHaveCount(2);

  // Edit and save straight to the folder handle.
  await page.evaluate(() => (window as unknown as { lectern: { editor: { addSlide: (h: string) => number } } }).lectern.editor.addSlide('<section><h2>Saved from file mode</h2></section>'));
  await page.keyboard.press(`${mod}+s`);
  await expect(page.locator('.lec-msg')).toHaveText('Saved');
  const saved = await page.evaluate(() => {
    const root = (window as unknown as { __fsRoot: { children: Map<string, { kind: string; data?: Uint8Array }> } }).__fsRoot;
    return new TextDecoder().decode(root.children.get('index.html')!.data);
  });
  expect(saved).toContain('<h2>Saved from file mode</h2>');
  expect(saved).toContain('<b>Calum Murray</b> &middot; CEA Paris-Saclay');
  expect(saved).not.toContain('blob:');
});

test('file:// mode also handles decks that fetch their slides from part files', async ({ page }) => {
  await openFolderFromFile(page, join(process.cwd(), 'test', '.tmp', 'demo', 'parts'), () => true);
  await page.waitForFunction(() => (window as unknown as { lectern: { editor: { ready: boolean } } }).lectern.editor.ready, null, { timeout: 30_000 });
  await expect(page.locator('.lec-slide-card')).toHaveCount(3);
  const frame = page.frameLocator('.lec-stage-frame');
  await expect(frame.locator('section.present h1')).toHaveText('A deck in parts.');
  await page.evaluate(() => (window as unknown as { lectern: { editor: { goTo: (r: { top: number; sub: null }) => void; addSlide: (h: string) => number } } }).lectern.editor.goTo({ top: 2, sub: null }));
  await page.evaluate(() => (window as unknown as { lectern: { editor: { addSlide: (h: string) => number } } }).lectern.editor.addSlide('<section><h2>Added in part two</h2></section>'));
  await page.keyboard.press(`${mod}+s`);
  await expect(page.locator('.lec-msg')).toHaveText('Saved');
  const saved = await page.evaluate(() => {
    const root = (window as unknown as { __fsRoot: { children: Map<string, { children?: Map<string, { data?: Uint8Array }> }> } }).__fsRoot;
    return new TextDecoder().decode(root.children.get('slides')!.children!.get('p1_more.html')!.data);
  });
  expect(saved).toContain('<h2>Added in part two</h2>');
});
