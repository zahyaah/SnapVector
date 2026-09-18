import { decimatePoints, nextPenIndex, PEN_PALETTE } from '../lib/geometry/stroke.js';
import type { Point, Polygon } from '../lib/geometry/loop.js';
import type { SamPrompt } from '../lib/geometry/prompt.js';
import type { Stage } from './stage.js';

// Pointermove can fire faster than the loop's actual shape needs; 3 source-image pixels
// between kept points is fine enough to preserve a hand-drawn outline's detail while
// keeping the eventual polygon a few hundred points instead of a few thousand.
const MIN_POINT_SPACING = 3;

export interface StrokeOverlay {
  readonly canvas: HTMLCanvasElement;
  clear(): void;
  undo(): void;
  cyclePenColor(): void;
  /** Draws the derived SAM prompt (bbox + points) on top of the loop, or clears it when
   * passed null. Lives on the render loop here rather than a separate canvas layer, so
   * it redraws automatically on every viewport change without a second listener. */
  setDebugPrompt(prompt: SamPrompt | null): void;
  onLoopComplete(listener: (loop: Polygon) => void): void;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D canvas context unavailable');
  return context;
}

function haloColor(canvas: HTMLCanvasElement): string {
  return getComputedStyle(canvas).getPropertyValue('--stroke-halo').trim();
}

export function createStrokeOverlay(stage: Stage, penSwatch?: HTMLElement): StrokeOverlay {
  const canvas = stage.overlayCanvas;
  const context = context2d(canvas);

  let penIndex = 0;
  let liveStroke: Point[] = [];
  let completedLoop: Polygon | null = null;
  let drawing = false;
  let debugPrompt: SamPrompt | null = null;
  const listeners: ((loop: Polygon) => void)[] = [];

  const currentPenColor = (): string => PEN_PALETTE[penIndex % PEN_PALETTE.length]!;

  const updateSwatch = (): void => {
    if (penSwatch) penSwatch.style.setProperty('--pen-color', currentPenColor());
  };
  updateSwatch();

  const toDisplayPoint = (source: Point): Point => {
    const size = stage.sourceSize;
    if (size === null) return source;
    return {
      x: (source.x / size.width) * canvas.width,
      y: (source.y / size.height) * canvas.height,
    };
  };

  const strokePath = (points: readonly Point[], close: boolean): void => {
    if (points.length < 2) return;
    context.beginPath();
    const first = toDisplayPoint(points[0]!);
    context.moveTo(first.x, first.y);
    for (const point of points.slice(1)) {
      const p = toDisplayPoint(point);
      context.lineTo(p.x, p.y);
    }
    if (close) context.closePath();
  };

  // Drawn as two passes over the same path — a wide halo stroke first, then the thinner
  // pen colour on top — rather than a CSS drop-shadow filter, since a canvas filter's
  // blur softens the pen line itself; this keeps the pen edge crisp while the halo still
  // reads as a solid outline against any background.
  const render = (): void => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = canvas.width / canvas.clientWidth || 1;

    const draw = (points: readonly Point[], close: boolean): void => {
      if (points.length < 2) return;
      context.lineJoin = 'round';
      context.lineCap = 'round';

      strokePath(points, close);
      context.strokeStyle = haloColor(canvas);
      context.lineWidth = 5 * dpr;
      context.stroke();

      strokePath(points, close);
      context.strokeStyle = currentPenColor();
      context.lineWidth = 2.5 * dpr;
      context.stroke();
    };

    if (completedLoop) draw(completedLoop, true);
    draw(liveStroke, false);
    if (debugPrompt) drawDebugPrompt(debugPrompt);
  };

  // Rendered in a fixed lime/amber pair regardless of the active pen colour or theme —
  // this is a developer-facing diagnostic (T8), not a themed UI element, so it stays
  // visually distinct from the pen palette on purpose rather than trying to match it.
  const drawDebugPrompt = (prompt: SamPrompt): void => {
    const dpr = canvas.width / canvas.clientWidth || 1;
    const topLeft = toDisplayPoint({ x: prompt.box.minX, y: prompt.box.minY });
    const bottomRight = toDisplayPoint({ x: prompt.box.maxX, y: prompt.box.maxY });

    context.save();
    context.setLineDash([6 * dpr, 4 * dpr]);
    context.strokeStyle = '#39ff88';
    context.lineWidth = 1.5 * dpr;
    context.strokeRect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y,
    );
    context.restore();

    for (const point of prompt.points) {
      const p = toDisplayPoint(point);
      context.beginPath();
      context.arc(p.x, p.y, 4 * dpr, 0, Math.PI * 2);
      context.fillStyle = point.label === 'foreground' ? '#39ff88' : '#ff5e5e';
      context.fill();
      context.lineWidth = 1 * dpr;
      context.strokeStyle = '#0e201e';
      context.stroke();
    }
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (stage.sourceSize === null) return;
    const point = stage.clientToSource(event.clientX, event.clientY);
    if (point === null) return;

    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    completedLoop = null;
    liveStroke = [point];
    render();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const point = stage.clientToSource(event.clientX, event.clientY);
    if (point === null) return;

    liveStroke.push(point);
    render();
  });

  const finishStroke = (event: PointerEvent): void => {
    if (!drawing) return;
    drawing = false;
    canvas.releasePointerCapture(event.pointerId);

    // Fewer than 3 points can't enclose an area — treat it as an accidental tap rather
    // than a loop, so a stray click doesn't produce a degenerate "selection".
    const decimated = decimatePoints(liveStroke, MIN_POINT_SPACING);
    liveStroke = [];
    if (decimated.length < 3) {
      completedLoop = null;
      render();
      return;
    }

    completedLoop = decimated;
    render();
    for (const listener of listeners) listener(decimated);
  };

  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);

  stage.onViewportChange(() => {
    render();
  });

  return {
    canvas,

    clear(): void {
      drawing = false;
      liveStroke = [];
      completedLoop = null;
      debugPrompt = null;
      render();
    },

    undo(): void {
      if (drawing) {
        liveStroke.pop();
      } else {
        completedLoop = null;
        debugPrompt = null;
      }
      render();
    },

    setDebugPrompt(prompt: SamPrompt | null): void {
      debugPrompt = prompt;
      render();
    },

    cyclePenColor(): void {
      penIndex = nextPenIndex(penIndex);
      updateSwatch();
      render();
    },

    onLoopComplete(listener: (loop: Polygon) => void): void {
      listeners.push(listener);
    },
  };
}
