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
- **Notes for an AI** — press `N` (or *Note for AI*) and write on the slide what you want done there:
  "draw a whale here", "explain the 1905 law here". Notes are saved in the HTML as
  `<div hidden data-ai-note style="position:absolute;left:…;top:…">…</div>` — invisible when presenting,
  visible as sticky notes while editing, positioned in slide coordinates. The *Notes for AI* panel lists
  them all and copies a ready-made prompt; `node scripts/ai-notes.mjs deck.html` prints the same from a
  terminal. Tell Claude Code "do the notes in index.html" and it can find, act on and remove them.
- **Undo/redo everything**, including across saves.
- **Multi-file decks** — a shell whose `<div class="slides">` is filled from part files
  (`const parts = ['slides/p0.html', …]` or `<div class="slides" data-parts="a.html b.html">`)
  is edited as one deck; each slide is saved back to the file it came from, and slides moved
  across files take their `<!-- comment -->` with them.

## Use it

### Double-click `Lectern.html` — nothing to install, no server

On a Mac, `sh scripts/make-app.sh` builds **`Lectern.app`**, a launcher you can drag to the Dock; it
opens `Lectern.html` in Chrome. Otherwise:

1. Open **`Lectern.html`** (from this folder) in Chrome, Edge or another Chromium browser.
2. Click **Open a folder…** and pick the folder that contains your deck; choose the HTML file
   if the folder has several.
3. Edit. **`⌘S`** writes straight back to the file on disk.

Nothing leaves your machine. The deck's stylesheets, scripts and images are read from the
folder you picked. Keep `Lectern.html` anywhere you like — it is a single file.

**Working alongside an assistant.** The editor watches the deck's files. If Claude Code (or you, in
a text editor) changes a file while the editor has no unsaved edits, the canvas reloads by itself and
stays on the same slide. With unsaved edits, a banner offers to reload or keep yours, and saving never
overwrites a newer file without asking. So: keep Lectern open, ask the assistant for changes, watch
them appear; drag things around, `⌘S`, and the assistant reads your version.

### Other ways to run it

- `npx lectern-editor path/to/deck.html` — a tiny local server, for Firefox/Safari (which lack the
  folder picker) or when you prefer a URL.
- Any static host can serve `dist/` (it needs HTTPS for the folder-serving worker).

### New deck and templates

**New deck…** creates a folder with `index.html`, a `theme.css` and a copy of reveal.js (so it
works offline). You choose slide size, author and one of four built-in themes — **Paper** (warm,
serif), **Ink** (dark), **Academic** (white, tight), **Aquarelle** (blue watercolour washes) — all
sharing one class vocabulary (`.kicker`, `.accent`, `.card`, `.cols/.col`, `.title-slide`, `.break`…)
so slide layouts and inspector chips behave the same everywhere.

### Example decks

The welcome screen lists two complete, referenced decks. **Save to a folder…** copies one (with its
own reveal.js) into a folder you choose and opens it from there — from then on it is an ordinary HTML
deck on your disk; **Preview** opens a throw-away copy in memory.

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
`⌘⇧N` new slide · `⌘]`/`⌘[` forward/backward · typing with a text object selected edits it ·
`N` new note for AI · `+ − 0` zoom · `?` full list.

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
