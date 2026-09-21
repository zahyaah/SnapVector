import type { BinaryMask } from '../mask/binary-mask.js';

export interface PixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// A rendering pipeline failing to produce a shape's fill color shouldn't be a fatal
// error — the traced shape is still valid SVG without it. Neutral grey is a reasonable,
// visible-but-unobtrusive stand-in for "no source pixels were available to sample."
const FALLBACK_COLOR: RgbColor = { r: 128, g: 128, b: 128 };

function assertMatchingDimensions(pixels: PixelBuffer, mask: BinaryMask): void {
  if (pixels.width !== mask.width || pixels.height !== mask.height) {
    throw new Error(
      `sample: pixel buffer (${String(pixels.width)}x${String(pixels.height)}) and mask ` +
        `(${String(mask.width)}x${String(mask.height)}) dimensions do not match`,
    );
  }
}

function collectMaskedPixels(pixels: PixelBuffer, mask: BinaryMask): RgbColor[] {
  const result: RgbColor[] = [];
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] !== 1) continue;
    const offset = i * 4;
    result.push({
      r: pixels.data[offset]!,
      g: pixels.data[offset + 1]!,
      b: pixels.data[offset + 2]!,
    });
  }
  return result;
}

/**
 * The mean RGB of every pixel inside the mask, ignoring background pixels and the
 * alpha channel entirely (source images are always fully opaque photos here — see
 * SPEC — so there is nothing meaningful to weight by).
 */
export function sampleAverageColor(pixels: PixelBuffer, mask: BinaryMask): RgbColor {
  assertMatchingDimensions(pixels, mask);
  const masked = collectMaskedPixels(pixels, mask);
  if (masked.length === 0) return FALLBACK_COLOR;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const { r, g, b } of masked) {
    sumR += r;
    sumG += g;
    sumB += b;
  }
  return {
    r: Math.round(sumR / masked.length),
    g: Math.round(sumG / masked.length),
    b: Math.round(sumB / masked.length),
  };
}

// A small, seeded linear congruential generator — used everywhere else in this project
// (geometry/prompt.test.ts's property test, stroke.ts is the exception since palette
// cycling needs no randomness) for reproducible "randomness" without a dependency.
function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function colorDistanceSquared(a: RgbColor, b: RgbColor): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function colorKey(c: RgbColor): number {
  return c.r * 65536 + c.g * 256 + c.b;
}

const KMEANS_MAX_ITERATIONS = 20;
// Real masks can span tens of thousands of pixels; k-means only needs a representative
// sample to find good cluster centers, not every pixel, and capping the working set
// keeps this fast regardless of how large the segmented region is.
const KMEANS_MAX_SAMPLE_SIZE = 2000;

/**
 * A small flat palette (up to `k` colors) summarizing the masked region, via k-means
 * clustering in RGB space. Deterministic for a given `seed`: both the pixel subsample
 * (for large regions) and the initial centroid choice are drawn from the same seeded
 * generator, so nothing here depends on iteration order or `Math.random()`.
 */
export function sampleKMeansPalette(
  pixels: PixelBuffer,
  mask: BinaryMask,
  k: number,
  seed: number,
): RgbColor[] {
  if (k <= 0) {
    throw new Error('sampleKMeansPalette: k must be positive');
  }
  assertMatchingDimensions(pixels, mask);

  const masked = collectMaskedPixels(pixels, mask);
  if (masked.length === 0) return [];

  const rng = createRng(seed);

  const working =
    masked.length <= KMEANS_MAX_SAMPLE_SIZE
      ? masked
      : Array.from(
          { length: KMEANS_MAX_SAMPLE_SIZE },
          () => masked[Math.floor(rng() * masked.length)]!,
        );

  const distinctColors = new Set(working.map(colorKey));
  const effectiveK = Math.min(k, distinctColors.size);

  // Forgy initialization: seed each cluster from a real data point rather than an
  // arbitrary RGB value, so the first iteration already starts from plausible colors.
  const centroids: RgbColor[] = [];
  const usedKeys = new Set<number>();
  while (centroids.length < effectiveK) {
    const candidate = working[Math.floor(rng() * working.length)]!;
    const key = colorKey(candidate);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    centroids.push(candidate);
  }

  const assignments = new Array<number>(working.length).fill(0);
  for (let iteration = 0; iteration < KMEANS_MAX_ITERATIONS; iteration++) {
    let changed = false;
    for (let i = 0; i < working.length; i++) {
      let bestCluster = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const distance = colorDistanceSquared(working[i]!, centroids[c]!);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) changed = true;
      assignments[i] = bestCluster;
    }

    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (let i = 0; i < working.length; i++) {
      const sum = sums[assignments[i]!]!;
      sum.r += working[i]!.r;
      sum.g += working[i]!.g;
      sum.b += working[i]!.b;
      sum.count++;
    }
    for (let c = 0; c < centroids.length; c++) {
      const sum = sums[c]!;
      // An empty cluster keeps its previous centroid rather than collapsing to
      // (0,0,0) — nothing assigned to it this round doesn't mean black is correct.
      // Left genuinely untested rather than padded with a contrived fixture: empty
      // clusters are a documented possibility in Lloyd's algorithm generally, but a
      // targeted search of 10,000+ random cluster/seed/k combinations (varied color
      // counts, skew, and k relative to natural groupings) never triggered this branch
      // with Forgy initialization (seeding centroids from real data points, which
      // guarantees every centroid starts with at least itself assigned). Kept as a
      // safety net against input distributions that search didn't cover, not proven
      // unreachable the way binary-mask.ts's border-seeding invariant is.
      if (sum.count === 0) continue;
      centroids[c] = {
        r: Math.round(sum.r / sum.count),
        g: Math.round(sum.g / sum.count),
        b: Math.round(sum.b / sum.count),
      };
    }

    if (!changed) break;
  }

  return centroids;
}
