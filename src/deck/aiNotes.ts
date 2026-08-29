/**
 * Notes for an AI (or a colleague) placed on a slide: "draw a whale here",
 * "explain X here". They are ordinary elements in the file —
 *
 *   <div hidden data-ai-note style="position:absolute;left:640px;top:200px;width:260px;">draw a whale here</div>
 *
 * — so any tool can find them (`data-ai-note`), the `hidden` attribute keeps
 * them out of the presentation, and the inline position says *where* on the
 * slide (slide units, e.g. 1280×720) the request applies.
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
}

export const AI_NOTE_ATTR = 'data-ai-note';

export function isAiNote(el: Element | null | undefined): boolean {
  return !!el && el.hasAttribute(AI_NOTE_ATTR);
}

export function collectAiNotes(doc: DeckDocument): AiNote[] {
  const out: AiNote[] = [];
  doc.slides.forEach((rec, top) => {
    for (const el of Array.from(rec.el.querySelectorAll(`[${AI_NOTE_ATTR}]`))) {
      const style = el.getAttribute('style') ?? '';
      const x = /left\s*:\s*(-?[\d.]+)px/.exec(style);
      const y = /top\s*:\s*(-?[\d.]+)px/.exec(style);
      out.push({ top, slideLabel: slideLabel(rec.el, `Slide ${top + 1}`), text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), x: x ? Number(x[1]) : null, y: y ? Number(y[1]) : null, el });
    }
  });
  return out;
}

/** A prompt an assistant can act on directly. */
export function aiNotesPrompt(doc: DeckDocument, deckPath: string, size: { width: number; height: number }): string {
  const notes = collectAiNotes(doc);
  if (!notes.length) return '';
  const lines = [
    `The slide deck ${deckPath} (slides are ${size.width}×${size.height}) has ${notes.length} note${notes.length === 1 ? '' : 's'} for you, marked in the HTML as <div hidden data-ai-note …> inside the slide's <section>:`,
    '',
  ];
  for (const n of notes) {
    const where = n.x !== null && n.y !== null ? ` at (${Math.round(n.x)}, ${Math.round(n.y)})` : '';
    lines.push(`- Slide ${n.top + 1} (“${n.slideLabel}”)${where}: ${n.text}`);
  }
  lines.push('', 'Do what each note asks, in the file itself, keeping the existing style of the deck. Remove each note element once it is done.');
  return lines.join('\n');
}
