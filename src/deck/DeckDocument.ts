/**
 * DeckDocument — the source of truth for a reveal.js deck being edited.
 *
 * It holds the original file text(s) plus a parsed DOM. Edits are applied to
 * the DOM (never to the text). On save, `serializeSource()` splices modified
 * top-level sections back into the original text, keeping every untouched
 * byte identical: comments between slides, indentation, entity spellings.
 *
 * A deck is either a single HTML file, or a *shell* whose `<div class="slides">`
 * is filled at runtime from part files (`data-parts="…"` or a `const parts =
 * […]` script). Each file is a `Source`; every top-level section belongs to
 * exactly one source and is written back there.
 *
 * Top-level sections are tracked as `SlideRecord`s with a stable `uid`, so
 * that reordering keeps each section's "lead" text (typically a
 * `<!-- title -->` comment) attached to it, and so that undo history survives
 * a save (`rebase`).
 */

import { inferIndent, scanDeck, scanFragment, scanRevealSize, type ScanResult } from './scan';

export interface SlideRecord {
  /** The `<section>` element inside `doc`. */
  el: Element;
  /** Stable identity across undo/redo and saves. */
  uid: string;
  /** Index into `sources`: the file this section is written to. */
  source: number;
}

export interface Source {
  /** File path relative to the workspace; the shell is sources[0]. */
  path: string;
  text: string;
  scan: ScanResult | null;
  indent: string;
  /** Whether original sections can be spliced individually (text and DOM agreed at load). */
  spliceable: boolean;
  /** True for the main HTML file (container-based); false for part fragments. */
  isShell: boolean;
}

interface Original {
  source: number;
  /** Index of the section in the source file's scan. */
  index: number;
  /** `outerHTML` of the element as parsed from the file — used to detect edits. */
  html: string;
}

/** A snapshot of one top-level section, used for undo/redo. */
export interface SectionSnapshot {
  kind: 'section';
  index: number;
  uid: string;
  source: number;
  html: string;
}

/** A snapshot of the whole slide list, used for undo/redo of deck-level edits. */
export interface DeckSnapshot {
  kind: 'deck';
  sections: { uid: string; source: number; html: string }[];
}

export type Snapshot = SectionSnapshot | DeckSnapshot;

export interface DeckInfo {
  title: string;
  width: number;
  height: number;
}

export interface PartInput { path: string; text: string }

let uidCounter = 0;
export function newUid(): string { return `s${(uidCounter++).toString(36)}`; }

export class DeckDocument {
  readonly doc: Document;
  readonly slidesRoot: Element;
  readonly slides: SlideRecord[] = [];
  readonly sources: Source[] = [];
  readonly info: DeckInfo;
  private originals = new Map<string, Original>();

  constructor(text: string, opts: { path?: string; parts?: PartInput[] } = {}) {
    this.doc = new DOMParser().parseFromString(text, 'text/html');
    const root = this.doc.querySelector('.slides');
    if (!root) throw new Error('No <div class="slides"> container found — is this a reveal.js deck?');
    this.slidesRoot = root;

    // Shell source
    const shellScan = scanDeck(text);
    const domSections = Array.from(root.children).filter((c) => c.tagName.toLowerCase() === 'section');
    const allChildrenAreSections = Array.from(root.children).every((c) => c.tagName.toLowerCase() === 'section');
    const shell: Source = {
      path: opts.path ?? 'index.html', text, scan: shellScan, isShell: true,
      indent: shellScan ? inferIndent(text, shellScan) : '  ',
      spliceable: !!shellScan && shellScan.sections.length === domSections.length && allChildrenAreSections,
    };
    this.sources.push(shell);
    domSections.forEach((el, i) => {
      const uid = newUid();
      this.slides.push({ el, uid, source: 0 });
      this.originals.set(uid, { source: 0, index: i, html: el.outerHTML });
    });

    // Part sources: parse each fragment and append its sections to the container.
    for (const part of opts.parts ?? []) {
      const scan = scanFragment(part.text);
      const src: Source = { path: part.path, text: part.text, scan, isShell: false, indent: inferIndent(part.text, scan), spliceable: true };
      const sourceIndex = this.sources.push(src) - 1;
      scan.sections.forEach((chunk, i) => {
        const el = this.parseSection(part.text.slice(chunk.body.start, chunk.body.end));
        root.appendChild(el);
        const uid = newUid();
        this.slides.push({ el, uid, source: sourceIndex });
        this.originals.set(uid, { source: sourceIndex, index: i, html: el.outerHTML });
      });
    }

    const size = scanRevealSize(text);
    this.info = {
      title: this.doc.title || 'Untitled deck',
      width: size.width ?? 960,
      height: size.height ?? 700,
    };
  }

  /** Number of top-level sections. */
  get length(): number { return this.slides.length; }

  /** Convenience for single-file decks. */
  get originalText(): string { return this.sources[0].text; }
  get indent(): string { return this.sources[0].indent; }
  get spliceable(): boolean { return this.sources[0].spliceable; }
  get isMultiFile(): boolean { return this.sources.length > 1; }

  indexOf(el: Element): number {
    return this.slides.findIndex((s) => s.el === el);
  }

  isModified(rec: SlideRecord): boolean {
    const o = this.originals.get(rec.uid);
    return !o || rec.el.outerHTML !== o.html || o.source !== rec.source;
  }

  /** Whether the given source file differs from disk. */
  isSourceDirty(sourceIndex: number): boolean {
    const mine = this.slides.filter((s) => s.source === sourceIndex);
    const originalCount = Array.from(this.originals.values()).filter((o) => o.source === sourceIndex).length;
    if (mine.length !== originalCount) return true;
    // Order must match the original order too.
    let expected = 0;
    for (const rec of mine) {
      const o = this.originals.get(rec.uid);
      if (!o || o.source !== sourceIndex || o.index !== expected++ || rec.el.outerHTML !== o.html) return true;
    }
    return false;
  }

  /** True when anything differs from the file(s) as loaded / last saved. */
  get dirty(): boolean {
    return this.sources.some((_, i) => this.isSourceDirty(i));
  }

  /** Indices of sources that need writing. */
  dirtySources(): number[] {
    return this.sources.map((_, i) => i).filter((i) => this.isSourceDirty(i));
  }

  /**
   * After a successful save: the given texts are now the files on disk.
   * Every current slide becomes "original" so that `dirty` is false and later
   * serialisations splice against the saved text. History snapshots remain
   * valid because they reference slides by uid.
   */
  rebase(saved: Map<number, string>): void {
    for (const [i, text] of saved) {
      const src = this.sources[i];
      src.text = text;
      src.scan = src.isShell ? scanDeck(text) : scanFragment(text);
      if (src.scan) src.indent = inferIndent(text, src.scan);
      src.spliceable = !!src.scan;
    }
    this.originals.clear();
    const counters = this.sources.map(() => 0);
    this.slides.forEach((s) => this.originals.set(s.uid, { source: s.source, index: counters[s.source]++, html: s.el.outerHTML }));
  }

  // ---------------------------------------------------------------- snapshots

  snapshotSection(index: number): SectionSnapshot {
    const rec = this.slides[index];
    return { kind: 'section', index, uid: rec.uid, source: rec.source, html: rec.el.outerHTML };
  }

  snapshotDeck(): DeckSnapshot {
    return { kind: 'deck', sections: this.slides.map((s) => ({ uid: s.uid, source: s.source, html: s.el.outerHTML })) };
  }

  /** Restores a snapshot. Returns the indices of top-level sections whose DOM element was replaced. */
  restore(snap: Snapshot): number[] {
    if (snap.kind === 'section') {
      const rec = this.slides[snap.index];
      if (!rec) throw new Error(`No slide at index ${snap.index}`);
      rec.source = snap.source;
      if (rec.el.outerHTML === snap.html && rec.uid === snap.uid) return [];
      const el = this.parseSection(snap.html);
      rec.el.replaceWith(el);
      rec.el = el;
      rec.uid = snap.uid;
      return [snap.index];
    }
    for (const s of this.slides) s.el.remove();
    this.slides.length = 0;
    for (const child of Array.from(this.slidesRoot.children)) {
      if (child.tagName.toLowerCase() === 'section') child.remove();
    }
    snap.sections.forEach((s) => {
      const el = this.parseSection(s.html);
      this.slidesRoot.appendChild(el);
      this.slides.push({ el, uid: s.uid, source: s.source });
    });
    return this.slides.map((_, i) => i);
  }

  // ---------------------------------------------------------------- slide list operations

  parseSection(html: string): Element {
    const tpl = this.doc.createElement('template');
    tpl.innerHTML = html.trim();
    const el = tpl.content.firstElementChild;
    if (!el || el.tagName.toLowerCase() !== 'section' || tpl.content.children.length !== 1) {
      throw new Error('Slide HTML must be a single <section> element');
    }
    return this.doc.importNode(el, true);
  }

  /** The source a slide inserted at `index` should belong to: its previous neighbour's, else the next one's. */
  private sourceForPosition(index: number): number {
    const prev = this.slides[index - 1];
    if (prev) return prev.source;
    const next = this.slides[index];
    if (next) return next.source;
    // Empty deck: the last part file if any, else the shell.
    return this.sources.length > 1 ? this.sources.length - 1 : 0;
  }

  insertSlide(index: number, html: string): SlideRecord {
    const el = this.parseSection(html);
    const ref = this.slides[index]?.el ?? null;
    this.slidesRoot.insertBefore(el, ref);
    const rec: SlideRecord = { el, uid: newUid(), source: this.sourceForPosition(index) };
    this.slides.splice(index, 0, rec);
    return rec;
  }

  removeSlide(index: number): void {
    const [rec] = this.slides.splice(index, 1);
    rec?.el.remove();
  }

  moveSlide(from: number, to: number): void {
    if (from === to) return;
    const [rec] = this.slides.splice(from, 1);
    this.slides.splice(to, 0, rec);
    const ref = this.slides[to + 1]?.el ?? null;
    this.slidesRoot.insertBefore(rec.el, ref);
    // A moved slide adopts its new neighbours' file so file order stays consistent with deck order.
    const prev = this.slides[to - 1], next = this.slides[to + 1];
    if (prev && next && prev.source !== next.source) {
      rec.source = rec.source === prev.source || rec.source === next.source ? rec.source : prev.source;
      if (rec.source < prev.source || rec.source > next.source) rec.source = prev.source;
    } else if (prev) rec.source = prev.source;
    else if (next) rec.source = next.source;
  }

  /** Replace the section element at `index` with new HTML (e.g. from the code view). Keeps the uid. */
  replaceSlide(index: number, html: string): SlideRecord {
    const rec = this.slides[index];
    const el = this.parseSection(html);
    rec.el.replaceWith(el);
    rec.el = el;
    return rec;
  }

  // ---------------------------------------------------------------- serialisation

  /** Full text of the main file with edits spliced in (single-file decks). */
  serialize(): string {
    return this.serializeSource(0);
  }

  /** Full text of one source file with its sections spliced in. */
  serializeSource(sourceIndex: number): string {
    const src = this.sources[sourceIndex];
    const text = src.text;
    const scan = src.scan;
    const mine = this.slides.filter((s) => s.source === sourceIndex);
    if (!scan) {
      return '<!DOCTYPE html>\n' + this.doc.documentElement.outerHTML;
    }
    const indent = src.indent;
    const parts: string[] = [];
    parts.push(text.slice(0, scan.contentStart));

    if (src.spliceable) {
      mine.forEach((rec, i) => {
        const o = this.originals.get(rec.uid);
        // The original chunk may live in another file (slide moved across parts): its lead
        // comment and unmodified body text still travel with it.
        const from = o ? this.sources[o.source] : null;
        const orig = o && from?.scan ? from.scan.sections[o.index] : null;
        const foreign = !!o && o.source !== sourceIndex;
        let lead: string;
        if (orig && from && !foreign) {
          lead = text.slice(orig.lead.start, orig.lead.end);
          if (i === 0 && src.isShell && !lead.includes('\n')) lead = '\n' + indent + lead;
        } else if (orig && from) {
          const raw = from.text.slice(orig.lead.start, orig.lead.end).replace(/^\s*\n/, '');
          const body = raw.trim() ? raw.replace(/^[ \t]*/, indent) : indent;
          lead = (i === 0 && !src.isShell ? '' : '\n\n') + (body.endsWith('\n') ? body + indent : body);
        } else {
          lead = i === 0 && !src.isShell ? '' : '\n\n' + indent;
        }
        parts.push(lead);
        if (orig && from && rec.el.outerHTML === o!.html) {
          parts.push(from.text.slice(orig.body.start, orig.body.end));
        } else {
          parts.push(reindent(rec.el.outerHTML, indent));
        }
      });
      parts.push(text.slice(scan.trailing.start, scan.trailing.end));
    } else {
      parts.push('\n');
      for (const rec of mine) {
        parts.push(indent + reindent(rec.el.outerHTML, indent) + '\n\n');
      }
      parts.push(indent.slice(0, Math.max(0, indent.length - 2)));
    }

    parts.push(text.slice(scan.contentEnd));
    return parts.join('');
  }
}

/**
 * Re-indents a serialised element so that its closing tag sits at `indent`
 * (inner lines shift by the same amount). Only leading whitespace is touched.
 */
export function reindent(html: string, indent: string): string {
  const lines = html.split('\n');
  if (lines.length < 2) return html;
  const last = lines[lines.length - 1];
  const lastWs = /^[ \t]*/.exec(last)![0].length;
  const delta = indent.length - lastWs;
  if (delta === 0) return html;
  return lines
    .map((l, i) => {
      if (i === 0) return l;
      if (!l.trim()) return l;
      if (delta > 0) return indent.slice(0, delta) + l;
      let k = 0;
      while (k < -delta && (l[k] === ' ' || l[k] === '\t')) k++;
      return l.slice(k);
    })
    .join('\n');
}
