/**
 * Overlay — the selection layer drawn in the editor document on top of the
 * deck iframe: selection boxes, resize/rotate handles, hover outline,
 * alignment guides and the marquee.
 *
 * It is purely presentational; `Interactions` owns the pointer logic.
 */

import type { Guide, HandleName } from './geometry';
import type { Rect } from './Stage';

export interface OverlayBox {
  rect: Rect;
  rotation: number;
  /** Primary selection gets handles. */
  primary: boolean;
  /** Being edited as text (dashed outline, no handles). */
  editing?: boolean;
  /** Locked elements show handles disabled. */
  resizable: boolean;
}

export interface OverlayState {
  boxes: OverlayBox[];
  hover: Rect | null;
  guides: Guide[];
  marquee: Rect | null;
  /** Rect of the whole slide (for the canvas outline). */
  canvas: Rect | null;
  /** Size label near the primary box while dragging/resizing. */
  label?: { text: string; x: number; y: number } | null;
}

export const HANDLES: HandleName[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class Overlay {
  readonly el: HTMLDivElement;
  private canvasEl: HTMLDivElement;
  private hoverEl: HTMLDivElement;
  private guidesEl: HTMLDivElement;
  private boxesEl: HTMLDivElement;
  private marqueeEl: HTMLDivElement;
  private labelEl: HTMLDivElement;
  private textMode = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'lec-overlay';
    this.el.tabIndex = 0;
    this.canvasEl = mk('div', 'lec-canvas-outline');
    this.hoverEl = mk('div', 'lec-hover');
    this.guidesEl = mk('div', 'lec-guides');
    this.boxesEl = mk('div', 'lec-boxes');
    this.marqueeEl = mk('div', 'lec-marquee');
    this.labelEl = mk('div', 'lec-size-label');
    this.el.append(this.canvasEl, this.hoverEl, this.guidesEl, this.boxesEl, this.marqueeEl, this.labelEl);
    container.appendChild(this.el);
  }

  /** In text mode the overlay lets pointer events through to the iframe. */
  setTextMode(on: boolean): void {
    this.textMode = on;
    this.el.classList.toggle('lec-textmode', on);
  }

  get isTextMode(): boolean { return this.textMode; }

  /** Identifies a handle from a pointer event target. */
  handleAt(target: EventTarget | null): HandleName | 'rotate' | null {
    if (!(target instanceof HTMLElement)) return null;
    const h = target.closest<HTMLElement>('[data-handle]');
    return (h?.dataset.handle as HandleName | 'rotate' | undefined) ?? null;
  }

  /** Whether the target is inside a selection box (used to start a move from the box itself). */
  isBoxTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && !!target.closest('.lec-box');
  }

  render(state: OverlayState, toClient: (x: number, y: number) => { x: number; y: number }, scale: number): void {
    const place = (el: HTMLElement, r: Rect) => {
      const p = toClient(r.x, r.y);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.width = `${r.w * scale}px`;
      el.style.height = `${r.h * scale}px`;
    };

    // canvas outline
    if (state.canvas) { this.canvasEl.style.display = ''; place(this.canvasEl, state.canvas); }
    else this.canvasEl.style.display = 'none';

    // hover
    if (state.hover) { this.hoverEl.style.display = ''; place(this.hoverEl, state.hover); }
    else this.hoverEl.style.display = 'none';

    // boxes
    this.boxesEl.replaceChildren();
    for (const b of state.boxes) {
      const box = mk('div', 'lec-box');
      if (b.primary) box.classList.add('lec-primary');
      if (b.editing) box.classList.add('lec-editing');
      place(box, b.rect);
      if (b.rotation) box.style.transform = `rotate(${b.rotation}deg)`;
      if (b.primary && !b.editing && state.boxes.length === 1) {
        for (const h of HANDLES) {
          const hd = mk('div', `lec-handle lec-h-${h}`);
          hd.dataset.handle = h;
          if (!b.resizable) hd.classList.add('lec-disabled');
          box.appendChild(hd);
        }
        const rot = mk('div', 'lec-handle lec-rotate');
        rot.dataset.handle = 'rotate';
        box.appendChild(rot);
      }
      this.boxesEl.appendChild(box);
    }

    // guides
    this.guidesEl.replaceChildren();
    for (const g of state.guides) {
      const line = mk('div', `lec-guide lec-guide-${g.axis} lec-guide-${g.kind}`);
      if (g.axis === 'x') {
        const p = toClient(g.at, g.from);
        line.style.left = `${p.x}px`; line.style.top = `${p.y}px`;
        line.style.height = `${(g.to - g.from) * scale}px`;
      } else {
        const p = toClient(g.from, g.at);
        line.style.left = `${p.x}px`; line.style.top = `${p.y}px`;
        line.style.width = `${(g.to - g.from) * scale}px`;
      }
      this.guidesEl.appendChild(line);
    }

    // marquee
    if (state.marquee) { this.marqueeEl.style.display = ''; place(this.marqueeEl, state.marquee); }
    else this.marqueeEl.style.display = 'none';

    // label
    if (state.label) {
      const p = toClient(state.label.x, state.label.y);
      this.labelEl.style.display = '';
      this.labelEl.style.left = `${p.x}px`;
      this.labelEl.style.top = `${p.y}px`;
      this.labelEl.textContent = state.label.text;
    } else this.labelEl.style.display = 'none';
  }

  setCursor(cursor: string): void {
    this.el.style.cursor = cursor;
  }
}

function mk(tag: string, cls: string): HTMLDivElement {
  const el = document.createElement(tag) as HTMLDivElement;
  el.className = cls;
  return el;
}
