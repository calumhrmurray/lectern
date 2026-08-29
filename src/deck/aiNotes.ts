/**
 * Notes for an AI (or a colleague) placed on a slide: "draw a whale here",
 * "explain X here". They are ordinary elements in the file —
 *
 *   <div hidden data-ai-note style="position:absolute;left:640px;top:200px;width:260px;">draw a whale here</div>
 *
 * — so any tool can find them (`data-ai-note`), the `hidden` attribute keeps
 * them out of the presentation, and the inline position says *where* on the
 * slide (slide units, e.g. 1280×720) the request applies.
 *
 * A note is a thread: its children are comments, `<p data-by="author">` and
 * `<p data-by="ai">`, in order. A pending note has `data-ai-note=""`; when an
 * assistant has acted on it, it appends `<p data-by="ai">what was done</p>`
 * and sets `data-ai-note="done"` — the note turns green for the author, who
 * can add another comment (it becomes pending again) or dismiss it.
 * Older notes with plain text and a `data-ai-reply` attribute are read too.
 */

import type { DeckDocument } from './DeckDocument';
import { slideLabel } from './html';

export interface AiNote {
  /** Top-level slide index. */
  top: number;
  slideLabel: string;
  text: string;
  x: number | null;
  y: number | null;
  el: Element;
  done: boolean;
  reply: string | null;
  /** The whole conversation, oldest first. */
  entries: { by: 'author' | 'ai'; text: string }[];
}

export const AI_NOTE_ATTR = 'data-ai-note';

export function isAiNote(el: Element | null | undefined): boolean {
  return !!el && el.hasAttribute(AI_NOTE_ATTR);
}

export function isDoneNote(el: Element | null | undefined): boolean {
  return !!el && el.getAttribute(AI_NOTE_ATTR) === 'done';
}

export function collectAiNotes(doc: DeckDocument): AiNote[] {
  const out: AiNote[] = [];
  doc.slides.forEach((rec, top) => {
    for (const el of Array.from(rec.el.querySelectorAll(`[${AI_NOTE_ATTR}]`))) {
      const style = el.getAttribute('style') ?? '';
      const x = /left\s*:\s*(-?[\d.]+)px/.exec(style);
      const y = /top\s*:\s*(-?[\d.]+)px/.exec(style);
      const entries = noteEntries(el);
      const lastAuthor = [...entries].reverse().find((e) => e.by === 'author')?.text ?? '';
      const lastAi = [...entries].reverse().find((e) => e.by === 'ai')?.text ?? null;
      out.push({ top, slideLabel: slideLabel(rec.el, `Slide ${top + 1}`), text: lastAuthor, x: x ? Number(x[1]) : null, y: y ? Number(y[1]) : null, el, done: isDoneNote(el), reply: lastAi, entries });
    }
  });
  return out;
}

/** The comments of a note, oldest first (legacy plain-text notes count as one author comment). */
export function noteEntries(el: Element): { by: 'author' | 'ai'; text: string }[] {
  const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
  const ps = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'p');
  if (ps.length) {
    const entries = ps.map((c) => ({ by: (c.getAttribute('data-by') === 'ai' ? 'ai' : 'author') as 'author' | 'ai', text: clean(c.textContent ?? '') }));
    const legacy = el.getAttribute('data-ai-reply');
    if (legacy) entries.push({ by: 'ai', text: clean(legacy) });
    return entries;
  }
  const entries: { by: 'author' | 'ai'; text: string }[] = [];
  const text = clean(el.textContent ?? '');
  if (text) entries.push({ by: 'author', text });
  const legacy = el.getAttribute('data-ai-reply');
  if (legacy) entries.push({ by: 'ai', text: clean(legacy) });
  return entries;
}

/** A prompt an assistant can act on directly. */
export function aiNotesPrompt(doc: DeckDocument, deckPath: string, size: { width: number; height: number }): string {
  const notes = collectAiNotes(doc).filter((n) => n.text && !n.done);
  if (!notes.length) return '';
  const lines = [
    `The slide deck ${deckPath} (slides are ${size.width}×${size.height}) has ${notes.length} pending note${notes.length === 1 ? '' : 's'} for you, marked in the HTML as <div hidden data-ai-note …> inside the slide's <section>:`,
    '',
  ];
  for (const n of notes) {
    const where = n.x !== null && n.y !== null ? ` at (${Math.round(n.x)}, ${Math.round(n.y)})` : '';
    const thread = n.entries.length > 1 ? n.entries.map((e) => `${e.by === 'ai' ? 'you (earlier)' : 'author'}: ${e.text}`).join(' → ') : n.text;
    lines.push(`- Slide ${n.top + 1} (“${n.slideLabel}”)${where}: ${thread}`);
  }
  lines.push('', 'Do what each note asks, in the file itself, keeping the existing style of the deck. Do not delete the notes: when one is done, append <p data-by="ai">a short sentence saying what you did</p> inside it and set data-ai-note="done". The author will dismiss it.');
  return lines.join('\n');
}
