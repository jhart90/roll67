import { describe, expect, it } from 'vitest';
import { knownWallSegments } from '../src/vision/wallMemory.js';
import { hexToPixel, pixelToHex } from '../src/hex/pixel.js';
import type { GridConfig, Hex, Wall } from '../src/types.js';

const grid = { hexSize: 30, originX: 0, originY: 0, feetPerHex: 5 } as GridConfig;
const key = (h: Hex) => `${h.q},${h.r}`;

/** A player who has discovered exactly the listed hexes. */
const seenOnly = (hexes: Hex[]) => {
  const set = new Set(hexes.map(key));
  return (h: Hex) => set.has(key(h));
};

/** A wall running straight through the centres of the given hexes. */
function wallThrough(id: string, from: Hex, to: Hex): Wall {
  return { id, points: [hexToPixel(from, grid), hexToPixel(to, grid)] } as Wall;
}

/** Total length of the fragments handed to the player. */
const totalLength = (segs: { a: { x: number; y: number }; b: { x: number; y: number } }[]) =>
  segs.reduce((n, s) => n + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0);

describe('a player only learns the walls they have walked past', () => {
  const wall = wallThrough('w1', { q: 0, r: 0 }, { q: 10, r: 0 });

  it('hands over nothing on a map they have never seen', () => {
    expect(knownWallSegments([wall], grid, () => false)).toEqual([]);
  });

  it('hands over the whole wall to someone who has seen all of it', () => {
    const full = knownWallSegments([wall], grid, () => true);
    const whole = Math.hypot(
      wall.points[1]!.x - wall.points[0]!.x,
      wall.points[1]!.y - wall.points[0]!.y,
    );
    expect(totalLength(full)).toBeCloseTo(whole, 0);
  });

  // The leak this whole module exists to prevent: a corridor wall running out
  // of a lit room into the dark must not report how far it goes.
  it('cuts a wall off where the discovered ground ends', () => {
    const seen = seenOnly([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]);
    const segs = knownWallSegments([wall], grid, seen);
    expect(segs.length).toBeGreaterThan(0);

    const farthest = Math.max(...segs.flatMap((s) => [s.a.x, s.b.x]));
    const lastSeenX = hexToPixel({ q: 3, r: 0 }, grid).x;
    expect(farthest).toBeLessThan(lastSeenX);
  });

  it('never returns a point standing on undiscovered ground', () => {
    const seen = seenOnly([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 5, r: 0 }]);
    for (const s of knownWallSegments([wall], grid, seen)) {
      // Sample along each fragment: every part of it must be on known ground.
      for (let t = 0; t <= 1; t += 0.1) {
        const p = { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
        expect(seen(pixelToHex(p, grid)), `${p.x},${p.y}`).toBe(true);
      }
    }
  });

  // Two lit rooms with dark corridor between them: the player learns both
  // rooms' walls and nothing about the gap.
  it('splits one wall into the separate stretches it has seen', () => {
    const seen = seenOnly([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 7, r: 0 }, { q: 8, r: 0 }]);
    const segs = knownWallSegments([wall], grid, seen);
    expect(segs.length).toBe(2);
    expect(segs.every((s) => s.wallId === 'w1')).toBe(true);
  });
});

describe('the shape of what is sent', () => {
  it('keeps each fragment tagged with the wall it came from', () => {
    const walls = [
      wallThrough('a', { q: 0, r: 0 }, { q: 2, r: 0 }),
      wallThrough('b', { q: 0, r: 2 }, { q: 2, r: 2 }),
    ];
    const ids = new Set(knownWallSegments(walls, grid, () => true).map((s) => s.wallId));
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('follows every leg of a polyline', () => {
    const bent = {
      id: 'bent',
      points: [hexToPixel({ q: 0, r: 0 }, grid), hexToPixel({ q: 3, r: 0 }, grid), hexToPixel({ q: 3, r: 3 }, grid)],
    } as Wall;
    expect(knownWallSegments([bent], grid, () => true).length).toBeGreaterThanOrEqual(2);
  });

  it('ignores a degenerate zero-length leg', () => {
    const p = hexToPixel({ q: 0, r: 0 }, grid);
    expect(knownWallSegments([{ id: 'z', points: [p, p] } as Wall], grid, () => true)).toEqual([]);
  });

  it('ignores a wall with a single point', () => {
    const p = hexToPixel({ q: 0, r: 0 }, grid);
    expect(knownWallSegments([{ id: 'one', points: [p] } as Wall], grid, () => true)).toEqual([]);
  });
});
