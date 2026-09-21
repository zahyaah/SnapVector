import type { RgbColor } from '../color/sample.js';

export interface SvgDocumentOptions {
  readonly width: number;
  readonly height: number;
  readonly pathData: string;
  readonly fillColor: RgbColor;
}

function assertInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`buildSvgDocument: ${label} is out of range: ${String(value)}`);
  }
}

// Every path-data command this pipeline ever emits (path.ts) is built from digits,
// separators, and M/C/Z — so anything else appearing here, including the literal
// strings "NaN" or "Infinity" that a non-finite coordinate would print, means a
// non-finite value or foreign markup slipped through upstream and must not reach a
// downloaded file.
const SAFE_PATH_DATA_PATTERN = /^[MCZ0-9.,\s-]*$/;

function assertSafePathData(pathData: string): void {
  if (!SAFE_PATH_DATA_PATTERN.test(pathData)) {
    throw new Error(
      'buildSvgDocument: pathData contains characters outside the M/C/Z command set',
    );
  }
}

function toHexChannel(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

function toHexColor(color: RgbColor): string {
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
}

/**
 * Assembles the final downloadable SVG document: a fixed `<svg><path/></svg>` template
 * with no room for scripts, event attributes, or external references to enter, since
 * nothing here is interpolated as markup — only numbers and a pre-validated path-data
 * string ever get substituted in. Holes render correctly regardless of the `pathData`'s
 * subpath winding because of `fill-rule="evenodd"` (ADR-0005).
 */
export function buildSvgDocument(options: SvgDocumentOptions): string {
  const { width, height, pathData, fillColor } = options;

  assertInRange(width, 1, Number.MAX_SAFE_INTEGER, 'width');
  assertInRange(height, 1, Number.MAX_SAFE_INTEGER, 'height');
  assertInRange(fillColor.r, 0, 255, 'fillColor.r');
  assertInRange(fillColor.g, 0, 255, 'fillColor.g');
  assertInRange(fillColor.b, 0, 255, 'fillColor.b');
  assertSafePathData(pathData);

  const w = String(width);
  const h = String(height);
  const path =
    pathData === ''
      ? ''
      : `<path d="${pathData}" fill="${toHexColor(fillColor)}" fill-rule="evenodd"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${path}</svg>`;
}
