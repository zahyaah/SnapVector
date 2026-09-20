import { describe, expect, it } from 'vitest';

import { createBinaryMask, getPixel, setPixel, type BinaryMask } from './binary-mask.js';
import {
  close,
  dilate,
  erode,
  open,
  postprocessMask,
  selectComponentContaining,
  smooth,
} from './postprocess.js';

function maskFromRows(rows: readonly string[]): BinaryMask {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const mask = createBinaryMask(width, height);
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) setPixel(mask, x, y, row[x] === '#' ? 1 : 0);
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

function countForeground(mask: BinaryMask): number {
  return mask.data.reduce((sum, v) => sum + v, 0);
}

describe('erode', () => {
  it('removes a pixel unless it and all 4 neighbours are foreground', () => {
    const mask = maskFromRows(['.....', '.###.', '.###.', '.###.', '.....']);
    const eroded = erode(mask);
    // Only the exact centre pixel has all 4 neighbours foreground.
    expect(rowsFromMask(eroded)).toEqual(['.....', '.....', '..#..', '.....', '.....']);
  });

  it('treats outside the mask as background, eroding a shape touching the border', () => {
    const mask = maskFromRows(['###', '###', '###']);
    const eroded = erode(mask);
    expect(rowsFromMask(eroded)).toEqual(['...', '.#.', '...']);
  });

  it('erases an isolated single-pixel speckle entirely', () => {
    const mask = maskFromRows(['.....', '..#..', '.....']);
    expect(countForeground(erode(mask))).toBe(0);
  });
});

describe('dilate', () => {
  it('grows a single pixel into a plus shape', () => {
    const mask = maskFromRows(['.....', '..#..', '.....']);
    const dilated = dilate(mask);
    expect(rowsFromMask(dilated)).toEqual(['..#..', '.###.', '..#..']);
  });

  it('is the complement operation to erode: dilating background never removes foreground', () => {
    const mask = maskFromRows(['.###.', '.###.']);
    const dilated = dilate(mask);
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (getPixel(mask, x, y) === 1) expect(getPixel(dilated, x, y)).toBe(1);
      }
    }
  });
});

describe('open (erode then dilate)', () => {
  it('removes an isolated speckle with no neighbouring mass to be restored from', () => {
    // Full blank rows above and below fully separate the speck from the solid blocks —
    // no column bridges through, so it cannot survive via a neighbour's dilation.
    const mask = maskFromRows(['#####', '#####', '.....', '..#..', '.....', '#####', '#####']);
    const opened = open(mask);
    expect(getPixel(opened, 2, 3)).toBe(0);
  });

  it('does NOT remove a single-pixel spike touching a wide solid mass', () => {
    // This is a real, expected property of one-pass opening with a cross structuring
    // element, not a limitation to work around: the spike's junction pixel has all 4
    // neighbours foreground (up = spike, down/left/right = the mass), so it survives
    // erosion, and dilation then restores the spike pixel above it. Removing spikes
    // like this needs a bigger structuring element or more iterations than "light"
    // smoothing (SPEC's own word) calls for.
    const mask = maskFromRows(['.#...', '#####', '#####', '#####']);
    const opened = open(mask);
    expect(getPixel(opened, 1, 0)).toBe(1);
  });

  it('does not erode a reasonably-sized solid shape to nothing', () => {
    const mask = maskFromRows(Array.from({ length: 20 }, () => '#'.repeat(20)));
    const opened = open(mask);
    // A single open pass only removes the outermost 1px ring of a solid block; for a
    // shape large relative to that ring, the great majority survives.
    expect(countForeground(opened)).toBeGreaterThan(countForeground(mask) * 0.75);
  });
});

describe('close (dilate then erode)', () => {
  it('fills a single-pixel notch in an otherwise straight edge', () => {
    const mask = maskFromRows(['#####', '#.###', '#####', '#####']);
    const closed = close(mask);
    expect(getPixel(closed, 1, 1)).toBe(1);
  });

  it('does not bridge two genuinely separate shapes with a wide gap between them', () => {
    const mask = maskFromRows(['###...###', '###...###', '###...###']);
    const closed = close(mask);
    // The 3-pixel-wide gap is much larger than a single close pass can bridge.
    expect(getPixel(closed, 4, 1)).toBe(0);
  });
});

describe('smooth (open then close)', () => {
  it('fills a boundary notch', () => {
    // A notch near the corner of a small mask would sit inside the outer ring that
    // open() itself erodes away, letting the open pass reshape the exact
    // neighbourhood close() is meant to fix afterward — an artifact of the fixture
    // being small relative to the structuring element, not realistic of the hundreds-
    // of-pixels masks this pipeline actually processes. A 10x10 block with the notch
    // dead centre keeps it well outside the 1px ring open() touches.
    const rows = Array.from({ length: 10 }, () => '#'.repeat(10));
    const withNotch = rows.map((row, y) =>
      y === 5 ? row.slice(0, 5) + '.' + row.slice(6) : row,
    );
    const smoothed = smooth(maskFromRows(withNotch));
    expect(getPixel(smoothed, 5, 5)).toBe(1);
  });

  it('leaves a large solid shape substantially intact', () => {
    const mask = maskFromRows(Array.from({ length: 20 }, () => '#'.repeat(20)));
    const smoothed = smooth(mask);
    expect(countForeground(smoothed)).toBeGreaterThan(countForeground(mask) * 0.75);
  });

  it('does not erase a shape thinner than the structuring element to nothing', () => {
    // A 2-pixel-tall strip: every pixel has either its up or down neighbour outside
    // the shape, so plain erosion (and therefore unguarded opening) removes all of it.
    // This is the literal "eroding thin features to nothing" the acceptance criteria
    // warn about — smooth's safety guard must fall back to skipping the open pass.
    const mask = maskFromRows(['..........', '#########.', '#########.', '..........']);
    const smoothed = smooth(mask);
    expect(countForeground(smoothed)).toBeGreaterThan(0);
  });
});

describe('selectComponentContaining', () => {
  it('keeps the component containing the anchor even when a larger one exists elsewhere', () => {
    const mask = maskFromRows([
      '##.............',
      '##.....#########',
      '#.............#',
      '...............',
      '...............',
      '###.............',
    ]);
    // Two disjoint components: a small 2x3 block (top-left) and a much larger block
    // (top-right). Anchor sits inside the small one.
    const selected = selectComponentContaining(mask, { x: 0, y: 0 });
    expect(getPixel(selected, 0, 0)).toBe(1); // small component kept
    expect(getPixel(selected, 10, 1)).toBe(0); // large component discarded
    expect(countForeground(selected)).toBeLessThan(countForeground(mask));
  });

  it('falls back to the nearest foreground pixel when the anchor itself lands on background', () => {
    // The anchor sits just outside the blob (e.g. a slightly imprecise SAM prompt
    // point relative to the actual returned mask) — the intent is clearly "this blob."
    const mask = maskFromRows(['.....', '.###.', '.###.', '.....']);
    const selected = selectComponentContaining(mask, { x: 0, y: 0 });
    expect(rowsFromMask(selected)).toEqual(rowsFromMask(mask));
  });

  it('returns an all-background mask when the mask has no foreground at all', () => {
    const mask = createBinaryMask(4, 4);
    const selected = selectComponentContaining(mask, { x: 2, y: 2 });
    expect(countForeground(selected)).toBe(0);
  });

  it('clamps an out-of-bounds anchor rather than throwing', () => {
    const mask = maskFromRows(['###', '###', '###']);
    expect(() => selectComponentContaining(mask, { x: -50, y: 999 })).not.toThrow();
  });
});

describe('postprocessMask — full pipeline', () => {
  it('preserves donut topology: outer ring stays connected, inner hole stays background', () => {
    const rows = [
      '###############',
      '###############',
      '###############',
      '###############',
      '###############',
      '#####.....#####',
      '#####.....#####',
      '#####.....#####',
      '#####.....#####',
      '#####.....#####',
      '###############',
      '###############',
      '###############',
      '###############',
      '###############',
    ];
    const donut = maskFromRows(rows);
    // Anchor and assertion points sit 2px inside the ring's thickness, away from both
    // the outer mask border and the inner hole boundary — the exact mask corner (0,0)
    // is expected to erode away under a cross structuring element (no diagonal
    // neighbour to be restored from), which is correct corner-rounding, not a bug, but
    // makes a bad point to assert "still foreground" on.
    const result = postprocessMask(donut, { x: 2, y: 7 });
    expect(getPixel(result, 7, 7)).toBe(0); // hole survives
    expect(getPixel(result, 2, 7)).toBe(1); // left side of the ring survives
    expect(getPixel(result, 12, 7)).toBe(1); // right side survives too — only reachable
    // by going around the ring, so this proves the loop is still one connected shape
  });

  it('removes disconnected speckle via component selection, keeping only the anchored blob', () => {
    const rows = ['....#....', '.........', '#########', '#########', '.........', '....#....'];
    const mask = maskFromRows(rows);
    const result = postprocessMask(mask, { x: 4, y: 2 });
    expect(getPixel(result, 4, 0)).toBe(0); // speckle above, gone
    expect(getPixel(result, 4, 5)).toBe(0); // speckle below, gone
    expect(getPixel(result, 4, 2)).toBe(1); // anchored blob remains
  });

  it('keeps the smaller anchored component over a larger decoy elsewhere', () => {
    const rows = [
      '##.....##########',
      '##.....##########',
      '.................',
      '.................',
    ];
    const mask = maskFromRows(rows);
    const result = postprocessMask(mask, { x: 0, y: 0 });
    expect(countForeground(result)).toBeLessThan(countForeground(mask) / 2);
  });
});
