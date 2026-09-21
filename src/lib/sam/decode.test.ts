import * as ort from 'onnxruntime-web/wasm';
import { describe, expect, it } from 'vitest';

import type { SamPrompt } from '../geometry/prompt.js';
import {
  buildDecoderInputs,
  logitsToBinaryMask,
  runDecoder,
  runEncoder,
  type RunnableSession,
} from './decode.js';

const SOURCE_SIZE = { width: 1600, height: 1200 };

const PROMPT: SamPrompt = {
  points: [
    { x: 800, y: 600, label: 'foreground' },
    { x: 700, y: 500, label: 'foreground' },
    { x: 50, y: 50, label: 'background' },
  ],
  box: { minX: 400, minY: 300, maxX: 1200, maxY: 900 },
};

function fakeEmbedding(): ort.Tensor {
  return new ort.Tensor('float32', new Float32Array(256 * 64 * 64), [1, 256, 64, 64]);
}

describe('buildDecoderInputs', () => {
  const embedding = fakeEmbedding();
  const inputs = buildDecoderInputs(PROMPT, SOURCE_SIZE, embedding);

  it('passes the embedding through unchanged', () => {
    expect(inputs.image_embeddings).toBe(embedding);
  });

  it('appends the box as two extra points, per docs/model-signature.md', () => {
    // 3 prompt points + 2 box corners = 5 total.
    expect(inputs.point_coords?.dims).toEqual([1, 5, 2]);
    expect(inputs.point_labels?.dims).toEqual([1, 5]);
  });

  it('labels foreground=1, background=0, box top-left=2, box bottom-right=3', () => {
    const labels = Array.from(inputs.point_labels?.data as Float32Array);
    expect(labels).toEqual([1, 1, 0, 2, 3]);
  });

  it('scales every point through the same toModelSpace transform as the image', () => {
    // scale = 1024 / 1600 = 0.64
    const coords = Array.from(inputs.point_coords?.data as Float32Array);
    expect(coords[0]).toBeCloseTo(800 * 0.64, 5); // first foreground point x
    expect(coords[1]).toBeCloseTo(600 * 0.64, 5); // first foreground point y
    expect(coords[6]).toBeCloseTo(400 * 0.64, 5); // box top-left x (5th point, index 3)
    expect(coords[7]).toBeCloseTo(300 * 0.64, 5); // box top-left y
    expect(coords[8]).toBeCloseTo(1200 * 0.64, 5); // box bottom-right x (6th point, index 4)
    expect(coords[9]).toBeCloseTo(900 * 0.64, 5); // box bottom-right y
  });

  it('sends an all-zero mask_input and has_mask_input=0 (no iterative refinement in v1)', () => {
    expect(inputs.mask_input?.dims).toEqual([1, 1, 256, 256]);
    expect(Array.from(inputs.mask_input?.data as Float32Array).every((v) => v === 0)).toBe(
      true,
    );
    expect(Array.from(inputs.has_mask_input?.data as Float32Array)).toEqual([0]);
  });

  it('sends orig_im_size as [height, width], matching image.shape[:2] convention', () => {
    expect(Array.from(inputs.orig_im_size?.data as Float32Array)).toEqual([1200, 1600]);
  });
});

describe('logitsToBinaryMask', () => {
  it('thresholds logits at 0: positive becomes 1, non-positive becomes 0', () => {
    const masks = new ort.Tensor(
      'float32',
      new Float32Array([2.5, -1.0, 0, 0.001, -0.001]),
      [1, 1, 1, 5],
    );
    const iou = new ort.Tensor('float32', new Float32Array([0.87]), [1, 1]);
    const result = logitsToBinaryMask(masks, iou);
    expect(Array.from(result.data)).toEqual([1, 0, 0, 1, 0]);
  });

  it('reads width and height from dims without swapping them', () => {
    const masks = new ort.Tensor('float32', new Float32Array(3 * 7), [1, 1, 3, 7]);
    const iou = new ort.Tensor('float32', new Float32Array([0.5]), [1, 1]);
    const result = logitsToBinaryMask(masks, iou);
    expect(result.height).toBe(3);
    expect(result.width).toBe(7);
    expect(result.data.length).toBe(21);
  });

  it('extracts the IoU confidence value', () => {
    const masks = new ort.Tensor('float32', new Float32Array([1]), [1, 1, 1, 1]);
    const iou = new ort.Tensor('float32', new Float32Array([0.734]), [1, 1]);
    expect(logitsToBinaryMask(masks, iou).iou).toBeCloseTo(0.734, 5);
  });
});

describe('runEncoder', () => {
  it('calls the encoder session with input_image and returns image_embeddings', async () => {
    const embedding = fakeEmbedding();
    const calls: Record<string, ort.Tensor>[] = [];
    const fakeSession: RunnableSession = {
      run: (feeds) => {
        calls.push(feeds);
        return Promise.resolve({ image_embeddings: embedding });
      },
    };

    const inputTensor = new ort.Tensor('float32', new Float32Array(4 * 4 * 3), [4, 4, 3]);
    const result = await runEncoder(fakeSession, inputTensor);

    expect(result).toBe(embedding);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input_image).toBe(inputTensor);
  });

  it('throws a clear error if the session does not return image_embeddings', async () => {
    const fakeSession: RunnableSession = { run: () => Promise.resolve({}) };
    const inputTensor = new ort.Tensor('float32', new Float32Array(3), [1, 1, 3]);
    await expect(runEncoder(fakeSession, inputTensor)).rejects.toThrow(/image_embeddings/);
  });
});

describe('runDecoder', () => {
  it('runs the decoder session and thresholds its output into a binary mask', async () => {
    const masks = new ort.Tensor('float32', new Float32Array([1, -1, 1, -1]), [1, 1, 2, 2]);
    const iou = new ort.Tensor('float32', new Float32Array([0.9]), [1, 1]);
    const fakeSession: RunnableSession = {
      run: () => Promise.resolve({ masks, iou_predictions: iou }),
    };

    const result = await runDecoder(fakeSession, fakeEmbedding(), PROMPT, SOURCE_SIZE);
    expect(Array.from(result.data)).toEqual([1, 0, 1, 0]);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.iou).toBeCloseTo(0.9, 5);
  });

  it('throws a clear error if the session does not return masks or iou_predictions', async () => {
    const fakeSession: RunnableSession = { run: () => Promise.resolve({}) };
    await expect(runDecoder(fakeSession, fakeEmbedding(), PROMPT, SOURCE_SIZE)).rejects.toThrow(
      /masks|iou/,
    );
  });
});
