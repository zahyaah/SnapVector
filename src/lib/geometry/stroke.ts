import type { Point } from './loop.js';

/**
 * Five hues chosen for mutual distinctiveness rather than to match the app's own accent
 * colour, since a pen colour matching the UI accent would blur "the stroke I'm drawing"
 * with "the app's own chrome." Legibility against the source image comes from the halo
 * (SPEC step 2), not from these hues individually — the halo is what has to work over an
 * arbitrary photo; the palette is user preference layered on top of that guarantee.
 */
// Chosen so each hue clears WCAG's 3:1 graphical-object contrast threshold against BOTH
// pure black and pure white, not just against a typical photo — the halo (SPEC step 2)
// only contrasts with one extreme at a time (dark halo helps against light backgrounds,
// light halo against dark ones), so on the opposite extreme the hue is legibility's only
// remaining line of defence. A first pass used a brighter amber (#f4a300) that measured
// only 2.08:1 against white — invisible in dark mode (light halo) over a bright region —
// caught by computing contrast ratios directly rather than eyeballing one screenshot.
export const PEN_PALETTE = ['#e63946', '#2a9d8f', '#b5651d', '#3a86ff', '#d62ad0'] as const;

export function nextPenIndex(current: number): number {
  return (current + 1) % PEN_PALETTE.length;
}

/**
 * A fast pointermove burst can deliver a point every couple of pixels, and every one of
 * those becomes a polygon vertex that containsPoint, the mask post-processing, and the
 * vectorizer all have to walk. Dropping points closer than `minDistance` to the last kept
 * one keeps the loop's shape while capping how many vertices a sloppy, fast stroke can
 * produce — without this, a few seconds of fast drawing could hand later stages a polygon
 * with thousands of near-duplicate points for no shape benefit.
 */
export function decimatePoints(points: readonly Point[], minDistance: number): Point[] {
  if (points.length <= 1) return [...points];

  const kept: Point[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    const last = kept[kept.length - 1]!;
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) {
      kept.push(point);
    }
  }
  return kept;
}
