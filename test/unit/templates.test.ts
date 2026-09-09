import { describe, expect, it } from 'vitest';
import { blankLike, ELEMENT_TEMPLATES, SLIDE_LAYOUTS, lineSvg, starterDeckHtml, updateLineSvg } from '../../src/deck/templates';
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

describe('blankLike', () => {
  const parse = (html: string): Element => {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild!;
  };

  it('keeps the frame and drops the cargo', () => {
    const src = parse(`<section class="plate-slide" id="s3" data-section="Ices" data-visibility="hidden">
      <canvas class="sea" width="1280" height="96"></canvas>
      <div class="kicker">theme 3 — the method</div>
      <h2>Use the stars behind the cloud as lamps.</h2>
      <div class="body"><div class="cols"><div class="col"><ul><li>Ice bands are absorption.</li></ul></div>
      <div class="col"><img src="fig/ices.png" alt="ices"></div></div></div>
      <p class="cite">Bock et al. 2025, Figure 4.</p>
      <div hidden data-ai-note=""><p data-by="author">add a scale</p></div>
      <aside class="notes">Say it slowly.</aside>
    </section>`);
    const out = parse(blankLike(src));

    // the frame survives
    expect(out.className).toBe('plate-slide');
    expect(out.querySelector('canvas.sea')).not.toBeNull();
    expect(out.querySelectorAll('.body .cols .col').length).toBe(2);
    // the cargo does not
    expect(out.id).toBe('');
    expect(out.hasAttribute('data-section')).toBe(false);
    expect(out.hasAttribute('data-visibility')).toBe(false);
    expect(out.querySelector('img')).toBeNull();
    expect(out.querySelector('[data-ai-note]')).toBeNull();
    expect(out.querySelector('.cite')).toBeNull();
    expect(out.querySelector('aside.notes')!.textContent).toBe('');
    // text becomes placeholders
    expect(out.querySelector('h2')!.textContent).toBe('Heading');
    expect(out.querySelector('.kicker')!.textContent).toBe('Kicker');
    expect(out.querySelector('li')!.textContent).toBe('Point');
  });

  it('models a stack on its last sub-slide, and returns a plain slide', () => {
    const src = parse(`<section data-section="How it works">
      <section><h2>One</h2></section>
      <section class="wide"><canvas class="sea"></canvas><h2>Two</h2></section>
    </section>`);
    const out = parse(blankLike(src));
    expect(out.querySelectorAll('section').length).toBe(0);
    expect(out.className).toBe('wide');
    expect(out.querySelector('canvas.sea')).not.toBeNull();
    expect(out.querySelector('h2')!.textContent).toBe('Heading');
  });

  it('is a single section, like every other layout', () => {
    const src = parse('<section><h2>Hi</h2></section>');
    const t = document.createElement('template');
    t.innerHTML = blankLike(src);
    expect(t.content.children.length).toBe(1);
    expect(t.content.firstElementChild!.tagName.toLowerCase()).toBe('section');
  });
});
