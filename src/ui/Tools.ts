/**
 * The tools button: the one thing on the right of the quiet room.
 *
 * Everything the toolbar does still exists — it is summoned rather than
 * stationed. Click and a small palette rises next to it with the handful of
 * things you reach for while writing (insert text, a heading, a list, an image,
 * a shape, a note), and one line back to the full panels.
 *
 * The button itself carries the only state worth keeping on screen: a dot that
 * turns amber when the file is unsaved or a note is waiting for the assistant.
 */

import type { App } from '../app/App';
import { collectAiNotes } from '../deck/aiNotes';
import { h, modKey, svgIcon } from './dom';
import { icons, type IconName } from './icons';
import { showMenu } from './Menu';

export class Tools {
  private button: HTMLButtonElement;
  private dot: HTMLElement;
  private palette: HTMLElement;
  private open = false;

  constructor(readonly app: App, readonly container: HTMLElement) {
    this.dot = h('span', { class: 'lec-tools-dot' });
    this.button = h('button', {
      class: 'lec-tools-btn', type: 'button', dataset: { action: 'tools' },
      title: 'Tools', 'aria-expanded': 'false',
      onclick: () => this.toggle(),
    }, svgIcon(icons.more), this.dot) as HTMLButtonElement;
    this.palette = h('div', { class: 'lec-tools-palette', hidden: true });
    container.append(this.palette, this.button);
    document.addEventListener('pointerdown', (ev) => {
      if (this.open && !container.contains(ev.target as Node)) this.setOpen(false);
    });
  }

  toggle(): void { this.setOpen(!this.open); }

  setOpen(on: boolean): void {
    this.open = on;
    this.button.setAttribute('aria-expanded', on ? 'true' : 'false');
    this.button.classList.toggle('lec-on', on);
    this.palette.hidden = !on;
    if (on) this.fill();
  }

  update(): void {
    const ed = this.app.editor;
    const pending = ed.ready ? collectAiNotes(ed.doc).filter((n) => !n.done).length : 0;
    const unsaved = ed.ready && ed.doc.dirty;
    this.dot.classList.toggle('lec-on', pending > 0 || unsaved);
    this.button.title = pending
      ? `Tools — ${pending} note${pending === 1 ? '' : 's'} waiting`
      : unsaved ? 'Tools — unsaved' : 'Tools';
  }

  private fill(): void {
    const app = this.app;
    const ed = app.editor;
    const tool = (id: string, icon: IconName, title: string, run: () => void) =>
      h('button', { class: 'lec-tools-item', type: 'button', dataset: { action: `tool-${id}` }, title, onclick: () => { run(); this.setOpen(false); } }, svgIcon(icons[icon]));
    this.palette.replaceChildren(
      tool('text', 'text', 'Text', () => ed.insertElement('text')),
      tool('title', 'title', 'Heading', () => ed.insertElement('title')),
      tool('bullets', 'bullets', 'Bullet list', () => ed.insertElement('bullets')),
      tool('image', 'image', 'Image…', () => void app.insertImageViaDialog()),
      tool('shape', 'shape', 'Rectangle', () => ed.insertElement('rect')),
      tool('ainote', 'sparkle', 'Note for AI (N)', () => ed.insertElement('ainote', { edit: true })),
      h('div', { class: 'lec-tools-rule' }),
      tool('more', 'inspector', 'Everything else', () => this.menu()),
    );
  }

  private menu(): void {
    const app = this.app;
    const M = modKey();
    void showMenu([
      { label: 'Show the panels', icon: 'inspector', shortcut: 'Q', onSelect: () => app.setQuiet(false) },
      { label: 'Map', icon: 'map', shortcut: 'M', onSelect: () => app.map.toggle() },
      { separator: true },
      { label: 'Save', icon: 'save', shortcut: `${M}S`, onSelect: () => void app.save() },
      { label: 'Notes for AI', icon: 'sparkle', onSelect: () => app.panels.show('ai') },
      { label: 'Speaker notes', icon: 'notes', onSelect: () => app.panels.show('notes') },
      { label: 'Slide HTML', icon: 'code', onSelect: () => app.panels.show('html') },
      { separator: true },
      { label: 'Keyboard shortcuts', icon: 'help', shortcut: '?', onSelect: () => app.showShortcuts() },
      { label: 'Show the tips again', icon: 'sparkle', onSelect: () => app.tips.reset() },
      { label: 'Stop showing tips', disabled: !app.tips.enabled, onSelect: () => app.tips.setEnabled(false) },
    ], this.button);
  }
}
