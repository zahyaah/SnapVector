import { describe, expect, it } from 'vitest';

import type { Point, Polygon } from '../geometry/loop.js';
import { evaluateCubic, fitCurve, fitPolygon, type CubicBezier } from './bezier.js';

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Coarse-then-refined search for the closest point on a cubic to `target` — used only
 * in tests, to verify the fitted curve's actual max deviation independently of however
 * the implementation itself estimates error internally. A purely uniform sample grid
 * isn't enough on its own: with `samples` steps over a curve of arc length L, adjacent
 * samples sit up to L/samples apart, so a point that lies exactly ON the curve can still
 * measure up to half that as "distance to the nearest sample" — a discretization
 * artifact, not a real fitting error. Ternary-search refinement around the best coarse
 * sample removes that artifact regardless of how tight a tolerance a test checks. */
function distanceToCurve(curve: CubicBezier, target: Point): number {
  const samples = 200;
  let bestT = 0;
  let bestDistance = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const d = distance(evaluateCubic(curve, t), target);
    if (d < bestDistance) {
      bestDistance = d;
      bestT = t;
    }
  }

  let lo = Math.max(0, bestT - 1 / samples);
  let hi = Math.min(1, bestT + 1 / samples);
  for (let iteration = 0; iteration < 40; iteration++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = distance(evaluateCubic(curve, m1), target);
    const d2 = distance(evaluateCubic(curve, m2), target);
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  return Math.min(bestDistance, distance(evaluateCubic(curve, (lo + hi) / 2), target));
}

function maxDeviation(curves: readonly CubicBezier[], points: readonly Point[]): number {
  // Assumes `curves` are in order and jointly cover `points` — used for whole-path
  // fixtures where checking against the nearest of any segment is what "deviation from
  // the input" means in practice.
  let max = 0;
  for (const point of points) {
    const nearest = Math.min(...curves.map((c) => distanceToCurve(c, point)));
    max = Math.max(max, nearest);
  }
  return max;
}

function circlePoints(count: number, radius: number, cx = 0, cy = 0): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

describe('evaluateCubic', () => {
  it('returns p0 at t=0 and p3 at t=1', () => {
    const curve: CubicBezier = {
      p0: { x: 0, y: 0 },
      p1: { x: 1, y: 5 },
      p2: { x: 4, y: 5 },
      p3: { x: 5, y: 0 },
    };
    expect(evaluateCubic(curve, 0)).toEqual(curve.p0);
    expect(evaluateCubic(curve, 1)).toEqual(curve.p3);
  });
});

describe('fitCurve — max deviation stays within tolerance', () => {
  it('fits a perfectly straight line with near-zero error, as a single segment', () => {
    const points: Point[] = Array.from({ length: 10 }, (_, i) => ({ x: i * 2, y: i * 2 }));
    const curves = fitCurve(points, 0.01);
    expect(curves).toHaveLength(1);
    expect(maxDeviation(curves, points)).toBeLessThan(0.01);
  });

  it('keeps every point within a tight tolerance on a high-curvature synthetic path', () => {
    // A sharp S-curve — high curvature relative to its scale, likely to need several
    // segments at a tight tolerance.
    const points: Point[] = Array.from({ length: 60 }, (_, i) => {
      const t = i / 59;
      return { x: t * 100, y: 40 * Math.sin(t * Math.PI * 3) };
    });
    const tolerance = 0.5;
    const curves = fitCurve(points, tolerance);
    expect(maxDeviation(curves, points)).toBeLessThanOrEqual(tolerance * 1.05); // small numeric slack
  });

  it('produces more segments for a tighter tolerance on the same input', () => {
    const points: Point[] = Array.from({ length: 60 }, (_, i) => {
      const t = i / 59;
      return { x: t * 100, y: 40 * Math.sin(t * Math.PI * 3) };
    });
    const loose = fitCurve(points, 5);
    const tight = fitCurve(points, 0.2);
    expect(tight.length).toBeGreaterThanOrEqual(loose.length);
  });
});

describe('fitCurve — a sampled circle fits within a tight error bound using few segments', () => {
  it('fits a 200-point circle to a small number of cubics, each within tolerance', () => {
    const radius = 100;
    const points = circlePoints(200, radius);
    const tolerance = 0.5; // 0.5% of the radius
    const curves = fitCurve([...points, points[0]!], tolerance);

    // The classic result for cubic circle approximation is 4 segments; a general
    // least-squares fitter without that special-cased knowledge should land in the
    // same ballpark, not explode into dozens of tiny segments.
    expect(curves.length).toBeGreaterThanOrEqual(4);
    expect(curves.length).toBeLessThanOrEqual(12);
    expect(maxDeviation(curves, points)).toBeLessThanOrEqual(tolerance * 1.1);
  });
});

describe('fitPolygon — sharp corners are preserved, not rounded away', () => {
  it('places a segment boundary exactly at each corner of a square, never smoothing through one', () => {
    const square: Polygon = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    // Densify each edge so the fitter has enough points per side to work with — a bare
    // 4-point square has no interior points to detect a "corner" against.
    const densified: Point[] = [];
    for (let i = 0; i < square.length; i++) {
      const a = square[i]!;
      const b = square[(i + 1) % square.length]!;
      for (let s = 0; s < 10; s++) {
        densified.push({ x: a.x + ((b.x - a.x) * s) / 10, y: a.y + ((b.y - a.y) * s) / 10 });
      }
    }

    const curves = fitPolygon(densified, 0.1);
    for (const corner of square) {
      const atBoundary = curves.some(
        (c) => distance(c.p0, corner) < 1e-6 || distance(c.p3, corner) < 1e-6,
      );
      expect(atBoundary).toBe(true);
    }
  });

  it('keeps the fitted path closed: the last segment ends where the first begins', () => {
    const square: Polygon = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const densified: Point[] = [];
    for (let i = 0; i < square.length; i++) {
      const a = square[i]!;
      const b = square[(i + 1) % square.length]!;
      for (let s = 0; s < 10; s++) {
        densified.push({ x: a.x + ((b.x - a.x) * s) / 10, y: a.y + ((b.y - a.y) * s) / 10 });
      }
    }
    const curves = fitPolygon(densified, 0.1);
    const first = curves[0]!;
    const last = curves[curves.length - 1]!;
    expect(distance(last.p3, first.p0)).toBeLessThan(1e-6);
  });

  it('returns no segments for a degenerate 0-2 point "polygon"', () => {
    expect(fitPolygon([], 1)).toEqual([]);
    expect(fitPolygon([{ x: 0, y: 0 }], 1)).toEqual([]);
    expect(
      fitPolygon(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        1,
      ),
    ).toEqual([]);
  });

  it('does not introduce a spurious corner-split on a smooth circle', () => {
    const points = circlePoints(200, 50);
    const curves = fitPolygon(points, 0.5);
    // A smooth circle should fit as a handful of segments joined by the fitter's own
    // error-driven splits, not one segment per input point.
    expect(curves.length).toBeLessThan(20);
  });
});

describe('fitCurve — least-squares fallback paths', () => {
  it('falls back to the distance heuristic when the linear system is exactly degenerate', () => {
    // Exactly 3 collinear, evenly-spaced points: only one interior point contributes
    // to the least-squares sums (the endpoints' basis functions vanish at u=0 and
    // u=1), and with a single contributing term the "A1" and "A2" sample vectors are
    // trivially proportional whenever the start/end tangents are parallel or
    // antiparallel — which they are here (both point along the shared line, in
    // opposite directions by the end-tangent convention). That makes the 2x2 system's
    // determinant exactly zero, forcing the heuristic fallback (chord/3 for both
    // control distances) — which also happens to be the exact right answer for a line.
    const collinear: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const curves = fitCurve(collinear, 0.01);
    expect(curves).toHaveLength(1);
    expect(maxDeviation(curves, collinear)).toBeLessThan(0.01);
  });

  it('falls back to the distance heuristic when the least-squares solution goes negative', () => {
    // Found by randomized search rather than hand-derived: a configuration where the
    // unconstrained least-squares solve wants to place a control point BEHIND its own
    // endpoint (opposite the tangent direction), which would produce a visibly wrong
    // loop or cusp. The fallback keeps the curve well-behaved instead.
    const points: Point[] = [
      { x: -1, y: -8 },
      { x: 0, y: -9 },
      { x: -3, y: -6 },
      { x: -2, y: 6 },
    ];
    const curves = fitCurve(points, 50); // loose tolerance — this only checks the fallback fires safely
    expect(curves.length).toBeGreaterThanOrEqual(1);
    for (const curve of curves) {
      // A well-formed fallback keeps control points a bounded, positive distance from
      // their endpoint along the tangent — not collapsed onto the endpoint or thrown
      // out to an extreme distance in the wrong direction.
      expect(distance(curve.p1, curve.p0)).toBeGreaterThan(0);
      expect(distance(curve.p2, curve.p3)).toBeGreaterThan(0);
    }
  });
});

describe('fitCurve — degenerate input', () => {
  it('returns no segments for fewer than 2 points', () => {
    expect(fitCurve([], 1)).toEqual([]);
    expect(fitCurve([{ x: 0, y: 0 }], 1)).toEqual([]);
  });

  it('fits exactly 2 points as a single straight-line cubic', () => {
    const curves = fitCurve(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      0.1,
    );
    expect(curves).toHaveLength(1);
    expect(curves[0]!.p0).toEqual({ x: 0, y: 0 });
    expect(curves[0]!.p3).toEqual({ x: 10, y: 0 });
  });

  it('handles a run of entirely identical points without throwing or looping forever', () => {
    const points: Point[] = Array.from({ length: 5 }, () => ({ x: 3, y: 3 }));
    expect(() => fitCurve(points, 1)).not.toThrow();
  });

  it('rejects a non-positive tolerance rather than looping forever trying to satisfy it', () => {
    expect(() =>
      fitCurve(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
        ],
        0,
      ),
    ).toThrow();
  });
});
