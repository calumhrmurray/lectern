/** Modal dialogs: generic modal, welcome screen, pickers, shortcuts, about. */

import type { App } from '../app/App';
import { SLIDE_LAYOUTS } from '../deck/templates';
import { DECK_THEMES } from '../deck/themes';
import type { RecentEntry } from '../workspace/fsa';
import type { DirEntry, Workspace } from '../workspace/Workspace';
import { h, svgIcon, modKey, isMac } from './dom';
import { icons } from './icons';
import { versionLabel } from '../version';
import { t } from '../i18n';

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
    const buttons = opts.buttons ?? [{ label: t('common.ok'), primary: true, value: 'ok' }];
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
      h('div', { class: 'lec-modal-head' }, h('span', { id: titleId }, opts.title), h('span', { class: 'lec-spacer' }), h('button', { class: 'lec-btn', type: 'button', title: t('common.close'), 'aria-label': t('common.closeDialog'), onclick: () => finish('cancel') }, svgIcon(icons.close))),
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

export async function confirmDialog(title: string, message: string, okLabel = t('common.ok')): Promise<boolean> {
  const v = await modal({ title, body: h('p', {}, message), buttons: [{ label: t('common.cancel'), value: 'cancel' }, { label: okLabel, value: 'ok', primary: true }] });
  return v === 'ok';
}

export async function promptDialog(title: string, label: string, value = '', placeholder = ''): Promise<string | null> {
  const input = h('input', { class: 'lec-field', type: 'text', value, placeholder }) as HTMLInputElement;
  const v = await modal({ title, body: h('div', { class: 'lec-row' }, h('label', {}, label), input), buttons: [{ label: t('common.cancel'), value: 'cancel' }, { label: t('common.ok'), value: 'ok', primary: true }] });
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
      h('p', { class: 'lec-tagline' }, t('welcome.tagline'), h('span', { class: 'lec-sub', title: t('welcome.versionTitle') }, versionLabel())),
      h('p', { class: 'lec-links' }, t('welcome.newHere'), h('a', { href: TUTORIAL_URL, target: '_blank', rel: 'noopener' }, t('welcome.tutorial')), ' · ', h('a', { href: AGENTS_URL, target: '_blank', rel: 'noopener' }, t('welcome.agents'))),
      h('p', { class: 'lec-links lec-lang' },
        h('button', { class: 'lec-lang-btn', type: 'button', dataset: { action: 'lang-en' }, onclick: () => app.setLocaleChoice('en') }, 'English'),
        ' · ',
        h('button', { class: 'lec-lang-btn', type: 'button', dataset: { action: 'lang-zh' }, onclick: () => app.setLocaleChoice('zh-CN') }, '中文')),
      h('div', { class: 'lec-welcome-actions' },
        h('button', { class: 'lec-btn', type: 'button', dataset: { action: 'welcome-open-folder' }, disabled: !fsaOk, onclick: () => void app.openFolder() },
          svgIcon(icons.folder), h('b', {}, t('welcome.openFolder.title')), h('span', {}, fsaOk ? t('welcome.openFolder.hint') : t('welcome.openFolder.unsupported'))),
        h('button', { class: 'lec-btn', type: 'button', dataset: { action: 'welcome-new-deck' }, onclick: () => void app.newDeck() },
          svgIcon(icons.plus), h('b', {}, t('common.newDeck')), h('span', {}, t('welcome.newDeck.hint'))),
        h('button', { class: 'lec-btn', type: 'button', dataset: { action: 'welcome-demo' }, onclick: () => void app.openDemo() },
          svgIcon(icons.play), h('b', {}, t('welcome.demo.title')), h('span', {}, t('welcome.demo.hint'))),
      ),
      recents.length ? h('h3', {}, t('welcome.yourDecks')) : null,
      recents.length ? h('div', { class: 'lec-list' }, ...recents.map((r) =>
        h('button', { class: 'lec-list-item', type: 'button', onclick: () => void app.openRecent(r) },
          svgIcon(icons.folder), h('span', {}, h('b', {}, r.name), ' ', h('span', { class: 'lec-sub' }, `/ ${r.deckPath}`)), h('span', { class: 'lec-spacer' }),
          h('span', { class: 'lec-sub' }, new Date(r.openedAt).toLocaleDateString())))) : null,
      examples.length ? h('h3', {}, t('welcome.exampleDecks')) : null,
      examples.length ? h('div', { class: 'lec-list' }, ...examples.map((e) =>
        h('div', { class: 'lec-list-item lec-static', dataset: { example: e.id } },
          svgIcon(icons.file), h('span', {}, e.title, h('div', { class: 'lec-sub' }, e.description)), h('span', { class: 'lec-spacer' }),
          h('button', { class: 'lec-btn lec-primary', type: 'button', dataset: { action: 'example-save-folder' }, title: t('welcome.example.saveTitle'), onclick: () => void app.saveExampleToFolder(e.id) }, t('welcome.example.save')),
          h('button', { class: 'lec-btn', type: 'button', dataset: { action: 'example-preview' }, title: t('welcome.example.previewTitle'), onclick: () => void app.openExample(e.id) }, t('common.preview'))))) : null,
      h('p', { class: 'lec-note' },
        t('welcome.note.fromTerminal'), h('code', {}, 'npx lectern-editor path/to/deck.html'), t('welcome.note.serves'),
        t('welcome.note.withReveal'), h('code', {}, 'Reveal'), t('welcome.note.andSlides'), h('code', {}, '<section>'), t('welcome.note.elements')),
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
    await modal({ title: t('pick.deck.none.title'), body: h('p', {}, t('pick.deck.none.body', { name: ws.name })) });
    return null;
  }
  if (decks.length === 1) return decks[0].path;
  let chosen = decks[0].path;
  const list = h('div', { class: 'lec-list' });
  const items = decks.map((d) => {
    const b = h('button', { class: `lec-list-item${d.path === chosen ? ' lec-active' : ''}`, type: 'button' },
      svgIcon(icons.file), h('span', {}, d.path, d.title ? h('div', { class: 'lec-sub' }, d.title) : null), h('span', { class: 'lec-spacer' }), h('span', { class: 'lec-sub' }, t('pick.deck.sections', { count: d.slides })));
    b.addEventListener('click', () => { chosen = d.path; for (const it of items) it.classList.toggle('lec-active', it === b); });
    b.addEventListener('dblclick', () => { chosen = d.path; (document.querySelector('.lec-modal .lec-primary') as HTMLButtonElement | null)?.click(); });
    return b;
  });
  list.append(...items);
  const v = await modal({ title: t('pick.deck.which'), body: list, buttons: [{ label: t('common.cancel'), value: 'cancel' }, { label: t('common.open'), value: 'ok', primary: true }] });
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
  const grid = h('div', { class: 'lec-img-grid', role: 'listbox', 'aria-label': t('pick.image.grid') });
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
    status.textContent = t('pick.image.adding', { name: f.name });
    try {
      uploaded = await opts.onUpload(f);
      (document.querySelector('.lec-modal .lec-primary') as HTMLButtonElement | null)?.click();
    } catch (err) { status.textContent = (err as Error).message; }
  });
  const body = [
    h('div', { class: 'lec-row', style: 'margin-bottom:8px' },
      h('button', { class: 'lec-btn', type: 'button', style: 'border:1px solid var(--line)', onclick: () => fileInput.click() }, svgIcon(icons.upload), t('pick.image.add')),
      status, fileInput),
    images.length ? grid : h('p', { class: 'lec-help' }, t('pick.image.none')),
  ];
  const v = await modal({ title: t('common.chooseImage'), body, wide: true, buttons: [{ label: t('common.cancel'), value: 'cancel' }, { label: t('common.insert'), value: 'ok', primary: true }] });
  if (uploaded) return uploaded;
  return v === 'ok' ? chosen : null;
}

export interface NewDeckOptions { title: string; author: string; width: number; height: number; folderName: string; theme: string }

export async function newDeckDialog(needsFolderName: boolean): Promise<NewDeckOptions | null> {
  const title = h('input', { class: 'lec-field', type: 'text', value: t('newDeck.titleDefault') }) as HTMLInputElement;
  const author = h('input', { class: 'lec-field', type: 'text', value: '', placeholder: t('newDeck.authorPlaceholder') }) as HTMLInputElement;
  const folder = h('input', { class: 'lec-field', type: 'text', value: 'my-talk' }) as HTMLInputElement;
  const size = h('select', { class: 'lec-field' },
    h('option', { value: '1280x720', selected: true }, t('newDeck.size.1280x720')),
    h('option', { value: '1920x1080' }, t('newDeck.size.1920x1080')),
    h('option', { value: '1024x768' }, t('newDeck.size.1024x768')),
    h('option', { value: '960x700' }, t('newDeck.size.960x700')),
  ) as HTMLSelectElement;
  title.addEventListener('input', () => { if (!folder.dataset.touched) folder.value = slug(title.value) || 'deck'; });
  folder.addEventListener('input', () => { folder.dataset.touched = '1'; });
  let themeId = DECK_THEMES[0].id;
  const themeGrid = h('div', { class: 'lec-theme-grid' });
  const cards = DECK_THEMES.map((theme) => {
    const card = h('button', { class: `lec-theme-card${theme.id === themeId ? ' lec-active' : ''}`, type: 'button', dataset: { theme: theme.id }, title: theme.description },
      h('div', { class: 'lec-theme-pv', style: `background:${theme.swatch[0]};color:${theme.swatch[1]}` },
        h('i', { style: `background:${theme.swatch[2]}` }), h('b', {}, 'Aa'), h('span', {}, '— — —')),
      h('b', {}, theme.name), h('span', {}, theme.description));
    card.addEventListener('click', () => { themeId = theme.id; for (const c of cards) c.classList.toggle('lec-active', c === card); });
    return card;
  });
  themeGrid.append(...cards);
  const v = await modal({
    title: t('newDeck.title'), wide: true,
    body: [
      h('div', { class: 'lec-row' }, h('label', {}, t('newDeck.field.title')), title),
      h('div', { class: 'lec-row' }, h('label', {}, t('newDeck.field.author')), author),
      h('div', { class: 'lec-row' }, h('label', {}, t('common.slideSize')), size),
      h('div', { class: 'lec-row lec-row-wide' }, h('label', {}, t('newDeck.field.theme'))),
      themeGrid,
      needsFolderName ? h('div', { class: 'lec-row' }, h('label', {}, t('newDeck.field.folder')), folder) : h('p', { class: 'lec-help' }, t('newDeck.folderHelp')),
    ],
    buttons: [{ label: t('common.cancel'), value: 'cancel' }, { label: t('common.create'), value: 'ok', primary: true }],
  });
  if (v !== 'ok') return null;
  const [w, hgt] = size.value.split('x').map(Number);
  return { title: title.value.trim() || t('common.untitled'), author: author.value.trim(), width: w, height: hgt, folderName: folder.value.trim() || 'deck', theme: themeId };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function layoutPicker(app: App, at: HTMLElement | { x: number; y: number }): Promise<void> {
  const ed = app.editor;
  const grid = h('div', { class: 'lec-layout-grid' });
  let done: (() => void) | null = null;
  for (const l of SLIDE_LAYOUTS) {
    const card = h('button', { class: 'lec-layout-card', type: 'button', dataset: { action: `layout-${l.id}` }, onclick: () => { ed.addSlide(l.html(ed.stage.slideSize)); done?.(); } },
      h('div', { class: 'lec-layout-pv', html: layoutPreview(l.id) }), h('b', {}, t(l.nameKey)), h('span', {}, l.hintKey ? t(l.hintKey) : ''));
    grid.appendChild(card);
  }
  grid.appendChild(h('button', { class: 'lec-layout-card', type: 'button', dataset: { action: 'layout-duplicate' }, disabled: !ed.doc.length, onclick: () => { ed.duplicateSlide(); done?.(); } },
    h('div', { class: 'lec-layout-pv', html: layoutPreview('dup') }), h('b', {}, t('layout.duplicate.name')), h('span', {}, t('layout.duplicate.hint'))));
  void at;
  return new Promise((resolve) => {
    let closing = false;
    const p = modal({ title: t('common.newSlide'), body: grid, wide: true, buttons: [{ label: t('common.cancel'), value: 'cancel' }] });
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
    title: t('common.shortcuts'), wide: true,
    body: h('div', { class: 'lec-shortcuts' },
      row(`${M} S`, t('common.save')), row(`${M} O`, t('shortcuts.openFolder')),
      row(`${M} Z / ${M} ⇧ Z`, t('shortcuts.undoRedo')), row(`${M} Y`, t('common.redo')),
      row('Double-click', t('shortcuts.editText')), row('Esc', t('shortcuts.stopEditing')),
      row(`${M} C / X / V`, t('shortcuts.copyCutPaste')), row(`${M} D`, t('common.duplicate')),
      row('⌫', t('shortcuts.delete')), row(`${M} A`, t('shortcuts.selectAll')),
      row('Arrows', t('shortcuts.nudge')), row('⇧ drag', t('shortcuts.constrain')),
      row('⌥ drag', t('shortcuts.ignoreSnapping')), row('Click selected text', t('shortcuts.caret')),
      row('PgUp / PgDn', t('shortcuts.prevNext')), row('Home / End', t('shortcuts.firstLast')),
      row(`${M} C / ${M} V`, t('shortcuts.copyPasteSlides')), row(`${M} ⇧ N`, t('common.newSlide')),
      row(`${M} ] / ${M} [`, t('shortcuts.bringForward')), row(`${M} ⇧ ] / [`, t('shortcuts.frontBack')),
      row('⏎', t('shortcuts.editSelected')), row('Type', t('shortcuts.typeText')), row('N', t('shortcuts.newSlideShaped')), row('right-click / double-click', t('shortcuts.noteForAi')), row('+ / − / 0', t('shortcuts.zoom')),
      row('M', t('common.mapTooltip')), row('Q', t('shortcuts.quietRoom')), row('Space (hold)', t('shortcuts.peek')),
      row('Drag · double / triple-click', t('shortcuts.selectText')), row(`${M} B / I / U / K`, t('shortcuts.textFormatting')), row('Tab / ⇧ Tab', t('shortcuts.indent')),
      row(`${M} ⏎`, t('shortcuts.finishEditing')), row('?', t('shortcuts.thisList')),
    ),
  });
}

export function aboutDialog(): Promise<string> {
  return modal({
    title: t('common.about'),
    body: [
      h('p', {}, t('about.intro')),
      h('p', { class: 'lec-help' }, t('about.license')),
      h('p', { class: 'lec-help' }, t('about.meta', { version: versionLabel(), modKey: modKey() })),
    ],
  });
}
