# Lectern — notes for coding assistants

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

Slides may contain `<div hidden data-ai-note style="position:absolute;left:Xpx;top:Ypx;…">instruction</div>`. Each one is a
request from the author for that spot on the slide (coordinates in slide units, usually 1280×720). When asked to "do the
notes" in a deck: act on each one in the file, match the deck's existing style, then delete the note element. Never leave
`data-ai-note` elements visible (they are `hidden` on purpose). `node scripts/ai-notes.mjs <deck.html>` lists them.
