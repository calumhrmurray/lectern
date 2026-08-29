# Lectern — notes for coding assistants

@AGENTS.md — the deck format, the notes-for-AI protocol and the rules for editing a deck the editor has open. The rest of this file is about working on Lectern itself.

Visual editor for HTML slide decks (reveal.js, or any page of <section> slides with a custom driver — `Stage.kind` is 'reveal' | 'plain'). TypeScript + Vite, no UI framework. Read `README.md` first.

## Commands

- `npm test` — unit tests (vitest, jsdom). Fast; run after any change in `src/deck` or `src/stage/geometry.ts`.
- `npm run build` — typecheck + Vite build into `dist/` (also refreshes `public/reveal`) and bundles **`Lectern.html`**, the single double-clickable file users open. Commit it after UI changes.
- `npx playwright test` — end-to-end tests. Needs `dist/` (run the build first) and a free local port; the
  CLI server is started automatically on `test/.tmp/demo` (created by `test/e2e/prepare.js`).
- `node scripts/shot.mjs <folder> <deck.html> out.png [slide] [selector]` — headless screenshot of the
  editor on any deck; the quickest way to eyeball a change or a user's real deck.
- `LECTERN_DIR=path npm run dev` — Vite dev server with the folder API; open `/?ws=local`.

## Invariants worth keeping

- The source DOM (`DeckDocument.doc`) is the truth; the iframe DOM is a rendering. Edit both through
  `Stage.setStyle/setAttr/toggleClass/setInnerHTML/insertHtml/remove/move`, never the live DOM alone.
- Every user-visible change goes through `Editor.edit()`/`begin()`/`end()` so it is undoable.
- Saving must keep untouched sections byte-identical (`DeckDocument.serializeSource`); inline styles are
  patched textually (`patchInlineStyle`), never via `el.style` on the source element.
- Pointer events arrive in page coordinates; the iframe has its own client coordinates. Convert with
  `Editor.frameOffset()` (see `hitTest`, `toSlide`, `beginRotate`, `startTextEdit`).
- Stylesheet rules from the iframe are a different JS realm: use duck typing, not `instanceof`.
- Three ways a deck reaches the canvas: service worker (`fs/<id>/…`, hosted or CLI), the CLI's `/fs/local/…`, or **inline mode**
  (`src/workspace/inline.ts`: blob URLs + fetch/setter shims in a `srcdoc` iframe) when there is no worker, i.e. `Lectern.html` on `file://`.
  `Stage.liveUrlResolver` keeps relative `src` attributes loadable in inline mode.

## Notes for AI inside decks

The protocol is in AGENTS.md (`<div hidden data-ai-note …>` threads of `<p data-by="author|ai">`; act, append your `<p data-by="ai">`,
set `data-ai-note="done"`, never delete). `node cli/index.js notes <deck.html>` lists the pending ones; the editor autosaves, so the
file on disk is current. `plugins/lectern/skills/slides/reference.md` must stay a copy of AGENTS.md (a unit test checks).
