# Changelog

All notable changes to Lectern are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
- Folder watching stops with a status message after three consecutive failed checks instead of retrying (and logging) forever.

### Added
- `lectern new --lang xx` sets the deck's `<html lang>`.
- `CHANGELOG.md`, `.nvmrc` (Node 20), a version-sync test for the Claude Code plugin manifest, unit tests for the canvas pointer state machine and for the CLI server's request checks.

## [1.0.0] — 2026-08-29

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
