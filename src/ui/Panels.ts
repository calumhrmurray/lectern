/** Bottom drawer: speaker notes and the slide's HTML source. */

import type { App } from '../app/App';
import { h, svgIcon, debounce, modKey } from './dom';
import { icons } from './icons';
import type { SlideRef } from '../stage/Stage';
import { aiNotesPrompt, collectAiNotes } from '../deck/aiNotes';
import { t, type MessageKey } from '../i18n';

export type PanelTab = 'notes' | 'html' | 'ai';
const PANEL_TABS: PanelTab[] = ['notes', 'html', 'ai'];
const PANEL_LABELS: Record<PanelTab, MessageKey> = { notes: 'panel.notes', html: 'panel.html', ai: 'panel.ai' };

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
    this.tabsEl = h('div', { class: 'lec-panel-head', role: 'tablist', 'aria-label': t('panel.tablist') });
    this.tabsEl.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'Home' && ev.key !== 'End') return;
      ev.preventDefault(); ev.stopPropagation();
      const i = PANEL_TABS.indexOf(this.tab);
      this.show(PANEL_TABS[ev.key === 'Home' ? 0 : ev.key === 'End' ? PANEL_TABS.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : PANEL_TABS.length - 1)) % PANEL_TABS.length]);
      this.tabsEl.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    });
    this.notesArea = h('textarea', { class: 'lec-field lec-notes-text', placeholder: t('panel.notesPlaceholder'), spellcheck: true }) as HTMLTextAreaElement;
    this.htmlArea = h('textarea', { class: 'lec-field', spellcheck: false, placeholder: '<section>…</section>' }) as HTMLTextAreaElement;
    this.errorEl = h('div', { class: 'lec-panel-error' });
    this.aiList = h('div', { class: 'lec-ai-list' });
    this.body = h('div', { class: 'lec-panel-body', role: 'tabpanel', id: 'lec-panel-body' });
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
      ...PANEL_TABS.map((tab) => h('button', {
        class: `lec-tab${this.tab === tab ? ' lec-active' : ''}`, type: 'button', role: 'tab', id: `lec-panel-tab-${tab}`, 'aria-controls': 'lec-panel-body',
        'aria-selected': String(this.tab === tab), tabindex: this.tab === tab ? 0 : -1, onclick: () => this.show(tab),
      }, t(PANEL_LABELS[tab]))),
      h('span', { class: 'lec-spacer', style: 'flex:1' }),
      h('button', { class: 'lec-btn', type: 'button', title: t('common.close'), 'aria-label': t('panel.close'), onclick: () => this.hide() }, svgIcon(icons.close)),
    );
    this.body.setAttribute('aria-labelledby', `lec-panel-tab-${this.tab}`);
    this.body.replaceChildren();
    if (this.tab === 'notes') {
      this.body.appendChild(this.notesArea);
    } else if (this.tab === 'ai') {
      this.body.append(this.aiList, h('div', { class: 'lec-panel-side' },
        h('button', { class: 'lec-btn lec-primary', type: 'button', onclick: () => this.copyPrompt() }, t('panel.copyPrompt')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.app.editor.insertElement('ainote', { edit: true }) }, t('panel.noteOnSlide')),
        h('div', { class: 'lec-panel-hint' }, t('panel.aiHint')),
      ));
    } else {
      this.body.append(this.htmlArea, h('div', { class: 'lec-panel-side' },
        h('button', { class: 'lec-btn lec-primary', type: 'button', onclick: () => this.applyHtml() }, t('panel.apply', { key: modKey() })),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.update(true) }, t('panel.revert')),
        this.errorEl,
        h('div', { class: 'lec-panel-hint' }, t('panel.htmlHint')),
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
      this.aiList.appendChild(h('div', { class: 'lec-panel-hint', style: 'padding:12px' }, t('panel.aiEmpty')));
      return;
    }
    for (const n of notes) {
      this.aiList.appendChild(h('div', { class: `lec-ai-row${n.done ? ' lec-ai-done-item' : ''}` },
        h('button', { class: 'lec-ai-item', type: 'button', onclick: () => { ed.goTo({ top: n.top, sub: null }); ed.select([n.el]); } },
          h('span', { class: 'lec-ai-slide' }, n.done ? '✓ ' : '', t('panel.slide', { n: n.top + 1 })), h('span', { class: 'lec-ai-text' }, ...n.entries.map((e, i) => h('span', { class: e.by === 'ai' ? 'lec-ai-reply' : '' }, (i ? ' → ' : '') + (e.by === 'ai' ? t('panel.aiPrefix') : '') + e.text)), n.entries.length ? null : t('panel.empty')),
          h('span', { class: 'lec-ai-where' }, n.x !== null && n.y !== null ? `(${Math.round(n.x)}, ${Math.round(n.y)})` : '')),
        h('button', { class: 'lec-ai-done', type: 'button', title: t('panel.removeNote'), 'aria-label': t('panel.removeNote'), onclick: () => ed.edit('Remove note', () => ed.stage.remove(n.el), { top: n.top }) }, svgIcon(icons.close))));
    }
  }

  private copyPrompt(): void {
    const ed = this.app.editor;
    const text = aiNotesPrompt(ed.doc, this.app.deckPath, ed.stage.slideSize);
    if (!text) { this.app.toast(t('panel.noNotesToCopy')); return; }
    navigator.clipboard.writeText(text).then(() => this.app.toast(t('panel.promptCopied')), () => this.app.toast(t('panel.clipboardError'), 'error'));
  }

  private applyHtml(ref: SlideRef | null = this.htmlRef): void {
    const ed = this.app.editor;
    if (!ref || !this.htmlDirty) return;
    const html = this.htmlArea.value;
    try {
      ed.replaceSlideHtml(ref, html);
      this.htmlDirty = false;
      this.errorEl.textContent = '';
      this.app.toast(t('panel.htmlApplied'));
    } catch (err) {
      this.errorEl.textContent = (err as Error).message;
    }
  }
}
