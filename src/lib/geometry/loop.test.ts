import { describe, expect, it } from 'vitest';

import {
  boundingBox,
  containsPoint,
  poleOfInaccessibility,
  polygonCentroid,
  signedArea,
  type Polygon,
} from './loop.js';

const SQUARE: Polygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

// A 'C' shape: centroid of the vertices falls in the open notch, outside the polygon.
const C_SHAPE: Polygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 4 },
  { x: 4, y: 4 },
  { x: 4, y: 6 },
  { x: 10, y: 6 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('boundingBox', () => {
  it('finds the extremes of a simple polygon', () => {
    expect(boundingBox(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('handles a single point as a zero-size box', () => {
    expect(boundingBox([{ x: 5, y: 5 }])).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  });

  it('handles negative coordinates', () => {
    expect(
      boundingBox([
        { x: -5, y: -5 },
        { x: 3, y: 2 },
      ]),
    ).toEqual({ minX: -5, minY: -5, maxX: 3, maxY: 2 });
  });

  it('throws on an empty polygon rather than returning a nonsensical box', () => {
    expect(() => boundingBox([])).toThrow();
  });
});

describe('signedArea', () => {
  it('is positive for a counter-clockwise polygon', () => {
    expect(signedArea(SQUARE)).toBeGreaterThan(0);
  });

  it('is negative for a clockwise polygon', () => {
    expect(signedArea([...SQUARE].reverse())).toBeLessThan(0);
  });

  it('matches the known area of a 10x10 square', () => {
    expect(Math.abs(signedArea(SQUARE))).toBe(100);
  });

  it('is zero for degenerate polygons', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([{ x: 1, y: 1 }])).toBe(0);
    expect(
      signedArea([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe(0);
  });

  it('is zero for collinear points', () => {
    expect(
      signedArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe(0);
  });
});

describe('polygonCentroid', () => {
  it('finds the centre of a square', () => {
    expect(polygonCentroid(SQUARE)).toEqual({ x: 5, y: 5 });
  });

  it('falls outside a concave C-shape — this is exactly why callers must check containsPoint', () => {
    const centroid = polygonCentroid(C_SHAPE);
    expect(containsPoint(C_SHAPE, centroid)).toBe(false);
  });

  it('falls back to the vertex average for degenerate (zero-area) input', () => {
    // Collinear points have zero signed area, so the standard area-weighted centroid
    // formula divides by zero. A simple average keeps this from producing NaN.
    const collinear: Polygon = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ];
    const centroid = polygonCentroid(collinear);
    expect(Number.isFinite(centroid.x)).toBe(true);
    expect(Number.isFinite(centroid.y)).toBe(true);
    expect(centroid).toEqual({ x: 2, y: 0 });
  });

  it('handles a single point', () => {
    expect(polygonCentroid([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });

  it('handles an empty polygon without throwing', () => {
    expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe('containsPoint', () => {
  it('is true for a point well inside a square', () => {
    expect(containsPoint(SQUARE, { x: 5, y: 5 })).toBe(true);
  });

  it('is false for a point well outside', () => {
    expect(containsPoint(SQUARE, { x: 50, y: 50 })).toBe(false);
  });

  it('is true for points inside the arms of a concave shape, false in the notch', () => {
    expect(containsPoint(C_SHAPE, { x: 2, y: 5 })).toBe(true);
    expect(containsPoint(C_SHAPE, { x: 8, y: 5 })).toBe(false);
  });

  it('handles a point exactly on a vertex without throwing', () => {
    expect(() => containsPoint(SQUARE, { x: 0, y: 0 })).not.toThrow();
  });

  it('handles a point exactly on an edge without throwing', () => {
    expect(() => containsPoint(SQUARE, { x: 5, y: 0 })).not.toThrow();
  });

  it('is false for every point when the polygon is degenerate', () => {
    expect(containsPoint([], { x: 0, y: 0 })).toBe(false);
    expect(containsPoint([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBe(false);
  });
});

describe('poleOfInaccessibility', () => {
  it('returns a point inside the polygon for a square', () => {
    const pole = poleOfInaccessibility(SQUARE);
    expect(containsPoint(SQUARE, pole)).toBe(true);
  });

  it('returns a point inside the polygon for a concave C-shape, unlike the centroid', () => {
    const pole = poleOfInaccessibility(C_SHAPE);
    expect(containsPoint(C_SHAPE, pole)).toBe(true);
  });

  it('is reasonably central for a square (within 20% of true centre)', () => {
    const pole = poleOfInaccessibility(SQUARE);
    expect(Math.abs(pole.x - 5)).toBeLessThan(2);
    expect(Math.abs(pole.y - 5)).toBeLessThan(2);
  });

  it('does not throw on a degenerate single-point polygon', () => {
    expect(() => poleOfInaccessibility([{ x: 3, y: 4 }])).not.toThrow();
  });

  it('handles a polygon whose points all coincide (zero width and height)', () => {
    const collapsed: Polygon = [
      { x: 4, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 4 },
    ];
    expect(poleOfInaccessibility(collapsed)).toEqual({ x: 4, y: 4 });
  });

  it('handles a polygon with a zero-length edge (two coincident vertices)', () => {
    // Exercises the degenerate branch of distanceToSegment, where a and b are identical
    // and the segment has no direction to project onto.
    const withDuplicateVertex: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const pole = poleOfInaccessibility(withDuplicateVertex);
    expect(containsPoint(withDuplicateVertex, pole)).toBe(true);
  });
});
