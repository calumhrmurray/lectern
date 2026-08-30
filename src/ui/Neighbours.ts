/**
 * The slides around this one, showing at the edges of the quiet room.
 *
 * They sit on the axis you would actually travel to reach them, because that is
 * the whole point: in reveal the next section is → and the next sub-slide is ↓,
 * and an editor that shows a sub-slide off to the right teaches the wrong deck.
 * So the previous and next top-level slides are left and right, and a stack's
 * slides are above and below — mostly off-screen, dimmed, one click away.
 *
 * They are thumbnails (the renderer the navigator and map use), positioned off
 * the stage's own rendered slide box so the group lines up exactly.
 */

import type { App } from '../app/App';
import { isStack, slideLabel } from '../deck/html';
import type { SlideRef } from '../stage/Stage';
import { h } from './dom';

type Side = 'prev' | 'next' | 'up' | 'down';

interface Panel {
  el: HTMLElement;
  iframe: HTMLIFrameElement;
  label: HTMLElement;
  key: string;
}

export class Neighbours {
  private panels: Record<Side, Panel>;

  constructor(readonly app: App, readonly container: HTMLElement) {
    this.panels = { prev: this.panel('prev'), next: this.panel('next'), up: this.panel('up'), down: this.panel('down') };
    container.append(...Object.values(this.panels).map((p) => p.el));
  }

  private panel(side: Side): Panel {
    const iframe = h('iframe', { title: '', loading: 'lazy', tabindex: -1 }) as HTMLIFrameElement;
    const label = h('div', { class: 'lec-neighbour-label' });
    const el = h('div', {
      class: `lec-neighbour lec-${side}`, hidden: true,
      onclick: () => this.go(side),
    }, iframe, label) as HTMLElement;
    return { el, iframe, label, key: '' };
  }

  private go(side: Side): void {
    const ref = this.refFor(side);
    if (ref) this.app.editor.goTo(ref);
  }

  /** Repositions and repaints all four (cheap enough for every slide change). */
  update(): void {
    const ed = this.app.editor;
    const show = this.app.quiet && ed.ready && ed.doc.length > 0;
    for (const side of ['prev', 'next', 'up', 'down'] as Side[]) {
      this.place(side, show ? this.refFor(side) : null);
    }
  }

  /** Drops the rendered thumbnails (the deck changed under us). */
  invalidate(): void {
    for (const p of Object.values(this.panels)) p.key = '';
    this.update();
  }

  /**
   * The slide in that direction, exactly as the arrow keys would reach it:
   * left/right move between top-level slides, up/down within a stack.
   */
  private refFor(side: Side): SlideRef | null {
    const ed = this.app.editor;
    if (!ed.ready || !ed.doc.length) return null;
    const cur = ed.current;
    if (side === 'up' || side === 'down') {
      if (cur.sub === null) return null;
      const sub = cur.sub + (side === 'down' ? 1 : -1);
      const subs = ed.slideRefs().filter((r) => r.top === cur.top).length;
      return sub >= 0 && sub < subs ? { top: cur.top, sub } : null;
    }
    const top = cur.top + (side === 'next' ? 1 : -1);
    const rec = ed.doc.slides[top];
    if (!rec) return null;
    return { top, sub: isStack(rec.el) ? 0 : null };
  }

  private place(side: Side, ref: SlideRef | null): void {
    const panel = this.panels[side];
    const box = this.app.editor.slideBoxOnPage();
    if (!ref || !box) { panel.el.hidden = true; return; }
    const host = this.container.getBoundingClientRect();
    const left = box.left - host.left;
    const top = box.top - host.top;
    const gap = Math.max(10, Math.round(box.width * 0.03));

    const vertical = side === 'up' || side === 'down';
    // Sideways there is a whole gutter to fall off the edge of. Above and below
    // there is only the slack around the slide, and the bar lives down there, so
    // a stack's neighbours are cropped to a strip: the top of the next slide is
    // its kicker and heading, which is the part worth seeing.
    const room = side === 'up' ? top : host.height - (top + box.height);
    // The bar sits along the bottom, so the lower strip stops short of it.
    const strip = Math.max(56, Math.min(box.height, room - (side === 'down' ? 96 : 48)));
    const h = vertical ? strip : box.height;

    panel.el.hidden = false;
    panel.el.style.width = `${Math.round(box.width)}px`;
    panel.el.style.height = `${Math.round(h)}px`;
    // Flush outside the slide on its own axis, so a neighbour never creeps over it.
    panel.el.style.left = `${Math.round(side === 'prev' ? left - gap - box.width : side === 'next' ? left + box.width + gap : left)}px`;
    panel.el.style.top = `${Math.round(side === 'up' ? top - gap - h : side === 'down' ? top + box.height + gap : top)}px`;

    const { width } = this.app.editor.stage.slideSize;
    panel.iframe.width = String(width);
    panel.iframe.height = String(Math.round(width * (box.height / box.width)));
    panel.iframe.style.transform = `scale(${box.width / width})`;
    // The strip shows the bottom of the slide above and the top of the one below.
    panel.iframe.style.top = side === 'up' ? `${Math.round(h - box.height)}px` : '0';

    const key = `${ref.top}/${ref.sub}`;
    if (panel.key !== key) {
      this.app.thumbs.render(ref, panel.iframe);
      panel.key = key;
      const text = slideLabel(this.app.editor.stage.srcSection(ref), '');
      panel.label.textContent = text;
      panel.el.title = side === 'up' ? `↑ ${text}` : side === 'down' ? `↓ ${text}` : text;
    }
  }
}
