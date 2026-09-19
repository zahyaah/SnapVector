import {
  backingStoreSize,
  capLongestEdge,
  clientToSourcePoint,
  fitWithin,
  type Point,
  type Size,
} from '../lib/geometry/viewport.js';
import type { BinaryMaskResult } from '../lib/sam/decode.js';
import type { PixelBuffer } from '../lib/sam/preprocess.js';

const MAX_SOURCE_EDGE = 2048;
const MAX_STAGE_HEIGHT_PX = 620;

// Translucent teal, distinct from every pen-palette hue (stroke.ts) so the mask preview
// is never mistaken for the loop the user is drawing.
const MASK_FILL_RGB: readonly [number, number, number] = [58, 166, 154];
const MASK_FILL_ALPHA = 130;

export interface Stage {
  readonly overlayCanvas: HTMLCanvasElement;
  readonly sourceSize: Size | null;
  setImage(bitmap: ImageBitmap): void;
  clear(): void;
  clientToSource(clientX: number, clientY: number): Point | null;
  readSourcePixels(): ImageData | null;
  /** Draws the source image resized to `targetSize` and reads it back as a plain pixel
   * buffer — this is what the encoder's preprocessing (preprocess.ts) expects. Kept on
   * Stage because only Stage holds a reference to the private source canvas. */
  readResizedSourcePixels(targetSize: Size): PixelBuffer | null;
  /** Renders a binary mask (at source-image resolution) as a translucent overlay, or
   * clears it when passed null. Lives on its own canvas layer, separate from the stroke
   * overlay, so a redraw of one never has to know about the other. */
  setMaskPreview(mask: BinaryMaskResult | null): void;
  onViewportChange(listener: () => void): void;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D canvas context unavailable');
  return context;
}

export function createStage(root: HTMLElement): Stage {
  const layers = root.querySelector<HTMLElement>('.stage__layers');
  const displayCanvas = root.querySelector<HTMLCanvasElement>('.stage__canvas--source');
  const maskCanvas = root.querySelector<HTMLCanvasElement>('.stage__canvas--mask');
  const overlayCanvas = root.querySelector<HTMLCanvasElement>('.stage__canvas--overlay');
  if (
    layers === null ||
    displayCanvas === null ||
    maskCanvas === null ||
    overlayCanvas === null
  ) {
    throw new Error('Stage markup is missing its canvas layers');
  }

  // The model reads this canvas, never the display, mask, or overlay ones. Keeping the
  // source pixels on a detached canvas at their own resolution makes that separation
  // structural rather than a convention someone has to remember: nothing else has a
  // path to it.
  const sourceCanvas = document.createElement('canvas');

  let sourceSize: Size | null = null;
  let bitmap: ImageBitmap | null = null;
  const viewportListeners: (() => void)[] = [];
  let latestMask: BinaryMaskResult | null = null;

  const paintMaskLayer = (): void => {
    const ctx = context2d(maskCanvas);
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    if (latestMask === null) return;

    // Built at the mask's own (source) resolution, then scaled onto the display-sized
    // canvas in one drawImage call — cheaper than per-pixel scaling, and canvas
    // upscaling is exactly what we want here since the mask is a low-frequency shape.
    const off = document.createElement('canvas');
    off.width = latestMask.width;
    off.height = latestMask.height;
    const offCtx = context2d(off);
    const painted = offCtx.createImageData(latestMask.width, latestMask.height);
    const [r, g, b] = MASK_FILL_RGB;
    for (let i = 0; i < latestMask.data.length; i++) {
      const on = latestMask.data[i] === 1;
      painted.data[i * 4] = r;
      painted.data[i * 4 + 1] = g;
      painted.data[i * 4 + 2] = b;
      painted.data[i * 4 + 3] = on ? MASK_FILL_ALPHA : 0;
    }
    offCtx.putImageData(painted, 0, 0);
    ctx.drawImage(off, 0, 0, maskCanvas.width, maskCanvas.height);
  };

  const layoutLayers = (): void => {
    if (sourceSize === null) return;

    const available = {
      width: root.clientWidth,
      height: Math.min(MAX_STAGE_HEIGHT_PX, globalThis.innerHeight * 0.7),
    };
    const displaySize = fitWithin(sourceSize, available);
    const backing = backingStoreSize(displaySize, globalThis.devicePixelRatio);

    for (const canvas of [displayCanvas, maskCanvas, overlayCanvas]) {
      canvas.width = backing.width;
      canvas.height = backing.height;
      canvas.style.width = `${String(displaySize.width)}px`;
      canvas.style.height = `${String(displaySize.height)}px`;
    }
    layers.style.width = `${String(displaySize.width)}px`;
    layers.style.height = `${String(displaySize.height)}px`;

    context2d(displayCanvas).drawImage(sourceCanvas, 0, 0, backing.width, backing.height);
    paintMaskLayer();
    for (const listener of viewportListeners) listener();
  };

  const observer = new ResizeObserver(() => {
    layoutLayers();
  });
  observer.observe(root);

  return {
    overlayCanvas,

    get sourceSize(): Size | null {
      return sourceSize;
    },

    setImage(next: ImageBitmap): void {
      bitmap?.close();
      bitmap = next;
      sourceSize = capLongestEdge({ width: next.width, height: next.height }, MAX_SOURCE_EDGE);
      latestMask = null;

      sourceCanvas.width = sourceSize.width;
      sourceCanvas.height = sourceSize.height;
      context2d(sourceCanvas).drawImage(next, 0, 0, sourceSize.width, sourceSize.height);

      root.dataset.state = 'loaded';
      layers.hidden = false;
      layoutLayers();
    },

    clear(): void {
      bitmap?.close();
      bitmap = null;
      sourceSize = null;
      latestMask = null;
      root.dataset.state = 'empty';
      layers.hidden = true;
      context2d(overlayCanvas).clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      context2d(maskCanvas).clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    },

    clientToSource(clientX: number, clientY: number): Point | null {
      if (sourceSize === null) return null;
      return clientToSourcePoint(
        { x: clientX, y: clientY },
        overlayCanvas.getBoundingClientRect(),
        sourceSize,
      );
    },

    readSourcePixels(): ImageData | null {
      if (sourceSize === null) return null;
      return context2d(sourceCanvas).getImageData(0, 0, sourceSize.width, sourceSize.height);
    },

    readResizedSourcePixels(targetSize: Size): PixelBuffer | null {
      if (sourceSize === null) return null;
      const resized = document.createElement('canvas');
      resized.width = targetSize.width;
      resized.height = targetSize.height;
      const ctx = context2d(resized);
      ctx.drawImage(sourceCanvas, 0, 0, targetSize.width, targetSize.height);
      const imageData = ctx.getImageData(0, 0, targetSize.width, targetSize.height);
      return { data: imageData.data, width: targetSize.width, height: targetSize.height };
    },

    setMaskPreview(mask: BinaryMaskResult | null): void {
      latestMask = mask;
      paintMaskLayer();
    },

    onViewportChange(listener: () => void): void {
      viewportListeners.push(listener);
    },
  };
}
