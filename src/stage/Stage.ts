/**
 * Stage — hosts the deck in an iframe and keeps that *live* DOM mirrored
 * with the *source* DOM held by DeckDocument.
 *
 * Two kinds of deck are driven:
 *  - `reveal`: the page runs reveal.js; we reconfigure it for editing and
 *    navigate through its API. The slide canvas is reveal's `.slides` box.
 *  - `plain`: any HTML page whose slides are `<section>`s in a container
 *    (a home-grown driver). We show the current section ourselves — through
 *    the deck's own "active" class when it has one, plus inline display —
 *    and treat the iframe viewport as a fixed-size canvas so `vw`/`vh`
 *    layouts render as they would on a projector.
 *
 * Every edit is applied to the source element (truth) and to its live
 * counterpart (rendering). Live elements are located by index path from the
 * top-level section, which stays valid because both trees receive identical
 * structural edits; content that plugins rewrite in place (KaTeX, code
 * highlighting) lives *below* the elements a user selects.
 */

import { DeckDocument } from '../deck/DeckDocument';
import { cleanRuntimeArtifacts, isStack, patchInlineStyle, pathOf, resolvePath } from '../deck/html';

export interface RevealApi {
  isReady(): boolean;
  configure(options: Record<string, unknown>): void;
  getConfig(): Record<string, unknown> & { width?: number | string; height?: number | string; katex?: Record<string, unknown>; math?: Record<string, unknown>; center?: boolean };
  slide(h: number, v?: number, f?: number): void;
  sync(): void;
  syncSlide(slide?: Element): void;
  layout(): void;
  getIndices(slide?: Element): { h: number; v: number; f?: number };
  getSlidesElement(): HTMLElement;
  getRevealElement(): HTMLElement;
  getViewportElement(): HTMLElement;
  getCurrentSlide(): HTMLElement;
  getScale(): number;
  on(type: string, fn: (e: unknown) => void): void;
  off(type: string, fn: (e: unknown) => void): void;
}

export interface SlideRef {
  /** Index of the top-level section. */
  top: number;
  /** Index within a vertical stack, or null for a plain slide. */
  sub: number | null;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface StageEvents {
  ready: void;
  slidechanged: SlideRef;
  resize: void;
}

type Listener<T> = (payload: T) => void;

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', 'Escape', 'f', 'F', 'o', 'O', 's', 'S', 'b', 'B', '.']);

export class Stage {
  readonly iframe: HTMLIFrameElement;
  readonly container: HTMLElement;
  win!: Window;
  doc!: Document;
  /** Present for reveal decks only. */
  reveal?: RevealApi;
  kind: 'reveal' | 'plain' = 'reveal';
  document!: DeckDocument;
  /** Handler for keyboard events arriving inside the iframe (set by the app). */
  keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  /** Inline mode: maps a deck-relative URL to something the iframe can load (a blob URL); null = leave as is. */
  liveUrlResolver: ((rel: string) => string | null) | null = null;
  private listeners = new Map<keyof StageEvents, Set<Listener<never>>>();
  private _current: SlideRef = { top: 0, sub: null };
  private resizeObserver?: ResizeObserver;
  private liveRoot!: HTMLElement;
  /** Plain decks: how the deck marks the visible slide. */
  private activeClass: string | null = null;
  private activeDisplay = 'block';
  /** Plain decks: logical viewport size. */
  private logical = { width: 1280, height: 720 };
  private frameK = 1;
  private zoom = 1;
  ready = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.iframe = document.createElement('iframe');
    this.iframe.className = 'lec-stage-frame';
    this.iframe.setAttribute('title', 'Slide canvas');
    container.appendChild(this.iframe);
  }

  on<K extends keyof StageEvents>(type: K, fn: Listener<StageEvents[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(fn as Listener<never>);
    return () => { this.listeners.get(type)?.delete(fn as Listener<never>); };
  }

  private emit<K extends keyof StageEvents>(type: K, payload: StageEvents[K]): void {
    this.listeners.get(type)?.forEach((fn) => (fn as Listener<StageEvents[K]>)(payload));
  }

  // ---------------------------------------------------------------- loading

  /** Loads the deck (by URL, or as inline HTML) into the iframe and waits for it to be ready. */
  async load(source: string | { srcdoc: string }, document: DeckDocument, timeoutMs = 20000): Promise<void> {
    this.ready = false;
    this.document = document;
    this.reveal = undefined;
    this.kind = document.info.kind;
    this.logical = { width: document.info.width, height: document.info.height };
    this.fit(this.zoom);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The deck did not finish loading.')), timeoutMs);
      this.iframe.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
      if (typeof source === 'string') { this.iframe.removeAttribute('srcdoc'); this.iframe.src = source; }
      else { this.iframe.removeAttribute('src'); this.iframe.srcdoc = source.srcdoc; }
    });
    const win = this.iframe.contentWindow;
    if (!win) throw new Error('No iframe window');
    this.win = win;
    this.doc = win.document;

    if (this.kind === 'reveal') {
      // Wait for a ready Reveal instance (decks often initialise asynchronously).
      const start = performance.now();
      while (performance.now() - start < timeoutMs) {
        const R = (win as unknown as { Reveal?: RevealApi }).Reveal;
        if (R && typeof R.isReady === 'function' && R.isReady()) { this.reveal = R; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!this.reveal) {
        const errors = ((win as unknown as { __lecternErrors?: string[] }).__lecternErrors ?? []).slice(0, 5);
        const R = (win as unknown as { Reveal?: unknown }).Reveal;
        const detail = errors.length ? ` Details: ${errors.join('; ')}.` : R ? ' reveal.js loaded but never reported ready (Reveal.initialize may have thrown — see the browser console).' : ' The reveal.js script did not run.';
        throw new Error('No reveal.js instance found in this page. The deck must expose a global `Reveal` (the usual `Reveal.initialize({...})` does).' + detail);
      }
      this.liveRoot = this.reveal.getSlidesElement();
      this.configureReveal();
    } else {
      // Give the deck's own scripts a moment to run (they may set up the DOM on DOMContentLoaded).
      await new Promise((r) => setTimeout(r, 60));
      const root = findContainer(this.doc);
      if (!root) throw new Error('No slides found: the page needs <section> elements inside a container.');
      this.liveRoot = root as HTMLElement;
      this.learnPlainConventions();
    }
    this.liveRoot.classList.add('lec-slides');
    this.reconcile();
    this.doc.documentElement.classList.add('lec-editing');
    this.injectEditingStyles();
    this.installGuards();

    if (this.reveal) {
      this.reveal.on('slidechanged', () => {
        this.syncCurrentFromReveal();
        this.showAllFragments();
        this.emit('slidechanged', this._current);
      });
    } else {
      this.win.addEventListener('hashchange', () => this.applyVisibility());
    }
    this.resizeObserver = new ResizeObserver(() => { this.fit(this.zoom); this.reveal?.layout(); this.emit('resize', undefined); });
    this.resizeObserver.observe(this.container);
    this.ready = true;
    if (this.reveal) this.syncCurrentFromReveal(); else this.applyVisibility();
    this.showAllFragments();
    this.emit('ready', undefined);
  }

  private configureReveal(): void {
    this.reveal!.configure({
      controls: false, progress: false, keyboard: false, touch: false, hash: false, history: false,
      respondToHashChanges: false, overview: false, transition: 'none', backgroundTransition: 'none',
      autoSlide: 0, help: false, autoAnimate: false, mouseWheel: false, previewLinks: false,
      hideInactiveCursor: false, slideNumber: false, loop: false, showNotes: false, embedded: false,
      fragments: true, center: this.reveal!.getConfig().center,
    });
  }

  /** Plain decks: discover the "active" class and display mode from whichever slide is showing. */
  private learnPlainConventions(): void {
    const sections = this.liveTopSections();
    const visible = sections.find((s) => this.isShowing(s));
    if (!visible) { this.activeClass = null; this.activeDisplay = 'block'; return; }
    this.activeDisplay = this.win.getComputedStyle(visible).display || 'block';
    const hidden = sections.filter((s) => s !== visible);
    const candidates = Array.from(visible.classList).filter((c) => hidden.some((h) => !h.classList.contains(c)));
    this.activeClass = candidates.find((c) => /^(active|present|current|is-active|show|visible)$/.test(c)) ?? candidates[0] ?? null;
  }

  private isShowing(el: Element): boolean {
    const cs = this.win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** Plain decks: the deck's own "active" class, if any (used by thumbnails). */
  get plainConventions(): { activeClass: string | null; display: string } {
    return { activeClass: this.activeClass, display: this.activeDisplay };
  }

  private injectEditingStyles(): void {
    const style = this.doc.createElement('style');
    style.id = 'lec-editing-styles';
    style.textContent = `
      /* No transitions while editing: measurements right after a style change must be final. */
      .lec-editing .lec-slides section, .lec-editing .lec-slides section * { transition: none !important; }
      .lec-editing .lec-slides section .fragment { visibility: visible !important; opacity: 1 !important; transform: none !important; }
      .lec-editing [data-lec-editing] { outline: none; cursor: text; caret-color: auto; }
      .lec-editing [data-lec-editing] * { pointer-events: auto; }
      .lec-editing .lec-slides section [data-lec-editing] .katex-display { display: inline-block; }
      .lec-editing .lec-slides section img { -webkit-user-drag: none; user-select: none; }
      .lec-editing .reveal .controls, .lec-editing .reveal .progress, .lec-editing .reveal .slide-number, .lec-editing .reveal .speaker-notes { display: none !important; }
      .lec-editing .lec-slides:not(.lec-textmode) { user-select: none; }
    `;
    this.doc.head.appendChild(style);
  }

  /** Keeps the deck's own click/keyboard handlers from navigating while we edit. */
  private installGuards(): void {
    this.doc.addEventListener('keydown', (ev) => {
      this.keyHandler?.(ev);
      const editing = this.liveRoot.classList.contains('lec-textmode');
      if (this.kind === 'plain' && !editing && NAV_KEYS.has(ev.key)) ev.stopPropagation();
    }, true);
    this.doc.addEventListener('click', (ev) => {
      if ((ev.target as Element | null)?.closest?.('a')) ev.preventDefault();
      if (this.kind === 'plain') ev.stopPropagation();
    }, true);
    this.doc.addEventListener('wheel', (ev) => { if (this.kind === 'plain') ev.stopPropagation(); }, true);
  }

  /**
   * Makes sure the live top-level sections correspond 1:1 with the source
   * ones. reveal removes `data-visibility="hidden"` slides at init and some
   * decks build slides from scripts; when the shapes differ we re-render
   * everything from the source and check again.
   */
  private reconcile(): void {
    const live = this.liveTopSections();
    const src = this.document.slides;
    const same = live.length === src.length && live.every((el, i) => el.tagName === src[i].el.tagName);
    if (same) return;
    this.renderAll();
    const after = this.liveTopSections();
    if (after.length !== src.length) {
      throw new Error('This deck builds its slides with a script, so its HTML file cannot be edited directly.');
    }
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.iframe.remove();
  }

  // ---------------------------------------------------------------- frame layout

  /**
   * Sizes the iframe. reveal decks fill the container and scale themselves;
   * plain decks get a fixed logical viewport scaled with a CSS transform.
   */
  fit(zoom: number): void {
    this.zoom = zoom;
    const f = this.iframe;
    if (this.kind === 'reveal') {
      f.style.width = ''; f.style.height = ''; f.style.transform = ''; f.style.left = ''; f.style.top = '';
      this.frameK = 1;
      return;
    }
    const cw = this.container.clientWidth || 1, ch = this.container.clientHeight || 1;
    const { width, height } = this.logical;
    const margin = 0.04;
    const k = Math.min((cw * (1 - 2 * margin)) / width, (ch * (1 - 2 * margin)) / height) * zoom;
    this.frameK = k;
    f.style.width = `${width}px`; f.style.height = `${height}px`;
    f.style.transformOrigin = '0 0';
    f.style.transform = `scale(${k})`;
    f.style.left = `${Math.max(0, (cw - width * k) / 2)}px`;
    f.style.top = `${Math.max(0, (ch - height * k) / 2)}px`;
  }

  /** Offset of the iframe inside the stage container and its CSS scale. */
  frameTransform(): { x: number; y: number; k: number } {
    const fr = this.iframe.getBoundingClientRect();
    const cr = this.container.getBoundingClientRect();
    return { x: fr.left - cr.left, y: fr.top - cr.top, k: this.frameK };
  }

  /** Logical size of a plain deck's viewport (ignored for reveal decks). */
  setLogicalSize(width: number, height: number): void {
    this.logical = { width, height };
    this.fit(this.zoom);
    this.emit('resize', undefined);
  }

  get logicalSize(): { width: number; height: number } { return this.logical; }

  // ---------------------------------------------------------------- slide access

  get liveSlidesRoot(): HTMLElement { return this.liveRoot; }

  liveTopSections(): Element[] {
    return Array.from(this.liveRoot.children).filter((c) => c.tagName.toLowerCase() === 'section');
  }

  liveTopSection(top: number): Element {
    const el = this.liveTopSections()[top];
    if (!el) throw new Error(`No live section ${top}`);
    return el;
  }

  /** Live element for the slide reference (the sub-section for stacks). */
  liveSection(ref: SlideRef): Element {
    const top = this.liveTopSection(ref.top);
    if (ref.sub === null) return top;
    const subs = Array.from(top.children).filter((c) => c.tagName.toLowerCase() === 'section');
    return subs[ref.sub] ?? top;
  }

  srcSection(ref: SlideRef): Element {
    const top = this.document.slides[ref.top].el;
    if (ref.sub === null) return top;
    const subs = Array.from(top.children).filter((c) => c.tagName.toLowerCase() === 'section');
    return subs[ref.sub] ?? top;
  }

  /** All slides in presentation order, flattening vertical stacks (reveal only). */
  slideRefs(): SlideRef[] {
    const out: SlideRef[] = [];
    this.document.slides.forEach((rec, top) => {
      if (this.kind === 'reveal' && isStack(rec.el)) {
        const subs = Array.from(rec.el.children).filter((c) => c.tagName.toLowerCase() === 'section');
        subs.forEach((_, sub) => out.push({ top, sub }));
      } else {
        out.push({ top, sub: null });
      }
    });
    return out;
  }

  get current(): SlideRef { return this._current; }

  private syncCurrentFromReveal(): void {
    const idx = this.reveal!.getIndices();
    const top = this.document.slides[idx.h];
    const sub = top && isStack(top.el) ? idx.v : null;
    this._current = { top: Math.min(idx.h, Math.max(0, this.document.length - 1)), sub };
  }

  /** Navigates the live deck. */
  goTo(ref: SlideRef): void {
    if (!this.document.length) return;
    const top = Math.max(0, Math.min(ref.top, this.document.length - 1));
    if (this.reveal) {
      this.reveal.slide(top, ref.sub ?? 0);
      this.syncCurrentFromReveal();
    } else {
      this._current = { top, sub: null };
      // Let the deck's own chrome (progress bar, page number) follow along.
      try { this.win.history.replaceState(null, '', `#${top + 1}`); this.win.dispatchEvent(new Event('hashchange')); } catch { /* ignore */ }
      this.applyVisibility();
    }
    this.showAllFragments();
  }

  /** Plain decks: show exactly the current top-level section. */
  private applyVisibility(): void {
    if (this.reveal) return;
    const sections = this.liveTopSections();
    sections.forEach((s, i) => {
      const el = s as HTMLElement;
      const on = i === this._current.top;
      if (this.activeClass) el.classList.toggle(this.activeClass, on);
      el.style.setProperty('display', on ? this.activeDisplay : 'none', 'important');
      if (on) {
        el.style.setProperty('opacity', '1', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
      } else {
        el.style.removeProperty('opacity');
        el.style.removeProperty('visibility');
      }
    });
    this.showAllFragments();
  }

  /** In edit mode every fragment is shown. */
  showAllFragments(): void {
    if (!this.document.length) return;
    const section = this.liveSection(this._current);
    section.querySelectorAll('.fragment').forEach((f) => f.classList.add('visible'));
  }

  setTextMode(on: boolean): void {
    this.liveRoot.classList.toggle('lec-textmode', on);
  }

  // ---------------------------------------------------------------- src <-> live mapping

  /** Top-level index of the section containing a source element. */
  topIndexOf(src: Element): number {
    let cur: Element | null = src;
    while (cur && cur.parentElement !== this.document.slidesRoot) cur = cur.parentElement;
    return cur ? this.document.indexOf(cur) : -1;
  }

  /** Live counterpart of a source element, or null if the structures diverged. */
  liveOf(src: Element): Element | null {
    const top = this.topIndexOf(src);
    if (top === -1) return null;
    const srcTop = this.document.slides[top].el;
    const liveTop = this.liveTopSection(top);
    if (src === srcTop) return liveTop;
    const path = pathOf(src, srcTop);
    if (!path) return null;
    const live = resolvePath(liveTop, path);
    if (!live || live.tagName !== src.tagName) return null;
    return live;
  }

  /** Source counterpart of a live element. */
  srcOf(live: Element): Element | null {
    const liveTops = this.liveTopSections();
    let cur: Element | null = live;
    while (cur && cur.parentElement !== this.liveRoot) cur = cur.parentElement;
    if (!cur) return null;
    const top = liveTops.indexOf(cur);
    if (top === -1) return null;
    const srcTop = this.document.slides[top]?.el;
    if (!srcTop) return null;
    if (live === cur) return srcTop;
    const path = pathOf(live, cur);
    if (!path) return null;
    const src = resolvePath(srcTop, path);
    if (!src || src.tagName !== live.tagName) return null;
    return src;
  }

  // ---------------------------------------------------------------- rendering

  /** Rewrites deck-relative URLs on a live clone when the iframe cannot resolve them itself (inline mode). */
  private resolveLiveUrls(el: Element): void {
    const r = this.liveUrlResolver;
    if (!r) return;
    const els = [el, ...Array.from(el.querySelectorAll('[src], [data-background-image], [poster]'))];
    for (const e of els) {
      for (const attr of ['src', 'poster', 'data-background-image']) {
        const v = e.getAttribute(attr);
        if (!v || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(v)) continue;
        const url = r(v);
        if (url) e.setAttribute(attr, url);
      }
    }
  }

  /** Re-creates the live top-level section `top` from its source. */
  renderSection(top: number): Element {
    const src = this.document.slides[top].el;
    const fresh = this.doc.importNode(src, true) as Element;
    this.resolveLiveUrls(fresh);
    const old = this.liveTopSections()[top];
    if (old) old.replaceWith(fresh);
    else this.liveRoot.appendChild(fresh);
    this.afterStructureChange();
    this.typeset(fresh);
    return fresh;
  }

  /** Re-creates every live section from the source. */
  renderAll(): void {
    for (const s of this.liveTopSections()) s.remove();
    for (const rec of this.document.slides) {
      const fresh = this.doc.importNode(rec.el, true) as Element;
      this.resolveLiveUrls(fresh);
      this.liveRoot.appendChild(fresh);
    }
    this.afterStructureChange();
    this.typeset(this.liveRoot);
  }

  /** Inserts a live copy of source slide `top` (which must already exist in the source). */
  insertLiveSection(top: number): void {
    const src = this.document.slides[top].el;
    const fresh = this.doc.importNode(src, true) as Element;
    this.resolveLiveUrls(fresh);
    const ref = this.liveTopSections()[top] ?? null;
    this.liveRoot.insertBefore(fresh, ref);
    this.afterStructureChange();
    this.typeset(fresh);
  }

  removeLiveSection(top: number): void {
    this.liveTopSections()[top]?.remove();
    this.afterStructureChange();
  }

  moveLiveSection(from: number, to: number): void {
    const secs = this.liveTopSections();
    const el = secs[from];
    if (!el) return;
    el.remove();
    const rest = this.liveTopSections();
    this.liveRoot.insertBefore(el, rest[to] ?? null);
    this.afterStructureChange();
  }

  private afterStructureChange(): void {
    const cur = this._current;
    if (this.reveal) {
      try { this.reveal.sync(); } catch (err) { console.warn('Reveal.sync failed', err); }
      if (this.document.length) {
        const top = Math.min(cur.top, this.document.length - 1);
        this.reveal.slide(top, cur.sub ?? 0);
        this.syncCurrentFromReveal();
      }
    } else if (this.document.length) {
      this._current = { top: Math.min(cur.top, this.document.length - 1), sub: null };
      this.applyVisibility();
    }
    this.showAllFragments();
  }

  /** Refreshes reveal's per-slide state (backgrounds etc.) after attribute edits. */
  syncSlide(ref: SlideRef): void {
    if (!this.reveal) return;
    try { this.reveal.syncSlide(this.liveSection(ref)); } catch { /* ignore */ }
  }

  /** Typesets math inside `el` using whatever the deck loaded (KaTeX auto-render or MathJax). */
  typeset(el: Element): void {
    const w = this.win as unknown as {
      renderMathInElement?: (el: Element, opts: Record<string, unknown>) => void;
      MathJax?: { typesetPromise?: (els: Element[]) => Promise<void>; Hub?: { Queue: (args: unknown[]) => void } };
    };
    try {
      if (typeof w.renderMathInElement === 'function') {
        const cfg = this.reveal?.getConfig() ?? {};
        const user = (cfg.katex ?? {}) as Record<string, unknown>;
        const opts = {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
          throwOnError: false,
          ...user,
        };
        w.renderMathInElement(el, opts);
      } else if (w.MathJax?.typesetPromise) {
        void w.MathJax.typesetPromise([el]);
      } else if (w.MathJax?.Hub) {
        w.MathJax.Hub.Queue(['Typeset', w.MathJax.Hub, el]);
      }
    } catch (err) {
      console.warn('typeset failed', err);
    }
  }

  /** Whether the deck has a math typesetter loaded. */
  get hasMath(): boolean {
    const w = this.win as unknown as { renderMathInElement?: unknown; MathJax?: unknown };
    return typeof w.renderMathInElement === 'function' || !!w.MathJax;
  }

  // ---------------------------------------------------------------- mirrored edits

  /** Sets inline style properties on both trees. `null`/'' removes a property. */
  setStyle(src: Element, props: Record<string, string | null | undefined>): void {
    const live = this.liveOf(src);
    patchInlineStyle(src, props);
    if (live) {
      const s = (live as HTMLElement).style;
      for (const [prop, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === '') s.removeProperty(prop);
        else s.setProperty(prop, value);
      }
      if (live.getAttribute('style') === '') live.removeAttribute('style');
    }
  }

  setAttr(src: Element, name: string, value: string | null): void {
    const live = this.liveOf(src);
    if (value === null) src.removeAttribute(name); else src.setAttribute(name, value);
    if (live) {
      if (value === null) live.removeAttribute(name);
      else {
        const resolved = this.liveUrlResolver && ['src', 'poster', 'data-background-image'].includes(name) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value) ? this.liveUrlResolver(value) : null;
        live.setAttribute(name, resolved ?? value);
      }
    }
  }

  toggleClass(src: Element, cls: string, force?: boolean): boolean {
    const live = this.liveOf(src);
    const result = src.classList.toggle(cls, force);
    if (live) live.classList.toggle(cls, result);
    for (const el of [src, live]) if (el && !el.classList.length) el.removeAttribute('class');
    return result;
  }

  /** Replaces inner HTML on both trees and re-typesets the live copy. */
  setInnerHTML(src: Element, html: string): void {
    const live = this.liveOf(src);
    src.innerHTML = html;
    if (live) {
      live.innerHTML = html;
      this.resolveLiveUrls(live);
      this.typeset(live);
    } else {
      this.renderSection(this.topIndexOf(src));
    }
  }

  /** Copies the (cleaned) live inner HTML back into the source, e.g. after inline editing. */
  commitLiveInnerHTML(src: Element): void {
    const live = this.liveOf(src);
    if (!live) return;
    const clone = live.cloneNode(true) as Element;
    cleanRuntimeArtifacts(clone);
    src.innerHTML = clone.innerHTML;
  }

  /**
   * Inserts HTML (one or more elements) into `parentSrc` before `beforeSrc`
   * (or at the end). Returns the inserted source elements.
   */
  insertHtml(parentSrc: Element, beforeSrc: Element | null, html: string): Element[] {
    const tpl = this.document.doc.createElement('template');
    tpl.innerHTML = html;
    const nodes = Array.from(tpl.content.childNodes);
    const els = nodes.filter((n): n is Element => n.nodeType === 1);
    const liveParent = this.liveOf(parentSrc);
    const liveBefore = beforeSrc ? this.liveOf(beforeSrc) : null;
    const indent = this.indentFor(parentSrc);
    for (const n of nodes) {
      if (n.nodeType === 1) {
        parentSrc.insertBefore(this.document.doc.createTextNode('\n' + indent), beforeSrc);
        parentSrc.insertBefore(n, beforeSrc);
      }
    }
    if (!parentSrc.lastChild || parentSrc.lastChild.nodeType !== 3 || !/\n[ \t]*$/.test(parentSrc.lastChild.textContent ?? '')) {
      parentSrc.appendChild(this.document.doc.createTextNode('\n' + indent.slice(0, Math.max(0, indent.length - 2))));
    }
    if (liveParent) {
      for (const el of els) {
        const liveEl = this.doc.importNode(el, true) as Element;
        this.resolveLiveUrls(liveEl);
        liveParent.insertBefore(liveEl, liveBefore);
        this.typeset(liveEl);
      }
    } else {
      this.renderSection(this.topIndexOf(parentSrc));
    }
    return els;
  }

  /** Removes an element (and its leading whitespace text node) from both trees. */
  remove(src: Element): void {
    const live = this.liveOf(src);
    const prev = src.previousSibling;
    if (prev && prev.nodeType === 3 && /^\s*$/.test(prev.textContent ?? '')) prev.remove();
    src.remove();
    if (live) live.remove();
  }

  /** Moves a source element to a new position (both trees). */
  move(src: Element, newParentSrc: Element, beforeSrc: Element | null): void {
    const live = this.liveOf(src);
    const liveParent = this.liveOf(newParentSrc);
    const liveBefore = beforeSrc ? this.liveOf(beforeSrc) : null;
    const prev = src.previousSibling;
    if (prev && prev.nodeType === 3 && /^\s*$/.test(prev.textContent ?? '')) prev.remove();
    newParentSrc.insertBefore(this.document.doc.createTextNode('\n' + this.indentFor(newParentSrc)), beforeSrc);
    newParentSrc.insertBefore(src, beforeSrc);
    if (live && liveParent) liveParent.insertBefore(live, liveBefore);
    else this.renderSection(this.topIndexOf(newParentSrc));
  }

  private indentFor(parentSrc: Element): string {
    for (const n of Array.from(parentSrc.childNodes)) {
      if (n.nodeType === 3) {
        const m = /\n([ \t]+)\S/.exec(n.textContent ?? '');
        if (m) return m[1];
      }
    }
    const top = this.topIndexOf(parentSrc);
    const depth = top === -1 ? 1 : (pathOf(parentSrc, this.document.slides[top].el)?.length ?? 0) + 1;
    return this.document.indent + '  '.repeat(depth);
  }

  // ---------------------------------------------------------------- geometry (iframe client coordinates)

  /** Scale between slide units and iframe CSS pixels (reveal scales its `.slides` box). */
  get scale(): number {
    const el = this.liveRoot;
    const rect = el.getBoundingClientRect();
    const w = el.offsetWidth || 1;
    return rect.width / w || 1;
  }

  /** The slide canvas in iframe client coordinates. */
  canvasClientRect(): DOMRect {
    return this.liveRoot.getBoundingClientRect();
  }

  /** Slide size in slide units. */
  get slideSize(): { width: number; height: number } {
    const el = this.liveRoot;
    if (this.kind === 'plain') return { width: el.offsetWidth || this.logical.width, height: el.offsetHeight || this.logical.height };
    return { width: el.offsetWidth, height: el.offsetHeight };
  }

  /** Rect of a live element in slide units (relative to the canvas origin). */
  rectOf(live: Element): Rect {
    const r = live.getBoundingClientRect();
    const c = this.canvasClientRect();
    const s = this.scale;
    return { x: (r.left - c.left) / s, y: (r.top - c.top) / s, w: r.width / s, h: r.height / s };
  }

  /** Converts iframe client coordinates to slide units. */
  toSlide(clientX: number, clientY: number): { x: number; y: number } {
    const c = this.canvasClientRect();
    const s = this.scale;
    return { x: (clientX - c.left) / s, y: (clientY - c.top) / s };
  }

  /** Converts slide units to iframe client coordinates. */
  toClient(x: number, y: number): { x: number; y: number } {
    const c = this.canvasClientRect();
    const s = this.scale;
    return { x: c.left + x * s, y: c.top + y * s };
  }

  /** Elements under an iframe client point, topmost first, restricted to the current slide. */
  elementsAt(clientX: number, clientY: number): Element[] {
    const section = this.liveSection(this._current);
    return this.doc.elementsFromPoint(clientX, clientY).filter((el) => el !== section && section.contains(el));
  }

  computed(live: Element): CSSStyleDeclaration {
    return this.win.getComputedStyle(live);
  }
}

/** The slides container of a page: `.slides`, else the parent of the first `<section>`. */
export function findContainer(doc: Document): Element | null {
  const slides = doc.querySelector('.slides');
  if (slides) return slides;
  const first = doc.querySelector('section');
  return first?.parentElement ?? null;
}
