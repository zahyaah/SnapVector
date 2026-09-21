import { describe, expect, it } from 'vitest';

import { createBinaryMask, setPixel, type BinaryMask } from '../mask/binary-mask.js';
import type { PixelBuffer, RgbColor } from '../color/sample.js';
import { buildResultSvg } from './pipeline.js';

function fillRect(mask: BinaryMask, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) setPixel(mask, x, y, 1);
  }
}

function solidImage(width: number, height: number, color: RgbColor): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color.r;
    data[i * 4 + 1] = color.g;
    data[i * 4 + 2] = color.b;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function countSubpaths(svg: string): number {
  return (svg.match(/<path /g) ?? []).length;
}

function countMoveCommands(svg: string): number {
  const match = /d="([^"]*)"/.exec(svg);
  return match ? (match[1]!.match(/M/g) ?? []).length : 0;
}

describe('buildResultSvg — the full mask-postprocess -> vectorize -> svg-export pipeline', () => {
  it('produces a single-subpath SVG for a solid square region, filled with its true color', () => {
    const mask = createBinaryMask(40, 40);
    fillRect(mask, 10, 10, 30, 30);
    const image = solidImage(40, 40, { r: 40, g: 90, b: 200 });

    const svg = buildResultSvg(mask, { x: 20, y: 20 }, image);

    expect(svg).not.toBeNull();
    expect(countSubpaths(svg!)).toBe(1);
    expect(countMoveCommands(svg!)).toBe(1);
    expect(svg).toContain('fill="#285ac8"');
    expect(svg).toContain('viewBox="0 0 40 40"');
  });

  it('produces a two-subpath SVG for a donut, one subpath per boundary', () => {
    // A hole large enough (400px) to survive the pipeline's own noise-hole-fill —
    // this is what actually exercises fillHoles' size threshold rather than assuming
    // its exact value, since the fixture is comfortably on the "real hole" side.
    const mask = createBinaryMask(60, 60);
    fillRect(mask, 10, 10, 50, 50);
    fillRect(mask, 20, 20, 40, 40); // 20x20 = 400px hole punched in the middle
    for (let y = 20; y < 40; y++) {
      for (let x = 20; x < 40; x++) setPixel(mask, x, y, 0);
    }
    const image = solidImage(60, 60, { r: 10, g: 200, b: 10 });

    const svg = buildResultSvg(mask, { x: 15, y: 15 }, image);

    expect(svg).not.toBeNull();
    expect(countSubpaths(svg!)).toBe(1); // one <path> element...
    expect(countMoveCommands(svg!)).toBe(2); // ...holding two M...Z subpaths
  });

  it('fills a small speck hole rather than rendering it as a visible artifact hole', () => {
    // A 1-pixel hole would be closed by postprocessMask's own morphological smoothing
    // regardless of fillHoles, which would make this test pass even if fillHoles were
    // never called — proven empirically, not assumed: at 40x40 with a solid 30x30
    // region, a 5x5 (25px) hole is the smallest size that still shows up as a second
    // subpath after smoothing alone, but disappears once fillHoles (64px threshold)
    // runs first. This is the size that actually exercises fillHoles, confirmed by
    // running this exact case with fillHoles temporarily removed from the pipeline —
    // it failed (2 subpaths) — before restoring it.
    const mask = createBinaryMask(40, 40);
    fillRect(mask, 5, 5, 35, 35);
    for (let y = 18; y < 23; y++) {
      for (let x = 18; x < 23; x++) setPixel(mask, x, y, 0); // a 5x5 hole near the center
    }
    const image = solidImage(40, 40, { r: 100, g: 100, b: 100 });

    const svg = buildResultSvg(mask, { x: 10, y: 10 }, image);

    expect(svg).not.toBeNull();
    expect(countMoveCommands(svg!)).toBe(1);
  });

  it('returns null when the anchor has no nearby foreground component to select', () => {
    // An anchor point on a mask with no foreground at all: selectComponentContaining
    // (via postprocessMask) has nothing to select, so no contour survives.
    const empty = createBinaryMask(40, 40);
    const image = solidImage(40, 40, { r: 0, g: 0, b: 0 });

    const svg = buildResultSvg(empty, { x: 20, y: 20 }, image);

    expect(svg).toBeNull();
  });

  it('samples the fill color from the cleaned mask region, not the raw pre-cleanup input', () => {
    // The raw mask includes a stray disconnected component far from the anchor, painted
    // a different color in the source image — if sampleAverageColor were ever run
    // against the raw mask instead of the post-processed one, this stray region would
    // pollute the sampled average.
    const mask = createBinaryMask(60, 60);
    fillRect(mask, 10, 10, 30, 30);
    fillRect(mask, 45, 45, 55, 55); // disconnected from the anchored component

    const data = new Uint8ClampedArray(60 * 60 * 4);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        const i = (y * 60 + x) * 4;
        const inStray = x >= 45 && x < 55 && y >= 45 && y < 55;
        data[i] = inStray ? 255 : 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }

    const svg = buildResultSvg(mask, { x: 15, y: 15 }, { data, width: 60, height: 60 });

    expect(svg).not.toBeNull();
    expect(svg).toContain('fill="#000000"');
  });
});
