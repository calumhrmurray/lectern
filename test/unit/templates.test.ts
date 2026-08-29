import { describe, expect, it } from 'vitest';
import { ELEMENT_TEMPLATES, SLIDE_LAYOUTS, lineSvg, starterDeckHtml, updateLineSvg } from '../../src/deck/templates';
import { DeckDocument } from '../../src/deck/DeckDocument';

describe('templates', () => {
  it('every slide layout is a single section', () => {
    for (const l of SLIDE_LAYOUTS) {
      const t = document.createElement('template');
      t.innerHTML = l.html({ width: 1280, height: 720 });
      expect(t.content.children.length, l.id).toBe(1);
      expect(t.content.firstElementChild!.tagName.toLowerCase()).toBe('section');
    }
  });
  it('every element template produces one positioned element', () => {
    for (const tpl of Object.values(ELEMENT_TEMPLATES)) {
      const t = document.createElement('template');
      t.innerHTML = tpl.html({ x: 10, y: 20, w: 300, h: 100 });
      expect(t.content.children.length, tpl.id).toBe(1);
      const el = t.content.firstElementChild as HTMLElement;
      expect(el.getAttribute('style')).toContain('position:absolute');
      expect(el.getAttribute('style')).toContain('left:10px');
    }
  });
  it('line svg updates its geometry on resize', () => {
    const t = document.createElement('template');
    t.innerHTML = lineSvg({ x: 0, y: 0, w: 200, h: 10 }, true);
    const svg = t.content.firstElementChild as unknown as SVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 10');
    (svg as unknown as HTMLElement).style.width = '400px';
    (svg as unknown as HTMLElement).style.height = '20px';
    updateLineSvg(svg);
    expect(svg.getAttribute('viewBox')).toBe('0 0 400 20');
    expect(svg.querySelector('line')!.getAttribute('x2')).toBe('388');
    expect(svg.querySelector('polygon')!.getAttribute('points')).toBe('386,3 400,10 386,17');
  });
  it('starter deck parses as a deck', () => {
    const html = starterDeckHtml({ title: 'My <talk>', author: 'Me', width: 1280, height: 720, revealPath: 'reveal' });
    const d = new DeckDocument(html);
    expect(d.length).toBe(2);
    expect(d.info).toEqual({ title: 'My <talk>', width: 1280, height: 720, kind: 'reveal' });
    expect(html).toContain('reveal/dist/reveal.js');
  });
});
