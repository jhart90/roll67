// Axial/cube hex math for pointy-top hexes (Red Blob Games conventions).

import type { Hex } from '../types.js';

export interface Cube {
  x: number;
  y: number;
  z: number;
}

export function axialToCube(h: Hex): Cube {
  return { x: h.q, z: h.r, y: -h.q - h.r };
}

export function cubeToAxial(c: Cube): Hex {
  return { q: c.x, r: c.z };
}

/** Round fractional cube coordinates to the nearest hex. */
export function cubeRound(c: Cube): Cube {
  let rx = Math.round(c.x);
  let ry = Math.round(c.y);
  let rz = Math.round(c.z);
  const dx = Math.abs(rx - c.x);
  const dy = Math.abs(ry - c.y);
  const dz = Math.abs(rz - c.z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  // + 0 normalizes -0 (from Math.round of small negatives) to +0.
  return { x: rx + 0, y: ry + 0, z: rz + 0 };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function hexNeighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

/** All hexes within `radius` of center (inclusive), center first. */
export function hexRange(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      out.push({ q: center.q + q, r: center.r + r });
    }
  }
  return out;
}

/** Ring of hexes exactly `radius` from center. */
export function hexRing(center: Hex, radius: number): Hex[] {
  if (radius === 0) return [{ ...center }];
  const out: Hex[] = [];
  let h: Hex = { q: center.q + DIRECTIONS[4].q * radius, r: center.r + DIRECTIONS[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(h);
      h = { q: h.q + DIRECTIONS[side].q, r: h.r + DIRECTIONS[side].r };
    }
  }
  return out;
}
