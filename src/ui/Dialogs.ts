/** Modal dialogs: generic modal, welcome screen, pickers, shortcuts, about. */

import type { App } from '../app/App';
import { SLIDE_LAYOUTS } from '../deck/templates';
import { DECK_THEMES } from '../deck/themes';
import type { RecentEntry } from '../workspace/fsa';
import type { DirEntry, Workspace } from '../workspace/Workspace';
import { h, svgIcon, modKey, isMac } from './dom';
import { icons } from './icons';
import { versionLabel } from '../version';

export interface ModalButton { label: string; primary?: boolean; value: string; disabled?: boolean }

export interface ModalOptions {
  title: string;
  body: Node | Node[];
  buttons?: ModalButton[];
  wide?: boolean;
  /** Called with the chosen button value; return false to keep the dialog open. */
  onClose?: (value: string) => boolean | void;
}

let modalSeq = 0;
/** How many modals are open; the app root is `inert` while it is > 0. */
let modalDepth = 0;

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

/** Shows a modal and resolves with the chosen button value ('cancel' on escape/backdrop). */
export function modal(opts: ModalOptions): Promise<string> {
  return new Promise((resolve) => {
    const buttons = opts.buttons ?? [{ label: 'OK', primary: true, value: 'ok' }];
    const backdrop = h('div', { class: 'lec-modal-backdrop' });
    const titleId = `lec-modal-title-${++modalSeq}`;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById('app');
    const finish = (value: string) => {
      if (opts.onClose && opts.onClose(value) === false) return;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      if (--modalDepth === 0) appRoot?.removeAttribute('inert');
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish('cancel'); }
      else if (ev.key === 'Tab') {
        // Keep Tab / Shift+Tab inside the dialog.
        const items = focusableIn(box);
        if (items.length) {
          const cur = document.activeElement as HTMLElement | null;
          const i = cur ? items.indexOf(cur) : -1;
          let next: HTMLElement | null = null;
          if (i === -1 || !box.contains(cur)) next = ev.shiftKey ? items[items.length - 1] : items[0];
          else if (ev.shiftKey && i === 0) next = items[items.length - 1];
          else if (!ev.shiftKey && i === items.length - 1) next = items[0];
          if (next) { ev.preventDefault(); next.focus(); }
        }
      }
      // Enter activates the primary button, except where the focused control handles Enter itself
      // (buttons, textareas and listbox options such as the image cells).
      else if (ev.key === 'Enter' && !(ev.target instanceof HTMLTextAreaElement) && !(ev.target instanceof HTMLButtonElement)
        && !(ev.target instanceof HTMLElement && ev.target.getAttribute('role') === 'option')) {
        const primary = buttons.find((b) => b.primary);
        if (primary) { ev.preventDefault(); finish(primary.value); }
      }
      // Keys aimed at something inside the dialog must reach it: this listener captures on
      // document, so stopping here would swallow Enter on an image cell and every keystroke
      // in an input. The dialog's own bubble listener (below) is what keeps the editor's
      // shortcuts from firing; anything outside the dialog is stopped here.
      if (!(ev.target instanceof Node && box.contains(ev.target))) ev.stopPropagation();
    };
    const box = h('div', { class: `lec-modal${opts.wide ? ' lec-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'lec-modal-head' }, h('span', { id: titleId }, opts.title), h('span', { class: 'lec-spacer' }), h('button', { class: 'lec-btn', type: 'button', title: 'Close', 'aria-label': 'Close dialog', onclick: () => finish('cancel') }, svgIcon(icons.close))),
      h('div', { class: 'lec-modal-body' }, ...(Array.isArray(opts.body) ? opts.body : [opts.body])),
      h('div', { class: 'lec-modal-foot' }, ...buttons.map((b) => h('button', { class: `lec-btn${b.primary ? ' lec-primary' : ''}`, type: 'button', disabled: !!b.disabled, onclick: () => finish(b.value) }, b.label))),
    );
    backdrop.appendChild(box);
    // The editor's shortcuts listen on window; a dialog's keystrokes are its own.
    box.addEventListener('keydown', (ev) => { ev.stopPropagation(); });
    backdrop.addEventListener('pointerdown', (ev) => { if (ev.target === backdrop) finish('cancel'); });
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey, true);
    if (modalDepth++ === 0) appRoot?.setAttribute('inert', '');
    const first = box.querySelector<HTMLElement>('input, select, textarea, .lec-list-item, .lec-img-cell, button.lec-primary');
    (first ?? box.querySelector<HTMLElement>('button'))?.focus();
  });
}

export async function confirmDialog(title: string, message: string, okLabel = 'OK'): Promise<boolean> {
  const v = await modal({ title, body: h('p', {}, message), buttons: [{ label: 'Cancel', value: 'cancel' }, { label: okLabel, value: 'ok', primary: true }] });
  return v === 'ok';
}

export async function promptDialog(title: string, label: string, value = '', placeholder = ''): Promise<string | null> {
  const input = h('input', { class: 'lec-field', type: 'text', value, placeholder }) as HTMLInputElement;
  const v = await modal({ title, body: h('div', { class: 'lec-row' }, h('label', {}, label), input), buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'OK', value: 'ok', primary: true }] });
  return v === 'ok' ? input.value : null;
}

// ---------------------------------------------------------------- welcome

export const TUTORIAL_URL = 'tutorial.html';
export const AGENTS_URL = 'https://github.com/calumhrmurray/lectern/blob/main/AGENTS.md';

export interface ExampleInfo { id: string; title: string; description: string; lang: string; files: string[] }

export function renderWelcome(app: App, container: HTMLElement, recents: RecentEntry[], fsaOk: boolean, examples: ExampleInfo[] = []): void {
  container.replaceChildren(
    h('div', { class: 'lec-welcome-card' },
      h('h1', {}, svgIcon(icons.lectern), 'Lectern'),
      h('p', { class: 'lec-tagline' }, 'A visual editor for HTML presentations. The HTML file is the document. ', h('span', { class: 'lec-sub', title: 'Version and build' }, versionLabel())),
      h('p', { class: 'lec-links' }, 'New here? ', h('a', { href: TUTORIAL_URL, target: '_blank', rel: 'noopener' }, 'Five-minute tutorial'), ' · ', h('a', { href: AGENTS_URL, target: '_blank', rel: 'noopener' }, 'Instructions for your AI assistant')),
      h('div', { class: 'lec-welcome-actions' },
        h('button', { class: 'lec-btn', type: 'button', disabled: !fsaOk, onclick: () => void app.openFolder() },
          svgIcon(icons.folder), h('b', {}, 'Open a folder…'), h('span', {}, fsaOk ? 'Pick the folder that contains your deck. Saves go straight back to the file.' : 'Needs Chrome or Edge. In other browsers, run the CLI (see below).')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => void app.newDeck() },
          svgIcon(icons.plus), h('b', {}, 'New deck…'), h('span', {}, 'Creates a folder with reveal.js, a clean theme and a title slide.')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => void app.openDemo() },
          svgIcon(icons.play), h('b', {}, 'Try the demo'), h('span', {}, 'A sample deck kept in memory. Play with it; download the result if you like.')),
      ),
      recents.length ? h('h3', {}, 'Your decks') : null,
      recents.length ? h('div', { class: 'lec-list' }, ...recents.map((r) =>
        h('button', { class: 'lec-list-item', type: 'button', onclick: () => void app.openRecent(r) },
          svgIcon(icons.folder), h('span', {}, h('b', {}, r.name), ' ', h('span', { class: 'lec-sub' }, `/ ${r.deckPath}`)), h('span', { class: 'lec-spacer' }),
          h('span', { class: 'lec-sub' }, new Date(r.openedAt).toLocaleDateString())))) : null,
      examples.length ? h('h3', {}, 'Example decks') : null,
      examples.length ? h('div', { class: 'lec-list' }, ...examples.map((e) =>
        h('div', { class: 'lec-list-item lec-static' },
          svgIcon(icons.file), h('span', {}, e.title, h('div', { class: 'lec-sub' }, e.description)), h('span', { class: 'lec-spacer' }),
          h('button', { class: 'lec-btn lec-primary', type: 'button', title: 'Copy the deck (with reveal.js) into a folder you choose and open it from there', onclick: () => void app.saveExampleToFolder(e.id) }, 'Save to a folder…'),
          h('button', { class: 'lec-btn', type: 'button', title: 'Open a temporary copy in memory', onclick: () => void app.openExample(e.id) }, 'Preview')))) : null,
      h('p', { class: 'lec-note' },
        'From a terminal: ', h('code', {}, 'npx lectern-editor path/to/deck.html'), ' serves the editor locally for any browser — handy when a coding assistant is editing the same file. ',
        'Works with reveal.js decks (a global ', h('code', {}, 'Reveal'), ') and with any page whose slides are ', h('code', {}, '<section>'), ' elements.'),
    ),
  );
}

// ---------------------------------------------------------------- pickers

/** Lets the user pick one HTML file from a workspace (root and one level of subfolders). */
export async function pickDeckFile(ws: Workspace): Promise<string | null> {
  const candidates: string[] = [];
  const scanDir = async (dir: string, depth: number) => {
    let entries: DirEntry[] = [];
    try { entries = await ws.list(dir); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.kind === 'file' && /\.html?$/i.test(e.name)) candidates.push(p);
      else if (e.kind === 'directory' && depth < 2) await scanDir(p, depth + 1);
    }
  };
  await scanDir('', 0);
  // Only offer files that look like slide decks (reveal.js or a page of <section>s).
  const decks: { path: string; title: string; slides: number }[] = [];
  for (const p of candidates.slice(0, 60)) {
    try {
      const text = await ws.readText(p);
      // A deck is a full document (part files are fragments of sections) with slides, a slides container, or a parts list.
      if (!/<html\b|<!doctype/i.test(text)) continue;
      if (!/<section\b/i.test(text) && !/class="[^"]*\bslides\b/.test(text) && !/\bdata-parts=|\bparts\s*=\s*\[/.test(text)) continue;
      const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() ?? '';
      const slides = (text.match(/<section\b/g) ?? []).length;
      decks.push({ path: p, title, slides });
    } catch { /* skip */ }
  }
  if (!decks.length) {
    await modal({ title: 'No deck found', body: h('p', {}, `No HTML file with <section> slides was found in “${ws.name}”.`) });
    return null;
  }
  if (decks.length === 1) return decks[0].path;
  let chosen = decks[0].path;
  const list = h('div', { class: 'lec-list' });
  const items = decks.map((d) => {
    const b = h('button', { class: `lec-list-item${d.path === chosen ? ' lec-active' : ''}`, type: 'button' },
      svgIcon(icons.file), h('span', {}, d.path, d.title ? h('div', { class: 'lec-sub' }, d.title) : null), h('span', { class: 'lec-spacer' }), h('span', { class: 'lec-sub' }, `${d.slides} sections`));
    b.addEventListener('click', () => { chosen = d.path; for (const it of items) it.classList.toggle('lec-active', it === b); });
    b.addEventListener('dblclick', () => { chosen = d.path; (document.querySelector('.lec-modal .lec-primary') as HTMLButtonElement | null)?.click(); });
    return b;
  });
  list.append(...items);
  const v = await modal({ title: 'Which deck?', body: list, buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Open', value: 'ok', primary: true }] });
  return v === 'ok' ? chosen : null;
}

/** Image chooser: existing images in the folder, or upload a file. Resolves to a workspace path. */
export async function pickImage(ws: Workspace, opts: { onUpload: (file: File) => Promise<string> }): Promise<string | null> {
  const images: string[] = [];
  const scanDir = async (dir: string, depth: number) => {
    let entries: DirEntry[] = [];
    try { entries = await ws.list(dir); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'reveal') continue;
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.kind === 'file' && /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(e.name)) images.push(p);
      else if (e.kind === 'directory' && depth < 3 && images.length < 400) await scanDir(p, depth + 1);
    }
  };
  await scanDir('', 0);
  images.sort();
  let chosen: string | null = null;
  let uploaded: string | null = null;
  const grid = h('div', { class: 'lec-img-grid', role: 'listbox', 'aria-label': 'Images in this folder' });
  const choose = (cell: HTMLElement, p: string) => {
    chosen = p;
    for (const c of cells) { const on = c === cell; c.classList.toggle('lec-active', on); c.setAttribute('aria-selected', String(on)); }
  };
  const cells = images.map((p) => {
    const img = h('img', { alt: '', loading: 'lazy' }) as HTMLImageElement;
    void (ws.assetUrl ? ws.assetUrl(p) : Promise.resolve(ws.urlFor(p))).then((u) => { img.src = u; });
    const cell = h('div', { class: 'lec-img-cell', tabindex: 0, title: p, role: 'option', 'aria-selected': 'false' }, img, h('div', { class: 'lec-name' }, p));
    cell.addEventListener('click', () => choose(cell, p));
    cell.addEventListener('dblclick', () => { choose(cell, p); (document.querySelector('.lec-modal .lec-primary') as HTMLButtonElement | null)?.click(); });
    // The modal's own keydown listener is a capturing one on document, so it runs *before* this handler;
    // it therefore leaves Enter alone on [role=option] and we activate the primary button here.
    cell.addEventListener('keydown', (ev) => {
      if (ev.key === ' ') { ev.preventDefault(); choose(cell, p); }
      else if (ev.key === 'Enter') { ev.preventDefault(); choose(cell, p); (document.querySelector('.lec-modal .lec-primary') as HTMLButtonElement | null)?.click(); }
    });
    return cell;
  });
  grid.append(...cells);
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }) as HTMLInputElement;
  const status = h('span', { class: 'lec-help', style: 'margin-left:8px' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    status.textContent = `Adding ${f.name}…`;
    try {
      uploaded = await opts.onUpload(f);
      (document.querySelector('.lec-modal .lec-primary') as HTMLButtonElement | null)?.click();
    } catch (err) { status.textContent = (err as Error).message; }
  });
  const body = [
    h('div', { class: 'lec-row', style: 'margin-bottom:8px' },
      h('button', { class: 'lec-btn', type: 'button', style: 'border:1px solid var(--line)', onclick: () => fileInput.click() }, svgIcon(icons.upload), 'Add image file…'),
      status, fileInput),
    images.length ? grid : h('p', { class: 'lec-help' }, 'No images in this folder yet. Add one with the button above (it is copied into the deck folder).'),
  ];
  const v = await modal({ title: 'Choose an image', body, wide: true, buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Insert', value: 'ok', primary: true }] });
  if (uploaded) return uploaded;
  return v === 'ok' ? chosen : null;
}

export interface NewDeckOptions { title: string; author: string; width: number; height: number; folderName: string; theme: string }

export async function newDeckDialog(needsFolderName: boolean): Promise<NewDeckOptions | null> {
  const title = h('input', { class: 'lec-field', type: 'text', value: 'My talk' }) as HTMLInputElement;
  const author = h('input', { class: 'lec-field', type: 'text', value: '' , placeholder: 'Your name' }) as HTMLInputElement;
  const folder = h('input', { class: 'lec-field', type: 'text', value: 'my-talk' }) as HTMLInputElement;
  const size = h('select', { class: 'lec-field' },
    h('option', { value: '1280x720', selected: true }, '16:9 — 1280 × 720'),
    h('option', { value: '1920x1080' }, '16:9 — 1920 × 1080'),
    h('option', { value: '1024x768' }, '4:3 — 1024 × 768'),
    h('option', { value: '960x700' }, 'reveal.js default — 960 × 700'),
  ) as HTMLSelectElement;
  title.addEventListener('input', () => { if (!folder.dataset.touched) folder.value = slug(title.value) || 'deck'; });
  folder.addEventListener('input', () => { folder.dataset.touched = '1'; });
  let themeId = DECK_THEMES[0].id;
  const themeGrid = h('div', { class: 'lec-theme-grid' });
  const cards = DECK_THEMES.map((t) => {
    const card = h('button', { class: `lec-theme-card${t.id === themeId ? ' lec-active' : ''}`, type: 'button', title: t.description },
      h('div', { class: 'lec-theme-pv', style: `background:${t.swatch[0]};color:${t.swatch[1]}` },
        h('i', { style: `background:${t.swatch[2]}` }), h('b', {}, 'Aa'), h('span', {}, '— — —')),
      h('b', {}, t.name), h('span', {}, t.description));
    card.addEventListener('click', () => { themeId = t.id; for (const c of cards) c.classList.toggle('lec-active', c === card); });
    return card;
  });
  themeGrid.append(...cards);
  const v = await modal({
    title: 'New deck', wide: true,
    body: [
      h('div', { class: 'lec-row' }, h('label', {}, 'Title'), title),
      h('div', { class: 'lec-row' }, h('label', {}, 'Author'), author),
      h('div', { class: 'lec-row' }, h('label', {}, 'Slide size'), size),
      h('div', { class: 'lec-row lec-row-wide' }, h('label', {}, 'Theme')),
      themeGrid,
      needsFolderName ? h('div', { class: 'lec-row' }, h('label', {}, 'Folder name'), folder) : h('p', { class: 'lec-help' }, 'You will be asked to choose an empty folder next. reveal.js is copied into it so the deck works offline.'),
    ],
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Create', value: 'ok', primary: true }],
  });
  if (v !== 'ok') return null;
  const [w, hgt] = size.value.split('x').map(Number);
  return { title: title.value.trim() || 'Untitled', author: author.value.trim(), width: w, height: hgt, folderName: folder.value.trim() || 'deck', theme: themeId };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function layoutPicker(app: App, at: HTMLElement | { x: number; y: number }): Promise<void> {
  const ed = app.editor;
  const grid = h('div', { class: 'lec-layout-grid' });
  let done: (() => void) | null = null;
  for (const l of SLIDE_LAYOUTS) {
    const card = h('button', { class: 'lec-layout-card', type: 'button', onclick: () => { ed.addSlide(l.html(ed.stage.slideSize)); done?.(); } },
      h('div', { class: 'lec-layout-pv', html: layoutPreview(l.id) }), h('b', {}, l.name), h('span', {}, l.hint));
    grid.appendChild(card);
  }
  grid.appendChild(h('button', { class: 'lec-layout-card', type: 'button', disabled: !ed.doc.length, onclick: () => { ed.duplicateSlide(); done?.(); } },
    h('div', { class: 'lec-layout-pv', html: layoutPreview('dup') }), h('b', {}, 'Duplicate current'), h('span', {}, 'Copy of this slide')));
  void at;
  return new Promise((resolve) => {
    let closing = false;
    const p = modal({ title: 'New slide', body: grid, wide: true, buttons: [{ label: 'Cancel', value: 'cancel' }] });
    done = () => { if (!closing) { closing = true; (document.querySelector('.lec-modal-backdrop .lec-modal-head .lec-btn') as HTMLButtonElement | null)?.click(); } };
    void p.then(() => resolve());
  });
}

function layoutPreview(id: string): string {
  const bar = (x: number, y: number, w: number, hh: number) => `<i style="left:${x}%;top:${y}%;width:${w}%;height:${hh}%"></i>`;
  switch (id) {
    case 'title': return bar(10, 30, 60, 14) + bar(10, 52, 40, 6);
    case 'title-bullets': return bar(8, 10, 60, 10) + bar(10, 32, 55, 5) + bar(10, 45, 50, 5) + bar(10, 58, 58, 5);
    case 'title-text': return bar(8, 10, 60, 10) + bar(8, 32, 80, 5) + bar(8, 42, 76, 5) + bar(8, 52, 60, 5);
    case 'two-cols': return bar(8, 10, 60, 10) + bar(8, 32, 38, 5) + bar(8, 44, 34, 5) + bar(54, 32, 38, 5) + bar(54, 44, 30, 5);
    case 'section': return bar(10, 38, 70, 14);
    case 'image': return bar(8, 10, 60, 10) + `<i style="left:20%;top:30%;width:60%;height:55%;background:#c9c4b8"></i>`;
    case 'dup': return `<i style="left:8%;top:10%;width:84%;height:80%;background:#ddd8cc;border:1px dashed #999"></i>`;
    default: return '';
  }
}

// ---------------------------------------------------------------- info dialogs

export function shortcutsDialog(): Promise<string> {
  const M = isMac() ? '⌘' : 'Ctrl';
  const row = (k: string, d: string) => h('div', {}, h('span', {}, d), h('span', { class: 'lec-kbd' }, k));
  return modal({
    title: 'Keyboard shortcuts', wide: true,
    body: h('div', { class: 'lec-shortcuts' },
      row(`${M} S`, 'Save'), row(`${M} O`, 'Open a folder'),
      row(`${M} Z / ${M} ⇧ Z`, 'Undo / redo'), row(`${M} Y`, 'Redo'),
      row('Double-click', 'Edit text'), row('Esc', 'Stop editing / deselect'),
      row(`${M} C / X / V`, 'Copy / cut / paste objects'), row(`${M} D`, 'Duplicate'),
      row('⌫', 'Delete selection'), row(`${M} A`, 'Select all objects on the slide'),
      row('Arrows', 'Nudge 1 px (⇧: 10 px)'), row('⇧ drag', 'Constrain / keep aspect'),
      row('⌥ drag', 'Ignore snapping'), row('Click again', 'Select the parent object'),
      row('PgUp / PgDn', 'Previous / next slide'), row('Home / End', 'First / last slide'),
      row(`${M} C / ${M} V`, 'Copy / paste whole slides (in the slide list)'), row(`${M} ⇧ N`, 'New slide'),
      row(`${M} ] / ${M} [`, 'Bring forward / send backward'), row(`${M} ⇧ ] / [`, 'Front / back'),
      row('⏎', 'Edit the selected text'), row('Type', 'With a text object selected: start editing, replacing its text'), row('N', 'New note for AI, where the pointer is'), row('double-click / right-click', 'Note for AI, where you point'), row('+ / − / 0', 'Zoom in / out / fit (nothing selected)'),
      row('M', 'Map of the deck — sections across, stacks down'), row('Q', 'Quiet room (the default) — show or hide the panels'), row('Space (hold)', 'Bring the hidden chrome back while held'),
      row(`${M} B / I / U / K`, 'Bold / italic / underline / link (while editing text)'), row('Tab / ⇧ Tab', 'Indent / outdent list item (while editing)'),
      row(`${M} ⏎`, 'Finish editing text / apply HTML'), row('?', 'This list'),
    ),
  });
}

export function aboutDialog(): Promise<string> {
  return modal({
    title: 'About Lectern',
    body: [
      h('p', {}, 'Lectern edits reveal.js presentations visually. It loads your HTML file, renders it with the deck’s own reveal.js, and writes only the slides you changed back into the file — comments, indentation and untouched slides stay exactly as they were.'),
      h('p', { class: 'lec-help' }, 'MIT licensed. reveal.js is © Hakim El Hattab and contributors, MIT licensed. Not affiliated with any presentation software vendor.'),
      h('p', { class: 'lec-help' }, `${versionLabel()} · Mod key: ${modKey()} · Browser support for “Open folder”: Chrome, Edge and other Chromium browsers. Elsewhere, use the CLI.`),
    ],
  });
}
