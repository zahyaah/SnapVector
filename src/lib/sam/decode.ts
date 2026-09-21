import * as ort from 'onnxruntime-web/wasm';

import type { SamPrompt } from '../geometry/prompt.js';
import { toModelSpace, type EncoderTensor, type Size } from './preprocess.js';

/**
 * The minimal contract this module needs from an ONNX session — just `run()`. Depending
 * on this instead of the full `ort.InferenceSession` class means a test fixture is a
 * plain object literal, not a mock of a large class. A real `ort.InferenceSession` (from
 * session.ts) satisfies this structurally; the real model is still never loaded in unit
 * tests (SPEC §7) because nothing here ever constructs one.
 */
export interface RunnableSession {
  run(feeds: Record<string, ort.Tensor>): Promise<Record<string, ort.Tensor>>;
}

export interface BinaryMaskResult {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** The decoder's own confidence estimate for this mask. */
  readonly iou: number;
}

// SAM's own convention: the mask is wherever the logit is positive (sigmoid(0) = 0.5).
const MASK_LOGIT_THRESHOLD = 0;

// No iterative mask refinement in v1 (SPEC doesn't call for it) — always a blank prior.
const LOW_RES_MASK_SIZE = 256;

export async function runEncoder(
  session: RunnableSession,
  input: EncoderTensor | ort.Tensor,
): Promise<ort.Tensor> {
  const tensor =
    input instanceof ort.Tensor ? input : new ort.Tensor('float32', input.data, input.dims);
  const outputs = await session.run({ input_image: tensor });
  const embedding = outputs.image_embeddings;
  if (!embedding) {
    throw new Error('Encoder session did not return an image_embeddings output');
  }
  return embedding;
}

/**
 * Builds the decoder's input tensors from a SamPrompt. The box is not a separate ONNX
 * input — per docs/model-signature.md, its two corners are appended to
 * point_coords/point_labels with labels 2 (top-left) and 3 (bottom-right), the same
 * convention Meta's own SAM ONNX decoder uses. Every point (prompt points and box
 * corners alike) goes through the identical toModelSpace scale used to resize the image
 * for the encoder — a mismatch here would silently misplace the prompt the same way an
 * error in T6's polygon math would.
 */
export function buildDecoderInputs(
  prompt: SamPrompt,
  sourceSize: Size,
  embedding: ort.Tensor,
): Record<string, ort.Tensor> {
  const points = [
    ...prompt.points.map((p) => ({
      x: p.x,
      y: p.y,
      label: p.label === 'foreground' ? 1 : 0,
    })),
    { x: prompt.box.minX, y: prompt.box.minY, label: 2 },
    { x: prompt.box.maxX, y: prompt.box.maxY, label: 3 },
  ];

  const coordsData = new Float32Array(points.length * 2);
  const labelsData = new Float32Array(points.length);
  points.forEach((point, i) => {
    const scaled = toModelSpace(point, sourceSize);
    coordsData[i * 2] = scaled.x;
    coordsData[i * 2 + 1] = scaled.y;
    labelsData[i] = point.label;
  });

  return {
    image_embeddings: embedding,
    point_coords: new ort.Tensor('float32', coordsData, [1, points.length, 2]),
    point_labels: new ort.Tensor('float32', labelsData, [1, points.length]),
    mask_input: new ort.Tensor(
      'float32',
      new Float32Array(LOW_RES_MASK_SIZE * LOW_RES_MASK_SIZE),
      [1, 1, LOW_RES_MASK_SIZE, LOW_RES_MASK_SIZE],
    ),
    has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
    // [height, width], matching Meta's `image.shape[:2]` convention — see
    // docs/model-signature.md. The graph uses this to upscale `masks` back to the
    // original resolution itself; we never resample the output ourselves.
    orig_im_size: new ort.Tensor(
      'float32',
      new Float32Array([sourceSize.height, sourceSize.width]),
      [2],
    ),
  };
}

/**
 * Thresholds the decoder's mask logits into a binary mask. No resampling to source
 * dimensions happens here — the decoder already resizes `masks` to orig_im_size
 * internally (verified against the real model in docs/model-signature.md), so this
 * output already matches the source image's pixel dimensions.
 */
export function logitsToBinaryMask(
  masks: ort.Tensor,
  iouPredictions: ort.Tensor,
): BinaryMaskResult {
  const height = masks.dims[2]!;
  const width = masks.dims[3]!;
  const logits = masks.data as ort.Tensor.DataTypeMap['float32'];

  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = logits[i]! > MASK_LOGIT_THRESHOLD ? 1 : 0;
  }

  const iou = (iouPredictions.data as ort.Tensor.DataTypeMap['float32'])[0] ?? 0;
  return { data, width, height, iou };
}

export async function runDecoder(
  session: RunnableSession,
  embedding: ort.Tensor,
  prompt: SamPrompt,
  sourceSize: Size,
): Promise<BinaryMaskResult> {
  const inputs = buildDecoderInputs(prompt, sourceSize, embedding);
  const outputs = await session.run(inputs);
  const masks = outputs.masks;
  const iouPredictions = outputs.iou_predictions;
  if (!masks || !iouPredictions) {
    throw new Error('Decoder session did not return masks and iou_predictions outputs');
  }
  return logitsToBinaryMask(masks, iouPredictions);
}
