import { describe, expect, it } from 'vitest';
import type { Door, GridConfig, Hex, Wall } from '../src/types.js';
import { canReachHex, reachableAlong } from '../src/vision/movement.js';

const GRID: GridConfig = {
  hexSize: 10, originX: 0, originY: 0, cols: 40, rows: 40,
  globalIllumination: true, feetPerHex: 5,
};

const FROM: Hex = { q: 4, r: 10 };

function reach(to: Hex, walls: Wall[] = [], doors: Door[] = []) {
  return canReachHex(FROM, to, { grid: GRID, walls, doors });
}

// Vertical barrier at x=190 spanning the whole map (map is ~600px tall).
const FULL_WALL: Wall = { id: 'w', points: [{ x: 190, y: -100 }, { x: 190, y: 700 }] };

describe('movement blocking', () => {
  it('open field: anywhere in bounds is reachable, off-map is not', () => {
    expect(reach({ q: 8, r: 10 })).toBe(true);
    expect(reach({ q: 4, r: 10 })).toBe(true); // self
    expect(reach({ q: 0, r: 45 })).toBe(false); // out of bounds
  });

  it('a full wall blocks movement to the far side entirely', () => {
    expect(reach({ q: 8, r: 10 }, [FULL_WALL])).toBe(false); // straight across (px x≈225)
    expect(reach({ q: 12, r: 4 }, [FULL_WALL])).toBe(false); // diagonal across (px x≈242)
    expect(reach({ q: 5, r: 10 }, [FULL_WALL])).toBe(true); // same side (px x≈173)
    expect(reach({ q: 8, r: 4 }, [FULL_WALL])).toBe(true); // also same side (px x≈173)
  });

  it('a short pillar can be walked around', () => {
    const pillar: Wall = { id: 'p', points: [{ x: 180, y: 145 }, { x: 180, y: 155 }] };
    // The straight line crosses the pillar, but a detour exists.
    expect(reach({ q: 8, r: 10 }, [pillar])).toBe(true);
  });

  it('closed doors block, open doors allow', () => {
    // Wall with a door-sized gap at the from-row; the door fills the gap.
    const stubs: Wall[] = [
      { id: 'w1', points: [{ x: 190, y: -100 }, { x: 190, y: 145 }] },
      { id: 'w2', points: [{ x: 190, y: 155 }, { x: 190, y: 700 }] },
    ];
    const door: Door = { id: 'd', a: { x: 190, y: 145 }, b: { x: 190, y: 155 }, open: false };
    expect(reach({ q: 8, r: 10 }, stubs, [door])).toBe(false);
    expect(reach({ q: 8, r: 10 }, stubs, [{ ...door, open: true }])).toBe(true);
  });

  it('all wall types block movement (window/one-way are still physical walls)', () => {
    const window: Wall = { id: 'w', points: [{ x: 190, y: -100 }, { x: 190, y: 700 }], type: 'window' };
    const oneway: Wall = { id: 'w', points: [{ x: 190, y: -100 }, { x: 190, y: 700 }], type: 'oneway' };
    expect(reach({ q: 8, r: 10 }, [window])).toBe(false);
    expect(reach({ q: 8, r: 10 }, [oneway])).toBe(false);
  });

  it('reachableAlong stops on the last free hex before a wall (no pass-through)', () => {
    const geo = { grid: GRID, walls: [FULL_WALL], doors: [] };
    // Moving straight across the full wall: held on the near side, not through.
    const stop = reachableAlong(FROM, { q: 12, r: 10 }, geo);
    expect(stop).toEqual({ q: 5, r: 10 }); // one hex forward, still left of x=190
    // A one-hex step directly into the wall is refused (held up in place).
    expect(reachableAlong({ q: 5, r: 10 }, { q: 6, r: 10 }, geo)).toEqual({ q: 5, r: 10 });
  });

  it('reachableAlong does not detour around a pillar (straight-line only)', () => {
    const pillar: Wall = { id: 'p', points: [{ x: 180, y: 145 }, { x: 180, y: 155 }] };
    // canReachHex finds a detour; reachableAlong stops before the pillar.
    expect(canReachHex(FROM, { q: 8, r: 10 }, { grid: GRID, walls: [pillar], doors: [] })).toBe(true);
    const stop = reachableAlong(FROM, { q: 8, r: 10 }, { grid: GRID, walls: [pillar], doors: [] });
    expect(stop.q).toBeLessThan(8); // did not reach the far hex in a straight line
  });

  it('reachableAlong reaches the target across open ground', () => {
    expect(reachableAlong(FROM, { q: 8, r: 10 }, { grid: GRID, walls: [], doors: [] })).toEqual({ q: 8, r: 10 });
  });

  it('cannot escape a sealed box', () => {
    // A box of walls around the start hex (px center ~155.9, 150).
    const box: Wall = {
      id: 'box',
      points: [
        { x: 130, y: 120 }, { x: 185, y: 120 }, { x: 185, y: 180 },
        { x: 130, y: 180 }, { x: 130, y: 120 },
      ],
    };
    expect(reach({ q: 8, r: 10 }, [box])).toBe(false);
    expect(reach({ q: 10, r: 2 }, [box])).toBe(false);
  });
});
