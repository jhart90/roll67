// Continuous 2D visibility polygon from a point, bounded by a max radius and
// occluded by line segments (walls/doors) -- the smooth, wall-accurate
// analog of hex-based FOV. Classic radial-sweep "sight & light" algorithm:
// cast a ray at every segment endpoint's angle (plus a hair on each side to
// catch the silhouette edge) and at a base ring of evenly-spaced angles so
// open areas render as a smooth circle instead of a jagged one, then connect
// the resulting hit points in angular order.

import type { Point } from '../types.js';
import type { Segment } from './raycast.js';

const BASE_RAYS = 48;
const EPS = 1e-4;

/** Distance along a ray from `origin` at `angle` to the first segment hit, or `maxDist` if none. */
function castRayDist(origin: Point, angle: number, maxDist: number, segments: Segment[]): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = maxDist;
  for (const s of segments) {
    const denom = dx * (s.b.y - s.a.y) - dy * (s.b.x - s.a.x);
    if (Math.abs(denom) < 1e-9) continue; // parallel to the ray
    const t = ((s.a.x - origin.x) * (s.b.y - s.a.y) - (s.a.y - origin.y) * (s.b.x - s.a.x)) / denom;
    const u = ((s.a.x - origin.x) * dy - (s.a.y - origin.y) * dx) / denom;
    if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
  }
  return best;
}

function pointAt(origin: Point, angle: number, dist: number): Point {
  return { x: origin.x + Math.cos(angle) * dist, y: origin.y + Math.sin(angle) * dist };
}

/** Every angle worth casting a ray at: a base ring plus a hair on each side of every segment endpoint (to catch silhouette edges), in ascending order. */
function sweepAngles(origin: Point, segments: Segment[]): number[] {
  const angles = new Set<number>();
  for (let i = 0; i < BASE_RAYS; i++) angles.add((i / BASE_RAYS) * Math.PI * 2);
  for (const s of segments) {
    for (const p of [s.a, s.b]) {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x);
      angles.add(a - EPS);
      angles.add(a);
      angles.add(a + EPS);
    }
  }
  return [...angles].sort((a, b) => a - b);
}

/**
 * A visibility polygon from `origin`, reaching out to `maxDist` and blocked
 * by `segments` (pass `sightSegments(...)` for the wall/door/one-way rules
 * already used by hex-based FOV). Returned as a ring of points in angular
 * order, ready to draw as a single closed path.
 */
export function computeVisibilityPolygon(origin: Point, maxDist: number, segments: Segment[]): Point[] {
  if (maxDist <= 0) return [];
  return sweepAngles(origin, segments).map((a) => pointAt(origin, a, castRayDist(origin, a, maxDist, segments)));
}

/**
 * `full` and `fade` visibility polygons from the same origin in a single
 * angle-sweep: for each angle, one raycast at the wider `fadeMaxDist` gives
 * the true occluder distance, and `full` is just that distance re-clamped to
 * the tighter `fullMaxDist` -- no need to sweep twice. `fullMaxDist` must be
 * <= `fadeMaxDist` (the fade rim is always the wider band).
 */
export function computeVisibilityPolygonBands(
  origin: Point, fullMaxDist: number, fadeMaxDist: number, segments: Segment[],
): { full: Point[]; fade: Point[] } {
  if (fadeMaxDist <= 0) return { full: [], fade: [] };
  const full: Point[] = [];
  const fade: Point[] = [];
  for (const a of sweepAngles(origin, segments)) {
    const dist = castRayDist(origin, a, fadeMaxDist, segments);
    fade.push(pointAt(origin, a, dist));
    if (fullMaxDist > 0) full.push(pointAt(origin, a, Math.min(dist, fullMaxDist)));
  }
  return { full, fade };
}
