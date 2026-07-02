import type { Hex, Point } from '../types.js';
import { axialToCube, cubeRound, cubeToAxial, hexDistance, type Cube } from './coords.js';

function cubeLerp(a: Cube, b: Cube, t: number): Cube {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Hexes on the straight line from a to b (inclusive), via cube-lerp rounding. */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];
  const ac = axialToCube(a);
  const bc = axialToCube(b);
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    // Tiny epsilon nudge avoids landing exactly on hex edges.
    out.push(cubeToAxial(cubeRound(cubeLerp(
      { x: ac.x + 1e-6, y: ac.y + 2e-6, z: ac.z - 3e-6 },
      bc,
      i / n,
    ))));
  }
  return out;
}

/**
 * Does segment p1->p2 intersect segment p3->p4?
 * Standard orientation test; touching endpoints count as intersecting.
 */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (denom === 0) return false; // parallel or collinear: treat as non-blocking
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
