import { describe, expect, it } from 'vitest';
import { detectParts, inferIndent, scanDeck, scanFragment, scanRevealSize, tokenize } from '../../src/deck/scan';

const DECK = `<!doctype html>
<html>
<head><title>T</title><style>.x > section { color: red }</style></head>
<body>
  <div class="reveal">
    <div class="slides">
      <!-- ===== 1 · title ===== -->
      <section class="title-slide">
        <h1>Hello</h1>
        <p class="meta">a &middot; b</p>
      </section>

      <!-- 2 -->
      <section data-background-image="figures/x.jpg">
        <img src="a.png" alt="a > b">
        <script>if (a < b && c > d) { document.write('<section>not a slide</section>'); }</script>
      </section>
      <section>
        <section><h2>vertical 1</h2></section>
        <section><h2>vertical 2</h2></section>
      </section>
    </div>
  </div>
  <script>
    Reveal.initialize({ width: 1280, height: 720, hash: true });
  </script>
</body>
</html>`;

describe('tokenize', () => {
  it('handles quoted attributes containing >', () => {
    const toks = Array.from(tokenize('<img src="a.png" alt="a > b"><p>x</p>'));
    expect(toks[0].kind).toBe('open');
    expect(toks[0].attrs.get('alt')).toBe('a > b');
    expect(toks[1].name).toBe('p');
  });
  it('treats script content as raw text', () => {
    const toks = Array.from(tokenize('<script>var s = "<section>";</script><section></section>'));
    const names = toks.filter((t) => t.kind === 'open').map((t) => t.name);
    expect(names).toEqual(['script', 'section']);
  });
  it('emits comments', () => {
    const toks = Array.from(tokenize('<!-- hi <section> --><section></section>'));
    expect(toks[0].kind).toBe('comment');
    expect(toks[1].kind).toBe('open');
  });
  it('parses self-closing and unquoted attributes', () => {
    const toks = Array.from(tokenize('<br/><input disabled value=abc><section>'));
    expect(toks[0].selfClosing).toBe(true);
    expect(toks[1].attrs.get('disabled')).toBe('');
    expect(toks[1].attrs.get('value')).toBe('abc');
    expect(toks[2].name).toBe('section');
  });
});

describe('scanDeck', () => {
  it('finds the container and top-level sections', () => {
    const r = scanDeck(DECK)!;
    expect(r).not.toBeNull();
    expect(r.sections).toHaveLength(3);
    const bodies = r.sections.map((s) => DECK.slice(s.body.start, s.body.end));
    expect(bodies[0].startsWith('<section class="title-slide">')).toBe(true);
    expect(bodies[0].endsWith('</section>')).toBe(true);
    expect(bodies[1]).toContain('<script>');
    expect(bodies[2]).toContain('vertical 2');
    expect(bodies[2].endsWith('</section>\n      </section>')).toBe(true);
  });
  it('attaches leading comments to the following section', () => {
    const r = scanDeck(DECK)!;
    const lead0 = DECK.slice(r.sections[0].lead.start, r.sections[0].lead.end);
    expect(lead0).toContain('<!-- ===== 1 · title ===== -->');
    const lead1 = DECK.slice(r.sections[1].lead.start, r.sections[1].lead.end);
    expect(lead1.trim()).toBe('<!-- 2 -->');
  });
  it('locates the container end', () => {
    const r = scanDeck(DECK)!;
    expect(DECK.slice(r.contentEnd, r.contentEnd + 6)).toBe('</div>');
    expect(DECK.slice(r.trailing.start, r.trailing.end)).toBe('\n    ');
  });
  it('returns null without a slides container', () => {
    expect(scanDeck('<html><body><p>no</p></body></html>')).toBeNull();
  });
  it('handles an empty container', () => {
    const r = scanDeck('<div class="reveal"><div class="slides"></div></div>')!;
    expect(r.sections).toHaveLength(0);
    expect(r.contentStart).toBe(r.contentEnd);
  });
});

describe('helpers', () => {
  it('reads the reveal size', () => {
    expect(scanRevealSize(DECK)).toEqual({ width: 1280, height: 720 });
    expect(scanRevealSize('Reveal.initialize({ hash: true })')).toEqual({});
  });
  it('infers the section indentation', () => {
    expect(inferIndent(DECK, scanDeck(DECK)!)).toBe('      ');
  });
});

describe('multi-file helpers', () => {
  it('scans a fragment of sections', () => {
    const r = scanFragment('<!-- a -->\n<section><p>1</p></section>\n<section><p>2</p></section>\n');
    expect(r.sections).toHaveLength(2);
    expect(r.contentStart).toBe(0);
    expect(r.sections[0].lead.start).toBe(0);
  });
  it('detects parts from a script array', () => {
    expect(detectParts(DECK)).toEqual([]);
    expect(detectParts("<script>const parts = [\n 'slides/s1/p0.html', \"slides/s1/p1.html\",\n];</script>")).toEqual(['slides/s1/p0.html', 'slides/s1/p1.html']);
  });
  it('detects parts from a data attribute', () => {
    expect(detectParts('<div class="slides" data-parts="a.html, b.html"></div>')).toEqual(['a.html', 'b.html']);
  });
});
