/** The top toolbar. */

import type { App } from '../app/App';
import { h, svgIcon, modKey } from './dom';
import { icons, type IconName } from './icons';
import { showMenu, type MenuItem } from './Menu';

export class Toolbar {
  private buttons = new Map<string, HTMLButtonElement>();
  private zoomVal!: HTMLElement;
  private textGroup!: HTMLElement;
  private insertGroup!: HTMLElement;

  constructor(readonly app: App, readonly container: HTMLElement) {
    this.build();
  }

  private btn(id: string, icon: IconName | null, label: string | null, title: string, onClick: (ev: MouseEvent) => void, opts: { caret?: boolean; cls?: string } = {}): HTMLButtonElement {
    const b = h('button', { class: `lec-btn${opts.cls ? ' ' + opts.cls : ''}`, type: 'button', title, onclick: onClick, dataset: { action: id } },
      icon ? svgIcon(icons[icon]) : null, label, opts.caret ? svgIcon(icons.chevronDown, 'lec-icon lec-caret') : null);
    this.buttons.set(id, b);
    return b;
  }

  private build(): void {
    const app = this.app;
    const ed = () => app.editor;
    const M = modKey();
    const c = this.container;
    c.replaceChildren();

    c.append(
      this.btn('menu', 'lectern', null, 'Lectern menu', (e) => this.appMenu(e.currentTarget as HTMLElement), { caret: true, cls: 'lec-brand' }),
      sep(),
      group(
        this.btn('undo', 'undo', null, `Undo (${M}Z)`, () => ed().undo()),
        this.btn('redo', 'redo', null, `Redo (${M}⇧Z)`, () => ed().redo()),
      ),
      sep(),
      group(
        this.btn('newslide', 'plus', 'Slide', `New slide (${M}⇧N)`, (e) => app.showNewSlideMenu(e.currentTarget as HTMLElement), { caret: true }),
      ),
      (this.insertGroup = group(
        sep(),
        this.btn('text', 'text', 'Text', 'Insert a text box (T)', () => ed().insertElement('text', { edit: true })),
        this.btn('title', 'title', null, 'Insert a heading', () => ed().insertElement('title', { edit: true })),
        this.btn('bullets', 'bullets', null, 'Insert a bullet list', () => ed().insertElement('bullets', { edit: true })),
        this.btn('image', 'image', 'Image', 'Insert an image (I)', () => void app.insertImageViaDialog()),
        this.btn('shape', 'shape', 'Shape', 'Insert a shape (S)', (e) => this.shapeMenu(e.currentTarget as HTMLElement), { caret: true }),
        this.btn('more', 'more', null, 'More objects', (e) => this.insertMoreMenu(e.currentTarget as HTMLElement)),
        sep(),
        this.btn('arrange', 'objCenterH', 'Arrange', 'Align, distribute, order', (e) => this.arrangeMenu(e.currentTarget as HTMLElement), { caret: true }),
      )),
      (this.textGroup = group(
        sep(),
        this.btn('bold', 'bold', null, `Bold (${M}B)`, () => ed().textSession?.exec('bold')),
        this.btn('italic', 'italic', null, `Italic (${M}I)`, () => ed().textSession?.exec('italic')),
        this.btn('underline', 'underline', null, `Underline (${M}U)`, () => ed().textSession?.exec('underline')),
        this.btn('strike', 'strike', null, 'Strikethrough', () => ed().textSession?.exec('strike')),
        this.btn('ul', 'ul', null, 'Bullet list', () => ed().textSession?.exec('ul')),
        this.btn('ol', 'ol', null, 'Numbered list', () => ed().textSession?.exec('ol')),
        this.btn('link', 'link', null, `Link (${M}K)`, () => ed().textSession?.exec('link')),
        this.btn('done', 'check', 'Done', `Finish editing (Esc)`, () => ed().endTextEdit()),
      )),
      h('div', { class: 'lec-spacer' }),
      group(
        this.btn('snap', 'magnet', null, 'Snap to guides', () => { ed().snapping = !ed().snapping; this.update(); }),
      ),
      sep(),
      h('div', { class: 'lec-zoom' },
        this.btn('zoomout', 'zoomOut', null, 'Zoom out (−)', () => app.zoomBy(-1)),
        (this.zoomVal = h('span', { class: 'lec-zoom-val', title: 'Zoom to fit', onclick: () => app.setZoom(1) }, 'fit')),
        this.btn('zoomin', 'zoomIn', null, 'Zoom in (+)', () => app.zoomBy(1)),
      ),
      sep(),
      group(
        this.btn('navigator', 'navigator', null, 'Show/hide slide navigator', () => app.toggle('navigator')),
        this.btn('notes', 'notes', null, 'Speaker notes', () => app.panels.toggle('notes')),
        this.btn('code', 'code', null, 'Slide HTML', () => app.panels.toggle('html')),
        this.btn('inspector', 'inspector', null, 'Show/hide inspector', () => app.toggle('inspector')),
      ),
      sep(),
      group(
        this.btn('present', 'play', 'Present', 'Save and open the presentation in a new tab', () => app.present()),
        this.btn('save', 'save', 'Save', `Save (${M}S)`, () => void app.save(), { cls: 'lec-warm' }),
      ),
    );
    this.update();
  }

  update(): void {
    const app = this.app;
    const ed = app.editor;
    const has = ed.ready && ed.doc.length > 0;
    const sel = ed.selection().length > 0;
    const text = !!ed.textSession;
    const set = (id: string, enabled: boolean, on?: boolean) => {
      const b = this.buttons.get(id);
      if (!b) return;
      b.disabled = !enabled;
      if (on !== undefined) b.classList.toggle('lec-on', on);
    };
    set('undo', ed.history.canUndo);
    set('redo', ed.history.canRedo);
    this.buttons.get('undo')!.title = `Undo${ed.history.undoLabel ? ' ' + ed.history.undoLabel : ''} (${modKey()}Z)`;
    this.buttons.get('redo')!.title = `Redo${ed.history.redoLabel ? ' ' + ed.history.redoLabel : ''} (${modKey()}⇧Z)`;
    set('newslide', ed.ready);
    for (const id of ['text', 'title', 'bullets', 'image', 'shape', 'more']) set(id, has);
    set('arrange', has && sel);
    this.textGroup.style.display = text ? '' : 'none';
    this.insertGroup.style.display = text ? 'none' : '';
    const st = ed.textSession?.state();
    set('bold', text, st?.bold); set('italic', text, st?.italic); set('underline', text, st?.underline);
    set('strike', text); set('ul', text, st?.list === 'ul'); set('ol', text, st?.list === 'ol'); set('link', text, st?.link);
    set('snap', true, ed.snapping);
    set('present', has); set('save', ed.ready && !!app.workspace?.writable);
    this.buttons.get('save')!.classList.toggle('lec-dirty', ed.ready && ed.doc.dirty);
    set('navigator', true, app.visible.navigator);
    set('inspector', true, app.visible.inspector);
    set('notes', has, app.panels.visible && app.panels.tab === 'notes');
    set('code', has, app.panels.visible && app.panels.tab === 'html');
    set('zoomin', has); set('zoomout', has);
    this.zoomVal.textContent = app.zoom === 1 ? 'fit' : `${Math.round(app.zoom * 100)}%`;
  }

  private appMenu(anchor: HTMLElement): void {
    const app = this.app;
    const M = modKey();
    void showMenu([
      { label: 'Open folder…', icon: 'folder', shortcut: `${M}O`, onSelect: () => void app.openFolder() },
      { label: 'Open another deck in this folder…', icon: 'file', disabled: !app.workspace, onSelect: () => void app.pickDeckInWorkspace() },
      { label: 'New deck…', icon: 'plus', onSelect: () => void app.newDeck() },
      { label: 'Try the demo deck', onSelect: () => void app.openDemo() },
      { separator: true },
      { label: 'Save', icon: 'save', shortcut: `${M}S`, disabled: !app.editor.ready, onSelect: () => void app.save() },
      { label: 'Download a copy…', icon: 'download', disabled: !app.editor.ready, onSelect: () => app.download() },
      { label: 'Reload from disk', disabled: !app.editor.ready, onSelect: () => void app.reload() },
      { separator: true },
      { label: 'Present', icon: 'play', disabled: !app.editor.ready, onSelect: () => app.present() },
      { separator: true },
      { label: 'Keyboard shortcuts', icon: 'help', shortcut: '?', onSelect: () => app.showShortcuts() },
      { label: 'About Lectern', onSelect: () => app.showAbout() },
    ], anchor);
  }

  private shapeMenu(anchor: HTMLElement): void {
    const ed = this.app.editor;
    const items: MenuItem[] = [
      { label: 'Rectangle', icon: 'rect', onSelect: () => ed.insertElement('rect') },
      { label: 'Rounded rectangle', icon: 'rounded', onSelect: () => ed.insertElement('rounded-rect') },
      { label: 'Ellipse', icon: 'ellipse', onSelect: () => ed.insertElement('ellipse') },
      { label: 'Outlined box', icon: 'outline', onSelect: () => ed.insertElement('outline') },
      { label: 'Line', icon: 'line', onSelect: () => ed.insertElement('line') },
      { label: 'Arrow', icon: 'arrow', onSelect: () => ed.insertElement('arrow') },
      { label: 'Callout', icon: 'callout', onSelect: () => ed.insertElement('callout', { edit: true }) },
    ];
    void showMenu(items, anchor);
  }

  private insertMoreMenu(anchor: HTMLElement): void {
    const ed = this.app.editor;
    void showMenu([
      { label: 'Table', icon: 'table', onSelect: () => ed.insertElement('table') },
      { label: 'Code block', icon: 'code', onSelect: () => ed.insertElement('code', { edit: true }) },
      { label: 'Equation (LaTeX)', icon: 'equation', onSelect: () => ed.insertElement('equation', { edit: true }), hint: ed.stage.hasMath ? '' : 'no math plugin loaded' },
      { label: 'Web embed (iframe)', icon: 'embed', onSelect: () => ed.insertElement('iframe') },
      { separator: true },
      { label: 'Paste', shortcut: `${modKey()}V`, disabled: ed.clipboard?.kind !== 'elements', onSelect: () => ed.paste() },
    ], anchor);
  }

  private arrangeMenu(anchor: HTMLElement): void {
    const ed = this.app.editor;
    const sel = ed.selection();
    const el = ed.primary;
    const M = modKey();
    void showMenu([
      { label: sel.length > 1 ? 'Align objects' : 'Align to slide', title: true },
      { label: 'Left', icon: 'objLeft', onSelect: () => ed.align('left') },
      { label: 'Centre', icon: 'objCenterH', onSelect: () => ed.align('center') },
      { label: 'Right', icon: 'objRight', onSelect: () => ed.align('right') },
      { label: 'Top', icon: 'objTop', onSelect: () => ed.align('top') },
      { label: 'Middle', icon: 'objMiddle', onSelect: () => ed.align('middle') },
      { label: 'Bottom', icon: 'objBottom', onSelect: () => ed.align('bottom') },
      { separator: true },
      { label: 'Distribute horizontally', icon: 'distributeH', disabled: sel.length < 3, onSelect: () => ed.distribute('h') },
      { label: 'Distribute vertically', icon: 'distributeV', disabled: sel.length < 3, onSelect: () => ed.distribute('v') },
      { separator: true },
      { label: 'Bring to front', icon: 'front', shortcut: `${M}⇧]`, disabled: !el, onSelect: () => el && ed.reorder(el, 'front') },
      { label: 'Bring forward', icon: 'arrowUp', shortcut: `${M}]`, disabled: !el, onSelect: () => el && ed.reorder(el, 'forward') },
      { label: 'Send backward', icon: 'arrowDown', shortcut: `${M}[`, disabled: !el, onSelect: () => el && ed.reorder(el, 'backward') },
      { label: 'Send to back', icon: 'back', shortcut: `${M}⇧[`, disabled: !el, onSelect: () => el && ed.reorder(el, 'back') },
      { separator: true },
      { label: el && ed.isFree(el) ? 'Return to layout flow' : 'Detach from layout (free)', icon: el && ed.isFree(el) ? 'flow' : 'free', disabled: !el, onSelect: () => { for (const s of sel) ed.setFree(s, !ed.isFree(s)); } },
    ], anchor);
  }
}

function sep(): HTMLElement { return h('div', { class: 'lec-sep' }); }
function group(...children: HTMLElement[]): HTMLElement { return h('div', { class: 'lec-group' }, ...children); }
