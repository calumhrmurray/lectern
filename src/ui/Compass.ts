/**
 * The compass: the whole deck as a row of dots, in the corner of the canvas.
 *
 * One dot per top-level slide, a seam between sections, a descender under any
 * slide that has a vertical stack (reveal's second axis, which a list of
 * thumbnails cannot show), and a hollow dot for a slide that is hidden when
 * presenting. It is small enough to leave on screen at all times — which is the
 * point: it is what makes hiding the panels safe rather than disorienting.
 *
 * Click a dot to go there; click the label to open the map.
 */

import type { App } from '../app/App';
import { slideLabel } from '../deck/html';
import { sectionIndexAt, sectionsOf, type DeckSection } from '../deck/sections';
import type { SlideRef } from '../stage/Stage';
import { h } from './dom';

const NS = 'http://www.w3.org/2000/svg';

/** One top-level slide, as the compass needs it. */
interface Mark {
  top: number;
  label: string;
  hidden: boolean;
  /** Number of sub-slides in the vertical stack (0 when it is a plain slide). */
  depth: number;
  section: number;
  x: number;
}

export class Compass {
  private svg: SVGSVGElement;
  private labelEl: HTMLElement;
  private numEl: HTMLElement;
  private marks: Mark[] = [];
  private sections: DeckSection[] = [];
  private hover: number | null = null;

  /** `counter` is where the page number goes — the other end of the bar. */
  constructor(readonly app: App, readonly container: HTMLElement, readonly counter: HTMLElement) {
    this.svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'lec-compass-svg');
    this.labelEl = h('button', {
      class: 'lec-compass-label', type: 'button', title: 'Open the map (M)',
      onclick: () => this.app.map.toggle(),
    });
    this.numEl = h('button', {
      class: 'lec-compass-num', type: 'button', title: 'Open the map (M)',
      onclick: () => this.app.map.toggle(),
    });
    container.append(this.svg, this.labelEl);
    counter.appendChild(this.numEl);
    container.addEventListener('pointerleave', () => { this.hover = null; this.setLabel(this.cur()); });
  }

  /** Rebuilds from the deck (call when slides are added, removed or renamed). */
  render(): void {
    const ed = this.app.editor;
    if (!ed.ready || !ed.doc.length) {
      this.marks = [];
      this.sections = [];
      this.svg.replaceChildren();
      this.labelEl.textContent = '';
      this.numEl.textContent = '';
      return;
    }
    const tops = ed.doc.slides.map((s) => s.el);
    this.sections = sectionsOf(tops);
    const refs = ed.slideRefs();
    this.marks = tops.map((el, top) => ({
      top,
      label: slideLabel(el, `Slide ${top + 1}`),
      hidden: el.getAttribute('data-visibility') === 'hidden',
      depth: refs.filter((r) => r.top === top && r.sub !== null).length,
      section: sectionIndexAt(this.sections, top),
      x: 0,
    }));
    this.layout();
    this.paint();
  }

  /** Repaints the current position only (cheap; call on every slide change). */
  update(): void {
    if (this.marks.length) this.paint();
  }

  /** Space between dots, shrinking for a long deck; null when there is no room. */
  private layout(): number | null {
    const n = this.marks.length;
    // Measure the window, not an ancestor: every box we sit in shrink-wraps this
    // svg, so asking a parent how wide it is asks how wide we decided to be.
    const roomW = this.container.ownerDocument.documentElement.clientWidth || 900;
    const avail = Math.max(60, Math.min(roomW * 0.42, 640) - 40);
    const gaps = this.sections.length - 1;
    let step = 10;
    while (step > 4 && (n - 1) * step + gaps * 6 > avail) step -= 0.5;
    if ((n - 1) * step + gaps * 6 > avail) {
      this.marks.forEach((m) => { m.x = 0; });
      return null;
    }
    let x = 6;
    let section = this.marks[0]?.section ?? 0;
    for (const m of this.marks) {
      if (m.section !== section) { x += 6; section = m.section; }
      m.x = x;
      x += step;
    }
    return step;
  }

  private cur(): SlideRef | null {
    return this.app.editor.ready ? this.app.editor.current : null;
  }

  private paint(): void {
    const cur = this.cur();
    const step = this.layout();
    this.svg.replaceChildren();
    if (!this.marks.length) return;

    if (step === null) {
      // Too many slides for the space: keep the label, drop the dots.
      this.svg.setAttribute('width', '0');
      this.svg.setAttribute('height', '0');
      this.setLabel(cur);
      return;
    }

    const maxDepth = Math.max(0, ...this.marks.map((m) => m.depth));
    const width = (this.marks.at(-1)?.x ?? 0) + 8;
    const height = 16 + maxDepth * 7;
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    for (const m of this.marks) {
      const isCurrent = !!cur && cur.top === m.top;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', `lec-compass-mark${isCurrent ? ' lec-on' : ''}`);
      g.setAttribute('tabindex', '-1');

      if (m.depth) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', String(m.x)); line.setAttribute('x2', String(m.x));
        line.setAttribute('y1', '8'); line.setAttribute('y2', String(8 + m.depth * 7));
        line.setAttribute('class', 'lec-compass-stem');
        g.appendChild(line);
        for (let i = 0; i < m.depth; i++) {
          const sub = document.createElementNS(NS, 'circle');
          sub.setAttribute('cx', String(m.x));
          sub.setAttribute('cy', String(8 + (i + 1) * 7));
          sub.setAttribute('r', String(isCurrent && cur?.sub === i ? 2.8 : 1.9));
          sub.setAttribute('class', `lec-compass-sub${isCurrent && cur?.sub === i ? ' lec-on' : ''}`);
          g.appendChild(sub);
        }
      }

      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', String(m.x));
      dot.setAttribute('cy', '8');
      dot.setAttribute('r', String(isCurrent ? 3.8 : 2.9));
      dot.setAttribute('class', `lec-compass-dot${m.hidden ? ' lec-hollow' : ''}`);
      g.appendChild(dot);

      // A generous invisible hit area — the dots themselves are tiny.
      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', String(m.x - 4.5)); hit.setAttribute('y', '0');
      hit.setAttribute('width', '9'); hit.setAttribute('height', String(height));
      hit.setAttribute('class', 'lec-compass-hit');
      const name = this.sections[m.section]?.name;
      const title = document.createElementNS(NS, 'title');
      title.textContent = `${m.top + 1}. ${m.label}${name ? ` — ${name}` : ''}${m.hidden ? ' (hidden)' : ''}`;
      hit.appendChild(title);
      hit.addEventListener('click', () => this.app.editor.goTo({ top: m.top, sub: m.depth ? 0 : null }));
      hit.addEventListener('pointerenter', () => { this.hover = m.top; this.setLabel(this.cur()); });
      g.appendChild(hit);

      this.svg.appendChild(g);
    }
    this.setLabel(cur);
  }

  private setLabel(cur: SlideRef | null): void {
    const shown = this.hover ?? cur?.top ?? 0;
    const mark = this.marks.find((m) => m.top === shown);
    const name = mark ? this.sections[mark.section]?.name : null;
    const num = cur ? (cur.sub === null ? `${cur.top + 1}` : `${cur.top + 1}.${cur.sub + 1}`) : '';
    this.labelEl.replaceChildren(name ? h('span', { class: 'lec-compass-section' }, name) : '');
    this.labelEl.hidden = !name;
    this.labelEl.title = name ? `${name} — open the map (M)` : 'Open the map (M)';
    this.numEl.textContent = `${num}/${this.marks.length}`;
  }
}
