import { describe, expect, it } from 'vitest';

import {
  backingStoreSize,
  capLongestEdge,
  clientToSourcePoint,
  fitWithin,
} from './viewport.js';

describe('capLongestEdge', () => {
  it('leaves an image already within the cap untouched', () => {
    expect(capLongestEdge({ width: 800, height: 600 }, 2048)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('scales the longest edge down to the cap, preserving aspect ratio', () => {
    expect(capLongestEdge({ width: 4000, height: 3000 }, 2048)).toEqual({
      width: 2048,
      height: 1536,
    });
  });

  it('caps height when the image is portrait', () => {
    expect(capLongestEdge({ width: 3000, height: 4000 }, 2048)).toEqual({
      width: 1536,
      height: 2048,
    });
  });

  it('never collapses an extreme aspect ratio to zero', () => {
    const capped = capLongestEdge({ width: 10000, height: 3 }, 2048);
    expect(capped.width).toBe(2048);
    expect(capped.height).toBeGreaterThanOrEqual(1);
  });

  it('returns integer dimensions, since canvases cannot be fractionally sized', () => {
    const capped = capLongestEdge({ width: 3333, height: 1777 }, 2048);
    expect(Number.isInteger(capped.width)).toBe(true);
    expect(Number.isInteger(capped.height)).toBe(true);
  });
});

describe('fitWithin', () => {
  it('fits a landscape image to the width of a wider box', () => {
    expect(fitWithin({ width: 1000, height: 500 }, { width: 600, height: 600 })).toEqual({
      width: 600,
      height: 300,
    });
  });

  it('fits a portrait image to the height of a shorter box', () => {
    expect(fitWithin({ width: 500, height: 1000 }, { width: 600, height: 400 })).toEqual({
      width: 200,
      height: 400,
    });
  });

  it('scales a small image up so it is large enough to draw on', () => {
    expect(fitWithin({ width: 100, height: 100 }, { width: 400, height: 400 })).toEqual({
      width: 400,
      height: 400,
    });
  });

  it('preserves aspect ratio to within a pixel', () => {
    const fitted = fitWithin({ width: 1920, height: 1080 }, { width: 700, height: 700 });
    expect(Math.abs(fitted.width / fitted.height - 1920 / 1080)).toBeLessThan(0.01);
  });

  it('degrades to a single pixel rather than zero for a degenerate box', () => {
    expect(fitWithin({ width: 1000, height: 500 }, { width: 0, height: 0 })).toEqual({
      width: 1,
      height: 1,
    });
  });
});

describe('backingStoreSize', () => {
  it('multiplies CSS pixels by the device pixel ratio', () => {
    expect(backingStoreSize({ width: 300, height: 200 }, 2)).toEqual({
      width: 600,
      height: 400,
    });
  });

  it('rounds fractional ratios to whole backing-store pixels', () => {
    expect(backingStoreSize({ width: 301, height: 199 }, 1.5)).toEqual({
      width: 452,
      height: 299,
    });
  });

  it('never produces a zero-sized backing store', () => {
    expect(backingStoreSize({ width: 0, height: 0 }, 2)).toEqual({ width: 1, height: 1 });
  });
});

describe('clientToSourcePoint', () => {
  const rect = { left: 50, top: 20, width: 400, height: 300 };
  const source = { width: 800, height: 600 };

  it('maps the top-left corner of the canvas to the image origin', () => {
    expect(clientToSourcePoint({ x: 50, y: 20 }, rect, source)).toEqual({ x: 0, y: 0 });
  });

  it('maps the bottom-right corner to the far corner of the image', () => {
    expect(clientToSourcePoint({ x: 450, y: 320 }, rect, source)).toEqual({
      x: 800,
      y: 600,
    });
  });

  it('maps the centre to the centre regardless of display scale', () => {
    expect(clientToSourcePoint({ x: 250, y: 170 }, rect, source)).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('returns coordinates outside the image for pointers dragged off-canvas', () => {
    // Deliberately unclamped: a loop may legitimately be drawn past the edge, and the
    // prompt stage is what decides how to clamp it. Clamping here would silently
    // flatten the stroke against the border instead.
    const outside = clientToSourcePoint({ x: 10, y: 0 }, rect, source);
    expect(outside.x).toBeLessThan(0);
    expect(outside.y).toBeLessThan(0);
  });

  it('survives a zero-sized rect without producing NaN', () => {
    const degenerate = clientToSourcePoint(
      { x: 5, y: 5 },
      { left: 0, top: 0, width: 0, height: 0 },
      source,
    );
    expect(Number.isFinite(degenerate.x)).toBe(true);
    expect(Number.isFinite(degenerate.y)).toBe(true);
  });
});
