# Changelog

All notable changes to Lectern are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.1.1] — 2026-09-02

### Fixed
- The slides in quiet mode's gutters (and every other thumbnail) rendered unstyled when the
  editor was served over HTTP: the deck's `<link>` stylesheets live in the deck iframe's own
  realm, so an `instanceof HTMLLinkElement` check never matched them and each link was copied
  into the thumbnail as an empty `<style>`. Duck-typed on the tag name instead; thumbnails now
  carry the deck's stylesheets in every mode. (`Lectern.html` on `file://` was unaffected —
  inline mode already inlines CSS into real `<style>` elements.)

## [2.1.0] — 2026-09-01

A deck is HTML, and HTML is not what most people want to edit by hand. This release adds a
human-readable form: the deck as Quarto/Pandoc markdown, converted both ways, so simple edits
need a text editor rather than an LLM, and people with a Quarto setup can render the same talk
through their own themes.

### Added
- `lectern convert deck.html` ⇄ `lectern convert deck.qmd` — the deck as Quarto reveal.js
  markdown, and back. Headings, lists, columns, figures with captions, code, tables, speaker
  notes, fragments and slide attributes become markdown; inline SVG, absolutely positioned
  objects and anything else without a faithful markdown form travel as verbatim HTML islands,
  so the trip is lossless. Importing splices into the existing deck: a slide whose markdown is
  unchanged keeps its exact bytes (`git diff` shows only what you edited). A simple title slide
  becomes YAML front matter; `::: {.kicker}`, `::: {.backdrop}` and `::: {.stack}` carry the
  kicker, the behind-the-heading decorations and reveal's vertical stacks. Converting refuses
  to overwrite an output file newer than its input unless `--force` is passed.
- **Export Markdown (Quarto)…** in the editor's menu — the same `.qmd`, as a download, from
  the browser and from `Lectern.html` on `file://`.
- `dist/lib/markdown.js`: the converter as a DOM-free library (parse5 bundled in), so the
  published package still has zero runtime dependencies.

## [2.0.0] — 2026-09-01

The first release published to npm (`npm i -g lectern-editor`, or `npx lectern-editor`).
Everything before this lived only in the repository.

The editor now opens in **quiet mode**: the slide, its neighbours in the gutters, a compass
in one corner and a page count in the other. Panels are there when you ask for them (`Q`),
and the `M` map is where the deck's structure is edited. Notes for AI became comment
threads, so a request and its answer stay together on the slide they concern.

### Added
- Quiet mode, the compass, `Neighbours` in the gutters, and the map overlay (`M`) — the only
  place that edits deck *structure*: add and title slides, reorder, name a section, nest and
  unnest along reveal's vertical axis.
- Named sections: `data-section="Anatomy"` on the first slide of a run, read by the compass
  and the map (`src/deck/sections.ts`, falling back to a `break` slide or a repeated `.kicker`).
- Notes for AI are comment threads (`<p data-by="author|ai">`): double-click or right-click
  anywhere on a slide to leave one, they turn green when answered and reopen on a reply.
- A light room and a dark one; tips that are said once, beside the thing they are about.
- KaTeX travels with reveal.js, so a deck with maths typesets with the network unplugged.
- `test/e2e/offline.spec.ts`: the suite cuts the network at the browser and fails on any
  request that tries to leave the machine.
- `lectern new --lang xx` sets the deck's `<html lang>`.
- `CHANGELOG.md`, `.nvmrc` (Node 20), a root `llms.txt`.

### Security
- The CLI server refuses requests whose `Host` or `Origin` is not the machine itself, which
  blocks DNS rebinding and cross-site writes; `--host` on a non-loopback address warns.
- Symlinks inside the deck folder that point outside it are refused (403) for reading,
  writing and listing.
- `X-Content-Type-Options: nosniff` on every response; a `Content-Security-Policy` on the
  editor's own pages (not on deck files, which are the author's to point where they like).
- `window.lectern` (the whole App) is only exposed in dev builds or with `?test=1`.
- No hosted editor and no telemetry: nothing in Lectern talks to a server that is not yours.

### Changed
- Build stamp is the package version plus the short git SHA (`v1.0.0 (abc1234)`), so rebuilding the same commit gives a byte-identical `Lectern.html`.
- The demo deck lives in `src/demo/` (it ships in the editor bundle); `test/e2e/prepare.js` copies it from there.
- Built-in themes: the shared vocabulary block now comes *before* each theme's own rules, so per-theme overrides (ink's kicker tracking, academic's card radius, every theme's `.soft` colour) take effect; `.soft` and `.cite` are no longer muted twice and clear WCAG AA; `.cite` is 0.46em; links use `--accent` in all themes; `.meta`/`.big` work outside title/break slides; every theme defines `--sans`, `--serif` and `--mono`; paper's accent and aquarelle's accent-2 are darker for contrast; aquarelle no longer clips overflowing text.
- Inserted callouts, outlines, lines and arrows use the theme's colours instead of hard-coded light-theme ones (they were unreadable on `ink`).
- The `lectern new` scaffold adds `<aside class="notes">` to its content slide and AGENTS.md shows the scaffold verbatim (a test keeps them equal); AGENTS.md explains `?print-pdf`.
- Editor accessibility: visible focus rings, modal focus trap and restore, arrow keys in menus and tabs, ARIA roles/labels/pressed states on toolbar, inspector, navigator and image picker (which was unusable from the keyboard), a live region for the save status, higher-contrast chrome tokens, a scrollable toolbar and narrower side panels on small windows, reduced-motion support, larger handle targets on touch.
- Navigator thumbnails render in a sandboxed frame.

### Security
- The CLI server refuses requests whose `Host` or `Origin` is not the machine itself (loopback or the `--host` address), which blocks DNS rebinding; `--host` on a non-loopback address prints a warning.
- Symlinks inside the deck folder that point outside it are refused (403) for reading, writing and listing.
- `window.lectern` (the whole App) is only exposed in dev builds or with `?test=1`; see *Security model* in the README.

### Fixed
- A dialog's keystrokes reach the dialog: the modal's capture-phase listener stopped every
  key before it arrived, so `⏎` on an image in the picker did nothing.
- Folder watching stops with a status message after three consecutive failed checks instead
  of retrying (and logging) forever.
- The comment box opens after the double-click window so a double-click can still dismiss a note.

## [1.0.0] — 2026-08-29

*Never published to npm; recorded here because the work is in the repository's history.*

### Added
- Notes for AI on slides: `N` or double-click on empty canvas leaves a note at that spot; notes are comment threads (`<p data-by="author|ai">`), turn green when done, reopen on reply, dismiss with a double-click. `lectern notes deck.html` lists the pending ones.
- Autosave (about a second after an edit), with a build stamp in the status bar.
- Type-to-edit: typing on a selected text object edits it and replaces placeholders.
- Documentation for AI assistants (`AGENTS.md`, `lectern guide`), a Claude Code plugin, CLI subcommands (`new`, `notes`, `guide`) and the hosted editor on GitHub Pages.
- A five-minute tutorial with screenshots, linked from the welcome screen and Help.
- Example decks save into a real folder (with reveal.js) and open there; “Your decks” first on the welcome screen; a `Lectern.app` launcher.
- Whale-evolution example: title diagram drawn to scale, the author's notes done.

### Fixed
- The comment box opens after the double-click window so a double-click can still dismiss a note.
- Duplicate CI workflow removed.
