// Hex <-> pixel conversion for pointy-top hexes.

import type { GridConfig, Hex, Point } from '../types.js';
import { cubeRound, cubeToAxial } from './coords.js';

const SQRT3 = Math.sqrt(3);

/** Center of a hex in background-image pixel space. */
export function hexToPixel(h: Hex, grid: Pick<GridConfig, 'hexSize' | 'originX' | 'originY'>): Point {
  return {
    x: grid.hexSize * SQRT3 * (h.q + h.r / 2) + grid.originX,
    y: grid.hexSize * 1.5 * h.r + grid.originY,
  };
}

/** Hex containing a pixel-space point. */
export function pixelToHex(p: Point, grid: Pick<GridConfig, 'hexSize' | 'originX' | 'originY'>): Hex {
  const x = p.x - grid.originX;
  const y = p.y - grid.originY;
  const q = (SQRT3 / 3 * x - y / 3) / grid.hexSize;
  const r = (2 / 3 * y) / grid.hexSize;
  const rounded = cubeRound({ x: q, z: r, y: -q - r });
  return cubeToAxial(rounded);
}

/** The 6 corner points of a hex, starting at the top and going clockwise. */
export function hexCorners(h: Hex, grid: Pick<GridConfig, 'hexSize' | 'originX' | 'originY'>): Point[] {
  const c = hexToPixel(h, grid);
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    out.push({ x: c.x + grid.hexSize * Math.cos(angle), y: c.y + grid.hexSize * Math.sin(angle) });
  }
  return out;
}
