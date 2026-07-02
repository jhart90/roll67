import { describe, expect, it } from 'vitest';
import {
  hexDistance, hexNeighbors, hexRange, hexRing,
} from '../src/hex/coords.js';
import { hexCorners, hexToPixel, pixelToHex } from '../src/hex/pixel.js';
import { hexLine, segmentsIntersect } from '../src/hex/line.js';
import { packHex, packSet, unpackHex, unpackSet } from '../src/hex/pack.js';
import type { Hex } from '../src/types.js';

const GRID = { hexSize: 40, originX: 100, originY: 50 };

describe('hex coords', () => {
  it('distance to self is 0, to neighbors is 1', () => {
    const h: Hex = { q: 3, r: -2 };
    expect(hexDistance(h, h)).toBe(0);
    for (const n of hexNeighbors(h)) {
      expect(hexDistance(h, n)).toBe(1);
    }
  });

  it('distance is symmetric and matches manual example', () => {
    const a: Hex = { q: 0, r: 0 };
    const b: Hex = { q: 3, r: -1 };
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
    expect(hexDistance(a, b)).toBe(3);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: 2 })).toBe(4);
  });

  it('hexRange(r) contains the right number of hexes: 3r(r+1)+1', () => {
    for (const r of [0, 1, 2, 5]) {
      expect(hexRange({ q: 0, r: 0 }, r)).toHaveLength(3 * r * (r + 1) + 1);
    }
  });

  it('hexRange hexes are all within radius', () => {
    const center: Hex = { q: 2, r: -1 };
    for (const h of hexRange(center, 4)) {
      expect(hexDistance(center, h)).toBeLessThanOrEqual(4);
    }
  });

  it('hexRing(r) has 6r hexes all exactly r away', () => {
    const center: Hex = { q: -3, r: 5 };
    const ring = hexRing(center, 3);
    expect(ring).toHaveLength(18);
    for (const h of ring) expect(hexDistance(center, h)).toBe(3);
  });
});

describe('hex <-> pixel', () => {
  it('round-trips centers for a range of hexes', () => {
    for (const h of hexRange({ q: 0, r: 0 }, 6)) {
      const px = hexToPixel(h, GRID);
      expect(pixelToHex(px, GRID)).toEqual(h);
    }
  });

  it('points near a center round to that hex', () => {
    const h: Hex = { q: 2, r: 3 };
    const c = hexToPixel(h, GRID);
    expect(pixelToHex({ x: c.x + 10, y: c.y - 8 }, GRID)).toEqual(h);
  });

  it('corners are hexSize away from center', () => {
    const h: Hex = { q: 1, r: 1 };
    const c = hexToPixel(h, GRID);
    for (const corner of hexCorners(h, GRID)) {
      const d = Math.hypot(corner.x - c.x, corner.y - c.y);
      expect(d).toBeCloseTo(GRID.hexSize, 6);
    }
  });
});

describe('hex line', () => {
  it('line endpoints are included, length = distance + 1', () => {
    const a: Hex = { q: 0, r: 0 };
    const b: Hex = { q: 4, r: -2 };
    const line = hexLine(a, b);
    expect(line[0]).toEqual(a);
    expect(line[line.length - 1]).toEqual(b);
    expect(line).toHaveLength(hexDistance(a, b) + 1);
  });

  it('consecutive line hexes are adjacent', () => {
    const line = hexLine({ q: -3, r: 1 }, { q: 5, r: -4 });
    for (let i = 1; i < line.length; i++) {
      expect(hexDistance(line[i - 1], line[i])).toBe(1);
    }
  });
});

describe('segment intersection', () => {
  it('crossing segments intersect', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
  });
  it('separated segments do not intersect', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
  });
  it('parallel segments do not intersect', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false);
  });
});

describe('hex packing', () => {
  it('round-trips positive and negative coords', () => {
    for (const h of [{ q: 0, r: 0 }, { q: 100, r: -100 }, { q: -2048, r: 2047 }, { q: 37, r: 12 }]) {
      expect(unpackHex(packHex(h))).toEqual(h);
    }
  });

  it('set round-trip preserves order and content', () => {
    const hexes = hexRange({ q: -5, r: 9 }, 3);
    expect(unpackSet(packSet(hexes))).toEqual(hexes);
  });

  it('packed values are distinct within a large range', () => {
    const keys = packSet(hexRange({ q: 0, r: 0 }, 20));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
