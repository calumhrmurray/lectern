/**
 * Interactions — the pointer state machine for the canvas overlay:
 * click-to-select, shift-click, drag to move, handle drags to resize/rotate,
 * marquee selection on empty canvas, double-click to edit text.
 *
 * It talks to the editor through the `InteractionHost` interface so the
 * logic stays testable and independent of the UI.
 */

import { cursorForHandle, type HandleName } from './geometry';
import type { Overlay } from './Overlay';
import type { Rect } from './Stage';

export interface DragSession {
  /** dx/dy in slide units from the drag origin. */
  update(dx: number, dy: number, mods: { shift: boolean; alt: boolean }): void;
  commit(): void;
  cancel(): void;
}

export interface InteractionHost {
  /** Selectable source element under an iframe-client point. */
  hitTest(clientX: number, clientY: number): Element | null;
  selection(): Element[];
  select(els: Element[], mode: 'replace' | 'toggle' | 'add'): void;
  clearSelection(): void;
  /** Elements whose rects intersect a slide-unit rect. */
  elementsInRect(rect: Rect): Element[];
  toSlide(clientX: number, clientY: number): { x: number; y: number };
  scale(): number;
  beginMove(els: Element[]): DragSession | null;
  beginResize(el: Element, handle: HandleName): DragSession | null;
  beginRotate(el: Element, originClient: { x: number; y: number }): DragSession | null;
  startTextEdit(el: Element, caret?: { clientX: number; clientY: number }): void;
  setHover(el: Element | null): void;
  setMarquee(rect: Rect | null): void;
  isTextEditable(el: Element): boolean;
  rotationOf(el: Element): number;
  /** Right-click. */
  contextMenu?(clientX: number, clientY: number, el: Element | null): void;
  /** Double-click on empty canvas. */
  dblClickEmpty?(clientX: number, clientY: number): void;
  /** Double-click on an object; return true to swallow it (no text editing). */
  dblClickTarget?(el: Element): boolean;
  /** Plain click (no drag) on an object, after selection. */
  clickTarget?(el: Element): void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'press'; x: number; y: number; target: Element | null; handle: HandleName | 'rotate' | null; shift: boolean; moved: boolean; pointerId: number; wasSelected: boolean }
  | { kind: 'drag'; x: number; y: number; session: DragSession; pointerId: number; cursor: string }
  | { kind: 'marquee'; x: number; y: number; pointerId: number; additive: boolean };

const DRAG_THRESHOLD = 3;

export class Interactions {
  private state: State = { kind: 'idle' };

  constructor(readonly overlay: Overlay, readonly host: InteractionHost) {
    const el = overlay.el;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('dblclick', this.onDblClick);
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('pointerleave', () => { if (this.state.kind === 'idle') this.host.setHover(null); });
  }

  get busy(): boolean { return this.state.kind === 'drag' || this.state.kind === 'marquee'; }

  cancel(): void {
    if (this.state.kind === 'drag') this.state.session.cancel();
    if (this.state.kind === 'marquee') this.host.setMarquee(null);
    this.state = { kind: 'idle' };
    this.overlay.setCursor('');
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0) return;
    if (this.overlay.isTextMode) return;
    ev.preventDefault();
    this.overlay.el.focus({ preventScroll: true });
    const handle = this.overlay.handleAt(ev.target);
    const selection = this.host.selection();
    let target: Element | null;
    if (handle) {
      target = selection[0] ?? null;
    } else {
      target = this.host.hitTest(ev.clientX, ev.clientY);
    }
    const wasSelected = !!target && selection.includes(target);
    this.state = { kind: 'press', x: ev.clientX, y: ev.clientY, target, handle, shift: ev.shiftKey || ev.metaKey, moved: false, pointerId: ev.pointerId, wasSelected };
    this.overlay.el.setPointerCapture(ev.pointerId);

    if (!handle && target && !wasSelected) {
      this.host.select([target], ev.shiftKey || ev.metaKey ? 'add' : 'replace');
    }
  };

  private onPointerMove = (ev: PointerEvent): void => {
    const s = this.state;
    if (s.kind === 'idle') {
      if (this.overlay.isTextMode) return;
      const handle = this.overlay.handleAt(ev.target);
      if (handle) {
        const sel = this.host.selection()[0];
        this.overlay.setCursor(handle === 'rotate' ? 'grab' : cursorForHandle(handle, sel ? this.host.rotationOf(sel) : 0));
        this.host.setHover(null);
      } else {
        this.overlay.setCursor('');
        this.host.setHover(this.host.hitTest(ev.clientX, ev.clientY));
      }
      return;
    }
    if (s.kind === 'press') {
      const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      // Start a drag / resize / rotate / marquee.
      let session: DragSession | null = null;
      let cursor = 'move';
      if (s.handle === 'rotate' && s.target) {
        session = this.host.beginRotate(s.target, { x: s.x, y: s.y });
        cursor = 'grabbing';
      } else if (s.handle && s.handle !== 'rotate' && s.target) {
        session = this.host.beginResize(s.target, s.handle);
        cursor = cursorForHandle(s.handle, this.host.rotationOf(s.target));
      } else if (s.target) {
        const sel = this.host.selection();
        session = this.host.beginMove(sel.length ? sel : [s.target]);
      } else {
        this.state = { kind: 'marquee', x: s.x, y: s.y, pointerId: s.pointerId, additive: s.shift };
        if (!s.shift) this.host.clearSelection();
        this.updateMarquee(ev);
        return;
      }
      if (!session) { this.state = { kind: 'idle' }; return; }
      this.state = { kind: 'drag', x: s.x, y: s.y, session, pointerId: s.pointerId, cursor };
      this.overlay.setCursor(cursor);
      this.host.setHover(null);
      this.updateDrag(ev);
      return;
    }
    if (s.kind === 'drag') { this.updateDrag(ev); return; }
    if (s.kind === 'marquee') { this.updateMarquee(ev); return; }
  };

  private updateDrag(ev: PointerEvent): void {
    if (this.state.kind !== 'drag') return;
    const scale = this.host.scale();
    const dx = (ev.clientX - this.state.x) / scale;
    const dy = (ev.clientY - this.state.y) / scale;
    this.state.session.update(dx, dy, { shift: ev.shiftKey, alt: ev.altKey });
  }

  private updateMarquee(ev: PointerEvent): void {
    if (this.state.kind !== 'marquee') return;
    const a = this.host.toSlide(this.state.x, this.state.y);
    const b = this.host.toSlide(ev.clientX, ev.clientY);
    const rect: Rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    this.host.setMarquee(rect);
    const els = this.host.elementsInRect(rect);
    this.host.select(els, this.state.additive ? 'add' : 'replace');
  }

  private onPointerUp = (ev: PointerEvent): void => {
    const s = this.state;
    if (s.kind === 'idle') return;
    try { this.overlay.el.releasePointerCapture(s.pointerId); } catch { /* ignore */ }
    if (s.kind === 'press') {
      // A click without drag.
      if (s.target) {
        if (s.shift && s.wasSelected) this.host.select([s.target], 'toggle');
        else if (!s.shift && s.wasSelected && !s.handle) this.host.select([s.target], 'replace');
        if (!s.shift && !s.handle) this.host.clickTarget?.(s.target);
      } else if (!s.shift) {
        this.host.clearSelection();
      }
    } else if (s.kind === 'drag') {
      s.session.commit();
    } else if (s.kind === 'marquee') {
      this.host.setMarquee(null);
    }
    this.state = { kind: 'idle' };
    this.overlay.setCursor('');
  };

  private onPointerCancel = (): void => { this.cancel(); };

  private onDblClick = (ev: MouseEvent): void => {
    if (this.overlay.isTextMode) return;
    ev.preventDefault();
    const target = this.host.hitTest(ev.clientX, ev.clientY);
    // A note handles its own double-click (comment, or dismiss when it is done).
    if (target && this.host.dblClickTarget?.(target)) return;
    // Everything else: a note here. It used to edit whatever text was under the
    // pointer, which meant a full slide had nowhere left to put a note. Text is
    // edited by selecting it and pressing Enter, or by typing over it.
    this.host.dblClickEmpty?.(ev.clientX, ev.clientY);
  };

  private onContextMenu = (ev: MouseEvent): void => {
    if (this.overlay.isTextMode) return;
    ev.preventDefault();
    const target = this.host.hitTest(ev.clientX, ev.clientY);
    if (target && !this.host.selection().includes(target)) this.host.select([target], 'replace');
    this.host.contextMenu?.(ev.clientX, ev.clientY, target);
  };
}
