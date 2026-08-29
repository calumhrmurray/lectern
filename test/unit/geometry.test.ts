import { describe, expect, it } from 'vitest';
import { normalizeRect, rectsIntersect, resizeRect, snapEdge, snapLines, snapMove, unionRect } from '../../src/stage/geometry';

describe('rects', () => {
  it('unions', () => {
    expect(unionRect([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(unionRect([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
  it('intersects', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
  it('normalizes', () => {
    expect(normalizeRect(10, 10, 0, 0)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
});

describe('snapping', () => {
  const canvas = { width: 1280, height: 720 };
  it('snaps to the canvas centre', () => {
    const lines = snapLines(canvas, []);
    const moving = { x: 636, y: 100, w: 10, h: 10 }; // centre at 641, 4px off 640
    const r = snapMove(moving, lines, 6);
    expect(r.dx).toBe(-1);
    expect(r.guides.find((g) => g.axis === 'x')?.at).toBe(640);
  });
  it('snaps to another object edge and reports a guide spanning both', () => {
    const other = { x: 100, y: 300, w: 50, h: 50 };
    const lines = snapLines(canvas, [other]);
    const moving = { x: 153, y: 100, w: 20, h: 20 }; // left edge 3px right of other's right edge
    const r = snapMove(moving, lines, 6);
    expect(r.dx).toBe(-3);
    const g = r.guides.find((x) => x.axis === 'x')!;
    expect(g.at).toBe(150);
    expect(g.from).toBe(100);
    expect(g.to).toBe(350);
  });
  it('does not snap beyond the threshold', () => {
    const lines = snapLines(canvas, []);
    const r = snapMove({ x: 20, y: 20, w: 10, h: 10 }, lines, 6);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });
  it('snaps a single edge', () => {
    const lines = snapLines(canvas, []);
    expect(snapEdge(1276, lines.x, 6).value).toBe(1280);
    expect(snapEdge(1200, lines.x, 6).line).toBeNull();
  });
});

describe('resizeRect', () => {
  const start = { x: 100, y: 100, w: 200, h: 100 };
  it('resizes from the south-east corner', () => {
    expect(resizeRect(start, 'se', 10, 20)).toEqual({ x: 100, y: 100, w: 210, h: 120 });
  });
  it('resizes from the north-west corner, moving the origin', () => {
    expect(resizeRect(start, 'nw', 10, 20)).toEqual({ x: 110, y: 120, w: 190, h: 80 });
  });
  it('enforces a minimum size', () => {
    expect(resizeRect(start, 'e', -500, 0).w).toBe(8);
  });
  it('keeps aspect on corners', () => {
    const r = resizeRect(start, 'se', 100, 0, { keepAspect: true });
    expect(r.w).toBe(300);
    expect(r.h).toBe(150);
  });
  it('keeps aspect on an edge, centring the other axis', () => {
    const r = resizeRect(start, 'e', 200, 0, { keepAspect: true });
    expect(r).toEqual({ x: 100, y: 50, w: 400, h: 200 });
  });
});
