/** Pure geometry helpers: rectangles, snapping and alignment guides. */

import type { Rect } from './Stage';

export interface Guide {
  axis: 'x' | 'y';
  /** Position in slide units. */
  at: number;
  /** Extent along the other axis (for drawing). */
  from: number;
  to: number;
  kind: 'canvas' | 'center' | 'object';
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export function unionRect(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

interface SnapLine { at: number; from: number; to: number; kind: Guide['kind'] }

/** Candidate snap lines from the canvas and other objects. */
export function snapLines(canvas: { width: number; height: number }, others: Rect[]): { x: SnapLine[]; y: SnapLine[] } {
  const x: SnapLine[] = [
    { at: 0, from: 0, to: canvas.height, kind: 'canvas' },
    { at: canvas.width / 2, from: 0, to: canvas.height, kind: 'center' },
    { at: canvas.width, from: 0, to: canvas.height, kind: 'canvas' },
  ];
  const y: SnapLine[] = [
    { at: 0, from: 0, to: canvas.width, kind: 'canvas' },
    { at: canvas.height / 2, from: 0, to: canvas.width, kind: 'center' },
    { at: canvas.height, from: 0, to: canvas.width, kind: 'canvas' },
  ];
  for (const r of others) {
    x.push({ at: r.x, from: r.y, to: r.y + r.h, kind: 'object' });
    x.push({ at: r.x + r.w / 2, from: r.y, to: r.y + r.h, kind: 'object' });
    x.push({ at: r.x + r.w, from: r.y, to: r.y + r.h, kind: 'object' });
    y.push({ at: r.y, from: r.x, to: r.x + r.w, kind: 'object' });
    y.push({ at: r.y + r.h / 2, from: r.x, to: r.x + r.w, kind: 'object' });
    y.push({ at: r.y + r.h, from: r.x, to: r.x + r.w, kind: 'object' });
  }
  return { x, y };
}

/**
 * Snaps a moving rect's edges and centre to the candidate lines.
 * Returns the adjustment to apply and the guides to draw.
 */
export function snapMove(moving: Rect, lines: { x: SnapLine[]; y: SnapLine[] }, threshold: number): SnapResult {
  const guides: Guide[] = [];
  const best = (edges: number[], cands: SnapLine[]): { delta: number; line: SnapLine } | null => {
    let out: { delta: number; line: SnapLine } | null = null;
    for (const e of edges) {
      for (const l of cands) {
        const d = l.at - e;
        if (Math.abs(d) <= threshold && (!out || Math.abs(d) < Math.abs(out.delta))) out = { delta: d, line: l };
      }
    }
    return out;
  };
  const bx = best([moving.x, moving.x + moving.w / 2, moving.x + moving.w], lines.x);
  const by = best([moving.y, moving.y + moving.h / 2, moving.y + moving.h], lines.y);
  const dx = bx?.delta ?? 0;
  const dy = by?.delta ?? 0;
  if (bx) {
    const from = Math.min(bx.line.from, moving.y + dy);
    const to = Math.max(bx.line.to, moving.y + dy + moving.h);
    guides.push({ axis: 'x', at: bx.line.at, from, to, kind: bx.line.kind });
  }
  if (by) {
    const from = Math.min(by.line.from, moving.x + dx);
    const to = Math.max(by.line.to, moving.x + dx + moving.w);
    guides.push({ axis: 'y', at: by.line.at, from, to, kind: by.line.kind });
  }
  return { dx, dy, guides };
}

/** Snaps a single edge position (used while resizing). */
export function snapEdge(value: number, cands: SnapLine[], threshold: number): { value: number; line: SnapLine | null } {
  let out: { value: number; line: SnapLine | null } = { value, line: null };
  let bestD = Infinity;
  for (const l of cands) {
    const d = Math.abs(l.at - value);
    if (d <= threshold && d < bestD) { bestD = d; out = { value: l.at, line: l }; }
  }
  return out;
}

export type HandleName = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Computes the new rect for a resize drag from `start` by (dx, dy) on `handle`. */
export function resizeRect(start: Rect, handle: HandleName, dx: number, dy: number, opts: { keepAspect?: boolean; minSize?: number } = {}): Rect {
  const min = opts.minSize ?? 8;
  let { x, y, w, h } = start;
  if (handle.includes('e')) w = Math.max(min, start.w + dx);
  if (handle.includes('s')) h = Math.max(min, start.h + dy);
  if (handle.includes('w')) { const nw = Math.max(min, start.w - dx); x = start.x + (start.w - nw); w = nw; }
  if (handle.includes('n')) { const nh = Math.max(min, start.h - dy); y = start.y + (start.h - nh); h = nh; }
  if (opts.keepAspect && start.w > 0 && start.h > 0) {
    const aspect = start.w / start.h;
    const corner = handle.length === 2;
    if (corner) {
      // Use the dominant change.
      const byW = Math.abs(w - start.w) >= Math.abs(h - start.h) * aspect;
      if (byW) h = w / aspect; else w = h * aspect;
    } else if (handle === 'e' || handle === 'w') {
      h = w / aspect;
    } else {
      w = h * aspect;
    }
    if (handle.includes('w')) x = start.x + start.w - w;
    if (handle.includes('n')) y = start.y + start.h - h;
    if (handle === 'n' || handle === 's') x = start.x + (start.w - w) / 2;
    if (handle === 'e' || handle === 'w') y = start.y + (start.h - h) / 2;
  }
  return { x, y, w, h };
}

export function cursorForHandle(h: HandleName, rotationDeg = 0): string {
  const order: HandleName[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const cursors = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
  const shift = Math.round(((rotationDeg % 360) + 360) % 360 / 45);
  return cursors[(order.indexOf(h) + shift) % 8];
}

/** Angle in degrees of the vector from centre to point. */
export function angleDeg(cx: number, cy: number, px: number, py: number): number {
  return (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
}
