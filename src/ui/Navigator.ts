/** The slide navigator: thumbnails, selection, drag-to-reorder, context menu. */

import type { App } from '../app/App';
import { isStack, slideLabel } from '../deck/html';
import { blankLike, SLIDE_LAYOUTS } from '../deck/templates';
import type { SlideRef } from '../stage/Stage';
import { h, svgIcon, debounce, modKey } from './dom';
import { icons } from './icons';
import { showMenu } from './Menu';

interface Card { ref: SlideRef; el: HTMLElement; iframe: HTMLIFrameElement; dirty: boolean; visible: boolean }

function cardId(ref: SlideRef): string { return `lec-slide-${ref.top}${ref.sub === null ? '' : '-' + ref.sub}`; }

export class Navigator {
  private cards: Card[] = [];
  private io: IntersectionObserver;
  private dragFrom: number | null = null;
  private dirtyTops = new Set<number>();
  private allDirty = false;
  private flush = debounce(() => this.renderDirty(), 200);

  constructor(readonly app: App, readonly container: HTMLElement) {
    container.tabIndex = 0;
    container.setAttribute('role', 'listbox');
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const card = this.cards.find((c) => c.el === e.target);
        if (!card) continue;
        card.visible = e.isIntersecting;
        if (card.visible && card.dirty) this.renderCard(card);
      }
    }, { root: container, rootMargin: '200px 0px' });

    container.addEventListener('keydown', (ev) => this.onKey(ev));
    container.addEventListener('contextmenu', (ev) => {
      if ((ev.target as HTMLElement).closest('.lec-slide-card')) return;
      ev.preventDefault();
      // Not on a card: the click is in a gap, so act on the gap rather than on
      // whichever slide happens to be current.
      this.showGapMenu(this.gapAt(ev.clientY), { x: ev.clientX, y: ev.clientY });
    });
  }

  /** Rebuilds the list of cards (call when the slide list changed). */
  render(): void {
    const ed = this.app.editor;
    for (const c of this.cards) this.io.unobserve(c.el);
    this.cards = [];
    this.container.replaceChildren();
    if (!ed.ready) return;
    const refs = ed.slideRefs();
    if (!refs.length) {
      this.container.appendChild(h('div', { class: 'lec-nav-empty' }, 'No slides yet.'));
    }
    const { width, height } = ed.stage.slideSize;
    const ratio = height / width;
    let n = 0;
    for (const ref of refs) {
      const isSub = ref.sub !== null;
      const numLabel = isSub ? `${ref.top + 1}.${(ref.sub ?? 0) + 1}` : String(ref.top + 1);
      if (!isSub) n++;
      // sandbox without allow-scripts: a deck's <script>/onerror must not run inside the editor's origin;
      // allow-same-origin keeps service-worker-served images loading. Thumbnails are pure HTML/CSS.
      const iframe = h('iframe', { title: `Slide ${numLabel}`, loading: 'lazy', tabindex: -1, sandbox: 'allow-same-origin', 'aria-hidden': 'true' });
      iframe.width = String(width); iframe.height = String(height);
      const wrap = h('div', { class: 'lec-thumb-wrap', style: `padding-bottom:${(ratio * 100).toFixed(3)}%` }, iframe);
      const section = ed.stage.srcSection(ref);
      const label = slideLabel(section, '');
      const vis = section.getAttribute('data-visibility');
      const card = h('div', {
        class: `lec-slide-card${isSub ? ' lec-sub' : ''}`, draggable: true, dataset: { top: String(ref.top), sub: ref.sub === null ? '' : String(ref.sub) },
        title: label, role: 'option', id: cardId(ref), 'aria-selected': 'false', 'aria-label': `Slide ${numLabel}${label ? ': ' + label : ''}${vis ? ` (${vis})` : ''}`,
      },
        h('div', { class: 'lec-slide-num' }, numLabel),
        h('div', { class: 'lec-thumb' }, wrap, h('div', { class: 'lec-thumb-label' }, label || ' ')),
        vis ? h('span', { class: 'lec-slide-badge' }, vis) : null,
      );
      card.addEventListener('click', () => { ed.goTo(ref); this.container.focus(); });
      card.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      // The cards sit flush against each other, so "between two slides" has no pixels of
      // its own. Treat a band at each edge as the seam, the same way dragging reads the
      // midpoint to decide before or after.
      const r = card.getBoundingClientRect();
      const edge = Math.min(10, r.height * 0.18);
      if (ev.clientY < r.top + edge || ev.clientY > r.bottom - edge) {
        const after = ev.clientY > r.top + r.height / 2;
        this.showGapMenu(ref.top + (after ? 1 : 0), { x: ev.clientX, y: ev.clientY });
        return;
      }
      ed.goTo(ref);
      this.showMenuFor(ref, { x: ev.clientX, y: ev.clientY });
    });
      card.addEventListener('dblclick', () => this.app.panels.show('html'));
      this.wireDrag(card, ref);
      this.container.appendChild(card);
      const c: Card = { ref, el: card, iframe, dirty: true, visible: false };
      this.cards.push(c);
      this.io.observe(card);
    }
    const addBtn = h('button', { class: 'lec-btn lec-nav-add', type: 'button', title: `New slide (${modKey()}⇧N)`, onclick: (e: MouseEvent) => this.app.showNewSlideMenu(e.currentTarget as HTMLElement) }, svgIcon(icons.plus), 'New slide');
    this.container.appendChild(addBtn);
    this.updateCurrent();
    this.fitThumbs();
  }

  /** Scales the thumbnail iframes to the card width. */
  fitThumbs(): void {
    const ed = this.app.editor;
    if (!ed.ready) return;
    const { width } = ed.stage.slideSize;
    for (const c of this.cards) {
      const wrapW = c.iframe.parentElement?.clientWidth ?? 0;
      if (wrapW) c.iframe.style.transform = `scale(${wrapW / width})`;
    }
  }

  updateCurrent(): void {
    const cur = this.app.editor.current;
    for (const c of this.cards) {
      const on = c.ref.top === cur.top && c.ref.sub === cur.sub;
      c.el.classList.toggle('lec-current', on);
      c.el.setAttribute('aria-selected', String(on));
      if (on) { c.el.scrollIntoView({ block: 'nearest' }); this.container.setAttribute('aria-activedescendant', c.el.id); }
    }
  }

  /** Marks slides as needing a re-render. */
  invalidate(tops: number[] | null): void {
    if (tops === null) this.allDirty = true;
    else for (const t of tops) this.dirtyTops.add(t);
    this.flush();
  }

  private renderDirty(): void {
    for (const c of this.cards) {
      if (this.allDirty || this.dirtyTops.has(c.ref.top)) {
        c.dirty = true;
        if (c.visible) this.renderCard(c);
      }
    }
    this.allDirty = false;
    this.dirtyTops.clear();
    // Labels may have changed too.
    for (const c of this.cards) {
      try {
        const section = this.app.editor.stage.srcSection(c.ref);
        const label = slideLabel(section, '');
        const lab = c.el.querySelector('.lec-thumb-label');
        if (lab && lab.textContent !== label) lab.textContent = label || ' ';
      } catch { /* ignore */ }
    }
  }

  private renderCard(c: Card): void {
    c.dirty = false;
    this.app.thumbs.render(c.ref, c.iframe);
  }

  // ---------------------------------------------------------------- drag to reorder

  private wireDrag(card: HTMLElement, ref: SlideRef): void {
    card.addEventListener('dragstart', (ev) => {
      this.dragFrom = this.cards.findIndex((c) => c.ref.top === ref.top && c.ref.sub === ref.sub);
      card.classList.add('lec-dragging');
      ev.dataTransfer?.setData('text/plain', `slide:${ref.top}/${ref.sub}`);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('lec-dragging');
      this.clearDropMarks();
      this.dragFrom = null;
    });
    card.addEventListener('dragover', (ev) => {
      if (this.dragFrom === null) return;
      ev.preventDefault();
      const r = card.getBoundingClientRect();
      const after = ev.clientY > r.top + r.height / 2;
      this.clearDropMarks();
      card.classList.add(after ? 'lec-drop-after' : 'lec-drop-before');
    });
    card.addEventListener('dragleave', () => card.classList.remove('lec-drop-after', 'lec-drop-before'));
    card.addEventListener('drop', (ev) => {
      if (this.dragFrom === null) return;
      ev.preventDefault();
      const r = card.getBoundingClientRect();
      const after = ev.clientY > r.top + r.height / 2;
      const from = this.cards[this.dragFrom].ref;
      this.clearDropMarks();
      this.dragFrom = null;
      this.dropSlide(from, ref, after);
    });
  }

  private clearDropMarks(): void {
    for (const c of this.cards) c.el.classList.remove('lec-drop-after', 'lec-drop-before');
  }

  private dropSlide(from: SlideRef, to: SlideRef, after: boolean): void {
    const ed = this.app.editor;
    if (from.sub === null && to.sub === null) {
      let target = to.top + (after ? 1 : 0);
      if (from.top < target) target--;
      ed.moveSlide(from.top, target);
    } else if (from.sub !== null && to.sub !== null && from.top === to.top) {
      let target = to.sub + (after ? 1 : 0);
      if (from.sub < target) target--;
      ed.moveSubSlide(from.top, from.sub, target);
    } else if (from.sub === null && to.sub !== null) {
      // Drop a whole slide next to a stack: place relative to the stack.
      let target = to.top + (after ? 1 : 0);
      if (from.top < target) target--;
      ed.moveSlide(from.top, target);
    } else {
      this.app.toast('Drag a stacked slide within its own stack, or use the HTML view to move it out.', 'info');
    }
  }

  // ---------------------------------------------------------------- keyboard & menu

  private onKey(ev: KeyboardEvent): void {
    const ed = this.app.editor;
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') { ev.preventDefault(); ed.next(); }
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') { ev.preventDefault(); ed.prev(); }
    else if (ev.key === 'Home') { ev.preventDefault(); const r = ed.slideRefs()[0]; if (r) ed.goTo(r); }
    else if (ev.key === 'End') { ev.preventDefault(); const r = ed.slideRefs().at(-1); if (r) ed.goTo(r); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.app.deleteCurrentSlide(); }
    else if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); ed.duplicateSlide(); }
    else if (mod && ev.key.toLowerCase() === 'c') { ev.preventDefault(); ed.copySlide(); this.app.toast('Slide copied'); }
    else if (mod && ev.key.toLowerCase() === 'v') { ev.preventDefault(); ed.pasteSlides(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); this.app.editor.overlay.el.focus(); }
  }

  /**
   * Which top-level boundary a point in the rail falls on: 0 above the first slide,
   * `doc.length` below the last. Sub-slides resolve to their stack's boundary, the same
   * way dragging one out of its stack does.
   */
  private gapAt(y: number): number {
    const ed = this.app.editor;
    let index = 0;
    for (const c of this.cards) {
      const r = c.el.getBoundingClientRect();
      if (y > r.top + r.height / 2) index = c.ref.top + 1;
    }
    return Math.min(index, ed.doc.length);
  }

  /** The menu for a gap between two slides: what to put *here*. */
  showGapMenu(index: number, at: { x: number; y: number }): void {
    const ed = this.app.editor;
    const above = index > 0 ? ed.doc.slides[index - 1]?.el : ed.doc.slides[0]?.el;
    const where = index === 0 ? 'at the top'
      : index >= ed.doc.length ? 'at the end'
      : `between ${index} and ${index + 1}`;
    void showMenu([
      { label: `New slide ${where}`, icon: 'plus', disabled: !above,
        onSelect: () => { if (above) ed.addSlide(blankLike(above), index - 1); } },
      { label: 'New slide from layout…', onSelect: () => { ed.goTo({ top: Math.max(0, index - 1), sub: null }); this.app.showNewSlideMenu(at); } },
      { separator: true },
      { label: 'Paste slide here', shortcut: `${modKey()}V`, disabled: ed.clipboard?.kind !== 'slides',
        onSelect: () => ed.pasteSlides(index - 1) },
    ], at);
  }

  showMenuFor(ref: SlideRef | null, at: { x: number; y: number }): void {
    const ed = this.app.editor;
    const cur = ref ?? ed.current;
    const section = ed.doc.length ? ed.stage.srcSection(cur) : null;
    const vis = section?.getAttribute('data-visibility') ?? '';
    const stack = section ? isStack(ed.doc.slides[cur.top].el) : false;
    void showMenu([
      { label: 'New slide like this one', icon: 'plus', disabled: !section, onSelect: () => { if (section) ed.addSlide(blankLike(section), cur.top); } },
      { label: 'New blank slide', shortcut: `${modKey()}⇧N`, onSelect: () => ed.addSlide(SLIDE_LAYOUTS[2].html(ed.stage.slideSize), cur.top) },
      { label: 'New slide from layout…', onSelect: () => this.app.showNewSlideMenu(at) },
      { label: 'Duplicate', icon: 'duplicate', shortcut: `${modKey()}D`, disabled: !section, onSelect: () => ed.duplicateSlide(cur) },
      { separator: true },
      { label: 'Copy slide', shortcut: `${modKey()}C`, disabled: !section, onSelect: () => { ed.copySlide(cur); this.app.toast('Slide copied'); } },
      { label: 'Paste slide after', shortcut: `${modKey()}V`, disabled: ed.clipboard?.kind !== 'slides', onSelect: () => ed.pasteSlides(cur.top) },
      { separator: true },
      { label: 'Skip in presentation (uncounted)', checked: vis === 'uncounted', disabled: !section || stack, onSelect: () => ed.setSlideAttr(cur, 'data-visibility', vis === 'uncounted' ? null : 'uncounted') },
      { label: 'Hidden', checked: vis === 'hidden', disabled: !section || stack, onSelect: () => ed.setSlideAttr(cur, 'data-visibility', vis === 'hidden' ? null : 'hidden') },
      { separator: true },
      { label: 'Edit HTML', icon: 'code', disabled: !section, onSelect: () => this.app.panels.show('html') },
      { label: 'Speaker notes', icon: 'notes', disabled: !section, onSelect: () => this.app.panels.show('notes') },
      { separator: true },
      { label: 'Delete slide', icon: 'trash', shortcut: '⌫', disabled: !section, onSelect: () => this.app.deleteCurrentSlide(cur) },
    ], at);
  }
}
