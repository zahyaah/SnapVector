/**
 * SAM/MobileSAM's fixed operating resolution: images are always resized so their longest
 * edge is exactly this many pixels before reaching the encoder. See
 * docs/model-signature.md for how this was verified against the actual ONNX graph.
 */
export const ENCODER_INPUT_SIZE = 1024;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The scale factor SAM's `ResizeLongestSide` transform applies. Unlike
 * `capLongestEdge` in lib/geometry/viewport.ts (which only ever shrinks, for display
 * purposes), this always scales to hit the target exactly, upscaling a smaller image if
 * needed — the model operates at a fixed resolution regardless of the source's native
 * size.
 */
export function encoderResizeScale(
  sourceSize: Size,
  targetLongestEdge: number = ENCODER_INPUT_SIZE,
): number {
  return targetLongestEdge / Math.max(sourceSize.width, sourceSize.height);
}

export function encoderInputSize(
  sourceSize: Size,
  targetLongestEdge: number = ENCODER_INPUT_SIZE,
): Size {
  const scale = encoderResizeScale(sourceSize, targetLongestEdge);
  return {
    width: Math.max(1, Math.round(sourceSize.width * scale)),
    height: Math.max(1, Math.round(sourceSize.height * scale)),
  };
}

/**
 * Original-image pixel coordinates to the encoder's resized coordinate space, matching
 * Meta's `predictor.transform.apply_coords` (see docs/model-signature.md). A pure scale
 * with no offset term: the ONNX graph pads the resized image to a square on the
 * bottom-right only, never centering it, so there is no letterbox offset to correct for
 * — a centered letterbox would need one here.
 */
export function toModelSpace(
  point: Point,
  sourceSize: Size,
  targetLongestEdge: number = ENCODER_INPUT_SIZE,
): Point {
  const scale = encoderResizeScale(sourceSize, targetLongestEdge);
  return { x: point.x * scale, y: point.y * scale };
}

export function toImageSpace(
  point: Point,
  sourceSize: Size,
  targetLongestEdge: number = ENCODER_INPUT_SIZE,
): Point {
  const scale = encoderResizeScale(sourceSize, targetLongestEdge);
  return { x: point.x / scale, y: point.y / scale };
}

export interface PixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface EncoderTensor {
  readonly data: Float32Array;
  readonly dims: readonly [number, number, number];
}

/**
 * RGBA pixels (as canvas ImageData stores them) to the HWC float32 RGB layout
 * `input_image` expects (docs/model-signature.md). Raw 0-255 values, deliberately not
 * normalized — the ONNX graph normalizes internally, and doing it here too would
 * silently double-normalize every embedding.
 */
export function pixelsToEncoderTensor(pixels: PixelBuffer): EncoderTensor {
  const { width, height, data } = pixels;
  const out = new Float32Array(width * height * 3);

  for (let src = 0, dst = 0; src < data.length; src += 4, dst += 3) {
    out[dst] = data[src]!;
    out[dst + 1] = data[src + 1]!;
    out[dst + 2] = data[src + 2]!;
  }

  return { data: out, dims: [height, width, 3] };
}
