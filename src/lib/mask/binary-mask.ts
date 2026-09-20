export interface BinaryMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export function createBinaryMask(width: number, height: number): BinaryMask {
  return { width, height, data: new Uint8Array(width * height) };
}

export function getPixel(mask: BinaryMask, x: number, y: number): 0 | 1 {
  return mask.data[y * mask.width + x] === 1 ? 1 : 0;
}

export function setPixel(mask: BinaryMask, x: number, y: number, value: 0 | 1): void {
  mask.data[y * mask.width + x] = value;
}

function cloneMask(mask: BinaryMask): BinaryMask {
  return { width: mask.width, height: mask.height, data: mask.data.slice() };
}

// 4-connectivity throughout, not 8: it is the standard choice for binary hole-filling
// because it keeps foreground and background as topological complements of each other
// (an 8-connected background and an 8-connected foreground can each claim the same
// diagonal pixel pair as "connected," which is exactly the ambiguity 4-connectivity for
// one of the two avoids).
const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Fills background regions fully enclosed by foreground, as long as the region is no
 * larger than `maxHoleSize` pixels. A region that touches the mask's border is
 * background reaching "outside" the shape, never a hole, regardless of size.
 *
 * Implemented as flood fill from the border rather than "find every background
 * component and check if it touches an edge": marking everything reachable from the
 * border in one pass, then labeling whatever background is left over, does the same
 * job in a single linear pass over the mask instead of a border-adjacency check per
 * component.
 */
export function fillHoles(mask: BinaryMask, maxHoleSize: number): BinaryMask {
  const { width, height } = mask;
  const reachableFromBorder = new Uint8Array(width * height);
  const stack: number[] = [];

  const isBackground = (index: number): boolean => mask.data[index] === 0;

  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const index = y * width + x;
      if (isBackground(index) && reachableFromBorder[index] === 0) {
        reachableFromBorder[index] = 1;
        stack.push(index);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const index = y * width + x;
      if (isBackground(index) && reachableFromBorder[index] === 0) {
        reachableFromBorder[index] = 1;
        stack.push(index);
      }
    }
  }

  while (stack.length > 0) {
    const index = stack.pop()!;
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIndex = ny * width + nx;
      if (isBackground(nIndex) && reachableFromBorder[nIndex] === 0) {
        reachableFromBorder[nIndex] = 1;
        stack.push(nIndex);
      }
    }
  }

  const result = cloneMask(mask);
  const visited = new Uint8Array(width * height);

  for (let start = 0; start < width * height; start++) {
    if (!isBackground(start) || reachableFromBorder[start] === 1 || visited[start] === 1) {
      continue;
    }

    // Flood-fill this enclosed background component, collecting its pixels before
    // deciding whether to fill it — the size threshold applies to the whole component,
    // not to individual pixels.
    const component: number[] = [start];
    visited[start] = 1;
    let cursor = 0;
    while (cursor < component.length) {
      const index = component[cursor]!;
      cursor++;
      const x = index % width;
      const y = Math.floor(index / width);
      // No bounds check needed here: every border pixel was already marked reachable
      // in the seeding step above, so any pixel that reaches this loop (reachableFromBorder
      // === 0) is necessarily strictly interior, and all four of its neighbours are
      // guaranteed in-bounds.
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nIndex = (y + dy) * width + (x + dx);
        if (
          isBackground(nIndex) &&
          reachableFromBorder[nIndex] === 0 &&
          visited[nIndex] === 0
        ) {
          visited[nIndex] = 1;
          component.push(nIndex);
        }
      }
    }

    if (component.length <= maxHoleSize) {
      for (const index of component) result.data[index] = 1;
    }
  }

  return result;
}
