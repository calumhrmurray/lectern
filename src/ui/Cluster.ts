/**
 * The cluster: the four glyphs that stay on screen in quiet mode.
 *
 * The rule for earning a permanent place is that it answers "what is the state
 * of my work right now" without being asked — notes waiting on someone, whether
 * the file is saved. Everything that *performs* an action lives behind ⋯ or a
 * keystroke, so the slide keeps the screen.
 */

import type { App } from '../app/App';
import { collectAiNotes } from '../deck/aiNotes';
import { h, modKey, svgIcon } from './dom';
import { icons } from './icons';
import { showMenu } from './Menu';

export class Cluster {
  private notesBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;

  constructor(readonly app: App, readonly container: HTMLElement) {
    this.notesBtn = h('button', {
      class: 'lec-cluster-btn lec-cluster-notes', type: 'button', dataset: { action: 'quiet-notes' },
      title: 'Notes waiting for the assistant', onclick: () => app.panels.show('ai'),
    }) as HTMLButtonElement;
    this.saveBtn = h('button', {
      class: 'lec-cluster-btn', type: 'button', dataset: { action: 'quiet-save' },
      title: `Save (${modKey()}S)`, onclick: () => void app.save(),
    }) as HTMLButtonElement;
    const present = h('button', {
      class: 'lec-cluster-btn', type: 'button', dataset: { action: 'quiet-present' },
      title: 'Present', onclick: () => void app.present(),
    }, svgIcon(icons.play)) as HTMLButtonElement;
    const more = h('button', {
      class: 'lec-cluster-btn', type: 'button', dataset: { action: 'quiet-more' },
      title: 'Everything else', onclick: (ev: MouseEvent) => this.menu(ev.currentTarget as HTMLElement),
    }, svgIcon(icons.more)) as HTMLButtonElement;
    container.append(this.notesBtn, this.saveBtn, present, more);
  }

  update(): void {
    const app = this.app;
    const ed = app.editor;
    const pending = ed.ready ? collectAiNotes(ed.doc).filter((n) => !n.done).length : 0;
    this.notesBtn.textContent = pending ? `◈ ${pending}` : '';
    this.notesBtn.style.display = pending ? '' : 'none';
    const saved = ed.ready && !ed.doc.dirty;
    this.saveBtn.textContent = !ed.ready ? '' : saved ? '● saved' : '● unsaved';
    this.saveBtn.classList.toggle('lec-dirty', ed.ready && ed.doc.dirty);
  }

  private menu(anchor: HTMLElement): void {
    const app = this.app;
    const M = modKey();
    void showMenu([
      { label: 'Show the panels', icon: 'inspector', shortcut: 'Q', onSelect: () => app.setQuiet(false) },
      { label: 'Map', icon: 'navigator', shortcut: 'M', onSelect: () => app.map.toggle() },
      { separator: true },
      { label: 'Save', icon: 'save', shortcut: `${M}S`, onSelect: () => void app.save() },
      { label: 'Present', icon: 'play', onSelect: () => void app.present() },
      { label: 'Notes for AI', icon: 'sparkle', onSelect: () => app.panels.show('ai') },
      { label: 'Speaker notes', icon: 'notes', onSelect: () => app.panels.show('notes') },
      { label: 'Slide HTML', icon: 'code', onSelect: () => app.panels.show('html') },
      { separator: true },
      { label: 'Keyboard shortcuts', icon: 'help', shortcut: '?', onSelect: () => app.showShortcuts() },
    ], anchor);
  }
}
