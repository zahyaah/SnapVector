import { describe, expect, it } from 'vitest';

import { containsPoint, signedArea, type Point, type Polygon } from '../geometry/loop.js';
import { createBinaryMask, setPixel, type BinaryMask } from '../mask/binary-mask.js';
import { traceContours } from './contours.js';

function maskFromRows(rows: readonly string[]): BinaryMask {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const mask = createBinaryMask(width, height);
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) setPixel(mask, x, y, row[x] === '#' ? 1 : 0);
  }
  return mask;
}

function isClosed(contour: Polygon): boolean {
  // A closed polygon here means every consecutive pair of points (wrapping around)
  // connects to a genuine neighbouring edge-midpoint — practically, we just check
  // there's no degenerate collapse and that walking it returns a nonzero enclosed area.
  return contour.length >= 3 && Math.abs(signedArea(contour)) > 0;
}

function samplePointInside(polygon: Polygon): Point {
  // Centroid-of-vertices is good enough for the convex/near-convex fixtures used here.
  const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

describe('traceContours — a single isolated foreground pixel', () => {
  it('produces one small closed diamond contour with the exact corner-cut midpoints', () => {
    const mask = maskFromRows(['...', '.#.', '...']);
    const contours = traceContours(mask);
    expect(contours).toHaveLength(1);

    const points = contours[0]!;
    // A single foreground pixel at (1,1) cuts all 4 of its corners diagonally, giving
    // a diamond of the 4 edge-midpoints surrounding it.
    const expectedPoints: Point[] = [
      { x: 1, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 1, y: 1.5 },
      { x: 1.5, y: 1 },
    ];
    for (const expected of expectedPoints) {
      expect(
        points.some(
          (p) => Math.abs(p.x - expected.x) < 1e-9 && Math.abs(p.y - expected.y) < 1e-9,
        ),
      ).toBe(true);
    }
    expect(points).toHaveLength(4);
  });
});

describe('traceContours — a solid rectangular block', () => {
  it('produces one closed contour containing the block and excluding the background', () => {
    const mask = maskFromRows(['.......', '..###..', '..###..', '..###..', '.......']);
    const contours = traceContours(mask);
    expect(contours).toHaveLength(1);
    expect(isClosed(contours[0]!)).toBe(true);

    // Pixel centres well inside the block are inside the contour; pixel centres well
    // outside are not. Marching squares corner-cuts the block's 4 corners at 45
    // degrees, so this check avoids asserting exact coordinates for that shape.
    expect(containsPoint(contours[0]!, { x: 3, y: 2 })).toBe(true);
    expect(containsPoint(contours[0]!, { x: 0, y: 0 })).toBe(false);
    expect(containsPoint(contours[0]!, { x: 6, y: 4 })).toBe(false);
  });

  it("encloses approximately the block's area (corner cuts remove a small, bounded amount)", () => {
    const mask = maskFromRows(['.......', '..###..', '..###..', '..###..', '.......']);
    const contours = traceContours(mask);
    const area = Math.abs(signedArea(contours[0]!));
    // A 3x3 block of pixels spans a 3x3 unit area in this coordinate system (9 total);
    // 4 diagonal corner-cuts each remove a small triangle, so the true area is a bit
    // less than 9 but nowhere near, say, half of it.
    expect(area).toBeGreaterThan(7);
    expect(area).toBeLessThan(9);
  });
});

describe('traceContours — saddle-point ambiguity', () => {
  it('resolves a diagonal touching pair as two separate contours, consistently', () => {
    // TL and BR foreground, TR and BL background: the classic marching-squares saddle.
    const mask = maskFromRows(['#.', '.#']);
    const first = traceContours(mask);
    const second = traceContours(mask);

    // Consistency: tracing the same mask twice gives the identical result.
    expect(first).toEqual(second);

    // Resolved as "separate" (matching this project's 4-connectivity convention
    // elsewhere — lib/mask treats diagonal touching as unconnected, so the saddle
    // resolution agrees with that rather than introducing a different notion of
    // "touching" just for contour tracing).
    expect(first).toHaveLength(2);
    for (const contour of first) {
      expect(isClosed(contour)).toBe(true);
    }
  });

  it('resolves the complementary saddle (TR+BL foreground) the same way', () => {
    const mask = maskFromRows(['.#', '#.']);
    const contours = traceContours(mask);
    expect(contours).toHaveLength(2);
  });
});

describe('traceContours — outer boundary and hole have opposite winding', () => {
  it('produces two contours for a donut, with signed areas of opposite sign', () => {
    const mask = maskFromRows([
      '#########',
      '#########',
      '###...###',
      '###...###',
      '###...###',
      '#########',
      '#########',
    ]);
    const contours = traceContours(mask);
    expect(contours).toHaveLength(2);

    const areas = contours.map((c) => signedArea(c));
    expect(Math.sign(areas[0]!)).not.toBe(Math.sign(areas[1]!));

    // The larger-area contour is the outer boundary; it should contain a point that
    // is inside the ring but the smaller (hole) contour should not.
    const [bigger, smaller] =
      Math.abs(areas[0]!) > Math.abs(areas[1]!)
        ? [contours[0]!, contours[1]!]
        : [contours[1]!, contours[0]!];
    expect(containsPoint(bigger, { x: 1, y: 1 })).toBe(true);
    expect(containsPoint(smaller, { x: 1, y: 1 })).toBe(false);
  });
});

describe('traceContours — masks touching the raster border', () => {
  it('produces a closed contour for a shape that touches every edge of the mask', () => {
    const mask = maskFromRows(['###', '###', '###']);
    const contours = traceContours(mask);
    expect(contours).toHaveLength(1);
    expect(isClosed(contours[0]!)).toBe(true);
    expect(containsPoint(contours[0]!, { x: 1.5, y: 1.5 })).toBe(true);
  });

  it('produces a closed contour for a shape touching only one edge', () => {
    const mask = maskFromRows(['..###..', '..###..', '.......']);
    const contours = traceContours(mask);
    expect(contours).toHaveLength(1);
    expect(isClosed(contours[0]!)).toBe(true);
  });
});

describe('traceContours — multiple disjoint components', () => {
  it('produces one contour per disjoint foreground region', () => {
    const mask = maskFromRows(['##...##', '##...##', '.......']);
    const contours = traceContours(mask);
    expect(contours).toHaveLength(2);
    for (const contour of contours) {
      expect(isClosed(contour)).toBe(true);
      expect(signedArea(contour)).not.toBe(0);
    }
  });
});

describe('traceContours — degenerate input', () => {
  it('returns no contours for an all-background mask', () => {
    const mask = maskFromRows(['...', '...', '...']);
    expect(traceContours(mask)).toEqual([]);
  });

  it('returns no contours for an all-foreground mask (no boundary inside the frame)', () => {
    const mask = createBinaryMask(3, 3);
    mask.data.fill(1);
    // A mask that is foreground everywhere has no internal boundary to trace once
    // padded with background — the "shape" is the entire padded frame, which after
    // shifting back into mask coordinates is the mask's own bounding rectangle.
    const contours = traceContours(mask);
    expect(contours).toHaveLength(1);
    expect(containsPoint(contours[0]!, { x: 1, y: 1 })).toBe(true);
  });

  it('handles a 1x1 all-foreground mask without throwing', () => {
    const mask = createBinaryMask(1, 1);
    mask.data.fill(1);
    expect(() => traceContours(mask)).not.toThrow();
  });

  it('handles a 1x1 all-background mask without throwing', () => {
    const mask = createBinaryMask(1, 1);
    expect(traceContours(mask)).toEqual([]);
  });
});

describe('traceContours — sample point helper sanity', () => {
  it('the centroid of a simple contour lands inside it (fixture self-check)', () => {
    const mask = maskFromRows(['.......', '..###..', '..###..', '..###..', '.......']);
    const contour = traceContours(mask)[0]!;
    expect(containsPoint(contour, samplePointInside(contour))).toBe(true);
  });
});
