# Lectern

A visual, canvas-style editor for HTML presentations — [reveal.js](https://revealjs.com) decks
and any hand-rolled page of `<section>` slides. **The HTML file is the document.** Lectern opens your deck, renders it with the deck's own
reveal.js, theme and plugins, lets you move, resize, restyle and retype things like you would
in a desktop presentation app — and writes only the slides you changed back into the file.
Comments between slides, indentation, entity spellings and untouched slides stay byte-for-byte
identical, so `git diff` stays readable and a coding assistant can keep editing the same file.

## What it does

- **Canvas editing** — click to select, drag to move with snapping guides (slide edges, centre
  lines, other objects' edges), 8-handle resize (images keep their aspect ratio), rotate,
  marquee and shift-click multi-select, arrow-key nudging, align / distribute / z-order.
- **Text in place** — double-click any text; bold/italic/underline/lists/links, `Tab` to indent
  list items, LaTeX kept as source and re-typeset by the deck's KaTeX/MathJax on commit.
- **Layout-aware** — elements laid out by your CSS are *nudged* (`position: relative`) so
  nothing else jumps; new objects are free-floating (`position: absolute`). Switch either way
  from the inspector.
- **Insert** — text, headings, bullet lists, images (copied into the deck folder), shapes
  (rectangle, ellipse, outline, line, arrow, callout), tables, code, equations, web embeds.
- **Slides** — thumbnails rendered with the deck's own stylesheet, drag to reorder, add from
  layouts, duplicate, delete, copy/paste, vertical stacks, `data-visibility` (backup slides).
- **Inspector** — position/size, typography, fill/border/shadow, the deck's own CSS classes
  as one-click toggles (`.kicker`, `.tide`, `.fig` …), reveal fragments (effect + order),
  slide backgrounds and transitions, speaker notes, raw HTML of a slide.
- **Undo/redo everything**, including across saves.
- **Multi-file decks** — a shell whose `<div class="slides">` is filled from part files
  (`const parts = ['slides/p0.html', …]` or `<div class="slides" data-parts="a.html b.html">`)
  is edited as one deck; each slide is saved back to the file it came from, and slides moved
  across files take their `<!-- comment -->` with them.

## Use it

### In the browser — nothing to install

**https://calumhrmurray.github.io/lectern/** (Chrome, Edge or another Chromium browser)

1. Click **Open a folder…** and pick the folder that contains your deck.
2. Choose the HTML file (asked only if the folder has several).
3. Edit. `⌘S` writes straight back to the file on your disk.

A service worker serves the folder into the editing canvas, so reveal.js, the theme, images and
plugins load exactly as on a web server. Nothing is uploaded anywhere.

**Working alongside an assistant.** The editor watches the deck's files. If Claude Code (or you, in
a text editor) changes the file while the editor has no unsaved edits, the canvas reloads on its own
and stays on the same slide. If you *do* have unsaved edits, a banner offers to reload or keep yours,
and saving never overwrites a newer file without asking.

### From a terminal (any browser; good next to Claude Code)

```bash
npx lectern-editor path/to/deck.html     # or a folder
```

This starts a small local server on `127.0.0.1:8765` and opens the editor. Saves go straight
to the files, so an assistant editing the same HTML sees your changes and vice versa.

### New deck and templates

**New deck…** creates a folder with `index.html`, a `theme.css` and a copy of reveal.js (so it
works offline). You choose slide size, author and one of four built-in themes — **Paper** (warm,
serif), **Ink** (dark), **Academic** (white, tight), **Aquarelle** (blue watercolour washes) — all
sharing one class vocabulary (`.kicker`, `.accent`, `.card`, `.cols/.col`, `.title-slide`, `.break`…)
so slide layouts and inspector chips behave the same everywhere.

### Example decks

The welcome screen lists two complete, referenced decks you can open, edit and download:

- **From land to sea — the evolutionary pathways of whales** (English, Aquarelle theme): 15 slides
  from raoellids and *Pakicetus* to baleen-whale gigantism and genome-level gene loss. Every slide has a
  `data-ref` attribute and full citations in its speaker notes; the last slide lists the sources.
- **Préparer l'entretien de naturalisation** (French, Paper theme): 17 slides on the assimilation
  interview — legal framework (Code civil art. 21-24 etc.), procedure and deadlines, symbols, values,
  institutions, key dates, rights and duties — with the relevant texts cited on each slide. Rules in
  this area change; the deck states its verification date and says what to check on service-public.fr.

They live in `public/examples/`; add a folder and an entry in `public/examples/index.json` to ship
your own.

## What counts as a deck

- **reveal.js**: `<div class="reveal"><div class="slides">…</div></div>` and a global `Reveal`
  (the usual `<script src="…/reveal.js">` + `Reveal.initialize({...})`). Vertical stacks,
  fragments, backgrounds, transitions and speaker notes are all edited. Decks that use
  `import Reveal from 'reveal.esm.js'` must expose the instance as `window.Reveal`.
- **Plain HTML**: any page whose slides are `<section>` elements in a container, driven by your
  own script (e.g. `#deck > section.slide` with an `.active` class and `#3`-style hashes).
  Lectern learns the deck's "active" class from whichever slide is showing, shows slides itself
  while you edit, keeps the deck's keyboard/click handlers from interfering, and renders the page
  in a fixed viewport (1280×720 by default, changeable in the Deck tab) so `vw`/`vh` layouts look
  as they would on a projector. reveal-only features (backgrounds, transitions) are hidden.

## Keyboard

`⌘S` save · `⌘Z / ⌘⇧Z` undo/redo · double-click edit text · `Esc` stop editing / deselect ·
`⌘C/X/V/D` copy/cut/paste/duplicate · `⌫` delete · arrows nudge (`⇧` 10 px) ·
`⇧`-drag constrain / keep aspect · `⌥`-drag ignore snapping · `PgUp/PgDn` slides ·
`⌘⇧N` new slide · `⌘]`/`⌘[` forward/backward · `T` `I` `S` insert text/image/shape ·
`+ − 0` zoom · `?` full list.

## Development

```bash
npm install
node test/e2e/prepare.js                  # builds the demo deck in test/.tmp/demo (reveal + KaTeX included)
npm run dev                               # http://localhost:5173/?ws=local — edits the demo deck with hot reload
LECTERN_DIR=~/talks/iap npm run dev       # …or any folder / deck.html
npm test                                  # unit tests (vitest)
npm run build                             # dist/ (+ copies reveal.js into public/reveal)
npm run test:e2e                          # build + Playwright end-to-end tests through the CLI server
node cli/index.js test/.tmp/demo          # the CLI on the demo deck
```

Layout of the source:

```
src/deck/       document model: HTML scanner, splicing serialiser, history, templates, theme-class discovery
src/stage/      the canvas: iframe + reveal control, src↔live mirroring, overlay, pointer interactions, text editing
src/app/        Editor (all user operations as undoable transactions) and App (workspaces, saving, shortcuts)
src/ui/         toolbar, navigator + thumbnails, inspector, panels, dialogs, menus
src/workspace/  file access: File System Access API (+ service worker), CLI server, in-memory demo
cli/            `lectern` command: static server for dist/ plus read/write of the deck folder
public/sw.js    service worker that serves a folder handle at /fs/<id>/…
```

### How saving works

`DeckDocument` keeps the original text and a parsed DOM. Every edit touches the DOM only. On save,
a small tolerant scanner locates each top-level `<section>`'s byte range in the original text;
sections whose `outerHTML` is unchanged are copied from the original bytes, modified ones are
re-serialised, and each section carries the text that preceded it (its comment). Inline styles are
patched textually so `#4a7bd0` never turns into `rgb(74, 123, 208)`.

### On the canvas

The deck runs unmodified in an iframe (reveal is reconfigured for editing: no keyboard/touch,
no transitions, every fragment shown). The source DOM is the truth; the live DOM is a rendering.
Both receive identical structural edits, so an element is located in the other tree by its index
path from the top-level section — plugin rewrites (KaTeX, highlighting) happen below the elements
you select and never disturb the paths. Undo is a whole-section snapshot restore.

## Deploying the web editor

The `dist/` folder is a static site; the GitHub Actions workflow in `.github/workflows/pages.yml`
publishes it to GitHub Pages. It needs HTTPS (or localhost) for the service worker.

## Licence

MIT. reveal.js is © Hakim El Hattab and contributors, MIT. Lectern is an independent project and
is not affiliated with any presentation-software vendor.
