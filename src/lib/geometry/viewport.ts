export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function wholePixels(value: number): number {
  return Math.max(1, Math.round(value));
}

export function capLongestEdge(size: Size, maxEdge: number): Size {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return size;

  const scale = maxEdge / longest;
  return {
    width: wholePixels(size.width * scale),
    height: wholePixels(size.height * scale),
  };
}

/**
 * Largest size preserving aspect ratio that fits inside `bounds`. Small images are scaled
 * up rather than left tiny: display resolution is independent of what the model reads, so
 * a slightly soft preview costs nothing in mask quality but makes the loop far easier to
 * draw accurately.
 */
export function fitWithin(source: Size, bounds: Size): Size {
  const scale = Math.min(bounds.width / source.width, bounds.height / source.height);
  if (!Number.isFinite(scale) || scale <= 0) return { width: 1, height: 1 };

  return {
    width: wholePixels(source.width * scale),
    height: wholePixels(source.height * scale),
  };
}

export function backingStoreSize(cssSize: Size, devicePixelRatio: number): Size {
  return {
    width: wholePixels(cssSize.width * devicePixelRatio),
    height: wholePixels(cssSize.height * devicePixelRatio),
  };
}

/**
 * Pointer position to source-image pixel coordinates. Intentionally unclamped — a stroke
 * dragged past the canvas edge is legitimate input, and the prompt stage decides how to
 * handle it. Clamping here would flatten the stroke against the border instead.
 */
export function clientToSourcePoint(client: Point, rect: Rect, source: Size): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };

  return {
    x: ((client.x - rect.left) / rect.width) * source.width,
    y: ((client.y - rect.top) / rect.height) * source.height,
  };
}
