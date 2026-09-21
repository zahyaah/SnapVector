import type { Point } from '../geometry/loop.js';
import type { CubicBezier } from './bezier.js';

const DEFAULT_PRECISION = 2;

/**
 * Rounds to `precision` decimal places and prints the shortest representation of that
 * rounded value — `Number(x.toFixed(p))` collapses e.g. 5.10 to 5.1 and 5.00 to 5,
 * which matters for file size once a shape's worth of coordinates repeats this
 * thousands of times. `-0` is special-cased to `0`; nothing downstream benefits from
 * distinguishing them and an SVG viewer printing "-0" reads as a mistake.
 */
function formatNumber(value: number, precision: number): string {
  const rounded = Number(value.toFixed(precision));
  return rounded === 0 ? '0' : String(rounded);
}

function formatPoint(point: Point, precision: number): string {
  return `${formatNumber(point.x, precision)},${formatNumber(point.y, precision)}`;
}

/** Builds one `M...C...Z` subpath from a single contour's fitted curves. Returns an
 * empty string for a contour with no curves (e.g. a degenerate input that fitPolygon
 * rejected) so the caller can filter it out rather than emit a dangling `M` with
 * nothing to close. */
function buildSubpath(curves: readonly CubicBezier[], precision: number): string {
  if (curves.length === 0) return '';

  const commands = curves.map(
    (curve) =>
      `C${formatPoint(curve.p1, precision)} ${formatPoint(curve.p2, precision)} ${formatPoint(curve.p3, precision)}`,
  );
  return `M${formatPoint(curves[0]!.p0, precision)}${commands.join('')}Z`;
}

/**
 * Assembles one SVG path `d` attribute value from any number of fitted contours — one
 * `M...C...Z` subpath per contour, concatenated. Deliberately does not care whether the
 * contours wind consistently: this project renders with `fill-rule: evenodd`
 * (ADR-0005), which decides fill purely by crossing count, not winding direction — a
 * hole contour subtracts from whatever it's nested inside regardless of which way
 * either one winds.
 */
export function buildPathData(
  contours: readonly (readonly CubicBezier[])[],
  precision: number = DEFAULT_PRECISION,
): string {
  return contours
    .map((curves) => buildSubpath(curves, precision))
    .filter((subpath) => subpath !== '')
    .join(' ');
}
