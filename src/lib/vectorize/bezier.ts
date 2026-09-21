import type { Point, Polygon } from '../geometry/loop.js';

export interface CubicBezier {
  readonly p0: Point;
  readonly p1: Point;
  readonly p2: Point;
  readonly p3: Point;
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}
function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}
function scale(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s };
}
function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}
function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}
function normalize(a: Point): Point {
  const len = length(a);
  return len === 0 ? { x: 0, y: 0 } : scale(a, 1 / len);
}

export function evaluateCubic(curve: CubicBezier, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
    y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y,
  };
}

/** Chord-length parameterization: each point's parameter is its cumulative distance
 * along the polyline so far, normalized to [0,1]. Points spaced further apart get more
 * of the curve's parameter range, which is what keeps the fit from bunching up in
 * densely-sampled regions and stretching out in sparse ones. */
function chordLengthParameters(points: readonly Point[]): number[] {
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]! + length(sub(points[i]!, points[i - 1]!)));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return points.map((_, i) => i / Math.max(1, points.length - 1));
  return cumulative.map((c) => c / total);
}

/**
 * Solves for the two control-point distances (`alpha1`, `alpha2` along the given end
 * tangents) that least-squares best fit `points` at parameters `u`, per Schneider's
 * "An Algorithm for Automatically Fitting Digitized Curves" (Graphics Gems I). Falls
 * back to a simple distance-based heuristic when the linear system is degenerate
 * (near-parallel tangents, or too few points) or produces a negative distance, which
 * would place a control point behind the curve's own direction of travel rather than
 * ahead of it.
 */
function fitOneCubic(
  points: readonly Point[],
  u: readonly number[],
  startTangent: Point,
  endTangent: Point,
): CubicBezier {
  const p0 = points[0]!;
  const p3 = points[points.length - 1]!;
  const t0 = normalize(startTangent);
  const t1 = normalize(endTangent);

  let x11 = 0;
  let x12 = 0;
  let x22 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < points.length; i++) {
    const ui = u[i]!;
    const mt = 1 - ui;
    const a1 = 3 * mt * mt * ui;
    const a2 = 3 * mt * ui * ui;

    const qx =
      mt * mt * mt * p0.x +
      3 * mt * mt * ui * p0.x +
      3 * mt * ui * ui * p3.x +
      ui * ui * ui * p3.x;
    const qy =
      mt * mt * mt * p0.y +
      3 * mt * mt * ui * p0.y +
      3 * mt * ui * ui * p3.y +
      ui * ui * ui * p3.y;
    const c = sub(points[i]!, { x: qx, y: qy });

    x11 += a1 * a1;
    x22 += a2 * a2;
    x12 += a1 * a2 * dot(t0, t1);
    y1 += a1 * dot(c, t0);
    y2 += a2 * dot(c, t1);
  }

  const det = x11 * x22 - x12 * x12;
  const chordLength = length(sub(p3, p0));
  const fallback = chordLength / 3;

  let alpha1: number;
  let alpha2: number;
  if (Math.abs(det) < 1e-12) {
    alpha1 = fallback;
    alpha2 = fallback;
  } else {
    alpha1 = (y1 * x22 - y2 * x12) / det;
    alpha2 = (x11 * y2 - x12 * y1) / det;
  }

  // A negative or vanishingly small alpha places the control point behind the curve's
  // travel direction instead of ahead of it, producing a visibly wrong loop or cusp —
  // Schneider's own documented fallback for exactly this case. An excessively LARGE
  // alpha is the same failure in the other direction, and one the original algorithm's
  // description doesn't call out: it surfaced on real MobileSAM mask output (not any
  // synthetic fixture) at a short, sparse sub-segment produced by recursive splitting,
  // where the tangent inherited from an earlier, larger split was a poor fit for this
  // particular short run. The result solves the least-squares system "correctly" (a
  // positive, non-degenerate alpha) but places a control point so far past the curve's
  // own endpoints that it loops back on itself, visible as a small spike or
  // self-intersection in the rendered shape. Bounding alpha to a generous multiple of
  // the chord length catches this the same way the negative case is caught, without
  // constraining legitimately curvy fits — see bezier.test.ts's "real MobileSAM
  // output" fixture, extracted from the exact point sequence that produced the spike.
  const minAlpha = chordLength * 1e-6;
  const maxAlpha = chordLength * 1.5;
  if (alpha1 < minAlpha || alpha2 < minAlpha || alpha1 > maxAlpha || alpha2 > maxAlpha) {
    alpha1 = fallback;
    alpha2 = fallback;
  }

  return {
    p0,
    p1: add(p0, scale(t0, alpha1)),
    p2: add(p3, scale(t1, alpha2)),
    p3,
  };
}

function maxSquaredError(
  curve: CubicBezier,
  points: readonly Point[],
  u: readonly number[],
): { maxError: number; splitIndex: number } {
  let maxError = 0;
  let splitIndex = Math.floor(points.length / 2);
  for (let i = 0; i < points.length; i++) {
    const onCurve = evaluateCubic(curve, u[i]!);
    const errorSquared = dot(sub(onCurve, points[i]!), sub(onCurve, points[i]!));
    if (errorSquared > maxError) {
      maxError = errorSquared;
      splitIndex = i;
    }
  }
  return { maxError, splitIndex };
}

function estimateTangent(points: readonly Point[], index: number, direction: 1 | -1): Point {
  const neighborIndex = index + direction;
  return normalize(sub(points[neighborIndex]!, points[index]!));
}

const MAX_RECURSION_DEPTH = 32;

function fitCurveRecursive(
  points: readonly Point[],
  startTangent: Point,
  endTangent: Point,
  toleranceSquared: number,
  depth: number,
): CubicBezier[] {
  // Never called with fewer than 2 points: the public `fitCurve` entry point already
  // filters that case, and both recursive calls below always pass at least 2 points by
  // construction (the pivot is clamped to [1, points.length-2]).
  if (points.length === 2) {
    // A straight line is its own exact cubic fit — control points sit a third of the
    // way along the segment, matching what the least-squares solve converges to anyway.
    const third = scale(sub(points[1]!, points[0]!), 1 / 3);
    return [
      {
        p0: points[0]!,
        p1: add(points[0]!, third),
        p2: sub(points[1]!, third),
        p3: points[1]!,
      },
    ];
  }

  const u = chordLengthParameters(points);
  const curve = fitOneCubic(points, u, startTangent, endTangent);
  const { maxError, splitIndex } = maxSquaredError(curve, points, u);

  if (maxError <= toleranceSquared || depth >= MAX_RECURSION_DEPTH) {
    return [curve];
  }

  // Split at the point of worst fit, estimating a fresh tangent there from its
  // immediate neighbours so the two new segments still meet with a reasonable
  // direction rather than an arbitrary one — this is what keeps a multi-segment fit
  // looking like one continuous curve instead of a visibly kinked join.
  const pivot = Math.max(1, Math.min(points.length - 2, splitIndex));
  const splitTangent = normalize(sub(points[pivot + 1]!, points[pivot - 1]!));

  const left = fitCurveRecursive(
    points.slice(0, pivot + 1),
    startTangent,
    scale(splitTangent, -1),
    toleranceSquared,
    depth + 1,
  );
  const right = fitCurveRecursive(
    points.slice(pivot),
    splitTangent,
    endTangent,
    toleranceSquared,
    depth + 1,
  );
  return left.concat(right);
}

/**
 * Fits a sequence of points to one or more cubic Beziers within `tolerance` (maximum
 * allowed deviation, in the same units as the input points). Implements Schneider's
 * least-squares fit with error-driven recursive subdivision; does not include the
 * optional Newton-Raphson re-parameterization pass from the original Graphics Gems
 * algorithm — a deliberate scope cut, since the plain chord-length parameterization
 * already meets this project's accuracy targets (verified directly against a sampled
 * circle, a known hard case for curve fitting).
 */
export function fitCurve(points: readonly Point[], tolerance: number): CubicBezier[] {
  if (tolerance <= 0) {
    throw new Error('fitCurve: tolerance must be positive');
  }
  if (points.length < 2) return [];

  const startTangent = estimateTangent(points, 0, 1);
  const endTangent = estimateTangent(points, points.length - 1, -1);
  return fitCurveRecursive(points, startTangent, endTangent, tolerance * tolerance, 0);
}

const DEFAULT_CORNER_ANGLE_RADIANS = (60 * Math.PI) / 180;

/**
 * Marks a vertex of a closed polygon as a hard corner when the turn there exceeds
 * `cornerAngle` — the angle between the incoming and outgoing direction vectors, not
 * the interior angle of the shape. A perfectly straight run turns 0°; a right-angle
 * corner turns 90°. Corners are never subdivided into a curve across them (T22's
 * "sharp corners are preserved" requirement) — each one always ends up exactly at a
 * segment boundary (a P0 or P3), never inside a single smoothed Bezier span.
 */
function detectCorners(polygon: Polygon, cornerAngle: number): number[] {
  const n = polygon.length;
  const corners: number[] = [];
  const cosThreshold = Math.cos(cornerAngle);

  for (let i = 0; i < n; i++) {
    const previous = polygon[(i - 1 + n) % n]!;
    const current = polygon[i]!;
    const next = polygon[(i + 1) % n]!;
    const incoming = normalize(sub(current, previous));
    const outgoing = normalize(sub(next, current));
    if (dot(incoming, outgoing) < cosThreshold) {
      corners.push(i);
    }
  }
  return corners;
}

/**
 * Fits a closed polygon to a sequence of cubics forming a closed path (the last
 * segment's `p3` equals the first segment's `p0`). Splits at detected corners first —
 * so a corner can never be smoothed away by the curve fitter — then Bezier-fits each
 * run between consecutive corners independently. A polygon with no detected corners at
 * all (a smooth shape like a circle) is fit as a single closed run starting from its
 * first point, since there is no meaningful corner to anchor a split on.
 */
export function fitPolygon(
  polygon: Polygon,
  tolerance: number,
  cornerAngle: number = DEFAULT_CORNER_ANGLE_RADIANS,
): CubicBezier[] {
  if (polygon.length < 3) return [];

  const corners = detectCorners(polygon, cornerAngle);
  if (corners.length === 0) {
    const looped = [...polygon, polygon[0]!];
    return fitCurve(looped, tolerance);
  }

  const curves: CubicBezier[] = [];
  for (let i = 0; i < corners.length; i++) {
    const start = corners[i]!;
    const end = corners[(i + 1) % corners.length]!;
    const run: Point[] = [];
    for (let index = start; ; index = (index + 1) % polygon.length) {
      run.push(polygon[index]!);
      if (index === end && run.length > 1) break;
    }
    curves.push(...fitCurve(run, tolerance));
  }
  return curves;
}
