/**
 * A deck as Quarto/Pandoc markdown, and back.
 *
 * `deckToMarkdown` writes a `.qmd`: one `##` heading per slide, fenced divs for the class
 * vocabulary (`::: {.notes}`, `::: {.columns}`, `::: {.kicker}` …), lists, images and code as
 * markdown. Whatever has no markdown form — inline SVG, absolutely positioned objects, notes for
 * AI — is copied verbatim as an HTML island, so nothing is lost and the file is still valid Quarto.
 *
 * `markdownToDeck` reads such a file (or one written by hand) and produces the `<section>`s,
 * splicing them into an existing deck when there is one: a slide whose markdown is unchanged
 * keeps its original bytes.
 *
 * DOM-free: the HTML comes in as a small tree (`HNode`) built by `treeFromDom` in the browser or
 * by parse5 in the CLI (`markdownParse5.ts`), so the same code runs in both places.
 */

import { escapeHtml } from './html';

// ------------------------------------------------------------------ the tree

export interface HElement { type: 'element'; tag: string; attrs: Record<string, string>; children: HNode[]; start?: number; end?: number }
export interface HText { type: 'text'; text: string }
export interface HComment { type: 'comment'; text: string }
export type HNode = HElement | HText | HComment;
/** Parses a whole document (or fragment) into top-level nodes. */
export type HtmlParser = (html: string) => HNode[];

/** Builds the tree from a live DOM (no source offsets: islands are re-serialised). */
export function treeFromDom(root: Node): HNode[] {
  const conv = (n: Node): HNode | null => {
    if (n.nodeType === 3) return { type: 'text', text: n.textContent ?? '' };
    if (n.nodeType === 8) return { type: 'comment', text: n.textContent ?? '' };
    if (n.nodeType === 1) {
      const el = n as Element;
      const attrs: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
      return { type: 'element', tag: el.tagName.toLowerCase(), attrs, children: Array.from(el.childNodes).map(conv).filter((x): x is HNode => !!x) };
    }
    if (n.nodeType === 9 || n.nodeType === 11) return { type: 'element', tag: '#root', attrs: {}, children: Array.from(n.childNodes).map(conv).filter((x): x is HNode => !!x) };
    return null;
  };
  return Array.from(root.childNodes).map(conv).filter((x): x is HNode => !!x);
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function serializeNode(n: HNode): string {
  if (n.type === 'text') return escapeHtml(n.text);
  if (n.type === 'comment') return `<!--${n.text}-->`;
  const attrs = Object.entries(n.attrs).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)).join('');
  if (VOID.has(n.tag)) return `<${n.tag}${attrs}>`;
  return `<${n.tag}${attrs}>${n.children.map(serializeNode).join('')}</${n.tag}>`;
}

function isEl(n: HNode | undefined, tag?: string): n is HElement { return !!n && n.type === 'element' && (!tag || n.tag === tag); }
function classes(el: HElement): string[] { return (el.attrs.class ?? '').split(/\s+/).filter(Boolean); }
function hasClass(el: HElement, c: string): boolean { return classes(el).includes(c); }
function attrNames(el: HElement): string[] { return Object.keys(el.attrs); }
function onlyAttrs(el: HElement, allowed: string[]): boolean { return attrNames(el).every((a) => allowed.includes(a)); }
function textOf(n: HNode): string {
  if (n.type === 'text') return n.text;
  if (n.type === 'comment') return '';
  return n.children.map(textOf).join('');
}
function findEl(nodes: HNode[], pred: (el: HElement) => boolean): HElement | null {
  for (const n of nodes) {
    if (n.type !== 'element') continue;
    if (pred(n)) return n;
    const inner = findEl(n.children, pred);
    if (inner) return inner;
  }
  return null;
}
/** Children that matter for block structure: elements, comments and non-blank text. */
function blockChildren(el: HElement): HNode[] {
  return el.children.filter((c) => c.type !== 'text' || c.text.trim() !== '');
}

// ------------------------------------------------------------------ vocabulary

/** Classes that mark a `<p>` in the deck vocabulary: a fenced div holding one paragraph with only these becomes a `<p>` again. */
const PARA_CLASSES = new Set(['caption', 'cite', 'sub', 'meta', 'big', 'fragment', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'fade-in', 'fade-out',
  'fade-in-then-out', 'fade-in-then-semi-out', 'semi-fade-out', 'grow', 'shrink', 'strike', 'highlight-red', 'highlight-green', 'highlight-blue',
  'highlight-current-red', 'highlight-current-green', 'highlight-current-blue', 'current-visible']);
const INLINE_TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 'code', 'span', 'br', 'sub', 'sup', 'img', 'small', 'kbd', 'mark', 'abbr', 'q', 's', 'u', 'del', 'ins', 'cite', 'var', 'time', 'wbr']);
/** Attributes reveal reads from a slide, written the way Quarto spells them on a heading. */
const SLIDE_ATTR_TO_MD: Record<string, string> = {
  'data-background-color': 'background-color', 'data-background-image': 'background-image', 'data-background-size': 'background-size',
  'data-background-opacity': 'background-opacity', 'data-background-position': 'background-position', 'data-background-repeat': 'background-repeat',
  'data-background-video': 'background-video', 'data-background-iframe': 'background-iframe', 'data-transition': 'transition',
  'data-transition-speed': 'transition-speed', 'data-visibility': 'visibility', 'data-auto-animate': 'auto-animate',
};
const SLIDE_ATTR_FROM_MD: Record<string, string> = Object.fromEntries(Object.entries(SLIDE_ATTR_TO_MD).map(([k, v]) => [v, k]));

// ------------------------------------------------------------------ attributes {#id .class key="value"}

interface Attrs { id?: string; classes: string[]; kv: [string, string][] }

function attrsToMd(a: Attrs): string {
  const parts: string[] = [];
  if (a.id) parts.push('#' + a.id);
  for (const c of a.classes) parts.push('.' + c);
  for (const [k, v] of a.kv) parts.push(/^[\w.-]+$/.test(v) && v !== '' ? `${k}=${v}` : `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return parts.length ? `{${parts.join(' ')}}` : '';
}

function parseAttrs(s: string): Attrs {
  const a: Attrs = { classes: [], kv: [] };
  const re = /#([\w:-]+)|\.([\w:-]+)|([\w:-]+)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) a.id = m[1];
    else if (m[2]) a.classes.push(m[2]);
    else a.kv.push([m[3], (m[4] ?? m[5] ?? m[6] ?? '').replace(/\\(.)/g, '$1')]);
  }
  return a;
}

function attrsFromEl(el: HElement, map: Record<string, string> = {}): Attrs {
  const a: Attrs = { classes: classes(el), kv: [] };
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k === 'class') continue;
    if (k === 'id') { a.id = v; continue; }
    a.kv.push([map[k] ?? k, v]);
  }
  return a;
}

function attrsToHtml(a: Attrs, map: Record<string, string> = {}, extraClasses: string[] = []): string {
  const out: string[] = [];
  if (a.id) out.push(` id="${escapeAttr(a.id)}"`);
  const cls = [...extraClasses, ...a.classes.filter((c) => !extraClasses.includes(c))];
  if (cls.length) out.push(` class="${escapeAttr(cls.join(' '))}"`);
  for (const [k, v] of a.kv) out.push(v === '' ? ` ${k}` : ` ${map[k] ?? k}="${escapeAttr(v)}"`);
  return out.join('');
}

function escapeAttr(s: string): string { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// ------------------------------------------------------------------ writing markdown

export interface DeckMeta {
  title?: string; subtitle?: string; author?: string; date?: string; pagetitle?: string;
  lang?: string; width?: number; height?: number; css?: string[];
}

class Writer {
  constructor(private src: string) {}

  raw(n: HNode): string {
    return n.type === 'element' && n.start != null && n.end != null ? this.src.slice(n.start, n.end) : serializeNode(n);
  }

  // ---- blocks

  blocks(nodes: HNode[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.type === 'text') { if (n.text.trim()) out.push(this.inline([n]).trim()); continue; }
      if (n.type === 'comment') { out.push(`<!--${n.text}-->`); continue; }
      // a figure with its caption: ![caption](src)
      if (n.tag === 'img' && isEl(nodes[i + 1], 'p') && classes(nodes[i + 1] as HElement).join(' ') === 'caption' && onlyAttrs(nodes[i + 1] as HElement, ['class'])) {
        const img = this.image(n, this.inline((nodes[i + 1] as HElement).children).trim());
        if (img) { out.push(img); i++; continue; }
      }
      out.push(this.block(n) ?? dedentIsland(this.raw(n)));
    }
    return out;
  }

  /** Markdown for one block element, or null when it has no faithful markdown form. */
  block(el: HElement): string | null {
    const cls = classes(el);
    switch (el.tag) {
      case 'p': {
        if (attrNames(el).length === 0) return this.para(el.children);
        if (onlyAttrs(el, ['class']) && cls.length && cls.every((c) => PARA_CLASSES.has(c))) return this.fenced(attrsFromEl(el), [this.para(el.children)]);
        return null;
      }
      case 'h3': case 'h4': case 'h5': case 'h6':
        if (attrNames(el).length) return null;
        return '#'.repeat(Number(el.tag[1])) + ' ' + this.inline(el.children).trim();
      case 'ul': case 'ol': return this.list(el);
      case 'aside': {
        if (!(cls.join(' ') === 'notes' && onlyAttrs(el, ['class']))) return null;
        return this.fenced({ classes: ['notes'], kv: [] }, this.mixed(el));
      }
      case 'div': {
        if (!onlyAttrs(el, ['class', 'id']) || !cls.length) return null;
        if (cls.join(' ') === 'cols') {
          const cols = blockChildren(el);
          if (!cols.every((c) => isEl(c, 'div') && classes(c).join(' ') === 'col' && onlyAttrs(c, ['class']))) return null;
          const width = `${Math.round(1000 / cols.length) / 10}%`;
          return this.fenced({ classes: ['columns'], kv: [] }, cols.map((c) => this.fenced({ classes: ['column'], kv: [['width', width]] }, this.mixed(c as HElement))));
        }
        return this.fenced(attrsFromEl(el), this.mixed(el));
      }
      case 'pre': {
        const kids = blockChildren(el);
        if (attrNames(el).length || kids.length !== 1 || !isEl(kids[0], 'code') || !onlyAttrs(kids[0], ['class'])) return null;
        const code = kids[0];
        const lang = classes(code).find((c) => c.startsWith('language-'))?.slice(9) ?? classes(code)[0] ?? '';
        if (code.children.some((c) => c.type !== 'text')) return null;
        const text = textOf(code).replace(/\n$/, '');
        const fence = '`'.repeat(Math.max(3, (text.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length + 1), 0)));
        return `${fence}${lang}\n${text}\n${fence}`;
      }
      case 'blockquote':
        if (attrNames(el).length) return null;
        return this.mixed(el).join('\n\n').split('\n').map((l) => (l ? '> ' + l : '>')).join('\n');
      case 'img': return this.image(el, '');
      case 'table': return this.table(el);
      default: return null;
    }
  }

  /** Content that may be inline (one paragraph) or a run of blocks. */
  mixed(el: HElement): string[] {
    const kids = blockChildren(el);
    const inlineOnly = kids.every((k) => k.type === 'text' || (k.type === 'element' && INLINE_TAGS.has(k.tag)));
    if (inlineOnly) { const p = this.para(el.children); return p ? [p] : []; }
    return this.blocks(kids);
  }

  fenced(a: Attrs, inner: string[]): string {
    return `::: ${attrsToMd(a)}\n${inner.join('\n\n')}\n:::`;
  }

  list(el: HElement): string | null {
    const ordered = el.tag === 'ol';
    if (!onlyAttrs(el, ordered ? ['start'] : [])) return null;
    const items = blockChildren(el);
    if (!items.every((li) => isEl(li, 'li'))) return null;
    const lis = items as HElement[];
    const incremental = lis.length > 0 && lis.every((li) => li.attrs.class === 'fragment' && onlyAttrs(li, ['class']));
    if (!incremental && !lis.every((li) => attrNames(li).length === 0)) return null;
    const lines: string[] = [];
    let n = Number(el.attrs.start ?? 1);
    for (const li of lis) {
      const marker = ordered ? `${n++}. ` : '- ';
      const kids = li.children; // keep whitespace text: it separates inline elements
      const nestedAt = kids.findIndex((k) => isEl(k, 'ul') || isEl(k, 'ol'));
      const head = nestedAt < 0 ? kids : kids.slice(0, nestedAt);
      const tail = (nestedAt < 0 ? [] : kids.slice(nestedAt)).filter((k) => k.type !== 'text' || k.text.trim() !== '');
      if (!head.every((k) => k.type === 'text' || (k.type === 'element' && INLINE_TAGS.has(k.tag)))) return null;
      if (tail.length > 1 || (tail.length === 1 && !isEl(tail[0]))) return null;
      lines.push(marker + this.inline(head).trim());
      if (tail.length) {
        const sub = this.list(tail[0] as HElement);
        if (sub === null) return null;
        const pad = ' '.repeat(marker.length);
        for (const l of sub.split('\n')) lines.push(pad + l);
      }
    }
    const md = lines.join('\n');
    return incremental ? this.fenced({ classes: ['incremental'], kv: [] }, [md]) : md;
  }

  image(el: HElement, caption: string): string | null {
    if (!onlyAttrs(el, ['src', 'alt', 'class', 'style'])) return null;
    const style = el.attrs.style ?? '';
    const w = /^\s*width\s*:\s*([\d.]+)(px)?\s*;?\s*$/.exec(style);
    if (style && !w) return null;
    const a: Attrs = { classes: classes(el), kv: [] };
    const alt = el.attrs.alt ?? '';
    if (alt && alt !== caption) a.kv.push(['fig-alt', alt]);
    if (w) a.kv.push(['width', w[1]]);
    return `![${caption}](${el.attrs.src ?? ''})${attrsToMd(a)}`;
  }

  table(el: HElement): string | null {
    if (attrNames(el).length) return null;
    const rows: { header: boolean; cells: string[] }[] = [];
    const walk = (nodes: HNode[]): boolean => {
      for (const n of nodes) {
        if (!isEl(n)) return false;
        if (n.tag === 'thead' || n.tag === 'tbody') { if (attrNames(n).length || !walk(blockChildren(n))) return false; continue; }
        if (n.tag !== 'tr' || attrNames(n).length) return false;
        const cells = blockChildren(n);
        if (!cells.every((c) => isEl(c) && (c.tag === 'td' || c.tag === 'th') && attrNames(c).length === 0)) return false;
        const els = cells as HElement[];
        if (!els.every((c) => c.children.every((k) => k.type === 'text' || (k.type === 'element' && INLINE_TAGS.has(k.tag))))) return false;
        rows.push({ header: els.every((c) => c.tag === 'th'), cells: els.map((c) => this.inline(c.children).trim().replace(/\|/g, '\\|')) });
      }
      return true;
    };
    if (!walk(blockChildren(el)) || !rows.length) return null;
    const ncol = Math.max(...rows.map((r) => r.cells.length));
    if (!rows.every((r) => r.cells.length === ncol)) return null;
    if (!rows[0].header || rows.slice(1).some((r) => r.header)) return null;
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
    return [line(rows[0].cells), line(rows[0].cells.map(() => '---')), ...rows.slice(1).map((r) => line(r.cells))].join('\n');
  }

  // ---- inline

  para(nodes: HNode[]): string {
    return escapeLineStarts(this.inline(nodes).trim());
  }

  inline(nodes: HNode[]): string {
    let out = '';
    for (const n of nodes) {
      if (n.type === 'text') { out += escapeText(n.text.replace(/\s+/g, ' ')); continue; }
      if (n.type === 'comment') { out += `<!--${n.text}-->`; continue; }
      const inner = () => this.inline(n.children);
      const bare = attrNames(n).length === 0;
      switch (n.tag) {
        case 'strong': case 'b': if (bare) { out += `**${inner()}**`; continue; } break;
        case 'em': case 'i': if (bare) { out += `*${inner()}*`; continue; } break;
        case 'sub': if (bare && !/\s/.test(textOf(n))) { out += `~${inner()}~`; continue; } break;
        case 'sup': if (bare && !/\s/.test(textOf(n))) { out += `^${inner()}^`; continue; } break;
        case 'code': if (bare && n.children.every((c) => c.type === 'text')) { const t = textOf(n); const f = '`'.repeat(Math.max(1, (t.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length + 1), 0))); out += `${f}${t}${f}`; continue; } break;
        case 'br': if (bare) { out += '\\\n'; continue; } break;
        case 'a': if (onlyAttrs(n, ['href']) && n.attrs.href) { out += `[${inner()}](${n.attrs.href})`; continue; } break;
        case 'span': if (onlyAttrs(n, ['class']) && classes(n).length) { out += `[${inner()}]${attrsToMd(attrsFromEl(n))}`; continue; } break;
        case 'img': { const md = this.image(n, ''); if (md) { out += md.replace(/^!\[\]/, `![${escapeText(n.attrs.alt ?? '')}]`).replace(/\{fig-alt="[^"]*"\s?/, '{').replace(/\{\}$/, ''); continue; } break; }
      }
      out += this.raw(n);
    }
    return out;
  }
}

/** Escapes text so Pandoc reads it literally, leaving TeX maths (`$…$`, `\(…\)`, `\[…\]`) intact and written with dollars. */
function escapeText(s: string): string {
  const re = /\$\$[\s\S]+?\$\$|\$(?!\s)(?:[^$\\]|\\.)+?(?<!\s)\$(?!\d)|\\\((?:[^\\]|\\[^)])*?\\\)|\\\[(?:[^\\]|\\[^\]])*?\\\]/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out += escapePlain(s.slice(last, m.index));
    const t = m[0];
    out += t.startsWith('\\(') ? `$${t.slice(2, -2).trim()}$` : t.startsWith('\\[') ? `$$${t.slice(2, -2).trim()}$$` : t;
    last = m.index + t.length;
  }
  return out + escapePlain(s.slice(last));
}

function escapePlain(s: string): string {
  return s
    .replace(/[\\`*_$^~]/g, '\\$&')
    .replace(/\[(?=[^\]]*\]\s*[([{])/g, '\\[')
    .replace(/<(?=[a-zA-Z/!])/g, '\\<')
    .replace(/&(?=[#\w]+;)/g, '\\&');
}

/** A paragraph must not begin with something that reads as a heading, list, rule, quote or fence. */
function escapeLineStarts(s: string): string {
  return s.split('\n').map((l) => l.replace(/^(\s*)(#{1,6}\s|[-+*]\s|\d+[.)]\s|>|:::|\||---|===|\. \. \.)/, '$1\\$2')).join('\n');
}

// ---- the deck

function isSlide(n: HNode): n is HElement { return isEl(n, 'section'); }
function isStackEl(el: HElement): boolean { return blockChildren(el).some((c) => isEl(c, 'section')); }

/** The title slide as front matter, when it holds nothing but a title, subtitle and author line. */
export function titleSlideMeta(section: HElement): Pick<DeckMeta, 'title' | 'subtitle' | 'author' | 'date'> | null {
  if (!hasClass(section, 'title-slide') || !onlyAttrs(section, ['class']) || classes(section).length !== 1) return null;
  const w = new Writer('');
  const meta: Pick<DeckMeta, 'title' | 'subtitle' | 'author' | 'date'> = {};
  for (const k of blockChildren(section)) {
    if (!isEl(k)) return null;
    const cls = classes(k).join(' ');
    if (k.tag === 'h1' && attrNames(k).length === 0 && meta.title === undefined) meta.title = w.inline(k.children).trim();
    else if (k.tag === 'p' && cls === 'sub' && onlyAttrs(k, ['class']) && meta.subtitle === undefined) meta.subtitle = w.inline(k.children).trim();
    else if (k.tag === 'p' && cls === 'meta' && onlyAttrs(k, ['class']) && meta.author === undefined) {
      const brAt = k.children.findIndex((c) => isEl(c, 'br'));
      meta.author = w.inline(brAt < 0 ? k.children : k.children.slice(0, brAt)).trim();
      if (brAt >= 0) meta.date = w.inline(k.children.slice(brAt + 1)).trim();
    } else return null;
  }
  return meta.title === undefined ? null : meta;
}

/** The markdown of one `<section>` (heading line, body), without the comment before it. */
export function sectionToMarkdown(section: HElement, src: string): string {
  return new SlideWriter(src).section(section).join('\n');
}

class SlideWriter extends Writer {
  section(el: HElement): string[] {
    if (isStackEl(el)) {
      const inner: string[] = [];
      for (const k of blockChildren(el)) {
        if (isSlide(k)) inner.push(this.section(k).join('\n'));
        else if (k.type === 'comment') inner.push(`<!--${k.text}-->`);
        else inner.push(this.raw(k));
      }
      return [`::: ${attrsToMd({ ...attrsFromEl(el, SLIDE_ATTR_TO_MD), classes: ['stack', ...classes(el)] })}`, '', inner.join('\n\n'), '', ':::'];
    }
    const kids = blockChildren(el);
    const isBreak = hasClass(el, 'break');
    const headAt = kids.findIndex((k) => isEl(k) && attrNames(k).length === (k.tag === 'p' ? 1 : 0) && (k.tag === 'h1' || k.tag === 'h2' || (isBreak && k.tag === 'p' && k.attrs.class === 'big')));
    const attrs = attrsToMd(attrsFromEl(el, SLIDE_ATTR_TO_MD));
    const lines: string[] = [];
    if (headAt < 0) {
      lines.push(attrs ? `## ${attrs}` : '---');
      lines.push('', ...join(this.blocks(kids)));
      return lines;
    }
    const head = kids[headAt] as HElement;
    const level = head.tag === 'h2' ? '##' : '#';
    lines.push(`${level} ${this.inline(head.children).trim()}${attrs ? ' ' + attrs : ''}`);
    const before = kids.slice(0, headAt);
    const kickerAt = before.findIndex((k) => isEl(k, 'div') && k.attrs.class === 'kicker' && onlyAttrs(k, ['class']));
    const body: string[] = [];
    if (kickerAt >= 0) body.push(this.fenced({ classes: ['kicker'], kv: [] }, [this.para((before[kickerAt] as HElement).children)]));
    const backdrop = before.filter((_, i) => i !== kickerAt);
    if (backdrop.length) body.push(this.fenced({ classes: ['backdrop'], kv: [] }, this.blocks(backdrop)));
    body.push(...this.blocks(kids.slice(headAt + 1)));
    lines.push('', ...join(body));
    return lines;
  }
}

function join(blocks: string[]): string[] {
  const out: string[] = [];
  blocks.forEach((b, i) => { if (i) out.push(''); out.push(...b.split('\n')); });
  return out;
}

/** Shifts a raw HTML island left so its inner lines keep their shape but start near column 0. */
function dedentIsland(s: string): string {
  const lines = s.split('\n');
  if (lines.length < 2) return s;
  let min = Infinity;
  for (const l of lines.slice(1)) if (l.trim()) min = Math.min(min, l.length - l.trimStart().length);
  if (!isFinite(min) || min === 0) return s;
  return [lines[0], ...lines.slice(1).map((l) => (l.trim() ? l.slice(min) : ''))].join('\n');
}

/** Reads what the `<head>` and `Reveal.initialize` say about the deck. */
export function deckMeta(nodes: HNode[], html: string): DeckMeta {
  const meta: DeckMeta = {};
  const htmlEl = findEl(nodes, (e) => e.tag === 'html');
  if (htmlEl?.attrs.lang) meta.lang = htmlEl.attrs.lang;
  const title = findEl(nodes, (e) => e.tag === 'title');
  if (title) meta.pagetitle = textOf(title).trim();
  const size = /width:\s*(\d+)\s*,\s*height:\s*(\d+)/.exec(html);
  if (size) { meta.width = Number(size[1]); meta.height = Number(size[2]); }
  const css: string[] = [];
  const walk = (ns: HNode[]) => { for (const n of ns) if (isEl(n)) { if (n.tag === 'link' && n.attrs.rel === 'stylesheet' && n.attrs.href && !/(^|\/)(reset|reveal)\.css$|\/katex\//.test(n.attrs.href)) css.push(n.attrs.href); walk(n.children); } };
  walk(nodes);
  if (css.length) meta.css = css;
  return meta;
}

export function findSlidesDiv(nodes: HNode[]): HElement | null {
  return findEl(nodes, (e) => e.tag === 'div' && hasClass(e, 'slides'));
}

/** The whole deck as a `.qmd`. */
export function deckToMarkdown(html: string, parse: HtmlParser): string {
  const nodes = parse(html);
  const slides = findSlidesDiv(nodes);
  if (!slides) throw new Error('no <div class="slides"> in the deck');
  const meta = deckMeta(nodes, html);
  const w = new SlideWriter(html);
  const out: string[] = [];
  const kids = blockChildren(slides);
  const firstSlide = kids.find(isSlide);
  const tm = firstSlide ? titleSlideMeta(firstSlide) : null;
  if (tm) Object.assign(meta, tm);
  if (tm && meta.pagetitle && meta.pagetitle === plainText(tm.title ?? '')) delete meta.pagetitle;
  out.push(frontMatter(meta), '');
  for (const k of kids) {
    if (k === firstSlide && tm) continue;
    if (k.type === 'comment') { out.push(`<!--${k.text}-->`); continue; }
    if (isSlide(k)) { out.push(...w.section(k), ''); continue; }
    out.push(w.raw(k), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

function plainText(md: string): string {
  return md.replace(/\\(.)/g, '$1').replace(/\*\*|\*|`/g, '').replace(/\[([^\]]*)\]\{[^}]*\}/g, '$1');
}

function frontMatter(meta: DeckMeta): string {
  const q = (s: string) => JSON.stringify(s);
  const lines = ['---'];
  if (meta.title !== undefined) lines.push(`title: ${q(meta.title)}`);
  if (meta.subtitle) lines.push(`subtitle: ${q(meta.subtitle)}`);
  if (meta.author) lines.push(`author: ${q(meta.author)}`);
  if (meta.date) lines.push(`date: ${q(meta.date)}`);
  if (meta.pagetitle) lines.push(`pagetitle: ${q(meta.pagetitle)}`);
  if (meta.lang) lines.push(`lang: ${meta.lang}`);
  if (!meta.width && !meta.height && !meta.css?.length) lines.push('format: revealjs');
  else {
    lines.push('format:', '  revealjs:');
    if (meta.width) lines.push(`    width: ${meta.width}`);
    if (meta.height) lines.push(`    height: ${meta.height}`);
    if (meta.css?.length === 1) lines.push(`    css: ${q(meta.css[0])}`);
    else if (meta.css?.length) lines.push('    css:', ...meta.css.map((c) => `      - ${q(c)}`));
  }
  lines.push('---');
  return lines.join('\n');
}

// ------------------------------------------------------------------ reading markdown

type Block =
  | { kind: 'heading'; level: number; text: string; attrs: Attrs; raw: string }
  | { kind: 'hr'; raw: string }
  | { kind: 'pause'; raw: string }
  | { kind: 'code'; lang: string; text: string; raw: string }
  | { kind: 'div'; attrs: Attrs; children: Block[]; raw: string }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][]; raw: string }
  | { kind: 'quote'; children: Block[]; raw: string }
  | { kind: 'table'; header: string[]; rows: string[][]; raw: string }
  | { kind: 'html'; html: string; raw: string }
  | { kind: 'comment'; text: string; raw: string }
  | { kind: 'para'; text: string; raw: string };

const BLOCK_TAGS = new Set(['div', 'section', 'svg', 'table', 'pre', 'figure', 'aside', 'ul', 'ol', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'img', 'video',
  'audio', 'iframe', 'details', 'dl', 'form', 'canvas', 'object', 'embed', 'nav', 'header', 'footer', 'main', 'article', 'script', 'style', 'math', 'address', 'fieldset']);

/** Splits `---` YAML front matter off the top. */
export function splitFrontMatter(md: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(md);
  if (!m) return { meta: {}, body: md };
  return { meta: parseYaml(m[1]), body: md.slice(m[0].length) };
}

/** Enough YAML for a Quarto header: nested maps by indentation, `- ` lists, quoted and bare scalars. */
export function parseYaml(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l));
  let i = 0;
  const scalar = (s: string): unknown => {
    s = s.trim();
    if (/^"(?:[^"\\]|\\.)*"$/.test(s)) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
    if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).split(',').map((x) => scalar(x));
    return s;
  };
  const indentOf = (l: string) => l.length - l.trimStart().length;
  const parse = (indent: number): unknown => {
    if (i >= lines.length) return {};
    if (/^\s*-\s/.test(lines[i])) {
      const arr: unknown[] = [];
      while (i < lines.length && indentOf(lines[i]) === indent && /^\s*-\s/.test(lines[i])) {
        const rest = lines[i].trim().slice(2);
        i++;
        if (/^[\w-]+:\s*(.*)$/.test(rest)) { lines.splice(i, 0, ' '.repeat(indent + 2) + rest); arr.push(parse(indent + 2)); }
        else arr.push(scalar(rest));
      }
      return arr;
    }
    const obj: Record<string, unknown> = {};
    while (i < lines.length && indentOf(lines[i]) === indent) {
      const m = /^\s*([\w.-]+):\s*(.*)$/.exec(lines[i]);
      if (!m) { i++; continue; }
      i++;
      if (m[2].trim() !== '' && !/^[|>]-?$/.test(m[2].trim())) obj[m[1]] = scalar(m[2]);
      else if (/^[|>]-?$/.test(m[2].trim())) {
        const block: string[] = [];
        while (i < lines.length && indentOf(lines[i]) > indent) block.push(lines[i++].trim());
        obj[m[1]] = block.join(m[2].trim().startsWith('>') ? ' ' : '\n');
      } else if (i < lines.length && indentOf(lines[i]) > indent) obj[m[1]] = parse(indentOf(lines[i]));
      else obj[m[1]] = '';
    }
    return obj;
  };
  return parse(0) as Record<string, unknown>;
}

export function metaFromYaml(y: Record<string, unknown>): DeckMeta {
  const meta: DeckMeta = {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : v && typeof v === 'object' && 'name' in v ? str((v as { name: unknown }).name) : undefined);
  if (y.title !== undefined) meta.title = str(y.title) ?? '';
  if (y.subtitle !== undefined) meta.subtitle = str(y.subtitle);
  if (y.author !== undefined) meta.author = str(y.author);
  if (y.date !== undefined) meta.date = str(y.date);
  if (y.pagetitle !== undefined) meta.pagetitle = str(y.pagetitle);
  if (y.lang !== undefined) meta.lang = str(y.lang);
  const fmt = y.format && typeof y.format === 'object' ? (y.format as Record<string, unknown>).revealjs : undefined;
  if (fmt && typeof fmt === 'object') {
    const r = fmt as Record<string, unknown>;
    if (typeof r.width === 'number') meta.width = r.width;
    if (typeof r.height === 'number') meta.height = r.height;
    if (typeof r.css === 'string') meta.css = [r.css];
    else if (Array.isArray(r.css)) meta.css = r.css.map(String);
  }
  return meta;
}

// ---- block parser

const FENCE_RE = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const DIV_OPEN_RE = /^:{3,}\s*(?:\{([^}]*)\}|([\w.-][\w.:-]*))?\s*$/;
const DIV_CLOSE_RE = /^:{3,}\s*$/;
const HEADING_RE = /^(#{1,6})(?:\s+(.*?))?\s*$/;
const LIST_RE = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const rawOf = (from: number, to: number) => lines.slice(from, to).join('\n');
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const start = i;
    let m: RegExpExecArray | null;

    if ((m = FENCE_RE.exec(line))) {
      const fence = m[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[0].repeat(fence.length)) && lines[i].trim().replace(/^[`~]+/, '') === '')) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', lang: m[3], text: body.join('\n'), raw: rawOf(start, i) });
      continue;
    }
    if ((m = DIV_OPEN_RE.exec(line)) && !DIV_CLOSE_RE.test(line)) {
      let depth = 1;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (DIV_CLOSE_RE.test(l)) { depth--; if (depth === 0) break; }
        else if (DIV_OPEN_RE.test(l)) depth++;
        body.push(l);
        i++;
      }
      i++;
      const attrs = m[1] !== undefined ? parseAttrs(m[1]) : m[2] ? parseAttrs('.' + m[2]) : { classes: [], kv: [] };
      blocks.push({ kind: 'div', attrs, children: parseBlocks(body.join('\n')), raw: rawOf(start, i) });
      continue;
    }
    if ((m = HEADING_RE.exec(line))) {
      let text = m[2] ?? '';
      let attrs: Attrs = { classes: [], kv: [] };
      const am = /\s*\{([^}]*)\}\s*$/.exec(text);
      if (am) { attrs = parseAttrs(am[1]); text = text.slice(0, am.index); }
      i++;
      blocks.push({ kind: 'heading', level: m[1].length, text: text.trim(), attrs, raw: rawOf(start, i) });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { i++; blocks.push({ kind: 'hr', raw: line }); continue; }
    if (/^\s*\.\s\.\s\.\s*$/.test(line)) { i++; blocks.push({ kind: 'pause', raw: line }); continue; }
    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
      const raw = rawOf(start, i);
      blocks.push({ kind: 'comment', text: raw.trim().replace(/^<!--/, '').replace(/-->$/, ''), raw });
      continue;
    }
    const tag = /^\s*<([a-zA-Z][\w-]*)/.exec(line);
    if (tag && BLOCK_TAGS.has(tag[1].toLowerCase())) {
      i = endOfHtml(lines, i, tag[1].toLowerCase());
      blocks.push({ kind: 'html', html: rawOf(start, i).trim(), raw: rawOf(start, i) });
      continue;
    }
    if ((m = LIST_RE.exec(line)) && m[1].length === 0) {
      const ordered = /\d/.test(m[2]);
      const items: string[][] = [];
      while (i < lines.length) {
        const lm = LIST_RE.exec(lines[i]);
        if (!lm || lm[1].length !== 0 || /\d/.test(lm[2]) !== ordered) break;
        const width = lm[1].length + lm[2].length + 1;
        const item = [lm[3]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) {
            // a blank line stays inside the item only if what follows is indented under it
            let j = i + 1;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j < lines.length && lines[j].length - lines[j].trimStart().length >= width) { item.push(''); i++; continue; }
            break;
          }
          const ind = l.length - l.trimStart().length;
          if (ind >= width) { item.push(l.slice(width)); i++; continue; }
          if (ind > 0 && LIST_RE.test(l)) { item.push(l.trimStart()); i++; continue; }
          if (LIST_RE.exec(l)?.[1].length === 0) break;
          if (item.length && item[item.length - 1] !== '' && !/^\s*<[a-zA-Z]/.test(l)) { item.push(l.trim()); i++; continue; }
          break;
        }
        items.push(item);
      }
      blocks.push({ kind: 'list', ordered, start: ordered ? parseInt(m[2], 10) : 1, items: items.map((it) => parseBlocks(it.join('\n'))), raw: rawOf(start, i) });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (/^\s*>/.test(lines[i]) || (lines[i].trim() && body.length && body[body.length - 1] !== ''))) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ kind: 'quote', children: parseBlocks(body.join('\n')), raw: rawOf(start, i) });
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ kind: 'table', header, rows, raw: rawOf(start, i) });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !FENCE_RE.test(lines[i]) && !DIV_OPEN_RE.test(lines[i]) && !HEADING_RE.test(lines[i]) && !/^\s*<!--/.test(lines[i])
      && !(LIST_RE.exec(lines[i])?.[1].length === 0) && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) body.push(lines[i++]);
    if (!body.length) body.push(lines[i++]);
    blocks.push({ kind: 'para', text: body.join('\n'), raw: rawOf(start, i) });
  }
  return blocks;
}

/** The line after the end of the raw HTML block that starts on `lines[i]` with `<tag`. */
function endOfHtml(lines: string[], i: number, tag: string): number {
  if (VOID.has(tag) || /\/>\s*$/.test(lines[i])) {
    while (i < lines.length && !/>\s*$/.test(lines[i])) i++;
    return Math.min(i + 1, lines.length);
  }
  const open = new RegExp(`<${tag}\\b[^>]*?(?<!/)>`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 0;
  for (; i < lines.length; i++) {
    depth += (lines[i].match(open) ?? []).length;
    depth -= (lines[i].match(close) ?? []).length;
    if (depth <= 0) return i + 1;
  }
  return lines.length;
}

// ---- inline → HTML

const MATH_RE = /^(\$\$[\s\S]+?\$\$|\$(?!\s)(?:[^$\\]|\\.)+?(?<!\s)\$(?!\d))/;

export function inlineHtml(md: string): string {
  let out = '';
  let i = 0;
  const s = md;
  const closing = (open: string, from: number): number => {
    let depth = 0;
    for (let j = from; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '`') { const e = s.indexOf('`', j + 1); if (e > 0) { j = e; continue; } }
      if (s[j] === '[') depth++;
      else if (s[j] === ']') { if (depth === 0) return j; depth--; }
    }
    return -1;
  };
  const delim = (d: string, from: number): number => {
    for (let j = from; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s.startsWith(d, j) && !/\s/.test(s[j - 1] ?? '') && (d.length > 1 || s[j + 1] !== d)) return j;
    }
    return -1;
  };
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if (c === '\\') {
      if (s[i + 1] === '\n') { out += '<br>'; i += 2; continue; }
      if (i + 1 < s.length && /[^\w\s]/.test(s[i + 1])) { out += escapeChar(s[i + 1]); i += 2; continue; }
      out += '\\'; i++; continue;
    }
    if (c === '$' && (m = MATH_RE.exec(rest))) { out += escapeMath(m[0]); i += m[0].length; continue; }
    if (c === '`') {
      const f = /^`+/.exec(rest)![0];
      const e = s.indexOf(f, i + f.length);
      if (e > 0) { out += `<code>${escapeHtml(s.slice(i + f.length, e).trim())}</code>`; i = e + f.length; continue; }
    }
    if (rest.startsWith('**') || rest.startsWith('__')) {
      const d = rest.slice(0, 2);
      if (!/\s/.test(s[i + 2] ?? ' ')) {
        const e = delim(d, i + 2);
        if (e > 0) { out += `<strong>${inlineHtml(s.slice(i + 2, e))}</strong>`; i = e + 2; continue; }
      }
    }
    if ((c === '*' || c === '_') && !/\s/.test(s[i + 1] ?? ' ') && !(c === '_' && /\w/.test(s[i - 1] ?? ' '))) {
      const e = delim(c, i + 1);
      if (e > 0 && !(c === '_' && /\w/.test(s[e + 1] ?? ' '))) { out += `<em>${inlineHtml(s.slice(i + 1, e))}</em>`; i = e + 1; continue; }
    }
    if ((c === '~' || c === '^') && (m = /^([~^])([^\s~^]+)\1/.exec(rest)) && m[1] === c) {
      out += `<${c === '~' ? 'sub' : 'sup'}>${inlineHtml(m[2])}</${c === '~' ? 'sub' : 'sup'}>`; i += m[0].length; continue;
    }
    if (rest.startsWith('![')) {
      const e = closing('[', i + 2);
      if (e > 0 && s[e + 1] === '(') {
        const pe = s.indexOf(')', e + 2);
        if (pe > 0) {
          const alt = s.slice(i + 2, e);
          const src = s.slice(e + 2, pe).trim().replace(/\s+"[^"]*"$/, '');
          let j = pe + 1;
          let attrs: Attrs = { classes: [], kv: [] };
          const am = /^\{([^}]*)\}/.exec(s.slice(j));
          if (am) { attrs = parseAttrs(am[1]); j += am[0].length; }
          out += imageHtml(src, alt, attrs);
          i = j; continue;
        }
      }
    }
    if (c === '[') {
      const e = closing('[', i + 1);
      if (e > 0) {
        const inner = s.slice(i + 1, e);
        if (s[e + 1] === '(') {
          const pe = s.indexOf(')', e + 2);
          if (pe > 0) { const href = s.slice(e + 2, pe).trim().replace(/\s+"[^"]*"$/, ''); out += `<a href="${escapeAttr(href)}">${inlineHtml(inner)}</a>`; i = pe + 1; continue; }
        }
        if (s[e + 1] === '{') {
          const ae = s.indexOf('}', e + 2);
          if (ae > 0) { out += `<span${attrsToHtml(parseAttrs(s.slice(e + 2, ae)))}>${inlineHtml(inner)}</span>`; i = ae + 1; continue; }
        }
      }
    }
    if (c === '<') {
      if ((m = /^<((?:https?|mailto):[^\s>]+)>/.exec(rest))) { out += `<a href="${escapeAttr(m[1])}">${escapeHtml(m[1])}</a>`; i += m[0].length; continue; }
      if ((m = /^<!--[\s\S]*?-->/.exec(rest)) || (m = /^<\/?[a-zA-Z][\w-]*(?:\s+[^<>]*?)?\/?>/.exec(rest))) { out += m[0]; i += m[0].length; continue; }
      out += '&lt;'; i++; continue;
    }
    if (c === '&') {
      if ((m = /^&(?:#\d+|#x[\da-fA-F]+|\w+);/.exec(rest))) { out += m[0]; i += m[0].length; continue; }
      out += '&amp;'; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

function escapeChar(c: string): string { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c; }
function escapeMath(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function imageHtml(src: string, alt: string, attrs: Attrs): string {
  const a: Attrs = { id: attrs.id, classes: attrs.classes, kv: [] };
  const styles: string[] = [];
  for (const [k, v] of attrs.kv) {
    if (k === 'width' || k === 'height') styles.push(`${k}:${/^[\d.]+$/.test(v) ? v + 'px' : v}`);
    else if (k === 'fig-alt') alt = v;
    else if (k === 'style') styles.push(v.replace(/;\s*$/, ''));
    else a.kv.push([k, v]);
  }
  const style = styles.length ? ` style="${escapeAttr(styles.join(';') + ';')}"` : '';
  return `<img${a.classes.length ? ` class="${escapeAttr(a.classes.join(' '))}"` : ''} src="${escapeAttr(src)}" alt="${escapeAttr(plainText(alt))}"${style}${attrsToHtml({ id: a.id, classes: [], kv: a.kv })}>`;
}

// ---- blocks → HTML

interface Slide { heading: Extract<Block, { kind: 'heading' }> | null; blocks: Block[]; stack: Slide[] | null; stackAttrs?: Attrs; raw: string[]; comments: string[] }

/** Groups top-level blocks into slides. Blocks before the first slide go to `preamble`. */
function groupSlides(blocks: Block[]): { slides: Slide[]; preamble: Block[]; trailingComments: string[] } {
  const slides: Slide[] = [];
  const preamble: Block[] = [];
  let cur: Slide | null = null;
  let pendingComments: string[] = [];
  const open = (heading: Slide['heading'], raw: string) => {
    cur = { heading, blocks: [], stack: null, raw: [raw], comments: pendingComments };
    pendingComments = [];
    slides.push(cur);
  };
  for (const b of blocks) {
    if (b.kind === 'comment') { pendingComments.push(b.raw.trim()); continue; }
    if (b.kind === 'heading' && b.level <= 2) {
      if (cur && cur.heading === null && !cur.blocks.length && cur.stack === null) { cur.heading = b; cur.raw = [b.raw]; cur.comments.push(...pendingComments); pendingComments = []; }
      else open(b, b.raw);
      continue;
    }
    if (b.kind === 'hr') { open(null, ''); continue; }
    if (b.kind === 'div' && b.attrs.classes.includes('stack')) {
      const inner = groupSlides(b.children);
      const attrs: Attrs = { id: b.attrs.id, classes: b.attrs.classes.filter((c) => c !== 'stack'), kv: b.attrs.kv };
      cur = { heading: null, blocks: [], stack: inner.slides, stackAttrs: attrs, raw: [b.raw], comments: pendingComments };
      pendingComments = [];
      slides.push(cur);
      continue;
    }
    if (!cur) { preamble.push(b); continue; }
    cur.blocks.push(b);
    cur.raw.push(b.raw);
  }
  return { slides, preamble, trailingComments: pendingComments };
}

function normalizeMd(s: string): string {
  return s.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** What identifies a slide across the round trip: its markdown, whitespace aside. */
function slideKey(s: Slide): string { return normalizeMd(s.raw.filter(Boolean).join('\n\n')); }

class HtmlOut {
  constructor(private step = '  ') {}

  section(s: Slide, indent: string): string {
    const inner = indent + this.step;
    if (s.stack) {
      const parts = s.stack.map((sub) => this.section(sub, inner));
      return `${indent}<section${attrsToHtml(s.stackAttrs ?? { classes: [], kv: [] }, SLIDE_ATTR_FROM_MD)}>\n${parts.join('\n')}\n${indent}</section>`;
    }
    const h = s.heading;
    const attrs = h ? h.attrs : { classes: [], kv: [] };
    const isBreak = attrs.classes.includes('break');
    const lines: string[] = [];
    let blocks = s.blocks.slice();
    // the kicker and the backdrop are written after the heading in markdown but sit above it in the slide
    const hoisted: Block[] = [];
    const kickerAt = blocks.findIndex((b) => b.kind === 'div' && b.attrs.classes.join(' ') === 'kicker');
    if (kickerAt >= 0 && blocks.slice(0, kickerAt).every((b) => b.kind === 'div' && b.attrs.classes.join(' ') === 'backdrop')) hoisted.push(blocks[kickerAt]);
    const backdrops = blocks.filter((b) => b.kind === 'div' && b.attrs.classes.join(' ') === 'backdrop');
    for (const b of backdrops) hoisted.unshift(...(b as Extract<Block, { kind: 'div' }>).children);
    blocks = blocks.filter((b) => !hoisted.includes(b) && !backdrops.includes(b));
    if (kickerAt >= 0 && !hoisted.includes(s.blocks[kickerAt])) hoisted.push(s.blocks[kickerAt]), (blocks = blocks.filter((b) => b !== s.blocks[kickerAt]));
    for (const b of hoisted) lines.push(...this.block(b, inner));
    if (h && h.text) {
      const tag = h.level === 2 ? 'h2' : isBreak ? 'p class="big"' : 'h1';
      lines.push(`${inner}<${tag}>${inlineHtml(h.text)}</${tag.split(' ')[0]}>`);
    }
    let fragment = false;
    for (const b of blocks) {
      if (b.kind === 'pause') { fragment = true; continue; }
      const out = this.block(b, fragment ? inner + this.step : inner);
      if (fragment) lines.push(`${inner}<div class="fragment">`, ...out, `${inner}</div>`);
      else lines.push(...out);
    }
    return `${indent}<section${attrsToHtml(attrs, SLIDE_ATTR_FROM_MD)}>\n${lines.join('\n')}\n${indent}</section>`;
  }

  block(b: Block, indent: string, ctx: { incremental?: boolean } = {}): string[] {
    const inner = indent + this.step;
    switch (b.kind) {
      case 'para': {
        // an image alone in a paragraph is a figure: the image, plus a caption when the alt text is not empty
        const fig = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?$/.exec(b.text.trim());
        if (fig) {
          const img = imageHtml(fig[2], fig[1], fig[3] !== undefined ? parseAttrs(fig[3]) : { classes: [], kv: [] });
          return fig[1] ? [indent + img, `${indent}<p class="caption">${inlineHtml(fig[1])}</p>`] : [indent + img];
        }
        return [`${indent}<p>${inlineHtml(b.text)}</p>`];
      }
      case 'heading': return [`${indent}<h${b.level}${attrsToHtml(b.attrs)}>${inlineHtml(b.text)}</h${b.level}>`];
      case 'hr': return [`${indent}<hr>`];
      case 'pause': return [];
      case 'comment': return [`${indent}${b.raw.trim()}`];
      case 'html': return b.html.split('\n').map((l, i) => (i === 0 ? indent + l.trimStart() : l.trim() ? indent + l : l));
      case 'code': {
        const cls = b.lang ? ` class="language-${escapeAttr(b.lang)}"` : '';
        return [`${indent}<pre><code${cls}>${escapeHtml(b.text)}</code></pre>`];
      }
      case 'quote': return [`${indent}<blockquote>`, ...b.children.flatMap((c) => this.block(c, inner)), `${indent}</blockquote>`];
      case 'table': {
        const row = (cells: string[], tag: string) => `${inner + this.step}<tr>${cells.map((c) => `<${tag}>${inlineHtml(c)}</${tag}>`).join('')}</tr>`;
        return [`${indent}<table>`, `${inner}<thead>`, row(b.header, 'th'), `${inner}</thead>`, `${inner}<tbody>`, ...b.rows.map((r) => row(r, 'td')), `${inner}</tbody>`, `${indent}</table>`];
      }
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
        const li = ctx.incremental ? '<li class="fragment">' : '<li>';
        const lines = [`${indent}<${tag}${start}>`];
        for (const item of b.items) {
          const [first, ...more] = item;
          if (!first) { lines.push(`${inner}${li}</li>`); continue; }
          const simple = first.kind === 'para' && more.every((m) => m.kind === 'list');
          if (simple) {
            if (!more.length) { lines.push(`${inner}${li}${inlineHtml(first.text)}</li>`); continue; }
            lines.push(`${inner}${li}${inlineHtml(first.text)}`, ...more.flatMap((m) => this.block(m, inner + this.step, ctx)), `${inner}</li>`);
          } else {
            lines.push(`${inner}${li}`, ...item.flatMap((m) => this.block(m, inner + this.step, ctx)), `${inner}</li>`);
          }
        }
        lines.push(`${indent}</${tag}>`);
        return lines;
      }
      case 'div': {
        const cls = b.attrs.classes;
        const key = cls.join(' ');
        const single = b.children.length === 1 && b.children[0].kind === 'para' ? (b.children[0] as Extract<Block, { kind: 'para' }>).text : null;
        if (key === 'notes' && b.attrs.kv.length === 0) {
          if (single !== null) return [`${indent}<aside class="notes">${inlineHtml(single)}</aside>`];
          return [`${indent}<aside class="notes">`, ...b.children.flatMap((c) => this.block(c, inner)), `${indent}</aside>`];
        }
        if (key === 'kicker' && single !== null) return [`${indent}<div class="kicker">${inlineHtml(single)}</div>`];
        if (key === 'incremental' || key === 'nonincremental') return b.children.flatMap((c) => this.block(c, indent, { incremental: key === 'incremental' }));
        if (key === 'columns') {
          const cols = b.children.map((c) => (c.kind === 'div' && c.attrs.classes.includes('column') ? { ...c, attrs: { ...c.attrs, classes: c.attrs.classes.map((x) => (x === 'column' ? 'col' : x)), kv: c.attrs.kv.filter(([k]) => k !== 'width') } } : c));
          return [`${indent}<div class="cols">`, ...cols.flatMap((c) => this.block(c, inner)), `${indent}</div>`];
        }
        if (single !== null && cls.length && cls.every((c) => PARA_CLASSES.has(c)) && b.attrs.kv.length === 0 && !b.attrs.id) {
          return [`${indent}<p class="${escapeAttr(key)}">${inlineHtml(single)}</p>`];
        }
        return [`${indent}<div${attrsToHtml(b.attrs)}>`, ...b.children.flatMap((c) => this.block(c, inner, ctx)), `${indent}</div>`];
      }
    }
  }
}

function titleSlide(meta: DeckMeta, notes: Block[], out: HtmlOut, indent: string): string {
  const step = '  ';
  const lines = [`${indent}<section class="title-slide">`, `${indent + step}<h1>${inlineHtml(meta.title ?? '')}</h1>`];
  if (meta.subtitle) lines.push(`${indent + step}<p class="sub">${inlineHtml(meta.subtitle)}</p>`);
  if (meta.author || meta.date) {
    const author = meta.author ? (/^\*\*[^*]+\*\*$/.test(meta.author) ? `<b>${inlineHtml(meta.author.slice(2, -2))}</b>` : inlineHtml(meta.author)) : '';
    lines.push(`${indent + step}<p class="meta">${author}${meta.date ? `${author ? '<br>' : ''}${inlineHtml(meta.date)}` : ''}</p>`);
  }
  for (const b of notes) lines.push(...out.block(b, indent + step));
  lines.push(`${indent}</section>`);
  return lines.join('\n');
}

function titleKey(meta: DeckMeta): string {
  return 'title:' + JSON.stringify([meta.title ?? '', meta.subtitle ?? '', meta.author ?? '', meta.date ?? '']);
}

export interface ImportOptions {
  /** The deck to splice the slides into; its untouched slides keep their bytes. */
  existing?: string;
  /** Builds a fresh deck for the front matter when there is no existing one. */
  scaffold?: (meta: DeckMeta) => string;
  parse?: HtmlParser;
}

export interface ImportResult { html: string; meta: DeckMeta; slides: number; reused: number }

/** Markdown → a full deck. */
export function markdownToDeck(md: string, opts: ImportOptions = {}): ImportResult {
  const { meta: yaml, body } = splitFrontMatter(md);
  const meta = metaFromYaml(yaml);
  const { slides, preamble, trailingComments } = groupSlides(parseBlocks(body));

  let html = opts.existing ?? opts.scaffold?.(meta);
  if (html === undefined) throw new Error('markdownToDeck needs an existing deck or a scaffold');

  // the slides div and the bytes of its current slides, keyed by their markdown
  const range = slidesRange(html);
  if (!range) throw new Error('no <div class="slides"> in the deck');
  const oldInner = html.slice(range.start, range.end);
  const reusable = new Map<string, string>();
  if (opts.existing && opts.parse) {
    const nodes = opts.parse(opts.existing);
    const div = findSlidesDiv(nodes);
    for (const k of div ? blockChildren(div) : []) {
      if (!isSlide(k) || k.start == null || k.end == null) continue;
      const tm = titleSlideMeta(k);
      reusable.set(tm ? titleKey({ ...tm }) : normalizeMd(sectionToMarkdown(k, opts.existing)), opts.existing.slice(k.start, k.end));
    }
  }

  const indentMatch = /\n([ \t]*)<section\b/.exec(oldInner) ?? /\n([ \t]*)<!--/.exec(oldInner);
  const indent = indentMatch ? indentMatch[1] : '      ';
  const out = new HtmlOut();
  const parts: string[] = [];
  let reused = 0;
  const emit = (key: string, build: () => string, comments: string[]) => {
    const old = reusable.get(key);
    if (old !== undefined) reused++;
    parts.push([...comments.map((c) => indent + c), old !== undefined ? indent + old : build()].join('\n'));
  };
  let count = 0;
  if (meta.title !== undefined) {
    count++;
    // a comment that labelled the title slide sits above the first body slide's own comment; give it back
    const titleComments = slides.length && slides[0].comments.length >= 2 ? slides[0].comments.splice(0, 1) : [];
    emit(titleKey(meta), () => titleSlide(meta, preamble, out, indent), titleComments);
  } else if (preamble.length) {
    count++;
    const s: Slide = { heading: null, blocks: preamble, stack: null, raw: preamble.map((b) => b.raw), comments: [] };
    emit(slideKey(s), () => out.section(s, indent), []);
  }
  for (const s of slides) { count++; emit(slideKey(s), () => out.section(s, indent), s.comments); }
  if (trailingComments.length) parts.push(trailingComments.map((c) => indent + c).join('\n'));

  const tail = /\s*$/.exec(oldInner)![0];
  const inner = '\n\n' + parts.join('\n\n') + (tail.includes('\n') ? tail : '\n');
  html = html.slice(0, range.start) + inner + html.slice(range.end);

  const pageTitle = meta.pagetitle ?? (meta.title !== undefined ? plainText(meta.title) : undefined);
  if (pageTitle !== undefined) html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`);
  return { html, meta, slides: count, reused };
}

/** Offsets of the content of `<div class="slides">` in a deck's text. */
export function slidesRange(html: string): { start: number; end: number } | null {
  const open = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bslides\b[^"']*["'][^>]*>/.exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const re = /<div\b|<\/div\s*>/g;
  re.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return { start, end: m.index };
  }
  return null;
}
