import { describe, expect, it } from 'vitest';
import { DeckDocument, reindent } from '../../src/deck/DeckDocument';
import { History } from '../../src/deck/history';

const DECK = `<!doctype html>
<html>
<head><title>My deck</title></head>
<body>
  <div class="reveal">
    <div class="slides">
      <!-- 1 · title -->
      <section class="title-slide">
        <h1>Hello</h1>
        <p class="meta">a &middot; b &amp; c</p>
      </section>

      <!-- 2 · bullets -->
      <section>
        <h2>Two</h2>
        <ul><li>one</li><li>two</li></ul>
      </section>

      <!-- 3 · image -->
      <section data-background-color="#000">
        <img src="fig.png" alt="fig">
      </section>
    </div>
  </div>
  <script>Reveal.initialize({ width: 1280, height: 720 });</script>
</body>
</html>`;

describe('DeckDocument', () => {
  it('loads slides and info', () => {
    const d = new DeckDocument(DECK);
    expect(d.length).toBe(3);
    expect(d.spliceable).toBe(true);
    expect(d.info).toEqual({ title: 'My deck', width: 1280, height: 720, kind: 'reveal' });
    expect(d.dirty).toBe(false);
  });

  it('round-trips byte-for-byte when nothing changed', () => {
    const d = new DeckDocument(DECK);
    expect(d.serialize()).toBe(DECK);
  });

  it('splices only the modified section, keeping entities elsewhere', () => {
    const d = new DeckDocument(DECK);
    d.slides[1].el.querySelector('h2')!.textContent = 'Deux';
    expect(d.dirty).toBe(true);
    const out = d.serialize();
    expect(out).toContain('<h2>Deux</h2>');
    // untouched slide keeps its original entity spelling
    expect(out).toContain('a &middot; b &amp; c');
    // comments preserved
    expect(out).toContain('<!-- 2 · bullets -->');
    expect(out).toContain('<!-- 3 · image -->');
    // rest of the file intact
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('Reveal.initialize({ width: 1280, height: 720 });');
  });

  it('moves the lead comment with a reordered slide', () => {
    const d = new DeckDocument(DECK);
    d.moveSlide(2, 0);
    const out = d.serialize();
    const i3 = out.indexOf('<!-- 3 · image -->');
    const i1 = out.indexOf('<!-- 1 · title -->');
    const i2 = out.indexOf('<!-- 2 · bullets -->');
    expect(i3).toBeLessThan(i1);
    expect(i1).toBeLessThan(i2);
    // the image slide follows its comment
    expect(out.indexOf('data-background-color="#000"')).toBeGreaterThan(i3);
    expect(out.indexOf('data-background-color="#000"')).toBeLessThan(i1);
    // and the original bytes are reused for unmodified bodies
    expect(out).toContain('a &middot; b &amp; c');
  });

  it('inserts a new slide with the deck indentation', () => {
    const d = new DeckDocument(DECK);
    d.insertSlide(1, '<section>\n  <h2>New</h2>\n</section>');
    expect(d.length).toBe(4);
    const out = d.serialize();
    expect(out).toContain('\n\n      <section>\n        <h2>New</h2>\n      </section>');
    // reload round-trips
    const d2 = new DeckDocument(out);
    expect(d2.length).toBe(4);
    expect(d2.slides[1].el.textContent!.trim()).toBe('New');
    expect(d2.serialize()).toBe(out);
  });

  it('removes a slide together with its lead comment', () => {
    const d = new DeckDocument(DECK);
    d.removeSlide(1);
    const out = d.serialize();
    expect(out).not.toContain('<!-- 2 · bullets -->');
    expect(out).not.toContain('<h2>Two</h2>');
    expect(out).toContain('<!-- 1 · title -->');
    expect(out).toContain('<!-- 3 · image -->');
    expect(new DeckDocument(out).length).toBe(2);
  });

  it('replaces a slide from source', () => {
    const d = new DeckDocument(DECK);
    d.replaceSlide(0, '<section id="x"><h1>Replaced</h1></section>');
    expect(d.slides[0].el.id).toBe('x');
    expect(d.serialize()).toContain('<section id="x"><h1>Replaced</h1></section>');
  });

  it('rejects non-section html', () => {
    const d = new DeckDocument(DECK);
    expect(() => d.insertSlide(0, '<div>nope</div>')).toThrow();
    expect(() => d.insertSlide(0, '<section></section><section></section>')).toThrow();
  });

  it('snapshots and restores a section', () => {
    const d = new DeckDocument(DECK);
    const before = d.snapshotSection(1);
    d.slides[1].el.querySelector('h2')!.textContent = 'Changed';
    const after = d.snapshotSection(1);
    d.restore(before);
    expect(d.slides[1].el.querySelector('h2')!.textContent).toBe('Two');
    expect(d.dirty).toBe(false);
    d.restore(after);
    expect(d.slides[1].el.querySelector('h2')!.textContent).toBe('Changed');
    expect(d.dirty).toBe(true);
  });

  it('snapshots and restores the deck, preserving identity', () => {
    const d = new DeckDocument(DECK);
    const before = d.snapshotDeck();
    d.removeSlide(0);
    d.insertSlide(0, '<section><p>N</p></section>');
    expect(d.dirty).toBe(true);
    d.restore(before);
    expect(d.length).toBe(3);
    expect(d.dirty).toBe(false);
    expect(d.serialize()).toBe(DECK);
  });

  it('rebases after a save so undo still splices correctly', () => {
    const d = new DeckDocument(DECK);
    const before = d.snapshotSection(1);
    d.slides[1].el.querySelector('h2')!.textContent = 'Deux';
    const saved = d.serialize();
    d.rebase(new Map([[0, saved]]));
    expect(d.dirty).toBe(false);
    expect(d.serialize()).toBe(saved);
    // undo the edit after saving: now the file differs again
    d.restore(before);
    expect(d.dirty).toBe(true);
    const out = d.serialize();
    expect(out).toContain('<h2>Two</h2>');
    expect(out).toContain('<!-- 2 · bullets -->');
    expect(out).toContain('a &middot; b &amp; c');
    expect(new DeckDocument(out).serialize()).toBe(out);
  });

  it('keeps the same uid when a slide is replaced from source', () => {
    const d = new DeckDocument(DECK);
    const uid = d.slides[0].uid;
    d.replaceSlide(0, '<section><h1>R</h1></section>');
    expect(d.slides[0].uid).toBe(uid);
    expect(d.dirty).toBe(true);
  });

  it('handles a container with no slides', () => {
    const empty = '<html><body><div class="reveal"><div class="slides">\n  </div></div></body></html>';
    const d = new DeckDocument(empty);
    expect(d.length).toBe(0);
    d.insertSlide(0, '<section><h1>A</h1></section>');
    const out = d.serialize();
    expect(out).toContain('<section><h1>A</h1></section>');
    expect(new DeckDocument(out).length).toBe(1);
  });

  it('falls back to rebuilding when the DOM disagrees with the scan', () => {
    // A non-section child in the container makes the DOM/scan mismatch.
    const odd = '<html><body><div class="slides"><div class="x"></div><section><p>a</p></section></div></body></html>';
    const d = new DeckDocument(odd);
    expect(d.spliceable).toBe(false);
    d.slides[0].el.querySelector('p')!.textContent = 'b';
    const out = d.serialize();
    expect(out).toContain('<p>b</p>');
    expect(new DeckDocument(out).length).toBe(1);
  });
});

const SHELL = `<!doctype html>
<html><head><title>Parts</title></head>
<body>
  <div class="reveal">
    <div class="slides"><!-- fragments injected here --></div>
  </div>
  <script>
    const parts = [
      'slides/a.html',
      'slides/b.html',
    ];
    Reveal.initialize({ width: 1280, height: 720 });
  </script>
</body>
</html>`;
const PART_A = `<!-- A1 -->
<section>
  <h2>A one</h2>
</section>

<!-- A2 -->
<section>
  <h2>A two</h2>
</section>
`;
const PART_B = `<!-- B1 -->
<section class="b">
  <h2>B one</h2>
</section>
`;

describe('multi-file decks', () => {
  const load = () => new DeckDocument(SHELL, { path: 'session1.html', parts: [{ path: 'slides/a.html', text: PART_A }, { path: 'slides/b.html', text: PART_B }] });

  it('collects sections from every part in order', () => {
    const d = load();
    expect(d.isMultiFile).toBe(true);
    expect(d.length).toBe(3);
    expect(d.slides.map((s) => s.source)).toEqual([1, 1, 2]);
    expect(d.dirty).toBe(false);
    expect(d.dirtySources()).toEqual([]);
    expect(d.serializeSource(0)).toBe(SHELL);
    expect(d.serializeSource(1)).toBe(PART_A);
    expect(d.serializeSource(2)).toBe(PART_B);
  });

  it('writes an edit back to the right part only', () => {
    const d = load();
    d.slides[2].el.querySelector('h2')!.textContent = 'B uno';
    expect(d.dirtySources()).toEqual([2]);
    expect(d.serializeSource(1)).toBe(PART_A);
    const b = d.serializeSource(2);
    expect(b).toBe('<!-- B1 -->\n<section class="b">\n  <h2>B uno</h2>\n</section>\n');
  });

  it('inserts a new slide into its neighbour\'s file', () => {
    const d = load();
    d.insertSlide(1, '<section><p>new</p></section>');
    expect(d.slides[1].source).toBe(1);
    expect(d.dirtySources()).toEqual([1]);
    const a = d.serializeSource(1);
    expect(a).toContain('<!-- A1 -->\n<section>\n  <h2>A one</h2>\n</section>\n\n<section><p>new</p></section>\n\n<!-- A2 -->');
    d.insertSlide(4, '<section><p>tail</p></section>');
    expect(d.slides[4].source).toBe(2);
  });

  it('moves a slide across files, carrying its comment', () => {
    const d = load();
    d.moveSlide(2, 0); // B1 to the front → joins file A
    expect(d.slides[0].source).toBe(1);
    expect(d.dirtySources().sort()).toEqual([1, 2]);
    expect(d.serializeSource(1).startsWith('<!-- B1 -->\n<section class="b">')).toBe(true);
    expect(d.serializeSource(2).trim()).toBe('');
  });

  it('round-trips through rebase and undo', () => {
    const d = load();
    const before = d.snapshotDeck();
    d.moveSlide(0, 2);
    const saved = new Map(d.dirtySources().map((i) => [i, d.serializeSource(i)] as [number, string]));
    d.rebase(saved);
    expect(d.dirty).toBe(false);
    d.restore(before);
    expect(d.slides.map((s) => s.source)).toEqual([1, 1, 2]);
    expect(d.dirtySources().sort()).toEqual([1, 2]);
    expect(d.serializeSource(1)).toContain('<!-- A1 -->');
  });
});

describe('reindent', () => {
  it('shifts a block to the target indent', () => {
    const html = '<section>\n  <h2>x</h2>\n</section>';
    expect(reindent(html, '    ')).toBe('<section>\n      <h2>x</h2>\n    </section>');
  });
  it('leaves single-line html alone', () => {
    expect(reindent('<section><p>x</p></section>', '  ')).toBe('<section><p>x</p></section>');
  });
});

describe('History', () => {
  it('tracks undo and redo', () => {
    const h = new History();
    const d = new DeckDocument(DECK);
    const before = d.snapshotSection(0);
    d.slides[0].el.querySelector('h1')!.textContent = 'Bye';
    const after = d.snapshotSection(0);
    h.push({ label: 'Edit text', before, after });
    expect(h.canUndo).toBe(true);
    expect(h.undoLabel).toBe('Edit text');
    const e = h.undo()!;
    d.restore(e.before);
    expect(d.slides[0].el.querySelector('h1')!.textContent).toBe('Hello');
    expect(h.canRedo).toBe(true);
    const r = h.redo()!;
    d.restore(r.after);
    expect(d.slides[0].el.querySelector('h1')!.textContent).toBe('Bye');
    expect(h.canRedo).toBe(false);
  });
  it('clears redo on new push and respects the limit', () => {
    const h = new History(2);
    const snap = { kind: 'deck' as const, sections: [] };
    h.push({ label: 'a', before: snap, after: snap });
    h.push({ label: 'b', before: snap, after: snap });
    h.push({ label: 'c', before: snap, after: snap });
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push({ label: 'd', before: snap, after: snap });
    expect(h.canRedo).toBe(false);
    h.undo(); h.undo();
    expect(h.canUndo).toBe(false);
  });
});

describe('plain decks', () => {
  it('detects the kind and edits sections in a custom container', () => {
    const html = '<html><head><title>P</title></head><body><div id="deck">\n  <section class="slide"><h1>a</h1></section>\n  <section class="slide"><h1>b</h1></section>\n</div><script>custom()</script></body></html>';
    const d = new DeckDocument(html);
    expect(d.info.kind).toBe('plain');
    expect(d.info.width).toBe(1280);
    expect(d.length).toBe(2);
    d.slides[1].el.querySelector('h1')!.textContent = 'c';
    const out = d.serialize();
    expect(out).toContain('<section class="slide"><h1>c</h1></section>');
    expect(out).toContain('<script>custom()</script>');
    expect(new DeckDocument('<div class="reveal"><div class="slides"><section></section></div></div><script>Reveal.initialize({})</script>').info.kind).toBe('reveal');
  });
});
