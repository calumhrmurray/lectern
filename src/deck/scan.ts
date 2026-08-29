/**
 * A small, tolerant HTML scanner that locates the reveal.js slides container
 * (`<div class="slides">`) and the byte ranges of its top-level `<section>`
 * elements inside the *original* source text.
 *
 * We deliberately do not use the DOM for this: the point is to be able to
 * write slides back into the file while leaving every untouched byte —
 * comments, indentation, entity spellings — exactly as the author wrote it.
 *
 * The scanner understands: comments, `<script>`/`<style>`/`<textarea>`/`<pre>`
 * raw-text content, quoted attribute values (which may contain `>`), void
 * elements and `/>` self-closing syntax.
 */

export interface Range {
  /** inclusive start offset */
  start: number;
  /** exclusive end offset */
  end: number;
}

export interface SectionChunk {
  /** Text between the previous section (or the container start) and this section's opening tag. */
  lead: Range;
  /** The full `<section ...>...</section>` element. */
  body: Range;
}

export interface ScanResult {
  /** Range of the container's opening tag (`<div class="slides" ...>`). */
  containerOpen: Range;
  /** Offset just after the container's opening tag. */
  contentStart: number;
  /** Offset of the container's closing tag (`</div>`). */
  contentEnd: number;
  /** Top-level sections in document order. */
  sections: SectionChunk[];
  /** Text after the last section body up to `contentEnd`. */
  trailing: Range;
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is raw text (no tags are parsed inside). */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp']);

export interface Token {
  kind: 'open' | 'close' | 'comment' | 'text' | 'doctype';
  name: string;
  start: number;
  end: number;
  selfClosing: boolean;
  attrs: Map<string, string>;
}

function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9:_.-]/.test(ch);
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/**
 * Tokenises the given HTML into a stream of tags/comments/text. Text tokens
 * are emitted for everything that is not markup, including whitespace.
 */
export function* tokenize(html: string): Generator<Token> {
  const n = html.length;
  let i = 0;
  let textStart = 0;

  const flushText = function* (upTo: number): Generator<Token> {
    if (upTo > textStart) {
      yield { kind: 'text', name: '', start: textStart, end: upTo, selfClosing: false, attrs: new Map() };
    }
  };

  while (i < n) {
    if (html[i] !== '<') { i++; continue; }

    // Comment
    if (html.startsWith('<!--', i)) {
      yield* flushText(i);
      const close = html.indexOf('-->', i + 4);
      const end = close === -1 ? n : close + 3;
      yield { kind: 'comment', name: '', start: i, end, selfClosing: false, attrs: new Map() };
      i = end; textStart = i;
      continue;
    }

    // Doctype / other declarations
    if (html[i + 1] === '!') {
      yield* flushText(i);
      const close = html.indexOf('>', i);
      const end = close === -1 ? n : close + 1;
      yield { kind: 'doctype', name: '', start: i, end, selfClosing: false, attrs: new Map() };
      i = end; textStart = i;
      continue;
    }

    // Closing tag
    if (html[i + 1] === '/') {
      let j = i + 2;
      let name = '';
      while (j < n && isNameChar(html[j])) name += html[j++];
      if (!name) { i++; continue; }
      const close = html.indexOf('>', j);
      const end = close === -1 ? n : close + 1;
      yield* flushText(i);
      yield { kind: 'close', name: name.toLowerCase(), start: i, end, selfClosing: false, attrs: new Map() };
      i = end; textStart = i;
      continue;
    }

    // Opening tag
    if (/[A-Za-z]/.test(html[i + 1] ?? '')) {
      let j = i + 1;
      let name = '';
      while (j < n && isNameChar(html[j])) name += html[j++];
      const attrs = new Map<string, string>();
      let selfClosing = false;
      // attributes
      while (j < n) {
        while (j < n && isSpace(html[j])) j++;
        if (j >= n) break;
        if (html[j] === '>') { j++; break; }
        if (html[j] === '/' && html[j + 1] === '>') { selfClosing = true; j += 2; break; }
        if (html[j] === '/') { j++; continue; }
        let attrName = '';
        while (j < n && !isSpace(html[j]) && html[j] !== '=' && html[j] !== '>' && !(html[j] === '/' && html[j + 1] === '>')) {
          attrName += html[j++];
        }
        while (j < n && isSpace(html[j])) j++;
        let value = '';
        if (html[j] === '=') {
          j++;
          while (j < n && isSpace(html[j])) j++;
          const q = html[j];
          if (q === '"' || q === "'") {
            const close = html.indexOf(q, j + 1);
            value = html.slice(j + 1, close === -1 ? n : close);
            j = close === -1 ? n : close + 1;
          } else {
            while (j < n && !isSpace(html[j]) && html[j] !== '>') value += html[j++];
          }
        }
        if (attrName) attrs.set(attrName.toLowerCase(), value);
      }
      yield* flushText(i);
      const lname = name.toLowerCase();
      yield { kind: 'open', name: lname, start: i, end: j, selfClosing, attrs };
      i = j; textStart = i;

      // Raw text elements: skip to the matching close tag.
      if (RAW_TEXT_ELEMENTS.has(lname) && !selfClosing) {
        const re = new RegExp(`</${lname}\\s*>`, 'ig');
        re.lastIndex = i;
        const m = re.exec(html);
        const closeStart = m ? m.index : n;
        yield* flushText(closeStart);
        if (m) {
          yield { kind: 'close', name: lname, start: closeStart, end: closeStart + m[0].length, selfClosing: false, attrs: new Map() };
          i = closeStart + m[0].length;
        } else {
          i = n;
        }
        textStart = i;
      }
      continue;
    }

    i++;
  }
  yield* flushText(n);
}

function hasClassToken(attrs: Map<string, string>, token: string): boolean {
  const cls = attrs.get('class');
  if (!cls) return false;
  return cls.split(/\s+/).includes(token);
}

/**
 * Finds the slides container and its top-level sections.
 * Returns null when no `.slides` container can be found.
 */
export function scanDeck(html: string): ScanResult | null {
  const tokens = Array.from(tokenize(html));

  // 1. locate the container: the first element with class token "slides",
  //    else the parent element of the first <section> (plain HTML decks).
  let containerIdx = -1;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind === 'open' && !t.selfClosing && hasClassToken(t.attrs, 'slides')) { containerIdx = k; break; }
  }
  if (containerIdx === -1) {
    const stack: number[] = [];
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.kind === 'open') {
        const isVoid = VOID_ELEMENTS.has(t.name) || t.selfClosing;
        if (t.name === 'section' && !isVoid) { containerIdx = stack[stack.length - 1] ?? -1; break; }
        if (!isVoid) stack.push(k);
      } else if (t.kind === 'close') {
        for (let j = stack.length - 1; j >= 0; j--) if (tokens[stack[j]].name === t.name) { stack.length = j; break; }
      }
    }
  }
  if (containerIdx === -1) return null;
  const containerTok = tokens[containerIdx];
  const walked = walkSections(tokens, containerIdx + 1, containerTok.end, containerTok.name);
  if (walked.contentEnd === -1) return null;
  return {
    containerOpen: { start: containerTok.start, end: containerTok.end },
    contentStart: containerTok.end,
    contentEnd: walked.contentEnd,
    sections: walked.sections,
    trailing: { start: walked.prevEnd, end: walked.contentEnd },
  };
}

/**
 * Scans an HTML *fragment* file whose top level is a list of sections
 * (a "part" of a multi-file deck). The whole text is the content.
 */
export function scanFragment(html: string): ScanResult {
  const tokens = Array.from(tokenize(html));
  const walked = walkSections(tokens, 0, 0, null);
  return {
    containerOpen: { start: 0, end: 0 },
    contentStart: 0,
    contentEnd: html.length,
    sections: walked.sections,
    trailing: { start: walked.prevEnd, end: html.length },
  };
}

/** Walks tokens from `from`, collecting depth-0 sections until the container closes (or the end). */
function walkSections(tokens: Token[], from: number, contentStart: number, containerName: string | null): { sections: SectionChunk[]; contentEnd: number; prevEnd: number } {
  const sections: SectionChunk[] = [];
  let depth = 0; // depth relative to container content (0 = direct children)
  let contentEnd = -1;
  let currentSectionStart = -1;
  let prevEnd = contentStart; // end of previous section body (or content start)

  for (let k = from; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind === 'open') {
      const isVoid = VOID_ELEMENTS.has(t.name) || t.selfClosing;
      if (depth === 0 && t.name === 'section' && !isVoid) currentSectionStart = t.start;
      if (!isVoid) depth++;
    } else if (t.kind === 'close') {
      if (depth === 0) {
        if (containerName && t.name === containerName) { contentEnd = t.start; break; }
        continue; // stray close tag
      }
      depth--;
      if (depth === 0 && t.name === 'section' && currentSectionStart !== -1) {
        sections.push({
          lead: { start: prevEnd, end: currentSectionStart },
          body: { start: currentSectionStart, end: t.end },
        });
        prevEnd = t.end;
        currentSectionStart = -1;
      }
    }
  }
  return { sections, contentEnd, prevEnd };
}

/**
 * Detects a multi-file deck: part files listed either on the container as
 * `data-parts="a.html, b.html"` or as a `const parts = ['a.html', …]` array
 * in an inline script (a common hand-rolled pattern). Paths are relative to
 * the deck file.
 */
export function detectParts(html: string): string[] {
  const attr = /class="[^"]*\bslides\b[^"]*"[^>]*\bdata-parts="([^"]+)"/.exec(html) ?? /\bdata-parts="([^"]+)"[^>]*class="[^"]*\bslides\b/.exec(html);
  if (attr) return attr[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const m = /\b(?:const|let|var)\s+parts\s*=\s*\[([\s\S]*?)\]/.exec(html);
  if (!m) return [];
  const out: string[] = [];
  const re = /(['"`])([^'"`]+?)\1/g;
  let s: RegExpExecArray | null;
  while ((s = re.exec(m[1]))) if (/\.html?$/i.test(s[2])) out.push(s[2]);
  return out;
}

/** Whether the page runs reveal.js (as opposed to a hand-rolled slide driver). */
export function isRevealDeck(html: string): boolean {
  return /\bReveal\.initialize\s*\(|new\s+Reveal\s*\(|class="[^"]*\bslides\b/.test(html);
}

/**
 * Best-effort extraction of the deck's configured slide size from the
 * `Reveal.initialize({...})` call in the source. Returns undefined for
 * anything not written as a plain numeric literal.
 */
export function scanRevealSize(html: string): { width?: number; height?: number } {
  const m = /Reveal\.initialize\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(html);
  const out: { width?: number; height?: number } = {};
  if (!m) return out;
  const w = /\bwidth\s*:\s*(\d+)/.exec(m[1]);
  const h = /\bheight\s*:\s*(\d+)/.exec(m[1]);
  if (w) out.width = Number(w[1]);
  if (h) out.height = Number(h[1]);
  return out;
}

/** Infers the indentation used for top-level sections (whitespace after the last newline of a lead). */
export function inferIndent(html: string, scan: ScanResult): string {
  const counts = new Map<string, number>();
  for (const s of scan.sections) {
    const lead = html.slice(s.lead.start, s.lead.end);
    const nl = lead.lastIndexOf('\n');
    if (nl === -1) continue;
    const ws = lead.slice(nl + 1);
    if (/^[ \t]*$/.test(ws)) counts.set(ws, (counts.get(ws) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [ws, c] of counts) if (c > bestCount) { best = ws; bestCount = c; }
  if (bestCount === 0) {
    // Fall back to the container's indentation plus two spaces.
    const before = html.slice(0, scan.containerOpen.start);
    const nl = before.lastIndexOf('\n');
    const containerIndent = /^[ \t]*$/.test(before.slice(nl + 1)) ? before.slice(nl + 1) : '';
    return containerIndent + '  ';
  }
  return best;
}
