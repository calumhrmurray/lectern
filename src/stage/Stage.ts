/**
 * Stage — hosts the deck in an iframe running the real reveal.js, and keeps
 * that *live* DOM mirrored with the *source* DOM held by DeckDocument.
 *
 * Every edit is applied to the source element (truth) and to its live
 * counterpart (rendering). Live elements are located by index path from the
 * top-level section, which stays valid because both trees receive identical
 * structural edits; content that plugins rewrite in place (KaTeX, code
 * highlighting) lives *below* the elements a user selects, so it never
 * disturbs the paths.
 */

import { DeckDocument } from '../deck/DeckDocument';
import { cleanRuntimeArtifacts, isStack, patchInlineStyle, pathOf, resolvePath } from '../deck/html';

export interface RevealApi {
  isReady(): boolean;
  configure(options: Record<string, unknown>): void;
  getConfig(): Record<string, unknown> & { width?: number | string; height?: number | string; katex?: Record<string, unknown>; math?: Record<string, unknown> };
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
  removeKeyBinding?(key: number): void;
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

export class Stage {
  readonly iframe: HTMLIFrameElement;
  win!: Window;
  doc!: Document;
  reveal!: RevealApi;
  document!: DeckDocument;
  private listeners = new Map<keyof StageEvents, Set<Listener<never>>>();
  private _current: SlideRef = { top: 0, sub: null };
  private resizeObserver?: ResizeObserver;
  ready = false;

  constructor(container: HTMLElement) {
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

  /** Loads the deck URL into the iframe and waits for reveal.js to be ready. */
  async load(url: string, document: DeckDocument, timeoutMs = 20000): Promise<void> {
    this.ready = false;
    this.document = document;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The deck did not finish loading.')), timeoutMs);
      this.iframe.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
      this.iframe.src = url;
    });
    const win = this.iframe.contentWindow;
    if (!win) throw new Error('No iframe window');
    this.win = win;
    this.doc = win.document;

    // Wait for a ready Reveal instance (decks often initialise asynchronously).
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const R = (win as unknown as { Reveal?: RevealApi }).Reveal;
      if (R && typeof R.isReady === 'function' && R.isReady()) { this.reveal = R; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!this.reveal) {
      throw new Error('No reveal.js instance found in this page. The deck must expose a global `Reveal` (the usual `Reveal.initialize({...})` does).');
    }

    this.configureForEditing();
    this.reconcile();
    this.doc.documentElement.classList.add('lec-editing');
    this.injectEditingStyles();

    this.reveal.on('slidechanged', () => {
      this.syncCurrentFromReveal();
      this.showAllFragments();
      this.emit('slidechanged', this._current);
    });
    this.resizeObserver = new ResizeObserver(() => { this.reveal.layout(); this.emit('resize', undefined); });
    this.resizeObserver.observe(this.iframe);
    this.ready = true;
    this.syncCurrentFromReveal();
    this.showAllFragments();
    this.emit('ready', undefined);
  }

  private configureForEditing(): void {
    this.reveal.configure({
      controls: false, progress: false, keyboard: false, touch: false, hash: false, history: false,
      respondToHashChanges: false, overview: false, transition: 'none', backgroundTransition: 'none',
      autoSlide: 0, help: false, autoAnimate: false, mouseWheel: false, previewLinks: false,
      hideInactiveCursor: false, slideNumber: false, loop: false, showNotes: false, embedded: false,
      fragments: true, center: this.reveal.getConfig().center,
    });
  }

  private injectEditingStyles(): void {
    const style = this.doc.createElement('style');
    style.id = 'lec-editing-styles';
    style.textContent = `
      /* No transitions while editing: measurements right after a style change must be final. */
      .lec-editing .reveal .slides section, .lec-editing .reveal .slides section * { transition: none !important; }
      .lec-editing .reveal .slides section .fragment { visibility: visible !important; opacity: 1 !important; transform: none !important; }
      .lec-editing .reveal .slides section .fragment.visible { visibility: visible !important; }
      .lec-editing .reveal [data-lec-editing] { outline: none; cursor: text; caret-color: auto; }
      .lec-editing .reveal [data-lec-editing] * { pointer-events: auto; }
      .lec-editing .reveal .slides section [data-lec-editing] .katex-display { display: inline-block; }
      .lec-editing .reveal .slides section img { -webkit-user-drag: none; user-select: none; }
      .lec-editing .reveal .controls, .lec-editing .reveal .progress, .lec-editing .reveal .slide-number, .lec-editing .reveal .speaker-notes { display: none !important; }
      .lec-editing .reveal:not(.lec-textmode) .slides { user-select: none; }
      .lec-editing .reveal .slides section [data-lec-placeholder]::before { content: attr(data-lec-placeholder); color: rgba(120,120,120,.6); }
    `;
    this.doc.head.appendChild(style);
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

  // ---------------------------------------------------------------- slide access

  get liveSlidesRoot(): HTMLElement { return this.reveal.getSlidesElement(); }

  liveTopSections(): Element[] {
    return Array.from(this.liveSlidesRoot.children).filter((c) => c.tagName.toLowerCase() === 'section');
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

  /** All slides in presentation order, flattening vertical stacks. */
  slideRefs(): SlideRef[] {
    const out: SlideRef[] = [];
    this.document.slides.forEach((rec, top) => {
      if (isStack(rec.el)) {
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
    const idx = this.reveal.getIndices();
    const top = this.document.slides[idx.h];
    const sub = top && isStack(top.el) ? idx.v : null;
    this._current = { top: Math.min(idx.h, Math.max(0, this.document.length - 1)), sub };
  }

  /** Navigates the live deck. */
  goTo(ref: SlideRef): void {
    if (!this.document.length) return;
    const top = Math.max(0, Math.min(ref.top, this.document.length - 1));
    const sub = ref.sub ?? 0;
    this.reveal.slide(top, sub);
    this.syncCurrentFromReveal();
    this.showAllFragments();
  }

  /** In edit mode every fragment is shown. */
  showAllFragments(): void {
    if (!this.document.length) return;
    const section = this.liveSection(this._current);
    section.querySelectorAll('.fragment').forEach((f) => f.classList.add('visible'));
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
    while (cur && cur.parentElement !== this.liveSlidesRoot) cur = cur.parentElement;
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

  /** Re-creates the live top-level section `top` from its source. */
  renderSection(top: number): Element {
    const src = this.document.slides[top].el;
    const fresh = this.doc.importNode(src, true) as Element;
    const old = this.liveTopSections()[top];
    if (old) old.replaceWith(fresh);
    else this.liveSlidesRoot.appendChild(fresh);
    this.afterStructureChange();
    this.typeset(fresh);
    return fresh;
  }

  /** Re-creates every live section from the source. */
  renderAll(): void {
    for (const s of this.liveTopSections()) s.remove();
    for (const rec of this.document.slides) {
      this.liveSlidesRoot.appendChild(this.doc.importNode(rec.el, true));
    }
    this.afterStructureChange();
    this.typeset(this.liveSlidesRoot);
  }

  /** Inserts a live copy of source slide `top` (which must already exist in the source). */
  insertLiveSection(top: number): void {
    const src = this.document.slides[top].el;
    const fresh = this.doc.importNode(src, true) as Element;
    const ref = this.liveTopSections()[top] ?? null;
    this.liveSlidesRoot.insertBefore(fresh, ref);
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
    this.liveSlidesRoot.insertBefore(el, rest[to] ?? null);
    this.afterStructureChange();
  }

  private afterStructureChange(): void {
    if (!this.reveal) return;
    try {
      this.reveal.sync();
    } catch (err) {
      console.warn('Reveal.sync failed', err);
    }
    const cur = this._current;
    if (this.document.length) {
      const top = Math.min(cur.top, this.document.length - 1);
      this.reveal.slide(top, cur.sub ?? 0);
      this.syncCurrentFromReveal();
      this.showAllFragments();
    }
  }

  /** Typesets math inside `el` using whatever the deck loaded (KaTeX auto-render or MathJax). */
  typeset(el: Element): void {
    const w = this.win as unknown as {
      renderMathInElement?: (el: Element, opts: Record<string, unknown>) => void;
      MathJax?: { typesetPromise?: (els: Element[]) => Promise<void>; Hub?: { Queue: (args: unknown[]) => void } };
    };
    try {
      if (typeof w.renderMathInElement === 'function') {
        const cfg = this.reveal.getConfig();
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
    // Source: textual patch keeps the author's untouched declarations verbatim.
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
    for (const el of [src, live]) {
      if (!el) continue;
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
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
    // Keep the source readable: put each element on its own line.
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
        const liveEl = this.doc.importNode(el, true);
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
    // Look at the first whitespace text node child to guess the indentation.
    for (const n of Array.from(parentSrc.childNodes)) {
      if (n.nodeType === 3) {
        const m = /\n([ \t]+)\S/.exec(n.textContent ?? '');
        if (m) return m[1];
      }
    }
    // Derive from the parent's own indentation.
    const top = this.topIndexOf(parentSrc);
    const depth = top === -1 ? 1 : (pathOf(parentSrc, this.document.slides[top].el)?.length ?? 0) + 1;
    return this.document.indent + '  '.repeat(depth);
  }

  // ---------------------------------------------------------------- geometry

  /** Scale between slide units and iframe CSS pixels. */
  get scale(): number {
    const slides = this.liveSlidesRoot;
    const rect = slides.getBoundingClientRect();
    const w = slides.offsetWidth || 1;
    return rect.width / w || 1;
  }

  /** The slide canvas in iframe client coordinates. */
  canvasClientRect(): DOMRect {
    return this.liveSlidesRoot.getBoundingClientRect();
  }

  /** Slide size in slide units. */
  get slideSize(): { width: number; height: number } {
    const slides = this.liveSlidesRoot;
    return { width: slides.offsetWidth, height: slides.offsetHeight };
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
