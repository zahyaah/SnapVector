import type { Point, Polygon } from '../geometry/loop.js';

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lineLength = Math.hypot(dx, dy);

  // A zero-length baseline (two identical endpoints) has no line to measure a
  // perpendicular distance against — fall back to plain point-to-point distance.
  if (lineLength === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);

  // |cross(end-start, point-start)| / |end-start| — the standard point-to-infinite-line
  // distance formula (area of the parallelogram divided by its base length). Classic
  // Douglas-Peucker measures against the infinite line through the two endpoints, not
  // the clamped segment, which is why the algorithm is defined this way rather than
  // with a segment-distance check.
  const cross = dx * (point.y - lineStart.y) - dy * (point.x - lineStart.x);
  return Math.abs(cross) / lineLength;
}

/** Standard open-polyline Douglas-Peucker: keep the endpoints, recursively keep whatever
 * point deviates most from the straight line between them if that deviation exceeds
 * `tolerance`, otherwise collapse the whole run down to just its two endpoints. */
function simplifyOpenPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];

  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDistance = -1;
  let maxIndex = -1;

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i]!, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance > tolerance) {
    const left = simplifyOpenPolyline(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyOpenPolyline(points.slice(maxIndex), tolerance);
    // `left`'s last point and `right`'s first point are both `points[maxIndex]` —
    // drop one copy where they join.
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

function squaredDistance(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Douglas-Peucker for a closed polygon (SPEC's contours from `contours.ts` are always
 * implicitly closed, never open polylines, which is the textbook algorithm's usual
 * input). Split into two open arcs at a pair of far-apart points, simplify each arc
 * independently, then rejoin — the standard technique for adapting the open-polyline
 * algorithm to a closed ring without favouring one arbitrary point on the ring over
 * another as a "seam" that never gets to simplify across.
 *
 * The split points are index 0 and whichever point is farthest from it, rather than a
 * true all-pairs farthest pair (which would cost O(n^2) for a benefit this algorithm
 * doesn't need): a single farthest-from-an-arbitrary-point search is O(n) and gives two
 * reasonably distant anchors, which is all a good split needs.
 */
export function simplifyPolygon(polygon: Polygon, tolerance: number): Polygon {
  if (tolerance < 0) {
    throw new Error('simplifyPolygon: tolerance must not be negative');
  }
  if (polygon.length < 3) return [...polygon];

  const anchor = polygon[0]!;
  let splitIndex = 0;
  let maxDistanceSquared = -1;
  for (let i = 1; i < polygon.length; i++) {
    const distanceSquared = squaredDistance(anchor, polygon[i]!);
    if (distanceSquared > maxDistanceSquared) {
      maxDistanceSquared = distanceSquared;
      splitIndex = i;
    }
  }

  // splitIndex is always reassigned at least once: the search below starts its
  // "best so far" at -1, and any real squared distance (including 0, for an
  // all-identical-points polygon) beats that on the very first comparison (i=1).
  // splitIndex can therefore never remain 0 here.
  const arcToSplit = polygon.slice(0, splitIndex + 1);
  const arcFromSplit = polygon.slice(splitIndex).concat([anchor]);

  const simplifiedArcToSplit = simplifyOpenPolyline(arcToSplit, tolerance);
  const simplifiedArcFromSplit = simplifyOpenPolyline(arcFromSplit, tolerance);

  // Both arcs include the two shared split points at their ends — keep them from
  // `simplifiedArcToSplit` and drop the duplicates from the start and end of the other.
  const result = simplifiedArcToSplit.concat(simplifiedArcFromSplit.slice(1, -1));

  // At a large enough tolerance both arcs can independently collapse to just their own
  // two endpoints, which are the same two points (`anchor` and the split point) —
  // leaving only 2 points overall, a degenerate "polygon" with no area. A closed
  // contour needs at least a triangle to mean anything as a shape, so tolerance is
  // never allowed to erase the third point entirely: fall back to the single point
  // (from the original, unsimplified polygon) that deviates most from the anchor-split
  // line, keeping the three points in their original order around the ring so winding
  // stays consistent with the input.
  if (result.length < 3) {
    let maxDistance = -1;
    let maxIndex = -1;
    for (let i = 0; i < polygon.length; i++) {
      if (i === 0 || i === splitIndex) continue;
      const distance = perpendicularDistance(polygon[i]!, anchor, polygon[splitIndex]!);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }
    // maxIndex is guaranteed to be reassigned: `polygon.length >= 3` is already
    // established above, so at least one index other than 0 and splitIndex always
    // exists for the loop above to consider.
    return maxIndex < splitIndex
      ? [anchor, polygon[maxIndex]!, polygon[splitIndex]!]
      : [anchor, polygon[splitIndex]!, polygon[maxIndex]!];
  }

  return result;
}
