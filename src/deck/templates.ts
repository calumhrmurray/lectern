/**
 * HTML templates for new slides, new elements, and a starter deck.
 *
 * Templates use plain semantic HTML (h1/h2/p/ul/img) so that whatever theme
 * the deck uses styles them the same way it styles hand-written slides. New
 * free-floating objects get an inline `position:absolute` box.
 */

import { escapeHtml } from './html';

export interface SlideLayout {
  id: string;
  name: string;
  /** Simple textual preview for the menu. */
  hint: string;
  html: (ctx: { width: number; height: number }) => string;
}

export const SLIDE_LAYOUTS: SlideLayout[] = [
  {
    id: 'blank', name: 'Blank', hint: '',
    html: () => `<section>\n</section>`,
  },
  {
    id: 'title', name: 'Title', hint: 'Title + subtitle',
    html: () => `<section class="title-slide">\n  <h1>Title</h1>\n  <p class="sub">Subtitle</p>\n</section>`,
  },
  {
    id: 'title-bullets', name: 'Title & bullets', hint: 'Heading + list',
    html: () => `<section>\n  <h2>Heading</h2>\n  <ul>\n    <li>First point</li>\n    <li>Second point</li>\n    <li>Third point</li>\n  </ul>\n</section>`,
  },
  {
    id: 'title-text', name: 'Title & text', hint: 'Heading + paragraph',
    html: () => `<section>\n  <h2>Heading</h2>\n  <p>Text.</p>\n</section>`,
  },
  {
    id: 'two-cols', name: 'Two columns', hint: 'Heading + two columns',
    html: () => `<section>\n  <h2>Heading</h2>\n  <div class="cols" style="display:flex;gap:40px;align-items:flex-start;">\n    <div class="col" style="flex:1;min-width:0;">\n      <ul>\n        <li>Left</li>\n      </ul>\n    </div>\n    <div class="col" style="flex:1;min-width:0;">\n      <ul>\n        <li>Right</li>\n      </ul>\n    </div>\n  </div>\n</section>`,
  },
  {
    id: 'section', name: 'Section break', hint: 'Big statement',
    html: () => `<section class="break">\n  <p class="big">A statement.</p>\n  <p class="sub">Supporting line.</p>\n</section>`,
  },
  {
    id: 'image', name: 'Heading & image', hint: 'Heading + figure',
    html: () => `<section>\n  <h2>Heading</h2>\n  <img class="fig" src="" alt="" style="max-width:100%;max-height:70%;">\n</section>`,
  },
];

export interface ElementTemplate {
  id: string;
  name: string;
  html: (box: { x: number; y: number; w: number; h: number }) => string;
}

function boxStyle(b: { x: number; y: number; w: number; h?: number }, extra = ''): string {
  const h = b.h !== undefined ? `height:${Math.round(b.h)}px;` : '';
  return `position:absolute;left:${Math.round(b.x)}px;top:${Math.round(b.y)}px;width:${Math.round(b.w)}px;${h}${extra}`;
}

export const ELEMENT_TEMPLATES: Record<string, ElementTemplate> = {
  text: {
    id: 'text', name: 'Text',
    html: (b) => `<p style="${boxStyle({ ...b, h: undefined }, 'margin:0;')}">Text</p>`,
  },
  title: {
    id: 'title', name: 'Title',
    html: (b) => `<h2 style="${boxStyle({ ...b, h: undefined }, 'margin:0;')}">Title</h2>`,
  },
  bullets: {
    id: 'bullets', name: 'Bullets',
    html: (b) => `<ul style="${boxStyle({ ...b, h: undefined }, 'margin:0;')}">\n  <li>First point</li>\n  <li>Second point</li>\n</ul>`,
  },
  image: {
    id: 'image', name: 'Image',
    html: (b) => `<img src="" alt="" style="${boxStyle({ ...b, h: undefined })}">`,
  },
  rect: {
    id: 'rect', name: 'Rectangle',
    html: (b) => `<div style="${boxStyle(b, 'background:#4a7bd0;border-radius:4px;')}"></div>`,
  },
  'rounded-rect': {
    id: 'rounded-rect', name: 'Rounded rectangle',
    html: (b) => `<div style="${boxStyle(b, 'background:#4a7bd0;border-radius:24px;')}"></div>`,
  },
  ellipse: {
    id: 'ellipse', name: 'Ellipse',
    html: (b) => `<div style="${boxStyle(b, 'background:#4a7bd0;border-radius:50%;')}"></div>`,
  },
  outline: {
    id: 'outline', name: 'Outlined box',
    html: (b) => `<div style="${boxStyle(b, 'border:3px solid #333;border-radius:8px;')}"></div>`,
  },
  line: {
    id: 'line', name: 'Line',
    html: (b) => lineSvg({ ...b, h: Math.max(b.h, 2) }, false),
  },
  arrow: {
    id: 'arrow', name: 'Arrow',
    html: (b) => lineSvg({ ...b, h: Math.max(b.h, 2) }, true),
  },
  callout: {
    id: 'callout', name: 'Callout',
    html: (b) => `<div style="${boxStyle(b, 'background:#fff3c4;border:2px solid #e0b400;border-radius:8px;padding:12px 16px;font-size:0.6em;')}">Note</div>`,
  },
  table: {
    id: 'table', name: 'Table',
    html: (b) => `<table style="${boxStyle({ ...b, h: undefined })}">\n  <thead>\n    <tr><th>Column</th><th>Column</th><th>Column</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>Cell</td><td>Cell</td><td>Cell</td></tr>\n    <tr><td>Cell</td><td>Cell</td><td>Cell</td></tr>\n  </tbody>\n</table>`,
  },
  code: {
    id: 'code', name: 'Code',
    html: (b) => `<pre style="${boxStyle({ ...b, h: undefined })}"><code>// code</code></pre>`,
  },
  equation: {
    id: 'equation', name: 'Equation',
    html: (b) => `<p class="eq" style="${boxStyle({ ...b, h: undefined }, 'margin:0;text-align:center;')}">\\[ E = mc^2 \\]</p>`,
  },
  iframe: {
    id: 'iframe', name: 'Web embed',
    html: (b) => `<iframe src="https://example.com" style="${boxStyle(b, 'border:0;')}"></iframe>`,
  },
};

/** SVG line/arrow spanning the box diagonally-ish (horizontal by default). */
export function lineSvg(b: { x: number; y: number; w: number; h: number }, arrow: boolean, opts: { color?: string; width?: number } = {}): string {
  const color = opts.color ?? '#333';
  const sw = opts.width ?? 3;
  const w = Math.max(1, Math.round(b.w));
  const h = Math.max(1, Math.round(b.h));
  const y = Math.round(h / 2);
  const head = arrow ? `<polygon points="${w - 14},${y - 7} ${w},${y} ${w - 14},${y + 7}" fill="${color}"/>` : '';
  const lineEnd = arrow ? w - 12 : w;
  return `<svg data-shape="${arrow ? 'arrow' : 'line'}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="${boxStyle({ ...b, w, h }, 'overflow:visible;')}"><line x1="0" y1="${y}" x2="${lineEnd}" y2="${y}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>${head}</svg>`;
}

/** Re-generates the inner geometry of a line/arrow svg after a resize. */
export function updateLineSvg(svg: SVGElement): void {
  const w = Math.max(1, Math.round(parseFloat(svg.style.width) || Number(svg.getAttribute('width')) || 100));
  const h = Math.max(1, Math.round(parseFloat(svg.style.height) || Number(svg.getAttribute('height')) || 2));
  const line = svg.querySelector('line');
  const poly = svg.querySelector('polygon');
  const color = line?.getAttribute('stroke') ?? '#333';
  const sw = line?.getAttribute('stroke-width') ?? '3';
  const y = Math.round(h / 2);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  if (line) {
    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
    line.setAttribute('x2', String(poly ? w - 12 : w));
    line.setAttribute('stroke-width', sw);
  }
  if (poly) {
    poly.setAttribute('points', `${w - 14},${y - 7} ${w},${y} ${w - 14},${y + 7}`);
    poly.setAttribute('fill', color);
  }
}

// ---------------------------------------------------------------- starter deck

export const STARTER_THEME = `/* Deck theme. Edit freely — the editor exposes these classes as toggles. */
:root {
  --paper: #f5f2ea;
  --ink: #1d1f24;
  --ink-soft: #5a6070;
  --accent: #b5542a;
  --accent-2: #2b4a8b;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.reveal-viewport { background: var(--paper); }
.reveal { font-family: var(--sans); font-size: 30px; color: var(--ink); }
.reveal .slides { text-align: left; }
.reveal .slides section { padding: 24px 40px; }

.reveal h1, .reveal h2, .reveal h3 {
  font-family: var(--serif); font-weight: 600; letter-spacing: -0.01em; text-transform: none; color: var(--ink);
}
.reveal h1 { font-size: 2.4em; line-height: 1.06; }
.reveal h2 { font-size: 1.4em; line-height: 1.12; margin: 0 0 0.6em; }
.reveal p, .reveal li { font-size: 0.72em; line-height: 1.5; }
.reveal ul { margin: 0.2em 0 0.2em 1em; }
.reveal li { margin: 0.35em 0; }
.reveal strong { font-weight: 650; }
.reveal .kicker { font-size: 0.42em; text-transform: uppercase; letter-spacing: 0.22em; color: var(--accent); font-weight: 600; margin-bottom: 14px; }
.reveal .accent { color: var(--accent); font-weight: 600; }
.reveal .accent-2 { color: var(--accent-2); font-weight: 600; }
.reveal .soft { color: var(--ink-soft); }
.reveal .caption { font-size: 0.46em; color: var(--ink-soft); text-align: center; }
.reveal img.fig { background: #fff; padding: 8px; border-radius: 6px; box-shadow: 0 6px 26px rgba(0,0,0,.14); }

.reveal section.title-slide { padding-top: 140px; }
.reveal section.title-slide h1 { max-width: 20ch; }
.reveal section.title-slide .sub { font-family: var(--serif); font-style: italic; font-size: 0.95em; color: var(--ink-soft); margin-top: 0.5em; }
.reveal section.title-slide .meta { margin-top: 2em; font-size: 0.58em; color: var(--ink-soft); line-height: 1.7; }

.reveal section.break { padding-top: 180px; }
.reveal section.break .big { font-family: var(--serif); font-size: 1.9em; line-height: 1.16; max-width: 22ch; }
.reveal section.break .sub { font-size: 0.72em; color: var(--ink-soft); margin-top: 0.8em; }
`;

export function starterDeckHtml(opts: { title: string; author?: string; width: number; height: number; revealPath: string }): string {
  const title = escapeHtml(opts.title);
  const author = escapeHtml(opts.author ?? '');
  const r = opts.revealPath.replace(/\/$/, '');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="${r}/dist/reset.css">
  <link rel="stylesheet" href="${r}/dist/reveal.css">
  <link rel="stylesheet" href="theme.css">
</head>
<body>
  <div class="reveal">
    <div class="slides">

      <!-- 1 · title -->
      <section class="title-slide">
        <h1>${title}</h1>
        <p class="sub">A subtitle</p>
        <p class="meta"><b>${author || 'Your name'}</b><br>Occasion · Date</p>
      </section>

      <!-- 2 · first slide -->
      <section>
        <div class="kicker">Introduction</div>
        <h2>A heading that says one thing.</h2>
        <ul>
          <li>Double-click any text to edit it</li>
          <li>Drag things around; guides snap to the slide and to other objects</li>
          <li>Press <strong>⌘S</strong> to save straight back into this HTML file</li>
        </ul>
      </section>

    </div>
  </div>

  <script src="${r}/dist/reveal.js"></script>
  <script src="${r}/plugin/math/math.js"></script>
  <script src="${r}/plugin/notes/notes.js"></script>
  <script src="${r}/plugin/highlight/highlight.js"></script>
  <script>
    Reveal.initialize({
      width: ${opts.width}, height: ${opts.height}, margin: 0.04,
      center: false, hash: true, transition: 'none',
      controls: false, progress: true, slideNumber: 'c/t',
      plugins: [ RevealMath.KaTeX, RevealNotes, RevealHighlight ],
    });
  </script>
</body>
</html>
`;
}
