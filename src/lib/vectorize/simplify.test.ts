import { describe, expect, it } from 'vitest';

import { signedArea, type Point, type Polygon } from '../geometry/loop.js';
import { simplifyPolygon } from './simplify.js';

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function hasSelfIntersection(polygon: Polygon): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i]!;
    const a2 = polygon[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges share an endpoint by construction — not a self-intersection.
      if (j === i || (j + 1) % n === i) continue;
      const b1 = polygon[j]!;
      const b2 = polygon[(j + 1) % n]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// A near-circular polygon with many nearly-collinear points, similar in character to a
// real marching-squares contour (T20's real-mask test traced 1124 points on a circle).
function noisyCircle(pointCount: number, radius: number, noiseAmplitude: number): Polygon {
  let state = 42;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Array.from({ length: pointCount }, (_, i) => {
    const angle = (i / pointCount) * Math.PI * 2;
    const r = radius + (next() - 0.5) * noiseAmplitude;
    return { x: 100 + Math.cos(angle) * r, y: 100 + Math.sin(angle) * r };
  });
}

describe('simplifyPolygon — tolerance 0 is lossless', () => {
  it('keeps every point of a polygon with no collinear runs', () => {
    const pentagon: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 15, y: 10 },
      { x: 7, y: 15 },
      { x: -3, y: 8 },
    ];
    const simplified = simplifyPolygon(pentagon, 0);
    expect(simplified).toEqual(pentagon);
  });

  it('removes an exactly-collinear point without changing the enclosed area', () => {
    // (5,0) sits exactly on the line between (0,0) and (10,0) — genuinely redundant.
    const withCollinearPoint: Polygon = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const simplified = simplifyPolygon(withCollinearPoint, 0);
    expect(simplified.length).toBe(4);
    expect(Math.abs(signedArea(simplified))).toBeCloseTo(
      Math.abs(signedArea(withCollinearPoint)),
      9,
    );
  });

  it("preserves the polygon's area exactly at tolerance 0 even with several collinear runs", () => {
    const staircase: Polygon = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 }, // collinear with neighbours
      { x: 4, y: 2 },
      { x: 4, y: 4 }, // collinear
      { x: 0, y: 4 },
      { x: 0, y: 2 }, // collinear
    ];
    const simplified = simplifyPolygon(staircase, 0);
    expect(Math.abs(signedArea(simplified))).toBeCloseTo(Math.abs(signedArea(staircase)), 9);
  });
});

describe('simplifyPolygon — larger tolerance monotonically reduces point count', () => {
  it('never increases the point count as tolerance increases', () => {
    const polygon = noisyCircle(200, 50, 3);
    const tolerances = [0, 0.5, 1, 2, 4, 8, 16];
    const counts = tolerances.map((t) => simplifyPolygon(polygon, t).length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]!);
    }
    // And it should actually simplify something meaningful across that range, not be a
    // no-op — otherwise this test would pass trivially without proving anything.
    expect(counts[counts.length - 1]).toBeLessThan(counts[0]!);
  });

  it('collapses a nearly-straight run of points to just its endpoints at a generous tolerance', () => {
    const almostStraight: Polygon = [
      { x: 0, y: 0 },
      { x: 2, y: 0.1 },
      { x: 4, y: -0.1 },
      { x: 6, y: 0.05 },
      { x: 8, y: 0 },
      { x: 8, y: 10 },
      { x: 0, y: 10 },
    ];
    const simplified = simplifyPolygon(almostStraight, 1);
    // The 5 noisy bottom points collapse to their 2 endpoints, leaving the shape's 4
    // actual corners: (0,0), (8,0)-ish, (8,10), (0,10).
    expect(simplified.length).toBe(4);
  });
});

describe('simplifyPolygon — closed contours stay closed and simple', () => {
  it('keeps at least a triangle for any non-degenerate input', () => {
    const polygon = noisyCircle(50, 20, 10);
    const simplified = simplifyPolygon(polygon, 1000); // extreme tolerance
    expect(simplified.length).toBeGreaterThanOrEqual(3);
  });

  it('introduces no self-intersection at a practical tolerance on a noisy near-circle', () => {
    const polygon = noisyCircle(300, 80, 4);
    const simplified = simplifyPolygon(polygon, 2);
    expect(hasSelfIntersection(simplified)).toBe(false);
  });

  it('introduces no self-intersection when simplifying a real marching-squares-style block', () => {
    // Mirrors the corner-cut octagon shape traceContours produces for a solid
    // rectangular block (T20).
    const octagon: Polygon = [
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 6, y: 2 },
      { x: 6, y: 4 },
      { x: 4, y: 6 },
      { x: 2, y: 6 },
      { x: 0, y: 4 },
      { x: 0, y: 2 },
    ];
    const simplified = simplifyPolygon(octagon, 0.1);
    expect(hasSelfIntersection(simplified)).toBe(false);
  });

  it('leaves the exact winding sign unchanged (does not flip inside-out)', () => {
    const polygon = noisyCircle(150, 40, 3);
    const originalSign = Math.sign(signedArea(polygon));
    const simplified = simplifyPolygon(polygon, 3);
    expect(Math.sign(signedArea(simplified))).toBe(originalSign);
  });
});

describe('simplifyPolygon — degenerate input', () => {
  it('returns a 2-point input unchanged rather than crashing', () => {
    const line: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(() => simplifyPolygon(line, 1)).not.toThrow();
    expect(simplifyPolygon(line, 1)).toEqual(line);
  });

  it('returns an empty or single-point input unchanged rather than crashing', () => {
    expect(simplifyPolygon([], 1)).toEqual([]);
    expect(simplifyPolygon([{ x: 5, y: 5 }], 1)).toEqual([{ x: 5, y: 5 }]);
  });

  it('handles a triangle without removing any of its 3 points', () => {
    const triangle: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(simplifyPolygon(triangle, 100)).toEqual(triangle);
  });

  it('handles a polygon where every point is identical without throwing', () => {
    const collapsed: Polygon = Array.from({ length: 5 }, () => ({ x: 3, y: 3 }));
    expect(() => simplifyPolygon(collapsed, 1)).not.toThrow();
  });

  it('rejects a negative tolerance rather than silently misbehaving', () => {
    expect(() => simplifyPolygon(noisyCircle(10, 5, 1), -1)).toThrow();
  });
});
