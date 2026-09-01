/**
 * App — wires the editor to the UI and to a workspace; handles opening,
 * saving, keyboard shortcuts, clipboard/file drops and the welcome screen.
 */

import demoDeckHtml from '../demo/index.html?raw';
import demoThemeCss from '../demo/theme.css?raw';
import demoPlotSvg from '../demo/figures/plot.svg?raw';
import examplesIndex from '../../public/examples/index.json';
import whaleHtml from '../../public/examples/whale-evolution/index.html?raw';
import whaleCss from '../../public/examples/whale-evolution/theme.css?raw';
import natHtml from '../../public/examples/naturalisation-fr/index.html?raw';
import natCss from '../../public/examples/naturalisation-fr/theme.css?raw';
import { BlobUrlCache, inlineDeck, installFetchBridge } from '../workspace/inline';
import { REVEAL_EMBEDDED } from '../deck/revealAssets';
import { discoverFontFamilies, discoverThemeClasses, type ThemeClass } from '../deck/cssClasses';
import { DeckDocument } from '../deck/DeckDocument';
import { detectParts } from '../deck/scan';
import { starterDeckHtml } from '../deck/templates';
import { themeById } from '../deck/themes';
import type { SlideRef } from '../stage/Stage';
import { versionLabel } from '../version';
import { h } from '../ui/dom';
import { TUTORIAL_URL, aboutDialog, confirmDialog, layoutPicker, modal, newDeckDialog, pickDeckFile, pickImage, renderWelcome, shortcutsDialog, type ExampleInfo } from '../ui/Dialogs';
import { Inspector } from '../ui/Inspector';
import { closeMenus } from '../ui/Menu';
import { Navigator } from '../ui/Navigator';
import { Panels } from '../ui/Panels';
import { ThumbnailRenderer } from '../ui/Thumbnails';
import { Toolbar } from '../ui/Toolbar';
import { FsaWorkspace, fsaSupported, forgetRecent, listRecents, rememberRecent, type RecentEntry } from '../workspace/fsa';
import { HttpWorkspace } from '../workspace/http';
import { MemoryWorkspace } from '../workspace/memory';
import { basename, dirname, editorBaseUrl, joinPath, relativeTo, resolveRelative, type Workspace } from '../workspace/Workspace';

const EMBEDDED_EXAMPLES: Record<string, Record<string, string>> = {
  'whale-evolution': { 'index.html': whaleHtml, 'theme.css': whaleCss },
  'naturalisation-fr': { 'index.html': natHtml, 'theme.css': natCss },
};
import { Editor } from './Editor';

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export class App {
  readonly editor: Editor;
  readonly toolbar: Toolbar;
  readonly navigator: Navigator;
  readonly inspector: Inspector;
  readonly panels: Panels;
  readonly thumbs: ThumbnailRenderer;
  workspace: Workspace | null = null;
  deckPath = '';
  themeClasses: ThemeClass[] = [];
  fonts: string[] = [];
  zoom = 1;
  visible = { navigator: true, inspector: true };
  private els: { navigator: HTMLElement; stageWrap: HTMLElement; stage: HTMLElement; inspector: HTMLElement; status: HTMLElement; msg: HTMLElement; pos: HTMLElement; path: HTMLElement; welcome: HTMLElement; loading: HTMLElement; dropzone: HTMLElement };
  private toastEl: HTMLElement | null = null;
  /** Last-modified times of the deck's files as we last read or wrote them. */
  private baseline = new Map<string, number | null>();
  private watchTimer = 0;
  private conflictBanner: HTMLElement | null = null;
  /** Inline mode: the deck is loaded as srcdoc with blob URLs (no service worker, e.g. file://). */
  private inline = false;
  private blobCache: BlobUrlCache | null = null;
  private removeBridge: (() => void) | null = null;
  private inlinedHtml = '';
  private toastTimer = 0;
  private saving = false;
  /** Save automatically shortly after each change (default on; remembered). */
  autosave = localStorage.getItem('lectern:autosave') !== 'off';
  private autosaveTimer = 0;

  constructor(readonly root: HTMLElement) {
    const toolbarEl = h('div', { class: 'lec-toolbar', role: 'toolbar' });
    const navigatorEl = h('div', { class: 'lec-navigator', 'aria-label': 'Slides' });
    const stage = h('div', { class: 'lec-stage lec-empty' });
    const loading = h('div', { class: 'lec-loading', style: 'display:none' }, 'Loading deck…');
    const dropzone = h('div', { class: 'lec-dropzone' }, 'Drop images to insert them');
    const stageWrap = h('div', { class: 'lec-stage-wrap' }, stage, loading, dropzone);
    const panelsEl = h('div', {});
    const center = h('div', { class: 'lec-center' }, stageWrap, panelsEl);
    const inspectorEl = h('div', { class: 'lec-inspector', 'aria-label': 'Inspector' });
    const msg = h('span', { class: 'lec-msg' });
    const pos = h('span', {});
    const path = h('span', { class: 'lec-path' });
    const status = h('div', { class: 'lec-status' }, path, h('span', { class: 'lec-spacer' }), msg, h('span', { class: 'lec-spacer' }), pos);
    const welcome = h('div', { class: 'lec-welcome' });
    root.append(toolbarEl, h('div', { class: 'lec-main' }, navigatorEl, center, inspectorEl), status, welcome);
    this.els = { navigator: navigatorEl, stageWrap, stage, inspector: inspectorEl, status, msg, pos, path, welcome, loading, dropzone };

    this.editor = new Editor(stage);
    this.thumbs = new ThumbnailRenderer(this.editor);
    this.panels = new Panels(this, panelsEl);
    this.toolbar = new Toolbar(this, toolbarEl);
    this.navigator = new Navigator(this, navigatorEl);
    this.inspector = new Inspector(this, inspectorEl);
    this.wireEditorEvents();
    this.wireGlobalEvents();
  }

  get hasDeck(): boolean { return this.editor.ready && !!this.workspace; }

  // ---------------------------------------------------------------- startup

  async start(): Promise<void> {
    const params = new URLSearchParams(location.search);
    if (params.get('ws') === 'local' || params.has('deck')) {
      const ws = await HttpWorkspace.detect();
      if (ws) {
        const deck = params.get('deck');
        try {
          await this.openDeck(ws, deck ?? (await pickDeckFile(ws)) ?? '');
          return;
        } catch (err) {
          this.toast((err as Error).message, 'error');
        }
      }
    }
    await this.showWelcome();
  }

  async showWelcome(): Promise<void> {
    const recents = fsaSupported() ? await listRecents() : [];
    renderWelcome(this, this.els.welcome, recents, fsaSupported(), await this.listExamples());
    this.els.welcome.classList.remove('lec-hidden');
  }

  async listExamples(): Promise<ExampleInfo[]> {
    return (examplesIndex as { examples: ExampleInfo[] }).examples;
  }

  /**
   * Puts a reveal.js distribution at `<base>/reveal` in the workspace: the full
   * copy when the editor is served from a folder that has one, otherwise the
   * embedded essentials (works offline and from Lectern.html on file://).
   */
  private async installReveal(ws: Workspace, base: string): Promise<void> {
    if (location.protocol !== 'file:') {
      try {
        const res = await fetch(new URL('reveal/manifest.json', editorBaseUrl()).href, { cache: 'no-store' });
        if (res.ok) {
          const manifest = (await res.json()) as { files: string[] };
          for (const f of manifest.files) {
            const data = new Uint8Array(await (await fetch(new URL(`reveal/${f}`, editorBaseUrl()).href)).arrayBuffer());
            await ws.writeBytes(joinPath(base, 'reveal', f), data);
          }
          return;
        }
      } catch { /* fall back to the embedded copy */ }
    }
    for (const [f, text] of Object.entries(REVEAL_EMBEDDED)) await ws.writeText(joinPath(base, 'reveal', f), text);
  }

  /**
   * Saves a bundled example into a folder of the user's choice (as ordinary
   * HTML slides with their own reveal.js) and opens it from there.
   */
  async saveExampleToFolder(id: string): Promise<void> {
    const files = EMBEDDED_EXAMPLES[id];
    if (!files) { this.toast(`Unknown example ${id}`, 'error'); return; }
    let ws: Workspace; let base = '';
    if (fsaSupported() && window.showDirectoryPicker) {
      let handle: FileSystemDirectoryHandle;
      try { handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'lectern-example' }); } catch { return; }
      const w = new FsaWorkspace(handle);
      if (!(await w.ensurePermission('readwrite'))) return;
      await w.serve();
      if ((await w.list('')).some((e) => e.name === 'index.html')) {
        if (!(await confirmDialog('Folder not empty', 'This folder already has an index.html. Overwrite it?', 'Overwrite'))) return;
      }
      ws = w;
    } else {
      const http = this.workspace?.kind === 'http' ? (this.workspace as HttpWorkspace) : await HttpWorkspace.detect();
      if (!http) { this.toast('Saving needs the folder picker (Chrome/Edge) or the CLI.', 'error'); return; }
      ws = http; base = id;
    }
    this.setLoading(true, 'Saving the example…');
    try {
      await this.installReveal(ws, base);
      for (const [f, text] of Object.entries(files)) {
        await ws.writeText(joinPath(base, f), /\.html?$/i.test(f) ? text.replace(/(href|src)="\.\.\/\.\.\/reveal\//g, '$1="reveal/') : text);
      }
    } finally { this.setLoading(false); }
    await this.openDeck(ws, joinPath(base, 'index.html'));
  }

  /** Opens a bundled example deck in an in-memory workspace (preview only). */
  async openExample(id: string): Promise<void> {
    const files = EMBEDDED_EXAMPLES[id];
    if (!files) { this.toast(`Unknown example ${id}`, 'error'); return; }
    const ws = new MemoryWorkspace(id);
    for (const [f, text] of Object.entries(REVEAL_EMBEDDED)) ws.addText(`reveal/${f}`, text);
    for (const [f, text] of Object.entries(files)) {
      ws.addText(f, /\.html?$/i.test(f) ? text.replace(/(href|src)="\.\.\/\.\.\/reveal\//g, '$1="reveal/') : text);
    }
    await ws.serve();
    await this.openDeck(ws, 'index.html');
    this.toast('Preview only: this copy lives in memory. Use “Save to a folder” on the welcome screen to keep and edit it.', 'info');
  }

  private hideWelcome(): void { this.els.welcome.classList.add('lec-hidden'); }

  // ---------------------------------------------------------------- opening

  async openFolder(): Promise<void> {
    if (!fsaSupported() || !window.showDirectoryPicker) { this.toast('Folder access needs Chrome or Edge. Use the CLI in other browsers.', 'error'); return; }
    let handle: FileSystemDirectoryHandle;
    try { handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'lectern-deck' }); }
    catch { return; }
    const ws = new FsaWorkspace(handle);
    if (!(await ws.ensurePermission('readwrite'))) { this.toast('Write permission was not granted.', 'error'); return; }
    await ws.serve();
    const deck = await pickDeckFile(ws);
    if (!deck) return;
    await this.openDeck(ws, deck);
  }

  async openRecent(r: RecentEntry): Promise<void> {
    const ws = new FsaWorkspace(r.handle, r.id);
    if (!(await ws.ensurePermission('readwrite'))) { this.toast('Permission to the folder was not granted.', 'error'); return; }
    await ws.serve();
    if (!(await ws.exists(r.deckPath))) {
      await forgetRecent(r.id);
      this.toast(`${r.deckPath} no longer exists in ${r.name}.`, 'error');
      void this.showWelcome();
      return;
    }
    await this.openDeck(ws, r.deckPath);
  }

  async pickDeckInWorkspace(): Promise<void> {
    if (!this.workspace) return;
    if (!(await this.confirmDiscard())) return;
    const deck = await pickDeckFile(this.workspace);
    if (deck) await this.openDeck(this.workspace, deck);
  }

  async openDemo(): Promise<void> {
    const ws = new MemoryWorkspace('demo');
    for (const [f, text] of Object.entries(REVEAL_EMBEDDED)) ws.addText(`reveal/${f}`, text);
    ws.addText('index.html', demoDeckHtml.replace("katex: { local: 'katex' },", ''));
    ws.addText('theme.css', demoThemeCss);
    ws.addText('figures/plot.svg', demoPlotSvg);
    await ws.serve();
    await this.openDeck(ws, 'index.html');
  }

  async newDeck(): Promise<void> {
    const fsa = fsaSupported();
    const http = this.workspace?.kind === 'http' ? (this.workspace as HttpWorkspace) : await HttpWorkspace.detect();
    const opts = await newDeckDialog(!fsa);
    if (!opts) return;
    let ws: Workspace;
    let base = '';
    if (http && !fsa) {
      ws = http;
      base = opts.folderName;
    } else if (fsa) {
      let handle: FileSystemDirectoryHandle;
      try { handle = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'lectern-new' }); } catch { return; }
      const w = new FsaWorkspace(handle);
      if (!(await w.ensurePermission('readwrite'))) return;
      await w.serve();
      const existing = await w.list('');
      if (existing.some((e) => e.name === 'index.html')) {
        if (!(await confirmDialog('Folder not empty', 'This folder already has an index.html. Overwrite it?', 'Overwrite'))) return;
      }
      ws = w;
    } else {
      ws = new MemoryWorkspace(opts.folderName);
      await (ws as MemoryWorkspace).serve();
      this.toast('No folder access in this browser — the new deck lives in memory. Use “Download a copy” to keep it.', 'info');
    }
    this.setLoading(true, 'Creating deck…');
    try {
      await this.installReveal(ws, base);
      const theme = themeById(opts.theme);
      await ws.writeText(joinPath(base, 'theme.css'), theme.css);
      await ws.writeText(joinPath(base, 'index.html'), starterDeckHtml({ title: opts.title, author: opts.author, width: opts.width, height: opts.height, revealPath: 'reveal', theme }));
      await this.openDeck(ws, joinPath(base, 'index.html'));
    } catch (err) {
      this.toast(`Could not create the deck: ${(err as Error).message}`, 'error');
    } finally {
      this.setLoading(false);
    }
  }

  async openDeck(ws: Workspace, deckPath: string): Promise<void> {
    if (!deckPath) return;
    this.setLoading(true, 'Loading deck…');
    try {
      const text = await ws.readText(deckPath);
      const partPaths = detectParts(text);
      const parts = [];
      for (const rel of partPaths) {
        const path = resolveRelative(deckPath, rel);
        try { parts.push({ path, text: await ws.readText(path) }); }
        catch { throw new Error(`This deck loads slides from ${rel}, which could not be read.`); }
      }
      const doc = new DeckDocument(text, { path: deckPath, parts });
      this.workspace = ws;
      this.deckPath = deckPath;
      this.hideWelcome();
      this.els.stage.classList.remove('lec-empty');
      this.inline = (ws as { mode?: string }).mode === 'blob';
      this.removeBridge?.(); this.removeBridge = null;
      this.blobCache = null;
      this.editor.stage.liveUrlResolver = null;
      if (this.inline) {
        this.blobCache = (ws as unknown as { blobs: BlobUrlCache }).blobs;
        this.removeBridge = installFetchBridge(ws, this.blobCache);
        this.setLoading(true, 'Reading the folder…');
        await this.blobCache.preload();
        this.inlinedHtml = await inlineDeck(ws, deckPath, text, this.blobCache, REVEAL_EMBEDDED);
        const cache = this.blobCache;
        const deckDir = dirname(deckPath);
        this.editor.stage.liveUrlResolver = (rel) => cache.peek(joinPath(deckDir, rel.split(/[?#]/)[0]));
        await this.editor.open({ srcdoc: this.inlinedHtml }, doc);
      } else {
        await this.editor.open(ws.urlFor(deckPath) + '?lectern=1', doc);
      }
      this.themeClasses = discoverThemeClasses(this.editor.stage.doc);
      this.fonts = discoverFontFamilies(this.editor.stage.doc);
      this.thumbs.invalidate();
      document.title = `${doc.info.title} — Lectern`;
      this.els.path.textContent = `${ws.name} / ${deckPath}`;
      const savedSize = localStorage.getItem(`lectern:size:${ws.name}/${deckPath}`);
      if (savedSize && doc.info.kind === 'plain') { const [w, h] = savedSize.split('x').map(Number); if (w && h) this.editor.stage.setLogicalSize(w, h); }
      if (ws instanceof FsaWorkspace) void rememberRecent({ id: ws.id, name: ws.name, deckPath, handle: ws.handle, openedAt: Date.now() });
      this.navigator.render();
      this.inspector.render();
      this.panels.update();
      this.toolbar.update();
      this.updateStatus();
      this.editor.overlay.el.focus({ preventScroll: true });
      await this.recordBaseline();
      this.startWatching();
      this.toast(`Opened ${basename(deckPath)} · ${this.editor.slideRefs().length} slides`);
    } catch (err) {
      console.error(err);
      this.els.stage.classList.add('lec-empty');
      this.workspace = null; this.deckPath = '';
      this.hideConflict(); clearInterval(this.watchTimer);
      this.navigator.render(); this.inspector.render(); this.toolbar.update(); this.updateStatus();
      await modal({ title: 'Could not open the deck', body: [h('p', {}, (err as Error).message), h('p', { class: 'lec-help' }, 'The deck must be a reveal.js page (a global Reveal) or a page of <section> slides. If it loads reveal.js from the internet, check your connection.')] });
      void this.showWelcome();
    } finally {
      this.setLoading(false);
    }
  }

  async reload(): Promise<void> {
    if (!this.workspace || !this.deckPath) return;
    if (!(await this.confirmDiscard())) return;
    await this.reloadInPlace();
  }

  /** Re-reads the deck from disk, keeping the current slide. */
  private async reloadInPlace(): Promise<void> {
    if (!this.workspace || !this.deckPath) return;
    const ref = this.editor.ready ? { ...this.editor.current } : null;
    this.hideConflict();
    await this.openDeck(this.workspace, this.deckPath);
    if (ref && this.editor.ready && ref.top < this.editor.doc.length) this.editor.goTo(ref);
  }

  // ---------------------------------------------------------------- watching the files (another editor, an assistant…)

  private async recordBaseline(): Promise<void> {
    this.baseline.clear();
    if (!this.workspace || !this.editor.ready) return;
    for (const src of this.editor.doc.sources) this.baseline.set(src.path, await this.workspace.mtime(src.path));
  }

  private startWatching(): void {
    clearInterval(this.watchTimer);
    this.watchFailures = 0;
    if (!this.workspace || this.workspace.kind === 'memory') return;
    this.watchTimer = window.setInterval(() => void this.checkDisk(), 2000);
  }

  /** Paths whose file on disk is newer than what we loaded/saved. */
  private async changedOnDisk(): Promise<string[]> {
    if (!this.workspace || !this.editor.ready) return [];
    const out: string[] = [];
    for (const [path, known] of this.baseline) {
      const now = await this.workspace.mtime(path);
      if (now !== null && known !== null && now > known) out.push(path);
    }
    return out;
  }

  private checking = false;
  private watchFailures = 0;
  private async checkDisk(): Promise<void> {
    if (this.checking || this.saving || !this.editor.ready || document.hidden) return;
    this.checking = true;
    try {
      const changed = await this.changedOnDisk();
      this.watchFailures = 0;
      if (!changed.length) return;
      if (!this.editor.doc.dirty && !this.editor.textSession && !this.editor.interactions.busy) {
        await this.reloadInPlace();
        this.setMessage(`Reloaded — ${basename(changed[0])} changed on disk`, 'info');
      } else {
        this.showConflict(changed);
      }
    } catch (err) {
      console.warn('Lectern: checking the folder for changes failed', err);
      if (++this.watchFailures >= 3) {
        clearInterval(this.watchTimer);
        this.watchTimer = 0;
        this.setMessage('Stopped watching the folder — reopen the deck to see changes made outside the editor', 'info');
      }
    } finally {
      this.checking = false;
    }
  }

  private showConflict(changed: string[]): void {
    if (this.conflictBanner) return;
    const banner = h('div', { class: 'lec-banner', role: 'alert' },
      h('span', {}, `${basename(changed[0])} was changed on disk while you have unsaved edits.`),
      h('button', { class: 'lec-btn', type: 'button', onclick: () => void this.reloadInPlace() }, 'Reload from disk (discard mine)'),
      h('button', { class: 'lec-btn', type: 'button', onclick: async () => { await this.recordBaseline(); this.hideConflict(); } }, 'Keep mine (overwrite on save)'),
    );
    this.conflictBanner = banner;
    this.els.stageWrap.appendChild(banner);
  }

  private hideConflict(): void {
    this.conflictBanner?.remove();
    this.conflictBanner = null;
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.editor.ready || !this.editor.doc.dirty) return true;
    return confirmDialog('Unsaved changes', 'Discard the unsaved changes in this deck?', 'Discard');
  }

  // ---------------------------------------------------------------- saving

  setAutosave(on: boolean): void {
    this.autosave = on;
    localStorage.setItem('lectern:autosave', on ? 'on' : 'off');
    this.updateStatus();
    if (on) this.scheduleAutosave();
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    if (!this.autosave || !this.workspace || this.workspace.kind === 'memory') return;
    this.autosaveTimer = window.setTimeout(() => {
      const ed = this.editor;
      if (!ed.ready || !ed.doc.dirty || ed.textSession || ed.interactions.busy) { if (ed.ready && ed.doc.dirty) this.scheduleAutosave(); return; }
      void this.save({ auto: true });
    }, 1200);
  }

  async save(opts: { auto?: boolean } = {}): Promise<boolean> {
    if (!this.workspace || !this.editor.ready || this.saving) return false;
    if (!opts.auto) this.editor.endTextEdit();
    // Never silently overwrite someone else's edit.
    const changed = await this.changedOnDisk();
    if (changed.length) {
      if (opts.auto) { this.showConflict(changed); return false; }
      if (!(await confirmDialog('Changed on disk', `${basename(changed[0])} was modified by another program since you opened it. Overwrite it with your version?`, 'Overwrite'))) {
        this.showConflict(changed);
        return false;
      }
    }
    this.saving = true;
    try {
      const doc = this.editor.doc;
      const dirty = doc.dirtySources();
      const saved = new Map<number, string>();
      for (const i of dirty) {
        const text = doc.serializeSource(i);
        await this.workspace.writeText(doc.sources[i].path, text);
        saved.set(i, text);
      }
      doc.rebase(saved);
      await this.recordBaseline();
      this.hideConflict();
      this.toolbar.update();
      this.updateStatus();
      this.setMessage(opts.auto ? `Autosaved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : dirty.length > 1 ? `Saved ${dirty.length} files` : 'Saved', 'ok');
      return true;
    } catch (err) {
      this.toast(`Save failed: ${(err as Error).message}`, 'error');
      return false;
    } finally {
      this.saving = false;
    }
  }

  download(): void {
    if (!this.editor.ready) return;
    this.editor.endTextEdit();
    const text = this.editor.doc.serialize();
    const blob = new Blob([text], { type: 'text/html' });
    const a = h('a', { href: URL.createObjectURL(blob), download: basename(this.deckPath) || 'deck.html' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  present(): void {
    if (!this.workspace || !this.editor.ready) return;
    const open = () => {
      const c = this.editor.current;
      const hash = this.editor.stage.kind === 'reveal' ? `#/${c.top}${c.sub !== null ? '/' + c.sub : ''}` : `#${c.top + 1}`;
      if (this.inline) {
        // No URL to open: write the inlined deck into a new window.
        void (async () => {
          const html = await inlineDeck(this.workspace!, this.deckPath, this.editor.doc.serialize(), this.blobCache!, REVEAL_EMBEDDED);
          const w = window.open('', '_blank');
          if (!w) { this.toast('The browser blocked the presentation window.', 'error'); return; }
          w.document.open(); w.document.write(html); w.document.close();
          w.location.hash = hash;
        })();
        return;
      }
      window.open(this.workspace!.urlFor(this.deckPath) + hash, '_blank');
    };
    if (this.editor.doc.dirty) void this.save().then((ok) => { if (ok) open(); });
    else open();
  }

  // ---------------------------------------------------------------- images

  /** Folder inside the deck folder where added images go. */
  private async imageFolder(): Promise<string> {
    const ws = this.workspace!;
    const dir = dirname(this.deckPath);
    for (const name of ['figures', 'images', 'img', 'assets']) {
      if (await ws.exists(joinPath(dir, name))) return joinPath(dir, name);
    }
    return joinPath(dir, 'images');
  }

  /** Copies a file into the deck folder, returning its workspace path. */
  private async storeImage(file: File): Promise<string> {
    const ws = this.workspace!;
    const folder = await this.imageFolder();
    await ws.mkdir(folder);
    const clean = file.name.replace(/[^\w.-]+/g, '_');
    let name = clean;
    let n = 1;
    while (await ws.exists(joinPath(folder, name))) {
      const dot = clean.lastIndexOf('.');
      name = dot === -1 ? `${clean}-${n}` : `${clean.slice(0, dot)}-${n}${clean.slice(dot)}`;
      n++;
    }
    const path = joinPath(folder, name);
    await ws.writeBytes(path, file);
    return path;
  }

  /** Opens the image chooser; resolves to the `src` (relative to the deck file) and its URL. */
  async chooseImage(): Promise<{ src: string; url: string } | null> {
    if (!this.workspace) return null;
    const path = await pickImage(this.workspace, { onUpload: (f) => this.storeImage(f) });
    if (!path) return null;
    return { src: relativeTo(this.deckPath, path), url: await this.assetUrl(path) };
  }

  private async assetUrl(path: string): Promise<string> {
    const ws = this.workspace!;
    return ws.assetUrl ? ws.assetUrl(path) : ws.urlFor(path);
  }

  async insertImageViaDialog(): Promise<void> {
    const pick = await this.chooseImage();
    if (pick) await this.editor.insertImage(pick.src, pick.url);
  }

  async insertImageFiles(files: File[]): Promise<void> {
    if (!this.workspace || !this.editor.ready) return;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const path = await this.storeImage(f);
        await this.editor.insertImage(relativeTo(this.deckPath, path), await this.assetUrl(path));
      } catch (err) {
        this.toast(`Could not add ${f.name}: ${(err as Error).message}`, 'error');
      }
    }
  }

  // ---------------------------------------------------------------- slides UI

  showNewSlideMenu(at: HTMLElement | { x: number; y: number }): void {
    if (!this.editor.ready) return;
    void layoutPicker(this, at);
  }

  async deleteCurrentSlide(ref: SlideRef = this.editor.current): Promise<void> {
    if (!this.editor.ready || !this.editor.doc.length) return;
    this.editor.deleteSlide(ref);
  }

  // ---------------------------------------------------------------- layout & view

  toggle(panel: 'navigator' | 'inspector'): void {
    this.visible[panel] = !this.visible[panel];
    this.els[panel].classList.toggle('lec-hidden', !this.visible[panel]);
    this.toolbar.update();
    if (panel === 'navigator' && this.visible.navigator) this.navigator.fitThumbs();
  }

  setZoom(z: number): void {
    this.zoom = Math.max(0.25, Math.min(4, z));
    const wrap = this.els.stageWrap;
    const stage = this.els.stage;
    if (this.zoom === 1) {
      stage.style.width = '100%'; stage.style.height = '100%';
    } else {
      stage.style.width = `${Math.round(wrap.clientWidth * this.zoom)}px`;
      stage.style.height = `${Math.round(wrap.clientHeight * this.zoom)}px`;
    }
    this.editor.stage.fit(1);
    this.toolbar.update();
    this.updateStatus();
    this.editor.refreshOverlay();
  }

  zoomBy(dir: 1 | -1): void {
    const i = ZOOM_LEVELS.findIndex((z) => z >= this.zoom - 1e-6);
    const next = dir > 0 ? ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, (i === -1 ? ZOOM_LEVELS.length - 1 : i) + 1)] : ZOOM_LEVELS[Math.max(0, (i === -1 ? 0 : i) - 1)];
    this.setZoom(next);
  }

  showShortcuts(): void { void shortcutsDialog(); }
  showTutorial(): void { window.open(TUTORIAL_URL, '_blank', 'noopener'); }
  showAbout(): void { void aboutDialog(); }

  private setLoading(on: boolean, text = 'Loading…'): void {
    this.els.loading.style.display = on ? '' : 'none';
    this.els.loading.textContent = text;
  }

  toast(text: string, kind: 'info' | 'error' = 'info'): void {
    this.toastEl?.remove();
    this.toastEl = h('div', { class: `lec-toast${kind === 'error' ? ' lec-error' : ''}`, role: 'status' }, text);
    document.body.appendChild(this.toastEl);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toastEl?.remove(); this.toastEl = null; }, kind === 'error' ? 6000 : 2200);
    if (kind === 'error') console.warn(text);
  }

  private setMessage(text: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
    this.els.msg.textContent = text;
    this.els.msg.className = `lec-msg${kind === 'ok' ? ' lec-ok' : kind === 'error' ? ' lec-error' : ''}`;
    clearTimeout((this.els.msg as HTMLElement & { _t?: number })._t);
    (this.els.msg as HTMLElement & { _t?: number })._t = window.setTimeout(() => { this.els.msg.textContent = ''; }, 3000);
  }

  private updateStatus(): void {
    const ed = this.editor;
    if (!ed.ready) { this.els.pos.textContent = ''; return; }
    const refs = ed.slideRefs();
    const i = ed.currentIndexInList();
    const c = ed.current;
    const label = c.sub === null ? `${c.top + 1}` : `${c.top + 1}.${c.sub + 1}`;
    this.els.pos.textContent = `Slide ${label} · ${i + 1} / ${refs.length}${ed.doc.dirty ? (this.autosave ? ' · saving…' : ' · unsaved') : ''}${this.autosave && this.workspace?.kind !== 'memory' ? ' · autosave' : ''}`;
    this.els.path.textContent = `${this.workspace?.name ?? ''} / ${this.deckPath}${ed.doc.dirty ? ' •' : ''}  ·  Lectern ${versionLabel()}`;
  }

  // ---------------------------------------------------------------- events

  private wireEditorEvents(): void {
    const ed = this.editor;
    ed.on('selection', () => { this.inspector.render(); this.toolbar.update(); });
    ed.on('slide', () => { this.navigator.updateCurrent(); this.inspector.render(); this.panels.update(); this.updateStatus(); });
    ed.on('change', ({ tops, label }) => {
      if (tops === null || label === 'Add slide' || label === 'Delete slide' || label === 'Move slide' || label === 'restore' || label === 'Duplicate slide') {
        this.navigator.render();
        this.navigator.invalidate(null);
      } else {
        this.navigator.invalidate(tops);
      }
      this.inspector.render();
      this.panels.update();
      this.toolbar.update();
      this.updateStatus();
    });
    ed.on('history', () => { this.toolbar.update(); this.updateStatus(); this.scheduleAutosave(); });
    ed.on('textmode', (on) => { this.toolbar.update(); if (!on) this.scheduleAutosave(); });
    ed.on('geometry', () => this.inspector.updateGeometry());
    ed.on('message', (m) => this.setMessage(m.text, m.kind === 'error' ? 'error' : 'info'));
    ed.onTextKey = (ev) => this.handleTextKey(ev);
    // Keyboard shortcuts also arrive from inside the iframe (when it has focus).
    ed.stage.keyHandler = (ev) => { if (!ed.textSession) this.handleKey(ev); };
    ed.stage.on('ready', () => {
      ed.stage.doc.addEventListener('paste', (ev) => { if (!ed.textSession) this.handlePaste(ev); });
      ed.stage.doc.addEventListener('selectionchange', () => { if (ed.textSession) this.toolbar.update(); });
    });
  }

  private wireGlobalEvents(): void {
    window.addEventListener('keydown', (ev) => this.handleKey(ev));
    window.addEventListener('paste', (ev) => this.handlePaste(ev));
    window.addEventListener('resize', () => { this.setZoom(this.zoom); this.navigator.fitThumbs(); });
    window.addEventListener('beforeunload', (ev) => {
      if (this.editor.ready && this.editor.doc.dirty && this.workspace?.kind !== 'memory') { ev.preventDefault(); ev.returnValue = ''; }
    });
    // File drops onto the stage
    const wrap = this.els.stageWrap;
    let dragDepth = 0;
    wrap.addEventListener('dragenter', (ev) => { if (ev.dataTransfer?.types.includes('Files')) { dragDepth++; this.els.dropzone.classList.add('lec-on'); } });
    wrap.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; this.els.dropzone.classList.remove('lec-on'); } });
    wrap.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('Files')) ev.preventDefault(); });
    wrap.addEventListener('drop', (ev) => {
      dragDepth = 0; this.els.dropzone.classList.remove('lec-on');
      const files = Array.from(ev.dataTransfer?.files ?? []);
      if (files.length) { ev.preventDefault(); void this.insertImageFiles(files); }
    });
  }

  private handlePaste(ev: ClipboardEvent): void {
    if (!this.editor.ready || this.editor.textSession) return;
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const files = Array.from(ev.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) { ev.preventDefault(); void this.insertImageFiles(files); return; }
    if (this.editor.clipboard?.kind === 'elements') { ev.preventDefault(); this.editor.paste(); return; }
    const text = ev.clipboardData?.getData('text/plain')?.trim();
    if (text && this.editor.doc.length) {
      ev.preventDefault();
      const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
      const size = this.editor.stage.slideSize;
      this.editor.insertElement(`<p style="position:absolute;left:${Math.round(size.width * 0.2)}px;top:${Math.round(size.height * 0.4)}px;width:${Math.round(size.width * 0.6)}px;margin:0;">${esc}</p>`);
    }
  }

  private handleTextKey(ev: KeyboardEvent): boolean {
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === 's') { this.editor.endTextEdit(); void this.save(); return true; }
    return false;
  }

  handleKey(ev: KeyboardEvent): void {
    const ed = this.editor;
    const target = ev.target as HTMLElement | null;
    const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key;
    const lower = key.toLowerCase();

    // Global, even in fields
    if (mod && lower === 's') { ev.preventDefault(); void this.save(); return; }
    if (mod && lower === 'o' && !ev.shiftKey) { ev.preventDefault(); void this.openFolder(); return; }
    if (inField) return;
    if (!ed.ready) return;
    if (ed.textSession) return;
    if (document.querySelector('.lec-modal-backdrop')) return;

    const navFocused = this.els.navigator.contains(target);
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };

    if (key === 'Escape') { stop(); closeMenus(); if (this.panels.visible) this.panels.hide(); else if (ed.selection().length) ed.clearSelection(); return; }
    if (mod && lower === 'z') { stop(); if (ev.shiftKey) ed.redo(); else ed.undo(); return; }
    if (mod && lower === 'y') { stop(); ed.redo(); return; }
    if (mod && ev.shiftKey && lower === 'n') { stop(); this.showNewSlideMenu({ x: window.innerWidth / 2, y: 80 }); return; }
    if (key === '?' || (ev.shiftKey && key === '/')) { stop(); this.showShortcuts(); return; }
    if (navFocused) return; // the navigator handles its own keys

    const hasSel = ed.selection().length > 0;
    if (mod && lower === 'a') { stop(); ed.selectAll(); return; }
    if (mod && lower === 'c') { stop(); if (hasSel) { ed.copy(); this.setMessage('Copied'); } return; }
    if (mod && lower === 'x') { stop(); if (hasSel) ed.cut(); return; }
    if (mod && lower === 'v') { if (ed.clipboard?.kind === 'elements') { stop(); ed.paste(); } return; }
    if (mod && lower === 'd') { stop(); if (hasSel) ed.duplicateSelection(); else ed.duplicateSlide(); return; }
    if (mod && (key === ']' || key === '[')) { stop(); const el = ed.primary; if (el) ed.reorder(el, key === ']' ? (ev.shiftKey ? 'front' : 'forward') : (ev.shiftKey ? 'back' : 'backward')); return; }
    if ((key === 'Delete' || key === 'Backspace') && !mod) { stop(); if (hasSel) ed.deleteSelection(); return; }
    if (key === 'Enter' && hasSel && !mod) { stop(); const el = ed.primary; if (el && ed.isTextEditable(el)) ed.startTextEdit(el); return; }
    if (key.startsWith('Arrow') && !mod) {
      stop();
      const d = ev.shiftKey ? 10 : 1;
      if (hasSel) {
        ed.nudge(key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0, key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0);
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') ed.prev();
      else ed.next();
      return;
    }
    if (key === 'PageUp') { stop(); ed.prev(); return; }
    if (key === 'PageDown') { stop(); ed.next(); return; }
    if (key === 'Home' && !mod) { stop(); const r = ed.slideRefs()[0]; if (r) ed.goTo(r); return; }
    if (key === 'End' && !mod) { stop(); const r = ed.slideRefs().at(-1); if (r) ed.goTo(r); return; }
    if (!mod && !ev.altKey) {
      // Type-to-edit: a printable key with one text object selected starts editing and replaces its text.
      if (hasSel && key.length === 1 && ed.typeIntoSelection(key)) { stop(); return; }
      if (!hasSel) {
        if (lower === 'n') { stop(); ed.insertElement('ainote', { edit: true }); return; }
        if (key === '+' || key === '=') { stop(); this.zoomBy(1); return; }
        if (key === '-') { stop(); this.zoomBy(-1); return; }
        if (key === '0') { stop(); this.setZoom(1); return; }
      }
    }
  }
}
