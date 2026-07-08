import { describe, expect, it } from 'vitest';
import { computeVisibilityPolygon, computeVisibilityPolygonBands } from '../src/vision/visibilityPolygon.js';
import { computeUnionVisibilityPolygons } from '../src/vision/fov.js';
import type { GridConfig, Point, VisionStats, Wall } from '../src/types.js';

const ORIGIN = { x: 0, y: 0 };

/** Standard even-odd ray-casting point-in-polygon test. */
function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

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

  it('a wall "north" (atan2 negative range) hides a point behind it, exactly like a wall "east" (atan2 positive range)', () => {
    // atan2 returns (-PI, PI]: a wall to the north (-y) resolves to a
    // NEGATIVE angle, while the base sweep ring is generated over [0, 2*PI).
    // Sorting the two ranges together without normalizing puts every
    // negative-angle endpoint in its own block instead of interleaving it
    // with its true angular neighbors (the nearby base rays, which live at
    // the numerically unrelated end of the range). The connect-the-dots path
    // then jumps between angularly-distant points, and a point actually
    // hidden behind the wall can end up enclosed by the resulting
    // self-intersecting shape anyway. A pure per-sample distance check can't
    // catch this -- castRayDist resolves each angle correctly in isolation;
    // only whether a point is INSIDE the assembled polygon exposes it.
    const wall = { a: { x: -10, y: -30 }, b: { x: 10, y: -30 } };
    const poly = computeVisibilityPolygon(ORIGIN, 100, [wall]);
    expect(pointInPolygon({ x: 0, y: -60 }, poly)).toBe(false); // behind the wall
    expect(pointInPolygon({ x: 60, y: 0 }, poly)).toBe(true); // unobstructed east
  });

  it('a wall "west" (atan2 wrap-around boundary) hides a point behind it too', () => {
    // Endpoints straddling the +-PI seam itself (a wall almost due west) are
    // the other place a naive numeric sort of un-normalized atan2 output can
    // misorder neighbors.
    const wall = { a: { x: -30, y: -10 }, b: { x: -30, y: 10 } };
    const poly = computeVisibilityPolygon(ORIGIN, 100, [wall]);
    expect(pointInPolygon({ x: -60, y: 0 }, poly)).toBe(false); // behind the wall
    expect(pointInPolygon({ x: 0, y: 60 }, poly)).toBe(true); // unobstructed south
  });
});

describe('computeVisibilityPolygonBands', () => {
  it('matches two separate computeVisibilityPolygon calls, in the open and against a wall', () => {
    const wall = { a: { x: 30, y: -10 }, b: { x: 30, y: 10 } };
    for (const segments of [[], [wall]]) {
      const { full, fade } = computeVisibilityPolygonBands(ORIGIN, 60, 70, segments);
      expect(full).toEqual(computeVisibilityPolygon(ORIGIN, 60, segments));
      expect(fade).toEqual(computeVisibilityPolygon(ORIGIN, 70, segments));
    }
  });

  it('returns two empty rings when the wider (fade) distance is non-positive', () => {
    expect(computeVisibilityPolygonBands(ORIGIN, 0, 0, [])).toEqual({ full: [], fade: [] });
  });

  it('full stays empty (not just capped to a point) when only the tighter distance is non-positive', () => {
    const { full, fade } = computeVisibilityPolygonBands(ORIGIN, 0, 50, []);
    expect(full).toEqual([]);
    expect(fade.length).toBeGreaterThan(0);
  });
});

describe('computeUnionVisibilityPolygons', () => {
  const GRID: GridConfig = {
    hexSize: 10, originX: 0, originY: 0, cols: 40, rows: 40,
    gridEnabled: true, lighting: 'light', feetPerHex: 5,
  };
  const EYES: VisionStats = { visionRange: 10, darkvision: 0 };

  it('under "light", reach has no lit-mask and ignores EYES\' modest visionRange entirely (no fade rim -- sight is unlimited)', () => {
    const bands = computeUnionVisibilityPolygons(
      [{ hex: { q: 0, r: 0 }, stats: EYES }],
      { grid: GRID, walls: [], doors: [], lights: [] },
    );
    expect(bands.full.lit).toBeNull();
    expect(bands.fade.lit).toBeNull();
    expect(bands.full.reach).toHaveLength(1);
    expect(bands.fade.reach).toHaveLength(1);
    const fullReach = Math.max(...bands.full.reach[0].map((p) => Math.hypot(p.x, p.y)));
    const fadeReach = Math.max(...bands.fade.reach[0].map((p) => Math.hypot(p.x, p.y)));
    // No separate fade rim under light -- full already reaches as far as sight
    // can carry, well past EYES' own (irrelevant, under daylight) visionRange.
    expect(fadeReach).toBeCloseTo(fullReach, 5);
    expect(fullReach).toBeGreaterThan(EYES.visionRange * GRID.hexSize);
  });

  it('a wall shortens the reach polygon in its direction, mirroring hex-based FOV blocking', () => {
    const wall: Wall = { id: 'w1', points: [{ x: 30, y: -50 }, { x: 30, y: 50 }] };
    const bands = computeUnionVisibilityPolygons(
      [{ hex: { q: 0, r: 0 }, stats: EYES }],
      { grid: GRID, walls: [wall], doors: [], lights: [] },
    );
    const poly = bands.full.reach[0];
    const towardWall = poly.filter((p) => Math.abs(Math.atan2(p.y, p.x)) < 0.05);
    for (const p of towardWall) expect(p.x).toBeLessThanOrEqual(30 + 1e-6);
  });

  it('under "dark", reach is still populated but gets a lit-mask (self + darkvision circle, no lights)', () => {
    const seeing: VisionStats = { visionRange: 10, darkvision: 4 };
    const bands = computeUnionVisibilityPolygons(
      [{ hex: { q: 0, r: 0 }, stats: seeing }],
      { grid: { ...GRID, lighting: 'dark' }, walls: [], doors: [], lights: [] },
    );
    const hexPx = Math.sqrt(3) * GRID.hexSize;
    expect(bands.full.reach).toHaveLength(1);
    expect(bands.full.lit).not.toBeNull();
    expect(bands.full.lit!.lightPolygons).toHaveLength(0);
    // A viewer's own hex is always lit (mirrors computeFov's dist===0 rule),
    // plus their darkvision circle.
    expect(bands.full.lit!.circles).toEqual([
      { x: 0, y: 0, r: hexPx },
      { x: 0, y: 0, r: 4 * hexPx },
    ]);
    // Fade widens the darkvision circle by +1 hex too (the self-circle doesn't).
    expect(bands.fade.lit!.circles).toEqual([
      { x: 0, y: 0, r: hexPx },
      { x: 0, y: 0, r: 5 * hexPx },
    ]);
  });

  it('under "dark" with no darkvision, the lit-mask has just the self-circle unless a light is present', () => {
    const blind: VisionStats = { visionRange: 10, darkvision: 0 };
    const noLight = computeUnionVisibilityPolygons(
      [{ hex: { q: 0, r: 0 }, stats: blind }],
      { grid: { ...GRID, lighting: 'dark' }, walls: [], doors: [], lights: [] },
    );
    expect(noLight.full.lit!.circles).toEqual([{ x: 0, y: 0, r: Math.sqrt(3) * GRID.hexSize }]);
    expect(noLight.full.lit!.lightPolygons).toHaveLength(0);

    const torch = { id: 'l1', x: 20, y: 0, brightRadius: 3, dimRadius: 5 };
    const withLight = computeUnionVisibilityPolygons(
      [{ hex: { q: 0, r: 0 }, stats: blind }],
      { grid: { ...GRID, lighting: 'dark' }, walls: [], doors: [], lights: [torch] },
    );
    expect(withLight.full.lit!.lightPolygons).toHaveLength(1);
  });

  it('under "dim", both full and fade get the self-circle plus the (unwidened) ambient-radius circle', () => {
    const blind: VisionStats = { visionRange: 10, darkvision: 0 };
    const bands = computeUnionVisibilityPolygons(
      [{ hex: { q: 0, r: 0 }, stats: blind }],
      { grid: { ...GRID, lighting: 'dim' }, walls: [], doors: [], lights: [] },
    );
    const hexPx = Math.sqrt(3) * GRID.hexSize;
    const ambientPx = 2 * hexPx; // DIM_AMBIENT_RADIUS = 2
    expect(bands.full.lit!.circles).toEqual([{ x: 0, y: 0, r: hexPx }, { x: 0, y: 0, r: ambientPx }]);
    expect(bands.fade.lit!.circles).toEqual([{ x: 0, y: 0, r: hexPx }, { x: 0, y: 0, r: ambientPx }]); // ambient NOT widened for fade
  });
});
