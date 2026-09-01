import { describe, expect, it } from 'vitest';
import { DECK_THEMES, themeById } from '../../src/deck/themes';
import { ELEMENT_TEMPLATES, lineSvg } from '../../src/deck/templates';

describe('built-in themes', () => {
  for (const t of DECK_THEMES) {
    it(`${t.id}: shared vocabulary comes first, theme rules after it`, () => {
      const shared = t.css.indexOf('/* ---- shared vocabulary ---- */');
      expect(shared).toBeGreaterThan(0);
      // the theme's own rules follow SHARED so they win at equal specificity
      expect(t.css.indexOf('.reveal-viewport')).toBeGreaterThan(shared);
      expect(t.css.indexOf('.reveal .kicker { color:')).toBeGreaterThan(shared);
      // :root variables stay at the top
      expect(t.css.indexOf(':root {')).toBeLessThan(shared);
    });
    it(`${t.id}: defines the font stacks and colours the vocabulary relies on`, () => {
      for (const v of ['--sans', '--serif', '--mono', '--paper', '--paper-2', '--ink', '--ink-soft', '--rule', '--accent', '--accent-2']) expect(t.css, v).toContain(`${v}:`);
    });
    it(`${t.id}: muted text is coloured, not faded`, () => {
      expect(t.css).not.toMatch(/\.soft \{[^}]*opacity/);
      expect(t.css).not.toMatch(/\.cite \{[^}]*opacity/);
      expect(t.css).toContain('.reveal a { color: var(--accent); }');
      expect(t.css).toMatch(/\.reveal \.meta \{[^}]*color/);
      expect(t.css).toMatch(/\.reveal \.big \{[^}]*(color|font-family)/);
    });
  }
  it('aquarelle clips its washes without hiding overflowing slide content', () => {
    const css = themeById('aquarelle').css;
    expect(css).toMatch(/\.reveal \.slides > section \{[^}]*min-height: 100%/);
    expect(css).not.toMatch(/\.reveal \.slides > section \{[^}]*[^-]height: 100%/);
  });
  it('element templates use theme colours, not hard-coded light ones', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    expect(ELEMENT_TEMPLATES.callout.html(box)).toContain('color:var(--ink');
    expect(ELEMENT_TEMPLATES.callout.html(box)).toContain('background:var(--paper-2');
    expect(ELEMENT_TEMPLATES.outline.html(box)).toContain('var(--ink');
    const arrow = lineSvg(box, true);
    expect(arrow).toContain('stroke="currentColor"');
    expect(arrow).toContain('fill="currentColor"');
    expect(ELEMENT_TEMPLATES.table.html(box)).toContain('<th scope="col">');
    expect(ELEMENT_TEMPLATES.iframe.html(box)).toContain('title="Web embed"');
    expect(ELEMENT_TEMPLATES.image.html(box)).not.toContain('src=""');
  });
});
