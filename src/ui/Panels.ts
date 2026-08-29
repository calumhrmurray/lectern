/** Bottom drawer: speaker notes and the slide's HTML source. */

import type { App } from '../app/App';
import { h, debounce, modKey } from './dom';
import type { SlideRef } from '../stage/Stage';
import { aiNotesPrompt, collectAiNotes } from '../deck/aiNotes';

export type PanelTab = 'notes' | 'html' | 'ai';

export class Panels {
  tab: PanelTab = 'notes';
  visible = false;
  private tabsEl: HTMLElement;
  private body: HTMLElement;
  private notesArea: HTMLTextAreaElement;
  private htmlArea: HTMLTextAreaElement;
  private errorEl: HTMLElement;
  private aiList: HTMLElement;
  private htmlRef: SlideRef | null = null;
  private htmlDirty = false;
  private suppress = false;

  constructor(readonly app: App, readonly container: HTMLElement) {
    container.classList.add('lec-panels', 'lec-hidden');
    this.tabsEl = h('div', { class: 'lec-panel-head' });
    this.notesArea = h('textarea', { class: 'lec-field lec-notes-text', placeholder: 'Speaker notes for this slide (shown in the reveal.js speaker view, press S while presenting).', spellcheck: true }) as HTMLTextAreaElement;
    this.htmlArea = h('textarea', { class: 'lec-field', spellcheck: false, placeholder: '<section>…</section>' }) as HTMLTextAreaElement;
    this.errorEl = h('div', { class: 'lec-panel-error' });
    this.aiList = h('div', { class: 'lec-ai-list' });
    this.body = h('div', { class: 'lec-panel-body' });
    container.append(this.tabsEl, this.body);

    const saveNotes = debounce(() => {
      if (this.suppress || !this.app.editor.ready || !this.app.editor.doc.length) return;
      this.app.editor.setNotes(this.app.editor.current, this.notesArea.value);
    }, 400);
    this.notesArea.addEventListener('input', saveNotes);
    this.notesArea.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') this.hide(); });
    this.htmlArea.addEventListener('input', () => { this.htmlDirty = true; this.errorEl.textContent = ''; });
    this.htmlArea.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); this.applyHtml(); }
      if (ev.key === 'Escape') this.hide();
      if (ev.key === 'Tab') {
        ev.preventDefault();
        const s = this.htmlArea.selectionStart, e = this.htmlArea.selectionEnd;
        this.htmlArea.setRangeText('  ', s, e, 'end');
        this.htmlDirty = true;
      }
    });
    this.render();
  }

  show(tab: PanelTab): void {
    this.tab = tab;
    this.visible = true;
    this.container.classList.remove('lec-hidden');
    this.render();
    this.update();
    if (tab !== 'ai') (tab === 'notes' ? this.notesArea : this.htmlArea).focus();
    this.app.toolbar.update();
    this.app.editor.refreshOverlay();
  }

  hide(): void {
    if (this.htmlDirty && this.tab === 'html') this.applyHtml();
    this.visible = false;
    this.container.classList.add('lec-hidden');
    this.app.toolbar.update();
    this.app.editor.overlay.el.focus({ preventScroll: true });
    this.app.editor.refreshOverlay();
  }

  toggle(tab: PanelTab): void {
    if (this.visible && this.tab === tab) this.hide();
    else this.show(tab);
  }

  private render(): void {
    this.tabsEl.replaceChildren(
      h('button', { class: `lec-tab${this.tab === 'notes' ? ' lec-active' : ''}`, type: 'button', onclick: () => this.show('notes') }, 'Notes'),
      h('button', { class: `lec-tab${this.tab === 'html' ? ' lec-active' : ''}`, type: 'button', onclick: () => this.show('html') }, 'Slide HTML'),
      h('button', { class: `lec-tab${this.tab === 'ai' ? ' lec-active' : ''}`, type: 'button', onclick: () => this.show('ai') }, 'Notes for AI'),
      h('span', { class: 'lec-spacer', style: 'flex:1' }),
      h('button', { class: 'lec-btn', type: 'button', title: 'Close', onclick: () => this.hide() }, '✕'),
    );
    this.body.replaceChildren();
    if (this.tab === 'notes') {
      this.body.appendChild(this.notesArea);
    } else if (this.tab === 'ai') {
      this.body.append(this.aiList, h('div', { class: 'lec-panel-side' },
        h('button', { class: 'lec-btn lec-primary', type: 'button', onclick: () => this.copyPrompt() }, 'Copy as prompt'),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.app.editor.insertElement('ainote', { edit: true }) }, '+ Note on this slide'),
        h('div', { class: 'lec-panel-hint' }, 'Notes are saved in the HTML as <div hidden data-ai-note> and never shown when presenting. Paste the prompt to Claude Code, or just tell it “do the notes in index.html”.'),
      ));
    } else {
      this.body.append(this.htmlArea, h('div', { class: 'lec-panel-side' },
        h('button', { class: 'lec-btn lec-primary', type: 'button', onclick: () => this.applyHtml() }, `Apply (${modKey()}⏎)`),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.update(true) }, 'Revert'),
        this.errorEl,
        h('div', { class: 'lec-panel-hint' }, 'Edit the <section> of the current slide. Changes apply as one undoable step.'),
      ));
    }
  }

  /** Refreshes contents for the current slide. */
  update(force = false): void {
    const ed = this.app.editor;
    if (!this.visible || !ed.ready || !ed.doc.length) return;
    const ref = ed.current;
    if (this.tab === 'ai') { this.renderAiList(); return; }
    if (this.tab === 'notes') {
      this.suppress = true;
      const notes = ed.getNotes(ref);
      if (this.notesArea.value !== notes) this.notesArea.value = notes;
      this.suppress = false;
    } else {
      const same = this.htmlRef && this.htmlRef.top === ref.top && this.htmlRef.sub === ref.sub;
      if (!same && this.htmlDirty && this.htmlRef) {
        // Switching slides with unapplied edits: apply them to the slide they belong to.
        this.applyHtml(this.htmlRef);
      }
      if (!same || force || !this.htmlDirty) {
        this.htmlArea.value = ed.stage.srcSection(ref).outerHTML;
        this.htmlDirty = false;
        this.errorEl.textContent = '';
      }
      this.htmlRef = { ...ref };
    }
  }

  private renderAiList(): void {
    const ed = this.app.editor;
    const notes = collectAiNotes(ed.doc);
    this.aiList.replaceChildren();
    if (!notes.length) {
      this.aiList.appendChild(h('div', { class: 'lec-panel-hint', style: 'padding:12px' }, 'No notes yet. Press N on a slide (or the “Note for AI” button) and write what you want done there, e.g. “draw a whale here”.'));
      return;
    }
    for (const n of notes) {
      this.aiList.appendChild(h('button', { class: 'lec-ai-item', type: 'button', onclick: () => { ed.goTo({ top: n.top, sub: null }); ed.select([n.el]); } },
        h('span', { class: 'lec-ai-slide' }, `Slide ${n.top + 1}`), h('span', { class: 'lec-ai-text' }, n.text || '(empty)'),
        h('span', { class: 'lec-ai-where' }, n.x !== null && n.y !== null ? `(${Math.round(n.x)}, ${Math.round(n.y)})` : ''),
        h('span', { class: 'lec-ai-done', title: 'Remove this note', onclick: (e: MouseEvent) => { e.stopPropagation(); ed.edit('Remove note', () => ed.stage.remove(n.el), { top: n.top }); } }, '✕')));
    }
  }

  private copyPrompt(): void {
    const ed = this.app.editor;
    const text = aiNotesPrompt(ed.doc, this.app.deckPath, ed.stage.slideSize);
    if (!text) { this.app.toast('No notes to copy.'); return; }
    navigator.clipboard.writeText(text).then(() => this.app.toast('Prompt copied — paste it to Claude Code.'), () => this.app.toast('Could not access the clipboard.', 'error'));
  }

  private applyHtml(ref: SlideRef | null = this.htmlRef): void {
    const ed = this.app.editor;
    if (!ref || !this.htmlDirty) return;
    const html = this.htmlArea.value;
    try {
      ed.replaceSlideHtml(ref, html);
      this.htmlDirty = false;
      this.errorEl.textContent = '';
      this.app.toast('Slide HTML applied');
    } catch (err) {
      this.errorEl.textContent = (err as Error).message;
    }
  }
}
