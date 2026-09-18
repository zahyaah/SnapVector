import { err, ok, type Result } from '../result.js';
import {
  boundingBox,
  containsPoint,
  poleOfInaccessibility,
  polygonCentroid,
  signedArea,
  type BoundingBox,
  type Point,
  type Polygon,
} from './loop.js';

export type PromptLabel = 'foreground' | 'background';

export interface PromptPoint extends Point {
  readonly label: PromptLabel;
}

export interface SamPrompt {
  readonly points: readonly PromptPoint[];
  readonly box: BoundingBox;
}

export interface PromptOptions {
  readonly interiorSampleCount?: number;
}

export interface PromptError {
  readonly kind: 'degenerate-loop';
}

interface ImageBounds {
  readonly width: number;
  readonly height: number;
}

// A loop this small is a slip of the pointer, not an intended selection — SAM cannot do
// anything useful with a near-zero-area box prompt, so we reject it rather than return a
// technically-valid but meaningless prompt.
const MIN_LOOP_AREA = 4;

// However few interior samples a caller requests, the anchor plus this many always
// satisfies "at least 3 points" (SPEC §9.4) without the caller having to know that.
const MIN_INTERIOR_SAMPLES = 2;

/**
 * SAM responds to points near an object's centre, not its edge — centroid plus a couple
 * of points sampled toward the bounding box corners gives spatial spread without landing
 * outside the actual shape. Each candidate is verified against the polygon and pulled
 * back toward the anchor (which is always inside, by construction) until it lands inside
 * too, since a straight 30%-toward-corner step can easily overshoot out of a concave loop.
 */
function sampleTowardCorner(loop: Polygon, anchor: Point, corner: Point): Point {
  let t = 0.3;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = {
      x: anchor.x + (corner.x - anchor.x) * t,
      y: anchor.y + (corner.y - anchor.y) * t,
    };
    if (containsPoint(loop, candidate)) return candidate;
    t /= 2;
  }
  return anchor;
}

function interiorSamples(
  loop: Polygon,
  anchor: Point,
  box: BoundingBox,
  count: number,
): Point[] {
  const corners: Point[] = [
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.minX, y: box.maxY },
  ];
  return Array.from({ length: count }, (_, i) =>
    sampleTowardCorner(loop, anchor, corners[i % corners.length]!),
  );
}

function clampBox(box: BoundingBox, bounds: ImageBounds): BoundingBox {
  const minX = Math.min(Math.max(box.minX, 0), bounds.width);
  const minY = Math.min(Math.max(box.minY, 0), bounds.height);
  const maxX = Math.max(Math.min(box.maxX, bounds.width), minX);
  const maxY = Math.max(Math.min(box.maxY, bounds.height), minY);
  return { minX, minY, maxX, maxY };
}

/**
 * A point away from the subject for the decoder to weigh against the foreground points.
 * Tried in from-the-edges-inward order: true image corners first (cheapest, and the
 * likeliest to already be clear of a "rough loop around one subject"), falling back to
 * edge midpoints for loops that reach a corner but not a full side. Returns null — the
 * negative point is optional per SPEC's task description — rather than fabricating a
 * point that isn't actually outside the loop, which a loop spanning the whole image makes
 * impossible to find.
 */
function backgroundPoint(loop: Polygon, bounds: ImageBounds): Point | null {
  const margin = Math.min(bounds.width, bounds.height) * 0.02;
  const candidates: Point[] = [
    { x: margin, y: margin },
    { x: bounds.width - margin, y: margin },
    { x: bounds.width - margin, y: bounds.height - margin },
    { x: margin, y: bounds.height - margin },
    { x: bounds.width / 2, y: margin },
    { x: bounds.width / 2, y: bounds.height - margin },
    { x: margin, y: bounds.height / 2 },
    { x: bounds.width - margin, y: bounds.height / 2 },
  ];
  return candidates.find((candidate) => !containsPoint(loop, candidate)) ?? null;
}

export function loopToSamPrompt(
  loop: Polygon,
  imageBounds: ImageBounds,
  options: PromptOptions = {},
): Result<SamPrompt, PromptError> {
  if (loop.length < 3 || Math.abs(signedArea(loop)) < MIN_LOOP_AREA) {
    return err({ kind: 'degenerate-loop' });
  }

  const box = boundingBox(loop);
  const centroid = polygonCentroid(loop);
  const anchor = containsPoint(loop, centroid) ? centroid : poleOfInaccessibility(loop);

  const sampleCount = Math.max(
    MIN_INTERIOR_SAMPLES,
    options.interiorSampleCount ?? MIN_INTERIOR_SAMPLES,
  );
  const points: PromptPoint[] = [
    { ...anchor, label: 'foreground' },
    ...interiorSamples(loop, anchor, box, sampleCount).map((p): PromptPoint => ({
      ...p,
      label: 'foreground',
    })),
  ];

  const background = backgroundPoint(loop, imageBounds);
  if (background !== null) {
    points.push({ ...background, label: 'background' });
  }

  return ok({ points, box: clampBox(box, imageBounds) });
}
