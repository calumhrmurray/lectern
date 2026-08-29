import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeckDocument } from '../../src/deck/DeckDocument';
import { DECK_THEMES } from '../../src/deck/themes';
import { starterDeckHtml } from '../../src/deck/templates';

const root = join(process.cwd(), 'public', 'examples');
const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')) as { examples: { id: string; files: string[] }[] };

describe('example decks', () => {
  for (const ex of index.examples) {
    it(`${ex.id}: parses, every slide cites its sources, no dangling refs`, () => {
      const html = readFileSync(join(root, ex.id, 'index.html'), 'utf8');
      const d = new DeckDocument(html, { path: 'index.html' });
      expect(d.info.kind).toBe('reveal');
      expect(d.length).toBeGreaterThanOrEqual(12);
      for (const rec of d.slides) {
        expect(rec.el.getAttribute('data-ref'), `slide ${d.indexOf(rec.el) + 1} has data-ref`).toBeTruthy();
        expect(rec.el.querySelector('aside.notes')?.textContent?.trim(), `slide ${d.indexOf(rec.el) + 1} has notes`).toBeTruthy();
      }
      // the last slide is a references list
      const last = d.slides[d.length - 1].el;
      expect(last.getAttribute('data-visibility')).toBe('uncounted');
      expect(last.querySelectorAll('li').length).toBeGreaterThan(10);
      // every file listed exists
      for (const f of ex.files) expect(readdirSync(join(root, ex.id))).toContain(f);
      // round-trips
      expect(d.serialize()).toBe(html);
      // meta references present
      expect(html).toMatch(/<meta name="references"/);
    });
  }

  it('theme stylesheets in the examples match the built-in themes', () => {
    const whale = readFileSync(join(root, 'whale-evolution', 'theme.css'), 'utf8');
    expect(whale.startsWith(DECK_THEMES.find((t) => t.id === 'aquarelle')!.css)).toBe(true);
    const nat = readFileSync(join(root, 'naturalisation-fr', 'theme.css'), 'utf8');
    expect(nat.startsWith(DECK_THEMES.find((t) => t.id === 'paper')!.css)).toBe(true);
  });

  it('every built-in theme produces a valid starter deck', () => {
    for (const t of DECK_THEMES) {
      const html = starterDeckHtml({ title: 'T', width: 1280, height: 720, revealPath: 'reveal', theme: t });
      const d = new DeckDocument(html);
      expect(d.length).toBe(2);
      if (t.bodyPrefix) expect(html).toContain('<filter id="wc-edge">');
    }
  });
});
