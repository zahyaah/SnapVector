import {
  backingStoreSize,
  capLongestEdge,
  clientToSourcePoint,
  fitWithin,
  type Point,
  type Size,
} from '../lib/geometry/viewport.js';

const MAX_SOURCE_EDGE = 2048;
const MAX_STAGE_HEIGHT_PX = 620;

export interface Stage {
  readonly overlayCanvas: HTMLCanvasElement;
  readonly sourceSize: Size | null;
  setImage(bitmap: ImageBitmap): void;
  clear(): void;
  clientToSource(clientX: number, clientY: number): Point | null;
  readSourcePixels(): ImageData | null;
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
  const overlayCanvas = root.querySelector<HTMLCanvasElement>('.stage__canvas--overlay');
  if (layers === null || displayCanvas === null || overlayCanvas === null) {
    throw new Error('Stage markup is missing its canvas layers');
  }

  // The model reads this canvas, never the display or overlay ones. Keeping the source
  // pixels on a detached canvas at their own resolution makes that separation structural
  // rather than a convention someone has to remember: the overlay has no path to it.
  const sourceCanvas = document.createElement('canvas');

  let sourceSize: Size | null = null;
  let bitmap: ImageBitmap | null = null;
  const viewportListeners: (() => void)[] = [];

  const layoutLayers = (): void => {
    if (sourceSize === null) return;

    const available = {
      width: root.clientWidth,
      height: Math.min(MAX_STAGE_HEIGHT_PX, globalThis.innerHeight * 0.7),
    };
    const displaySize = fitWithin(sourceSize, available);
    const backing = backingStoreSize(displaySize, globalThis.devicePixelRatio);

    for (const canvas of [displayCanvas, overlayCanvas]) {
      canvas.width = backing.width;
      canvas.height = backing.height;
      canvas.style.width = `${String(displaySize.width)}px`;
      canvas.style.height = `${String(displaySize.height)}px`;
    }
    layers.style.width = `${String(displaySize.width)}px`;
    layers.style.height = `${String(displaySize.height)}px`;

    context2d(displayCanvas).drawImage(sourceCanvas, 0, 0, backing.width, backing.height);
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
      root.dataset.state = 'empty';
      layers.hidden = true;
      context2d(overlayCanvas).clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
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

    onViewportChange(listener: () => void): void {
      viewportListeners.push(listener);
    },
  };
}
