/**
 * App — wires the editor to the UI and to a workspace; handles opening,
 * saving, keyboard shortcuts, clipboard/file drops and the welcome screen.
 */

import demoDeckHtml from '../../test/fixtures/demo/index.html?raw';
import demoThemeCss from '../../test/fixtures/demo/theme.css?raw';
import demoPlotSvg from '../../test/fixtures/demo/figures/plot.svg?raw';
import { discoverFontFamilies, discoverThemeClasses, type ThemeClass } from '../deck/cssClasses';
import { DeckDocument } from '../deck/DeckDocument';
import { detectParts } from '../deck/scan';
import { SLIDE_LAYOUTS, STARTER_THEME, starterDeckHtml } from '../deck/templates';
import type { SlideRef } from '../stage/Stage';
import { h, isMac } from '../ui/dom';
import { aboutDialog, confirmDialog, layoutPicker, modal, newDeckDialog, pickDeckFile, pickImage, promptDialog, renderWelcome, shortcutsDialog } from '../ui/Dialogs';
import { Inspector } from '../ui/Inspector';
import { closeMenus } from '../ui/Menu';
import { Navigator } from '../ui/Navigator';
import { Panels } from '../ui/Panels';
import { ThumbnailRenderer } from '../ui/Thumbnails';
import { Toolbar } from '../ui/Toolbar';
import { FsaWorkspace, fsaSupported, forgetRecent, listRecents, rememberRecent, type RecentEntry } from '../workspace/fsa';
import { HttpWorkspace } from '../workspace/http';
import { MemoryWorkspace } from '../workspace/memory';
import { serviceWorkerSupported } from '../workspace/serviceWorker';
import { basename, dirname, editorBaseUrl, joinPath, relativeTo, resolveRelative, type Workspace } from '../workspace/Workspace';
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
  private toastTimer = 0;
  private saving = false;

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
    renderWelcome(this, this.els.welcome, recents, fsaSupported() && serviceWorkerSupported());
    this.els.welcome.classList.remove('lec-hidden');
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
    if (!(await ws.serve())) { this.toast('Could not start the file service worker (needs https or localhost).', 'error'); return; }
    const deck = await pickDeckFile(ws);
    if (!deck) return;
    await this.openDeck(ws, deck);
  }

  async openRecent(r: RecentEntry): Promise<void> {
    const ws = new FsaWorkspace(r.handle, r.id);
    if (!(await ws.ensurePermission('readwrite'))) { this.toast('Permission to the folder was not granted.', 'error'); return; }
    if (!(await ws.serve())) { this.toast('Could not start the file service worker.', 'error'); return; }
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
    if (!serviceWorkerSupported()) { this.toast('The demo needs a browser with service workers (https or localhost).', 'error'); return; }
    const ws = new MemoryWorkspace('demo');
    const revealUrl = new URL('reveal/', editorBaseUrl()).href;
    ws.addText('index.html', demoDeckHtml.replace(/(href|src)="reveal\//g, `$1="${revealUrl}`).replace("katex: { local: 'katex' },", ''));
    ws.addText('theme.css', demoThemeCss);
    ws.addText('figures/plot.svg', demoPlotSvg);
    if (!(await ws.serve())) { this.toast('Could not start the service worker.', 'error'); return; }
    await this.openDeck(ws, 'index.html');
  }

  async newDeck(): Promise<void> {
    const fsa = fsaSupported() && serviceWorkerSupported();
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
      if (!(await w.serve())) { this.toast('Could not start the service worker.', 'error'); return; }
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
      // Copy reveal.js
      const manifestUrl = new URL('reveal/manifest.json', editorBaseUrl()).href;
      const manifest = (await (await fetch(manifestUrl)).json()) as { files: string[] };
      for (const f of manifest.files) {
        const data = new Uint8Array(await (await fetch(new URL(`reveal/${f}`, editorBaseUrl()).href)).arrayBuffer());
        await ws.writeBytes(joinPath(base, 'reveal', f), data);
      }
      await ws.writeText(joinPath(base, 'theme.css'), STARTER_THEME);
      await ws.writeText(joinPath(base, 'index.html'), starterDeckHtml({ title: opts.title, author: opts.author, width: opts.width, height: opts.height, revealPath: 'reveal' }));
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
      await this.editor.open(ws.urlFor(deckPath) + '?lectern=1', doc);
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
      this.toast(`Opened ${basename(deckPath)} · ${this.editor.slideRefs().length} slides`);
    } catch (err) {
      console.error(err);
      this.els.stage.classList.add('lec-empty');
      await modal({ title: 'Could not open the deck', body: h('p', {}, (err as Error).message) });
      if (!this.editor.ready) void this.showWelcome();
    } finally {
      this.setLoading(false);
    }
  }

  async reload(): Promise<void> {
    if (!this.workspace || !this.deckPath) return;
    if (!(await this.confirmDiscard())) return;
    await this.openDeck(this.workspace, this.deckPath);
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.editor.ready || !this.editor.doc.dirty) return true;
    return confirmDialog('Unsaved changes', 'Discard the unsaved changes in this deck?', 'Discard');
  }

  // ---------------------------------------------------------------- saving

  async save(): Promise<boolean> {
    if (!this.workspace || !this.editor.ready || this.saving) return false;
    this.editor.endTextEdit();
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
      this.toolbar.update();
      this.updateStatus();
      this.setMessage(dirty.length > 1 ? `Saved ${dirty.length} files` : 'Saved', 'ok');
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
    return { src: relativeTo(this.deckPath, path), url: this.workspace.urlFor(path) };
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
        await this.editor.insertImage(relativeTo(this.deckPath, path), this.workspace.urlFor(path));
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
    this.els.pos.textContent = `Slide ${label} · ${i + 1} / ${refs.length}${ed.doc.dirty ? ' · unsaved' : ''}`;
    this.els.path.textContent = `${this.workspace?.name ?? ''} / ${this.deckPath}${ed.doc.dirty ? ' •' : ''}`;
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
    ed.on('history', () => { this.toolbar.update(); this.updateStatus(); });
    ed.on('textmode', () => { this.toolbar.update(); });
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
      if (lower === 't') { stop(); ed.insertElement('text', { edit: true }); return; }
      if (lower === 'i') { stop(); void this.insertImageViaDialog(); return; }
      if (lower === 's') { stop(); ed.insertElement('rect'); return; }
      if (key === '+' || key === '=') { stop(); this.zoomBy(1); return; }
      if (key === '-') { stop(); this.zoomBy(-1); return; }
      if (key === '0') { stop(); this.setZoom(1); return; }
    }
    void isMac;
    void promptDialog;
    void SLIDE_LAYOUTS;
  }
}
