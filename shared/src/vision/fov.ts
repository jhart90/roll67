// Field-of-view: center-to-center raycasting against wall/door segments,
// combined with the lighting model (bright/dim lights, darkvision,
// global illumination). Pure — fully unit-testable.

import type { Door, GridConfig, Hex, Light, Point, VisionStats, Wall } from '../types.js';
import { hexDistance, hexRange, hexRing } from '../hex/coords.js';
import { hexToPixel, pixelToHex } from '../hex/pixel.js';
import { packHex } from '../hex/pack.js';
import { rayBlocked, sightSegments, type Segment } from './raycast.js';
import { computeVisibilityPolygon, computeVisibilityPolygonBands } from './visibilityPolygon.js';

const SQRT3 = Math.sqrt(3);

/** Hard cap on vision radius, to bound raycasting cost. */
export const MAX_VISION_RADIUS = 40;

/** In 'dim' ambient lighting, every viewer can make out this radius around
 *  themselves without needing a light source or darkvision. */
export const DIM_AMBIENT_RADIUS = 2;

/**
 * Under global daylight ('light'), sight isn't limited by a character's own
 * vision stat at all -- only by obstructions (walls/doors) and the hard
 * MAX_VISION_RADIUS cost cap, which comfortably covers any normal map. A
 * character's visionRange/darkvision only matter once something short of
 * full daylight is in play ('dim'/'dark'), where they define how far into
 * the gloom that character personally sees.
 */
function effectiveStats(stats: VisionStats, lighting: GridConfig['lighting']): VisionStats {
  if (lighting !== 'light') return stats;
  return { visionRange: MAX_VISION_RADIUS, darkvision: MAX_VISION_RADIUS };
}

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
 * With lighting 'light' the whole map is lit — callers skip this.
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
  rawStats: VisionStats,
  input: FovInput,
  precomputed?: { lit?: Set<number> },
): Set<number> {
  const stats = effectiveStats(rawStats, input.grid.lighting);
  const radius = Math.min(Math.max(stats.visionRange, stats.darkvision, 0), MAX_VISION_RADIUS);
  const visible = new Set<number>();
  if (radius <= 0) {
    if (inBounds(viewer, input.grid)) visible.add(packHex(viewer));
    return visible;
  }
  const lighting = input.grid.lighting;
  const needLightCheck = lighting !== 'light';
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
      const inDimAmbient = lighting === 'dim' && dist <= DIM_AMBIENT_RADIUS;
      if (!isLit && !inDarkvision && !inDimAmbient) continue;
      if ((isLit || inDimAmbient) && dist > stats.visionRange && !inDarkvision) continue;
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
  const lit = input.grid.lighting === 'light' ? undefined : litHexes(input);
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
 * `full` and `fade` bands for one viewer in a single pass over the wider
 * (fade) radius: `rayBlocked` doesn't depend on vision stats, only on the
 * viewer/target geometry, so a hex's blocked-or-not result is identical for
 * both bands -- raycasting each hex once and testing it against both stats
 * afterward avoids running computeFov's whole hex loop (and every raycast in
 * it) twice per viewer.
 */
function computeFovBands(
  viewer: Hex, rawStats: VisionStats, input: FovInput, precomputed?: { lit?: Set<number> },
): FovBands {
  const stats = effectiveStats(rawStats, input.grid.lighting);
  const fs = fadeStats(stats);
  const fadeRadius = Math.min(Math.max(fs.visionRange, fs.darkvision, 0), MAX_VISION_RADIUS);
  const full = new Set<number>();
  const fade = new Set<number>();
  if (fadeRadius <= 0) {
    if (inBounds(viewer, input.grid)) full.add(packHex(viewer));
    return { full, fade };
  }
  const lighting = input.grid.lighting;
  const needLightCheck = lighting !== 'light';
  const lit = needLightCheck ? (precomputed?.lit ?? litHexes(input)) : undefined;
  const viewerPx = hexToPixel(viewer, input.grid);
  const segs = sightSegments(input.walls, input.doors, viewerPx);

  for (const h of hexRange(viewer, fadeRadius)) {
    if (!inBounds(h, input.grid)) continue;
    const dist = hexDistance(viewer, h);
    const key = packHex(h);
    if (dist === 0) { full.add(key); continue; }
    if (dist > fs.visionRange && dist > fs.darkvision) continue;
    let reachable = true;
    if (needLightCheck) {
      const isLit = lit!.has(key);
      const inDarkvisionWide = dist <= fs.darkvision;
      const inDimAmbient = lighting === 'dim' && dist <= DIM_AMBIENT_RADIUS;
      if (!isLit && !inDarkvisionWide && !inDimAmbient) reachable = false;
      else if ((isLit || inDimAmbient) && dist > fs.visionRange && !inDarkvisionWide) reachable = false;
    }
    if (!reachable) continue;
    const target = hexToPixel(h, input.grid);
    if (rayBlocked(viewerPx, target, segs)) continue;

    // Visible under the wider (fade) stats, and the raycast proving it is
    // already paid for -- reuse it to test the tighter (full) stats instead
    // of raycasting this same hex a second time.
    let isFull = dist <= stats.visionRange || dist <= stats.darkvision;
    if (isFull && needLightCheck) {
      const isLit = lit!.has(key);
      const inDarkvision = dist <= stats.darkvision;
      const inDimAmbient = lighting === 'dim' && dist <= DIM_AMBIENT_RADIUS;
      if (!isLit && !inDarkvision && !inDimAmbient) isFull = false;
      else if ((isLit || inDimAmbient) && dist > stats.visionRange && !inDarkvision) isFull = false;
    }
    if (isFull) full.add(key); else fade.add(key);
  }
  return { full, fade };
}

/**
 * Union FOV split into bands: `full` out to each viewer's vision radius,
 * `fade` for the extra +1 hex where sight trails off. Everything past the
 * fade rim stays fogged (fully black if unexplored).
 *
 * `precomputedLit` lets a caller re-share one map's lit-hexes set across
 * several viewers/users in the same moment (e.g. every online player after a
 * single token move) instead of recomputing the identical light raycasts
 * once per union call.
 */
export function computeUnionFovBands(
  viewers: Array<{ hex: Hex; stats: VisionStats }>,
  input: FovInput,
  precomputedLit?: Set<number>,
): FovBands {
  const lit = input.grid.lighting === 'light' ? undefined : (precomputedLit ?? litHexes(input));
  const full = new Set<number>();
  const fade = new Set<number>();
  for (const v of viewers) {
    const bands = computeFovBands(v.hex, v.stats, input, { lit });
    for (const key of bands.full) full.add(key);
    for (const key of bands.fade) fade.add(key);
  }
  // Union semantics: a hex fully visible to ANY viewer counts as full even
  // if another viewer only reaches it at fade range.
  for (const key of full) fade.delete(key);
  return { full, fade };
}

/**
 * What's actually illuminated within a viewer's raw wall-aware reach, under
 * 'dark'/'dim' lighting: darkvision/dim-ambient circles (one set per viewer)
 * plus each light source's own wall-aware illumination shape. The client
 * intersects a band's `reach` polygons with this (canvas compositing) before
 * treating anything as visible -- being in raycast range of your own eyes
 * isn't enough in the dark; something also has to be lighting it up.
 */
export interface VisibilityLitMask {
  circles: Array<{ x: number; y: number; r: number }>;
  lightPolygons: Point[][];
}

export interface VisibilityBand {
  /** One polygon per viewer: the wall-aware area their eyes could reach, ignoring light. */
  reach: Point[][];
  /** Null under 'light' (the whole reach counts as visible, no clipping needed). */
  lit: VisibilityLitMask | null;
}

export interface VisibilityPolygonBands {
  /** Out to each viewer's vision radius. */
  full: VisibilityBand;
  /** Out to the +1 hex fade radius. */
  fade: VisibilityBand;
}

/** Each light's own wall-aware illumination shape (an eye standing at the light, per litHexes' hex analog). */
export function computeLightPolygons(input: FovInput, pxPerHex: number): Point[][] {
  const out: Point[][] = [];
  for (const light of input.lights) {
    const pos = { x: light.x, y: light.y };
    const segs = sightSegments(input.walls, input.doors, pos);
    const radius = Math.min(Math.max(light.dimRadius, light.brightRadius), MAX_VISION_RADIUS);
    const poly = computeVisibilityPolygon(pos, radius * pxPerHex, segs);
    if (poly.length > 0) out.push(poly);
  }
  return out;
}

/**
 * The smooth, continuous analog of computeUnionFovBands: a wall-accurate
 * visibility polygon per viewer instead of a set of whole hexes, for
 * rendering a fog edge that cuts through hexes rather than stair-stepping
 * along their boundaries.
 *
 * Under global daylight ('light'), `reach` alone is the visible area (a pure
 * raycast, same as the hex model). Under 'dark'/'dim', `lit` describes what's
 * actually illuminated within that reach -- a simplification of the exact
 * hex model's rule that a light/dim-ambient hex must also fall within the
 * viewer's own (non-darkvision) vision range: here it only needs to fall
 * within the combined max(visionRange, darkvision) reach. The two agree
 * whenever darkvision <= visionRange, which covers every normal case; they
 * only diverge for the unusual darkvision > visionRange build, where this
 * version is very slightly more generous at the fringe.
 *
 * `precomputed` lets a caller re-share one map's lit-hexes set and light
 * polygons across several viewers/users in the same moment instead of
 * recomputing those (viewer-independent) shapes once per call.
 */
export function computeUnionVisibilityPolygons(
  viewers: Array<{ hex: Hex; stats: VisionStats }>,
  input: FovInput,
  precomputed?: { lightPolygons?: Point[][] },
): VisibilityPolygonBands {
  const isLight = input.grid.lighting === 'light';
  const isDim = input.grid.lighting === 'dim';
  const pxPerHex = input.grid.hexSize * SQRT3;
  const full: Point[][] = [];
  const fade: Point[][] = [];
  const fullCircles: Array<{ x: number; y: number; r: number }> = [];
  const fadeCircles: Array<{ x: number; y: number; r: number }> = [];

  for (const v of viewers) {
    const stats = effectiveStats(v.stats, input.grid.lighting);
    const radius = Math.min(Math.max(stats.visionRange, stats.darkvision, 0), MAX_VISION_RADIUS);
    if (radius <= 0) continue;
    const originPx = hexToPixel(v.hex, input.grid);
    const segs = sightSegments(input.walls, input.doors, originPx);

    const fs = fadeStats(stats);
    const fadeRadius = Math.min(Math.max(fs.visionRange, fs.darkvision, 0), MAX_VISION_RADIUS);
    const bands = computeVisibilityPolygonBands(originPx, radius * pxPerHex, fadeRadius * pxPerHex, segs);
    full.push(bands.full);
    fade.push(bands.fade);

    if (!isLight) {
      // computeFov always treats a viewer's own hex as visible (dist === 0
      // bypasses the light check entirely) -- you can perceive where you're
      // standing even in pitch dark. Mirror that here, or the viewer's own
      // token would otherwise render under an un-punched, un-lit patch of fog.
      fullCircles.push({ x: originPx.x, y: originPx.y, r: pxPerHex });
      fadeCircles.push({ x: originPx.x, y: originPx.y, r: pxPerHex });
      if (v.stats.darkvision > 0) fullCircles.push({ x: originPx.x, y: originPx.y, r: v.stats.darkvision * pxPerHex });
      if (fs.darkvision > 0) fadeCircles.push({ x: originPx.x, y: originPx.y, r: fs.darkvision * pxPerHex });
      if (isDim) {
        // Unlike darkvision, the ambient radius itself doesn't widen for the
        // fade rim (matching computeFov's use of the DIM_AMBIENT_RADIUS
        // constant unchanged for both calls).
        fullCircles.push({ x: originPx.x, y: originPx.y, r: DIM_AMBIENT_RADIUS * pxPerHex });
        fadeCircles.push({ x: originPx.x, y: originPx.y, r: DIM_AMBIENT_RADIUS * pxPerHex });
      }
    }
  }

  if (isLight) {
    return { full: { reach: full, lit: null }, fade: { reach: fade, lit: null } };
  }
  const lightPolygons = precomputed?.lightPolygons ?? computeLightPolygons(input, pxPerHex);
  return {
    full: { reach: full, lit: { circles: fullCircles, lightPolygons } },
    fade: { reach: fade, lit: { circles: fadeCircles, lightPolygons } },
  };
}
