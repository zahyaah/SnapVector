import { createBinaryMask, type BinaryMask } from './binary-mask.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

// The same 4-connectivity used throughout lib/mask (binary-mask.ts) — kept consistent
// so "connected" means the same thing at every stage of the pipeline.
const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function inBounds(mask: BinaryMask, x: number, y: number): boolean {
  return x >= 0 && x < mask.width && y >= 0 && y < mask.height;
}

function at(mask: BinaryMask, x: number, y: number): 0 | 1 {
  // Outside the mask counts as background — a shape touching the border erodes on
  // that side exactly as if it bordered empty space, because it does.
  if (!inBounds(mask, x, y)) return 0;
  return mask.data[y * mask.width + x] === 1 ? 1 : 0;
}

/**
 * A foreground pixel survives only if it and all 4 neighbours are foreground — the
 * standard "full" cross-shaped structuring element. Removes anything one pixel wide:
 * isolated speckle, thin spikes off a boundary.
 */
export function erode(mask: BinaryMask): BinaryMask {
  const result = createBinaryMask(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (at(mask, x, y) === 0) continue;
      const survives = NEIGHBOR_OFFSETS.every(([dx, dy]) => at(mask, x + dx, y + dy) === 1);
      if (survives) result.data[y * mask.width + x] = 1;
    }
  }
  return result;
}

/** A pixel becomes foreground if it or any of its 4 neighbours already is. Grows every
 * shape by one pixel in each cardinal direction. */
export function dilate(mask: BinaryMask): BinaryMask {
  const result = createBinaryMask(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const grows =
        at(mask, x, y) === 1 ||
        NEIGHBOR_OFFSETS.some(([dx, dy]) => at(mask, x + dx, y + dy) === 1);
      if (grows) result.data[y * mask.width + x] = 1;
    }
  }
  return result;
}

/** Erode then dilate: removes speckle and thin spikes without changing a solid shape's
 * overall size, since the dilation restores what the erosion only temporarily removed
 * from real (thicker-than-one-pixel) structure. */
export function open(mask: BinaryMask): BinaryMask {
  return dilate(erode(mask));
}

/** Dilate then erode: fills small notches and one-pixel gaps in a boundary without
 * changing a solid shape's overall size, for the same reason `open` doesn't. */
export function close(mask: BinaryMask): BinaryMask {
  return erode(dilate(mask));
}

function countForeground(mask: BinaryMask): number {
  let count = 0;
  for (const value of mask.data) count += value;
  return count;
}

// A shape thinner than the structuring element in some dimension has no pixel that
// isn't within one step of its own boundary — erosion removes every pixel of a 2-wide
// strip, and dilation cannot restore what erosion deleted entirely. If opening would
// erase most of the shape, that shape was too thin for erosion-based cleanup to apply
// safely, so opening is skipped for it rather than allowed to erase legitimate,
// if narrow, segmented structure.
const MIN_SURVIVING_FRACTION_AFTER_OPEN = 0.5;

/**
 * Light smoothing: one open pass (guarded against erasing thin shapes entirely), then
 * one close pass. Deliberately a single iteration of each rather than several — SPEC
 * calls for "light" smoothing, and each additional pass costs more thin, genuine
 * structure for diminishing cleanup of noise a single pass mostly already handles.
 */
export function smooth(mask: BinaryMask): BinaryMask {
  const originalCount = countForeground(mask);
  const opened = open(mask);
  const safeToOpen =
    originalCount === 0 ||
    countForeground(opened) >= originalCount * MIN_SURVIVING_FRACTION_AFTER_OPEN;
  return close(safeToOpen ? opened : mask);
}

function floodFillComponent(mask: BinaryMask, startIndex: number): Set<number> {
  const { width } = mask;
  const component = new Set<number>([startIndex]);
  const queue = [startIndex];
  let cursor = 0;
  while (cursor < queue.length) {
    const index = queue[cursor]!;
    cursor++;
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(mask, nx, ny)) continue;
      const nIndex = ny * width + nx;
      if (mask.data[nIndex] === 1 && !component.has(nIndex)) {
        component.add(nIndex);
        queue.push(nIndex);
      }
    }
  }
  return component;
}

/**
 * Grid-distance BFS from the anchor over every pixel (foreground or background),
 * stopping at the first foreground pixel found. A SAM prompt anchor is derived from the
 * user's drawn loop, not from the mask the model actually returns, so there is no
 * guarantee the anchor pixel itself is foreground — the closest foreground pixel is
 * what "the blob near where the user meant" actually refers to.
 */
function nearestForegroundIndex(mask: BinaryMask, anchor: Point): number | null {
  const { width, height } = mask;
  const startX = Math.min(Math.max(Math.round(anchor.x), 0), width - 1);
  const startY = Math.min(Math.max(Math.round(anchor.y), 0), height - 1);
  const startIndex = startY * width + startX;

  if (mask.data[startIndex] === 1) return startIndex;

  const visited = new Uint8Array(width * height);
  visited[startIndex] = 1;
  const queue = [startIndex];
  let cursor = 0;
  while (cursor < queue.length) {
    const index = queue[cursor]!;
    cursor++;
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(mask, nx, ny)) continue;
      const nIndex = ny * width + nx;
      if (visited[nIndex] === 1) continue;
      visited[nIndex] = 1;
      if (mask.data[nIndex] === 1) return nIndex;
      queue.push(nIndex);
    }
  }
  return null;
}

/**
 * Keeps only the connected component nearest the prompt anchor, discarding every other
 * component — this is what stops an unrelated larger blob elsewhere in the mask (a
 * second object SAM also picked up on) from winning out over the smaller region the
 * user actually drew a loop around.
 */
export function selectComponentContaining(mask: BinaryMask, anchor: Point): BinaryMask {
  const result = createBinaryMask(mask.width, mask.height);
  const startIndex = nearestForegroundIndex(mask, anchor);
  if (startIndex === null) return result; // no foreground anywhere in the mask

  const component = floodFillComponent(mask, startIndex);
  for (const index of component) result.data[index] = 1;
  return result;
}

/**
 * The full post-processing pipeline, in order: select the anchored component first (so
 * smoothing only ever spends effort on the shape that matters, and can't be influenced
 * by unrelated components elsewhere in the mask), then lightly smooth its boundary.
 * Hole-filling (binary-mask.ts's `fillHoles`) is intentionally not called here — it
 * takes a size threshold that depends on the source image's resolution, which this
 * module has no way to know, so the caller composes it before calling this.
 */
export function postprocessMask(mask: BinaryMask, anchor: Point): BinaryMask {
  return smooth(selectComponentContaining(mask, anchor));
}
