// Area-of-effect shape hit-testing, in continuous pixel space rather than
// hex cells — a sphere/cone/line/cube is defined by feet, converted to
// pixels via the map's grid scale, so the same math works for any shape or
// size a spell declares without per-spell special-casing.

import type { AoeSpec, Door, GridConfig, Hex, MapZone, Point, Wall } from '../types.js';
import { rayBlocked, sightSegments } from '../vision/raycast.js';
import { hexToPixel } from './pixel.js';
import { hexDistance } from './coords.js';
import { hexLine } from './line.js';

const SQRT3 = Math.sqrt(3);

/** How many map pixels correspond to one foot on this grid. */
export function pxPerFoot(grid: Pick<GridConfig, 'hexSize' | 'feetPerHex'>): number {
  const feetPerHex = grid.feetPerHex > 0 ? grid.feetPerHex : 5;
  return (grid.hexSize * SQRT3) / feetPerHex;
}

/**
 * The Cone Template's shape.
 *
 * The book prints it as a teardrop: a narrow point at the caster that opens
 * out into a big rounded end, not the 60° pie wedge a VTT usually reaches
 * for. Geometrically it is the convex hull of the caster's point and a circle
 * at the far end — which is what the two tangent lines down its sides are.
 *
 * CONE_END_RADIUS is that circle's radius as a fraction of the template's
 * length, read off the printed template's proportions (its widest part is
 * about half its length). The length itself is unchanged, so every power and
 * weapon keeps the reach it had.
 */
const CONE_END_RADIUS = 0.25;

/** Where the end circle's centre sits, as a fraction of the length. */
const CONE_END_CENTRE = 1 - CONE_END_RADIUS;

/** Half-angle of the tangent sides — asin(r / d) for a circle at distance d. */
const CONE_HALF_ANGLE = Math.asin(CONE_END_RADIUS / CONE_END_CENTRE);

/**
 * Is a point inside a teardrop cone of length `len`, given its distance along
 * the aim axis and its perpendicular offset? Both in the same units.
 *
 * Two regions, which together are exactly the hull: the tangent wedge up to
 * the end circle's centre, and the circle itself beyond it.
 */
export function pointInConeTemplate(along: number, offset: number, len: number): boolean {
  if (len <= 0 || along <= 0) return false;          // behind the caster, or no cone
  const r = CONE_END_RADIUS * len;
  const c = CONE_END_CENTRE * len;
  const s = Math.abs(offset);
  if (along <= c) return s <= along * Math.tan(CONE_HALF_ANGLE);
  const dx = along - c;
  return dx * dx + s * s <= r * r;
}

/**
 * The Cone Template as an SVG path, so the shape drawn on the map and the
 * shape `pointInConeTemplate` tests are built from the same two constants and
 * cannot drift apart.
 *
 * Apex, out along one tangent, the long way round the end circle, back down
 * the other tangent. The arc is the major one (it wraps the far tip), and it
 * sweeps anticlockwise on screen because SVG's y axis points down.
 */
export function coneTemplatePath(ox: number, oy: number, ux: number, uy: number, len: number): string {
  const r = CONE_END_RADIUS * len;
  const c = CONE_END_CENTRE * len;
  // Where the tangent from the apex actually touches the circle.
  const d = Math.sqrt(Math.max(0, c * c - r * r));
  const along = d * Math.cos(CONE_HALF_ANGLE);
  const off = d * Math.sin(CONE_HALF_ANGLE);
  const px = -uy;
  const py = ux;
  const lx = ox + ux * along + px * off;
  const ly = oy + uy * along + py * off;
  const rx = ox + ux * along - px * off;
  const ry = oy + uy * along - py * off;
  return `M ${ox},${oy} L ${lx},${ly} A ${r},${r} 0 1 0 ${rx},${ry} Z`;
}

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
    // PHB 204: "A cone's point of origin is not included in the cone's area
    // of effect" — i.e. the caster doesn't hit themself with their own cone.
    if (dist <= 1e-6) return false;
    if (dirLen <= 1e-6) return false;
    // Resolve into "how far along the aim" and "how far off to the side",
    // which is what the teardrop is defined in terms of.
    const ux = dirX / dirLen;
    const uy = dirY / dirLen;
    return pointInConeTemplate(px * ux + py * uy, px * uy - py * ux, sizePx);
  }

  // line and cube: a rectangle from the origin toward the aim direction.
  // A cube "originates from you" and extends sizeFt in the chosen direction —
  // approximated here as a square (width = length) rather than a true 3D cube.
  // Same self-exclusion as the cone: a line/cube that erupts from the caster
  // (e.g. a breath weapon) doesn't hit the caster's own square either.
  if (px * px + py * py <= 1e-6) return false;
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
  // Tile-sized blasts hit by exact hex distance: the template is defined as
  // "this many tiles", so a pixel-circle approximation would leak or clip
  // hexes on the diagonals. Feet-based shapes keep the pixel-space test.
  if (spec.sizeHexes != null && (spec.shape === 'sphere' || spec.shape === 'cylinder')) {
    return tokens.filter((t) => hexDistance(aimHex, { q: t.q, r: t.r }) <= spec.sizeHexes!).map((t) => t.id);
  }
  const geo: AoeGeometry = { originPx: hexToPixel(originHex, grid), aimPx: hexToPixel(aimHex, grid) };
  const pxPerFt = pxPerFoot(grid);
  return tokens.filter((t) => pointInAoe(hexToPixel({ q: t.q, r: t.r }, grid), spec, geo, pxPerFt)).map((t) => t.id);
}

/**
 * Where the effect actually comes FROM, which is what walls are measured
 * against.
 *
 * A burst goes off at the point it lands: the fireball, the grenade, the
 * shell. Whether it reaches you is a question about the wall between you and
 * the bang, not about the wall between you and whoever threw it — that is
 * what lets a grenade rolled around a corner catch the people the thrower
 * cannot see, and what stops one going off in a corridor from hurting the
 * room next door.
 *
 * A cone, a line or a cube erupts from the caster instead, so for those the
 * origin IS the caster and nothing changes.
 */
export function aoeSourceHex(spec: AoeSpec, originHex: Hex, aimHex: Hex): Hex {
  return spec.shape === 'sphere' || spec.shape === 'cylinder' ? aimHex : originHex;
}

/**
 * Every token the shape covers AND can actually reach through the walls.
 *
 * The geometry alone is a lie in any building: a template drawn over a wall
 * covers the hexes on both sides of it, and without this a blast killed
 * people through stone. Callers that have no wall data (a preview on a map
 * still loading) pass none and get the bare geometry, which is the old
 * behaviour and never worse than it.
 */
export function tokensCaughtInAoe<T extends { id: string; q: number; r: number }>(
  spec: AoeSpec,
  originHex: Hex,
  aimHex: Hex,
  grid: GridConfig,
  tokens: T[],
  sight: { walls: Wall[]; doors: Door[] } | null,
): string[] {
  let ids = tokensInAoe(spec, originHex, aimHex, grid, tokens);
  // A burst centred on the thing that set it off does not catch it. The book
  // already says so of a cone — "a cone's point of origin is not included" —
  // and a tail sweep is the same claim: the sweep goes round the creature
  // swinging it, not through it. Only when the two hexes are the SAME, so a
  // grenade thrown at your own feet still gets you.
  const selfCentred = (spec.shape === 'sphere' || spec.shape === 'cylinder')
    && originHex.q === aimHex.q && originHex.r === aimHex.r;
  if (selfCentred) {
    ids = ids.filter((id) => {
      const t = tokens.find((x) => x.id === id);
      return !t || t.q !== originHex.q || t.r !== originHex.r;
    });
  }
  if (!sight || (sight.walls.length === 0 && sight.doors.length === 0)) return ids;
  const from = hexToPixel(aoeSourceHex(spec, originHex, aimHex), grid);
  const segs = sightSegments(sight.walls, sight.doors, from);
  if (segs.length === 0) return ids;
  const byId = new Map(tokens.map((t) => [t.id, t]));
  return ids.filter((id) => {
    const t = byId.get(id);
    if (!t) return false;
    return !rayBlocked(from, hexToPixel({ q: t.q, r: t.r }, grid), segs);
  });
}

/**
 * How much harder a cloud makes a shot from `from` at `to`.
 *
 * A cloud counts if the target is standing in it or if the shot has to pass
 * through it — the straight line between the two is walked hex by hex, the
 * same line the engine uses for movement cost and for cover. Standing IN the
 * smoke and shooting OUT of it is the same −4 as shooting into it, which is
 * the book's answer and also the intuitive one: you cannot see either way.
 *
 * Clouds do not stack: two overlapping banks of smoke are still smoke, so the
 * worst single penalty applies rather than their sum.
 */
export function obscureBetween(
  zones: MapZone[] | undefined, from: Hex, to: Hex,
): { penalty: number; label: string } | null {
  if (!zones || zones.length === 0) return null;
  const path = hexLine(from, to);
  let worst: MapZone | null = null;
  for (const z of zones) {
    if (z.roundsLeft <= 0) continue;
    const touched = path.some((h: Hex) => hexDistance(z.hex, h) <= z.radius);
    if (!touched) continue;
    if (!worst || z.penalty < worst.penalty) worst = z;
  }
  return worst ? { penalty: worst.penalty, label: worst.label } : null;
}
