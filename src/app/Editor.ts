/**
 * Editor — the editing controller. Owns the stage, overlay, selection and
 * history, and implements every user-level operation (move, resize, insert,
 * delete, copy/paste, slide management…) as a transaction that records
 * before/after snapshots for undo.
 */

import { DeckDocument, type Snapshot } from '../deck/DeckDocument';
import { History } from '../deck/history';
import { isSelectableDisplay, isTextEditable, pathOf, resolvePath, selectionTarget } from '../deck/html';
import { ELEMENT_TEMPLATES, updateLineSvg } from '../deck/templates';
import { isDoneNote } from '../deck/aiNotes';
import { angleDeg, resizeRect, snapEdge, snapLines, snapMove, unionRect, rectsIntersect, type Guide, type HandleName } from '../stage/geometry';
import { Interactions, type DragSession, type InteractionHost } from '../stage/Interactions';
import { Overlay, type OverlayBox } from '../stage/Overlay';
import { Stage, type Rect, type SlideRef } from '../stage/Stage';
import { TextSession } from '../stage/textEditing';

export interface EditorEvents {
  /** Selection changed. */
  selection: void;
  /** Current slide changed. */
  slide: SlideRef;
  /** Content changed (after a transaction, undo or redo). `tops` lists affected top-level sections; null = all. */
  change: { tops: number[] | null; label: string };
  /** History / dirty state changed. */
  history: void;
  /** Text editing started or stopped. */
  textmode: boolean;
  /** Overlay redrawn (e.g. to sync inspector geometry). */
  geometry: void;
  /** A user-facing message. */
  message: { text: string; kind: 'info' | 'error' };
}

type Listener<T> = (payload: T) => void;

interface ClipboardItem { html: string; rect: Rect; free: boolean }
type Clipboard = { kind: 'elements'; items: ClipboardItem[]; slide: string } | { kind: 'slides'; htmls: string[] } | null;

const SNAP_PX = 6;
const COALESCE_MS = 900;

export class Editor implements InteractionHost {
  readonly stage: Stage;
  readonly overlay: Overlay;
  readonly interactions: Interactions;
  readonly history = new History();
  doc!: DeckDocument;
  private sel: Element[] = [];
  private hover: Element | null = null;
  private marquee: Rect | null = null;
  private guides: Guide[] = [];
  private label: { text: string; x: number; y: number } | null = null;
  private listeners = new Map<keyof EditorEvents, Set<Listener<never>>>();
  private txn: { label: string; before: Snapshot; top: number | null; coalesce?: string; selection: number[][] } | null = null;
  private lastCoalesce: { key: string; t: number } | null = null;
  textSession: TextSession | null = null;
  clipboard: Clipboard = null;
  private overlayRaf = 0;
  /** Whether snapping is enabled. */
  snapping = true;

  constructor(readonly stageContainer: HTMLElement) {
    this.stage = new Stage(stageContainer);
    this.overlay = new Overlay(stageContainer);
    this.interactions = new Interactions(this.overlay, this);
    this.history.onChange(() => this.emit('history', undefined));
  }

  on<K extends keyof EditorEvents>(type: K, fn: Listener<EditorEvents[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(fn as Listener<never>);
    return () => { this.listeners.get(type)?.delete(fn as Listener<never>); };
  }

  private emit<K extends keyof EditorEvents>(type: K, payload: EditorEvents[K]): void {
    this.listeners.get(type)?.forEach((fn) => (fn as Listener<EditorEvents[K]>)(payload));
  }

  // ---------------------------------------------------------------- lifecycle

  async open(source: string | { srcdoc: string }, doc: DeckDocument): Promise<void> {
    this.doc = doc;
    this.sel = [];
    this.history.clear();
    await this.stage.load(source, doc);
    this.stage.on('slidechanged', (ref) => { this.emit('slide', ref); this.refreshOverlay(); });
    this.stage.on('resize', () => this.refreshOverlay());
    this.refreshOverlay();
  }

  get ready(): boolean { return this.stage.ready; }

  // ---------------------------------------------------------------- slides

  get current(): SlideRef { return this.stage.current; }

  goTo(ref: SlideRef): void {
    this.endTextEdit();
    this.clearSelection();
    this.stage.goTo(ref);
    this.emit('slide', this.stage.current);
    this.refreshOverlay();
  }

  slideRefs(): SlideRef[] { return this.stage.slideRefs(); }

  currentIndexInList(): number {
    const refs = this.slideRefs();
    const c = this.current;
    return refs.findIndex((r) => r.top === c.top && r.sub === c.sub);
  }

  next(): void { const refs = this.slideRefs(); const i = this.currentIndexInList(); if (i < refs.length - 1) this.goTo(refs[i + 1]); }
  prev(): void { const refs = this.slideRefs(); const i = this.currentIndexInList(); if (i > 0) this.goTo(refs[i - 1]); }

  currentSrcSection(): Element { return this.stage.srcSection(this.current); }
  currentLiveSection(): Element { return this.stage.liveSection(this.current); }

  /** Where new elements go in a section: before the speaker notes if present. */
  private insertionPoint(section: Element): Element | null {
    return Array.from(section.children).find((c) => c.tagName.toLowerCase() === 'aside' && c.classList.contains('notes')) ?? null;
  }

  addSlide(html: string, after: number | null = this.current.top): number {
    const index = after === null ? this.doc.length : after + 1;
    this.endTextEdit();
    this.edit('Add slide', () => {
      this.doc.insertSlide(index, html);
      this.stage.insertLiveSection(index);
    }, { deck: true });
    this.goTo({ top: index, sub: null });
    return index;
  }

  duplicateSlide(ref: SlideRef = this.current): void {
    this.endTextEdit();
    if (ref.sub === null) {
      const html = this.doc.slides[ref.top].el.outerHTML;
      this.addSlide(html, ref.top);
    } else {
      const top = ref.top;
      const sub = ref.sub;
      this.edit('Duplicate slide', () => {
        const stack = this.doc.slides[top].el;
        const subs = Array.from(stack.children).filter((c) => c.tagName.toLowerCase() === 'section');
        const src = subs[sub];
        const clone = src.cloneNode(true) as Element;
        src.after(this.doc.doc.createTextNode('\n' + this.doc.indent + '  '), clone);
        this.stage.renderSection(top);
      }, { top });
      this.goTo({ top, sub: sub + 1 });
    }
  }

  deleteSlide(ref: SlideRef = this.current): void {
    this.endTextEdit();
    if (this.doc.length === 0) return;
    if (ref.sub === null) {
      const idx = ref.top;
      this.edit('Delete slide', () => {
        this.doc.removeSlide(idx);
        this.stage.removeLiveSection(idx);
      }, { deck: true });
      if (this.doc.length) this.goTo({ top: Math.min(idx, this.doc.length - 1), sub: null });
      else { this.clearSelection(); this.emit('slide', this.current); this.refreshOverlay(); }
    } else {
      const { top, sub } = ref;
      const stack = this.doc.slides[top].el;
      const subs = Array.from(stack.children).filter((c) => c.tagName.toLowerCase() === 'section');
      if (subs.length <= 1) return this.deleteSlide({ top, sub: null });
      this.edit('Delete slide', () => {
        const el = subs[sub];
        const prev = el.previousSibling;
        if (prev && prev.nodeType === 3 && /^\s*$/.test(prev.textContent ?? '')) prev.remove();
        el.remove();
        this.stage.renderSection(top);
      }, { top });
      this.goTo({ top, sub: Math.min(sub, subs.length - 2) });
    }
  }

  moveSlide(from: number, to: number): void {
    if (from === to || to < 0 || to >= this.doc.length) return;
    this.endTextEdit();
    this.edit('Move slide', () => {
      this.doc.moveSlide(from, to);
      this.stage.moveLiveSection(from, to);
    }, { deck: true });
    this.goTo({ top: to, sub: null });
  }

  /** Reorders a sub-slide within its stack. */
  moveSubSlide(top: number, from: number, to: number): void {
    if (from === to) return;
    this.edit('Move slide', () => {
      const stack = this.doc.slides[top].el;
      const subs = Array.from(stack.children).filter((c) => c.tagName.toLowerCase() === 'section');
      const el = subs[from];
      const prev = el.previousSibling;
      if (prev && prev.nodeType === 3 && /^\s*$/.test(prev.textContent ?? '')) prev.remove();
      el.remove();
      const rest = Array.from(stack.children).filter((c) => c.tagName.toLowerCase() === 'section');
      const ref = rest[to] ?? null;
      stack.insertBefore(this.doc.doc.createTextNode('\n' + this.doc.indent + '  '), ref);
      stack.insertBefore(el, ref);
      this.stage.renderSection(top);
    }, { top });
    this.goTo({ top, sub: to });
  }

  /** Replaces the current slide's HTML from the code view. */
  replaceSlideHtml(ref: SlideRef, html: string): void {
    this.endTextEdit();
    this.clearSelection();
    const top = ref.top;
    if (ref.sub === null) {
      this.edit('Edit source', () => {
        this.doc.replaceSlide(top, html);
        this.stage.renderSection(top);
      }, { top });
    } else {
      const sub = ref.sub;
      this.edit('Edit source', () => {
        const stack = this.doc.slides[top].el;
        const subs = Array.from(stack.children).filter((c) => c.tagName.toLowerCase() === 'section');
        const fresh = this.doc.parseSection(html);
        subs[sub].replaceWith(fresh);
        this.stage.renderSection(top);
      }, { top });
    }
    this.refreshOverlay();
  }

  setSlideAttr(ref: SlideRef, name: string, value: string | null): void {
    const section = this.stage.srcSection(ref);
    this.edit(`Slide ${name.replace(/^data-/, '')}`, () => {
      this.stage.setAttr(section, name, value);
      this.stage.syncSlide(ref);
    }, { top: ref.top, coalesce: `slideattr:${name}:${ref.top}:${ref.sub}` });
  }

  toggleSlideClass(ref: SlideRef, cls: string): void {
    const section = this.stage.srcSection(ref);
    this.edit(`Toggle .${cls}`, () => { this.stage.toggleClass(section, cls); }, { top: ref.top });
  }

  getNotes(ref: SlideRef): string {
    const aside = this.stage.srcSection(ref).querySelector(':scope > aside.notes');
    return aside ? dedent(aside.innerHTML) : '';
  }

  setNotes(ref: SlideRef, text: string): void {
    const section = this.stage.srcSection(ref);
    this.edit('Edit notes', () => {
      let aside = section.querySelector(':scope > aside.notes');
      if (!text.trim()) {
        if (aside) this.stage.remove(aside);
        return;
      }
      if (!aside) {
        aside = this.stage.insertHtml(section, null, '<aside class="notes"></aside>')[0];
      }
      const indent = this.doc.indent + '    ';
      this.stage.setInnerHTML(aside, '\n' + text.trim().split('\n').map((l) => indent + l).join('\n') + '\n' + this.doc.indent + '  ');
    }, { top: ref.top, coalesce: `notes:${ref.top}:${ref.sub}` });
  }

  // ---------------------------------------------------------------- transactions

  /** Runs `fn` as an undoable edit. */
  edit(label: string, fn: () => void, scope: { top?: number; deck?: boolean; coalesce?: string } = {}): void {
    if (this.txn) { fn(); return; } // nested: part of the outer transaction
    this.begin(label, scope);
    try { fn(); } finally { this.end(); }
  }

  begin(label: string, scope: { top?: number; deck?: boolean; coalesce?: string } = {}): void {
    if (this.txn) return;
    const top = scope.deck ? null : (scope.top ?? this.current.top);
    const before = top === null ? this.doc.snapshotDeck() : this.doc.snapshotSection(top);
    this.txn = { label, before, top, coalesce: scope.coalesce, selection: this.selectionPaths() };
  }

  end(): void {
    const t = this.txn;
    if (!t) return;
    this.txn = null;
    const after = t.top === null ? this.doc.snapshotDeck() : this.doc.snapshotSection(t.top);
    const changed = JSON.stringify(after) !== JSON.stringify(t.before);
    if (changed) {
      const now = performance.now();
      const last = this.history.peek();
      if (t.coalesce && last && this.lastCoalesce?.key === t.coalesce && now - this.lastCoalesce.t < COALESCE_MS && sameScope(last.after, after)) {
        last.after = after;
      } else {
        this.history.push({ label: t.label, before: t.before, after, selection: { slide: t.top ?? -1, paths: t.selection } });
      }
      this.lastCoalesce = t.coalesce ? { key: t.coalesce, t: now } : null;
      this.emit('change', { tops: t.top === null ? null : [t.top], label: t.label });
      this.emit('history', undefined);
    }
    this.refreshOverlay();
  }

  /** Abandons the current transaction and restores the "before" state. */
  cancel(): void {
    const t = this.txn;
    if (!t) return;
    this.txn = null;
    this.restore(t.before);
    this.refreshOverlay();
  }

  private restore(snap: Snapshot): void {
    const replaced = this.doc.restore(snap);
    if (snap.kind === 'deck') this.stage.renderAll();
    else for (const i of replaced) this.stage.renderSection(i);
    // Keep the current slide in range.
    if (this.doc.length && this.current.top >= this.doc.length) this.stage.goTo({ top: this.doc.length - 1, sub: null });
    this.emit('change', { tops: snap.kind === 'deck' ? null : [snap.index], label: 'restore' });
  }

  undo(): void {
    this.endTextEdit();
    const e = this.history.undo();
    if (!e) return;
    this.restore(e.before);
    this.restoreSelection(e.selection);
    this.emit('message', { text: `Undo ${e.label}`, kind: 'info' });
  }

  redo(): void {
    this.endTextEdit();
    const e = this.history.redo();
    if (!e) return;
    this.restore(e.after);
    this.restoreSelection(e.selection);
    this.emit('message', { text: `Redo ${e.label}`, kind: 'info' });
  }

  private selectionPaths(): number[][] {
    const section = this.doc.length ? this.currentSrcSection() : null;
    if (!section) return [];
    return this.sel.map((el) => pathOf(el, section)).filter((p): p is number[] => !!p);
  }

  private restoreSelection(selection?: { slide: number; paths: number[][] }): void {
    if (!selection || !this.doc.length) { this.clearSelection(); return; }
    if (selection.slide >= 0 && selection.slide < this.doc.length && selection.slide !== this.current.top) {
      this.stage.goTo({ top: selection.slide, sub: null });
      this.emit('slide', this.current);
    }
    const section = this.currentSrcSection();
    const els = selection.paths.map((p) => resolvePath(section, p)).filter((e): e is Element => !!e);
    this.select(els, 'replace');
  }

  // ---------------------------------------------------------------- selection

  selection(): Element[] { return this.sel; }
  get primary(): Element | null { return this.sel[0] ?? null; }

  select(els: Element[], mode: 'replace' | 'toggle' | 'add' = 'replace'): void {
    let next: Element[];
    if (mode === 'replace') next = [...els];
    else if (mode === 'add') next = [...this.sel, ...els.filter((e) => !this.sel.includes(e))];
    else next = this.sel.filter((e) => !els.includes(e)).concat(els.filter((e) => !this.sel.includes(e)));
    // Never select nested pairs (a parent and its child) — keep the outermost.
    next = next.filter((e) => !next.some((o) => o !== e && o.contains(e)));
    if (next.length === this.sel.length && next.every((e, i) => e === this.sel[i])) return;
    this.sel = next;
    this.emit('selection', undefined);
    this.refreshOverlay();
  }

  clearSelection(): void {
    if (!this.sel.length) return;
    this.sel = [];
    this.emit('selection', undefined);
    this.refreshOverlay();
  }

  selectAll(): void {
    if (!this.doc.length) return;
    const section = this.currentSrcSection();
    const els = Array.from(section.children).filter((c) => this.isSelectableSrc(c));
    this.select(els, 'replace');
  }

  /** Selects the parent object of the primary selection. */
  selectParent(): void {
    const p = this.primary;
    if (!p) return;
    const section = this.currentSrcSection();
    const parent = p.parentElement;
    if (parent && parent !== section && section.contains(parent)) this.select([parent], 'replace');
  }

  /** Ancestor chain from the section down to the element (for a breadcrumb). */
  ancestorsOf(el: Element): Element[] {
    const section = this.currentSrcSection();
    const out: Element[] = [];
    let cur = el.parentElement;
    while (cur && cur !== section) { out.unshift(cur); cur = cur.parentElement; }
    return out;
  }

  private isSelectableSrc(src: Element): boolean {
    const live = this.stage.liveOf(src);
    if (!live) return false;
    return isSelectableDisplay(live, this.stage.computed(live).display);
  }

  /** Whether the element is free-floating (absolutely positioned). */
  isFree(src: Element): boolean {
    const live = this.stage.liveOf(src);
    if (!live) return false;
    const pos = this.stage.computed(live).position;
    return pos === 'absolute' || pos === 'fixed';
  }

  // ---------------------------------------------------------------- InteractionHost

  /** Page (overlay) client coordinates → iframe client coordinates (the iframe may be CSS-scaled). */
  private frameOffset(): { x: number; y: number; k: number } {
    const r = this.stage.iframe.getBoundingClientRect();
    return { x: r.left, y: r.top, k: this.stage.frameTransform().k || 1 };
  }

  private pageToFrame(clientX: number, clientY: number): { x: number; y: number } {
    const o = this.frameOffset();
    return { x: (clientX - o.x) / o.k, y: (clientY - o.y) / o.k };
  }

  hitTest(clientX: number, clientY: number): Element | null {
    const p = this.pageToFrame(clientX, clientY);
    return this.hitTestFrame(p.x, p.y);
  }

  /** Hit test with iframe client coordinates. */
  private hitTestFrame(x: number, y: number): Element | null {
    if (!this.doc.length) return null;
    const section = this.currentLiveSection();
    const els = this.stage.elementsAt(x, y);
    for (const live of els) {
      if (!isSelectableDisplay(live, this.stage.computed(live).display)) continue;
      const target = selectionTarget(live, section);
      const src = this.stage.srcOf(target);
      if (src) return src;
    }
    return null;
  }

  elementsInRect(rect: Rect): Element[] {
    if (!this.doc.length) return [];
    const section = this.currentSrcSection();
    const out: Element[] = [];
    const visit = (el: Element) => {
      for (const c of Array.from(el.children)) {
        if (!this.isSelectableSrc(c)) continue;
        const r = this.rectOfSrc(c);
        if (rectsIntersect(rect, r)) out.push(c);
        else visit(c);
      }
    };
    visit(section);
    return out;
  }

  toSlide(clientX: number, clientY: number): { x: number; y: number } {
    const p = this.pageToFrame(clientX, clientY);
    return this.stage.toSlide(p.x, p.y);
  }
  /** Page pixels per slide unit. */
  scale(): number { return this.stage.scale * (this.stage.frameTransform().k || 1); }
  setHover(el: Element | null): void { if (el !== this.hover) { this.hover = el; this.refreshOverlay(); } }
  setMarquee(rect: Rect | null): void { this.marquee = rect; this.refreshOverlay(); }
  isTextEditable(el: Element): boolean { return isTextEditable(el); }

  /** Double-click on a done (green) note dismisses it. */
  dblClickTarget(el: Element): boolean {
    if (!isDoneNote(el)) return false;
    this.endTextEdit();
    this.edit('Dismiss note', () => this.stage.remove(el), { top: this.topOf(el) });
    this.clearSelection();
    return true;
  }

  /** Double-click on empty canvas: a note for the AI, right there. */
  dblClickEmpty(clientX: number, clientY: number): void {
    if (!this.doc.length) return;
    const p = this.toSlide(clientX, clientY);
    const size = this.stage.slideSize;
    const w = 300;
    this.insertElement('ainote', { rect: { x: Math.round(Math.max(0, Math.min(p.x - 20, size.width - w))), y: Math.round(Math.max(0, Math.min(p.y - 16, size.height - 80))), w, h: 80 }, edit: true });
  }

  rotationOf(src: Element): number {
    const t = (src as HTMLElement).style?.transform ?? '';
    const m = /rotate\((-?[\d.]+)deg\)/.exec(t);
    return m ? parseFloat(m[1]) : 0;
  }

  /** Unrotated rect of an element in slide units. */
  rectOfSrc(src: Element): Rect {
    const live = this.stage.liveOf(src);
    if (!live) return { x: 0, y: 0, w: 0, h: 0 };
    const aabb = this.stage.rectOf(live);
    const rot = this.rotationOf(src);
    if (!rot) return aabb;
    const h = live as HTMLElement;
    const w = h.offsetWidth, hh = h.offsetHeight;
    if (w && hh) return { x: aabb.x + aabb.w / 2 - w / 2, y: aabb.y + aabb.h / 2 - hh / 2, w, h: hh };
    return aabb;
  }

  // ---------------------------------------------------------------- positioning helpers

  /** Makes sure the element can be offset with left/top; returns its current offsets. */
  private ensurePositioned(src: Element): { mode: string; left: number; top: number } {
    const live = this.stage.liveOf(src) as HTMLElement | null;
    if (!live) return { mode: 'static', left: 0, top: 0 };
    const beforeRect = live.getBoundingClientRect();
    let cs = this.stage.computed(live);
    let mode = cs.position;
    if (mode === 'static' || mode === 'sticky') {
      this.stage.setStyle(src, { position: 'relative' });
      mode = 'relative';
      cs = this.stage.computed(live);
    }
    let left = parseFloat(cs.left);
    let top = parseFloat(cs.top);
    if (!isFinite(left)) left = 0;
    if (!isFinite(top)) top = 0;
    // Pin the offsets. An explicit left/top wins over any right/bottom from the stylesheet.
    this.stage.setStyle(src, { left: `${left}px`, top: `${top}px` });
    // If the element was stretched by left+right, keep its size.
    const afterRect = live.getBoundingClientRect();
    if (Math.abs(afterRect.width - beforeRect.width) > 0.5 || Math.abs(afterRect.height - beforeRect.height) > 0.5) {
      const s = this.stage.scale;
      this.setBorderBoxSize(src, beforeRect.width / s, beforeRect.height / s, { widthOnly: Math.abs(afterRect.height - beforeRect.height) <= 0.5 });
    }
    return { mode, left, top };
  }

  /** Sets the element's border-box size (in slide units). */
  private setBorderBoxSize(src: Element, w: number, h: number, opts: { widthOnly?: boolean } = {}): void {
    const live = this.stage.liveOf(src) as HTMLElement | null;
    if (!live) return;
    const cs = this.stage.computed(live);
    const contentBox = cs.boxSizing !== 'border-box';
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const cw = Math.max(1, Math.round(contentBox ? w - padX : w));
    const ch = Math.max(1, Math.round(contentBox ? h - padY : h));
    const props: Record<string, string | null> = { width: `${cw}px` };
    if (opts.widthOnly) props.height = 'auto';
    else props.height = `${ch}px`;
    this.stage.setStyle(src, props);
    // Theme max-width/max-height may clamp; lift them if so.
    const r = live.getBoundingClientRect();
    const s = this.stage.scale;
    const extra: Record<string, string> = {};
    if (Math.abs(r.width / s - w) > 1) extra['max-width'] = 'none';
    if (!opts.widthOnly && Math.abs(r.height / s - h) > 1) extra['max-height'] = 'none';
    if (Object.keys(extra).length) this.stage.setStyle(src, extra);
  }

  /** Rects of other selectable objects on the slide, for snapping. */
  private snapTargets(exclude: Element[]): Rect[] {
    const section = this.currentSrcSection();
    const out: Rect[] = [];
    const visit = (el: Element, depth: number) => {
      for (const c of Array.from(el.children)) {
        if (exclude.some((x) => x === c || x.contains(c) || c.contains(x))) { if (c.contains(exclude[0]) && depth < 3) visit(c, depth + 1); continue; }
        if (!this.isSelectableSrc(c)) continue;
        out.push(this.rectOfSrc(c));
        if (depth < 2) visit(c, depth + 1);
      }
    };
    visit(section, 0);
    return out;
  }

  private topOf(src: Element): number { return this.stage.topIndexOf(src); }

  // ---------------------------------------------------------------- move / resize / rotate sessions

  beginMove(els: Element[]): DragSession | null {
    if (!els.length) return null;
    this.endTextEdit();
    const top = this.topOf(els[0]);
    this.begin('Move', { top });
    const items = els.map((el) => ({ el, pos: this.ensurePositioned(el), start: this.rectOfSrc(el) }));
    const union = unionRect(items.map((i) => i.start));
    const lines = snapLines(this.stage.slideSize, this.snapTargets(els));
    const threshold = SNAP_PX / this.stage.scale;
    return {
      update: (dx, dy, mods) => {
        if (mods.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        let ddx = dx, ddy = dy;
        this.guides = [];
        if (this.snapping && !mods.alt) {
          const moved = { x: union.x + dx, y: union.y + dy, w: union.w, h: union.h };
          const snap = snapMove(moved, lines, threshold);
          ddx += snap.dx; ddy += snap.dy;
          this.guides = snap.guides;
        }
        for (const it of items) {
          this.stage.setStyle(it.el, { left: `${Math.round(it.pos.left + ddx)}px`, top: `${Math.round(it.pos.top + ddy)}px` });
        }
        const r = { x: union.x + ddx, y: union.y + ddy, w: union.w, h: union.h };
        this.label = { text: `${Math.round(r.x)}, ${Math.round(r.y)}`, x: r.x, y: r.y + r.h + 6 };
        this.refreshOverlay();
      },
      commit: () => { this.guides = []; this.label = null; this.end(); },
      cancel: () => { this.guides = []; this.label = null; this.cancel(); },
    };
  }

  beginResize(el: Element, handle: HandleName): DragSession | null {
    this.endTextEdit();
    const top = this.topOf(el);
    this.begin('Resize', { top });
    const start = this.rectOfSrc(el);
    const tag = el.tagName.toLowerCase();
    const isImage = tag === 'img' || tag === 'video';
    const isLine = tag === 'svg' && el.hasAttribute('data-shape');
    const needsMove = handle.includes('n') || handle.includes('w');
    const pos = needsMove ? this.ensurePositioned(el) : null;
    const lines = snapLines(this.stage.slideSize, this.snapTargets([el]));
    const threshold = SNAP_PX / this.stage.scale;
    return {
      update: (dx, dy, mods) => {
        const keepAspect = isImage ? !mods.alt : mods.shift;
        let r = resizeRect(start, handle, dx, dy, { keepAspect, minSize: isLine ? 1 : 8 });
        this.guides = [];
        if (this.snapping && !keepAspect && !mods.alt) {
          if (handle.includes('e')) { const s = snapEdge(r.x + r.w, lines.x, threshold); if (s.line) { r.w = s.value - r.x; this.guides.push({ axis: 'x', at: s.value, from: Math.min(s.line.from, r.y), to: Math.max(s.line.to, r.y + r.h), kind: s.line.kind }); } }
          if (handle.includes('w')) { const s = snapEdge(r.x, lines.x, threshold); if (s.line) { r.w += r.x - s.value; r.x = s.value; this.guides.push({ axis: 'x', at: s.value, from: Math.min(s.line.from, r.y), to: Math.max(s.line.to, r.y + r.h), kind: s.line.kind }); } }
          if (handle.includes('s')) { const s = snapEdge(r.y + r.h, lines.y, threshold); if (s.line) { r.h = s.value - r.y; this.guides.push({ axis: 'y', at: s.value, from: Math.min(s.line.from, r.x), to: Math.max(s.line.to, r.x + r.w), kind: s.line.kind }); } }
          if (handle.includes('n')) { const s = snapEdge(r.y, lines.y, threshold); if (s.line) { r.h += r.y - s.value; r.y = s.value; this.guides.push({ axis: 'y', at: s.value, from: Math.min(s.line.from, r.x), to: Math.max(s.line.to, r.x + r.w), kind: s.line.kind }); } }
        }
        this.setBorderBoxSize(el, r.w, r.h, { widthOnly: isImage && keepAspect });
        if (pos) this.stage.setStyle(el, { left: `${Math.round(pos.left + (r.x - start.x))}px`, top: `${Math.round(pos.top + (r.y - start.y))}px` });
        if (isLine) {
          updateLineSvg(el as unknown as SVGElement);
          const live = this.stage.liveOf(el);
          if (live) updateLineSvg(live as unknown as SVGElement);
        }
        const actual = this.rectOfSrc(el);
        this.label = { text: `${Math.round(actual.w)} × ${Math.round(actual.h)}`, x: actual.x, y: actual.y + actual.h + 6 };
        this.refreshOverlay();
      },
      commit: () => { this.guides = []; this.label = null; this.end(); },
      cancel: () => { this.guides = []; this.label = null; this.cancel(); },
    };
  }

  beginRotate(el: Element, originPage: { x: number; y: number }): DragSession | null {
    this.endTextEdit();
    const top = this.topOf(el);
    this.begin('Rotate', { top });
    const r = this.rectOfSrc(el);
    const c = this.stage.toClient(r.x + r.w / 2, r.y + r.h / 2);
    const originClient = this.pageToFrame(originPage.x, originPage.y);
    const startAngle = angleDeg(c.x, c.y, originClient.x, originClient.y);
    const startRot = this.rotationOf(el);
    return {
      update: (dx, dy, mods) => {
        const s = this.stage.scale;
        const px = originClient.x + dx * s, py = originClient.y + dy * s; // iframe client coords
        let rot = startRot + angleDeg(c.x, c.y, px, py) - startAngle;
        if (mods.shift) rot = Math.round(rot / 15) * 15;
        rot = Math.round(rot * 10) / 10;
        rot = ((rot % 360) + 360) % 360;
        if (rot > 180) rot -= 360;
        this.setRotation(el, rot);
        this.label = { text: `${rot}°`, x: r.x, y: r.y + r.h + 6 };
        this.refreshOverlay();
      },
      commit: () => { this.label = null; this.end(); },
      cancel: () => { this.label = null; this.cancel(); },
    };
  }

  setRotation(el: Element, deg: number): void {
    const other = ((el as HTMLElement).style.transform ?? '').replace(/rotate\([^)]*\)/, '').trim();
    const value = deg ? `${other ? other + ' ' : ''}rotate(${deg}deg)` : other || null;
    this.stage.setStyle(el, { transform: value });
  }

  // ---------------------------------------------------------------- property edits on the selection

  /** Sets inline styles on every selected element as one undoable edit. */
  setStyles(props: Record<string, string | null>, label = 'Style', coalesce?: string): void {
    if (!this.sel.length) return;
    this.edit(label, () => { for (const el of this.sel) this.stage.setStyle(el, props); }, { top: this.topOf(this.sel[0]), coalesce });
  }

  setAttr(name: string, value: string | null, label = `Set ${name}`): void {
    if (!this.sel.length) return;
    this.edit(label, () => { for (const el of this.sel) this.stage.setAttr(el, name, value); }, { top: this.topOf(this.sel[0]), coalesce: `attr:${name}` });
  }

  toggleClass(cls: string, force?: boolean): void {
    if (!this.sel.length) return;
    this.edit(`Toggle .${cls}`, () => { for (const el of this.sel) this.stage.toggleClass(el, cls, force); }, { top: this.topOf(this.sel[0]) });
  }

  /** Sets the position/size of the primary element from the inspector (slide units). */
  setGeometry(g: Partial<Rect>): void {
    const el = this.primary;
    if (!el) return;
    this.edit('Geometry', () => {
      const cur = this.rectOfSrc(el);
      if (g.x !== undefined || g.y !== undefined) {
        const pos = this.ensurePositioned(el);
        const dx = (g.x ?? cur.x) - cur.x;
        const dy = (g.y ?? cur.y) - cur.y;
        this.stage.setStyle(el, { left: `${Math.round(pos.left + dx)}px`, top: `${Math.round(pos.top + dy)}px` });
      }
      if (g.w !== undefined || g.h !== undefined) {
        const isImage = el.tagName.toLowerCase() === 'img';
        const w = g.w ?? cur.w;
        const h = g.h ?? cur.h;
        this.setBorderBoxSize(el, w, h, { widthOnly: isImage && g.h === undefined });
        if (el.tagName.toLowerCase() === 'svg' && el.hasAttribute('data-shape')) {
          updateLineSvg(el as unknown as SVGElement);
          const live = this.stage.liveOf(el);
          if (live) updateLineSvg(live as unknown as SVGElement);
        }
      }
    }, { top: this.topOf(el), coalesce: 'geometry' });
  }

  /** Nudges the selection by keyboard. */
  nudge(dx: number, dy: number): void {
    if (!this.sel.length) return;
    this.endTextEdit();
    this.edit('Move', () => {
      for (const el of this.sel) {
        const pos = this.ensurePositioned(el);
        this.stage.setStyle(el, { left: `${Math.round(pos.left + dx)}px`, top: `${Math.round(pos.top + dy)}px` });
      }
    }, { top: this.topOf(this.sel[0]), coalesce: 'nudge' });
  }

  /** Switches an element between flow layout and free (absolute) positioning. */
  setFree(el: Element, free: boolean): void {
    this.edit(free ? 'Detach from layout' : 'Return to layout', () => {
      const live = this.stage.liveOf(el) as HTMLElement | null;
      if (!live) return;
      if (free) {
        const r = this.rectOfSrc(el);
        this.stage.setStyle(el, { position: 'absolute', left: '0px', top: '0px', margin: '0' });
        // Now measure where (0,0) landed to find the containing block origin.
        const origin = this.rectOfSrc(el);
        this.stage.setStyle(el, { left: `${Math.round(r.x - origin.x)}px`, top: `${Math.round(r.y - origin.y)}px` });
        const after = this.rectOfSrc(el);
        if (Math.abs(after.w - r.w) > 1) this.setBorderBoxSize(el, r.w, r.h, { widthOnly: true });
      } else {
        this.stage.setStyle(el, { position: null, left: null, top: null, right: null, bottom: null, margin: null, transform: null });
      }
    }, { top: this.topOf(el) });
  }

  /** Z-order among siblings. */
  reorder(el: Element, how: 'front' | 'back' | 'forward' | 'backward'): void {
    const parent = el.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children).filter((c) => c.tagName.toLowerCase() !== 'aside');
    const i = siblings.indexOf(el);
    let before: Element | null = null;
    if (how === 'front') before = this.insertionPoint(parent);
    else if (how === 'back') before = siblings[0] === el ? el : siblings[0];
    else if (how === 'forward') before = siblings[i + 2] ?? this.insertionPoint(parent);
    else before = siblings[i - 1] ?? el;
    if (before === el) return;
    this.edit('Reorder', () => { this.stage.move(el, parent, before); }, { top: this.topOf(el) });
    this.select([el]);
  }

  /** Aligns the selection (or a single element to the slide). */
  align(how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
    if (!this.sel.length) return;
    const rects = this.sel.map((el) => this.rectOfSrc(el));
    const size = this.stage.slideSize;
    const target = this.sel.length > 1 ? unionRect(rects) : { x: 0, y: 0, w: size.width, h: size.height };
    this.edit('Align', () => {
      this.sel.forEach((el, i) => {
        const r = rects[i];
        const pos = this.ensurePositioned(el);
        let dx = 0, dy = 0;
        if (how === 'left') dx = target.x - r.x;
        if (how === 'center') dx = target.x + target.w / 2 - (r.x + r.w / 2);
        if (how === 'right') dx = target.x + target.w - (r.x + r.w);
        if (how === 'top') dy = target.y - r.y;
        if (how === 'middle') dy = target.y + target.h / 2 - (r.y + r.h / 2);
        if (how === 'bottom') dy = target.y + target.h - (r.y + r.h);
        this.stage.setStyle(el, { left: `${Math.round(pos.left + dx)}px`, top: `${Math.round(pos.top + dy)}px` });
      });
    }, { top: this.topOf(this.sel[0]) });
  }

  /** Distributes three or more elements evenly. */
  distribute(axis: 'h' | 'v'): void {
    if (this.sel.length < 3) return;
    const items = this.sel.map((el) => ({ el, r: this.rectOfSrc(el) })).sort((a, b) => (axis === 'h' ? a.r.x - b.r.x : a.r.y - b.r.y));
    const first = items[0].r, last = items[items.length - 1].r;
    const total = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const sizes = items.reduce((s, it) => s + (axis === 'h' ? it.r.w : it.r.h), 0);
    const gap = (total - sizes) / (items.length - 1);
    this.edit('Distribute', () => {
      let cursor = axis === 'h' ? first.x : first.y;
      for (const it of items) {
        const pos = this.ensurePositioned(it.el);
        const d = cursor - (axis === 'h' ? it.r.x : it.r.y);
        this.stage.setStyle(it.el, axis === 'h' ? { left: `${Math.round(pos.left + d)}px` } : { top: `${Math.round(pos.top + d)}px` });
        cursor += (axis === 'h' ? it.r.w : it.r.h) + gap;
      }
    }, { top: this.topOf(this.sel[0]) });
  }

  // ---------------------------------------------------------------- insert / delete / clipboard

  /** Inserts an element template (or raw HTML) into the current slide as a free object and selects it. */
  insertElement(templateIdOrHtml: string, opts: { rect?: Partial<Rect>; edit?: boolean } = {}): Element | null {
    if (!this.doc.length) return null;
    this.endTextEdit();
    const size = this.stage.slideSize;
    const tpl = ELEMENT_TEMPLATES[templateIdOrHtml];
    const defaults = defaultBox(templateIdOrHtml, size);
    const box = { ...defaults, ...opts.rect };
    const html = tpl ? tpl.html(box) : templateIdOrHtml;
    const section = this.currentSrcSection();
    let inserted: Element[] = [];
    this.edit(`Insert ${tpl?.name ?? 'element'}`, () => {
      inserted = this.stage.insertHtml(section, this.insertionPoint(section), html);
    }, { top: this.current.top });
    const el = inserted[0] ?? null;
    if (el) {
      this.select([el]);
      if (opts.edit && isTextEditable(el)) this.startTextEdit(el);
    }
    return el;
  }

  /** Inserts an image by URL (relative to the deck file), sized to fit. */
  async insertImage(src: string, absoluteUrl: string): Promise<Element | null> {
    const size = this.stage.slideSize;
    const dims = await loadImageSize(absoluteUrl).catch(() => ({ w: 400, h: 300 }));
    const maxW = size.width * 0.6, maxH = size.height * 0.6;
    const k = Math.min(1, maxW / dims.w, maxH / dims.h);
    const w = Math.round(dims.w * k), h = Math.round(dims.h * k);
    const x = Math.round((size.width - w) / 2), y = Math.round((size.height - h) / 2);
    const html = `<img src="${src.replace(/"/g, '&quot;')}" alt="" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;">`;
    return this.insertElement(html);
  }

  deleteSelection(): void {
    if (!this.sel.length) return;
    this.endTextEdit();
    const els = [...this.sel];
    this.edit(els.length > 1 ? 'Delete objects' : 'Delete', () => { for (const el of els) this.stage.remove(el); }, { top: this.topOf(els[0]) });
    this.clearSelection();
  }

  copy(): void {
    if (!this.sel.length) return;
    this.endTextEdit();
    const c = this.current;
    this.clipboard = {
      kind: 'elements',
      slide: `${c.top}/${c.sub}`,
      items: this.sel.map((el) => ({ html: el.outerHTML, rect: this.rectOfSrc(el), free: this.isFree(el) })),
    };
  }

  cut(): void { this.copy(); this.deleteSelection(); }

  paste(): void {
    const cb = this.clipboard;
    if (!cb || cb.kind !== 'elements' || !this.doc.length) return;
    this.endTextEdit();
    const section = this.currentSrcSection();
    const c = this.current;
    const sameSlide = cb.slide === `${c.top}/${c.sub}`;
    let inserted: Element[] = [];
    this.edit('Paste', () => {
      for (const item of cb.items) {
        const els = this.stage.insertHtml(section, this.insertionPoint(section), item.html);
        inserted.push(...els);
        if (sameSlide) {
          for (const el of els) {
            const pos = this.ensurePositioned(el);
            this.stage.setStyle(el, { left: `${Math.round(pos.left + 20)}px`, top: `${Math.round(pos.top + 20)}px` });
          }
        }
      }
    }, { top: c.top });
    if (sameSlide) {
      // Re-capture so repeated pastes cascade.
      cb.items = inserted.map((el) => ({ html: el.outerHTML, rect: this.rectOfSrc(el), free: this.isFree(el) }));
    }
    this.select(inserted);
  }

  duplicateSelection(): void {
    if (!this.sel.length) return;
    const saved = this.clipboard;
    this.copy();
    this.paste();
    this.clipboard = saved;
  }

  copySlide(ref: SlideRef = this.current): void {
    this.clipboard = { kind: 'slides', htmls: [this.stage.srcSection(ref).outerHTML] };
  }

  pasteSlides(after: number | null = this.current.top): void {
    const cb = this.clipboard;
    if (!cb || cb.kind !== 'slides') return;
    let idx = after;
    for (const html of cb.htmls) idx = this.addSlide(html, idx);
  }

  // ---------------------------------------------------------------- text editing

  /** Placeholder texts of freshly inserted objects: typing replaces them wholesale. */
  private static PLACEHOLDERS = new Set(['Text', 'Title', 'Note', '// code', 'First point Second point']);

  startTextEdit(el: Element, caretPage?: { clientX: number; clientY: number }, opts: { replaceAll?: boolean; append?: boolean } = {}): void {
    if (this.textSession) this.endTextEdit();
    if (!isTextEditable(el) || !this.stage.liveOf(el)) return;
    const isPlaceholder = Editor.PLACEHOLDERS.has((el.textContent ?? '').replace(/\s+/g, ' ').trim());
    const wasDone = isDoneNote(el);
    const caret = caretPage && !isPlaceholder && !opts.replaceAll ? (() => { const p = this.pageToFrame(caretPage.clientX, caretPage.clientY); return { clientX: p.x, clientY: p.y }; })() : undefined;
    const top = this.topOf(el);
    this.begin('Edit text', { top });
    let session: TextSession;
    try {
      session = new TextSession(this.stage, el, {
        onChange: () => this.refreshOverlay(),
        onEnd: (_committed, changed) => {
          this.textSession = null;
          this.overlay.setTextMode(false);
          // Remove emptied text objects (and untouched notes) rather than leaving invisible husks.
          const textLike = el.hasAttribute('data-ai-note') || /^(p|h[1-6]|pre|blockquote|li|ul|ol)$/i.test(el.tagName);
          if (textLike && el.textContent?.trim() === '' && !el.querySelector('img, svg, video, iframe, table') && el.parentElement) {
            this.stage.remove(el);
            this.sel = this.sel.filter((s) => s !== el);
          } else if (wasDone && changed && el.isConnected) {
            // A follow-up comment on a done note makes it a pending request again.
            this.stage.setAttr(el, 'data-ai-note', '');
          }
          this.end();
          this.emit('textmode', false);
          this.emit('selection', undefined);
          this.refreshOverlay();
          this.overlay.el.focus({ preventScroll: true });
        },
        onOutsidePointerDown: (x, y) => {
          const target = this.hitTestFrame(x, y);
          if (target) this.select([target]); else this.clearSelection();
        },
        onKey: (ev) => this.onTextKey?.(ev) ?? false,
      });
    } catch {
      this.cancel();
      return;
    }
    this.textSession = session;
    this.overlay.setTextMode(true);
    session.start(caret);
    if (opts.append || (!caret && wasDone && !opts.replaceAll)) session.caretToEnd();
    else if (!caret) session.selectAll();
    this.emit('textmode', true);
    this.refreshOverlay();
  }

  /** Starts editing the selected text object and types `text` in place of its content (type-to-edit). */
  typeIntoSelection(text: string): boolean {
    const el = this.primary;
    if (!el || this.sel.length !== 1 || !isTextEditable(el) || this.textSession) return false;
    // On a done note, typing appends a follow-up rather than replacing the original request.
    const append = isDoneNote(el);
    this.startTextEdit(el, undefined, append ? { append: true } : { replaceAll: true });
    const session = this.textSession as TextSession | null;
    if (!session) return false;
    session.insertText((append && (el.textContent ?? '').trim() ? ' — ' : '') + text);
    return true;
  }

  /** Hook for the app: handle shortcuts during text editing (return true if consumed). */
  onTextKey: ((ev: KeyboardEvent) => boolean) | null = null;

  endTextEdit(): void {
    this.textSession?.commit();
  }

  cancelTextEdit(): void {
    this.textSession?.cancel();
  }

  // ---------------------------------------------------------------- overlay

  refreshOverlay(): void {
    if (this.overlayRaf) return;
    this.overlayRaf = requestAnimationFrame(() => {
      this.overlayRaf = 0;
      this.drawOverlay();
    });
  }

  private drawOverlay(): void {
    if (!this.stage.ready) return;
    const size = this.stage.slideSize;
    const boxes: OverlayBox[] = [];
    const editing = this.textSession?.src ?? null;
    this.sel = this.sel.filter((el) => el.isConnected);
    this.sel.forEach((el, i) => {
      const live = this.stage.liveOf(el);
      if (!live) return;
      boxes.push({
        rect: this.rectOfSrc(el),
        rotation: this.rotationOf(el),
        primary: i === 0,
        editing: el === editing,
        resizable: true,
      });
    });
    const hover = this.hover && !this.sel.includes(this.hover) && this.hover.isConnected ? this.rectOfSrc(this.hover) : null;
    const t = this.stage.frameTransform();
    this.overlay.render(
      { boxes, hover, guides: this.guides, marquee: this.marquee, canvas: { x: 0, y: 0, w: size.width, h: size.height }, label: this.label },
      (x, y) => { const c = this.stage.toClient(x, y); return { x: t.x + c.x * t.k, y: t.y + c.y * t.k }; },
      this.stage.scale * t.k,
    );
    this.emit('geometry', undefined);
  }
}

// ---------------------------------------------------------------- helpers

function sameScope(a: Snapshot, b: Snapshot): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'section' && b.kind === 'section') return a.index === b.index && a.uid === b.uid;
  return true;
}

function defaultBox(templateId: string, size: { width: number; height: number }): Rect {
  const W = size.width, H = size.height;
  switch (templateId) {
    case 'title': return { x: Math.round(W * 0.1), y: Math.round(H * 0.12), w: Math.round(W * 0.8), h: 80 };
    case 'text': return { x: Math.round(W * 0.3), y: Math.round(H * 0.42), w: Math.round(W * 0.4), h: 60 };
    case 'bullets': return { x: Math.round(W * 0.15), y: Math.round(H * 0.3), w: Math.round(W * 0.7), h: 120 };
    case 'line': case 'arrow': return { x: Math.round(W * 0.3), y: Math.round(H * 0.5), w: Math.round(W * 0.4), h: 16 };
    case 'table': return { x: Math.round(W * 0.15), y: Math.round(H * 0.3), w: Math.round(W * 0.7), h: 150 };
    case 'code': return { x: Math.round(W * 0.15), y: Math.round(H * 0.3), w: Math.round(W * 0.7), h: 150 };
    case 'iframe': return { x: Math.round(W * 0.15), y: Math.round(H * 0.15), w: Math.round(W * 0.7), h: Math.round(H * 0.7) };
    case 'equation': return { x: Math.round(W * 0.25), y: Math.round(H * 0.42), w: Math.round(W * 0.5), h: 60 };
    case 'ainote': return { x: Math.round(W * 0.55), y: Math.round(H * 0.15), w: 300, h: 80 };
    default: return { x: Math.round(W * 0.35), y: Math.round(H * 0.35), w: Math.round(W * 0.3), h: Math.round(H * 0.3) };
  }
}

function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
    img.onerror = () => reject(new Error('Cannot load image'));
    img.src = url;
  });
}

function dedent(html: string): string {
  const lines = html.replace(/^\n+|\s+$/g, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(Math.min(min, /^[ \t]*/.exec(l)![0].length))).join('\n');
}
