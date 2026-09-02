import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deckToMarkdown, markdownToDeck, sectionToMarkdown, splitFrontMatter, parseYaml, inlineHtml, findSlidesDiv } from '../../src/deck/markdown';
import { parseHtml } from '../../src/deck/markdownParse5';
import { starterDeckHtml } from '../../src/deck/templates';

const DECKS = [
  'src/demo/index.html',
  'public/examples/whale-evolution/index.html',
  'public/examples/naturalisation-fr/index.html',
];

describe('deck ⇄ markdown round trip', () => {
  for (const file of DECKS) {
    it(`${file}: unchanged markdown keeps every slide byte-identical`, () => {
      const html = readFileSync(file, 'utf8');
      const md = deckToMarkdown(html, parseHtml);
      const back = markdownToDeck(md, { existing: html, parse: parseHtml });
      expect(back.reused).toBe(back.slides);
      // whitespace between slides may be normalised; the slides themselves must not move a byte
      expect(back.html.replace(/\n{3,}/g, '\n\n')).toBe(html.replace(/\n{3,}/g, '\n\n'));
    });
    it(`${file}: regenerating every slide is idempotent (md → html → md is a fixed point)`, () => {
      const html = readFileSync(file, 'utf8');
      const md = deckToMarkdown(html, parseHtml);
      // defeat byte-reuse so every slide is rebuilt from markdown
      const rebuilt = markdownToDeck(md, { existing: html.replace(/ class="slides"/, ' class="slides" data-x="1"'), parse: parseHtml });
      expect(deckToMarkdown(rebuilt.html, parseHtml)).toBe(md);
    });
  }

  for (const file of DECKS) {
    it(`${file.replace('index.html', 'index.qmd')} is the current export of the deck (regenerate with \`lectern convert\`)`, () => {
      const html = readFileSync(file, 'utf8');
      expect(readFileSync(file.replace('index.html', 'index.qmd'), 'utf8')).toBe(deckToMarkdown(html, parseHtml));
    });
  }

  it('a starter deck becomes front matter and comes back byte-identical', () => {
    const html = starterDeckHtml({ title: 'Talk title', author: 'Author', width: 1280, height: 720, revealPath: 'reveal', theme: 'paper' });
    const md = deckToMarkdown(html, parseHtml);
    expect(md).toContain('title: "Talk title"');
    expect(md).toContain('width: 1280');
    expect(md).toContain('css: "theme.css"');
    expect(md).not.toContain('title-slide'); // the title slide lives in the front matter, not as a heading
    const back = markdownToDeck(md, { existing: html, parse: parseHtml });
    expect(back.html).toBe(html);
  });
});

describe('deckToMarkdown', () => {
  const wrap = (slides: string) => `<!doctype html><html><head><title>T</title></head><body><div class="reveal"><div class="slides">\n${slides}\n</div></div></body></html>`;

  it('writes the vocabulary as markdown and keeps the rest as HTML islands', () => {
    const md = deckToMarkdown(wrap(`
      <section data-background-color="#123456" data-ref="Smith 2020">
        <div class="kicker">Intro</div>
        <h2>A heading.</h2>
        <ul><li>one</li><li>two <strong>bold</strong> <span class="accent">red</span></li></ul>
        <svg viewBox="0 0 10 10" style="position:absolute;left:1px;top:2px;"><rect width="5" height="5"/></svg>
        <aside class="notes">Say hi.</aside>
      </section>`), parseHtml);
    expect(md).toContain('## A heading. {background-color="#123456" data-ref="Smith 2020"}');
    expect(md).toContain('::: {.kicker}\nIntro\n:::');
    expect(md).toContain('- two **bold** [red]{.accent}');
    expect(md).toContain('<svg viewBox="0 0 10 10"');
    expect(md).toContain('::: {.notes}\nSay hi.\n:::');
  });

  it('turns \\(…\\) into $…$ and leaves TeX un-escaped', () => {
    const md = deckToMarkdown(wrap('<section><h2>M</h2><p>Inline \\( \\gamma_{\\rm IA} \\) and $x_1$ and a literal *star*.</p></section>'), parseHtml);
    expect(md).toContain('Inline $\\gamma_{\\rm IA}$ and $x_1$ and a literal \\*star\\*.');
  });

  it('pairs a figure with its caption', () => {
    const md = deckToMarkdown(wrap('<section><h2>F</h2><img class="fig" src="a.png" alt="Alt text" style="width:480px"><p class="caption">Figure 1.</p></section>'), parseHtml);
    expect(md).toContain('![Figure 1.](a.png){.fig fig-alt="Alt text" width=480}');
  });

  it('a list with a lone fragment item stays HTML; an all-fragment list becomes incremental', () => {
    const mixed = deckToMarkdown(wrap('<section><h2>A</h2><ul><li>x</li><li class="fragment">y</li></ul></section>'), parseHtml);
    expect(mixed).toContain('<li class="fragment">y</li>');
    const all = deckToMarkdown(wrap('<section><h2>A</h2><ul><li class="fragment">x</li><li class="fragment">y</li></ul></section>'), parseHtml);
    expect(all).toContain('::: {.incremental}\n- x\n- y\n:::');
  });
});

describe('markdownToDeck', () => {
  const existing = starterDeckHtml({ title: 'T', author: '', width: 1280, height: 720, revealPath: 'reveal', theme: 'paper' });
  const make = (md: string) => markdownToDeck(md, { existing, parse: parseHtml }).html;

  it('builds slides from headings, hoists the kicker, maps slide attributes', () => {
    const html = make('---\ntitle: "T"\n---\n\n## One thing. {background-color="#eee" transition="fade"}\n\n::: {.kicker}\nIntro\n:::\n\nHello *there*.\n');
    expect(html).toContain('<section data-background-color="#eee" data-transition="fade">');
    expect(html).toMatch(/<div class="kicker">Intro<\/div>\s*<h2>One thing\.<\/h2>/);
    expect(html).toContain('<p>Hello <em>there</em>.</p>');
  });

  it('columns, incremental lists, notes, code and tables', () => {
    const html = make(`---
title: "T"
---

## S

::: {.columns}
::: {.column width="50%"}
- a
- b
:::
::: {.column width="50%"}
![Cap.](f.png){width=300}
:::
:::

::: {.incremental}
- one
- two
:::

| h1 | h2 |
| --- | --- |
| a | b |

\`\`\`python
x = 1
\`\`\`

::: {.notes}
A note.
:::
`);
    expect(html).toContain('<div class="cols">');
    expect(html).toMatch(/<div class="col">\s*<ul>\s*<li>a<\/li>/);
    expect(html).toContain('<img src="f.png" alt="Cap." style="width:300px;">');
    expect(html).toContain('<p class="caption">Cap.</p>');
    expect(html).toContain('<li class="fragment">one</li>');
    expect(html).toMatch(/<th>h1<\/th>/);
    expect(html).toContain('<pre><code class="language-python">x = 1</code></pre>');
    expect(html).toContain('<aside class="notes">A note.</aside>');
  });

  it('raw HTML islands land verbatim, re-indented to the slide', () => {
    const html = make('---\ntitle: "T"\n---\n\n## S\n\n<div style="position:absolute;left:10px;top:20px;width:30px;">box</div>\n');
    expect(html).toContain('<div style="position:absolute;left:10px;top:20px;width:30px;">box</div>');
  });

  it('# with .break makes a break slide; a stack div makes a vertical stack', () => {
    const html = make('---\ntitle: "T"\n---\n\n# Part one {.break}\n\n::: {.stack}\n\n## V1\n\na\n\n## V2\n\nb\n\n:::\n');
    expect(html).toContain('<section class="break">');
    expect(html).toContain('<p class="big">Part one</p>');
    expect(html).toMatch(/<section>\s*<section>\s*<h2>V1<\/h2>/);
  });

  it('the title slide comes from the front matter', () => {
    const html = make('---\ntitle: "My title"\nsubtitle: "Sub"\nauthor: "**Me**"\ndate: "Now"\n---\n\n## S\n\nx\n');
    expect(html).toContain('<section class="title-slide">');
    expect(html).toContain('<h1>My title</h1>');
    expect(html).toContain('<p class="sub">Sub</p>');
    expect(html).toContain('<p class="meta"><b>Me</b><br>Now</p>');
    expect(html).toContain('<title>My title</title>');
  });

  it('keeps $ math and unescapes pandoc escapes', () => {
    const html = make('---\ntitle: "T"\n---\n\n## S\n\nMath $\\gamma < 1$ and \\*literal\\*.\n');
    expect(html).toContain('Math $\\gamma &lt; 1$ and *literal*.');
  });
});

describe('markdown internals', () => {
  it('splitFrontMatter + parseYaml read a Quarto header', () => {
    const { meta } = splitFrontMatter('---\ntitle: "A"\nformat:\n  revealjs:\n    width: 1920\n    css:\n      - a.css\n      - b.css\n---\nbody');
    expect(meta.title).toBe('A');
    const fmt = (meta.format as Record<string, unknown>).revealjs as Record<string, unknown>;
    expect(fmt.width).toBe(1920);
    expect(fmt.css).toEqual(['a.css', 'b.css']);
    expect(parseYaml('a: 1\nb: true')).toEqual({ a: 1, b: true });
  });

  it('inlineHtml covers links, spans, breaks and code', () => {
    expect(inlineHtml('a [link](http://x/) and [red]{.accent} and `c<d`')).toBe('a <a href="http://x/">link</a> and <span class="accent">red</span> and <code>c&lt;d</code>');
    expect(inlineHtml('line\\\nbreak')).toBe('line<br>break');
  });

  it('sectionToMarkdown works on a parsed section', () => {
    const html = '<!doctype html><div class="slides"><section><h2>Hi</h2><p>x</p></section></div>';
    const div = findSlidesDiv(parseHtml(html))!;
    const section = div.children.find((c) => c.type === 'element')!;
    expect(sectionToMarkdown(section as never, html)).toBe('## Hi\n\nx');
  });
});
