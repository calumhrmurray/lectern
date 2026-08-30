/**
 * Sections: the runs a deck falls into ("Introduction", "Anatomy", "Evidence").
 *
 * A section is a run of consecutive top-level slides. It is worth having because
 * it is the only structure above "slide" that a talk actually has, and both the
 * compass and the map read it: the compass puts a seam between sections, the map
 * labels its columns with them.
 *
 * A section is named in the file, on the first slide of the run:
 *
 *     <section data-section="Anatomy"> … </section>
 *
 * `data-section=""` starts a new, unnamed section — a seam without a label.
 * Slides that do not carry the attribute belong to the section that started
 * before them, so naming a ten-slide talk costs three attributes.
 *
 * Where nothing is declared, two conventions of the deck format are read
 * instead, so decks written before this existed still show some structure:
 *
 *   - a `break` slide (the section-break layout) starts a section, named by its
 *     `<p class="big">`;
 *   - a run of two or more consecutive slides sharing the same `.kicker` text is
 *     a section named by that kicker. One slide with a kicker of its own is not
 *     a section — in real decks the kicker is often a per-slide caption.
 *
 * Inferred names are marked `explicit: false`; writing one down (the map's
 * rename) sets `data-section` and makes it explicit.
 */

/** The attribute that names a section, on the first slide of the run. */
export const SECTION_ATTR = 'data-section';

export interface DeckSection {
  /** Display name, or null for an unnamed run. */
  name: string | null;
  /** Index of the first top-level slide of the run. */
  start: number;
  /** How many top-level slides are in the run (always >= 1). */
  count: number;
  /** True when the name comes from `data-section` in the file. */
  explicit: boolean;
  /** Where the name came from; null for an unnamed run. */
  from: 'attribute' | 'break' | 'kicker' | null;
}

function collapse(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** The `data-section` value, or null when the attribute is absent. */
export function declaredName(slide: Element): string | null {
  if (!slide.hasAttribute(SECTION_ATTR)) return null;
  return collapse(slide.getAttribute(SECTION_ATTR)) || null;
}

/** The name a `break` slide gives its section, if this is one. */
function breakName(slide: Element): string | null {
  if (!slide.classList.contains('break')) return null;
  const el = slide.querySelector('.big') ?? slide.querySelector('h1, h2');
  return collapse(el?.textContent) || null;
}

function kickerText(slide: Element): string {
  return collapse(slide.querySelector('.kicker')?.textContent);
}

/**
 * Groups the top-level slides of a deck into sections, in order. Always covers
 * every slide: an empty deck gives an empty array, a deck with no structure at
 * all gives one unnamed section spanning everything.
 */
export function sectionsOf(slides: Element[]): DeckSection[] {
  const out: DeckSection[] = [];
  if (!slides.length) return out;
  const kickers = slides.map(kickerText);

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    let name: string | null = null;
    let from: DeckSection['from'] = null;
    let explicit = false;
    let starts = false;

    if (slide.hasAttribute(SECTION_ATTR)) {
      starts = true;
      explicit = true;
      name = declaredName(slide);
      from = name ? 'attribute' : null;
    } else {
      const brk = breakName(slide);
      if (brk) {
        starts = true;
        name = brk;
        from = 'break';
      } else if (kickers[i] && kickers[i] === kickers[i + 1] && kickers[i] !== kickers[i - 1]) {
        // A kicker shared with the next slide reads as a section heading.
        starts = true;
        name = kickers[i];
        from = 'kicker';
      }
    }

    if (!out.length) {
      // The deck always opens a section, named only if this slide named one.
      out.push({ name, start: 0, count: 1, explicit, from });
      continue;
    }
    if (starts) out.push({ name, start: i, count: 1, explicit, from });
    else out[out.length - 1].count++;
  }
  return out;
}

/** The index in `sections` of the section a top-level slide belongs to. */
export function sectionIndexAt(sections: DeckSection[], top: number): number {
  for (let i = sections.length - 1; i >= 0; i--) if (top >= sections[i].start) return i;
  return 0;
}

/** True when a deck has structure worth drawing a seam for. */
export function hasSections(sections: DeckSection[]): boolean {
  return sections.length > 1 || (sections.length === 1 && sections[0].name !== null);
}
