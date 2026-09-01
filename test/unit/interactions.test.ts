import { beforeEach, describe, expect, it } from 'vitest';
import { Interactions, type DragSession, type InteractionHost } from '../../src/stage/Interactions';
import type { HandleName } from '../../src/stage/geometry';
import type { Overlay } from '../../src/stage/Overlay';
import type { Rect } from '../../src/stage/Stage';

/** The overlay as `Interactions` sees it: an element to listen on, text mode, handle hit-testing, a cursor. */
class FakeOverlay {
  el = document.createElement('div');
  isTextMode = false;
  cursor = '';
  handles = new Map<EventTarget, HandleName | 'rotate'>();
  constructor() {
    // jsdom has no pointer capture.
    Object.assign(this.el, { setPointerCapture: () => {}, releasePointerCapture: () => {} });
  }
  handleAt(target: EventTarget | null): HandleName | 'rotate' | null { return (target && this.handles.get(target)) ?? null; }
  /** A handle element inside the overlay, as the real overlay draws them. */
  handle(name: HandleName | 'rotate'): Element { const h = document.createElement('div'); this.el.appendChild(h); this.handles.set(h, name); return h; }
  setCursor(cursor: string): void { this.cursor = cursor; }
}

/** Records every call; `hits` maps client x → element for `hitTest`. */
class FakeHost implements InteractionHost {
  calls: string[] = [];
  sel: Element[] = [];
  hits = new Map<number, Element>();
  inRect: Element[] = [];
  sessions: Array<{ updates: Array<[number, number]>; committed: boolean; cancelled: boolean }> = [];
  marquee: Rect | null = null;

  hitTest(clientX: number): Element | null { return this.hits.get(clientX) ?? null; }
  selection(): Element[] { return this.sel; }
  select(els: Element[], mode: 'replace' | 'toggle' | 'add'): void {
    this.calls.push(`select:${mode}:${els.map((e) => e.id).join(',')}`);
    if (mode === 'replace') this.sel = [...els];
    else if (mode === 'add') this.sel = [...new Set([...this.sel, ...els])];
    else for (const el of els) this.sel = this.sel.includes(el) ? this.sel.filter((e) => e !== el) : [...this.sel, el];
  }
  clearSelection(): void { this.calls.push('clear'); this.sel = []; }
  elementsInRect(): Element[] { return this.inRect; }
  toSlide(clientX: number, clientY: number): { x: number; y: number } { return { x: clientX * 2, y: clientY * 2 }; }
  scale(): number { return 0.5; }
  private session(label: string): DragSession {
    const rec = { updates: [] as Array<[number, number]>, committed: false, cancelled: false };
    this.sessions.push(rec);
    this.calls.push(label);
    return {
      update: (dx, dy) => { rec.updates.push([dx, dy]); },
      commit: () => { rec.committed = true; },
      cancel: () => { rec.cancelled = true; },
    };
  }
  beginMove(els: Element[]): DragSession | null { return this.session(`move:${els.map((e) => e.id).join(',')}`); }
  beginResize(el: Element, handle: HandleName): DragSession | null { return this.session(`resize:${el.id}:${handle}`); }
  beginRotate(el: Element): DragSession | null { return this.session(`rotate:${el.id}`); }
  startTextEdit(el: Element): void { this.calls.push(`edit:${el.id}`); }
  setHover(el: Element | null): void { this.calls.push(`hover:${el?.id ?? '-'}`); }
  setMarquee(rect: Rect | null): void { this.marquee = rect; this.calls.push(rect ? `marquee:${rect.x},${rect.y},${rect.w},${rect.h}` : 'marquee:-'); }
  isTextEditable(el: Element): boolean { return el.tagName === 'P'; }
  rotationOf(): number { return 0; }
  clickTarget(el: Element): void { this.calls.push(`click:${el.id}`); }
  dblClickEmpty(x: number, y: number): void { this.calls.push(`dblEmpty:${x},${y}`); }
}

const el = (id: string, tag = 'div'): Element => { const e = document.createElement(tag); e.id = id; return e; };

let overlay: FakeOverlay;
let host: FakeHost;
let ix: Interactions;
let a: Element, b: Element, p: Element;

const fire = (type: string, init: PointerEventInit & { target?: EventTarget } = {}) => {
  const ev = new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, ...init });
  (init.target ?? overlay.el).dispatchEvent(ev);
  return ev;
};
const down = (x: number, y = 0, init: PointerEventInit & { target?: EventTarget } = {}) => fire('pointerdown', { clientX: x, clientY: y, ...init });
const move = (x: number, y = 0, init: PointerEventInit = {}) => fire('pointermove', { clientX: x, clientY: y, ...init });
const up = (x: number, y = 0, init: PointerEventInit = {}) => fire('pointerup', { clientX: x, clientY: y, ...init });
/** Calls other than hover/cursor noise. */
const actions = () => host.calls.filter((c) => !c.startsWith('hover:'));

beforeEach(() => {
  overlay = new FakeOverlay();
  host = new FakeHost();
  ix = new Interactions(overlay as unknown as Overlay, host);
  a = el('a'); b = el('b'); p = el('p', 'p');
  host.hits.set(100, a).set(200, b).set(300, p);
});

describe('Interactions', () => {
  it('a click on an object selects it on press and reports the click on release', () => {
    down(100); up(100);
    expect(actions()).toEqual(['select:replace:a', 'click:a']);
    expect(host.sel).toEqual([a]);
    expect(ix.busy).toBe(false);
  });

  it('a click on empty canvas clears the selection; shift-click on empty keeps it', () => {
    host.sel = [a];
    down(50, 0, { shiftKey: true }); up(50);
    expect(actions()).toEqual([]);
    down(50); up(50);
    expect(actions()).toEqual(['clear']);
  });

  it('shift-click adds an unselected object and toggles off an already selected one', () => {
    host.sel = [a];
    down(200, 0, { shiftKey: true }); up(200, 0, { shiftKey: true });
    expect(actions()).toEqual(['select:add:b']);
    expect(host.sel).toEqual([a, b]);
    host.calls = [];
    down(100, 0, { metaKey: true }); up(100);
    expect(actions()).toEqual(['select:toggle:a']);
    expect(host.sel).toEqual([b]);
  });

  it('clicking an already selected object in a multi-selection narrows to it — but not on drag', () => {
    host.sel = [a, b];
    down(100); up(100);
    expect(actions()).toEqual(['select:replace:a', 'click:a']);
    host.calls = []; host.sel = [a, b];
    down(100); move(110); up(110);
    expect(actions().some((c) => c.startsWith('select:'))).toBe(false);
    expect(host.sel).toEqual([a, b]);
  });

  it('a drag on an object waits for the threshold, then moves the whole selection in slide units', () => {
    host.sel = [a, b];
    down(200, 10);
    move(201, 11);
    expect(ix.busy).toBe(false);
    expect(host.sessions).toHaveLength(0);
    move(210, 10);
    expect(ix.busy).toBe(true);
    expect(actions()).toEqual(['move:a,b']);
    expect(overlay.cursor).toBe('move');
    move(230, 30);
    up(230, 30);
    // 10 client px at scale 0.5 = 20 slide units; then 30/20.
    expect(host.sessions[0].updates).toEqual([[20, 0], [60, 40]]);
    expect(host.sessions[0].committed).toBe(true);
    expect(ix.busy).toBe(false);
    expect(overlay.cursor).toBe('');
  });

  it('a drag on empty canvas starts a marquee that replaces the selection and reports intersecting elements', () => {
    host.sel = [a];
    host.inRect = [b, p];
    down(10, 10); move(40, 30);
    expect(ix.busy).toBe(true);
    expect(actions()).toEqual(['clear', 'marquee:20,20,60,40', 'select:replace:b,p']);
    up(40, 30);
    expect(host.marquee).toBeNull();
    expect(actions().at(-1)).toBe('marquee:-');
    expect(ix.busy).toBe(false);
  });

  it('a shift-drag marquee adds to the selection instead of clearing it', () => {
    host.sel = [a];
    host.inRect = [b];
    down(10, 10, { shiftKey: true }); move(40, 40, { shiftKey: true }); up(40, 40);
    expect(actions()).not.toContain('clear');
    expect(host.sel).toEqual([a, b]);
  });

  it('dragging a handle resizes or rotates the primary selection without reselecting', () => {
    host.sel = [a];
    const se = overlay.handle('se'); const rot = overlay.handle('rotate');
    down(0, 0, { target: se }); move(20, 20); up(20, 20);
    expect(actions()).toEqual(['resize:a:se']);
    expect(host.sessions[0].committed).toBe(true);
    host.calls = [];
    down(0, 0, { target: rot }); move(20, 20);
    expect(actions()).toEqual(['rotate:a']);
    expect(overlay.cursor).toBe('grabbing');
    up(20, 20);
  });

  it('pointercancel (and cancel()) abort a drag and a marquee without committing', () => {
    host.sel = [a];
    down(100); move(150);
    fire('pointercancel');
    expect(host.sessions[0].cancelled).toBe(true);
    expect(host.sessions[0].committed).toBe(false);
    expect(ix.busy).toBe(false);
    host.calls = [];
    down(10, 10); move(40, 40);
    ix.cancel();
    expect(host.marquee).toBeNull();
    expect(ix.busy).toBe(false);
    expect(overlay.cursor).toBe('');
  });

  it('ignores presses in text mode and non-primary buttons', () => {
    overlay.isTextMode = true;
    down(100); up(100);
    overlay.isTextMode = false;
    down(100, 0, { button: 2 }); up(100, 0, { button: 2 });
    expect(actions()).toEqual([]);
  });

  it('double-click edits text objects, reports empty canvas, and does nothing on other objects', () => {
    const dbl = (x: number) => overlay.el.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: 5, bubbles: true }));
    dbl(300);
    expect(actions()).toEqual(['select:replace:p', 'edit:p']);
    host.calls = [];
    dbl(50);
    expect(actions()).toEqual(['dblEmpty:50,5']);
    host.calls = [];
    dbl(100);
    expect(actions()).toEqual([]);
  });

  it('hovering reports the object under the pointer, and nothing while over a handle', () => {
    const se = overlay.handle('se');
    move(100);
    expect(host.calls.at(-1)).toBe('hover:a');
    fire('pointermove', { clientX: 100, target: se });
    expect(host.calls.at(-1)).toBe('hover:-');
    expect(overlay.cursor).not.toBe('');
  });
});
