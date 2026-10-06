/** The top toolbar. */

import type { App } from '../app/App';
import { t } from '../i18n';
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

  private btn(id: string, icon: IconName | null, label: string | null, title: string, onClick: (ev: MouseEvent) => void, opts: { caret?: boolean; cls?: string; popup?: 'menu' | 'dialog' } = {}): HTMLButtonElement {
    const b = h('button', {
      class: `lec-btn${opts.cls ? ' ' + opts.cls : ''}`, type: 'button', title, 'aria-label': plainLabel(title), onclick: onClick, dataset: { action: id },
      'aria-haspopup': opts.popup ?? null, 'aria-expanded': opts.popup === 'menu' ? 'false' : null,
    },
      icon ? svgIcon(icons[icon]) : null, label, opts.caret ? svgIcon(icons.chevronDown, 'lec-icon lec-caret') : null);
    this.buttons.set(id, b);
    return b;
  }

  /** Opens a menu below `anchor` and keeps its aria-expanded state in step. */
  private openMenu(anchor: HTMLElement, items: MenuItem[]): void {
    anchor.setAttribute('aria-expanded', 'true');
    void showMenu(items, anchor).then(() => anchor.setAttribute('aria-expanded', 'false'));
  }

  private build(): void {
    const app = this.app;
    const ed = () => app.editor;
    const M = modKey();
    const c = this.container;
    c.replaceChildren();

    c.append(
      this.btn('menu', 'lectern', null, t('toolbar.menu.title'), (e) => this.appMenu(e.currentTarget as HTMLElement), { caret: true, cls: 'lec-brand', popup: 'menu' }),
      sep(),
      group(
        this.btn('undo', 'undo', null, `${t('toolbar.undo.title')} (${M}Z)`, () => ed().undo()),
        this.btn('redo', 'redo', null, `${t('toolbar.redo.title')} (${M}⇧Z)`, () => ed().redo()),
      ),
      sep(),
      group(
        this.btn('newslide', 'plus', t('toolbar.newSlide.label'), `${t('toolbar.newSlide.title')} (${M}⇧N)`, (e) => app.showNewSlideMenu(e.currentTarget as HTMLElement), { caret: true, popup: 'dialog' }),
      ),
      (this.insertGroup = group(
        sep(),
        this.btn('text', 'text', t('toolbar.text.label'), t('toolbar.text.title'), () => ed().insertElement('text', { edit: true })),
        this.btn('title', 'title', null, t('toolbar.heading.title'), () => ed().insertElement('title', { edit: true })),
        this.btn('bullets', 'bullets', null, t('toolbar.bullets.title'), () => ed().insertElement('bullets', { edit: true })),
        this.btn('ainote', 'note', t('toolbar.aiNote.label'), t('toolbar.aiNote.title'), () => ed().insertElement('ainote', { edit: true })),
        this.btn('image', 'image', t('toolbar.image.label'), t('toolbar.image.title'), () => void app.insertImageViaDialog()),
        this.btn('shape', 'shape', t('toolbar.shape.label'), t('toolbar.shape.title'), (e) => this.shapeMenu(e.currentTarget as HTMLElement), { caret: true, popup: 'menu' }),
        this.btn('more', 'more', null, t('toolbar.more.title'), (e) => this.insertMoreMenu(e.currentTarget as HTMLElement), { popup: 'menu' }),
        sep(),
        this.btn('arrange', 'objCenterH', t('toolbar.arrange.label'), t('toolbar.arrange.title'), (e) => this.arrangeMenu(e.currentTarget as HTMLElement), { caret: true, popup: 'menu' }),
      )),
      (this.textGroup = group(
        sep(),
        this.btn('bold', 'bold', null, `${t('toolbar.bold.title')} (${M}B)`, () => ed().textSession?.exec('bold')),
        this.btn('italic', 'italic', null, `${t('toolbar.italic.title')} (${M}I)`, () => ed().textSession?.exec('italic')),
        this.btn('underline', 'underline', null, `${t('toolbar.underline.title')} (${M}U)`, () => ed().textSession?.exec('underline')),
        this.btn('strike', 'strike', null, t('toolbar.strike.title'), () => ed().textSession?.exec('strike')),
        this.btn('ul', 'ul', null, t('toolbar.ul.title'), () => ed().textSession?.exec('ul')),
        this.btn('ol', 'ol', null, t('toolbar.ol.title'), () => ed().textSession?.exec('ol')),
        this.btn('link', 'link', null, `${t('toolbar.link.title')} (${M}K)`, () => ed().textSession?.exec('link')),
        this.btn('done', 'check', t('common.done'), `${t('toolbar.done.title')} (Esc)`, () => ed().endTextEdit()),
      )),
      h('div', { class: 'lec-spacer' }),
      group(
        this.btn('snap', 'magnet', null, t('toolbar.snap.title'), () => { ed().snapping = !ed().snapping; this.update(); }),
      ),
      sep(),
      h('div', { class: 'lec-zoom' },
        this.btn('zoomout', 'zoomOut', null, `${t('toolbar.zoomOut.title')} (−)`, () => app.zoomBy(-1)),
        (this.zoomVal = h('span', { class: 'lec-zoom-val', title: t('toolbar.zoom.fitTitle'), onclick: () => app.setZoom(1) }, t('toolbar.zoom.fit'))),
        this.btn('zoomin', 'zoomIn', null, `${t('toolbar.zoomIn.title')} (+)`, () => app.zoomBy(1)),
      ),
      sep(),
      group(
        this.btn('navigator', 'navigator', null, t('toolbar.navigator.title'), () => app.toggle('navigator')),
        this.btn('map', 'map', null, `${t('toolbar.map.title')} (M)`, () => app.map.toggle()),
        this.btn('notes', 'notes', null, t('toolbar.speakerNotes.title'), () => app.panels.toggle('notes')),
        this.btn('code', 'code', null, t('toolbar.slideHtml.title'), () => app.panels.toggle('html')),
        this.btn('ainotes', 'sparkle', null, t('toolbar.allAiNotes.title'), () => app.panels.toggle('ai')),
        this.btn('inspector', 'inspector', null, t('toolbar.inspector.title'), () => app.toggle('inspector')),
        this.btn('quiet', 'quiet', null, `${t('toolbar.quiet.title')} (Q)`, () => app.toggleQuiet()),
      ),
      sep(),
      group(
        this.btn('present', 'play', t('common.present'), t('toolbar.present.title'), () => app.present()),
        this.btn('save', 'save', t('common.save'), `${t('common.save')} (${M}S)`, () => void app.save(), { cls: 'lec-warm' }),
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
      if (on !== undefined) { b.classList.toggle('lec-on', on); b.setAttribute('aria-pressed', String(on)); }
    };
    set('undo', ed.history.canUndo);
    set('redo', ed.history.canRedo);
    this.buttons.get('undo')!.title = `${t('toolbar.undo.title')}${ed.history.undoLabel ? ' ' + ed.history.undoLabel : ''} (${modKey()}Z)`;
    this.buttons.get('redo')!.title = `${t('toolbar.redo.title')}${ed.history.redoLabel ? ' ' + ed.history.redoLabel : ''} (${modKey()}⇧Z)`;
    for (const id of ['undo', 'redo']) { const b = this.buttons.get(id)!; b.setAttribute('aria-label', plainLabel(b.title)); }
    set('newslide', ed.ready);
    for (const id of ['text', 'title', 'bullets', 'ainote', 'image', 'shape', 'more']) set(id, has);
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
    set('map', has, app.map.visible);
    set('quiet', true, app.quiet);
    set('inspector', true, app.visible.inspector);
    set('notes', has, app.panels.visible && app.panels.tab === 'notes');
    set('code', has, app.panels.visible && app.panels.tab === 'html');
    set('ainotes', has, app.panels.visible && app.panels.tab === 'ai');
    set('zoomin', has); set('zoomout', has);
    this.zoomVal.textContent = app.zoom === 1 ? t('toolbar.zoom.fit') : `${Math.round(app.zoom * 100)}%`;
  }

  private appMenu(anchor: HTMLElement): void {
    const app = this.app;
    const M = modKey();
    this.openMenu(anchor, [
      { id: 'app-open-folder', label: t('menu.openFolder'), icon: 'folder', shortcut: `${M}O`, onSelect: () => void app.openFolder() },
      { id: 'app-open-deck', label: t('menu.openDeck'), icon: 'file', disabled: !app.workspace, onSelect: () => void app.pickDeckInWorkspace() },
      { id: 'app-new-deck', label: t('menu.newDeck'), icon: 'plus', onSelect: () => void app.newDeck() },
      { id: 'app-demo', label: t('menu.demo'), onSelect: () => void app.openDemo() },
      { separator: true },
      { id: 'app-save', label: t('common.save'), icon: 'save', shortcut: `${M}S`, disabled: !app.editor.ready, onSelect: () => void app.save() },
      { id: 'app-autosave', label: t('menu.autosave'), checked: app.autosave, onSelect: () => app.setAutosave(!app.autosave) },
      { id: 'app-download', label: t('menu.download'), icon: 'download', disabled: !app.editor.ready, onSelect: () => app.download() },
      { id: 'app-export-md', label: t('menu.exportMarkdown'), disabled: !app.editor.ready, onSelect: () => app.exportMarkdown() },
      { id: 'app-reload', label: t('menu.reload'), disabled: !app.editor.ready, onSelect: () => void app.reload() },
      { separator: true },
      { id: 'app-present', label: t('common.present'), icon: 'play', disabled: !app.editor.ready, onSelect: () => app.present() },
      { separator: true },
      { id: 'app-tutorial', label: t('menu.tutorial'), icon: 'help', onSelect: () => app.showTutorial() },
      { id: 'app-shortcuts', label: t('menu.shortcuts'), shortcut: '?', onSelect: () => app.showShortcuts() },
      { id: 'app-about', label: t('menu.about'), onSelect: () => app.showAbout() },
    ]);
  }

  private shapeMenu(anchor: HTMLElement): void {
    const ed = this.app.editor;
    const items: MenuItem[] = [
      { id: 'shape-rect', label: t('menu.shape.rectangle'), icon: 'rect', onSelect: () => ed.insertElement('rect') },
      { id: 'shape-rounded', label: t('menu.shape.rounded'), icon: 'rounded', onSelect: () => ed.insertElement('rounded-rect') },
      { id: 'shape-ellipse', label: t('menu.shape.ellipse'), icon: 'ellipse', onSelect: () => ed.insertElement('ellipse') },
      { id: 'shape-outline', label: t('menu.shape.outline'), icon: 'outline', onSelect: () => ed.insertElement('outline') },
      { id: 'shape-line', label: t('menu.shape.line'), icon: 'line', onSelect: () => ed.insertElement('line') },
      { id: 'shape-arrow', label: t('menu.shape.arrow'), icon: 'arrow', onSelect: () => ed.insertElement('arrow') },
      { id: 'shape-callout', label: t('menu.shape.callout'), icon: 'callout', onSelect: () => ed.insertElement('callout', { edit: true }) },
    ];
    this.openMenu(anchor, items);
  }

  private insertMoreMenu(anchor: HTMLElement): void {
    const ed = this.app.editor;
    this.openMenu(anchor, [
      { id: 'insert-table', label: t('menu.insert.table'), icon: 'table', onSelect: () => ed.insertElement('table') },
      { id: 'insert-code', label: t('menu.insert.code'), icon: 'code', onSelect: () => ed.insertElement('code', { edit: true }) },
      { id: 'insert-equation', label: t('menu.insert.equation'), icon: 'equation', onSelect: () => ed.insertElement('equation', { edit: true }), hint: ed.stage.hasMath ? '' : t('menu.insert.noMath') },
      { id: 'insert-iframe', label: t('menu.insert.iframe'), icon: 'embed', onSelect: () => ed.insertElement('iframe') },
      { separator: true },
      { id: 'insert-paste', label: t('menu.insert.paste'), shortcut: `${modKey()}V`, disabled: ed.clipboard?.kind !== 'elements', onSelect: () => ed.paste() },
    ]);
  }

  private arrangeMenu(anchor: HTMLElement): void {
    const ed = this.app.editor;
    const sel = ed.selection();
    const el = ed.primary;
    const M = modKey();
    this.openMenu(anchor, [
      { label: sel.length > 1 ? t('menu.align.objects') : t('menu.align.slide'), title: true },
      { id: 'arrange-left', label: t('menu.align.left'), icon: 'objLeft', onSelect: () => ed.align('left') },
      { id: 'arrange-center', label: t('menu.align.center'), icon: 'objCenterH', onSelect: () => ed.align('center') },
      { id: 'arrange-right', label: t('menu.align.right'), icon: 'objRight', onSelect: () => ed.align('right') },
      { id: 'arrange-top', label: t('menu.align.top'), icon: 'objTop', onSelect: () => ed.align('top') },
      { id: 'arrange-middle', label: t('menu.align.middle'), icon: 'objMiddle', onSelect: () => ed.align('middle') },
      { id: 'arrange-bottom', label: t('menu.align.bottom'), icon: 'objBottom', onSelect: () => ed.align('bottom') },
      { separator: true },
      { id: 'arrange-distribute-h', label: t('menu.distribute.h'), icon: 'distributeH', disabled: sel.length < 3, onSelect: () => ed.distribute('h') },
      { id: 'arrange-distribute-v', label: t('menu.distribute.v'), icon: 'distributeV', disabled: sel.length < 3, onSelect: () => ed.distribute('v') },
      { separator: true },
      { id: 'arrange-front', label: t('menu.order.front'), icon: 'front', shortcut: `${M}⇧]`, disabled: !el, onSelect: () => el && ed.reorder(el, 'front') },
      { id: 'arrange-forward', label: t('menu.order.forward'), icon: 'arrowUp', shortcut: `${M}]`, disabled: !el, onSelect: () => el && ed.reorder(el, 'forward') },
      { id: 'arrange-backward', label: t('menu.order.backward'), icon: 'arrowDown', shortcut: `${M}[`, disabled: !el, onSelect: () => el && ed.reorder(el, 'backward') },
      { id: 'arrange-back', label: t('menu.order.back'), icon: 'back', shortcut: `${M}⇧[`, disabled: !el, onSelect: () => el && ed.reorder(el, 'back') },
      { separator: true },
      { id: 'arrange-free', label: el && ed.isFree(el) ? t('menu.free.return') : t('menu.free.detach'), icon: el && ed.isFree(el) ? 'flow' : 'free', disabled: !el, onSelect: () => { for (const s of sel) ed.setFree(s, !ed.isFree(s)); } },
    ]);
  }
}

/** Accessible name from a tooltip: the title without its trailing "(shortcut)". */
function plainLabel(title: string): string { return title.replace(/\s*\([^()]*\)\s*$/, ''); }
function sep(): HTMLElement { return h('div', { class: 'lec-sep' }); }
function group(...children: HTMLElement[]): HTMLElement { return h('div', { class: 'lec-group' }, ...children); }
