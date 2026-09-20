import { describe, expect, it } from 'vitest';

import {
  createBinaryMask,
  fillHoles,
  getPixel,
  setPixel,
  type BinaryMask,
} from './binary-mask.js';

function maskFromRows(rows: readonly string[]): BinaryMask {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const mask = createBinaryMask(width, height);
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) {
      setPixel(mask, x, y, row[x] === '#' ? 1 : 0);
    }
  }
  return mask;
}

function rowsFromMask(mask: BinaryMask): string[] {
  const rows: string[] = [];
  for (let y = 0; y < mask.height; y++) {
    let row = '';
    for (let x = 0; x < mask.width; x++) row += getPixel(mask, x, y) === 1 ? '#' : '.';
    rows.push(row);
  }
  return rows;
}

describe('createBinaryMask / getPixel / setPixel', () => {
  it('creates a mask filled with background (0) by default', () => {
    const mask = createBinaryMask(3, 2);
    expect(mask.width).toBe(3);
    expect(mask.height).toBe(2);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) expect(getPixel(mask, x, y)).toBe(0);
    }
  });

  it('sets and reads individual pixels', () => {
    const mask = createBinaryMask(2, 2);
    setPixel(mask, 1, 0, 1);
    expect(getPixel(mask, 1, 0)).toBe(1);
    expect(getPixel(mask, 0, 0)).toBe(0);
  });

  it('backs the mask with a typed array sized width*height', () => {
    const mask = createBinaryMask(4, 3);
    expect(mask.data).toBeInstanceOf(Uint8Array);
    expect(mask.data.length).toBe(12);
  });
});

describe('fillHoles', () => {
  it('does nothing to an all-background mask', () => {
    const mask = maskFromRows(['...', '...', '...']);
    const filled = fillHoles(mask, 10);
    expect(rowsFromMask(filled)).toEqual(['...', '...', '...']);
  });

  it('does nothing to an all-foreground mask', () => {
    const mask = maskFromRows(['###', '###']);
    const filled = fillHoles(mask, 10);
    expect(rowsFromMask(filled)).toEqual(['###', '###']);
  });

  it('fills a single-pixel hole fully enclosed by foreground', () => {
    const mask = maskFromRows(['#####', '#.###', '#####']);
    const filled = fillHoles(mask, 10);
    expect(rowsFromMask(filled)).toEqual(['#####', '#####', '#####']);
  });

  it('does NOT fill a background region that touches the image border', () => {
    // The notch on the left edge is background but not enclosed — it has a path to
    // outside the mask, so it must never be treated as a hole no matter how small.
    const mask = maskFromRows(['#####', '.####', '#####']);
    const filled = fillHoles(mask, 10);
    expect(rowsFromMask(filled)).toEqual(['#####', '.####', '#####']);
  });

  it('does NOT fill a large enclosed hole above the size threshold — the donut case', () => {
    const donut = maskFromRows([
      '#########',
      '#########',
      '###...###',
      '###...###',
      '###...###',
      '#########',
      '#########',
    ]);
    const filled = fillHoles(donut, 5); // hole is 3x3 = 9 pixels, above the threshold
    expect(rowsFromMask(filled)).toEqual(rowsFromMask(donut));
  });

  it('fills an enclosed hole exactly at the size threshold (inclusive)', () => {
    // A 1x4 enclosed hole = 4 background pixels.
    const mask = maskFromRows(['######', '#....#', '######']);
    const filled = fillHoles(mask, 4);
    expect(rowsFromMask(filled)).toEqual(['######', '######', '######']);
  });

  it('leaves a hole one pixel larger than the threshold unfilled', () => {
    const mask = maskFromRows(['######', '#....#', '######']); // hole = 4 pixels
    const filled = fillHoles(mask, 3);
    expect(rowsFromMask(filled)).toEqual(['######', '#....#', '######']);
  });

  it('fills multiple disjoint small holes independently', () => {
    const mask = maskFromRows(['#######', '#.#.#.#', '#######']);
    const filled = fillHoles(mask, 1);
    expect(rowsFromMask(filled)).toEqual(['#######', '#######', '#######']);
  });

  it('treats a diagonally-isolated background pixel as enclosed, not border-connected', () => {
    // In a 3x3 grid the border is every cell with x=0, x=2, y=0, or y=2 — the two
    // corner '.' pixels are on the border directly, but the CENTER pixel is not,
    // despite touching foreground diagonally on all four corners. Under 4-connectivity
    // it has no background neighbours at all, so it is its own fully-enclosed 1-pixel
    // component and gets filled; the two border corners do not.
    const mask = maskFromRows(['##.', '#.#', '.##']);
    const filled = fillHoles(mask, 1);
    expect(rowsFromMask(filled)).toEqual(['##.', '###', '.##']);
  });

  it('handles a 1x1 all-background mask without throwing', () => {
    const mask = createBinaryMask(1, 1);
    expect(() => fillHoles(mask, 10)).not.toThrow();
    expect(getPixel(fillHoles(mask, 10), 0, 0)).toBe(0);
  });

  it('does not mutate the input mask', () => {
    const mask = maskFromRows(['#####', '#.###', '#####']);
    const original = rowsFromMask(mask);
    fillHoles(mask, 10);
    expect(rowsFromMask(mask)).toEqual(original);
  });
});
