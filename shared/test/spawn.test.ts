import { describe, expect, it } from 'vitest';
import { firstFreeHex, inBounds } from '../src/vision/fov.js';
import { hexDistance } from '../src/hex/coords.js';
import { packHex } from '../src/hex/pack.js';

const grid = { cols: 20, rows: 20 };

describe('firstFreeHex (token spawn placement)', () => {
  it('returns the center hex when it is free', () => {
    const center = { q: 5, r: 5 };
    expect(firstFreeHex(center, new Set(), grid)).toEqual(center);
  });

  it('picks an adjacent hex when the center is occupied', () => {
    const center = { q: 5, r: 5 };
    const occupied = new Set([packHex(center)]);
    const got = firstFreeHex(center, occupied, grid);
    expect(got).not.toEqual(center);
    expect(hexDistance(center, got)).toBe(1); // nearest ring
    expect(inBounds(got, grid)).toBe(true);
  });

  it('spirals outward past a fully-occupied inner ring', () => {
    const center = { q: 5, r: 5 };
    // Fill the center and its whole radius-1 ring.
    const occupied = new Set<number>([packHex(center)]);
    for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
      const h = { q: center.q + dq, r: center.r + dr };
      if (hexDistance(center, h) === 1) occupied.add(packHex(h));
    }
    const got = firstFreeHex(center, occupied, grid);
    expect(occupied.has(packHex(got))).toBe(false);
    expect(hexDistance(center, got)).toBeGreaterThanOrEqual(2);
  });

  it('stays inside the map bounds when the spawn is in a corner', () => {
    const corner = { q: 0, r: 0 };
    const occupied = new Set([packHex(corner)]);
    const got = firstFreeHex(corner, occupied, grid);
    expect(inBounds(got, grid)).toBe(true);
  });
});
