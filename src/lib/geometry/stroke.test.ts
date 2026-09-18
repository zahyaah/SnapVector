import { describe, expect, it } from 'vitest';

import { decimatePoints, nextPenIndex, PEN_PALETTE } from './stroke.js';

describe('PEN_PALETTE', () => {
  it('offers 5 hues, per SPEC', () => {
    expect(PEN_PALETTE.length).toBe(5);
  });

  it('has no duplicate hues', () => {
    expect(new Set(PEN_PALETTE).size).toBe(PEN_PALETTE.length);
  });

  // The halo (stroke-overlay.ts) only contrasts against one extreme at a time: a dark
  // halo (light theme) is invisible against a pure-black region of the source image, and
  // a light halo (dark theme) is invisible against pure white. On whichever extreme the
  // halo can't help with, the pen hue itself is the only remaining source of contrast —
  // so every hue must clear WCAG's 3:1 graphical-object threshold (SC 1.4.11) against
  // BOTH pure black and pure white, not just look fine on an average photo. A first pass
  // used a brighter amber (#f4a300) that measured 2.08:1 against white and was caught
  // only by computing this, not by eyeballing a screenshot with a red loop on it.
  function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
    const linear = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  }

  function contrastRatio(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
  ): number {
    const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
      (x, y) => y - x,
    );
    return (lighter! + 0.05) / (darker! + 0.05);
  }

  function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  it('clears the WCAG 3:1 graphical-object contrast threshold against pure black and pure white for every hue', () => {
    for (const hex of PEN_PALETTE) {
      const rgb = hexToRgb(hex);
      expect(contrastRatio(rgb, [0, 0, 0])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(rgb, [255, 255, 255])).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('nextPenIndex', () => {
  it('advances through the palette', () => {
    expect(nextPenIndex(0)).toBe(1);
    expect(nextPenIndex(1)).toBe(2);
  });

  it('wraps back to the start after the last hue', () => {
    expect(nextPenIndex(PEN_PALETTE.length - 1)).toBe(0);
  });
});

describe('decimatePoints', () => {
  it('keeps a point only once it is far enough from the last kept point', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(decimatePoints(points, 5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('always keeps the first point', () => {
    const points = [
      { x: 5, y: 5 },
      { x: 5.1, y: 5.1 },
    ];
    expect(decimatePoints(points, 100)[0]).toEqual({ x: 5, y: 5 });
  });

  it('keeps every point when they are already far apart', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ];
    expect(decimatePoints(points, 5)).toEqual(points);
  });

  it('returns an empty array unchanged', () => {
    expect(decimatePoints([], 5)).toEqual([]);
  });

  it('returns a single point unchanged', () => {
    expect(decimatePoints([{ x: 1, y: 1 }], 5)).toEqual([{ x: 1, y: 1 }]);
  });

  it('treats a zero or negative threshold as "keep everything"', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0.001, y: 0 },
    ];
    expect(decimatePoints(points, 0)).toEqual(points);
  });
});
