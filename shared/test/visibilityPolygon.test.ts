import { describe, expect, it } from 'vitest';
import { computeVisibilityPolygon } from '../src/vision/visibilityPolygon.js';
import { computeUnionVisibilityPolygons } from '../src/vision/fov.js';
import type { GridConfig, VisionStats, Wall } from '../src/types.js';

const ORIGIN = { x: 0, y: 0 };

describe('computeVisibilityPolygon', () => {
  it('open field: every point sits at exactly maxDist from the origin', () => {
    const poly = computeVisibilityPolygon(ORIGIN, 100, []);
    expect(poly.length).toBeGreaterThan(0);
    for (const p of poly) {
      const dist = Math.hypot(p.x - ORIGIN.x, p.y - ORIGIN.y);
      expect(dist).toBeCloseTo(100, 5);
    }
  });

  it('a wall segment blocks the polygon in its own direction, not elsewhere', () => {
    // A short wall directly to the east (+x), well short of maxDist.
    const wall = { a: { x: 30, y: -10 }, b: { x: 30, y: 10 } };
    const poly = computeVisibilityPolygon(ORIGIN, 100, [wall]);
    const eastPoints = poly.filter((p) => Math.abs(Math.atan2(p.y, p.x)) < 0.05);
    const westPoints = poly.filter((p) => Math.abs(Math.atan2(p.y, p.x) - Math.PI) < 0.05 || Math.abs(Math.atan2(p.y, p.x) + Math.PI) < 0.05);
    expect(eastPoints.length).toBeGreaterThan(0);
    for (const p of eastPoints) {
      const dist = Math.hypot(p.x, p.y);
      expect(dist).toBeLessThanOrEqual(30 + 1e-6);
    }
    // The opposite direction is unobstructed and should still reach maxDist.
    expect(westPoints.length).toBeGreaterThan(0);
    for (const p of westPoints) {
      const dist = Math.hypot(p.x, p.y);
      expect(dist).toBeCloseTo(100, 3);
    }
  });

  it('a wall behind a corner casts a shadow past it, not before it', () => {
    // Vertical wall from (20,-5) to (20,5); a ray grazing just past its top
    // corner (y slightly above 5) should sail through to maxDist, while a
    // ray straight at it (y=0) stops at the wall.
    const wall = { a: { x: 20, y: -5 }, b: { x: 20, y: 5 } };
    const grazing = computeVisibilityPolygon(ORIGIN, 100, [wall])
      .filter((p) => Math.abs(Math.atan2(p.y, p.x)) < 0.3);
    const throughDist = Math.max(...grazing.map((p) => Math.hypot(p.x, p.y)));
    const blockedPoint = computeVisibilityPolygon(ORIGIN, 100, [wall])
      .find((p) => Math.abs(p.y) < 1 && p.x > 0);
    expect(throughDist).toBeGreaterThan(50); // something in that arc reaches well past the wall
    expect(blockedPoint && Math.hypot(blockedPoint.x, blockedPoint.y)).toBeLessThanOrEqual(20 + 1e-6);
  });

  it('returns [] for a non-positive max distance', () => {
    expect(computeVisibilityPolygon(ORIGIN, 0, [])).toEqual([]);
  });
});

describe('computeUnionVisibilityPolygons', () => {
  const GRID: GridConfig = {
    hexSize: 10, originX: 0, originY: 0, cols: 40, rows: 40,
    gridEnabled: true, lighting: 'light', feetPerHex: 5,
  };
  const EYES: VisionStats = { visionRange: 10, darkvision: 0 };

  it('is null outside global daylight ("dark"/"dim" lighting)', () => {
    for (const lighting of ['dark', 'dim'] as const) {
      const bands = computeUnionVisibilityPolygons(
        [{ hex: { q: 0, r: 0 }, stats: EYES }],
        { grid: { ...GRID, lighting }, walls: [], doors: [], lights: [] },
      );
      expect(bands).toBeNull();
    }
  });

  it('under "light", returns one full+fade polygon per viewer, fade strictly larger', () => {
    const bands = computeUnionVisibilityPolygons(
      [{ hex: { q: 0, r: 0 }, stats: EYES }],
      { grid: GRID, walls: [], doors: [], lights: [] },
    );
    expect(bands).not.toBeNull();
    expect(bands!.full).toHaveLength(1);
    expect(bands!.fade).toHaveLength(1);
    const fullReach = Math.max(...bands!.full[0].map((p) => Math.hypot(p.x, p.y)));
    const fadeReach = Math.max(...bands!.fade[0].map((p) => Math.hypot(p.x, p.y)));
    expect(fadeReach).toBeGreaterThan(fullReach);
  });

  it('a wall shortens the polygon in its direction, mirroring hex-based FOV blocking', () => {
    const wall: Wall = { id: 'w1', points: [{ x: 30, y: -50 }, { x: 30, y: 50 }] };
    const bands = computeUnionVisibilityPolygons(
      [{ hex: { q: 0, r: 0 }, stats: EYES }],
      { grid: GRID, walls: [wall], doors: [], lights: [] },
    );
    const poly = bands!.full[0];
    const towardWall = poly.filter((p) => Math.abs(Math.atan2(p.y, p.x)) < 0.05);
    for (const p of towardWall) expect(p.x).toBeLessThanOrEqual(30 + 1e-6);
  });
});
