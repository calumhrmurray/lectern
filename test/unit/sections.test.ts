import { describe, expect, it } from 'vitest';
import { DeckDocument } from '../../src/deck/DeckDocument';
import { declaredName, hasSections, sectionIndexAt, sectionsOf } from '../../src/deck/sections';

function deck(...sections: string[]): Element[] {
  const d = new DeckDocument(`<html><body><div class="reveal"><div class="slides">${sections.join('')}</div></div></body></html>`);
  return d.slides.map((s) => s.el);
}

const shape = (els: Element[]) => sectionsOf(els).map((s) => [s.name, s.start, s.count, s.explicit]);

describe('sections', () => {
  it('is one unnamed run when the deck declares nothing', () => {
    const els = deck('<section><h2>a</h2></section>', '<section><h2>b</h2></section>', '<section><h2>c</h2></section>');
    expect(shape(els)).toEqual([[null, 0, 3, false]]);
    expect(hasSections(sectionsOf(els))).toBe(false);
  });

  it('starts a run at every data-section and names it', () => {
    const els = deck(
      '<section class="title-slide"><h1>Whales</h1></section>',
      '<section data-section="Anatomy"><h2>a</h2></section>',
      '<section><h2>b</h2></section>',
      '<section data-section="Evidence"><h2>c</h2></section>',
    );
    expect(shape(els)).toEqual([[null, 0, 1, false], ['Anatomy', 1, 2, true], ['Evidence', 3, 1, true]]);
    expect(hasSections(sectionsOf(els))).toBe(true);
  });

  it('lets an empty data-section cut a seam without naming it', () => {
    const els = deck('<section><h2>a</h2></section>', '<section data-section=""><h2>b</h2></section>');
    expect(shape(els)).toEqual([[null, 0, 1, false], [null, 1, 1, true]]);
    expect(declaredName(els[1])).toBeNull();
  });

  it('reads a break slide as a section named by its big text', () => {
    const els = deck(
      '<section><h2>a</h2></section>',
      '<section class="break"><p class="big">Back to the water</p><p class="sub">part two</p></section>',
      '<section><h2>b</h2></section>',
    );
    expect(shape(els)).toEqual([[null, 0, 1, false], ['Back to the water', 1, 2, false]]);
    expect(sectionsOf(els)[1].from).toBe('break');
  });

  it('reads a repeated kicker as a section, but a one-off kicker as nothing', () => {
    const els = deck(
      '<section><div class="kicker">Introduction</div><h2>a</h2></section>',
      '<section><div class="kicker">Anatomy</div><h2>b</h2></section>',
      '<section><div class="kicker">Anatomy</div><h2>c</h2></section>',
      '<section><div class="kicker">Transition 3 · the walking whale</div><h2>d</h2></section>',
    );
    expect(shape(els)).toEqual([[null, 0, 1, false], ['Anatomy', 1, 3, false]]);
  });

  it('prefers what the file declares over what can be guessed', () => {
    const els = deck(
      '<section><h2>a</h2></section>',
      '<section data-section="Middle" class="break"><p class="big">Back to the water</p></section>',
    );
    expect(shape(els)).toEqual([[null, 0, 1, false], ['Middle', 1, 1, true]]);
    expect(sectionsOf(els)[1].from).toBe('attribute');
  });

  it('collapses whitespace in a declared name', () => {
    const els = deck('<section data-section="  Deep   time  "><h2>a</h2></section>');
    expect(sectionsOf(els)[0].name).toBe('Deep time');
  });

  it('covers every slide and maps a slide back to its section', () => {
    const els = deck(
      '<section><h2>a</h2></section>',
      '<section data-section="Two"><h2>b</h2></section>',
      '<section><h2>c</h2></section>',
      '<section data-section="Three"><h2>d</h2></section>',
    );
    const secs = sectionsOf(els);
    expect(secs.reduce((n, s) => n + s.count, 0)).toBe(els.length);
    expect([0, 1, 2, 3].map((t) => sectionIndexAt(secs, t))).toEqual([0, 1, 1, 2]);
  });

  it('handles an empty deck', () => {
    expect(sectionsOf([])).toEqual([]);
    expect(hasSections([])).toBe(false);
  });
});
