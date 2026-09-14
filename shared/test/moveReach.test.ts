import { describe, expect, it } from 'vitest';
import { pathCost, shortestPath, type ReachOpts } from '../src/moveReach.js';
import { hexToPixel } from '../src/hex/pixel.js';
import { packHex } from '../src/hex/pack.js';
import type { GridConfig } from '../src/types.js';

const grid: GridConfig = {
  hexSize: 30, originX: 0, originY: 0, cols: 20, rows: 20,
  gridEnabled: true, lighting: 'light', feetPerHex: 5,
};
const open: ReachOpts = { grid, terrain: [], blocked: [], sight: null };

describe('shortestPath', () => {
  it('walks a straight line for the same cost as the straight reading', () => {
    const r = shortestPath({ q: 2, r: 2 }, { q: 6, r: 2 }, open);
    expect(r?.cost).toBe(4);
    expect(r?.path.length).toBe(5);
    expect(pathCost({ q: 2, r: 2 }, { q: 6, r: 2 }, open)).toBe(4);
  });

  it('charges rough ground double, and nothing extra to a crawler', () => {
    // A single rough hex on the straight line: through it is four hexes for
    // five inches, and the detour round it is five hexes for five - the same
    // price either way, so only the cost is fixed here.
    const rough = { grid, terrain: [packHex({ q: 4, r: 2 })], blocked: [], sight: null };
    const r = shortestPath({ q: 2, r: 2 }, { q: 6, r: 2 }, rough);
    expect(r?.cost).toBe(5);
    // Crawling, the rough is ordinary ground again.
    expect(shortestPath({ q: 2, r: 2 }, { q: 6, r: 2 }, { ...rough, crawling: true })?.cost).toBe(4);
  });

  it('goes round a wall the straight line cannot cross', () => {
    // A wall across the straight path between (3,2) and (4,2), long enough
    // that the detour is real.
    const a = hexToPixel({ q: 4, r: 0 }, grid);
    const b = hexToPixel({ q: 4, r: 4 }, grid);
    const x = (hexToPixel({ q: 3, r: 2 }, grid).x + hexToPixel({ q: 4, r: 2 }, grid).x) / 2;
    const walled: ReachOpts = {
      grid, terrain: [], blocked: [],
      sight: { walls: [{ id: 'w', points: [{ x, y: a.y - 40 }, { x, y: b.y + 40 }], type: 'solid' }], doors: [] },
    };
    expect(pathCost({ q: 2, r: 2 }, { q: 6, r: 2 }, walled)).toBeNull();
    const r = shortestPath({ q: 2, r: 2 }, { q: 6, r: 2 }, walled);
    expect(r).not.toBeNull();
    expect(r!.cost).toBeGreaterThan(4);
    // Every step of the route is a single-hex move.
    for (let i = 1; i < r!.path.length; i++) {
      const p = r!.path[i - 1], n = r!.path[i];
      expect(Math.max(Math.abs(p.q - n.q), Math.abs(p.r - n.r), Math.abs(p.q + p.r - n.q - n.r))).toBe(1);
    }
  });

  it('cannot reach a blocked hex, and stays put for a zero-length plan', () => {
    const b = { grid, terrain: [], blocked: [packHex({ q: 5, r: 5 })], sight: null };
    expect(shortestPath({ q: 2, r: 2 }, { q: 5, r: 5 }, b)).toBeNull();
    expect(shortestPath({ q: 2, r: 2 }, { q: 2, r: 2 }, open)).toEqual({ path: [{ q: 2, r: 2 }], cost: 0 });
  });
});
