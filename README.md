# Lectern — a visual editor for slides your AI assistant writes

**Ask Claude, ChatGPT, Copilot or any coding agent for a presentation, then move things around
yourself.** Lectern is a drag-and-drop editor for HTML slide decks: the assistant writes the
file, you fix the layout on a canvas, and each of you sees the other's changes within a second.

```bash
npx lectern-editor new my-talk --title "Why whales lost their legs"   # scaffold a deck
npx lectern-editor my-talk/index.html                                 # open the editor
```

**The `.html` file is the deck** — a [reveal.js](https://revealjs.com) presentation. There is no
proprietary format, no import and no export step: it opens in any browser, prints to PDF, and
lives in git like any other file. Lectern writes back only the slides you changed, byte for byte,
so `git diff` stays readable and your assistant can keep editing the same file while you have it
open.

- **Nothing leaves your machine.** No account, no telemetry, no hosted version, no runtime
  dependencies. Works with the wifi off — the tests fail if any part of the editor so much as
  tries to reach the network.
- **One file, no install:** double-click `Lectern.html` (a single self-contained page, from
  `file://`). Or `npx lectern-editor` for Firefox and Safari, which have no folder picker.
- **Works on decks you already have,** and on any hand-rolled page of `<section>` slides.
- **Five-minute tutorial:** `public/tutorial.html` (the editor's Help menu opens it).

*Made for people who like the slides an LLM writes but not the layout it leaves behind: a
PowerPoint- or Keynote-shaped canvas over plain HTML, with the assistant still in the loop.*

## Slides with an AI

Ask your assistant for a deck; it writes an HTML file. Open that file in Lectern and fix the layout by hand while
the assistant keeps working on the content. Where you want something changed, press **`N`** on the slide and write
it there — *"draw a whale here"*, *"this is too dense, split it"*. The note is saved in the HTML; the assistant
lists the notes, does them, and marks each one done (it turns green). Both of you edit the same file, and each sees
the other's changes within a second.

To make an assistant fluent in this, give it [`AGENTS.md`](AGENTS.md) — one document with the deck format, the
class vocabulary, the notes protocol and the editing rules:

- **Claude Code:** `/plugin marketplace add calumhrmurray/lectern` then `/plugin install lectern@lectern` — adds a
  `slides` skill that is picked up whenever you ask for a presentation. Or copy `plugins/lectern/skills/slides/` into
  `~/.claude/skills/`.
- **Codex, Cursor, Copilot, Gemini CLI, …:** they read `AGENTS.md` from the working folder — copy it into your
  project, or paste this into the chat:

  > Read AGENTS.md from https://github.com/calumhrmurray/lectern and make me a slide deck about … in a folder called `talk`.

- **Any agent with a shell:** `npx lectern-editor guide` prints the same document; `npx lectern-editor new talk`
  scaffolds a deck; `npx lectern-editor notes talk/index.html` lists what you asked for on the slides.

## What it does

- **Canvas editing** — click to select, drag to move with snapping guides (slide edges, centre
  lines, other objects' edges), 8-handle resize (images keep their aspect ratio), rotate,
  marquee and shift-click multi-select, arrow-key nudging, align / distribute / z-order.
- **Text in place** — click any text and press `⏎` (or just type over it); bold/italic/underline/lists/links, `Tab` to indent
  list items, LaTeX kept as source and re-typeset by the deck's KaTeX/MathJax on commit.
- **Layout-aware** — elements laid out by your CSS are *nudged* (`position: relative`) so
  nothing else jumps; new objects are free-floating (`position: absolute`). Switch either way
  from the inspector.
- **The quiet room (the default view) and the map** — the slide gets the whole window on an off-white
  background (click the background for the dark room, click again to come back), with the neighbouring
  slides showing at the edges: the previous and next along the sides, and a vertical stack's slides above
  and below, on the axis the arrow keys would actually take. Along the bottom — in every view, not just this one — a *compass* (one dot per
  slide, a descender under any slide with a vertical stack, a seam between sections) and glyphs for the
  map, present and notes for AI; on the right, the page number and one button that summons the tools. `M` opens the map — the deck laid out the way reveal
  walks it, sections left to right and stacks downward — where you add and title slides, reorder them,
  name sections (`data-section`) and drop one slide under another to make it a sub-slide. `Q` brings the
  toolbar, navigator and inspector back for good; hold `Space` for a look at them.
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
  them all and copies a ready-made prompt; `npx lectern-editor notes deck.html` prints the same from a
  terminal. Tell Claude Code "do the notes in index.html": it acts on each, appends its reply as
  `<p data-by="ai">…</p>` and marks the note `data-ai-note="done"` — it turns **green**. A note is a thread like a
  document comment: click it to add a comment (a green one turns yellow again), double-click a green one to dismiss it.
- **Autosave** (on by default; toggle in the menu): edits reach the file a second after you make them, so an
  assistant watching the folder sees your notes as you write them.
- **Undo/redo everything**, including across saves.
- **Multi-file decks** — a shell whose `<div class="slides">` is filled from part files
  (`const parts = ['slides/p0.html', …]` or `<div class="slides" data-parts="a.html b.html">`)
  is edited as one deck; each slide is saved back to the file it came from, and slides moved
  across files take their `<!-- comment -->` with them.

## Use it

### Double-click `Lectern.html` — nothing to install, no server

The whole editor as one self-contained file. Build it with `npm run build`, which writes `Lectern.html` here, and
open it from `file://`: no server, no port, no network — the browser is only there to render HTML. On a Mac, `sh scripts/make-app.sh` builds **`Lectern.app`**,
a launcher you can drag to the Dock; it opens `Lectern.html` in Chrome. Otherwise:

1. Open **`Lectern.html`** in Chrome, Edge or another Chromium browser.
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

### From a terminal — `npx lectern-editor`

```bash
npx lectern-editor deck.html            # serve the editor for a deck (or a folder) and open the browser
npx lectern-editor new my-talk          # scaffold a deck: index.html, theme.css, reveal/ (--title --author --theme --size)
npx lectern-editor notes deck.html      # list the pending notes for an AI, as a prompt
npx lectern-editor guide                # print AGENTS.md, the instructions for assistants
```

The server is a tiny local one (`127.0.0.1:8765`); it works in Firefox and Safari too, which lack the folder picker.
Needs Node 18+. Any static host can also serve `dist/` (HTTPS is required for the folder-serving worker).

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

`⌘S` save · `⌘Z / ⌘⇧Z` undo/redo · double-click / right-click leave a note for AI · `⏎` edit selected text · `Esc` stop editing / deselect ·
`⌘C/X/V/D` copy/cut/paste/duplicate · `⌫` delete · arrows nudge (`⇧` 10 px) ·
`⇧`-drag constrain / keep aspect · `⌥`-drag ignore snapping · `PgUp/PgDn` slides ·
`⌘⇧N` new slide · `⌘]`/`⌘[` forward/backward · typing with a text object selected edits it ·
`N` note for AI at the pointer · `M` map · `Q` quiet mode · `Space` (hold) show the chrome · `+ − 0` zoom · `?` full list.

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

### Security model

A deck runs in an iframe on the **same origin** as the editor, by design: the editor reaches into the deck's DOM to select,
move and retype things, and the deck's own scripts (reveal, KaTeX, a custom driver) must run for the canvas to look right.
The corollary is that a deck's scripts can reach the editor too — open only decks you trust, exactly as you would any HTML
file. The `window.lectern` handle to the App is only exposed in dev builds and when the URL carries `?test=1` (the end-to-end
tests use it). The CLI server binds to `127.0.0.1`, refuses requests whose `Host` or `Origin` is not the machine itself
(so a DNS-rebinding page cannot read or write the folder) and refuses symlinks that lead outside the deck folder; `--host`
on any other address prints a warning that the folder is open to the network. Every response carries
`X-Content-Type-Options: nosniff`, and the editor's own pages are served under a `Content-Security-Policy` of
`default-src 'self'` — deck files are not, because your slides may point wherever you like.

**No network, checked by the tests.** Lectern has no runtime dependencies, no telemetry and no hosted version;
reveal.js and KaTeX are copied into the deck folder so a deck with maths typesets offline. `test/e2e/offline.spec.ts`
cuts the network at the browser and fails if any request tries to leave the machine — the editor, the welcome
screen, a scaffolded deck, and a deck opened from `Lectern.html` over `file://`. The one thing that reaches the
internet is `lectern new --no-reveal`, which you have to ask for by name: it points the deck at a CDN instead of
copying reveal.js next to it.

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

## Releasing

`npm publish` ships the CLI, `dist/` (the built editor, `Lectern.html`, reveal.js and KaTeX) and `AGENTS.md` as the
`lectern-editor` package; `prepublishOnly` runs the build. There is **no hosted editor** and there is not going to be
one: Lectern is a local tool, and a page on someone's server is the opposite of that. `dist/` is a static site if you
want to serve it yourself on a machine you control (the service worker needs HTTPS or localhost).

## Questions

**Can I use this with ChatGPT / Copilot / Cursor / Gemini instead of Claude?** Yes. Any assistant that can read a file
and write one works; give it [`AGENTS.md`](AGENTS.md) (or run `npx lectern-editor guide`). The Claude Code plugin is a
convenience, not a requirement.

**Do I need an API key or an account?** No. Lectern is an editor, not an AI client — it never talks to a model. Your
assistant edits the file with its own tools, wherever it already runs.

**Does it work offline?** Yes, entirely, and the test suite enforces it.

**Can I edit a reveal.js deck I already have?** Yes — `npx lectern-editor path/to/deck.html`. Lectern renders it with
the deck's own theme and plugins and writes back only what you change. Plain HTML decks (a page of `<section>`s with
your own script) work too.

**How do I get a PDF?** reveal's print mode: open `index.html?print-pdf` in Chrome and print. Every slide is one page.

**What happens to my deck if I stop using Lectern?** Nothing. It is an ordinary reveal.js HTML file that you can
open, present and edit by hand; Lectern leaves no runtime attributes and no lock-in behind.

## Licence

MIT. reveal.js is © Hakim El Hattab and contributors, MIT. Lectern is an independent project and
is not affiliated with any presentation-software vendor.
