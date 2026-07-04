// Area-of-effect shape hit-testing, in continuous pixel space rather than
// hex cells — a sphere/cone/line/cube is defined by feet, converted to
// pixels via the map's grid scale, so the same math works for any shape or
// size a spell declares without per-spell special-casing.

import type { AoeSpec, GridConfig, Hex, Point } from '../types.js';
import { hexToPixel } from './pixel.js';

const SQRT3 = Math.sqrt(3);

/** How many map pixels correspond to one foot on this grid. */
export function pxPerFoot(grid: Pick<GridConfig, 'hexSize' | 'feetPerHex'>): number {
  const feetPerHex = grid.feetPerHex > 0 ? grid.feetPerHex : 5;
  return (grid.hexSize * SQRT3) / feetPerHex;
}

/** Half-angle of a cone template (a 60°-total cone is a common VTT simplification of 5e's rule). */
const CONE_HALF_ANGLE = Math.PI / 6;

export interface AoeGeometry {
  /** Where the shape originates — the caster, for cone/line/cube. Unused for sphere/cylinder. */
  originPx: Point;
  /** Where the caster is aiming — the center, for sphere/cylinder; the direction target, for cone/line/cube. */
  aimPx: Point;
}

/** True if `point` (map pixels) falls inside the given AoE shape. */
export function pointInAoe(point: Point, spec: AoeSpec, geo: AoeGeometry, pxPerFt: number): boolean {
  const sizePx = spec.sizeFt * pxPerFt;
  if (spec.shape === 'sphere' || spec.shape === 'cylinder') {
    const dx = point.x - geo.aimPx.x;
    const dy = point.y - geo.aimPx.y;
    return dx * dx + dy * dy <= sizePx * sizePx;
  }

  // Cone/line/cube all originate at the caster and extend toward the aim point.
  const ox = geo.originPx.x;
  const oy = geo.originPx.y;
  const dirX = geo.aimPx.x - ox;
  const dirY = geo.aimPx.y - oy;
  const dirLen = Math.hypot(dirX, dirY);
  const px = point.x - ox;
  const py = point.y - oy;

  if (spec.shape === 'cone') {
    const dist = Math.hypot(px, py);
    if (dist <= 1e-6) return true; // the caster's own hex is inside their cone
    if (dist > sizePx || dirLen <= 1e-6) return false;
    const cos = (px * dirX + py * dirY) / (dirLen * dist);
    return Math.acos(Math.max(-1, Math.min(1, cos))) <= CONE_HALF_ANGLE;
  }

  // line and cube: a rectangle from the origin toward the aim direction.
  // A cube "originates from you" and extends sizeFt in the chosen direction —
  // approximated here as a square (width = length) rather than a true 3D cube.
  if (dirLen <= 1e-6) return px * px + py * py <= sizePx * sizePx;
  const ux = dirX / dirLen;
  const uy = dirY / dirLen;
  const along = px * ux + py * uy;
  const perp = Math.abs(px * uy - py * ux);
  const halfWidthFt = spec.shape === 'cube' ? spec.sizeFt / 2 : (spec.widthFt ?? 5) / 2;
  return along >= 0 && along <= sizePx && perp <= halfWidthFt * pxPerFt;
}

/** The ids of every token (by hex position) caught inside an AoE placement. */
export function tokensInAoe<T extends { id: string; q: number; r: number }>(
  spec: AoeSpec,
  originHex: Hex,
  aimHex: Hex,
  grid: GridConfig,
  tokens: T[],
): string[] {
  const geo: AoeGeometry = { originPx: hexToPixel(originHex, grid), aimPx: hexToPixel(aimHex, grid) };
  const pxPerFt = pxPerFoot(grid);
  return tokens.filter((t) => pointInAoe(hexToPixel({ q: t.q, r: t.r }, grid), spec, geo, pxPerFt)).map((t) => t.id);
}
