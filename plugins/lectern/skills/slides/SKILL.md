---
description: Make or edit a slide deck (presentation, talk, lecture, pitch) as an HTML/reveal.js file the person can then adjust visually in the Lectern editor, and act on the notes they leave for you on the slides. Use when the user asks for slides, a presentation, a deck or a talk, wants to edit an existing reveal.js/HTML deck, or says "do the notes" in a deck.
---

# Slides with Lectern

Lectern is a visual editor for HTML slide decks: the person drags and retypes on a canvas, you edit the same
`index.html` with your tools, and both of you see the other's changes within a second. The `.html` file *is* the deck
(reveal.js), so it presents in any browser and prints to PDF.

Read **`reference.md` in this skill's folder** before writing a deck — it has the file format, the class vocabulary,
the notes-for-AI protocol and the rules for editing a file the editor has open. Then:

1. **Scaffold:** `npx lectern-editor new <folder> --title "…" --theme paper|ink|academic|aquarelle`
   (writes `index.html`, `theme.css`, and an offline copy of reveal.js). Check `npx lectern-editor --help` if it fails —
   Node 18+ is required.
2. **Write the slides** into `<folder>/index.html`: one `<section>` per slide, a `<!-- n · title -->` comment before
   each, `kicker` + `h2` + at most ~6 lines or one figure, sources in `<aside class="notes">`. Inline `<svg>` for diagrams.
3. **Open the editor for them:** `npx lectern-editor <folder>/index.html` (a local server; opens the browser).
   Say: *double-click text to edit, drag to move, press `N` on a slide to leave me a note.*
4. **Do their notes:** `npx lectern-editor notes <folder>/index.html` lists pending notes with slide, position and
   thread. Act on each in the file, then append `<p data-by="ai">what you did</p>` inside the note and set
   `data-ai-note="done"`. Never delete a note or its `hidden` attribute.
5. **Keep untouched slides byte-identical** — edit in place, no reformatting, write the file in one go.

If `npx` is not available, the person can use https://calumhrmurray.github.io/lectern/ (*Open a folder…*) or the
single-file `Lectern.html` from that page; the file format and the notes are the same.
