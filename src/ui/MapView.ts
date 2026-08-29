/**
 * The map: the whole deck laid out the way reveal walks it — sections left to
 * right, a vertical stack downward inside its column.
 *
 * It is the compass at arm's length, and the only view in the editor where the
 * structure of the talk is the subject rather than the contents of one slide:
 * name a section, move a slide across the running order, drop one under another
 * to make it a sub-slide (reveal's ↓), promote it back out.
 *
 * Cards are live thumbnails, rendered lazily by the same ThumbnailRenderer the
 * navigator uses, so a forty-slide deck does not open forty iframes at once.
 */

import type { App } from '../app/App';
import { escapeHtml, isStack, slideLabel } from '../deck/html';
import { SECTION_ATTR, sectionsOf, type DeckSection } from '../deck/sections';
import type { SlideRef } from '../stage/Stage';
import { promptDialog } from './Dialogs';
import { debounce, h, svgIcon } from './dom';
import { icons } from './icons';
import { showMenu } from './Menu';

interface MapCard {
  ref: SlideRef;
  el: HTMLElement;
  iframe: HTMLIFrameElement;
  dirty: boolean;
  visible: boolean;
}

export class MapView {
  visible = false;
  private grid: HTMLElement;
  private countEl: HTMLElement;
  private cards: MapCard[] = [];
  private io: IntersectionObserver;
  private dragFrom: SlideRef | null = null;
  private flush = debounce(() => this.renderDirty(), 200);

  constructor(readonly app: App, readonly container: HTMLElement) {
    this.countEl = h('span', { class: 'lec-map-count' });
    this.grid = h('div', { class: 'lec-map-grid', tabindex: 0 });
    container.append(
      h('div', { class: 'lec-map-head' },
        h('span', { class: 'lec-map-title' }, 'Map'),
        this.countEl,
        h('span', { class: 'lec-spacer', style: 'flex:1' }),
        h('span', { class: 'lec-map-hint' }, 'Drag to reorder · drop under a slide to nest it · click a title or a section to rename'),
        h('button', { class: 'lec-btn', type: 'button', dataset: { action: 'map-close' }, onclick: () => this.hide() }, 'Done'),
      ),
      this.grid,
    );
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const card = this.cards.find((c) => c.el === e.target);
        if (!card) continue;
        card.visible = e.isIntersecting;
        if (card.visible && card.dirty) this.paintCard(card);
      }
    }, { root: this.grid, rootMargin: '300px' });
    this.grid.addEventListener('click', (ev) => { if (ev.target === this.grid) this.hide(); });
  }

  toggle(): void { this.visible ? this.hide() : this.show(); }

  show(): void {
    if (!this.app.editor.ready) return;
    this.visible = true;
    this.container.classList.remove('lec-hidden');
    this.render();
    this.grid.focus();
  }

  hide(): void {
    this.visible = false;
    this.container.classList.add('lec-hidden');
    this.app.toolbar.update();
  }

  /** Marks slides dirty so their thumbnails repaint (null = all of them). */
  invalidate(tops: number[] | null): void {
    for (const c of this.cards) if (tops === null || tops.includes(c.ref.top)) c.dirty = true;
    if (this.visible) this.flush();
  }

  updateCurrent(): void {
    const cur = this.app.editor.current;
    for (const c of this.cards) {
      const on = c.ref.top === cur.top && (c.ref.sub === cur.sub || (c.ref.sub === null && cur.sub === null));
      c.el.classList.toggle('lec-current', on);
      if (on && this.visible) c.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  render(): void {
    const ed = this.app.editor;
    for (const c of this.cards) this.io.unobserve(c.el);
    this.cards = [];
    this.grid.replaceChildren();
    if (!ed.ready || !ed.doc.length) {
      this.grid.appendChild(h('div', { class: 'lec-nav-empty' }, 'No slides yet.'));
      this.countEl.textContent = '';
      return;
    }
    const tops = ed.doc.slides.map((s) => s.el);
    const sections = sectionsOf(tops);
    const named = sections.filter((s) => s.name).length;
    const hidden = tops.filter((el) => el.getAttribute('data-visibility') === 'hidden').length;
    this.countEl.textContent = `${ed.slideRefs().length} slides · ${named || 'no'} named section${named === 1 ? '' : 's'}${hidden ? ` · ${hidden} hidden` : ''}`;

    tops.forEach((el, top) => this.grid.appendChild(this.column(el, top, sections)));
    this.grid.appendChild(h('div', { class: 'lec-map-col lec-map-end' },
      h('button', {
        class: 'lec-map-add lec-map-add-end', type: 'button', dataset: { action: 'map-add-end' },
        title: 'New slide at the end of the deck', onclick: () => void this.newSlide(tops.length - 1),
      }, '+ slide'),
    ));
    this.renderDirty();
    this.updateCurrent();
  }

  // ------------------------------------------------------------------ columns

  private column(el: Element, top: number, sections: DeckSection[]): HTMLElement {
    const ed = this.app.editor;
    const section = sections.find((s) => s.start === top) ?? null;
    const col = h('div', { class: 'lec-map-col', dataset: { top: String(top) } });

    col.appendChild(this.sectionHead(top, section));

    const subs = isStack(el) ? Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'section') : [];
    if (subs.length) {
      subs.forEach((_, sub) => {
        if (sub) col.appendChild(h('div', { class: 'lec-map-down', title: 'Down arrow while presenting' }, svgIcon(icons.arrowDown)));
        col.appendChild(this.card({ top, sub }));
      });
    } else {
      col.appendChild(this.card({ top, sub: null }));
    }

    const nest = h('div', { class: 'lec-map-nest' }, 'make it a sub-slide');
    nest.addEventListener('dragover', (ev) => {
      if (!this.dragFrom || this.dragFrom.sub !== null || this.dragFrom.top === top) return;
      ev.preventDefault();
      nest.classList.add('lec-on');
    });
    nest.addEventListener('dragleave', () => nest.classList.remove('lec-on'));
    nest.addEventListener('drop', (ev) => {
      const from = this.dragFrom;
      nest.classList.remove('lec-on');
      if (!from || from.sub !== null || from.top === top) return;
      ev.preventDefault();
      this.dragFrom = null;
      ed.nestSlide(from.top, top);
    });
    col.appendChild(nest);
    col.appendChild(h('div', { class: 'lec-map-adds' },
      h('button', {
        class: 'lec-map-add', type: 'button', dataset: { action: 'map-add-after' },
        title: 'New slide after this one', onclick: () => void this.newSlide(top),
      }, '+ slide'),
      h('button', {
        class: 'lec-map-add', type: 'button', dataset: { action: 'map-add-sub' },
        title: 'New slide below this one — reveal’s ↓', onclick: () => void this.newSlide(top, { below: true }),
      }, '+ below'),
    ));
    col.appendChild(h('div', { class: 'lec-map-num' }, subs.length ? `${top + 1}.1 – ${top + 1}.${subs.length}` : String(top + 1)));
    return col;
  }

  private sectionHead(top: number, section: DeckSection | null): HTMLElement {
    const name = section?.name ?? null;
    const cls = `lec-map-sec${section ? '' : ' lec-map-sec-none'}${section && !section.explicit ? ' lec-inferred' : ''}`;
    const title = section
      ? (section.explicit ? 'Rename this section' : 'Guessed from the deck — click to write it down')
      : 'Start a section here';
    return h('button', {
      class: cls, type: 'button', title,
      onclick: () => void this.nameSection(top, name),
    }, name ?? (section ? '—' : '+ section'));
  }

  private card(ref: SlideRef): HTMLElement {
    const ed = this.app.editor;
    const { width, height } = ed.stage.slideSize;
    const src = ed.stage.srcSection(ref);
    const label = slideLabel(src, '');
    const vis = src.getAttribute('data-visibility');
    const notes = src.querySelectorAll('[data-ai-note]:not([data-ai-note="done"])').length;

    const iframe = h('iframe', { title: label || 'Slide', loading: 'lazy', tabindex: -1 }) as HTMLIFrameElement;
    iframe.width = String(width);
    iframe.height = String(height);
    const wrap = h('div', { class: 'lec-thumb-wrap', style: `padding-bottom:${((height / width) * 100).toFixed(3)}%` }, iframe);

    const el = h('div', {
      class: `lec-map-card${vis ? ' lec-dim' : ''}`, draggable: true, title: label,
      dataset: { top: String(ref.top), sub: ref.sub === null ? '' : String(ref.sub) },
    },
      h('div', { class: 'lec-thumb' }, wrap),
      h('button', {
        class: 'lec-map-cardlabel', type: 'button', title: 'Rename this slide',
        onclick: (ev: MouseEvent) => { ev.stopPropagation(); void this.renameSlide(ref); },
      }, label || 'Untitled'),
      vis ? h('span', { class: 'lec-map-badge' }, vis) : null,
      notes ? h('span', { class: 'lec-map-note', title: `${notes} note${notes === 1 ? '' : 's'} waiting` }) : null,
    );
    el.addEventListener('click', () => { ed.goTo(ref); this.hide(); });
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ed.goTo(ref); void this.menuFor(ref, { x: ev.clientX, y: ev.clientY }); });
    this.wireDrag(el, ref);
    const card: MapCard = { ref, el, iframe, dirty: true, visible: false };
    this.cards.push(card);
    this.io.observe(el);
    return el;
  }

  // -------------------------------------------------------------------- drag

  private wireDrag(el: HTMLElement, ref: SlideRef): void {
    el.addEventListener('dragstart', (ev) => {
      this.dragFrom = ref;
      el.classList.add('lec-dragging');
      this.container.classList.add('lec-dragging-on');
      ev.dataTransfer?.setData('text/plain', `slide:${ref.top}/${ref.sub}`);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('lec-dragging');
      this.container.classList.remove('lec-dragging-on');
      this.clearMarks();
      this.dragFrom = null;
    });
    el.addEventListener('dragover', (ev) => {
      if (!this.dragFrom) return;
      ev.preventDefault();
      this.clearMarks();
      el.classList.add(this.after(ev, ref) ? 'lec-drop-after' : 'lec-drop-before');
    });
    el.addEventListener('dragleave', () => el.classList.remove('lec-drop-after', 'lec-drop-before'));
    el.addEventListener('drop', (ev) => {
      const from = this.dragFrom;
      if (!from) return;
      ev.preventDefault();
      const after = this.after(ev, ref);
      this.clearMarks();
      this.dragFrom = null;
      this.drop(from, ref, after);
    });
  }

  /** Columns read left-to-right, a stack reads top-to-bottom. */
  private after(ev: DragEvent, ref: SlideRef): boolean {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    return ref.sub === null ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
  }

  private clearMarks(): void {
    for (const c of this.cards) c.el.classList.remove('lec-drop-after', 'lec-drop-before');
  }

  private drop(from: SlideRef, to: SlideRef, after: boolean): void {
    const ed = this.app.editor;
    if (from.top === to.top && from.sub === to.sub) return;
    if (from.sub === null) {
      let target = to.top + (after ? 1 : 0);
      if (from.top < target) target--;
      ed.moveSlide(from.top, target);
    } else if (to.sub !== null && from.top === to.top) {
      let target = to.sub + (after ? 1 : 0);
      if (from.sub < target) target--;
      ed.moveSubSlide(from.top, from.sub, target);
    } else {
      // Out of its stack, then into place as a top-level slide.
      const home = from.top;
      ed.unnestSlide(from.top, from.sub);
      let target = to.top + (after ? 1 : 0);
      if (to.top > home) target--; // the promoted slide now sits at home + 1
      ed.moveSlide(home + 1, Math.max(0, target));
    }
  }

  // ----------------------------------------------------------- menu & naming

  private async menuFor(ref: SlideRef, at: { x: number; y: number }): Promise<void> {
    const ed = this.app.editor;
    const top = ed.doc.slides[ref.top].el;
    const src = ed.stage.srcSection(ref);
    const vis = src.getAttribute('data-visibility') ?? '';
    const declared = top.getAttribute(SECTION_ATTR);
    await showMenu([
      { label: 'Go to this slide', onSelect: () => { ed.goTo(ref); this.hide(); } },
      { label: 'Rename this slide…', onSelect: () => void this.renameSlide(ref) },
      { label: 'New slide after this one', onSelect: () => void this.newSlide(ref.top) },
      { label: 'New slide below this one', hint: 'reveal’s ↓', onSelect: () => void this.newSlide(ref.top, { below: true }) },
      { separator: true },
      { label: declared === null ? 'Start a section here…' : 'Rename this section…', onSelect: () => void this.nameSection(ref.top, declared) },
      { label: 'Remove the section break', disabled: declared === null, onSelect: () => ed.setSlideAttr({ top: ref.top, sub: null }, SECTION_ATTR, null) },
      { separator: true },
      {
        label: 'Nest under the slide before', disabled: ref.sub !== null || ref.top === 0,
        hint: 'reveal’s ↓', onSelect: () => ed.nestSlide(ref.top, ref.top - 1),
      },
      {
        label: 'Promote out of the stack', disabled: ref.sub === null,
        onSelect: () => { if (ref.sub !== null) ed.unnestSlide(ref.top, ref.sub); },
      },
      { separator: true },
      { label: 'Hidden when presenting', checked: vis === 'hidden', onSelect: () => ed.setSlideAttr(ref, 'data-visibility', vis === 'hidden' ? null : 'hidden') },
      { label: 'Duplicate', onSelect: () => ed.duplicateSlide(ref) },
      { label: 'Delete slide', onSelect: () => ed.deleteSlide(ref) },
    ], at);
  }

  /**
   * A new slide, titled before it exists — a slide called "Heading" is a slide
   * you have to come back to. `below` nests it into the column, making a stack.
   */
  private async newSlide(after: number, opts: { below?: boolean } = {}): Promise<void> {
    const ed = this.app.editor;
    const title = await promptDialog(opts.below ? 'New slide below this one' : 'New slide', 'Title', '', 'What this slide says');
    if (title === null) return;
    const heading = escapeHtml(title.trim() || 'Untitled');
    const at = ed.addSlide(`<section>\n  <h2>${heading}</h2>\n</section>`, after);
    if (opts.below) ed.nestSlide(at, after);
    this.render();
  }

  /** Retitles a slide by its heading — the thing the map, compass and navigator all show. */
  private async renameSlide(ref: SlideRef): Promise<void> {
    const ed = this.app.editor;
    const src = ed.stage.srcSection(ref);
    const head = src.querySelector('h1, h2, h3, .big');
    const current = (head?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const title = await promptDialog('Slide title', 'Title', current, 'What this slide says');
    if (title === null) return;
    const html = escapeHtml(title.trim());
    ed.edit('Rename slide', () => {
      if (head) ed.stage.setInnerHTML(head, html);
      else ed.stage.insertHtml(src, src.firstElementChild, `<h2>${html}</h2>`);
    }, { top: ref.top });
    this.render();
  }

  private async nameSection(top: number, current: string | null): Promise<void> {
    const name = await promptDialog(
      current === null ? 'Start a section here' : 'Name this section',
      'Section name', current ?? '', 'Anatomy',
    );
    if (name === null) return;
    // An empty name still starts a section — a seam without a label.
    this.app.editor.setSlideAttr({ top, sub: null }, SECTION_ATTR, name.trim());
    this.render();
  }

  // ------------------------------------------------------------- thumbnails

  private renderDirty(): void {
    for (const c of this.cards) if (c.dirty && (c.visible || !this.visible)) this.paintCard(c);
    this.fit();
  }

  private paintCard(c: MapCard): void {
    this.app.thumbs.render(c.ref, c.iframe);
    c.dirty = false;
    this.fitCard(c);
  }

  /** Scales each thumbnail iframe down to its cell (the iframe is full slide size). */
  fit(): void {
    for (const c of this.cards) this.fitCard(c);
  }

  private fitCard(c: MapCard): void {
    const { width } = this.app.editor.stage.slideSize;
    const w = c.iframe.parentElement?.clientWidth ?? 0;
    if (w) c.iframe.style.transform = `scale(${w / width})`;
  }
}
