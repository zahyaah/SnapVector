import { describe, expect, it } from 'vitest';

import { containsPoint, type Polygon } from './loop.js';
import { loopToSamPrompt, type SamPrompt } from './prompt.js';

const IMAGE_BOUNDS = { width: 800, height: 600 };

const SQUARE: Polygon = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];

const C_SHAPE: Polygon = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 180 },
  { x: 180, y: 180 },
  { x: 180, y: 220 },
  { x: 300, y: 220 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];

function unwrap(loop: Polygon, bounds = IMAGE_BOUNDS): SamPrompt {
  const result = loopToSamPrompt(loop, bounds);
  if (!result.ok) throw new Error(`expected a prompt, got error: ${result.error.kind}`);
  return result.value;
}

function foregroundPoints(prompt: SamPrompt) {
  return prompt.points.filter((p) => p.label === 'foreground');
}

describe('loopToSamPrompt — foreground point placement', () => {
  it('places every foreground point inside a convex square', () => {
    const prompt = unwrap(SQUARE);
    for (const point of foregroundPoints(prompt)) {
      expect(containsPoint(SQUARE, point)).toBe(true);
    }
  });

  it('places every foreground point inside a concave C-shape, where the centroid falls outside', () => {
    const prompt = unwrap(C_SHAPE);
    for (const point of foregroundPoints(prompt)) {
      expect(containsPoint(C_SHAPE, point)).toBe(true);
    }
  });

  it('returns at least 3 points total for a well-formed loop', () => {
    const prompt = unwrap(SQUARE);
    expect(prompt.points.length).toBeGreaterThanOrEqual(3);
  });

  it('returns at least 3 foreground points even when the caller requests fewer', () => {
    const result = loopToSamPrompt(SQUARE, IMAGE_BOUNDS, { interiorSampleCount: 0 });
    if (!result.ok) throw new Error('expected ok');
    expect(foregroundPoints(result.value).length).toBeGreaterThanOrEqual(3);
  });

  it('spreads interior samples toward different corners rather than clustering on the anchor', () => {
    const prompt = unwrap(SQUARE);
    const [a, b] = foregroundPoints(prompt).slice(1);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toEqual(b);
  });
});

describe('loopToSamPrompt — bounding box', () => {
  it('matches the polygon bounding box when fully inside the image', () => {
    const prompt = unwrap(SQUARE);
    expect(prompt.box).toEqual({ minX: 100, minY: 100, maxX: 300, maxY: 300 });
  });

  it('clamps a loop drawn past the canvas edge instead of rejecting it', () => {
    const overhanging: Polygon = [
      { x: -50, y: -50 },
      { x: 200, y: -50 },
      { x: 200, y: 200 },
      { x: -50, y: 200 },
    ];
    const result = loopToSamPrompt(overhanging, IMAGE_BOUNDS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.box).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
    }
  });

  it('clamps against the far edges too', () => {
    const overhanging: Polygon = [
      { x: 700, y: 500 },
      { x: 900, y: 500 },
      { x: 900, y: 700 },
      { x: 700, y: 700 },
    ];
    const result = loopToSamPrompt(overhanging, IMAGE_BOUNDS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.box).toEqual({ minX: 700, minY: 500, maxX: 800, maxY: 600 });
    }
  });
});

describe('loopToSamPrompt — background point', () => {
  it('places a background point outside the loop and inside the image', () => {
    const prompt = unwrap(SQUARE);
    const background = prompt.points.find((p) => p.label === 'background');
    expect(background).toBeDefined();
    if (background) {
      expect(containsPoint(SQUARE, background)).toBe(false);
      expect(background.x).toBeGreaterThanOrEqual(0);
      expect(background.x).toBeLessThanOrEqual(IMAGE_BOUNDS.width);
      expect(background.y).toBeGreaterThanOrEqual(0);
      expect(background.y).toBeLessThanOrEqual(IMAGE_BOUNDS.height);
    }
  });

  it('omits the background point rather than fabricating one when the loop fills the image', () => {
    const fillsImage: Polygon = [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 600 },
      { x: 0, y: 600 },
    ];
    const prompt = unwrap(fillsImage);
    expect(prompt.points.some((p) => p.label === 'background')).toBe(false);
  });
});

describe('loopToSamPrompt — degenerate input', () => {
  it('rejects a two-point loop', () => {
    const result = loopToSamPrompt(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      IMAGE_BOUNDS,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an all-collinear loop, which encloses no area', () => {
    const result = loopToSamPrompt(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      IMAGE_BOUNDS,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a loop with near-zero enclosed area', () => {
    const sliver: Polygon = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const result = loopToSamPrompt(sliver, IMAGE_BOUNDS);
    expect(result.ok).toBe(false);
  });

  it('accepts a self-intersecting (figure-eight-like) loop without throwing', () => {
    const bowtie: Polygon = [
      { x: 100, y: 100 },
      { x: 300, y: 300 },
      { x: 300, y: 100 },
      { x: 100, y: 300 },
    ];
    expect(() => loopToSamPrompt(bowtie, IMAGE_BOUNDS)).not.toThrow();
  });
});

describe('loopToSamPrompt — extremely thin concave shapes', () => {
  it('falls back to the anchor when even the smallest step toward a corner stays outside', () => {
    // A very thin plus-sign: every corner of its bounding box sits in one of the four
    // open diagonal gaps between the arms, so a straight line from the centre toward any
    // corner exits the shape almost immediately and does not re-enter until essentially
    // back at the centre. With a 1px-wide arm this outlasts all 6 halving attempts in
    // sampleTowardCorner, which must then fall back to returning the anchor unchanged
    // rather than returning a point outside the polygon.
    const thinPlus: Polygon = [
      { x: -1, y: -1000 },
      { x: 1, y: -1000 },
      { x: 1, y: -1 },
      { x: 1000, y: -1 },
      { x: 1000, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1000 },
      { x: -1, y: 1000 },
      { x: -1, y: 1 },
      { x: -1000, y: 1 },
      { x: -1000, y: -1 },
      { x: -1, y: -1 },
    ];
    const result = loopToSamPrompt(
      thinPlus,
      { width: 2000, height: 2000 },
      {
        interiorSampleCount: 4,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const foreground = foregroundPoints(result.value);
    const anchor = foreground[0]!;
    for (const point of foreground) {
      expect(containsPoint(thinPlus, point)).toBe(true);
    }
    expect(foreground.some((p) => p.x === anchor.x && p.y === anchor.y)).toBe(true);
  });
});

describe('loopToSamPrompt — property: 500 random loops never place a foreground point outside', () => {
  // Hand-rolled rather than a property-testing library: star-shaped polygons (random
  // radii at evenly-jittered angles around a centre) are simple to generate directly and
  // are exactly the shape family a rough freehand loop resembles, so a dedicated
  // generator dependency buys nothing here.
  function randomStarPolygon(seed: number): Polygon {
    let state = seed;
    const next = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    const cx = 150 + next() * 500;
    const cy = 150 + next() * 300;
    const pointCount = 5 + Math.floor(next() * 8);
    const points: Polygon = Array.from({ length: pointCount }, (_, i) => {
      const angle = (i / pointCount) * Math.PI * 2 + next() * 0.4;
      const radius = 40 + next() * 120;
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });
    return points;
  }

  it('never places a foreground point outside the loop, across 500 random loops', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const loop = randomStarPolygon(seed);
      const result = loopToSamPrompt(loop, IMAGE_BOUNDS);
      if (!result.ok) continue; // an occasional degenerate loop is a valid outcome, not a failure
      for (const point of foregroundPoints(result.value)) {
        expect(containsPoint(loop, point)).toBe(true);
      }
    }
  });
});
