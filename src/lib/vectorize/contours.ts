import type { Point, Polygon } from '../geometry/loop.js';
import type { BinaryMask } from '../mask/binary-mask.js';

type EdgeLabel = 'N' | 'E' | 'S' | 'W';

/**
 * The 16 marching-squares cases, keyed by `8*TL + 4*TR + 2*BR + 1*BL` (corners walked
 * clockwise from top-left). Each entry lists the edge-midpoint pairs a cell contributes,
 * as directed segments.
 *
 * Every direction below was derived from one fixed rule, not chosen per case by eye:
 * orient the segment so each foreground corner has a strictly negative cross product
 * relative to the segment's direction vector (`cross(direction, corner - start) < 0`).
 * Applying the identical algebraic test to all 14 non-trivial cases is what makes the
 * winding consistent across the whole table — a single sign slip in one case would
 * silently reverse just that case's contribution and corrupt any contour crossing it.
 *
 * Cases 5 and 10 are the ambiguous saddles (diagonally-opposite corners foreground,
 * the other two background). Both are resolved by applying the same single-corner rule
 * to each diagonal corner independently, treating them as two separate touching
 * regions rather than one connected shape — deliberately consistent with this
 * project's 4-connectivity convention elsewhere (lib/mask), where diagonal contact
 * does not count as connected either.
 */
const CASE_TABLE: Readonly<Record<number, readonly (readonly [EdgeLabel, EdgeLabel])[]>> = {
  0: [],
  1: [['S', 'W']],
  2: [['E', 'S']],
  3: [['E', 'W']],
  4: [['N', 'E']],
  5: [
    ['N', 'E'],
    ['S', 'W'],
  ],
  6: [['N', 'S']],
  7: [['N', 'W']],
  8: [['W', 'N']],
  9: [['S', 'N']],
  10: [
    ['W', 'N'],
    ['E', 'S'],
  ],
  11: [['E', 'N']],
  12: [['W', 'E']],
  13: [['S', 'E']],
  14: [['W', 'S']],
  15: [],
};

function edgePoint(label: EdgeLabel, i: number, j: number): Point {
  switch (label) {
    case 'N':
      return { x: i + 0.5, y: j };
    case 'E':
      return { x: i + 1, y: j + 0.5 };
    case 'S':
      return { x: i + 0.5, y: j + 1 };
    case 'W':
      return { x: i, y: j + 0.5 };
  }
}

// Edge-midpoint coordinates are always integers or exact halves, so doubling and
// rounding gives an exact integer key with no floating-point equality hazards —
// simpler and more robust than formatting coordinates into a string.
function pointKey(p: Point): number {
  const kx = Math.round(p.x * 2);
  const ky = Math.round(p.y * 2);
  return kx * 100000 + ky;
}

/**
 * Traces every closed boundary in a binary mask using marching squares over the pixel
 * grid as samples (a pixel's value is a sample, not a filled square — the standard
 * convention, which is why a solid rectangular block traces with 45-degree corner cuts
 * rather than exact right angles: T21/T22 simplify and curve-fit this raw output,
 * which is not meant to be the final shape).
 *
 * The mask is padded with a 1px border of background before tracing (removed again
 * from the output coordinates) so a foreground region touching the mask's edge is
 * still fully enclosed by sample data on every side, guaranteeing a closed contour
 * rather than one that runs off the edge of the grid.
 */
export function traceContours(mask: BinaryMask): Polygon[] {
  const paddedWidth = mask.width + 2;
  const paddedHeight = mask.height + 2;

  const sample = (x: number, y: number): 0 | 1 => {
    const mx = x - 1;
    const my = y - 1;
    if (mx < 0 || mx >= mask.width || my < 0 || my >= mask.height) return 0;
    return mask.data[my * mask.width + mx] === 1 ? 1 : 0;
  };

  const segments = new Map<number, { readonly to: Point; readonly toKey: number }>();
  const cellsX = paddedWidth - 1;
  const cellsY = paddedHeight - 1;

  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const tl = sample(i, j);
      const tr = sample(i + 1, j);
      const br = sample(i + 1, j + 1);
      const bl = sample(i, j + 1);
      // caseIndex is a sum of four 0/1 terms weighted 8,4,2,1, so it is always exactly
      // in 0..15, and CASE_TABLE defines all 16 — never actually undefined.
      const caseIndex = tl * 8 + tr * 4 + br * 2 + bl * 1;
      const pairs = CASE_TABLE[caseIndex]!;

      for (const [fromLabel, toLabel] of pairs) {
        const from = edgePoint(fromLabel, i, j);
        const to = edgePoint(toLabel, i, j);
        segments.set(pointKey(from), { to, toKey: pointKey(to) });
      }
    }
  }

  const visited = new Set<number>();
  const contours: Polygon[] = [];

  for (const startKey of segments.keys()) {
    if (visited.has(startKey)) continue;

    const points: Point[] = [];
    let currentKey = startKey;
    // The `visited`/`!segment` checks and the `points.length >= 3` guard below are
    // defensive, not exercised by any current test: a correctly-derived case table
    // guarantees every edge-midpoint is the start of exactly one segment and the end of
    // exactly one other, which is what makes chains close cleanly back to their own
    // start rather than colliding with an unrelated point or terminating early. That
    // guarantee is checked here empirically (14 fixture cases, including saddles,
    // multi-component masks, and border-touching shapes) rather than proven exhaustively
    // for all 16 cases' pairwise interactions — unlike binary-mask.ts's border-seeding
    // invariant, which is simple enough to prove by hand. An infinite loop or a silently
    // degenerate polygon is a worse failure than a few untested branches, so these stay
    // as a safety net against a future edit to CASE_TABLE breaking that guarantee,
    // rather than being stripped for coverage or "proven" without real confidence.
    for (let steps = 0; steps <= segments.size; steps++) {
      if (visited.has(currentKey)) break;
      const segment = segments.get(currentKey);
      if (!segment) break;

      visited.add(currentKey);
      points.push(segment.to);
      currentKey = segment.toKey;
      if (currentKey === startKey) break;
    }

    if (points.length >= 3) {
      // Shift back out of padded coordinates into the caller's mask coordinate space.
      contours.push(points.map((p) => ({ x: p.x - 1, y: p.y - 1 })));
    }
  }

  return contours;
}
