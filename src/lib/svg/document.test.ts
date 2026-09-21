import { describe, expect, it } from 'vitest';

import { buildSvgDocument } from './document.js';

const RED = { r: 255, g: 0, b: 0 };

describe('buildSvgDocument — well-formed output', () => {
  it('emits a root <svg> with a matching viewBox and width/height', () => {
    const svg = buildSvgDocument({
      width: 200,
      height: 100,
      pathData: 'M0,0C1,1 2,2 3,3Z',
      fillColor: RED,
    });
    expect(svg).toContain('viewBox="0 0 200 100"');
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="100"');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('declares the SVG namespace', () => {
    const svg = buildSvgDocument({ width: 10, height: 10, pathData: 'M0,0Z', fillColor: RED });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('embeds the given path data verbatim inside a <path> element', () => {
    const svg = buildSvgDocument({
      width: 10,
      height: 10,
      pathData: 'M0,0C1,1 2,2 3,3Z',
      fillColor: RED,
    });
    expect(svg).toContain('d="M0,0C1,1 2,2 3,3Z"');
  });

  it('applies fill-rule evenodd so hole subpaths render as holes', () => {
    const svg = buildSvgDocument({ width: 10, height: 10, pathData: 'M0,0Z', fillColor: RED });
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it('renders the fill color as a hex color derived from the given RGB', () => {
    const svg = buildSvgDocument({
      width: 10,
      height: 10,
      pathData: 'M0,0Z',
      fillColor: { r: 18, g: 52, b: 86 },
    });
    expect(svg).toContain('fill="#123456"');
  });

  it('produces a single path with no path data at all when given an empty d string', () => {
    const svg = buildSvgDocument({ width: 10, height: 10, pathData: '', fillColor: RED });
    expect(svg).not.toContain('<path');
  });
});

describe('buildSvgDocument — contains nothing but the fixed template (safe by construction)', () => {
  it('never contains a <script> tag', () => {
    const svg = buildSvgDocument({ width: 10, height: 10, pathData: 'M0,0Z', fillColor: RED });
    expect(svg.toLowerCase()).not.toContain('<script');
  });

  it('never contains an event-handler attribute', () => {
    const svg = buildSvgDocument({ width: 10, height: 10, pathData: 'M0,0Z', fillColor: RED });
    expect(svg.toLowerCase()).not.toMatch(/\son\w+=/);
  });

  it('never references an external resource', () => {
    // The xmlns declaration is itself a "http://" URI (an XML namespace name, never
    // dereferenced) — real external references would show up as href/src attributes.
    const svg = buildSvgDocument({ width: 10, height: 10, pathData: 'M0,0Z', fillColor: RED });
    expect(svg).not.toMatch(/\bhref\s*=/);
    expect(svg).not.toMatch(/\bsrc\s*=/);
    expect(svg).not.toContain('xlink:href');
  });
});

describe('buildSvgDocument — numeric hardening', () => {
  it('rejects non-finite width or height rather than emitting NaN/Infinity', () => {
    expect(() =>
      buildSvgDocument({ width: NaN, height: 10, pathData: 'M0,0Z', fillColor: RED }),
    ).toThrow();
    expect(() =>
      buildSvgDocument({ width: 10, height: Infinity, pathData: 'M0,0Z', fillColor: RED }),
    ).toThrow();
  });

  it('rejects zero or negative dimensions', () => {
    expect(() =>
      buildSvgDocument({ width: 0, height: 10, pathData: 'M0,0Z', fillColor: RED }),
    ).toThrow();
    expect(() =>
      buildSvgDocument({ width: 10, height: -5, pathData: 'M0,0Z', fillColor: RED }),
    ).toThrow();
  });

  it('rejects a fill color channel outside 0-255', () => {
    expect(() =>
      buildSvgDocument({
        width: 10,
        height: 10,
        pathData: 'M0,0Z',
        fillColor: { r: 300, g: 0, b: 0 },
      }),
    ).toThrow();
    expect(() =>
      buildSvgDocument({
        width: 10,
        height: 10,
        pathData: 'M0,0Z',
        fillColor: { r: -1, g: 0, b: 0 },
      }),
    ).toThrow();
  });

  it('rejects path data that is not a well-formed sequence of M/C/Z drawing commands', () => {
    // A defensive boundary check: if a NaN or Infinity ever slipped past upstream
    // formatting, it would show up here as a stray letter outside the M/C/Z/digit/
    // punctuation charset — e.g. "MNaN,0Z" — and must never reach the output file.
    expect(() =>
      buildSvgDocument({ width: 10, height: 10, pathData: 'MNaN,0Z', fillColor: RED }),
    ).toThrow();
    expect(() =>
      buildSvgDocument({ width: 10, height: 10, pathData: 'M0,Infinity Z', fillColor: RED }),
    ).toThrow();
    expect(() =>
      buildSvgDocument({
        width: 10,
        height: 10,
        pathData: 'M0,0Z<script>alert(1)</script>',
        fillColor: RED,
      }),
    ).toThrow();
  });

  it('accepts a realistic multi-subpath, multi-curve path data string', () => {
    expect(() =>
      buildSvgDocument({
        width: 10,
        height: 10,
        pathData: 'M0,0C1,1 2,2 3,3Z M-5.5,-5.5C-1,-1 0,0 1,1Z',
        fillColor: RED,
      }),
    ).not.toThrow();
  });
});
