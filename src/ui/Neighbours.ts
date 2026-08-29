/**
 * The slides either side of this one, showing at the edges of the quiet room.
 *
 * In quiet mode the stage is inset to leave a gutter left and right, and the
 * previous and next slides sit in those gutters — mostly off-screen, dimmed,
 * one click away. It is the deck's running order made visible without a
 * thumbnail rail: you can see what you are coming from and going to, which is
 * the thing you actually want to know while writing a talk.
 *
 * They are thumbnails (the renderer the navigator and map use), positioned to
 * match the rendered slide exactly, so the three read as one filmstrip.
 */

import type { App } from '../app/App';
import { slideLabel } from '../deck/html';
import type { SlideRef } from '../stage/Stage';
import { h } from './dom';

interface Side {
  el: HTMLElement;
  iframe: HTMLIFrameElement;
  label: HTMLElement;
  ref: SlideRef | null;
  key: string;
}

export class Neighbours {
  private prev: Side;
  private next: Side;

  constructor(readonly app: App, readonly container: HTMLElement) {
    this.prev = this.side('prev');
    this.next = this.side('next');
    container.append(this.prev.el, this.next.el);
  }

  private side(which: 'prev' | 'next'): Side {
    const iframe = h('iframe', { title: '', loading: 'lazy', tabindex: -1 }) as HTMLIFrameElement;
    const label = h('div', { class: 'lec-neighbour-label' });
    const el = h('div', {
      class: `lec-neighbour lec-${which}`, hidden: true,
      onclick: () => { if (which === 'prev') this.app.editor.prev(); else this.app.editor.next(); },
    }, iframe, label) as HTMLElement;
    return { el, iframe, label, ref: null, key: '' };
  }

  /** Repaints and repositions both sides (cheap enough for every slide change). */
  update(): void {
    const ed = this.app.editor;
    if (!this.app.quiet || !ed.ready || !ed.doc.length) {
      this.prev.el.hidden = true;
      this.next.el.hidden = true;
      return;
    }
    const refs = ed.slideRefs();
    const i = ed.currentIndexInList();
    this.show(this.prev, refs[i - 1] ?? null);
    this.show(this.next, refs[i + 1] ?? null);
  }

  /** Invalidates the rendered thumbnails (the deck changed under us). */
  invalidate(): void {
    this.prev.key = '';
    this.next.key = '';
    this.update();
  }

  private show(side: Side, ref: SlideRef | null): void {
    const box = this.slideBox();
    if (!ref || !box) { side.el.hidden = true; return; }
    side.el.hidden = false;
    side.ref = ref;

    const { width } = this.app.editor.stage.slideSize;
    side.el.style.width = `${Math.round(box.width)}px`;
    side.el.style.height = `${Math.round(box.height)}px`;
    side.el.style.top = `${Math.round(box.top)}px`;
    // Sit flush outside the slide: the gutter decides how much of them shows,
    // so they never creep over the slide however the window is shaped.
    const gap = Math.max(10, Math.round(box.width * 0.03));
    const left = side.el.classList.contains('lec-prev')
      ? box.left - gap - box.width
      : box.left + box.width + gap;
    side.el.style.left = `${Math.round(left)}px`;

    side.iframe.width = String(width);
    side.iframe.height = String(Math.round(width * (box.height / box.width)));
    side.iframe.style.transform = `scale(${box.width / width})`;

    // Only re-render the thumbnail when it is a different slide, or the deck changed.
    const key = `${ref.top}/${ref.sub}`;
    if (side.key !== key) {
      this.app.thumbs.render(ref, side.iframe);
      side.key = key;
      const src = this.app.editor.stage.srcSection(ref);
      const text = slideLabel(src, '');
      side.label.textContent = text;
      side.el.title = text;
    }
  }

  /** The rendered slide, in coordinates of the container we live in. */
  private slideBox(): { left: number; top: number; width: number; height: number } | null {
    const stage = this.app.editor.stage;
    const canvas = stage.canvasClientRect();
    if (!canvas.width || !canvas.height) return null;
    const fr = stage.iframe.getBoundingClientRect();
    const k = stage.frameTransform().k || 1;
    const host = this.container.getBoundingClientRect();
    return {
      left: fr.left + canvas.left * k - host.left,
      top: fr.top + canvas.top * k - host.top,
      width: canvas.width * k,
      height: canvas.height * k,
    };
  }
}
