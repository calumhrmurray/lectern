/** Small HTML/DOM helpers shared by the document model and the stage. */

/** Index path of `el` from `root` (list of child-element indices). */
export function pathOf(el: Element, root: Element): number[] | null {
  const path: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, cur));
    cur = parent;
  }
  return cur === root ? path : null;
}

/** Resolves an index path from `root`. */
export function resolvePath(root: Element, path: number[]): Element | null {
  let cur: Element | null = root;
  for (const i of path) {
    cur = cur?.children[i] ?? null;
    if (!cur) return null;
  }
  return cur;
}

/** Classes reveal.js adds to slide content at runtime that must never reach the file. */
const RUNTIME_CLASSES = new Set(['present', 'past', 'future', 'visible', 'current-fragment', 'stack']);
const RUNTIME_ATTRS = ['data-lid', 'contenteditable', 'spellcheck', 'aria-hidden', 'hidden', 'data-index-h', 'data-index-v', 'data-lec-editing'];

/**
 * Strips editor and reveal.js runtime artifacts from an element subtree so it
 * can be copied back into the source document.
 */
export function cleanRuntimeArtifacts(root: Element, opts: { keepFragmentIndex?: boolean } = {}): void {
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const a of RUNTIME_ATTRS) { if (a === 'hidden' && el.hasAttribute('data-ai-note')) continue; el.removeAttribute(a); }
    if (el.classList.length) {
      for (const c of Array.from(el.classList)) if (RUNTIME_CLASSES.has(c)) el.classList.remove(c);
      if (!el.classList.length) el.removeAttribute('class');
    }
    if (!opts.keepFragmentIndex && el.classList.contains('fragment') && el.hasAttribute('data-fragment-index') && el.getAttribute('data-lec-auto-index') === '1') {
      el.removeAttribute('data-fragment-index');
    }
    el.removeAttribute('data-lec-auto-index');
    // reveal sets inline display on sections; never on content, but be safe about our own marks
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  }
}

/** Elements whose content is phrasing-only: Enter inside them must not create block children. */
const PHRASING_HOSTS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'b', 'i', 'em', 'strong', 'small', 'code', 'label', 'figcaption', 'td', 'th', 'dt', 'dd', 'caption', 'summary']);

export function isPhrasingHost(el: Element): boolean {
  return PHRASING_HOSTS.has(el.tagName.toLowerCase());
}

/**
 * Chrome's contentEditable answers Enter inside a <p> with <div>…</div> children, which
 * a parser then reads as the end of the paragraph. Turns such blocks into line breaks
 * (and drops the empty trailing ones) so the element stays valid phrasing content.
 */
export function unwrapBlocksInPhrasing(el: Element): void {
  if (!isPhrasingHost(el)) return;
  const doc = el.ownerDocument;
  for (const block of Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'div')) {
    const frag = doc.createDocumentFragment();
    frag.appendChild(doc.createElement('br'));
    while (block.firstChild) frag.appendChild(block.firstChild);
    block.replaceWith(frag);
  }
  // A bare <br> inside a block is Chrome's "empty line" marker; two in a row become one.
  for (const br of Array.from(el.querySelectorAll(':scope > br'))) {
    const next = br.nextSibling;
    if (next && next.nodeType === 1 && (next as Element).tagName.toLowerCase() === 'br') br.remove();
  }
  let last = el.lastChild;
  while (last && ((last.nodeType === 1 && (last as Element).tagName.toLowerCase() === 'br') || (last.nodeType === 3 && !(last.textContent ?? '').trim()))) {
    const prev = last.previousSibling;
    last.remove();
    last = prev;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A short human label for a slide, from its first heading or text. */
export function slideLabel(section: Element, fallback: string): string {
  const h = section.querySelector('h1, h2, h3, .big') ?? section.querySelector('.kicker, p, li');
  const t = (h?.textContent ?? section.textContent ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > 48 ? t.slice(0, 47) + '…' : t) : fallback;
}

/** Whether the element is a nested (vertical) stack of slides. */
export function isStack(section: Element): boolean {
  return Array.from(section.children).some((c) => c.tagName.toLowerCase() === 'section');
}

const BLOCKISH = new Set(['block', 'flex', 'grid', 'list-item', 'table', 'inline-block', 'inline-flex', 'inline-grid', 'flow-root', 'inline-table']);
const REPLACED = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'audio', 'object', 'embed', 'table', 'math']);
const CLIMB_TO_GROUP = new Set(['li', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'dt', 'dd', 'caption', 'colgroup', 'col']);

/** Element can be selected as an object on the canvas. */
export function isSelectableDisplay(el: Element, display: string): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'aside' && el.classList.contains('notes')) return false;
  if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'br') return false;
  if (REPLACED.has(tag)) return true;
  return BLOCKISH.has(display);
}

/** Maps an element to the object a user expects to grab (a list item → its list, a cell → its table). */
export function selectionTarget(el: Element, section: Element): Element {
  const note = el.closest('[data-ai-note]');
  if (note && note !== section && section.contains(note)) return note;
  let cur: Element = el;
  while (cur !== section && CLIMB_TO_GROUP.has(cur.tagName.toLowerCase())) {
    const group = cur.parentElement?.closest('ul, ol, table, dl');
    if (!group || !section.contains(group) || group === section) break;
    cur = group;
  }
  return cur;
}

/** Whether an element's contents are editable as text. */
export function isTextEditable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return !REPLACED.has(tag) && tag !== 'hr';
}

/** Turns "12px" → 12 (or NaN). */
export function px(v: string | null | undefined): number {
  if (!v) return NaN;
  return parseFloat(v);
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Splits a style attribute into declarations, respecting quotes and parentheses. */
export function splitDeclarations(style: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote: string | null = null;
  for (const ch of style) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Patches an element's `style` attribute textually: declarations for the given
 * properties are replaced/removed, every other declaration is kept exactly as
 * the author wrote it (so `#4a7bd0` does not turn into `rgb(74, 123, 208)`).
 */
export function patchInlineStyle(el: Element, props: Record<string, string | null | undefined>): void {
  const existing = el.getAttribute('style') ?? '';
  const decls = splitDeclarations(existing);
  const lower = (p: string) => p.trim().toLowerCase();
  const wanted = new Map<string, string | null>();
  for (const [k, v] of Object.entries(props)) wanted.set(lower(k), v === undefined || v === '' ? null : v);
  const out: string[] = [];
  const seen = new Set<string>();
  // Detect the author's separator style: "a:b;c:d" vs "a: b; c: d".
  const spaced = /;\s/.test(existing.trim()) || /:\s/.test(existing);
  for (const d of decls) {
    const i = d.indexOf(':');
    if (i === -1) { if (d.trim()) out.push(d.trim()); continue; }
    const name = lower(d.slice(0, i));
    if (wanted.has(name)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const v = wanted.get(name);
      if (v !== null) out.push(spaced ? `${name}: ${v}` : `${name}:${v}`);
      continue;
    }
    out.push(d.trim());
  }
  for (const [name, v] of wanted) {
    if (seen.has(name) || v === null) continue;
    out.push(spaced ? `${name}: ${v}` : `${name}:${v}`);
  }
  if (!out.length) { el.removeAttribute('style'); return; }
  el.setAttribute('style', spaced ? out.join('; ') + ';' : out.join(';') + ';');
}
