export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Polygon = readonly Point[];

export interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundingBox(polygon: Polygon): BoundingBox {
  if (polygon.length === 0) {
    throw new Error('boundingBox requires at least one point');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Twice the polygon's signed area via the shoelace formula (the factor of 2 cancels in
 * every caller here, so it is left in rather than paying a division nothing needs).
 * Positive for counter-clockwise winding, negative for clockwise, zero for degenerate or
 * collinear input.
 */
export function signedArea(polygon: Polygon): number {
  if (polygon.length < 3) return 0;

  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Area-weighted centroid. A hand-drawn loop is rarely convex, so the vertex average (mean
 * of all points) is not the same thing and would skew toward whichever stretch of the
 * stroke has more sampled points. Falls back to the vertex average when the area is zero
 * (collinear or degenerate input), where the area-weighted formula would divide by zero.
 */
export function polygonCentroid(polygon: Polygon): Point {
  if (polygon.length === 0) return { x: 0, y: 0 };
  if (polygon.length === 1) return polygon[0]!;

  const area = signedArea(polygon);
  if (area === 0) {
    const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), {
      x: 0,
      y: 0,
    });
    return { x: sum.x / polygon.length, y: sum.y / polygon.length };
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const factor = 1 / (6 * area);
  return { x: cx * factor, y: cy * factor };
}

/** Standard ray-casting point-in-polygon test. Points on an edge may return either result
 * depending on floating-point rounding — acceptable here since SAM prompt points are
 * never deliberately placed exactly on a loop's boundary. */
export function containsPoint(polygon: Polygon, point: Point): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses) {
      const intersectX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < intersectX) inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  let t = lengthSquared === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const closestX = a.x + t * dx;
  const closestY = a.y + t * dy;
  return Math.hypot(p.x - closestX, p.y - closestY);
}

/** Signed distance to the polygon boundary: negative outside, positive inside. */
function distanceToPolygon(polygon: Polygon, point: Point): number {
  let minDistance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const distance = distanceToSegment(point, polygon[i]!, polygon[j]!);
    if (distance < minDistance) minDistance = distance;
  }
  return containsPoint(polygon, point) ? minDistance : -minDistance;
}

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly halfSize: number;
  readonly distance: number;
  readonly maxDistance: number;
}

function makeCell(x: number, y: number, halfSize: number, polygon: Polygon): Cell {
  const distance = distanceToPolygon(polygon, { x, y });
  return { x, y, halfSize, distance, maxDistance: distance + halfSize * Math.SQRT2 };
}

/**
 * The point deepest inside a polygon, found by the same grid-refinement approach as
 * Mapbox's polylabel: sample cells across the bounding box, always subdivide the most
 * promising one, and stop once no unexplored cell could possibly beat the current best.
 * We need this instead of the centroid because a rough loop is very often concave (an L,
 * a C, a blob with a notch), where the centroid frequently falls outside the shape
 * entirely — see the `polygonCentroid` test above. A SAM foreground point placed outside
 * the loop it was meant to describe would silently produce a wrong mask.
 */
export function poleOfInaccessibility(polygon: Polygon, precision = 1): Point {
  const box = boundingBox(polygon);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;

  if (polygon.length === 1) return polygon[0]!;
  if (width === 0 && height === 0) return { x: box.minX, y: box.minY };

  const cellSize = Math.max(Math.min(width, height), 1e-9);
  let bestCell = makeCell(box.minX + width / 2, box.minY + height / 2, 0, polygon);

  const centroid = polygonCentroid(polygon);
  const centroidCell = makeCell(centroid.x, centroid.y, 0, polygon);
  if (centroidCell.distance > bestCell.distance) bestCell = centroidCell;

  const cells: Cell[] = [];
  let h = cellSize / 2;
  for (let x = box.minX; x < box.maxX; x += cellSize) {
    for (let y = box.minY; y < box.maxY; y += cellSize) {
      cells.push(makeCell(x + h, y + h, h, polygon));
    }
  }

  // Bounded rather than a while(true): pathological input (thousands of self-intersections
  // from a jittery stroke) must still terminate in a fixed amount of work.
  for (let iteration = 0; iteration < 400 && cells.length > 0; iteration++) {
    cells.sort((a, b) => a.maxDistance - b.maxDistance);
    const cell = cells.pop()!;

    if (cell.distance > bestCell.distance) bestCell = cell;
    if (cell.maxDistance - bestCell.distance <= precision) break;

    h = cell.halfSize / 2;
    cells.push(
      makeCell(cell.x - h, cell.y - h, h, polygon),
      makeCell(cell.x + h, cell.y - h, h, polygon),
      makeCell(cell.x - h, cell.y + h, h, polygon),
      makeCell(cell.x + h, cell.y + h, h, polygon),
    );
  }

  return { x: bestCell.x, y: bestCell.y };
}
