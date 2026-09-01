/**
 * Built-in deck themes offered by "New deck…". Each theme is a self-contained
 * stylesheet using the same class vocabulary (`.kicker`, `.accent`, `.soft`,
 * `.caption`, `.fig`, `.card`, `.cols/.col`, `.title-slide`, `.break`, `.cite`),
 * so the slide layouts and inspector chips work the same way in all of them.
 *
 * Every theme emits SHARED first and its own rules after it, so a theme rule
 * at equal specificity always wins over the shared vocabulary.
 */

export interface DeckTheme {
  id: string;
  name: string;
  description: string;
  /** Swatches for the picker: background, ink, accent. */
  swatch: [string, string, string];
  css: string;
  /** Extra HTML placed right after <body> (e.g. SVG filter defs). */
  bodyPrefix?: string;
}

const SHARED = `
/* ---- shared vocabulary ---- */
.reveal .slides { text-align: left; }
.reveal .slides section { padding: 24px 40px; box-sizing: border-box; }
.reveal h1, .reveal h2, .reveal h3 { text-transform: none; letter-spacing: -0.01em; }
.reveal h1 { font-size: 2.4em; line-height: 1.06; margin: 0; }
.reveal h2 { font-size: 1.4em; line-height: 1.12; margin: 0 0 0.6em; }
.reveal h3 { font-size: 1.05em; margin: 0 0 0.4em; }
.reveal p, .reveal li { font-size: 0.72em; line-height: 1.5; }
.reveal ul, .reveal ol { margin: 0.2em 0 0.2em 1em; }
.reveal li { margin: 0.35em 0; }
.reveal strong { font-weight: 650; }
.reveal em { font-style: italic; }
.reveal a { color: var(--accent); }
.reveal .kicker { font-size: 0.42em; text-transform: uppercase; letter-spacing: 0.22em; font-weight: 600; margin: 0 0 14px; }
.reveal .caption { font-size: 0.46em; text-align: center; margin-top: 8px; }
.reveal .cite { position: absolute; left: 40px; right: 40px; bottom: 18px; font-size: 0.46em; margin: 0; }
.reveal .cols { display: flex; gap: 40px; align-items: flex-start; }
.reveal .col { flex: 1; min-width: 0; }
.reveal .card { border-radius: 12px; padding: 18px 22px; }
.reveal .card p, .reveal .card li { font-size: 0.62em; }
.reveal table { font-size: 0.56em; border-collapse: collapse; width: 100%; margin: 10px 0; }
.reveal table th { text-align: left; font-weight: 600; padding: 7px 10px; font-size: 0.85em; letter-spacing: 0.06em; text-transform: uppercase; }
.reveal table td { padding: 7px 10px; vertical-align: top; }
.reveal img.fig { max-width: 100%; display: block; margin: 6px auto; border-radius: 6px; }
.reveal .meta { font-size: 0.58em; line-height: 1.7; }
.reveal .big { font-size: 1.9em; line-height: 1.16; max-width: 22ch; }
.reveal section.title-slide { padding-top: 140px; }
.reveal section.title-slide h1 { max-width: 20ch; }
.reveal section.title-slide .sub { font-size: 0.95em; margin-top: 0.5em; }
.reveal section.title-slide .meta { margin-top: 2em; }
.reveal section.break { padding-top: 180px; }
.reveal section.break .sub { font-size: 0.72em; margin-top: 0.8em; }
`;

export const DECK_THEMES: DeckTheme[] = [
  {
    id: 'paper',
    name: 'Paper',
    description: 'Warm off-white, serif headings, amber and indigo accents.',
    swatch: ['#f5f2ea', '#1d1f24', '#a34823'],
    css: `/* Paper — warm paper, serif headings. Edit freely; the editor exposes these classes as toggles. */
:root {
  --paper: #f5f2ea; --paper-2: #ebe6d9; --ink: #1d1f24; --ink-soft: #5a6070; --rule: #d8d2c4;
  --accent: #a34823; --accent-2: #2b4a8b;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
${SHARED}
/* ---- Paper ---- */
.reveal-viewport { background: var(--paper); }
.reveal { font-family: var(--sans); font-size: 30px; color: var(--ink); }
.reveal h1, .reveal h2, .reveal h3 { font-family: var(--serif); font-weight: 600; color: var(--ink); }
.reveal .kicker { color: var(--accent); }
.reveal .accent { color: var(--accent); font-weight: 600; }
.reveal .accent-2 { color: var(--accent-2); font-weight: 600; }
.reveal .soft { color: var(--ink-soft); }
.reveal .caption, .reveal .cite { color: var(--ink-soft); }
.reveal .card { background: var(--paper-2); border: 1px solid var(--rule); }
.reveal img.fig { background: #fff; padding: 8px; box-shadow: 0 6px 26px rgba(0,0,0,.14); }
.reveal table th { color: var(--ink-soft); border-bottom: 2px solid var(--ink); }
.reveal table td { border-bottom: 1px solid var(--rule); }
.reveal .meta { color: var(--ink-soft); }
.reveal .big { font-family: var(--serif); }
.reveal section.title-slide .sub { font-family: var(--serif); font-style: italic; color: var(--ink-soft); }
.reveal section.break .sub { color: var(--ink-soft); }
`,
  },
  {
    id: 'ink',
    name: 'Ink',
    description: 'Dark slate background, bright text, teal accent — good for projectors in bright rooms.',
    swatch: ['#14181f', '#e9edf2', '#3dd6c4'],
    css: `/* Ink — dark deck. */
:root {
  --paper: #14181f; --paper-2: #1e242e; --ink: #e9edf2; --ink-soft: #9aa5b5; --rule: #2d3440;
  --accent: #3dd6c4; --accent-2: #f2b84b;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
${SHARED}
/* ---- Ink ---- */
.reveal-viewport { background: var(--paper); }
.reveal { font-family: var(--sans); font-size: 30px; color: var(--ink); }
.reveal h1, .reveal h2, .reveal h3 { font-family: var(--sans); font-weight: 700; color: #fff; }
.reveal .kicker { color: var(--accent); font-family: var(--mono); letter-spacing: 0.16em; }
.reveal .accent { color: var(--accent); font-weight: 600; }
.reveal .accent-2 { color: var(--accent-2); font-weight: 600; }
.reveal .soft { color: var(--ink-soft); }
.reveal .caption, .reveal .cite { color: var(--ink-soft); }
.reveal .card { background: var(--paper-2); border: 1px solid var(--rule); }
.reveal img.fig { background: #fff; padding: 6px; }
.reveal table th { color: var(--ink-soft); border-bottom: 2px solid var(--accent); }
.reveal table td { border-bottom: 1px solid var(--rule); }
.reveal .meta { color: var(--ink-soft); }
.reveal .big { color: #fff; }
.reveal section.title-slide .sub { color: var(--ink-soft); }
.reveal section.break .sub { color: var(--ink-soft); }
`,
  },
  {
    id: 'academic',
    name: 'Academic',
    description: 'Plain white, tight typography, one blue accent — for lectures and papers.',
    swatch: ['#ffffff', '#111318', '#1f5fbf'],
    css: `/* Academic — clean white. */
:root {
  --paper: #ffffff; --paper-2: #f3f5f8; --ink: #111318; --ink-soft: #596273; --rule: #d9dee6;
  --accent: #1f5fbf; --accent-2: #b03030;
  --serif: Georgia, "Times New Roman", Times, serif;
  --sans: "Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
${SHARED}
/* ---- Academic ---- */
.reveal-viewport { background: var(--paper); }
.reveal { font-family: var(--sans); font-size: 30px; color: var(--ink); }
.reveal h1, .reveal h2, .reveal h3 { font-family: var(--sans); font-weight: 700; color: var(--ink); }
.reveal h2 { border-bottom: 2px solid var(--accent); padding-bottom: 0.2em; }
.reveal .kicker { color: var(--accent); }
.reveal .accent { color: var(--accent); font-weight: 600; }
.reveal .accent-2 { color: var(--accent-2); font-weight: 600; }
.reveal .soft { color: var(--ink-soft); }
.reveal .caption, .reveal .cite { color: var(--ink-soft); }
.reveal .card { background: var(--paper-2); border-left: 4px solid var(--accent); border-radius: 4px; }
.reveal img.fig { border: 1px solid var(--rule); }
.reveal table th { color: var(--ink); border-bottom: 2px solid var(--ink); }
.reveal table td { border-bottom: 1px solid var(--rule); }
.reveal .meta { color: var(--ink-soft); }
.reveal .big { color: var(--accent); }
.reveal section.title-slide h1 { border: 0; }
.reveal section.title-slide .sub { color: var(--ink-soft); }
.reveal section.break .sub { color: var(--ink-soft); }
`,
  },
  {
    id: 'aquarelle',
    name: 'Aquarelle',
    description: 'Blue watercolour washes on textured paper, soft serif headings.',
    swatch: ['#eef4f8', '#17303f', '#2f6f9f'],
    bodyPrefix: `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <filter id="wc-edge"><feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="3" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="wc-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.2  0 0 0 0 0.3  0 0 0 0.10 0"/></filter>
  </svg>`,
    css: `/* Aquarelle — blue watercolour on paper. Washes are plain HTML elements with the .wash class. */
:root {
  --paper: #eef4f8; --paper-2: #e2ecf3; --ink: #17303f; --ink-soft: #4f6b7d; --rule: #c9d9e4;
  --accent: #2f6f9f; --accent-2: #9c5326; --wash: #3b7fb0; --wash-2: #8ec1e0; --wash-deep: #1d4f74;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
${SHARED}
/* ---- Aquarelle ---- */
.reveal-viewport {
  background: var(--paper);
  background-image:
    radial-gradient(60% 40% at 8% 100%, rgba(59,127,176,.22), transparent 70%),
    radial-gradient(45% 35% at 96% 0%, rgba(142,193,224,.35), transparent 70%),
    radial-gradient(30% 25% at 70% 90%, rgba(29,79,116,.12), transparent 70%);
}
.reveal { font-family: var(--sans); font-size: 30px; color: var(--ink); }
.reveal h1, .reveal h2, .reveal h3 { font-family: var(--serif); font-weight: 600; color: var(--wash-deep); }
.reveal .kicker { color: var(--accent-2); }
.reveal .accent { color: var(--accent); font-weight: 600; }
.reveal .accent-2 { color: var(--accent-2); font-weight: 600; }
.reveal .soft { color: var(--ink-soft); }
.reveal .caption, .reveal .cite { color: var(--ink-soft); }
.reveal .card { background: rgba(255,255,255,.55); border: 1px solid rgba(201,217,228,.8); backdrop-filter: blur(2px); }
.reveal img.fig { background: #fff; padding: 8px; box-shadow: 0 10px 30px rgba(23,48,63,.15); }
.reveal table th { color: var(--ink-soft); border-bottom: 2px solid var(--accent); }
.reveal table td { border-bottom: 1px solid var(--rule); }
/* washes must not bleed outside the slide: the section fills the slide and clips what lies beyond its box.
   min-height (not height) so a slide with too much text still grows and the overflow stays visible. */
.reveal .slides > section { min-height: 100%; overflow: hidden; isolation: isolate; }
/* watercolour wash: a soft irregular blob, e.g. behind a title or as a decorative shape */
.reveal .wash { position: absolute; z-index: -1; border-radius: 45% 55% 50% 50% / 55% 45% 55% 45%; background: var(--wash); opacity: .28; filter: url(#wc-edge); pointer-events: none; }
.reveal .wash.light { background: var(--wash-2); opacity: .45; }
.reveal .wash.deep { background: var(--wash-deep); opacity: .22; }
.reveal .wash.warm { background: var(--accent-2); opacity: .22; }
.reveal .meta { color: var(--ink-soft); }
.reveal .big { font-family: var(--serif); color: var(--wash-deep); }
.reveal section.title-slide .sub { font-family: var(--serif); font-style: italic; color: var(--ink-soft); }
.reveal section.break .sub { color: var(--ink-soft); }
`,
  },
];

export function themeById(id: string): DeckTheme {
  return DECK_THEMES.find((t) => t.id === id) ?? DECK_THEMES[0];
}
