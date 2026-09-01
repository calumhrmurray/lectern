# Lectern — instructions for AI assistants

You are reading this because someone wants slides and you have Lectern available (or can install it).
Lectern is a visual editor for HTML slide decks: the person drags, resizes and retypes things on a canvas,
**you** edit the same HTML file with your own tools, and each of you sees the other's changes within a second.
There is no conversion step and no proprietary format — **the `.html` file is the deck**, and it is a
[reveal.js](https://revealjs.com) presentation, so it presents in any browser and prints to PDF.

If you are working on Lectern's own source code instead, read `CLAUDE.md` and the *Development* section of `README.md`.

## The short version

```bash
npx lectern-editor new my-talk --title "Why whales lost their legs" --theme paper   # 1. scaffold a deck folder
#   → my-talk/index.html, my-talk/theme.css, my-talk/reveal/ (offline copy of reveal.js)
#   2. write the slides into my-talk/index.html — one <section> per slide (format below)
npx lectern-editor my-talk/index.html        # 3. open the editor for the person (local server, opens the browser)
npx lectern-editor notes my-talk/index.html  # 4. later: list the notes they left for you on the slides; do them
npx lectern-editor guide                     # prints this document
```

Alternative to step 3: the single-file **`Lectern.html`** — one self-contained file, opened from `file://`, with the
same folder picker and no server at all. Both edit the file on disk; `⌘S` and autosave write straight back to it.

## The loop with the person

1. **They ask for a deck** → scaffold it, write the slides, open the editor. Tell them: *double-click or right-click
   anywhere on a slide to leave me a note, drag to move, click text and press `⏎` to edit it.*
2. **They leave notes for you.** On a slide they double-click or right-click where it concerns (or press `N`) and
   write things like "draw a whale here", "this is too dense, split it", "add the 1905 law here". The note is saved in
   the HTML (autosave, ~1 s) as
   `<div hidden data-ai-note="" style="position:absolute;left:640px;top:200px;width:300px;"><p data-by="author">draw a whale here</p></div>`.
3. **You do the notes**: `npx lectern-editor notes deck.html` lists the pending ones with slide number, position and the
   whole comment thread. Act on each one *in the file*, matching the deck's style. Then mark it done **without deleting
   it**: append `<p data-by="ai">one sentence saying what you did</p>` inside the note and set `data-ai-note="done"`.
   Their editor reloads by itself and the note turns green.
4. **They reply** (click the green note, type) → the note is pending again with a longer thread; the last
   `<p data-by="author">` is the current request, earlier ones are context. They dismiss notes themselves
   (double-click); never remove one yourself, and never remove `hidden` — notes must not show when presenting.

   Until you answer it, a note is a draft the person can still rewrite, so read it when you act on it rather
   than relying on text you saw earlier. Once you have appended a `<p data-by="ai">`, the thread stops being
   editable and they can only add to it — so what you replied to stays on the record.

Rules while the editor is open on the file:

- **Edit in place; keep untouched slides byte-identical.** Lectern saves by splicing only the changed `<section>`s back
  into the original text, so `git diff` stays readable and your edits and theirs interleave cleanly. Do the same: no
  reformatting, no re-indenting, no attribute reordering, no changing `#4a7bd0` to `rgb(…)`.
- **Write files atomically and quickly** (write the whole file in one go). The editor reloads when the file changes and
  it has no unsaved edits of its own; if it *has* unsaved edits, the person sees a banner and chooses. Small, frequent,
  complete writes keep that painless.
- Don't put a `<div>` inside a `<p>`, don't leave `contenteditable`, `data-lid`, `.present`, `.visible` or other
  runtime attributes in the file, and keep every slide a direct child of `<div class="slides">`
  (or a `<section>` inside a vertical stack).

## Deck format

A deck is a folder: `index.html`, `theme.css`, images next to them (relative `src`), and usually a `reveal/` copy so it
works offline. `lectern new` writes exactly this skeleton (here for `--title "Talk title" --author Author`; `--lang fr`
changes the `<html lang>`, `--theme` the stylesheet):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Talk title</title>
  <link rel="stylesheet" href="reveal/dist/reset.css">
  <link rel="stylesheet" href="reveal/dist/reveal.css">
  <link rel="stylesheet" href="theme.css">
</head>
<body>
  <div class="reveal">
    <div class="slides">

      <!-- 1 · title -->
      <section class="title-slide">
        <h1>Talk title</h1>
        <p class="sub">A subtitle</p>
        <p class="meta"><b>Author</b><br>Occasion · Date</p>
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
        <aside class="notes">Speaker notes; put sources here.</aside>
      </section>

    </div>
  </div>

  <script src="reveal/dist/reveal.js"></script>
  <script src="reveal/plugin/math/math.js"></script>
  <script src="reveal/plugin/notes/notes.js"></script>
  <script>
    Reveal.initialize({
      width: 1280, height: 720, margin: 0.04,
      center: false, hash: true, transition: 'none',
      controls: false, progress: true, slideNumber: 'c/t',
      katex: { local: 'reveal/katex' },
      plugins: [ RevealMath.KaTeX, RevealNotes ],
    });
  </script>
</body>
</html>
```

**Coordinates.** Slides are `width × height` slide units from `Reveal.initialize` (1280×720 unless told otherwise);
reveal scales the whole slide to the screen. Every position in this document (note positions, `left/top`) is in those
units, origin at the slide's top-left. A `<section>` has 24px 40px padding from the theme.

**Two kinds of element.** Elements laid out by CSS (headings, lists, paragraphs in flow) are what you write most of the
time; when the person drags one of these, Lectern *nudges* it with `position:relative; left/top` so nothing else jumps.
Free-floating objects — a caption placed by hand, a shape, an arrow, an image at a precise spot, a note — are
`position:absolute` with `left`, `top` (and usually `width`) in px on the inline style, as direct children of the
`<section>`. That is exactly what the editor writes when someone inserts an object, e.g.

```html
<p style="position:absolute;left:640px;top:420px;width:300px;margin:0;">A caption placed by hand</p>
<img src="fig1.png" alt="…" style="position:absolute;left:720px;top:120px;width:480px;">
<div style="position:absolute;left:80px;top:500px;width:360px;height:120px;background:#4a7bd0;border-radius:4px;"></div>
```

Prefer flowed HTML for text and lists (it reflows when they edit the words) and absolute positioning for pictures,
diagrams and annotations. A rotation is `transform:rotate(12deg)` on the same style.

**Class vocabulary** (all four built-in themes define it, and the inspector offers a deck's classes as one-click
toggles, so decks that use these stay editable in a consistent way):

| class | on | meaning |
|---|---|---|
| `title-slide`, `break` | `<section>` | title slide layout; a section-break slide with `<p class="big">` and `<p class="sub">` |
| `kicker` | `<div>`/`<p>` above the `<h2>` | small uppercase label: section name, slide type |
| `sub`, `meta` | `<p>` on title/break slides | subtitle; author/date line |
| `accent`, `accent-2`, `soft` | `<span>` | coloured emphasis; muted text |
| `cols` › `col` | `<div>` | two (or more) equal columns |
| `card` | `<div>` | a padded, tinted box |
| `fig` | `<img>` | a figure: centred, max-width 100%, framed |
| `caption`, `cite` | `<p>` | small centred caption under a figure; a small source line pinned to the slide's bottom |

Themes: `paper` (warm, serif), `ink` (dark), `academic` (white, tight), `aquarelle` (watercolour washes). Each is a
plain CSS file with `:root` variables at the top — edit `theme.css` for anything global, inline styles for one-offs.

**reveal.js features that are edited visually** and that you may write by hand: `class="fragment"` (+ `fade-up`, …,
`data-fragment-index`), slide `data-background-color/-image/-size/-opacity`, `data-transition`, `data-visibility="hidden"`
(a backup slide), speaker notes in `<aside class="notes">`, vertical stacks (`<section><section>…</section><section>…</section></section>`),
math as `\( … \)` / `\[ … \]` or `$…$` (KaTeX plugin, typeset from the source on every edit), code in `<pre><code>`.

**Sections.** A talk usually falls into a few parts, and Lectern's compass and map read them from the file.
Name one on the first slide of the run — `<section data-section="Anatomy">` — and every slide after it belongs to
that section until the next one is named; `data-section=""` starts a new, unnamed section (a seam without a label).
Nothing else is needed: naming a twenty-slide talk costs three attributes, and it is worth doing, because it is the
only structure above "slide" the person can navigate by. Where nothing is declared, a `break` slide and a run of
slides sharing one `.kicker` are read as sections too. A section belongs to the top-level `<section>`, so on a
vertical stack the attribute goes on the wrapper.

**Diagrams.** Inline `<svg>` is the best way to draw: it scales with the slide, needs no files, and Lectern selects,
moves and resizes it like any object. Give it a `viewBox`, `width`/`height` in slide units, and `position:absolute` if
it is placed by hand. Use the theme's colours (read `theme.css`).

**Images.** Put files in the deck folder (or a subfolder) and reference them relatively; the editor does the same when
someone inserts an image. Give every `<img>` an `alt` and a `width` in the style so it has a size before it loads.

**Multi-file decks** are supported: a shell page whose `<div class="slides" data-parts="a.html b.html">` (or a
`const parts = [...]` script) pulls slides from part files. Each slide is written back to the file it came from.

**Plain (non-reveal) decks** also work: any page whose slides are `<section>` elements driven by the page's own script.
You lose reveal-only features (backgrounds, transitions) but keep the canvas editing and the notes.

## Writing good slides

- One idea per slide; a `kicker` + an `h2` that is a sentence, then at most ~6 short lines or one figure. Body text is
  ~22px on a 1280×720 slide; if something needs a smaller font to fit, split the slide.
- Put sources and the long version in `<aside class="notes">`; a `data-ref="…"` attribute on the `<section>` is a good
  place for a short citation key. The example decks do this on every slide.
- Comments before each slide, `<!-- 3 · why gigantism -->`, help both of you find things and survive editing.
- Two columns: `<div class="cols"><div class="col">…</div><div class="col">…</div></div>`.
- Keep numbers, names and dates checkable: the person can hover a note and ask you where it came from.

## Checking your work

- `npx lectern-editor notes deck.html` → *No pending notes*.
- Open the deck in a browser (`npx lectern-editor deck.html` shows it in the editor; the *Present* button shows the
  real presentation). If you can drive a browser, screenshot each slide and look for overflow — text running past the
  bottom of a 720-unit-high slide is the commonest fault.
- PDF export is reveal's print mode: open `index.html?print-pdf` in Chrome and print to PDF (`npx lectern-editor my-talk`
  serves it, so `http://127.0.0.1:8765/index.html?print-pdf`). Every slide becomes one page; check the last page is
  not blank and nothing is cut off.
- `git diff` should touch only the slides you meant to touch.

## Where things are

- Editor & source: https://github.com/calumhrmurray/lectern (MIT). Issues and ideas welcome there.
- `Lectern.html`: one self-contained file that works from `file://`; `npm run build` writes it.
- npm: `lectern-editor` — `npx lectern-editor --help`.
- Claude Code skill: `/plugin marketplace add calumhrmurray/lectern` then `/plugin install lectern@lectern`.
