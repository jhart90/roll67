// Field-of-view: center-to-center raycasting against wall/door segments,
// combined with the lighting model (bright/dim lights, darkvision,
// global illumination). Pure — fully unit-testable.

import type { Door, GridConfig, Hex, Light, VisionStats, Wall } from '../types.js';
import { hexDistance, hexRange, hexRing } from '../hex/coords.js';
import { hexToPixel, pixelToHex } from '../hex/pixel.js';
import { packHex } from '../hex/pack.js';
import { rayBlocked, sightSegments, type Segment } from './raycast.js';

/** Hard cap on vision radius, to bound raycasting cost. */
export const MAX_VISION_RADIUS = 40;

/** Is a hex inside the map's rectangular bounds (odd-r offset layout)? */
export function inBounds(h: Hex, grid: Pick<GridConfig, 'cols' | 'rows'>): boolean {
  const row = h.r;
  const col = h.q + (h.r - (h.r & 1)) / 2;
  return row >= 0 && row < grid.rows && col >= 0 && col < grid.cols;
}

/**
 * The nearest free, in-bounds hex to `center`: `center` itself if open, else the
 * closest hex on an expanding ring (searched outward up to `maxRadius`). Falls
 * back to `center` if nothing free is found.
 */
export function firstFreeHex(
  center: Hex, occupied: Set<number>, grid: Pick<GridConfig, 'cols' | 'rows'>, maxRadius = 12,
): Hex {
  const free = (h: Hex) => inBounds(h, grid) && !occupied.has(packHex(h));
  if (free(center)) return center;
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (const h of hexRing(center, radius)) if (free(h)) return h;
  }
  return center;
}

export interface FovInput {
  grid: GridConfig;
  walls: Wall[];
  doors: Door[];
  lights: Light[];
}

/**
 * The set of hexes illuminated by light sources (ignores viewers).
 * With globalIllumination the whole map is lit — callers skip this.
 */
export function litHexes(input: FovInput): Set<number> {
  const lit = new Set<number>();
  for (const light of input.lights) {
    const lightPos = { x: light.x, y: light.y };
    // Light "sees" (illuminates) through the same rules as an eye at its spot.
    const segs = sightSegments(input.walls, input.doors, lightPos);
    const lightHex = pixelToHex(lightPos, input.grid);
    const radius = Math.min(Math.max(light.dimRadius, light.brightRadius), MAX_VISION_RADIUS);
    for (const h of hexRange(lightHex, radius)) {
      if (!inBounds(h, input.grid)) continue;
      const key = packHex(h);
      if (lit.has(key)) continue;
      const target = hexToPixel(h, input.grid);
      if (!rayBlocked(lightPos, target, segs)) lit.add(key);
    }
  }
  return lit;
}

/**
 * Hexes visible to a viewer standing on `viewer` with the given vision stats.
 * A hex is visible iff:
 *   distance <= visionRange (capped), AND
 *   the center-to-center ray is not blocked, AND
 *   (globally lit OR lit by a light source OR within darkvision range).
 */
export function computeFov(
  viewer: Hex,
  stats: VisionStats,
  input: FovInput,
  precomputed?: { lit?: Set<number> },
): Set<number> {
  const radius = Math.min(Math.max(stats.visionRange, stats.darkvision, 0), MAX_VISION_RADIUS);
  const visible = new Set<number>();
  if (radius <= 0) {
    if (inBounds(viewer, input.grid)) visible.add(packHex(viewer));
    return visible;
  }
  const needLightCheck = !input.grid.globalIllumination;
  const lit = needLightCheck ? (precomputed?.lit ?? litHexes(input)) : undefined;
  const viewerPx = hexToPixel(viewer, input.grid);
  // Sight blockers depend on the viewer's position (one-way walls).
  const segs = sightSegments(input.walls, input.doors, viewerPx);

  for (const h of hexRange(viewer, radius)) {
    if (!inBounds(h, input.grid)) continue;
    const dist = hexDistance(viewer, h);
    const key = packHex(h);
    if (dist === 0) {
      visible.add(key);
      continue;
    }
    if (dist > stats.visionRange && dist > stats.darkvision) continue;
    if (needLightCheck) {
      const isLit = lit!.has(key);
      const inDarkvision = dist <= stats.darkvision;
      if (!isLit && !inDarkvision) continue;
      if (isLit && dist > stats.visionRange && !inDarkvision) continue;
    }
    const target = hexToPixel(h, input.grid);
    if (!rayBlocked(viewerPx, target, segs)) visible.add(key);
  }
  return visible;
}

/** Union of FOVs for several viewer tokens (a player may own several). */
export function computeUnionFov(
  viewers: Array<{ hex: Hex; stats: VisionStats }>,
  input: FovInput,
): Set<number> {
  const lit = input.grid.globalIllumination ? undefined : litHexes(input);
  const union = new Set<number>();
  for (const v of viewers) {
    for (const key of computeFov(v.hex, v.stats, input, { lit })) {
      union.add(key);
    }
  }
  return union;
}

export interface FovBands {
  /** Crisp, fully-visible hexes (within the vision radius). */
  full: Set<number>;
  /** The fading rim one hex past the vision radius; black beyond it. */
  fade: Set<number>;
}

/** Widen vision stats by one hex for the fade rim. */
function fadeStats(stats: VisionStats): VisionStats {
  return {
    visionRange: stats.visionRange + 1,
    darkvision: stats.darkvision > 0 ? stats.darkvision + 1 : 0,
  };
}

/**
 * Union FOV split into bands: `full` out to each viewer's vision radius,
 * `fade` for the extra +1 hex where sight trails off. Everything past the
 * fade rim stays fogged (fully black if unexplored).
 */
export function computeUnionFovBands(
  viewers: Array<{ hex: Hex; stats: VisionStats }>,
  input: FovInput,
): FovBands {
  const lit = input.grid.globalIllumination ? undefined : litHexes(input);
  const full = new Set<number>();
  const expanded = new Set<number>();
  for (const v of viewers) {
    for (const key of computeFov(v.hex, v.stats, input, { lit })) full.add(key);
    for (const key of computeFov(v.hex, fadeStats(v.stats), input, { lit })) expanded.add(key);
  }
  const fade = new Set<number>();
  for (const key of expanded) {
    if (!full.has(key)) fade.add(key);
  }
  return { full, fade };
}
