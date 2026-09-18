import { describe, expect, it } from 'vitest';

import {
  ENCODER_INPUT_SIZE,
  encoderInputSize,
  encoderResizeScale,
  pixelsToEncoderTensor,
  toImageSpace,
  toModelSpace,
} from './preprocess.js';

describe('encoderResizeScale', () => {
  it('scales a landscape image down so its longest edge is exactly 1024', () => {
    const scale = encoderResizeScale({ width: 2048, height: 1024 });
    expect(scale).toBeCloseTo(0.5, 10);
  });

  it('scales a portrait image using height as the longest edge', () => {
    const scale = encoderResizeScale({ width: 500, height: 2000 });
    expect(scale).toBeCloseTo(0.512, 3);
  });

  it('scales a smaller-than-target image UP, unlike the display-fitting logic', () => {
    // This is the key difference from viewport.ts's capLongestEdge, which never
    // upscales: SAM always operates at a fixed 1024 resolution regardless of the
    // source image's native size.
    const scale = encoderResizeScale({ width: 200, height: 100 });
    expect(scale).toBeCloseTo(5.12, 2);
  });

  it('is 1 for an image already exactly at the target size', () => {
    expect(encoderResizeScale({ width: 1024, height: 1024 })).toBe(1);
  });

  it('respects a custom target edge', () => {
    expect(encoderResizeScale({ width: 512, height: 256 }, 256)).toBe(0.5);
  });
});

describe('encoderInputSize', () => {
  it('produces exactly 1024 on the longest edge for a landscape image', () => {
    expect(encoderInputSize({ width: 2048, height: 1024 })).toEqual({
      width: ENCODER_INPUT_SIZE,
      height: 512,
    });
  });

  it('produces exactly 1024 on the longest edge for a portrait image', () => {
    const size = encoderInputSize({ width: 512, height: 1024 });
    expect(size.height).toBe(ENCODER_INPUT_SIZE);
    expect(size.width).toBe(512);
  });

  it('never collapses the short edge to zero for an extreme 10:1 aspect ratio', () => {
    const size = encoderInputSize({ width: 4000, height: 400 });
    expect(size.width).toBe(ENCODER_INPUT_SIZE);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it('never collapses the short edge to zero for an extreme 1:10 aspect ratio', () => {
    const size = encoderInputSize({ width: 400, height: 4000 });
    expect(size.height).toBe(ENCODER_INPUT_SIZE);
    expect(size.width).toBeGreaterThanOrEqual(1);
  });

  it('returns integer dimensions', () => {
    const size = encoderInputSize({ width: 777, height: 333 });
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});

describe('toModelSpace / toImageSpace', () => {
  const sourceSize = { width: 1600, height: 1200 };

  it('scales a point into the resized encoder space', () => {
    // scale = 1024 / 1600 = 0.64
    const modelPoint = toModelSpace({ x: 800, y: 600 }, sourceSize);
    expect(modelPoint.x).toBeCloseTo(512, 5);
    expect(modelPoint.y).toBeCloseTo(384, 5);
  });

  it('applies no offset, since the encoder pads bottom-right rather than centering', () => {
    // The origin (0,0) must map to (0,0) in both directions — a centered letterbox
    // would introduce an offset here; this graph's padding convention does not.
    expect(toModelSpace({ x: 0, y: 0 }, sourceSize)).toEqual({ x: 0, y: 0 });
    expect(toImageSpace({ x: 0, y: 0 }, sourceSize)).toEqual({ x: 0, y: 0 });
  });

  it('round-trips within 0.5px for a landscape image', () => {
    const original = { x: 234.5, y: 891.2 };
    const roundTripped = toImageSpace(toModelSpace(original, sourceSize), sourceSize);
    expect(Math.abs(roundTripped.x - original.x)).toBeLessThan(0.5);
    expect(Math.abs(roundTripped.y - original.y)).toBeLessThan(0.5);
  });

  it('round-trips within 0.5px for a portrait image', () => {
    const portraitSize = { width: 900, height: 1600 };
    const original = { x: 42.9, y: 1500.3 };
    const roundTripped = toImageSpace(toModelSpace(original, portraitSize), portraitSize);
    expect(Math.abs(roundTripped.x - original.x)).toBeLessThan(0.5);
    expect(Math.abs(roundTripped.y - original.y)).toBeLessThan(0.5);
  });

  it('round-trips within 0.5px for a square image', () => {
    const squareSize = { width: 1024, height: 1024 };
    const original = { x: 512, y: 512 };
    const roundTripped = toImageSpace(toModelSpace(original, squareSize), squareSize);
    expect(Math.abs(roundTripped.x - original.x)).toBeLessThan(0.5);
    expect(Math.abs(roundTripped.y - original.y)).toBeLessThan(0.5);
  });

  it('round-trips within 0.5px across 200 random points and sizes', () => {
    let state = 7;
    const next = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const size = { width: 50 + next() * 4000, height: 50 + next() * 4000 };
      const point = { x: next() * size.width, y: next() * size.height };
      const roundTripped = toImageSpace(toModelSpace(point, size), size);
      expect(Math.abs(roundTripped.x - point.x)).toBeLessThan(0.5);
      expect(Math.abs(roundTripped.y - point.y)).toBeLessThan(0.5);
    }
  });
});

describe('pixelsToEncoderTensor', () => {
  it('drops the alpha channel and produces HWC ordering', () => {
    // A 2x1 RGBA fixture: red pixel, then blue pixel.
    const pixels = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128]),
      width: 2,
      height: 1,
    };
    const tensor = pixelsToEncoderTensor(pixels);
    expect(Array.from(tensor.data)).toEqual([255, 0, 0, 0, 0, 255]);
    expect(tensor.dims).toEqual([1, 2, 3]);
  });

  it('preserves raw 0-255 pixel values without normalizing', () => {
    // docs/model-signature.md: normalization happens inside the ONNX graph. Doing it
    // here too would silently double-normalize every embedding.
    const pixels = {
      data: new Uint8ClampedArray([123, 45, 67, 255]),
      width: 1,
      height: 1,
    };
    const tensor = pixelsToEncoderTensor(pixels);
    expect(Array.from(tensor.data)).toEqual([123, 45, 67]);
  });

  it('handles a larger fixture without misaligning rows', () => {
    const width = 3;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = i * 10;
      data[i * 4 + 1] = i * 10 + 1;
      data[i * 4 + 2] = i * 10 + 2;
      data[i * 4 + 3] = 255;
    }
    const tensor = pixelsToEncoderTensor({ data, width, height });
    expect(tensor.dims).toEqual([height, width, 3]);
    expect(tensor.data.length).toBe(width * height * 3);
    // Spot-check the last pixel (index 5) landed at the expected offset.
    expect(Array.from(tensor.data.slice(15, 18))).toEqual([50, 51, 52]);
  });
});
