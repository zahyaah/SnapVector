import { describe, expect, it } from 'vitest';

import type { Point, Polygon } from '../geometry/loop.js';
import { evaluateCubic, fitPolygon, type CubicBezier } from './bezier.js';
import { buildPathData } from './path.js';

function circlePolygon(count: number, radius: number, cx: number, cy: number): Polygon {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

/** Samples every cubic in a subpath into a dense polyline — used only to independently
 * re-verify the geometry actually encoded in a `d` string's curves, without trusting
 * whatever the implementation itself might assume about its own output. */
function sampleSubpath(curves: readonly CubicBezier[], samplesPerCurve = 24): Point[] {
  const points: Point[] = [];
  for (const curve of curves) {
    for (let i = 0; i < samplesPerCurve; i++)
      points.push(evaluateCubic(curve, i / samplesPerCurve));
  }
  return points;
}

/** A real fill-rule:evenodd test: count ray crossings across EVERY subpath's edges
 * jointly (not per-subpath containment), exactly as evenodd fill is defined — a point
 * is inside if the combined crossing count is odd, regardless of which subpath or
 * winding direction each crossing belongs to. */
function evenOddContains(subpaths: readonly (readonly CubicBezier[])[], point: Point): boolean {
  let crossings = 0;
  for (const curves of subpaths) {
    const polyline = sampleSubpath(curves);
    for (let i = 0; i < polyline.length; i++) {
      const a = polyline[i]!;
      const b = polyline[(i + 1) % polyline.length]!;
      if (a.y > point.y !== b.y > point.y) {
        const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (crossX > point.x) crossings++;
      }
    }
  }
  return crossings % 2 === 1;
}

describe('buildPathData — valid d strings with M/C/Z', () => {
  it('emits a single well-formed subpath for one contour', () => {
    const square: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const curves = fitPolygon(square, 0.1);
    const d = buildPathData([curves]);

    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // Structurally: one M, one or more C commands, one Z — no other command letters.
    expect(d).toMatch(/^M[\d.,-]+(C[\d.,\s-]+)+Z$/);
  });

  it('emits one M...Z subpath per contour, in order', () => {
    const outer = circlePolygon(60, 50, 0, 0);
    const inner = circlePolygon(30, 20, 0, 0);
    const outerCurves = fitPolygon(outer, 0.5);
    const innerCurves = fitPolygon(inner, 0.5);

    const d = buildPathData([outerCurves, innerCurves]);
    const subpathCount = (d.match(/M/g) ?? []).length;
    const closeCount = (d.match(/Z/g) ?? []).length;
    expect(subpathCount).toBe(2);
    expect(closeCount).toBe(2);
  });

  it('returns an empty string for no contours at all', () => {
    expect(buildPathData([])).toBe('');
  });

  it('skips a contour with no fitted curves rather than emitting a broken M with nothing after it', () => {
    const square: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const curves = fitPolygon(square, 0.1);
    const d = buildPathData([[], curves]);
    expect((d.match(/M/g) ?? []).length).toBe(1);
  });
});

describe('buildPathData — coordinates are rounded to a fixed precision', () => {
  it('rounds to the requested precision and strips unnecessary trailing zeros', () => {
    const curves: CubicBezier[] = [
      {
        p0: { x: 0.123456, y: 0 },
        p1: { x: 1, y: 1.000001 },
        p2: { x: 2.5, y: 2 },
        p3: { x: 3, y: 0 },
      },
    ];
    const d = buildPathData([curves], 2);
    expect(d).toContain('0.12'); // rounded from 0.123456
    expect(d).not.toMatch(/0\.120+\b/); // no trailing zero padding
    expect(d).toContain('1,1'); // 1.000001 rounds to 1, printed as a bare integer
  });

  it('never emits negative zero', () => {
    const curves: CubicBezier[] = [
      {
        p0: { x: -0.0001, y: 0 },
        p1: { x: 1, y: 0 },
        p2: { x: 2, y: 0 },
        p3: { x: 3, y: 0 },
      },
    ];
    const d = buildPathData([curves], 2);
    expect(d).not.toContain('-0,');
    expect(d).not.toContain(',-0');
  });

  it('produces more compact output at lower precision', () => {
    const outer = circlePolygon(80, 73.456789, 0, 0);
    const curves = fitPolygon(outer, 0.5);
    const precise = buildPathData([curves], 4);
    const compact = buildPathData([curves], 1);
    expect(compact.length).toBeLessThan(precise.length);
  });
});

describe('buildPathData — donut renders correctly under fill-rule:evenodd', () => {
  it('a point in the ring is inside (odd crossings); a point in the hole is outside (even crossings)', () => {
    const outer = circlePolygon(100, 60, 0, 0);
    const inner = circlePolygon(60, 25, 0, 0);
    const outerCurves = fitPolygon(outer, 0.5);
    const innerCurves = fitPolygon(inner, 0.5);

    const d = buildPathData([outerCurves, innerCurves]);
    expect((d.match(/M/g) ?? []).length).toBe(2);

    // In the ring: between the inner (r=25) and outer (r=60) radius.
    expect(evenOddContains([outerCurves, innerCurves], { x: 40, y: 0 })).toBe(true);
    // In the hole: inside both boundaries, so the ray crosses both — even, excluded.
    expect(evenOddContains([outerCurves, innerCurves], { x: 0, y: 0 })).toBe(false);
    // Outside everything: crosses neither.
    expect(evenOddContains([outerCurves, innerCurves], { x: 200, y: 200 })).toBe(false);
  });

  it('does not depend on the two subpaths having opposite winding to render correctly', () => {
    // fill-rule:evenodd famously does not care about winding direction, unlike
    // nonzero — verify the same evenodd containment holds even if we deliberately
    // reverse one subpath's point order (flipping its winding).
    const outer = circlePolygon(100, 60, 0, 0);
    const inner = circlePolygon(60, 25, 0, 0);
    const outerCurves = fitPolygon(outer, 0.5);
    const innerCurves = fitPolygon([...inner].reverse(), 0.5);

    expect(evenOddContains([outerCurves, innerCurves], { x: 40, y: 0 })).toBe(true);
    expect(evenOddContains([outerCurves, innerCurves], { x: 0, y: 0 })).toBe(false);
  });
});
