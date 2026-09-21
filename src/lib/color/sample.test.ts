import { describe, expect, it } from 'vitest';

import { createBinaryMask, setPixel, type BinaryMask } from '../mask/binary-mask.js';
import {
  sampleAverageColor,
  sampleKMeansPalette,
  type PixelBuffer,
  type RgbColor,
} from './sample.js';

function makeImage(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => RgbColor,
): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b } = colorAt(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function maskLeftHalf(width: number, height: number): BinaryMask {
  const mask = createBinaryMask(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width / 2; x++) setPixel(mask, x, y, 1);
  }
  return mask;
}

function fullMask(width: number, height: number): BinaryMask {
  const mask = createBinaryMask(width, height);
  mask.data.fill(1);
  return mask;
}

describe('sampleAverageColor', () => {
  it('returns the exact color of a uniformly-colored masked region', () => {
    const image = makeImage(10, 10, () => ({ r: 200, g: 100, b: 50 }));
    const mask = fullMask(10, 10);
    expect(sampleAverageColor(image, mask)).toEqual({ r: 200, g: 100, b: 50 });
  });

  it('only counts pixels where the mask is foreground, ignoring the background entirely', () => {
    // Left half is red (masked in), right half is a wildly different blue (masked out)
    // — the background color must have zero influence on the result.
    const image = makeImage(10, 10, (x) =>
      x < 5 ? { r: 255, g: 0, b: 0 } : { r: 0, g: 0, b: 255 },
    );
    const mask = maskLeftHalf(10, 10);
    expect(sampleAverageColor(image, mask)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('averages two evenly-split colors within the masked region', () => {
    const image = makeImage(10, 10, (x) =>
      x < 5 ? { r: 100, g: 100, b: 100 } : { r: 200, g: 200, b: 200 },
    );
    const mask = fullMask(10, 10);
    expect(sampleAverageColor(image, mask)).toEqual({ r: 150, g: 150, b: 150 });
  });

  it('falls back to a neutral grey rather than throwing when the mask has no foreground', () => {
    const image = makeImage(4, 4, () => ({ r: 10, g: 20, b: 30 }));
    const mask = createBinaryMask(4, 4);
    expect(() => sampleAverageColor(image, mask)).not.toThrow();
    expect(sampleAverageColor(image, mask)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('throws when the pixel buffer and mask dimensions do not match', () => {
    const image = makeImage(10, 10, () => ({ r: 0, g: 0, b: 0 }));
    const mask = createBinaryMask(5, 5);
    expect(() => sampleAverageColor(image, mask)).toThrow();
  });
});

describe('sampleKMeansPalette', () => {
  it('with k=1, matches the simple average color', () => {
    const image = makeImage(8, 8, (x) =>
      x < 4 ? { r: 10, g: 10, b: 10 } : { r: 50, g: 50, b: 50 },
    );
    const mask = fullMask(8, 8);
    const [color] = sampleKMeansPalette(image, mask, 1, 1);
    expect(color).toEqual(sampleAverageColor(image, mask));
  });

  it('recovers two well-separated colors from an evenly split region', () => {
    const image = makeImage(20, 20, (x) =>
      x < 10 ? { r: 255, g: 0, b: 0 } : { r: 0, g: 0, b: 255 },
    );
    const mask = fullMask(20, 20);
    const palette = sampleKMeansPalette(image, mask, 2, 1);

    expect(palette).toHaveLength(2);
    const hasNearRed = palette.some((c) => c.r > 200 && c.g < 50 && c.b < 50);
    const hasNearBlue = palette.some((c) => c.b > 200 && c.g < 50 && c.r < 50);
    expect(hasNearRed).toBe(true);
    expect(hasNearBlue).toBe(true);
  });

  it('is deterministic: the same seed produces the identical palette every time', () => {
    const image = makeImage(30, 30, (x, y) => ({
      r: (x * 7) % 256,
      g: (y * 13) % 256,
      b: (x + y) % 256,
    }));
    const mask = fullMask(30, 30);
    const first = sampleKMeansPalette(image, mask, 3, 42);
    const second = sampleKMeansPalette(image, mask, 3, 42);
    expect(second).toEqual(first);
  });

  it('can produce a different palette for a different seed (sanity check that the seed is actually used)', () => {
    const image = makeImage(30, 30, (x, y) => ({
      r: (x * 7) % 256,
      g: (y * 13) % 256,
      b: (x + y) % 256,
    }));
    const mask = fullMask(30, 30);
    const seedA = sampleKMeansPalette(image, mask, 4, 1);
    const seedB = sampleKMeansPalette(image, mask, 4, 999);
    // Not a strict requirement that they differ, but for this varied a synthetic image
    // it would be suspicious if the seed had no effect at all.
    expect(seedA).not.toEqual(seedB);
  });

  it('never returns more colors than distinct pixels available, and never crashes when k exceeds that', () => {
    const image = makeImage(4, 4, () => ({ r: 10, g: 20, b: 30 })); // only 1 distinct color
    const mask = fullMask(4, 4);
    const palette = sampleKMeansPalette(image, mask, 5, 1);
    expect(palette.length).toBeLessThanOrEqual(1);
    expect(() => sampleKMeansPalette(image, mask, 5, 1)).not.toThrow();
  });

  it('returns an empty palette rather than throwing when the mask has no foreground', () => {
    const image = makeImage(4, 4, () => ({ r: 10, g: 20, b: 30 }));
    const mask = createBinaryMask(4, 4);
    expect(sampleKMeansPalette(image, mask, 3, 1)).toEqual([]);
  });

  it('downsamples large masked regions and still produces a valid, deterministic palette', () => {
    // 80x80 = 6400 masked pixels, comfortably over the internal downsampling threshold
    // — exercises the subsampling path a real segmented region (often tens of
    // thousands of pixels) would actually take.
    const image = makeImage(80, 80, (x) =>
      x < 40 ? { r: 255, g: 0, b: 0 } : { r: 0, g: 0, b: 255 },
    );
    const mask = fullMask(80, 80);
    const first = sampleKMeansPalette(image, mask, 2, 7);
    const second = sampleKMeansPalette(image, mask, 2, 7);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    const hasNearRed = first.some((c) => c.r > 200 && c.b < 50);
    const hasNearBlue = first.some((c) => c.b > 200 && c.r < 50);
    expect(hasNearRed).toBe(true);
    expect(hasNearBlue).toBe(true);
  });

  it('retries past a duplicate random pick when choosing initial centroids', () => {
    // 99 pixels of one color, 1 pixel of another, with k=2: picking 2 distinct initial
    // centroids from this distribution is overwhelmingly likely to draw the dominant
    // color twice before finding the lone minority pixel, exercising the "reject a
    // duplicate and try again" branch of centroid initialization on essentially any
    // seed — not just one that happened to be found by chance.
    const image = makeImage(10, 10, (x, y) =>
      x === 0 && y === 0 ? { r: 0, g: 255, b: 0 } : { r: 200, g: 50, b: 50 },
    );
    const mask = fullMask(10, 10);
    const palette = sampleKMeansPalette(image, mask, 2, 3);
    expect(palette).toHaveLength(2);
    expect(palette.some((c) => c.g > 200 && c.r < 50)).toBe(true);
    expect(palette.some((c) => c.r > 150 && c.g < 100)).toBe(true);
  });

  it('rejects a non-positive k rather than behaving unpredictably', () => {
    const image = makeImage(4, 4, () => ({ r: 1, g: 2, b: 3 }));
    const mask = fullMask(4, 4);
    expect(() => sampleKMeansPalette(image, mask, 0, 1)).toThrow();
  });
});
