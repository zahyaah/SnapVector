import { sampleAverageColor, type PixelBuffer } from '../color/sample.js';
import { fillHoles, type BinaryMask } from '../mask/binary-mask.js';
import { postprocessMask } from '../mask/postprocess.js';
import { fitPolygon } from '../vectorize/bezier.js';
import { traceContours } from '../vectorize/contours.js';
import { buildPathData } from '../vectorize/path.js';
import { simplifyPolygon } from '../vectorize/simplify.js';
import { buildSvgDocument } from './document.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

// Both are pixel-space constants, deliberately not resolution-relative (ADR-0005: the
// simplification tolerance is "the single knob governing whether output reads as
// clean vector or traced blob", tuned once against real MobileSAM output rather than
// derived per-image). The hole-fill threshold only needs to be big enough to erase
// small thresholding-noise specks inside an otherwise solid region — a real,
// intentionally-donut-shaped selection is holed on a much larger scale than that and
// survives untouched.
const SIMPLIFY_TOLERANCE_PX = 1.5;
const MAX_NOISE_HOLE_SIZE_PX = 64;

/**
 * The full mask-to-SVG pipeline (`mask-postprocess` → `vectorize` → `svg-export`, per
 * SPEC's capability map), composed here as one pure function over plain data so it can
 * be unit-tested the same way every module it calls already is — no DOM, no canvas, no
 * model. Returns `null` for a mask with no surviving contour (e.g. the anchor point's
 * component was fully removed by smoothing) rather than emitting an empty document.
 */
export function buildResultSvg(
  mask: BinaryMask,
  anchor: Point,
  sourcePixels: PixelBuffer,
): string | null {
  const filled = fillHoles(mask, MAX_NOISE_HOLE_SIZE_PX);
  const cleaned = postprocessMask(filled, anchor);

  const curves = traceContours(cleaned).map((polygon) =>
    fitPolygon(simplifyPolygon(polygon, SIMPLIFY_TOLERANCE_PX), SIMPLIFY_TOLERANCE_PX),
  );
  const pathData = buildPathData(curves);
  if (pathData === '') return null;

  const fillColor = sampleAverageColor(sourcePixels, cleaned);
  return buildSvgDocument({
    width: cleaned.width,
    height: cleaned.height,
    pathData,
    fillColor,
  });
}
